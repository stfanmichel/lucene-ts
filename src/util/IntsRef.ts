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

// Port of org.apache.lucene.util.IntsRef (Lucene 5.2.1).

import { IllegalStateException } from "../errors.js";
import { lassert } from "./assertions.js";
import type { Comparable } from "./Comparator.js";
import { Integer } from "./JavaNumbers.js";

/**
 * Represents int[], as a slice (offset + length) into an
 * existing int[]. The {@link ints} member should never be null; use
 * {@link IntsRef.EMPTY_INTS} if necessary.
 *
 * Java `int[]` is modelled as `Int32Array`.
 *
 * @lucene.internal
 */
export class IntsRef implements Comparable<IntsRef> {
  /** An IntsRef with an array of size 0. */
  static readonly EMPTY_INTS: Int32Array = new Int32Array(0);

  /** The contents of the IntsRef. Should never be {@code null}. */
  ints: Int32Array;
  /** Offset of first valid integer. */
  offset: number;
  /** Length of used ints. */
  length: number;

  /** Create a IntsRef with {@link IntsRef.EMPTY_INTS} */
  constructor();
  /** Create a IntsRef pointing to a new array of size `capacity`. Offset and length will both be zero. */
  constructor(capacity: number);
  /** This instance will directly reference ints w/o making a copy. ints should not be null. */
  constructor(ints: Int32Array, offset: number, length: number);
  constructor(arg?: number | Int32Array, offset?: number, length?: number) {
    if (arg === undefined) {
      this.ints = IntsRef.EMPTY_INTS;
      this.offset = 0;
      this.length = 0;
    } else if (typeof arg === "number") {
      this.ints = new Int32Array(arg);
      this.offset = 0;
      this.length = 0;
    } else {
      this.ints = arg;
      this.offset = offset ?? 0;
      this.length = length ?? 0;
      lassert(() => this.isValid());
    }
  }

  /**
   * Returns a shallow clone of this instance (the underlying ints are
   * **not** copied and will be shared by both the returned object and this
   * object.
   *
   * @see IntsRef.deepCopyOf
   */
  clone(): IntsRef {
    return new IntsRef(this.ints, this.offset, this.length);
  }

  hashCode(): number {
    const prime = 31;
    let result = 0;
    const end = this.offset + this.length;
    for (let i = this.offset; i < end; i++) {
      result = (Math.imul(prime, result) + this.ints[i]!) | 0;
    }
    return result;
  }

  equals(other: unknown): boolean {
    if (other === null || other === undefined) {
      return false;
    }
    if (other instanceof IntsRef) {
      return this.intsEquals(other);
    }
    return false;
  }

  intsEquals(other: IntsRef): boolean {
    if (this.length === other.length) {
      let otherUpto = other.offset;
      const otherInts = other.ints;
      const end = this.offset + this.length;
      for (let upto = this.offset; upto < end; upto++, otherUpto++) {
        if (this.ints[upto] !== otherInts[otherUpto]) {
          return false;
        }
      }
      return true;
    } else {
      return false;
    }
  }

  /** Signed int order comparison */
  compareTo(other: IntsRef): number {
    if (this === other) return 0;

    const aInts = this.ints;
    let aUpto = this.offset;
    const bInts = other.ints;
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
      sb += Integer.toHexString(this.ints[i]!);
    }
    sb += "]";
    return sb;
  }

  /**
   * Creates a new IntsRef that points to a copy of the ints from
   * `other`
   *
   * The returned IntsRef will have a length of other.length
   * and an offset of zero.
   */
  static deepCopyOf(other: IntsRef): IntsRef {
    return new IntsRef(other.ints.slice(other.offset, other.offset + other.length), 0, other.length);
  }

  /**
   * Performs internal consistency checks.
   * Always returns true (or throws IllegalStateException)
   */
  isValid(): boolean {
    if (this.ints === null || this.ints === undefined) {
      throw new IllegalStateException("ints is null");
    }
    if (this.length < 0) {
      throw new IllegalStateException("length is negative: " + this.length);
    }
    if (this.length > this.ints.length) {
      throw new IllegalStateException("length is out of bounds: " + this.length + ",ints.length=" + this.ints.length);
    }
    if (this.offset < 0) {
      throw new IllegalStateException("offset is negative: " + this.offset);
    }
    if (this.offset > this.ints.length) {
      throw new IllegalStateException("offset out of bounds: " + this.offset + ",ints.length=" + this.ints.length);
    }
    if (this.offset + this.length < 0) {
      throw new IllegalStateException("offset+length is negative: offset=" + this.offset + ",length=" + this.length);
    }
    if (this.offset + this.length > this.ints.length) {
      throw new IllegalStateException(
        "offset+length out of bounds: offset=" + this.offset + ",length=" + this.length + ",ints.length=" + this.ints.length,
      );
    }
    return true;
  }
}
