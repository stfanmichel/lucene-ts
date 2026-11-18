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

// Port of org.apache.lucene.store.BufferedIndexInput (Lucene 5.2.1).
//
// readByte/readShort/readInt/readLong exist twice in Java (relative: DataInput's, absolute: RandomAccessInput's);
// here each is one overloaded method, the absolute form being selected by the presence of the `pos` argument.

import { EOFException, IllegalArgumentException, IOException } from "../errors.js";
import { lassert } from "../util/assertions.js";
import { Context, type IOContext } from "./IOContext.js";
import { IndexInput } from "./IndexInput.js";
import type { IndexOutput } from "./IndexOutput.js";
import { RANDOM_ACCESS_INPUT, type RandomAccessInput } from "./RandomAccessInput.js";

/** Base implementation class for buffered {@link IndexInput}. */
export abstract class BufferedIndexInput extends IndexInput implements RandomAccessInput {
  /** Default buffer size set to 1024. */
  static readonly BUFFER_SIZE = 1024;

  /** Minimum buffer size allowed */
  static readonly MIN_BUFFER_SIZE = 8;

  // The normal read buffer size defaults to 1024, but
  // increasing this during merging seems to yield
  // performance gains.  However we don't want to increase
  // it too much because there are quite a few
  // BufferedIndexInputs created during merging.  See
  // LUCENE-888 for details.
  /**
   * A buffer size for merges set to 4096.
   */
  static readonly MERGE_BUFFER_SIZE = 4096;

  private bufferSize: number = BufferedIndexInput.BUFFER_SIZE;

  protected buffer: Uint8Array | null = null;

  private bufferStart = 0; // position in file of buffer
  private bufferLength = 0; // end of valid bytes
  private bufferPosition = 0; // next byte to read

  get [RANDOM_ACCESS_INPUT](): true {
    return true;
  }

  /** Creates a BufferedIndexInput with the default buffer size, one for `context`, or a specific bufferSize */
  constructor(resourceDesc: string, bufferSizeOrContext?: number | IOContext) {
    super(resourceDesc);
    const bufferSize =
      bufferSizeOrContext === undefined
        ? BufferedIndexInput.BUFFER_SIZE
        : typeof bufferSizeOrContext === "number"
          ? bufferSizeOrContext
          : BufferedIndexInput.bufferSize(bufferSizeOrContext);
    this.checkBufferSize(bufferSize);
    this.bufferSize = bufferSize;
  }

  readByte(): number;
  /** Absolute read (RandomAccessInput) */
  readByte(pos: number): number;
  readByte(pos?: number): number {
    if (pos !== undefined) return this.readByteAt(pos);
    if (this.bufferPosition >= this.bufferLength) this.refill();
    return this.buffer![this.bufferPosition++];
  }

  /** Change the buffer size used by this IndexInput */
  setBufferSize(newSize: number): void {
    lassert(
      () => this.buffer === null || this.bufferSize === this.buffer.length,
      "buffer=" + this.buffer + " bufferSize=" + this.bufferSize + " buffer.length=" + (this.buffer !== null ? this.buffer.length : 0),
    );
    if (newSize !== this.bufferSize) {
      this.checkBufferSize(newSize);
      this.bufferSize = newSize;
      if (this.buffer !== null) {
        // Resize the existing buffer and carefully save as
        // many bytes as possible starting from the current
        // bufferPosition
        const newBuffer = new Uint8Array(newSize);
        const leftInBuffer = this.bufferLength - this.bufferPosition;
        let numToCopy: number;
        if (leftInBuffer > newSize) numToCopy = newSize;
        else numToCopy = leftInBuffer;
        newBuffer.set(this.buffer.subarray(this.bufferPosition, this.bufferPosition + numToCopy), 0);
        this.bufferStart += this.bufferPosition;
        this.bufferPosition = 0;
        this.bufferLength = numToCopy;
        this.newBuffer(newBuffer);
      }
    }
  }

  protected newBuffer(newBuffer: Uint8Array): void {
    // Subclasses can do something here
    this.buffer = newBuffer;
  }

  /** Returns buffer size.  @see setBufferSize */
  getBufferSize(): number {
    return this.bufferSize;
  }

