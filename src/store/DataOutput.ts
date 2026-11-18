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

// Port of org.apache.lucene.store.DataOutput (Lucene 5.2.1). See DataInput.ts for the conventions.
//
// Deviation: Java's two-argument writeBytes(byte[] b, int length) is not provided, because it cannot be
// told apart from the abstract three-argument writeBytes(b, offset, length) that subclasses implement.
// Write writeBytes(b, 0, length) instead.

import type { DataInput } from "./DataInput.js";
import { lassert } from "../util/assertions.js";
import { BitUtil } from "../util/BitUtil.js";
import { BytesRef } from "../util/BytesRef.js";

/**
 * Abstract base class for performing write operations of Lucene's low-level
 * data types.
 *
 * <p>{@code DataOutput} may only be used from one thread, because it is not
 * thread safe (it keeps internal state like file position).
 */
export abstract class DataOutput {
  private static COPY_BUFFER_SIZE = 16384;
  private copyBuffer: Uint8Array | null = null;

  /**
   * Writes a single byte (only the low 8 bits of `b` are used).
   * <p>
   * The most primitive data type is an eight-bit byte. Files are
   * accessed as sequences of bytes. All other data types are defined
   * as sequences of bytes, so file formats are byte-order independent.
   *
   * @see DataInput.readByte
   */
  abstract writeByte(b: number): void;

  /**
   * Writes an array of bytes.
   * @param b the bytes to write
   * @param offset the offset in the byte array
   * @param length the number of bytes to write
   * @see DataInput.readBytes
   */
  abstract writeBytes(b: Uint8Array, offset: number, length: number): void;

  /**
   * Writes an int as four bytes.
   * <p>
   * 32-bit unsigned integer written as four bytes, high-order bytes first.
   *
   * @see DataInput.readInt
   */
  writeInt(i: number): void {
    this.writeByte((i >> 24) & 0xff);
    this.writeByte((i >> 16) & 0xff);
    this.writeByte((i >> 8) & 0xff);
    this.writeByte(i & 0xff);
  }

  /**
   * Writes a short as two bytes.
   * @see DataInput.readShort
   */
  writeShort(i: number): void {
    this.writeByte((i >> 8) & 0xff);
    this.writeByte(i & 0xff);
  }

  /**
   * Writes an int in a variable-length format.  Writes between one and
   * five bytes.  Smaller values take fewer bytes.  Negative numbers are
   * supported, but should be avoided.
   * <p>VByte is a variable-length format for positive integers is defined where the
   * high-order bit of each byte indicates whether more bytes remain to be read. The
   * low-order seven bits are appended as increasingly more significant bits in the
   * resulting integer value. Thus values from zero to 127 may be stored in a single
   * byte, values from 128 to 16,383 may be stored in two bytes, and so on.</p>
   *
   * @see DataInput.readVInt
   */
  writeVInt(i: number): void {
    while ((i & ~0x7f) !== 0) {
      this.writeByte((i & 0x7f) | 0x80);
      i >>>= 7;
    }
    this.writeByte(i & 0xff);
  }

  /**
   * Write a {@link BitUtil.zigZagEncode zigzag}-encoded variable-length integer. This is
   * typically useful to write small signed ints and is equivalent to calling
   * <code>writeVInt(BitUtil.zigZagEncode(i))</code>.
   * @see DataInput.readZInt
   */
  writeZInt(i: number): void {
    this.writeVInt(BitUtil.zigZagEncode(i));
  }

  /**
   * Writes a long as eight bytes.
   * <p>
   * 64-bit unsigned integer written as eight bytes, high-order bytes first.
   *
   * @see DataInput.readLong
   */
  writeLong(i: bigint): void {
    this.writeInt(Number(BigInt.asIntN(32, i >> 32n)));
    this.writeInt(Number(BigInt.asIntN(32, i)));
  }

  /**
   * Writes an long in a variable-length format.  Writes between one and nine
   * bytes.  Smaller values take fewer bytes.  Negative numbers are not
   * supported.
   * <p>
   * The format is described further in {@link DataOutput.writeVInt}.
   *
   * @see DataInput.readVLong
   */
  writeVLong(i: bigint): void {
    lassert(() => i >= 0n);
    this.writeNegativeVLong(i);
  }

