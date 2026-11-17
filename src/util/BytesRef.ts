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

// Port of org.apache.lucene.util.BytesRef (Lucene 5.2.1).

import { IllegalStateException } from "../errors.js";
import { lassert } from "./assertions.js";
import type { Comparable, Comparator } from "./Comparator.js";
import { StringHelper } from "./StringHelper.js";
import { UnicodeUtil, charsToString } from "./UnicodeUtil.js";

function utf8SortedAsUnicodeCompare(a: BytesRef, b: BytesRef): number {
  const aBytes = a.bytes;
  let aUpto = a.offset;
  const bBytes = b.bytes;
  let bUpto = b.offset;

  const aStop = aUpto + Math.min(a.length, b.length);
  while (aUpto < aStop) {
    const aByte = aBytes[aUpto++]!;
    const bByte = bBytes[bUpto++]!;

    const diff = aByte - bByte;
    if (diff !== 0) {
      return diff;
    }
  }

  // One is a prefix of the other, or, they are equal:
  return a.length - b.length;
}

function utf8SortedAsUTF16Compare(a: BytesRef, b: BytesRef): number {
  const aBytes = a.bytes;
  let aUpto = a.offset;
  const bBytes = b.bytes;
  let bUpto = b.offset;

  const aStop = a.length < b.length ? aUpto + a.length : aUpto + b.length;

  while (aUpto < aStop) {
    let aByte = aBytes[aUpto++]!;
    let bByte = bBytes[bUpto++]!;

    if (aByte !== bByte) {
      // See http://icu-project.org/docs/papers/utf16_code_point_order.html#utf-8-in-utf-16-order

      // We know the terms are not equal, but, we may
      // have to carefully fixup the bytes at the
      // difference to match UTF16's sort order:

      // NOTE: instead of moving supplementary code points (0xee and 0xef) to the unused 0xfe and 0xff,
      // we move them to the unused 0xfc and 0xfd [reserved for future 6-byte character sequences]
      // this reserves 0xff for preflex's term reordering (surrogate dance), and if unicode grows such
      // that 6-byte sequences are needed we have much bigger problems anyway.
      if (aByte >= 0xee && bByte >= 0xee) {
        if ((aByte & 0xfe) === 0xee) {
          aByte += 0xe;
        }
        if ((bByte & 0xfe) === 0xee) {
          bByte += 0xe;
        }
      }
      return aByte - bByte;
    }
  }

  // One is a prefix of the other, or, they are equal:
  return a.length - b.length;
}

/**
 * Represents byte[], as a slice (offset + length) into an
 * existing byte array. The `bytes` member should never be null;
 * use {@link BytesRef.EMPTY_BYTES} if necessary.
 *
 * **Important note:** Unless otherwise noted, Lucene uses this class to
 * represent terms that are encoded as **UTF8** bytes in the index. To
 * convert them to a string (which is UTF16), use {@link BytesRef.utf8ToString}.
 * Decoding with `new TextDecoder().decode(...)` is not equivalent for
 * malformed input (it substitutes U+FFFD where Lucene keeps the code units).
 *
 * Java `byte[]` is modelled as `Uint8Array`, so byte values are unsigned (0..255).
 */
export class BytesRef implements Comparable<BytesRef> {
  /** An empty byte array for convenience */
  static readonly EMPTY_BYTES: Uint8Array = new Uint8Array(0);

  /** The contents of the BytesRef. Should never be null. */
  bytes: Uint8Array;

  /** Offset of first valid byte. */
  offset: number;

  /** Length of used bytes. */
  length: number;

  /** Create a BytesRef with {@link BytesRef.EMPTY_BYTES} */
  constructor();
  /**
   * This instance will directly reference bytes w/o making a copy.
   * bytes should not be null.
   */
  constructor(bytes: Uint8Array, offset: number, length: number);
  /**
   * This instance will directly reference bytes w/o making a copy.
   * bytes should not be null
   */
  constructor(bytes: Uint8Array);
  /**
   * Create a BytesRef pointing to a new array of size `capacity`.
   * Offset and length will both be zero.
   */
  constructor(capacity: number);
  /**
   * Initialize the byte array from the UTF8 bytes
   * for the provided string.
   *
   * @param text This must be well-formed unicode text, with no unpaired surrogates.
   */
  constructor(text: string);
  constructor(arg?: Uint8Array | number | string, offset?: number, length?: number) {
    if (arg === undefined) {
      this.bytes = BytesRef.EMPTY_BYTES;
      this.offset = 0;
      this.length = 0;
      lassert(() => this.isValid());
    } else if (typeof arg === "number") {
      this.bytes = new Uint8Array(arg);
      this.offset = 0;
      this.length = 0;
    } else if (typeof arg === "string") {
      this.bytes = new Uint8Array(UnicodeUtil.MAX_UTF8_BYTES_PER_CHAR * arg.length);
      this.offset = 0;
      this.length = UnicodeUtil.UTF16toUTF8(arg, 0, arg.length, this.bytes);
      lassert(() => this.isValid());
    } else {
      this.bytes = arg;
      this.offset = offset ?? 0;
      this.length = length ?? arg.length;
      lassert(() => this.isValid());
    }
  }