  private checkBufferSize(bufferSize: number): void {
    if (bufferSize < BufferedIndexInput.MIN_BUFFER_SIZE) {
      throw new IllegalArgumentException(
        "bufferSize must be at least MIN_BUFFER_SIZE (got " + bufferSize + ")",
      );
    }
  }

  readBytes(b: Uint8Array, offset: number, len: number, useBuffer: boolean = true): void {
    const available = this.bufferLength - this.bufferPosition;
    if (len <= available) {
      // the buffer contains enough data to satisfy this request
      if (len > 0) {
        // to allow b to be null if len is 0...
        b.set(this.buffer!.subarray(this.bufferPosition, this.bufferPosition + len), offset);
      }
      this.bufferPosition += len;
    } else {
      // the buffer does not have enough data. First serve all we've got.
      if (available > 0) {
        b.set(this.buffer!.subarray(this.bufferPosition, this.bufferPosition + available), offset);
        offset += available;
        len -= available;
        this.bufferPosition += available;
      }
      // and now, read the remaining 'len' bytes:
      if (useBuffer && len < this.bufferSize) {
        // If the amount left to read is small enough, and
        // we are allowed to use our buffer, do it in the usual
        // buffered way: fill the buffer and copy from it:
        this.refill();
        if (this.bufferLength < len) {
          // Throw an exception when refill() could not read len bytes:
          b.set(this.buffer!.subarray(0, this.bufferLength), offset);
          throw new EOFException("read past EOF: " + this);
        } else {
          b.set(this.buffer!.subarray(0, len), offset);
          this.bufferPosition = len;
        }
      } else {
        // The amount left to read is larger than the buffer
        // or we've been asked to not use our buffer -
        // there's no performance reason not to read it all
        // at once. Note that unlike the previous code of
        // this function, there is no need to do a seek
        // here, because there's no need to reread what we
        // had in the buffer.
        const after = this.bufferStart + this.bufferPosition + len;
        if (after > this.length()) throw new EOFException("read past EOF: " + this);
        this.readInternal(b, offset, len);
        this.bufferStart = after;
        this.bufferPosition = 0;
        this.bufferLength = 0; // trigger refill() on read
      }
    }
  }

  override readShort(): number;
  /** Absolute read (RandomAccessInput) */
  override readShort(pos: number): number;
  override readShort(pos?: number): number {
    if (pos !== undefined) return this.readShortAt(pos);
    if (2 <= this.bufferLength - this.bufferPosition) {
      const buffer = this.buffer!;
      const hi = buffer[this.bufferPosition++];
      const lo = buffer[this.bufferPosition++];
      return ((hi << 8) | lo) << 16 >> 16;
    } else {
      return super.readShort();
    }
  }

  override readInt(): number;
  /** Absolute read (RandomAccessInput) */
  override readInt(pos: number): number;
  override readInt(pos?: number): number {
    if (pos !== undefined) return this.readIntAt(pos);
    if (4 <= this.bufferLength - this.bufferPosition) {
      const buffer = this.buffer!;
      return (
        (buffer[this.bufferPosition++] << 24) | (buffer[this.bufferPosition++] << 16) |
        (buffer[this.bufferPosition++] << 8) | buffer[this.bufferPosition++]
      );
    } else {
      return super.readInt();
    }
  }

  override readLong(): bigint;
  /** Absolute read (RandomAccessInput) */
  override readLong(pos: number): bigint;
  override readLong(pos?: number): bigint {
    if (pos !== undefined) return this.readLongAt(pos);
    if (8 <= this.bufferLength - this.bufferPosition) {
      const i1 = this.readInt();
      const i2 = this.readInt();
      return BigInt.asIntN(64, (BigInt(i1) << 32n) | BigInt(i2 >>> 0));
    } else {
      return super.readLong();
    }
  }

