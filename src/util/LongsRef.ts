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

// Port of org.apache.lucene.util.LongsRef (Lucene 5.2.1).

import { IllegalStateException } from "../errors.js";
import { lassert } from "./assertions.js";
import type { Comparable } from "./Comparator.js";
import { Long } from "./JavaNumbers.js";

/**
 * Represents long[], as a slice (offset + length) into an
 * existing long[]. The {@link longs} member should never be null; use
 * {@link LongsRef.EMPTY_LONGS} if necessary.
 *
 * Java `long[]` is modelled as `BigInt64Array` (elements are signed 64-bit `bigint`s).
 *
 * @lucene.internal
 */
export class LongsRef implements Comparable<LongsRef> {
  /** An LongsRef with an array of size 0. */
  static readonly EMPTY_LONGS: BigInt64Array = new BigInt64Array(0);

  /** The contents of the LongsRef. Should never be {@code null}. */
  longs: BigInt64Array;
  /** Offset of first valid long. */
  offset: number;
  /** Length of used longs. */
  length: number;

  /** Create a LongsRef with {@link LongsRef.EMPTY_LONGS} */
  constructor();
  /** Create a LongsRef pointing to a new array of size `capacity`. Offset and length will both be zero. */
  constructor(capacity: number);
  /** This instance will directly reference longs w/o making a copy. longs should not be null. */
  constructor(longs: BigInt64Array, offset: number, length: number);
  constructor(arg?: number | BigInt64Array, offset?: number, length?: number) {
    if (arg === undefined) {
      this.longs = LongsRef.EMPTY_LONGS;
      this.offset = 0;
      this.length = 0;
    } else if (typeof arg === "number") {
      this.longs = new BigInt64Array(arg);
      this.offset = 0;
      this.length = 0;
    } else {
      this.longs = arg;
      this.offset = offset ?? 0;
      this.length = length ?? 0;
      lassert(() => this.isValid());
    }
  }

  /**
   * Returns a shallow clone of this instance (the underlying longs are
   * **not** copied and will be shared by both the returned object and this
   * object.
   *
   * @see LongsRef.deepCopyOf
   */
  clone(): LongsRef {
    return new LongsRef(this.longs, this.offset, this.length);
  }

  hashCode(): number {
    const prime = 31;
    let result = 0;
    const end = this.offset + this.length;
    for (let i = this.offset; i < end; i++) {
      const l = this.longs[i]!;
      // (int) (longs[i] ^ (longs[i]>>>32))
      const folded = Number(BigInt.asIntN(32, l ^ Long.ushr(l, 32)));
      result = (Math.imul(prime, result) + folded) | 0;
    }
    return result;
  }

  equals(other: unknown): boolean {
    if (other === null || other === undefined) {
      return false;
    }
    if (other instanceof LongsRef) {
      return this.longsEquals(other);
    }
    return false;
  }

  longsEquals(other: LongsRef): boolean {
    if (this.length === other.length) {
      let otherUpto = other.offset;
      const otherLongs = other.longs;
      const end = this.offset + this.length;
      for (let upto = this.offset; upto < end; upto++, otherUpto++) {
        if (this.longs[upto] !== otherLongs[otherUpto]) {
          return false;
        }
      }
      return true;
    } else {
      return false;
    }
  }

  /** Signed int order comparison */
  compareTo(other: LongsRef): number {
    if (this === other) return 0;

    const aInts = this.longs;
    let aUpto = this.offset;
    const bInts = other.longs;
    let bUpto = other.offset;

    const aStop = aUpto + Math.min(this.length, other.length);

    while (aUpto < aStop) {
      const aInt = aInts[aUpto++]!;
      const bInt = bInts[bUpto++]!;
      if (aInt > bInt) {
        return 1;
      } else if (aInt < bInt) {
        return -1;
      }
    }

    // One is a prefix of the other, or, they are equal:
    return this.length - other.length;
  }

  toString(): string {
    let sb = "[";
    const end = this.offset + this.length;
    for (let i = this.offset; i < end; i++) {
      if (i > this.offset) {
        sb += " ";
      }
      // Long.toHexString: unsigned, lower case
      sb += BigInt.asUintN(64, this.longs[i]!).toString(16);
    }
    sb += "]";
    return sb;
  }

  /**
   * Creates a new LongsRef that points to a copy of the longs from
   * `other`
   *
   * The returned IntsRef will have a length of other.length
   * and an offset of zero.
   */
  static deepCopyOf(other: LongsRef): LongsRef {
    return new LongsRef(other.longs.slice(other.offset, other.offset + other.length), 0, other.length);
  }

  /**
   * Performs internal consistency checks.
   * Always returns true (or throws IllegalStateException)
   */
  isValid(): boolean {
    if (this.longs === null || this.longs === undefined) {
      throw new IllegalStateException("longs is null");
    }
    if (this.length < 0) {
      throw new IllegalStateException("length is negative: " + this.length);
    }
    if (this.length > this.longs.length) {
      throw new IllegalStateException("length is out of bounds: " + this.length + ",longs.length=" + this.longs.length);
    }
    if (this.offset < 0) {
      throw new IllegalStateException("offset is negative: " + this.offset);
    }
    if (this.offset > this.longs.length) {
      throw new IllegalStateException("offset out of bounds: " + this.offset + ",longs.length=" + this.longs.length);
    }
    if (this.offset + this.length < 0) {
      throw new IllegalStateException("offset+length is negative: offset=" + this.offset + ",length=" + this.length);
    }
    if (this.offset + this.length > this.longs.length) {
      throw new IllegalStateException(
        "offset+length out of bounds: offset=" + this.offset + ",length=" + this.length + ",longs.length=" + this.longs.length,
      );
    }
    return true;
  }
}
