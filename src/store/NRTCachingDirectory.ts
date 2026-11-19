/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Port of org.apache.lucene.store.NRTCachingDirectory. The VERBOSE tracing is dropped; listAll() uses
// java.util.HashSet iteration order (javaHashOrder); `synchronized` is dropped (single thread).

import { IllegalStateException, IOException } from "../errors.js";
import type { Accountable } from "../util/Accountable.js";
import { Accountables } from "../util/Accountables.js";
import { IOUtils } from "../util/IOUtils.js";
import { javaHashOrder } from "../util/JavaCollections.js";
import { doubleToString } from "../util/JavaNumbers.js";
import { Directory } from "./Directory.js";
import { FilterDirectory } from "./FilterDirectory.js";
import type { IndexInput } from "./IndexInput.js";
import type { IndexOutput } from "./IndexOutput.js";
import { IOContext } from "./IOContext.js";
import { RAMDirectory } from "./RAMDirectory.js";

/**
 * Wraps a {@link RAMDirectory}
 * around any provided delegate directory, to
 * be used during NRT search.
 *
 * <p>This class is likely only useful in a near-real-time
 * context, where indexing rate is lowish but reopen
 * rate is highish, resulting in many tiny files being
 * written.  This directory keeps such segments (as well as
 * the segments produced by merging them, as long as they
 * are small enough), in RAM.</p>
 *
 * <p>This is safe to use: when your app calls {IndexWriter#commit},
 * all cached files will be flushed from the cached and sync'd.</p>
 *
 * <p>Here's a simple example usage:
 *
 * <pre class="prettyprint">
 *   Directory fsDir = FSDirectory.open(new File("/path/to/index"));
 *   NRTCachingDirectory cachedFSDir = new NRTCachingDirectory(fsDir, 5.0, 60.0);
 *   IndexWriterConfig conf = new IndexWriterConfig(analyzer);
 *   IndexWriter writer = new IndexWriter(cachedFSDir, conf);
 * </pre>
 *
 * <p>This will cache all newly flushed segments, all merges
 * whose expected segment size is &lt;= 5 MB (unless the net
 * cached bytes exceeds 60 MB at which point all writes will
 * not be cached).
 *
 * @lucene.experimental
 */
export class NRTCachingDirectory extends FilterDirectory implements Accountable {
  private readonly cache = new RAMDirectory();

  private readonly maxMergeSizeBytes: number;
  private readonly maxCachedBytes: number;

  /**
   * We will cache a newly created output if 1) it's a
   * flush or a merge and the estimated size of the merged segment is &lt;=
   * maxMergeSizeMB, and 2) the total cached bytes is &lt;=
   * maxCachedMB
   */
  constructor(delegate: Directory, maxMergeSizeMB: number, maxCachedMB: number) {
    super(delegate);
    this.maxMergeSizeBytes = Math.trunc(maxMergeSizeMB * 1024 * 1024);
    this.maxCachedBytes = Math.trunc(maxCachedMB * 1024 * 1024);
  }

  override toString(): string {
    // maxCachedBytes/1024 is a long division in Java, the second division is a double one
    return (
      "NRTCachingDirectory(" +
      this.in +
      "; maxCacheMB=" +
      doubleToString(Math.trunc(this.maxCachedBytes / 1024) / 1024) +
      " maxMergeSizeMB=" +
      doubleToString(Math.trunc(this.maxMergeSizeBytes / 1024) / 1024) +
      ")"
    );
  }

  override listAll(): string[] {
    const files: string[] = [];
    const seen = new Set<string>();
    for (const f of this.cache.listAll()) {
      seen.add(f);
      files.push(f);
    }
    for (const f of this.in.listAll()) {
      if (seen.has(f)) {
        throw new IllegalStateException(
          "file: " + this.in + " appears both in delegate and in cache: " +
            "cache=" + "[" + this.cache.listAll().join(", ") + "]" + ",delegate=" + "[" + this.in.listAll().join(", ") + "]",
        );
      }
      seen.add(f);
      files.push(f);
    }
    return javaHashOrder(files);
  }

