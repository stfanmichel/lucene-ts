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

// Port of org.apache.lucene.store.DataInput (Lucene 5.2.1).
//
// Conventions specific to the store package (see PORTING.md):
//  - I/O is synchronous, as in Java. Failures are IOException (EOFException at the end of the data).
//  - readByte() returns 0..255 (Java returns a signed byte).
//  - A Java `long` holding DATA (readLong, readVLong, readZLong) is a `bigint`; a `long` that is a
//    byte COUNT or POSITION (skipBytes, ...) is a `number` (always < 2^53).
//  - readBytes(b, offset, len, useBuffer?) merges Java's two overloads: implementations that do not care
//    about `useBuffer` simply declare three parameters, as the Java default does by ignoring the flag.

import { IllegalArgumentException, IOException, NegativeArraySizeException } from "../errors.js";
import { lassert } from "../util/assertions.js";
import { BitUtil } from "../util/BitUtil.js";
import { compareJavaStrings, javaHashOrder } from "../util/JavaCollections.js";

// ignoreBOM: true keeps a leading U+FEFF in the string, as new String(bytes, UTF_8) does.
const UTF8_DECODER = new TextDecoder("utf-8", { ignoreBOM: true });

/**
 * Abstract base class for performing read operations of Lucene's low-level
 * data types.
 *
 * <p>{@code DataInput} may only be used from one thread, because it is not
 * thread safe (it keeps internal state like file position). To allow
 * multithreaded use, every {@code DataInput} instance must be cloned before
 * used in another thread. Subclasses must therefore implement {@link clone},
 * returning a new {@code DataInput} which operates on the same underlying
 * resource, but positioned independently.
 */
export abstract class DataInput {
  private static readonly SKIP_BUFFER_SIZE = 1024;

  /* This buffer is used to skip over bytes with the default implementation of
   * skipBytes. The reason why we need to use an instance member instead of
   * sharing a single instance across threads is that some delegating
   * implementations of DataInput might want to reuse the provided buffer in
   * order to eg. update the checksum. If we shared the same buffer across
   * threads, then another thread might update the buffer while the checksum is
   * being computed, making it invalid. See LUCENE-5583 for more information.
   */
  private skipBuffer: Uint8Array | null = null;

  /**
   * Reads and returns a single byte (0..255).
   * @see DataOutput.writeByte
   */
  abstract readByte(): number;

  /**
   * Reads a specified number of bytes into an array at the specified offset.
   * @param b the array to read bytes into
   * @param offset the offset in the array to start storing bytes
   * @param len the number of bytes to read
   * @param useBuffer set to false if the caller will handle buffering; implementations that do not
   *        distinguish simply ignore it (Java: "Default to ignoring useBuffer entirely")
   * @see DataOutput.writeBytes
   */
  abstract readBytes(b: Uint8Array, offset: number, len: number, useBuffer?: boolean): void;

  /**
   * Reads two bytes and returns a short.
   * @see DataOutput.writeByte
   */
  readShort(): number {
    const hi = this.readByte() & 0xff;
    const lo = this.readByte() & 0xff;
    return ((hi << 8) | lo) << 16 >> 16;
  }

  /**
   * Reads four bytes and returns an int.
   * @see DataOutput.writeInt
   */
  readInt(): number {
    const b1 = this.readByte() & 0xff;
    const b2 = this.readByte() & 0xff;
    const b3 = this.readByte() & 0xff;
    const b4 = this.readByte() & 0xff;
    return (b1 << 24) | (b2 << 16) | (b3 << 8) | b4;
  }

  /**
   * Reads an int stored in variable-length format.  Reads between one and
   * five bytes.  Smaller values take fewer bytes.  Negative numbers are
   * supported, but should be avoided.
   * <p>The format is described further in {@link DataOutput.writeVInt}.
   *
   * @see DataOutput.writeVInt
   */
  readVInt(): number {
    // (the unrolled Java code is equivalent to a loop; bytes are unsigned here, so "b >= 0" is "b < 0x80")
    let b = this.readByte();
    if (b < 0x80) return b;
    let i = b & 0x7f;
    b = this.readByte();
    i |= (b & 0x7f) << 7;
    if (b < 0x80) return i;
    b = this.readByte();
    i |= (b & 0x7f) << 14;
    if (b < 0x80) return i;
    b = this.readByte();
    i |= (b & 0x7f) << 21;
    if (b < 0x80) return i;
    b = this.readByte();
    // Warning: the next ands use 0x0F / 0xF0 - beware copy/paste errors:
    i |= (b & 0x0f) << 28;
    if ((b & 0xf0) === 0) return i;
    throw new IOException("Invalid vInt detected (too many bits)");
  }

