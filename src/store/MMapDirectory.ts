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

// Port of org.apache.lucene.store.MMapDirectory (Lucene 5.2.1).
//
// Deviations: Node cannot memory-map files, so FileChannel.map (src/nio) returns a snapshot copy of each chunk in
// a heap buffer: later changes to the file are not seen by an open input. UNMAP_SUPPORTED is false (there is no
// unmap hack to apply), hence setUseUnmap(true) throws and the CLEANER is not ported; inputs created by
// openInput never track clones. FSDirectory.open therefore never returns an MMapDirectory.

import { IllegalArgumentException, IOException } from "../errors.js";
import type { ByteBuffer } from "../nio/ByteBuffer.js";
import { FileChannel } from "../nio/FileChannel.js";
import { resolvePath } from "../nio/Files.js";
import { Constants } from "../util/Constants.js";
import { tryWithResource } from "../util/JavaObjects.js";
import { ByteBufferIndexInput } from "./ByteBufferIndexInput.js";
import { FSDirectory } from "./FSDirectory.js";
import { FSLockFactory } from "./FSLockFactory.js";
import type { IOContext } from "./IOContext.js";
import type { IndexInput } from "./IndexInput.js";
import type { LockFactory } from "./LockFactory.js";
import "./NativeFSLockFactory.js"; // registers the default FSLockFactory

/**
 * File-based {@link Directory} implementation that uses mmap for reading, and
 * {@link FSDirectory.FSIndexOutput} for writing. (See the Java documentation for the caveats of mmap;
 * here the "mapped" chunks are heap copies, see the file header.)
 */
export class MMapDirectory extends FSDirectory {
  /** <code>true</code>, if this platform supports unmapping mmapped files. Always false here. */
  static readonly UNMAP_SUPPORTED: boolean = false;

  private useUnmapHack = MMapDirectory.UNMAP_SUPPORTED;

  /**
   * Default max chunk size.
   * @see #MMapDirectory(Path, LockFactory, int)
   */
  static readonly DEFAULT_MAX_CHUNK_SIZE: number = Constants.JRE_IS_64BIT ? 1 << 30 : 1 << 28;
  readonly chunkSizePower: number;

  /**
   * Create a new MMapDirectory for the named location.
   * (Java overloads: (path), (path, lockFactory), (path, maxChunkSize), (path, lockFactory, maxChunkSize).)
   *
   * @param path the path of the directory
   * @param lockFactoryOrMaxChunkSize the lock factory to use (default: FSLockFactory.getDefault()), or the maximum chunk size
   * @param maxChunkSize maximum chunk size (default: 1 GiB on 64 bit JVMs and 256 MiB on 32 bit JVMs) used for memory mapping.
   */
  constructor(path: string);
  constructor(path: string, lockFactory: LockFactory);
  constructor(path: string, maxChunkSize: number);
  constructor(path: string, lockFactory: LockFactory, maxChunkSize: number);
  constructor(path: string, a?: LockFactory | number, b?: number) {
    const lockFactory = a === undefined || typeof a === "number" ? FSLockFactory.getDefault() : a;
    const maxChunkSize = typeof a === "number" ? a : (b ?? MMapDirectory.DEFAULT_MAX_CHUNK_SIZE);
    super(path, lockFactory);
    if (maxChunkSize <= 0) {
      throw new IllegalArgumentException("Maximum chunk size for mmap must be >0");
    }
    this.chunkSizePower = 31 - Math.clz32(maxChunkSize);
    // assert this.chunkSizePower >= 0 && this.chunkSizePower <= 30;
  }

  /**
   * This method enables the workaround for unmapping the buffers from address space after closing {@link IndexInput},
   * that is mentioned in the bug report. (Not supported here.)
   *
   * @throws IllegalArgumentException if {@link #UNMAP_SUPPORTED} is <code>false</code> and the workaround cannot be enabled.
   */
  setUseUnmap(useUnmapHack: boolean): void {
    if (useUnmapHack && !MMapDirectory.UNMAP_SUPPORTED) throw new IllegalArgumentException("Unmap hack not supported on this platform!");
    this.useUnmapHack = useUnmapHack;
  }