  override deleteFile(name: string): void {
    if (this.cache.fileNameExists(name)) {
      this.cache.deleteFile(name);
    } else {
      this.in.deleteFile(name);
    }
  }

  override fileLength(name: string): number {
    if (this.cache.fileNameExists(name)) {
      return this.cache.fileLength(name);
    } else {
      return this.in.fileLength(name);
    }
  }

  /** Returns the names of the files held in the RAM cache. */
  listCachedFiles(): string[] {
    return this.cache.listAll();
  }

  override createOutput(name: string, context: IOContext): IndexOutput {
    if (this.doCacheWrite(name, context)) {
      // If we're writing to the cache, we must delete the file from the delegate if it exists
      try {
        this.in.deleteFile(name);
      } catch (ioe) {
        if (!(ioe instanceof IOException)) throw ioe;
        // This is fine: file may not exist
      }
      return this.cache.createOutput(name, context);
    } else {
      try {
        this.cache.deleteFile(name);
      } catch (ioe) {
        if (!(ioe instanceof IOException)) throw ioe;
        // This is fine: file may not exist
      }
      return this.in.createOutput(name, context);
    }
  }

  override sync(fileNames: Iterable<string>): void {
    const names = [...fileNames];
    for (const fileName of names) {
      this.unCache(fileName);
    }
    this.in.sync(names);
  }

  override renameFile(source: string, dest: string): void {
    this.unCache(source);
    this.in.renameFile(source, dest);
  }

  override openInput(name: string, context: IOContext): IndexInput {
    if (this.cache.fileNameExists(name)) {
      return this.cache.openInput(name, context);
    } else {
      return this.in.openInput(name, context);
    }
  }

  /** Close this directory, which flushes any cached files to the delegate and then closes the delegate. */
  override close(): void {
    // NOTE: technically we shouldn't have to do this, ie,
    // IndexWriter should have sync'd all files, but we do
    // it for defensive reasons... or in case the app is
    // doing something custom (creating outputs directly w/o
    // using IndexWriter):
    let success = false;
    try {
      if (this.cache.isOpen) {
        for (const fileName of this.cache.listAll()) {
          this.unCache(fileName);
        }
      }
      success = true;
    } finally {
      if (success) {
        IOUtils.close(this.cache, this.in);
      } else {
        IOUtils.closeWhileHandlingException(this.cache, this.in);
      }
    }
  }

  /** Subclass can override this to customize logic; return
   *  true if this file should be written to the RAMDirectory. */
  protected doCacheWrite(_name: string, context: IOContext): boolean {
    //System.out.println(Thread.currentThread().getName() + ": CACHE check merge=" + merge + " size=" + (merge==null ? 0 : merge.estimatedMergeBytes));

    let bytes = 0;
    if (context.mergeInfo !== null) {
      bytes = context.mergeInfo.estimatedMergeBytes;
    } else if (context.flushInfo !== null) {
      bytes = context.flushInfo.estimatedSegmentSize;
    }

    return bytes <= this.maxMergeSizeBytes && bytes + this.cache.ramBytesUsed() <= this.maxCachedBytes;
  }

  private unCache(fileName: string): void {
    // Only let one thread uncache at a time; this only
    // happens during commit() or close():
    // (Java: synchronized(uncacheLock))
    if (!this.cache.fileNameExists(fileName)) {
      // Another thread beat us...
      return;
    }
    const context = IOContext.DEFAULT;
    const out = this.in.createOutput(fileName, context);
    let input: IndexInput | null = null;
    try {
      input = this.cache.openInput(fileName, context);
      out.copyBytes(input, input.length());
    } finally {
      IOUtils.close(input, out);
    }

    // Lock order: uncacheLock -> this
    // Must sync here because other sync methods have
    // if (cache.fileNameExists(name)) { ... } else { ... }:
    this.cache.deleteFile(fileName);
  }

  ramBytesUsed(): number {
    return this.cache.ramBytesUsed();
  }

  getChildResources(): readonly Accountable[] {
    return [Accountables.namedAccountable("cache", this.cache)];
  }
}