  override readVInt(): number {
    if (5 <= this.bufferLength - this.bufferPosition) {
      const buffer = this.buffer!;
      let b = buffer[this.bufferPosition++];
      if (b < 0x80) return b;
      let i = b & 0x7f;
      b = buffer[this.bufferPosition++];
      i |= (b & 0x7f) << 7;
      if (b < 0x80) return i;
      b = buffer[this.bufferPosition++];
      i |= (b & 0x7f) << 14;
      if (b < 0x80) return i;
      b = buffer[this.bufferPosition++];
      i |= (b & 0x7f) << 21;
      if (b < 0x80) return i;
      b = buffer[this.bufferPosition++];
      // Warning: the next ands use 0x0F / 0xF0 - beware copy/paste errors:
      i |= (b & 0x0f) << 28;
      if ((b & 0xf0) === 0) return i;
      throw new IOException("Invalid vInt detected (too many bits)");
    } else {
      return super.readVInt();
    }
  }

  override readVLong(): bigint {
    if (9 <= this.bufferLength - this.bufferPosition) {
      const buffer = this.buffer!;
      // Up to 7 bytes = 49 bits fit exactly in a double; only the longer values need bigint.
      let b = buffer[this.bufferPosition++];
      if (b < 0x80) return BigInt(b);
      let lo = b & 0x7f;
      let scale = 128;
      for (let n = 1; n < 7; n++) {
        b = buffer[this.bufferPosition++];
        lo += (b & 0x7f) * scale;
        if (b < 0x80) return BigInt(lo);
        scale *= 128;
      }
      let i = BigInt(lo);
      b = buffer[this.bufferPosition++];
      i |= BigInt(b & 0x7f) << 49n;
      if (b < 0x80) return i;
      b = buffer[this.bufferPosition++];
      i |= BigInt(b & 0x7f) << 56n;
      if (b < 0x80) return i;
      throw new IOException("Invalid vLong detected (negative values disallowed)");
    } else {
      return super.readVLong();
    }
  }

  private readByteAt(pos: number): number {
    let index = pos - this.bufferStart;
    if (index < 0 || index >= this.bufferLength) {
      this.bufferStart = pos;
      this.bufferPosition = 0;
      this.bufferLength = 0; // trigger refill() on read()
      this.seekInternal(pos);
      this.refill();
      index = 0;
    }
    return this.buffer![index];
  }

  private readShortAt(pos: number): number {
    let index = pos - this.bufferStart;
    if (index < 0 || index >= this.bufferLength - 1) {
      this.bufferStart = pos;
      this.bufferPosition = 0;
      this.bufferLength = 0; // trigger refill() on read()
      this.seekInternal(pos);
      this.refill();
      index = 0;
    }
    const buffer = this.buffer!;
    return ((buffer[index] << 8) | buffer[index + 1]) << 16 >> 16;
  }

  private readIntAt(pos: number): number {
    let index = pos - this.bufferStart;
    if (index < 0 || index >= this.bufferLength - 3) {
      this.bufferStart = pos;
      this.bufferPosition = 0;
      this.bufferLength = 0; // trigger refill() on read()
      this.seekInternal(pos);
      this.refill();
      index = 0;
    }
    const buffer = this.buffer!;
    return (buffer[index] << 24) | (buffer[index + 1] << 16) | (buffer[index + 2] << 8) | buffer[index + 3];
  }

  private readLongAt(pos: number): bigint {
    let index = pos - this.bufferStart;
    if (index < 0 || index >= this.bufferLength - 7) {
      this.bufferStart = pos;
      this.bufferPosition = 0;
      this.bufferLength = 0; // trigger refill() on read()
      this.seekInternal(pos);
      this.refill();
      index = 0;
    }
    const buffer = this.buffer!;
    const i1 = (buffer[index] << 24) | (buffer[index + 1] << 16) | (buffer[index + 2] << 8) | buffer[index + 3];
    const i2 = (buffer[index + 4] << 24) | (buffer[index + 5] << 16) | (buffer[index + 6] << 8) | buffer[index + 7];
    return BigInt.asIntN(64, (BigInt(i1) << 32n) | BigInt(i2 >>> 0));
  }

  private refill(): void {
    const start = this.bufferStart + this.bufferPosition;
    let end = start + this.bufferSize;
    if (end > this.length()) {
      // don't read past EOF
      end = this.length();
    }
    const newLength = end - start;
    if (newLength <= 0) throw new EOFException("read past EOF: " + this);

    if (this.buffer === null) {
      this.newBuffer(new Uint8Array(this.bufferSize)); // allocate buffer lazily
      this.seekInternal(this.bufferStart);
    }
    this.readInternal(this.buffer!, 0, newLength);
    this.bufferLength = newLength;
    this.bufferStart = start;
    this.bufferPosition = 0;
  }