  /** Returns <code>true</code>, if the unmap workaround is enabled. */
  getUseUnmap(): boolean {
    return this.useUnmapHack;
  }

  /** Returns the current mmap chunk size. */
  // Java: final
  getMaxChunkSize(): number {
    return 2 ** this.chunkSizePower;
  }

  /** Creates an IndexInput for the file with the given name. */
  override openInput(name: string, _context: IOContext): IndexInput {
    this.ensureOpen();
    const path = resolvePath(this.directory, name);
    const c = FileChannel.open(path, "READ");
    return tryWithResource(c, () => {
      const resourceDescription = 'MMapIndexInput(path="' + path + '")';
      const useUnmap = this.getUseUnmap();
      return ByteBufferIndexInput.newInstance(
        resourceDescription,
        this.map(resourceDescription, c, 0, c.size()),
        c.size(),
        this.chunkSizePower,
        null, // useUnmap ? CLEANER : null; unmapping is not supported
        useUnmap,
      );
    });
  }

  /** Maps a file into a set of buffers */
  map(resourceDescription: string, fc: FileChannel, offset: number, length: number): ByteBuffer[] {
    if (Math.floor(length / 2 ** this.chunkSizePower) >= 2147483647) {
      throw new IllegalArgumentException("RandomAccessFile too big for chunk size: " + resourceDescription);
    }

    const chunkSize = 2 ** this.chunkSizePower;

    // we always allocate one more buffer, the last one may be a 0 byte one
    const nrBuffers = Math.floor(length / chunkSize) + 1;

    const buffers: ByteBuffer[] = new Array(nrBuffers);

    let bufferStart = 0;
    for (let bufNr = 0; bufNr < nrBuffers; bufNr++) {
      const bufSize = length > bufferStart + chunkSize ? chunkSize : length - bufferStart;
      try {
        buffers[bufNr] = fc.map(offset + bufferStart, bufSize);
      } catch (ioe) {
        if (!(ioe instanceof IOException)) throw ioe;
        throw this.convertMapFailedIOException(ioe, resourceDescription, bufSize);
      }
      bufferStart += bufSize;
    }

    return buffers;
  }

  private convertMapFailedIOException(ioe: IOException, resourceDescription: string, bufSize: number): IOException {
    // (in Java an OutOfMemoryError cause gives "Map failed"; no such cause exists here)
    const originalMessage = ioe.message;
    const originalCause = (ioe as { cause?: unknown }).cause;
    let moreInfo: string;
    if (!Constants.JRE_IS_64BIT) {
      moreInfo = "MMapDirectory should only be used on 64bit platforms, because the address space on 32bit operating systems is too small. ";
    } else if (Constants.WINDOWS) {
      moreInfo = "Windows is unfortunately very limited on virtual address space. If your index size is several hundred Gigabytes, consider changing to Linux. ";
    } else if (Constants.LINUX) {
      moreInfo = "Please review 'ulimit -v', 'ulimit -m' (both should return 'unlimited'), and 'sysctl vm.max_map_count'. ";
    } else {
      moreInfo = "Please review 'ulimit -v', 'ulimit -m' (both should return 'unlimited'). ";
    }
    const newIoe = new IOException(
      `${originalMessage}: ${resourceDescription} [this may be caused by lack of enough unfragmented virtual address space ` +
        `or too restrictive virtual memory limits enforced by the operating system, ` +
        `preventing us to map a chunk of ${bufSize} bytes. ${moreInfo}More information: ` +
        `http://blog.thetaphi.de/2012/07/use-lucenes-mmapdirectory-on-64bit.html]`,
      { cause: originalCause },
    );
    newIoe.stack = ioe.stack;
    return newIoe;
  }
}
FSDirectory._impls.mmap = MMapDirectory;
FSDirectory._impls.mmapUnmapSupported = MMapDirectory.UNMAP_SUPPORTED;