  /**
   * Read a {@link BitUtil.zigZagDecode zigzag}-encoded variable-length integer.
   * @see DataOutput.writeZInt
   */
  readZInt(): number {
    return BitUtil.zigZagDecode(this.readVInt());
  }

  /**
   * Reads eight bytes and returns a long.
   * @see DataOutput.writeLong
   */
  readLong(): bigint {
    const hi = BigInt(this.readInt());
    const lo = BigInt(this.readInt() >>> 0);
    return BigInt.asIntN(64, (hi << 32n) | lo);
  }

  /**
   * Reads a long stored in variable-length format.  Reads between one and
   * nine bytes.  Smaller values take fewer bytes.  Negative numbers are not
   * supported.
   * <p>The format is described further in {@link DataOutput.writeVInt}.
   *
   * @see DataOutput.writeVLong
   */
  readVLong(): bigint {
    return this.readVLongInternal(false);
  }

  // Java: the private readVLong(boolean allowNegative). Renamed because TypeScript has no private overloads.
  private readVLongInternal(allowNegative: boolean): bigint {
    // The first 7 bytes carry 49 bits: accumulate them exactly in a double, and only
    // switch to bigint for the rare longer values.
    let b = this.readByte();
    if (b < 0x80) return BigInt(b);
    let lo = b & 0x7f;
    let scale = 128; // 2^7
    for (let n = 1; n < 7; n++) {
      b = this.readByte();
      lo += (b & 0x7f) * scale;
      if (b < 0x80) return BigInt(lo);
      scale *= 128;
    }
    let i = BigInt(lo);
    b = this.readByte();
    i |= BigInt(b & 0x7f) << 49n;
    if (b < 0x80) return i;
    b = this.readByte();
    i |= BigInt(b & 0x7f) << 56n;
    if (b < 0x80) return i;
    if (allowNegative) {
      b = this.readByte();
      i |= BigInt(b & 0x7f) << 63n;
      if (b === 0 || b === 1) return BigInt.asIntN(64, i);
      throw new IOException("Invalid vLong detected (more than 64 bits)");
    } else {
      throw new IOException("Invalid vLong detected (negative values disallowed)");
    }
  }

  /**
   * Read a {@link BitUtil.zigZagDecode zigzag}-encoded variable-length integer. Reads between one and ten bytes.
   * @see DataOutput.writeZLong
   */
  readZLong(): bigint {
    return BitUtil.zigZagDecode(this.readVLongInternal(true));
  }

  /**
   * Reads a string.
   * @see DataOutput.writeString
   */
  readString(): string {
    const length = this.readVInt();
    if (length < 0) {
      throw new NegativeArraySizeException(String(length));
    }
    const bytes = new Uint8Array(length);
    this.readBytes(bytes, 0, length);
    return UTF8_DECODER.decode(bytes);
  }

  /**
   * Returns a clone of this stream.
   *
   * <p>Clones of a stream access the same data, and are positioned at the same
   * point as the stream they were cloned from.
   *
   * <p>Expert: Subclasses must ensure that clones may be positioned at
   * different points in the input from each other and from the stream they
   * were cloned from.
   *
   * The default is Java's Object.clone(): a shallow copy of every field.
   */
  clone(): this {
    const copy = Object.create(Object.getPrototypeOf(this) as object) as this;
    return Object.assign(copy, this);
  }

