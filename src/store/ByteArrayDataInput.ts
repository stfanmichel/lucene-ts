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

// Port of org.apache.lucene.store.ByteArrayDataInput (Lucene 5.2.1).
// Like Java, reading past the end of the array is an ArrayIndexOutOfBoundsException (not an EOFException);
// the position has already advanced when it is thrown, as with Java's `bytes[pos++]`.

import { ArrayIndexOutOfBoundsException, RuntimeException } from "../errors.js";
import { BytesRef } from "../util/BytesRef.js";
import { DataInput } from "./DataInput.js";

/**
 * DataInput backed by a byte array.
 * <b>WARNING:</b> This class omits all low-level checks.
 * @lucene.experimental
 */
export class ByteArrayDataInput extends DataInput {
  private bytes: Uint8Array = BytesRef.EMPTY_BYTES;
  private pos = 0;
  private limit = 0;

  constructor(bytes?: Uint8Array, offset?: number, len?: number) {
    super();
    if (bytes === undefined) {
      this.reset(BytesRef.EMPTY_BYTES);
    } else if (offset === undefined) {
      this.reset(bytes);
    } else {
      this.reset(bytes, offset, len!);
    }
  }

  reset(bytes: Uint8Array, offset?: number, len?: number): void {
    if (offset === undefined) {
      offset = 0;
      len = bytes.length;
    }
    this.bytes = bytes;
    this.pos = offset;
    this.limit = offset + len!;
  }

  // NOTE: sets pos to 0, which is not right if you had
  // called reset w/ non-zero offset!!
  rewind(): void {
    this.pos = 0;
  }

  getPosition(): number {
    return this.pos;
  }

  setPosition(pos: number): void {
    this.pos = pos;
  }

  length(): number {
    return this.limit;
  }

  eof(): boolean {
    return this.pos === this.limit;
  }

  override skipBytes(count: number): void {
    this.pos += count;
  }

  /** Java's `bytes[pos++]` as an unsigned value, with its bounds check. */
  private next(): number {
    const p = this.pos++;
    if (p < 0 || p >= this.bytes.length) {
      throw new ArrayIndexOutOfBoundsException("Index " + p + " out of bounds for length " + this.bytes.length);
    }
    return this.bytes[p];
  }

  override readShort(): number {
    const hi = this.next();
    const lo = this.next();
    return ((hi << 8) | lo) << 16 >> 16;
  }

  override readInt(): number {
    const b1 = this.next();
    const b2 = this.next();
    const b3 = this.next();
    const b4 = this.next();
    return (b1 << 24) | (b2 << 16) | (b3 << 8) | b4;
  }

  override readLong(): bigint {
    const i1 = this.readInt();
    const i2 = this.readInt();
    return BigInt.asIntN(64, (BigInt(i1) << 32n) | BigInt(i2 >>> 0));
  }

  override readVInt(): number {
    let b = this.next();
    if (b < 0x80) return b;
    let i = b & 0x7f;
    b = this.next();
    i |= (b & 0x7f) << 7;
    if (b < 0x80) return i;
    b = this.next();
    i |= (b & 0x7f) << 14;
    if (b < 0x80) return i;
    b = this.next();
    i |= (b & 0x7f) << 21;
    if (b < 0x80) return i;
    b = this.next();
    // Warning: the next ands use 0x0F / 0xF0 - beware copy/paste errors:
    i |= (b & 0x0f) << 28;
    if ((b & 0xf0) === 0) return i;
    throw new RuntimeException("Invalid vInt detected (too many bits)");
  }

  override readVLong(): bigint {
    // Up to 7 bytes = 49 bits fit exactly in a double; only the longer values need bigint.
    let b = this.next();
    if (b < 0x80) return BigInt(b);
    let lo = b & 0x7f;
    let scale = 128;
    for (let n = 1; n < 7; n++) {
      b = this.next();
      lo += (b & 0x7f) * scale;
      if (b < 0x80) return BigInt(lo);
      scale *= 128;
    }
    let i = BigInt(lo);
    b = this.next();
    i |= BigInt(b & 0x7f) << 49n;
    if (b < 0x80) return i;
    b = this.next();
    i |= BigInt(b & 0x7f) << 56n;
    if (b < 0x80) return i;
    throw new RuntimeException("Invalid vLong detected (negative values disallowed)");
  }

  // NOTE: AIOOBE not EOF if you read too much
  readByte(): number {
    return this.next();
  }

  // NOTE: AIOOBE not EOF if you read too much
  readBytes(b: Uint8Array, offset: number, len: number): void {
    // System.arraycopy
    if (
      len < 0 || offset < 0 || this.pos < 0 ||
      offset + len > b.length || this.pos + len > this.bytes.length
    ) {
      throw new ArrayIndexOutOfBoundsException("arraycopy: last source index " + (this.pos + len) +
        " out of bounds for byte[" + this.bytes.length + "]");
    }
    b.set(this.bytes.subarray(this.pos, this.pos + len), offset);
    this.pos += len;
  }
}
