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

// Port of org.apache.lucene.util.CharsRef (Lucene 5.2.1).
//
// Deviation: Java's CharsRef has both a `length` field and a `length()` method (from
// java.lang.CharSequence). TypeScript cannot have both under one name, so only the field is
// kept. Use {@link charSequenceLength} / {@link charSequenceCharAt} to treat a string and a
// CharsRef uniformly (a Java `char` is a UTF-16 code unit held in a `number`).

import { IllegalStateException, IndexOutOfBoundsException } from "../errors.js";
import { lassert } from "./assertions.js";
import type { Comparable, Comparator } from "./Comparator.js";
import { charsToString } from "./UnicodeUtil.js";

/** Stand-in for java.lang.CharSequence: the two implementations Lucene passes around. */
export type CharSequence = string | CharsRef;

/** CharSequence.length() */
export function charSequenceLength(cs: CharSequence): number {
  return typeof cs === "string" ? cs.length : cs.length;
}

/** CharSequence.charAt(index): the UTF-16 code unit at `index`. */
export function charSequenceCharAt(cs: CharSequence, index: number): number {
  if (typeof cs === "string") {
    if (index < 0 || index >= cs.length) {
      throw new IndexOutOfBoundsException("index " + index + ",length " + cs.length);
    }
    return cs.charCodeAt(index);
  }
  return cs.charAt(index);
}

/**
 * Represents char[], as a slice (offset + length) into an existing char[].
 * The {@link chars} member should never be null; use {@link CharsRef.EMPTY_CHARS} if necessary.
 *
 * Java `char[]` is modelled as `Uint16Array` (UTF-16 code units).
 *
 * @lucene.internal
 */
export class CharsRef implements Comparable<CharsRef> {
  /** An empty character array for convenience */
  static readonly EMPTY_CHARS: Uint16Array = new Uint16Array(0);

  /** The contents of the CharsRef. Should never be {@code null}. */
  chars: Uint16Array;
  /** Offset of first valid character. */
  offset: number;
  /** Length of used characters. */
  length: number;

  /** Creates a new empty CharsRef */
  constructor();
  /** Creates a new CharsRef initialized an empty array zero-filled to the given capacity */
  constructor(capacity: number);
  /** Creates a new CharsRef initialized with an existing char[] (not copied) */
  constructor(chars: Uint16Array, offset: number, length: number);
  /** Creates a new CharsRef initialized with the code units of the given string */
  constructor(string: string);
  constructor(arg?: number | Uint16Array | string, offset?: number, length?: number) {
    if (arg === undefined) {
      this.chars = CharsRef.EMPTY_CHARS;
      this.offset = 0;
      this.length = 0;
      lassert(() => this.isValid());
    } else if (typeof arg === "number") {
      this.chars = new Uint16Array(arg);
      this.offset = 0;
      this.length = 0;
    } else if (typeof arg === "string") {
      const chars = new Uint16Array(arg.length);
      for (let i = 0; i < arg.length; i++) {
        chars[i] = arg.charCodeAt(i);
      }
      this.chars = chars;
      this.offset = 0;
      this.length = chars.length;
    } else {
      this.chars = arg;
      this.offset = offset ?? 0;
      this.length = length ?? 0;
      lassert(() => this.isValid());
    }
  }

  /**
   * Returns a shallow clone of this instance (the underlying characters are
   * **not** copied and will be shared by both the returned object and this
   * object.
   *
   * @see CharsRef.deepCopyOf
   */
  clone(): CharsRef {
    return new CharsRef(this.chars, this.offset, this.length);
  }

  hashCode(): number {
    const prime = 31;
    let result = 0;
    const end = this.offset + this.length;
    for (let i = this.offset; i < end; i++) {
      result = (Math.imul(prime, result) + this.chars[i]!) | 0;
    }
    return result;
  }

  equals(other: unknown): boolean {
    if (other === null || other === undefined) {
      return false;
    }
    if (other instanceof CharsRef) {
      return this.charsEquals(other);
    }
    return false;
  }

  charsEquals(other: CharsRef): boolean {
    if (this.length === other.length) {
      let otherUpto = other.offset;
      const otherChars = other.chars;
      const end = this.offset + this.length;
      for (let upto = this.offset; upto < end; upto++, otherUpto++) {
        if (this.chars[upto] !== otherChars[otherUpto]) {
          return false;
        }
      }
      return true;
    } else {
      return false;
    }
  }