  /**
   * Reads a Map&lt;String,String&gt; previously written with {@link DataOutput.writeStringStringMap}.
   * Iterates like a java.util.HashMap (see {@link javaHashOrder}).
   * @deprecated Only for reading existing formats. Encode maps with {@link DataOutput.writeMapOfStrings} instead.
   */
  readStringStringMap(): Map<string, string> {
    const raw = new Map<string, string>();
    const count = this.readInt();
    for (let i = 0; i < count; i++) {
      const key = this.readString();
      const val = this.readString();
      raw.set(key, val);
    }
    return DataInput.hashOrdered(raw);
  }

  /**
   * Reads a Map&lt;String,String&gt; previously written with {@link DataOutput.writeMapOfStrings}.
   * The result is read-only: sorted by key when it has at most 10 entries (Java: a TreeMap), otherwise
   * in java.util.HashMap iteration order.
   * @return An immutable map containing the written contents.
   */
  readMapOfStrings(): ReadonlyMap<string, string> {
    const count = this.readVInt();
    if (count === 0) {
      return new Map<string, string>();
    } else if (count === 1) {
      const key = this.readString();
      const val = this.readString();
      return new Map<string, string>([[key, val]]);
    } else {
      const raw = new Map<string, string>();
      for (let i = 0; i < count; i++) {
        const key = this.readString();
        const val = this.readString();
        raw.set(key, val);
      }
      if (count > 10) {
        return DataInput.hashOrdered(raw);
      }
      return new Map<string, string>([...raw.entries()].sort((a, b) => compareJavaStrings(a[0], b[0])));
    }
  }

  /**
   * Reads a Set&lt;String&gt; previously written with {@link DataOutput.writeStringSet}.
   * Iterates like a java.util.HashSet (see {@link javaHashOrder}).
   * @deprecated Only for reading existing formats. Encode sets with {@link DataOutput.writeSetOfStrings} instead.
   */
  readStringSet(): Set<string> {
    const raw: string[] = [];
    const seen = new Set<string>();
    const count = this.readInt();
    for (let i = 0; i < count; i++) {
      const s = this.readString();
      if (!seen.has(s)) {
        seen.add(s);
        raw.push(s);
      }
    }
    return new Set<string>(javaHashOrder(raw));
  }

  /**
   * Reads a Set&lt;String&gt; previously written with {@link DataOutput.writeSetOfStrings}.
   * The result is read-only: sorted when it has at most 10 elements (Java: a TreeSet), otherwise
   * in java.util.HashSet iteration order.
   * @return An immutable set containing the written contents.
   */
  readSetOfStrings(): ReadonlySet<string> {
    const count = this.readVInt();
    if (count === 0) {
      return new Set<string>();
    } else if (count === 1) {
      return new Set<string>([this.readString()]);
    } else {
      const raw: string[] = [];
      const seen = new Set<string>();
      for (let i = 0; i < count; i++) {
        const s = this.readString();
        if (!seen.has(s)) {
          seen.add(s);
          raw.push(s);
        }
      }
      if (count > 10) {
        return new Set<string>(javaHashOrder(raw));
      }
      return new Set<string>(raw.sort(compareJavaStrings));
    }
  }

  private static hashOrdered(raw: Map<string, string>): Map<string, string> {
    return new Map<string, string>(javaHashOrder([...raw.keys()]).map((k): [string, string] => [k, raw.get(k)!]));
  }

  /**
   * Skip over {@code numBytes} bytes. The contract on this method is that it
   * should have the same behavior as reading the same number of bytes into a
   * buffer and discarding its content. Negative values of {@code numBytes}
   * are not supported.
   */
  skipBytes(numBytes: number): void {
    if (numBytes < 0) {
      throw new IllegalArgumentException("numBytes must be >= 0, got " + numBytes);
    }
    if (this.skipBuffer === null) {
      this.skipBuffer = new Uint8Array(DataInput.SKIP_BUFFER_SIZE);
    }
    const skipBuffer = this.skipBuffer;
    lassert(() => skipBuffer.length === DataInput.SKIP_BUFFER_SIZE);
    for (let skipped = 0; skipped < numBytes; ) {
      const step = Math.min(DataInput.SKIP_BUFFER_SIZE, numBytes - skipped);
      this.readBytes(skipBuffer, 0, step, false);
      skipped += step;
    }
  }
}
