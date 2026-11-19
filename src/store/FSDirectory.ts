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

// Port of org.apache.lucene.store.FSDirectory (Lucene 5.2.1).
//
// Deviations:
//  - A java.nio.file.Path is a plain string (see src/nio/Files.ts); all I/O is synchronous node:fs.
//  - open() picks the implementation among MMapDirectory / SimpleFSDirectory / NIOFSDirectory like Java, but the
//    subclasses register themselves in FSDirectory._impls when their modules load (ES module cycle: they extend
//    this class). src/index.ts loads them all. MMapDirectory.UNMAP_SUPPORTED is false here (no way to unmap
//    memory), so open() returns an NIOFSDirectory on Linux/macOS and a SimpleFSDirectory on Windows.
//  - listAll returns names sorted (libuv's scandir sorts); Java returns readdir order, unspecified.
//  - listAll(Path) (static, same name as the instance method in Java) is called listAllIn.
//  - FSIndexOutput (the Java inner class) takes the directory path and the file name.

import { IllegalStateException } from "../errors.js";
import { FilterOutputStream } from "../io/FilterOutputStream.js";
import type { OutputStream } from "../io/OutputStream.js";
import { Files, resolvePath } from "../nio/Files.js";
import { Constants } from "../util/Constants.js";
import { IOUtils } from "../util/IOUtils.js";
import { BaseDirectory } from "./BaseDirectory.js";
import { FSLockFactory } from "./FSLockFactory.js";
import type { IOContext } from "./IOContext.js";
import type { IndexInput } from "./IndexInput.js";
import type { IndexOutput } from "./IndexOutput.js";
import type { LockFactory } from "./LockFactory.js";
import { OutputStreamIndexOutput } from "./OutputStreamIndexOutput.js";

/**
 * Base class for Directory implementations that store index files in the file system.
 * (See the Java documentation for the comparison of the three implementations.)
 *
 * @see Directory
 */
export abstract class FSDirectory extends BaseDirectory {
  /** The underlying filesystem directory */
  protected readonly directory: string;

  /** @internal the implementations, registered by their modules */
  static readonly _impls: {
    mmap?: new (path: string, lockFactory: LockFactory) => FSDirectory;
    simple?: new (path: string, lockFactory: LockFactory) => FSDirectory;
    nio?: new (path: string, lockFactory: LockFactory) => FSDirectory;
    mmapUnmapSupported: boolean;
  } = { mmapUnmapSupported: false };

  /** Create a new FSDirectory for the named location (ctor for subclasses). */
  protected constructor(path: string, lockFactory: LockFactory) {
    super(lockFactory);
    Files.createDirectories(path); // create directory, if it doesn't exist
    this.directory = Files.toRealPath(path);
  }

  /**
   * Creates an FSDirectory instance, trying to pick the best implementation given the current environment.
   * The directory returned uses the {@link FSLockFactory#getDefault()} (or the given lock factory).
   */
  static open(path: string, lockFactory: LockFactory = FSLockFactory.getDefault()): FSDirectory {
    const impls = FSDirectory._impls;
    let ctor;
    if (Constants.JRE_IS_64BIT && impls.mmapUnmapSupported) {
      ctor = impls.mmap;
    } else if (Constants.WINDOWS) {
      ctor = impls.simple;
    } else {
      ctor = impls.nio;
    }
    if (ctor === undefined) {
      throw new IllegalStateException("FSDirectory implementations are not loaded: import src/index.ts");
    }
    return new ctor(path, lockFactory);
  }

  /** Lists all files (including subdirectories) in the specified directory. */
  static listAllIn(dir: string): string[] {
    return Files.listNames(dir);
  }

  /** Lists all files (including subdirectories) in the directory. */
  override listAll(): string[] {
    this.ensureOpen();
    return FSDirectory.listAllIn(this.directory);
  }

  /** Returns the length in bytes of a file in the directory. */
  override fileLength(name: string): number {
    this.ensureOpen();
    return Files.size(resolvePath(this.directory, name));
  }

  /** Removes an existing file in the directory. */
  override deleteFile(name: string): void {
    this.ensureOpen();
    Files.delete(resolvePath(this.directory, name));
  }

  /** Creates an IndexOutput for the file with the given name. */
  override createOutput(name: string, _context: IOContext): IndexOutput {
    this.ensureOpen();

    this.ensureCanWrite(name);
    return new FSIndexOutput(this.directory, name);
  }

  /** @internal */
  protected ensureCanWrite(name: string): void {
    Files.deleteIfExists(resolvePath(this.directory, name)); // delete existing, if any
  }

  override sync(names: Iterable<string>): void {
    this.ensureOpen();

    for (const name of names) {
      this.fsync(name);
    }
  }

  override renameFile(source: string, dest: string): void {
    this.ensureOpen();
    Files.atomicMove(resolvePath(this.directory, source), resolvePath(this.directory, dest));
    // TODO: should we move directory fsync to a separate 'syncMetadata' method?
    // for example, to improve listCommits(), IndexFileDeleter could also call that after deleting segments_Ns
    IOUtils.fsync(this.directory, true);
  }

  /** Closes the store to future operations. */
  override close(): void {
    this.isOpen = false;
  }

  /** @return the underlying filesystem directory */
  getDirectory(): string {
    this.ensureOpen();
    return this.directory;
  }

  /** For debug output. */
  override toString(): string {
    return this.constructor.name + "@" + this.directory + " lockFactory=" + String(this.lockFactory);
  }

  /** @internal */
  protected fsync(name: string): void {
    IOUtils.fsync(resolvePath(this.directory, name), false);
  }

  abstract override openInput(name: string, context: IOContext): IndexInput;
}

/**
 * Writes output with {@link FileOutputStream#write(byte[], int, int)}  (Java inner class FSDirectory.FSIndexOutput)
 */
export class FSIndexOutput extends OutputStreamIndexOutput {
  /**
   * The maximum chunk size is 8192 bytes, because {@link FileOutputStream} mallocs a native buffer outside of
   * stack if the write buffer size is larger.
   */
  static readonly CHUNK_SIZE = 8192;

  constructor(directory: string, name: string) {
    const path = resolvePath(directory, name);
    super(
      'FSIndexOutput(path="' + path + '")',
      new ChunkingOutputStream(Files.newOutputStream(path)),
      FSIndexOutput.CHUNK_SIZE);
  }
}

class ChunkingOutputStream extends FilterOutputStream {
  override write(b: number): void;
  override write(b: Uint8Array, off: number, len: number): void;
  override write(b: number | Uint8Array, offset?: number, length?: number): void {
    if (typeof b === "number") {
      this.out.write(b);
      return;
    }
    let off = offset!;
    let len = length!;
    while (len > 0) {
      const chunk = Math.min(len, FSIndexOutput.CHUNK_SIZE);
      this.out.write(b, off, chunk);
      len -= chunk;
      off += chunk;
    }
  }
}