  /** Signed int order comparison */
  compareTo(other: CharsRef): number {
    if (this === other) return 0;

    const aChars = this.chars;
    let aUpto = this.offset;
    const bChars = other.chars;
    let bUpto = other.offset;

    const aStop = aUpto + Math.min(this.length, other.length);

    while (aUpto < aStop) {
      const aInt = aChars[aUpto++]!;
      const bInt = bChars[bUpto++]!;
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
    return charsToString(this.chars, this.offset, this.length);
  }

  /** CharSequence.charAt: the UTF-16 code unit at `index`. */
  charAt(index: number): number {
    // NOTE: must do a real check here to meet the specs of CharSequence
    if (index < 0 || index >= this.length) {
      throw new IndexOutOfBoundsException();
    }
    return this.chars[this.offset + index]!;
  }

  /** CharSequence.subSequence */
  subSequence(start: number, end: number): CharsRef {
    // NOTE: must do a real check here to meet the specs of CharSequence
    if (start < 0 || end > this.length || start > end) {
      throw new IndexOutOfBoundsException();
    }
    return new CharsRef(this.chars, this.offset + start, end - start);
  }

  /**
   * @deprecated This comparator is only a transition mechanism
   */
  static getUTF16SortedAsUTF8Comparator(): Comparator<CharsRef> {
    return utf16SortedAsUTF8SortOrder;
  }

  /**
   * Creates a new CharsRef that points to a copy of the chars from
   * `other`
   *
   * The returned CharsRef will have a length of other.length
   * and an offset of zero.
   */
  static deepCopyOf(other: CharsRef): CharsRef {
    return new CharsRef(other.chars.slice(other.offset, other.offset + other.length), 0, other.length);
  }

  /**
   * Performs internal consistency checks.
   * Always returns true (or throws IllegalStateException)
   */
  isValid(): boolean {
    if (this.chars === null || this.chars === undefined) {
      throw new IllegalStateException("chars is null");
    }
    if (this.length < 0) {
      throw new IllegalStateException("length is negative: " + this.length);
    }
    if (this.length > this.chars.length) {
      throw new IllegalStateException("length is out of bounds: " + this.length + ",chars.length=" + this.chars.length);
    }
    if (this.offset < 0) {
      throw new IllegalStateException("offset is negative: " + this.offset);
    }
    if (this.offset > this.chars.length) {
      throw new IllegalStateException("offset out of bounds: " + this.offset + ",chars.length=" + this.chars.length);
    }
    if (this.offset + this.length < 0) {
      throw new IllegalStateException("offset+length is negative: offset=" + this.offset + ",length=" + this.length);
    }
    if (this.offset + this.length > this.chars.length) {
      throw new IllegalStateException(
        "offset+length out of bounds: offset=" + this.offset + ",length=" + this.length + ",chars.length=" + this.chars.length,
      );
    }
    return true;
  }
}

function utf16SortedAsUTF8Compare(a: CharsRef, b: CharsRef): number {
  if (a === b) return 0;

  const aChars = a.chars;
  let aUpto = a.offset;
  const bChars = b.chars;
  let bUpto = b.offset;

  const aStop = aUpto + Math.min(a.length, b.length);

  while (aUpto < aStop) {
    let aChar = aChars[aUpto++]!;
    let bChar = bChars[bUpto++]!;
    if (aChar !== bChar) {
      // http://icu-project.org/docs/papers/utf16_code_point_order.html

      /* aChar != bChar, fix up each one if they're both in or above the surrogate range, then compare them */
      if (aChar >= 0xd800 && bChar >= 0xd800) {
        if (aChar >= 0xe000) {
          aChar -= 0x800;
        } else {
          aChar += 0x2000;
        }

        if (bChar >= 0xe000) {
          bChar -= 0x800;
        } else {
          bChar += 0x2000;
        }
      }

      /* now aChar and bChar are in code point order */
      return aChar - bChar; /* int must be 32 bits wide */
    }
  }

  // One is a prefix of the other, or, they are equal:
  return a.length - b.length;
}

const utf16SortedAsUTF8SortOrder: Comparator<CharsRef> = utf16SortedAsUTF8Compare;