  // write a pontentially negative vLong
  private writeNegativeVLong(i: bigint): void {
    let u = BigInt.asUintN(64, i); // Java's >>> on a long
    while (u > 0x7fn) {
      this.writeByte(Number(u & 0x7fn) | 0x80);
      u >>= 7n;
    }
    this.writeByte(Number(u));
  }

  /**
   * Write a {@link BitUtil.zigZagEncode zigzag}-encoded variable-length long. Writes between one and ten
   * bytes. This is typically useful to write small signed ints.
   * @see DataInput.readZLong
   */
  writeZLong(i: bigint): void {
    this.writeNegativeVLong(BitUtil.zigZagEncode(i));
  }

  /**
   * Writes a string.
   * <p>
   * Writes strings as UTF-8 encoded bytes. First the length, in bytes, is
   * written as a {@link writeVInt VInt}, followed by the bytes.
   *
   * @see DataInput.readString
   */
  writeString(s: string): void {
    const utf8Result = new BytesRef(s);
    this.writeVInt(utf8Result.length);
    this.writeBytes(utf8Result.bytes, utf8Result.offset, utf8Result.length);
  }

  /**
   * Copy numBytes bytes from input to ourself.
   */
  copyBytes(input: DataInput, numBytes: number): void {
    lassert(() => numBytes >= 0, "numBytes=" + numBytes);
    let left = numBytes;
    if (this.copyBuffer === null) this.copyBuffer = new Uint8Array(DataOutput.COPY_BUFFER_SIZE);
    while (left > 0) {
      let toCopy: number;
      if (left > DataOutput.COPY_BUFFER_SIZE) toCopy = DataOutput.COPY_BUFFER_SIZE;
      else toCopy = left;
      input.readBytes(this.copyBuffer, 0, toCopy);
      this.writeBytes(this.copyBuffer, 0, toCopy);
      left -= toCopy;
    }
  }

  /**
   * Writes a String map.
   * <p>
   * First the size is written as an {@link writeInt Int32},
   * followed by each key-value pair written as two consecutive
   * {@link writeString Strings}.
   *
   * @param map Input map. May be null (equivalent to an empty map)
   * @deprecated For better efficiency use {@link writeMapOfStrings}
   */
  writeStringStringMap(map: ReadonlyMap<string, string> | null): void {
    if (map === null) {
      this.writeInt(0);
    } else {
      this.writeInt(map.size);
      for (const [key, value] of map) {
        this.writeString(key);
        this.writeString(value);
      }
    }
  }

  /**
   * Writes a String map.
   * <p>
   * First the size is written as an {@link writeVInt vInt},
   * followed by each key-value pair written as two consecutive
   * {@link writeString Strings}.
   *
   * @param map Input map.
   */
  writeMapOfStrings(map: ReadonlyMap<string, string>): void {
    this.writeVInt(map.size);
    for (const [key, value] of map) {
      this.writeString(key);
      this.writeString(value);
    }
  }

  /**
   * Writes a String set.
   * <p>
   * First the size is written as an {@link writeInt Int32},
   * followed by each value written as a
   * {@link writeString String}.
   *
   * @param set Input set. May be null (equivalent to an empty set)
   * @deprecated For better efficiency use {@link writeSetOfStrings}
   */
  writeStringSet(set: ReadonlySet<string> | null): void {
    if (set === null) {
      this.writeInt(0);
    } else {
      this.writeInt(set.size);
      for (const value of set) {
        this.writeString(value);
      }
    }
  }

  /**
   * Writes a String set.
   * <p>
   * First the size is written as an {@link writeVInt vInt},
   * followed by each value written as a
   * {@link writeString String}.
   *
   * @param set Input set.
   */
  writeSetOfStrings(set: ReadonlySet<string>): void {
    this.writeVInt(set.size);
    for (const value of set) {
      this.writeString(value);
    }
  }
}