  /**
   * Expert: implements buffer refill.  Reads bytes from the current position
   * in the input.
   * @param b the array to read bytes into
   * @param offset the offset in the array to start storing bytes
   * @param length the number of bytes to read
   */
  protected abstract readInternal(b: Uint8Array, offset: number, length: number): void;

  getFilePointer(): number {
    return this.bufferStart + this.bufferPosition;
  }

  seek(pos: number): void {
    if (pos >= this.bufferStart && pos < this.bufferStart + this.bufferLength) {
      this.bufferPosition = pos - this.bufferStart; // seek within buffer
    } else {
      this.bufferStart = pos;
      this.bufferPosition = 0;
      this.bufferLength = 0; // trigger refill() on read()
      this.seekInternal(pos);
    }
  }

  /**
   * Expert: implements seek.  Sets current position in this file, where the
   * next {@link readInternal} will occur.
   * @see readInternal
   */
  protected abstract seekInternal(pos: number): void;

  override clone(): this {
    const clone = super.clone();
    clone.buffer = null;
    clone.bufferLength = 0;
    clone.bufferPosition = 0;
    clone.bufferStart = this.getFilePointer();
    return clone;
  }

  slice(sliceDescription: string | null, offset: number, length: number): IndexInput {
    return BufferedIndexInput.wrap(sliceDescription, this, offset, length);
  }

  /**
   * Flushes the in-memory buffer to the given output, copying at most
   * <code>numBytes</code>.
   * <p>
   * <b>NOTE:</b> this method does not refill the buffer, however it does
   * advance the buffer position.
   *
   * @return the number of bytes actually flushed from the in-memory buffer.
   */
  protected flushBuffer(out: IndexOutput, numBytes: number): number {
    let toCopy = this.bufferLength - this.bufferPosition;
    if (toCopy > numBytes) {
      toCopy = numBytes;
    }
    if (toCopy > 0) {
      out.writeBytes(this.buffer!, this.bufferPosition, toCopy);
      this.bufferPosition += toCopy;
    }
    return toCopy;
  }

  /**
   * Returns default buffer sizes for the given {@link IOContext}
   */
  static bufferSize(context: IOContext): number {
    switch (context.context) {
      case Context.MERGE:
        return BufferedIndexInput.MERGE_BUFFER_SIZE;
      default:
        return BufferedIndexInput.BUFFER_SIZE;
    }
  }

  /**
   * Wraps a portion of another IndexInput with buffering.
   * <p><b>Please note:</b> This is in most cases ineffective, because it may double buffer!
   */
  static wrap(sliceDescription: string | null, other: IndexInput, offset: number, length: number): BufferedIndexInput {
    return new SlicedIndexInput(sliceDescription, other, offset, length);
  }
}

/**
 * Implementation of an IndexInput that reads from a portion of a file.
 */
class SlicedIndexInput extends BufferedIndexInput {
  base: IndexInput;
  fileOffset: number;
  private len: number;

  constructor(sliceDescription: string | null, base: IndexInput, offset: number, length: number) {
    super(
      sliceDescription === null ? base.toString() : base.toString() + " [slice=" + sliceDescription + "]",
      BufferedIndexInput.BUFFER_SIZE,
    );
    if (offset < 0 || length < 0 || offset + length > base.length()) {
      throw new IllegalArgumentException("slice() " + sliceDescription + " out of bounds: " + base);
    }
    this.base = base.clone();
    this.fileOffset = offset;
    this.len = length;
  }

  override clone(): this {
    const clone = super.clone();
    clone.base = this.base.clone();
    clone.fileOffset = this.fileOffset;
    clone.len = this.len;
    return clone;
  }

  protected readInternal(b: Uint8Array, offset: number, len: number): void {
    const start = this.getFilePointer();
    if (start + len > this.len) {
      throw new EOFException("read past EOF: " + this);
    }
    this.base.seek(this.fileOffset + start);
    this.base.readBytes(b, offset, len, false);
  }

  protected seekInternal(_pos: number): void {}

  close(): void {
    this.base.close();
  }

  override length(): number {
    return this.len;
  }
}
