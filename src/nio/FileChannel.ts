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

// Synchronous emulation of java.nio.channels.FileChannel (also standing in for the SeekableByteChannel that
// Files.newByteChannel returns on UNIX) on top of node:fs file descriptors.
//
// Deviations:
//  - tryLock() only excludes other channels of THIS process (the JVM also does that, through its file lock
//    table: OverlappingFileLockException); Node has no flock/fcntl, so the lock is not visible to other
//    processes.
//  - map(READ_ONLY, …) cannot map memory: it returns a snapshot copy of the file region in a heap buffer.

import * as fs from "node:fs";
import {
  ClosedChannelException,
  IllegalArgumentException,
  IOException,
  OverlappingFileLockException,
} from "../errors.js";
import { ByteBuffer } from "./ByteBuffer.js";
import { errorString, translateToIOException } from "./Files.js";

/** StandardOpenOption values FileChannel.open understands here */
export type OpenOption = "READ" | "WRITE" | "CREATE";

/** java.nio.channels.FileLock (exclusive lock held by a channel) */
export class FileLock {
  private valid = true;
  private readonly channel: FileChannel;
  private readonly key: string;
  /** @internal */
  constructor(channel: FileChannel, key: string) {
    this.channel = channel;
    this.key = key;
  }
  isValid(): boolean {
    return this.valid && this.channel.isOpen();
  }
  release(): void {
    if (!this.channel.isOpen()) throw new ClosedChannelException();
    this._invalidate();
  }
  /** @internal */
  _invalidate(): void {
    if (this.valid) {
      this.valid = false;
      FileChannel._heldLocks.delete(this.key);
    }
  }
}

export class FileChannel {
  /** @internal files (dev:ino) locked in this process */
  static readonly _heldLocks = new Set<string>();

  private fd: number | null;
  private pos = 0;
  private lock: FileLock | null = null;

  private constructor(fd: number) {
    this.fd = fd;
  }

  /** FileChannel.open(path, options...) / Files.newByteChannel(path, options...) */
  static open(path: string, ...options: OpenOption[]): FileChannel {
    const read = options.includes("READ");
    const write = options.includes("WRITE");
    const create = options.includes("CREATE");
    let flags: number;
    if (write) flags = (read ? fs.constants.O_RDWR : fs.constants.O_WRONLY) | (create ? fs.constants.O_CREAT : 0);
    else flags = fs.constants.O_RDONLY;
    try {
      return new FileChannel(fs.openSync(path, flags, 0o666));
    } catch (e) {
      throw translateToIOException(e, path);
    }
  }

  private ensureOpenFd(): number {
    if (this.fd === null) throw new ClosedChannelException();
    return this.fd;
  }

  isOpen(): boolean {
    return this.fd !== null;
  }

  /** size() */
  size(): number {
    const fd = this.ensureOpenFd();
    try {
      return fs.fstatSync(fd).size;
    } catch (e) {
      throw new IOException(errorString(e));
    }
  }

  /** position() */
  position(): number;
  /** position(long): returns this */
  position(newPosition: number): this;
  position(newPosition?: number): number | this {
    this.ensureOpenFd();
    if (newPosition === undefined) return this.pos;
    if (newPosition < 0) throw new IllegalArgumentException();
    this.pos = newPosition;
    return this;
  }

  /**
   * read(dst) at the channel position (advancing it), or read(dst, position) at an absolute position
   * (leaving the channel position alone). Fills dst from its position, up to its limit; returns the number
   * of bytes read, or -1 at end of file.
   */
  read(dst: ByteBuffer, position?: number): number {
    // FileChannelImpl.read(dst, position) checks the position before the channel is open
    if (position !== undefined && position < 0) throw new IllegalArgumentException("Negative position");
    const fd = this.ensureOpenFd();
    const n = dst.remaining();
    if (n === 0) return 0;
    const at = position ?? this.pos;
    let got: number;
    try {
      got = fs.readSync(fd, dst._array(), dst._arrayOffset() + dst.position(), n, at);
    } catch (e) {
      throw new IOException(errorString(e));
    }
    if (got === 0) return -1;
    dst._advance(got);
    if (position === undefined) this.pos += got;
    return got;
  }

  /** force(metaData): fsync */
  force(_metaData: boolean): void {
    const fd = this.ensureOpenFd();
    try {
      fs.fsyncSync(fd);
    } catch (e) {
      throw new IOException(errorString(e));
    }
  }

  /** tryLock(): an exclusive lock on the whole file, or null if it cannot be had (see the file header) */
  tryLock(): FileLock | null {
    const fd = this.ensureOpenFd();
    const st = fs.fstatSync(fd);
    const key = st.dev + ":" + st.ino;
    if (FileChannel._heldLocks.has(key)) throw new OverlappingFileLockException();
    FileChannel._heldLocks.add(key);
    this.lock = new FileLock(this, key);
    return this.lock;
  }

  /** map(READ_ONLY, position, size): a snapshot copy of the region (see the file header) */
  map(position: number, size: number): ByteBuffer {
    const fd = this.ensureOpenFd();
    if (position < 0) throw new IllegalArgumentException("Negative position");
    if (size < 0) throw new IllegalArgumentException("Negative size");
    const data = new Uint8Array(size);
    let done = 0;
    try {
      // mmap(2) of a directory fails with ENODEV; a zero-size mapping never calls mmap
      if (size > 0 && fs.fstatSync(fd).isDirectory()) throw Object.assign(new Error("ENODEV"), { code: "ENODEV" });
      while (done < size) {
        const n = fs.readSync(fd, data, done, size - done, position + done);
        if (n === 0) break;
        done += n;
      }
    } catch (e) {
      throw new IOException(errorString(e));
    }
    return ByteBuffer.wrap(data);
  }

  /** close(): idempotent; releases the channel's lock */
  close(): void {
    if (this.fd === null) return;
    const fd = this.fd;
    this.fd = null;
    if (this.lock !== null) this.lock._invalidate();
    try {
      fs.closeSync(fd);
    } catch (e) {
      throw new IOException(errorString(e));
    }
  }
}