  /**
   * Expert: compares the bytes against another BytesRef,
   * returning true if the bytes are equal.
   *
   * @param other Another BytesRef, should not be null.
   * @lucene.internal
   */
  bytesEquals(other: BytesRef): boolean {
    lassert(() => other !== null && other !== undefined);
    if (this.length === other.length) {
      let otherUpto = other.offset;
      const otherBytes = other.bytes;
      const end = this.offset + this.length;
      for (let upto = this.offset; upto < end; upto++, otherUpto++) {
        if (this.bytes[upto] !== otherBytes[otherUpto]) {
          return false;
        }
      }
      return true;
    } else {
      return false;
    }
  }

  /**
   * Returns a shallow clone of this instance (the underlying bytes are
   * **not** copied and will be shared by both the returned object and this
   * object.
   *
   * @see BytesRef.deepCopyOf
   */
  clone(): BytesRef {
    return new BytesRef(this.bytes, this.offset, this.length);
  }

  /**
   * Calculates the hash code as required by TermsHash during indexing.
   *
   * This is currently implemented as MurmurHash3 (32 bit), using the seed from
   * {@link StringHelper.GOOD_FAST_HASH_SEED}, but is subject to change from
   * release to release.
   */
  hashCode(): number {
    return StringHelper.murmurhash3_x86_32(this, StringHelper.GOOD_FAST_HASH_SEED);
  }

  equals(other: unknown): boolean {
    if (other === null || other === undefined) {
      return false;
    }
    if (other instanceof BytesRef) {
      return this.bytesEquals(other);
    }
    return false;
  }

  /** Interprets stored bytes as UTF8 bytes, returning the resulting string */
  utf8ToString(): string {
    const ref = new Uint16Array(this.length);
    const len = UnicodeUtil.UTF8toUTF16(this.bytes, this.offset, this.length, ref);
    return charsToString(ref, 0, len);
  }

  /** Returns hex encoded bytes, eg [6c 75 63 65 6e 65] */
  toString(): string {
    let sb = "[";
    const end = this.offset + this.length;
    for (let i = this.offset; i < end; i++) {
      if (i > this.offset) {
        sb += " ";
      }
      sb += this.bytes[i]!.toString(16);
    }
    sb += "]";
    return sb;
  }

  /** Unsigned byte order comparison */
  compareTo(other: BytesRef): number {
    return utf8SortedAsUnicodeCompare(this, other);
  }

  static getUTF8SortedAsUnicodeComparator(): Comparator<BytesRef> {
    return utf8SortedAsUnicodeCompare;
  }

  /** @deprecated This comparator is only a transition mechanism */
  static getUTF8SortedAsUTF16Comparator(): Comparator<BytesRef> {
    return utf8SortedAsUTF16Compare;
  }

  /**
   * Creates a new BytesRef that points to a copy of the bytes from `other`.
   *
   * The returned BytesRef will have a length of other.length and an offset of zero.
   */
  static deepCopyOf(other: BytesRef): BytesRef {
    const copy = new BytesRef();
    copy.bytes = other.bytes.slice(other.offset, other.offset + other.length);
    copy.offset = 0;
    copy.length = other.length;
    return copy;
  }

  /**
   * Performs internal consistency checks.
   * Always returns true (or throws IllegalStateException)
   */
  isValid(): boolean {
    if (this.bytes === null || this.bytes === undefined) {
      throw new IllegalStateException("bytes is null");
    }
    if (this.length < 0) {
      throw new IllegalStateException("length is negative: " + this.length);
    }
    if (this.length > this.bytes.length) {
      throw new IllegalStateException("length is out of bounds: " + this.length + ",bytes.length=" + this.bytes.length);
    }
    if (this.offset < 0) {
      throw new IllegalStateException("offset is negative: " + this.offset);
    }
    if (this.offset > this.bytes.length) {
      throw new IllegalStateException("offset out of bounds: " + this.offset + ",bytes.length=" + this.bytes.length);
    }
    if (this.offset + this.length < 0) {
      throw new IllegalStateException("offset+length is negative: offset=" + this.offset + ",length=" + this.length);
    }
    if (this.offset + this.length > this.bytes.length) {
      throw new IllegalStateException(
        "offset+length out of bounds: offset=" + this.offset + ",length=" + this.length + ",bytes.length=" + this.bytes.length,
      );
    }
    return true;
  }
}
