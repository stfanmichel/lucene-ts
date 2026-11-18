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

// Port of org.apache.lucene.store.RAMInputStream (Lucene 5.2.1).
// The anonymous slice subclass is a local class; clone() is DataInput's shallow field copy.

import { ArrayIndexOutOfBoundsException, EOFException, IllegalArgumentException, IOException, NullPointerException } from "../errors.js";
import { arraycopy } from "../util/JavaObjects.js";
import { IndexInput } from "./IndexInput.js";
import type { RAMFile } from "./RAMFile.js";
import { RAMOutputStream } from "./RAMOutputStream.js";

/**
 * A memory-resident {@link IndexInput} implementation.
 *
 * @lucene.internal
 */
export class RAMInputStream extends IndexInput {
  /** @internal */
  static readonly BUFFER_SIZE = RAMOutputStream.BUFFER_SIZE;

  private readonly file: RAMFile;
  private readonly _length: number;

  private currentBuffer: Uint8Array | null;
  private currentBufferIndex: number;

  private bufferPosition = 0;
  private bufferStart = 0;
  private bufferLength = 0;

  // Java: public RAMInputStream(String name, RAMFile f) and package-private (name, f, length)
  constructor(name: string, f: RAMFile, length: number = f.length) {
    super("RAMInputStream(name=" + name + ")");
    this.file = f;
    this._length = length;
    if (Math.trunc(length / RAMInputStream.BUFFER_SIZE) >= 2147483647) {
      throw new IOException("RAMInputStream too large length=" + length + ": " + name);
    }

    // make sure that we switch to the
    // first needed buffer lazily
    this.currentBufferIndex = -1;
    this.currentBuffer = null;
  }

  close(): void {
    // nothing to do here
  }

  length(): number {
    return this._length;
  }

  readByte(): number {
    if (this.bufferPosition >= this.bufferLength) {
      this.currentBufferIndex++;
      this.switchCurrentBuffer(true);
    }
    // currentBuffer[bufferPosition++]: the position advances even when the access fails (negative positions
    // can only come from seek(negative) on a stream that is not a slice)
    const pos = this.bufferPosition++;
    const buf = this.currentBuffer;
    if (buf === null) throw new NullPointerException('Cannot load from byte/boolean array because "this.currentBuffer" is null');
    const v = buf[pos];
    if (v === undefined) throw new ArrayIndexOutOfBoundsException("Index " + pos + " out of bounds for length " + buf.length);
    return v;
  }

  readBytes(b: Uint8Array, offset: number, len: number): void {
    while (len > 0) {
      if (this.bufferPosition >= this.bufferLength) {
        this.currentBufferIndex++;
        this.switchCurrentBuffer(true);
      }

      const remainInBuffer = this.bufferLength - this.bufferPosition;
      const bytesToCopy = len < remainInBuffer ? len : remainInBuffer;
      if (this.currentBuffer === null) throw new NullPointerException('Cannot read the array length because "src" is null');
      arraycopy(this.currentBuffer, this.bufferPosition, b, offset, bytesToCopy);
      offset += bytesToCopy;
      len -= bytesToCopy;
      this.bufferPosition += bytesToCopy;
    }
  }

  private switchCurrentBuffer(enforceEOF: boolean): void {
    this.bufferStart = RAMInputStream.BUFFER_SIZE * this.currentBufferIndex;
    if (this.bufferStart > this._length || this.currentBufferIndex >= this.file.numBuffers()) {
      // end of file reached, no more buffers left
      if (enforceEOF) {
        throw new EOFException("read past EOF: " + this.toString());
      } else {
        // Force EOF if a read takes place at this position
        this.currentBufferIndex--;
        this.bufferPosition = RAMInputStream.BUFFER_SIZE;
      }
    } else {
      this.currentBuffer = this.file.getBuffer(this.currentBufferIndex);
      this.bufferPosition = 0;
      const buflen = this._length - this.bufferStart;
      this.bufferLength = buflen > RAMInputStream.BUFFER_SIZE ? RAMInputStream.BUFFER_SIZE : buflen | 0;
    }
  }

  getFilePointer(): number {
    return this.currentBufferIndex < 0 ? 0 : this.bufferStart + this.bufferPosition;
  }

  seek(pos: number): void {
    if (this.currentBuffer === null || pos < this.bufferStart || pos >= this.bufferStart + RAMInputStream.BUFFER_SIZE) {
      this.currentBufferIndex = Math.trunc(pos / RAMInputStream.BUFFER_SIZE) | 0;
      this.switchCurrentBuffer(false);
    }
    this.bufferPosition = (pos % RAMInputStream.BUFFER_SIZE) | 0;
  }

  slice(sliceDescription: string | null, offset: number, length: number): IndexInput {
    if (offset < 0 || length < 0 || offset + length > this._length) {
      throw new IllegalArgumentException("slice() " + sliceDescription + " out of bounds: " + this.toString());
    }

    // (anonymous subclass in Java)
    class RAMInputStreamSlice extends RAMInputStream {
      constructor(name: string, f: RAMFile, len: number) {
        super(name, f, len);
        this.seek(0);
      }

      override seek(pos: number): void {
        if (pos < 0) {
          throw new IllegalArgumentException("Seeking to negative position: " + this.toString());
        }
        super.seek(pos + offset);
      }

      override getFilePointer(): number {
        return super.getFilePointer() - offset;
      }

      override length(): number {
        return super.length() - offset;
      }

      override slice(sliceDescription: string | null, ofs: number, len: number): IndexInput {
        return super.slice(sliceDescription, offset + ofs, len);
      }
    }
    return new RAMInputStreamSlice(this.getFullSliceDescription(sliceDescription), this.file, offset + length);
  }
}
