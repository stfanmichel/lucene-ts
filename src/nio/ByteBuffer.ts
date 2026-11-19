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

// Minimal emulation of java.nio.ByteBuffer (big-endian, heap buffers only) with the operations
// Lucene's NIO-based directories use: wrap, clear, position, limit, remaining, hasRemaining, relative and
// absolute get/getShort/getInt/getLong, bulk get, duplicate, slice. Exception types follow the JDK
// (messages follow JDK 21: Buffer.createPositionException / createLimitException, Objects.checkIndex).
//
// A Java `long` read from a buffer holds DATA, so getLong returns a bigint.

import { BufferUnderflowException, IllegalArgumentException, IndexOutOfBoundsException } from "../errors.js";

export class ByteBuffer {
  private readonly hb: Uint8Array;
  private readonly offset: number; // arrayOffset(): where this buffer's index 0 sits in hb
  private readonly view: DataView;
  private cap: number;
  private lim: number;
  private pos = 0;

  private constructor(hb: Uint8Array, offset: number, capacity: number, limit: number, position: number) {
    this.hb = hb;
    this.offset = offset;
    this.view = new DataView(hb.buffer, hb.byteOffset, hb.byteLength);
    this.cap = capacity;
    this.lim = limit;
    this.pos = position;
  }

  /** ByteBuffer.allocate */
  static allocate(capacity: number): ByteBuffer {
    if (capacity < 0) throw new IllegalArgumentException("capacity < 0: (" + capacity + " < 0)");
    return new ByteBuffer(new Uint8Array(capacity), 0, capacity, capacity, 0);
  }

  /** ByteBuffer.wrap(array) and ByteBuffer.wrap(array, offset, length) */
  static wrap(array: Uint8Array, offset?: number, length?: number): ByteBuffer {
    if (offset === undefined) return new ByteBuffer(array, 0, array.length, array.length, 0);
    const len = length!;
    if ((offset | len | (offset + len) | (array.length - (offset + len))) < 0) {
      throw new IndexOutOfBoundsException();
    }
    // position = offset, limit = offset + length, capacity = array.length
    return new ByteBuffer(array, 0, array.length, offset + len, offset);
  }

  capacity(): number {
    return this.cap;
  }

  /** Buffer.position() */
  position(): number;
  /** Buffer.position(int): returns this */
  position(newPosition: number): this;
  position(newPosition?: number): number | this {
    if (newPosition === undefined) return this.pos;
    if (newPosition > this.lim || newPosition < 0) {
      throw new IllegalArgumentException(
        newPosition > this.lim
          ? "newPosition > limit: (" + newPosition + " > " + this.lim + ")"
          : "newPosition < 0: (" + newPosition + " < 0)");
    }
    this.pos = newPosition;
    return this;
  }

  /** Buffer.limit() */
  limit(): number;
  /** Buffer.limit(int): returns this */
  limit(newLimit: number): this;
  limit(newLimit?: number): number | this {
    if (newLimit === undefined) return this.lim;
    if (newLimit > this.cap || newLimit < 0) {
      throw new IllegalArgumentException(
        newLimit > this.cap
          ? "newLimit > capacity: (" + newLimit + " > " + this.cap + ")"
          : "newLimit < 0: (" + newLimit + " < 0)");
    }
    this.lim = newLimit;
    if (this.pos > newLimit) this.pos = newLimit;
    return this;
  }

  /** Buffer.clear(): position 0, limit = capacity */
  clear(): this {
    this.pos = 0;
    this.lim = this.cap;
    return this;
  }

  remaining(): number {
    const rem = this.lim - this.pos;
    return rem > 0 ? rem : 0;
  }

  hasRemaining(): boolean {
    return this.pos < this.lim;
  }

  private nextGetIndex(nb: number): number {
    const p = this.pos;
    if (this.lim - p < nb) throw new BufferUnderflowException();
    this.pos = p + nb;
    return p;
  }

  private checkIndex(i: number, nb: number): number {
    if (i < 0 || nb > this.lim - i) {
      // JDK 21: get(int) uses Objects.checkIndex (with message), the multi-byte forms throw a bare exception
      throw new IndexOutOfBoundsException(nb === 1 ? "Index " + i + " out of bounds for length " + this.lim : undefined);
    }
    return i;
  }

  /** get(): the next byte as 0..255 (Java returns a signed byte) */
  get(): number;
  /** get(int index): the byte at index as 0..255 */
  get(index: number): number;
  /** get(byte[] dst, int offset, int length): bulk relative read, returns this */
  get(dst: Uint8Array, offset: number, length: number): this;
  get(a?: number | Uint8Array, offset?: number, length?: number): number | this {
    if (a === undefined) {
      return this.hb[this.offset + this.nextGetIndex(1)]!;
    }
    if (typeof a === "number") {
      return this.hb[this.offset + this.checkIndex(a, 1)]!;
    }
    const off = offset!;
    const len = length!;
    if ((off | len) < 0 || len > a.length - off) {
      throw new IndexOutOfBoundsException("Range [" + off + ", " + off + " + " + len + ") out of bounds for length " + a.length);
    }
    if (len > this.remaining()) throw new BufferUnderflowException();
    const start = this.offset + this.pos;
    a.set(this.hb.subarray(start, start + len), off);
    this.pos += len;
    return this;
  }

  getShort(index?: number): number {
    const i = index === undefined ? this.offset + this.nextGetIndex(2) : this.offset + this.checkIndex(index, 2);
    return this.view.getInt16(i, false);
  }

  getInt(index?: number): number {
    const i = index === undefined ? this.offset + this.nextGetIndex(4) : this.offset + this.checkIndex(index, 4);
    return this.view.getInt32(i, false);
  }

  getLong(index?: number): bigint {
    const i = index === undefined ? this.offset + this.nextGetIndex(8) : this.offset + this.checkIndex(index, 8);
    return this.view.getBigInt64(i, false);
  }

  /** duplicate(): shares the content, independent position/limit, same initial values */
  duplicate(): ByteBuffer {
    return new ByteBuffer(this.hb, this.offset, this.cap, this.lim, this.pos);
  }

  /** slice(): shares the content from position to limit; the new buffer has position 0 */
  slice(): ByteBuffer {
    const rem = this.remaining();
    return new ByteBuffer(this.hb, this.offset + this.pos, rem, rem, 0);
  }

  /** The backing array and offset, for channel reads (hb + arrayOffset()). */
  /** @internal */
  _array(): Uint8Array {
    return this.hb;
  }
  /** @internal */
  _arrayOffset(): number {
    return this.offset;
  }
  /** @internal: advance position after a channel wrote n bytes at position() */
  _advance(n: number): void {
    this.pos += n;
  }
}
