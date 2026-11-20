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

// Port of org.apache.lucene.store.SimpleFSDirectory (Lucene 5.2.1).
//
// Deviation: the channel is the FileChannel emulation of src/nio; Java's `synchronized(channel)` is a no-op.

import { EOFException, IllegalArgumentException, getMessage, IOException } from "../errors.js";
import { ByteBuffer } from "../nio/ByteBuffer.js";
import { FileChannel } from "../nio/FileChannel.js";
import { resolvePath } from "../nio/Files.js";
import { lassert } from "../util/assertions.js";
import { BufferedIndexInput } from "./BufferedIndexInput.js";
import { FSDirectory } from "./FSDirectory.js";
import { FSLockFactory } from "./FSLockFactory.js";
import type { IOContext } from "./IOContext.js";
import type { IndexInput } from "./IndexInput.js";
import type { LockFactory } from "./LockFactory.js";
import "./NativeFSLockFactory.js"; // registers the default FSLockFactory

/**
 * A straightforward implementation of {@link FSDirectory} using Files.newByteChannel(Path, java.nio.file.OpenOption...).
 * However, this class has poor concurrent performance (multiple threads will bottleneck) as it synchronizes when
 * multiple threads read from the same file. It's usually better to use {@link NIOFSDirectory} or {@link MMapDirectory}
 * instead.
 */
export class SimpleFSDirectory extends FSDirectory {
  /**
   * Create a new SimpleFSDirectory for the named location.
   *
   * @param path the path of the directory
   * @param lockFactory the lock factory to use (default: {@link FSLockFactory#getDefault()})
   */
  constructor(path: string, lockFactory: LockFactory = FSLockFactory.getDefault()) {
    super(path, lockFactory);
  }

  /** Creates an IndexInput for the file with the given name. */
  override openInput(name: string, context: IOContext): IndexInput {
    this.ensureOpen();
    const path = resolvePath(this.directory, name);
    const channel = FileChannel.open(path, "READ");
    return new SimpleFSIndexInput('SimpleFSIndexInput(path="' + path + '")', channel, context);
  }
}
FSDirectory._impls.simple = SimpleFSDirectory;

/**
 * Reads bytes with {@link SeekableByteChannel#read(ByteBuffer)}
 * @internal
 */
export class SimpleFSIndexInput extends BufferedIndexInput {
  /**
   * The maximum chunk size for reads of 16384 bytes.
   */
  private static readonly CHUNK_SIZE = 16384;

  /** the channel we will read from */
  protected readonly channel: FileChannel;
  /** is this instance a clone and hence does not own the file to close it */
  isClone = false;
  /** start offset: non-zero in the slice case */
  protected readonly off: number;
  /** end offset (start+length) */
  protected readonly end: number;

  private byteBuf: ByteBuffer | null = null; // wraps the buffer for NIO

  /** Java: (resourceDesc, channel, context) and the slice constructor (resourceDesc, channel, off, length, bufferSize) */
  constructor(resourceDesc: string, channel: FileChannel, context: IOContext);
  constructor(resourceDesc: string, channel: FileChannel, off: number, length: number, bufferSize: number);
  constructor(resourceDesc: string, channel: FileChannel, a: IOContext | number, length?: number, bufferSize?: number) {
    super(resourceDesc, typeof a === "number" ? bufferSize! : a);
    this.channel = channel;
    if (typeof a === "number") {
      this.off = a;
      this.end = a + length!;
      this.isClone = true;
    } else {
      this.off = 0;
      this.end = channel.size();
    }
  }

  override close(): void {
    // only close the file if this is not a clone
    if (!this.isClone) {
      this.channel.close();
    }
  }

  override clone(): this {
    const clone = super.clone();
    clone.isClone = true;
    return clone;
  }

  override slice(sliceDescription: string | null, offset: number, length: number): IndexInput {
    if (offset < 0 || length < 0 || offset + length > this.length()) {
      throw new IllegalArgumentException("slice() " + sliceDescription + " out of bounds: " + this.toString());
    }
    return new SimpleFSIndexInput(this.getFullSliceDescription(sliceDescription), this.channel, this.off + offset, length, this.getBufferSize());
  }

  override length(): number {
    return this.end - this.off;
  }

  protected override newBuffer(newBuffer: Uint8Array): void {
    super.newBuffer(newBuffer);
    this.byteBuf = ByteBuffer.wrap(newBuffer);
  }

  protected override readInternal(b: Uint8Array, offset: number, len: number): void {
    let bb: ByteBuffer;

    // Determine the ByteBuffer we should use
    if (b === this.buffer) {
      // Use our own pre-wrapped byteBuf:
      lassert(() => this.byteBuf !== null);
      bb = this.byteBuf!;
      bb.clear().position(offset);
    } else {
      bb = ByteBuffer.wrap(b, offset, len);
    }

    // synchronized(channel) in Java
    let pos = this.getFilePointer() + this.off;

    if (pos + len > this.end) {
      throw new EOFException("read past EOF: " + this.toString());
    }

    try {
      this.channel.position(pos);

      let readLength = len;
      while (readLength > 0) {
        const toRead = Math.min(SimpleFSIndexInput.CHUNK_SIZE, readLength);
        bb.limit(bb.position() + toRead);
        lassert(() => bb.remaining() === toRead);
        const i = this.channel.read(bb);
        if (i < 0) {
          // be defensive here, even though we checked before hand, something could have changed
          throw new EOFException(
            "read past EOF: " + this.toString() + " off: " + offset + " len: " + len + " pos: " + pos + " chunkLen: " + toRead + " end: " + this.end);
        }
        lassert(() => i > 0, "SeekableByteChannel.read with non zero-length bb.remaining() must always read at least one byte (Channel is in blocking mode, see spec of ReadableByteChannel)");
        pos += i;
        readLength -= i;
      }
      lassert(() => readLength === 0);
    } catch (ioe) {
      if (!(ioe instanceof IOException)) throw ioe;
      throw new IOException(getMessage(ioe) + ": " + this.toString(), { cause: ioe });
    }
  }

  protected override seekInternal(_pos: number): void {}
}
