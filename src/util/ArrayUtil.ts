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

// Port of org.apache.lucene.util.ArrayUtil (Lucene 5.2.1).
//
// Array mapping (see PORTING.md): byte[] -> Uint8Array (0..255), char[] -> Uint16Array,
// short[] -> Int16Array, int[] -> Int32Array, long[] -> BigInt64Array,
// float[] -> Float32Array, double[] -> Float64Array.
//
// The Java overloads of grow/shrink collapse into one generic method for the typed
// arrays, because the element size comes from BYTES_PER_ELEMENT. boolean[] and the
// arrays of object references (int[][], float[][]) are plain JS arrays that cannot be
// told apart at runtime, so they get their own names (growBoolean, growRefs, ...).
//

import {
  ArrayIndexOutOfBoundsException,
  IllegalArgumentException,
  NumberFormatException,
} from "../errors.js";
import { ArrayIntroSorter } from "./ArrayIntroSorter.js";
import { ArrayTimSorter } from "./ArrayTimSorter.js";
import { lassert } from "./assertions.js";
import type { Comparable, Comparator } from "./Comparator.js";
import { Character, Integer } from "./JavaNumbers.js";
import { RamUsageEstimator } from "./RamUsageEstimator.js";

/** The typed arrays that stand for Java primitive arrays (except boolean[]). */
export type PrimitiveArray =
  | Uint8Array
  | Uint16Array
  | Int16Array
  | Int32Array
  | BigInt64Array
  | Float32Array
  | Float64Array;

const MAX_ARRAY_LENGTH: number = Integer.MAX_VALUE - RamUsageEstimator.NUM_BYTES_ARRAY_HEADER;

function minusSign(): number {
  return 0x2d; // '-'
}

function checkedCharAt(chars: Uint16Array, index: number): number {
  if (index < 0 || index >= chars.length) {
    throw new ArrayIndexOutOfBoundsException("Index " + index + " out of bounds for length " + chars.length);
  }
  return chars[index]!;
}

function copyPrefix<T extends PrimitiveArray>(array: T, newLength: number): T {
  const ctor = array.constructor as new (length: number) => T;
  const newArray = new ctor(newLength);
  // arrays are copied whole when growing and truncated when shrinking
  (newArray as Uint8Array).set(
    (array as Uint8Array).subarray(0, Math.min(array.length, newLength)),
  );
  return newArray;
}

/** Methods for manipulating arrays. */
export class ArrayUtil {
  /** Maximum length for an array (Integer.MAX_VALUE - RamUsageEstimator.NUM_BYTES_ARRAY_HEADER). */
  static readonly MAX_ARRAY_LENGTH: number = MAX_ARRAY_LENGTH;

  private constructor() {} // no instance

  /*
     Begin Apache Harmony code

     Revision taken on Friday, June 12. https://svn.apache.org/repos/asf/harmony/enhanced/classlib/archive/java6/modules/luni/src/main/java/java/lang/Integer.java
  */

  /**
   * Parses the string argument as if it was an int value and returns the
   * result. Throws NumberFormatException if the string does not represent an
   * int quantity.
   *
   * @param chars a string representation of an int quantity.
   * @return int the value represented by the argument
   * @throws NumberFormatException if the argument could not be parsed as an int quantity.
   */
  static parseInt(chars: Uint16Array, offset?: number, len?: number, radix?: number): number {
    if (offset === undefined) {
      return ArrayUtil.parseInt(chars, 0, chars.length, 10);
    }
    if (len === undefined) {
      throw new IllegalArgumentException("parseInt(chars, offset, len): len is required with offset");
    }
    if (radix === undefined) {
      radix = 10;
    }
    if (chars === null || chars === undefined || radix < Character.MIN_RADIX || radix > Character.MAX_RADIX) {
      throw new NumberFormatException();
    }
    let i = 0;
    if (len === 0) {
      throw new NumberFormatException("chars length is 0");
    }
    const negative = checkedCharAt(chars, offset + i) === minusSign();
    if (negative && ++i === len) {
      throw new NumberFormatException("can't convert to an int");
    }
    if (negative) {
      offset++;
      len--;
    }
    return ArrayUtil.parse(chars, offset, len, radix, negative);
  }

  private static parse(chars: Uint16Array, offset: number, len: number, radix: number, negative: boolean): number {
    const max = Math.trunc(Integer.MIN_VALUE / radix); // Java int division truncates toward zero
    let result = 0;
    for (let i = 0; i < len; i++) {
      const digit = Character.digit(checkedCharAt(chars, i + offset), radix);
      if (digit === -1) {
        throw new NumberFormatException("Unable to parse");
      }
      if (max > result) {
        throw new NumberFormatException("Unable to parse");
      }
      const next = (Math.imul(result, radix) - digit) | 0;
      if (next > result) {
        throw new NumberFormatException("Unable to parse");
      }
      result = next;
    }
    if (!negative) {
      result = -result | 0;
      if (result < 0) {
        throw new NumberFormatException("Unable to parse");
      }
    }
    return result;
  }

  /*

   END APACHE HARMONY CODE
  */

  /**
   * Returns an array size >= minTargetSize, generally over-allocating exponentially
   * to achieve amortized linear-time cost as the array grows.
   *
   * NOTE: this was originally borrowed from Python 2.4.2 listobject.c sources (attribution
   * in LICENSE.txt), but has now been substantially changed based on
   * discussions from java-dev thread with subject "Dynamic array reallocation algorithms",
   * started on Jan 12 2010.
   *
   * @param minTargetSize Minimum required value to be returned.
   * @param bytesPerElement Bytes used by each element of the array.
   *        See constants in {@link RamUsageEstimator}.
   *
   * @lucene.internal
   */
  static oversize(minTargetSize: number, bytesPerElement: number): number {
    if (minTargetSize < 0) {
      // catch usage that accidentally overflows int
      throw new IllegalArgumentException("invalid array size " + minTargetSize);
    }

    if (minTargetSize === 0) {
      // wait until at least one element is requested
      return 0;
    }

    if (minTargetSize > MAX_ARRAY_LENGTH) {
      throw new IllegalArgumentException(
        "requested array size " + minTargetSize + " exceeds maximum array in java (" + MAX_ARRAY_LENGTH + ")",
      );
    }

    // asymptotic exponential growth by 1/8th, favors
    // spending a bit more CPU to not tie up too much wasted
    // RAM:
    let extra = minTargetSize >> 3;

    if (extra < 3) {
      // for very small arrays, where constant overhead of
      // realloc is presumably relatively high, we grow
      // faster
      extra = 3;
    }

    const newSize = (minTargetSize + extra) | 0;

    // add 7 to allow for worst case byte alignment addition below:
    if (((newSize + 7) | 0) < 0 || ((newSize + 7) | 0) > MAX_ARRAY_LENGTH) {
      // int overflowed, or we exceeded the maximum array length
      return MAX_ARRAY_LENGTH;
    }

    // (the Java code also has a 32-bit JRE branch; this port always models a 64-bit JRE)
    // round up to 8 byte alignment in 64bit env
    switch (bytesPerElement) {
      case 4:
        // round up to multiple of 2
        return (newSize + 1) & 0x7ffffffe;
      case 2:
        // round up to multiple of 4
        return (newSize + 3) & 0x7ffffffc;
      case 1:
        // round up to multiple of 8
        return (newSize + 7) & 0x7ffffff8;
      case 8:
      // no rounding
      default:
        // odd (invalid?) size
        return newSize;
    }
  }

  /** @lucene.internal */
  static getShrinkSize(currentSize: number, targetSize: number, bytesPerElement: number): number {
    const newSize = ArrayUtil.oversize(targetSize, bytesPerElement);
    // Only reallocate if we are "substantially" smaller.
    // This saves us from "running hot" (constantly making a
    // bit bigger then a bit smaller, over and over):
    if (newSize < Math.trunc(currentSize / 2)) {
      return newSize;
    } else {
      return currentSize;
    }
  }

  /**
   * Grows a primitive array so that it holds at least minSize elements (new array, same
   * element type, old contents copied), or returns it unchanged when it is large enough.
   * Without minSize the array grows by (at least) one element.
   */
  static grow<T extends PrimitiveArray>(array: T, minSize?: number): T {
    if (minSize === undefined) {
      return ArrayUtil.grow(array, 1 + array.length);
    }
    lassert(() => minSize >= 0, "size must be positive (got " + minSize + "): likely integer overflow?");
    if (array.length < minSize) {
      return copyPrefix(array, ArrayUtil.oversize(minSize, array.BYTES_PER_ELEMENT));
    } else {
      return array;
    }
  }

  /** Shrinks a primitive array when it is much larger than targetSize (see {@link getShrinkSize}). */
  static shrink<T extends PrimitiveArray>(array: T, targetSize: number): T {
    lassert(() => targetSize >= 0, "size must be positive (got " + targetSize + "): likely integer overflow?");
    const newSize = ArrayUtil.getShrinkSize(array.length, targetSize, array.BYTES_PER_ELEMENT);
    if (newSize !== array.length) {
      return copyPrefix(array, newSize);
    } else {
      return array;
    }
  }

  /** grow for Java boolean[] (a plain JS array of booleans, 1 byte per element). */
  static growBoolean(array: boolean[], minSize?: number): boolean[] {
    if (minSize === undefined) {
      return ArrayUtil.growBoolean(array, 1 + array.length);
    }
    lassert(() => minSize >= 0, "size must be positive (got " + minSize + "): likely integer overflow?");
    if (array.length < minSize) {
      const newArray: boolean[] = new Array<boolean>(ArrayUtil.oversize(minSize, 1)).fill(false);
      for (let i = 0; i < array.length; i++) {
        newArray[i] = array[i]!;
      }
      return newArray;
    } else {
      return array;
    }
  }

  /** shrink for Java boolean[]. */
  static shrinkBoolean(array: boolean[], targetSize: number): boolean[] {
    lassert(() => targetSize >= 0, "size must be positive (got " + targetSize + "): likely integer overflow?");
    const newSize = ArrayUtil.getShrinkSize(array.length, targetSize, 1);
    if (newSize !== array.length) {
      const newArray: boolean[] = new Array<boolean>(newSize).fill(false);
      for (let i = 0; i < newSize; i++) {
        newArray[i] = array[i]!;
      }
      return newArray;
    } else {
      return array;
    }
  }

  /**
   * grow for Java arrays of references such as int[][] or float[][] (null-filled when
   * new). Sized with RamUsageEstimator.NUM_BYTES_OBJECT_REF per element.
   */
  static growRefs<T>(array: (T | null)[], minSize?: number): (T | null)[] {
    if (minSize === undefined) {
      return ArrayUtil.growRefs(array, 1 + array.length);
    }
    lassert(() => minSize >= 0, "size must be positive (got " + minSize + "): likely integer overflow?");
    if (array.length < minSize) {
      const newArray: (T | null)[] = new Array<T | null>(
        ArrayUtil.oversize(minSize, RamUsageEstimator.NUM_BYTES_OBJECT_REF),
      ).fill(null);
      for (let i = 0; i < array.length; i++) {
        newArray[i] = array[i]!;
      }
      return newArray;
    } else {
      return array;
    }
  }

  /** shrink for Java arrays of references such as int[][] or float[][]. */
  static shrinkRefs<T>(array: (T | null)[], targetSize: number): (T | null)[] {
    lassert(() => targetSize >= 0, "size must be positive (got " + targetSize + "): likely integer overflow?");
    const newSize = ArrayUtil.getShrinkSize(array.length, targetSize, RamUsageEstimator.NUM_BYTES_OBJECT_REF);
    if (newSize !== array.length) {
      const newArray: (T | null)[] = new Array<T | null>(newSize).fill(null);
      for (let i = 0; i < newSize; i++) {
        newArray[i] = array[i]!;
      }
      return newArray;
    } else {
      return array;
    }
  }

  /**
   * Returns hash of chars in range start (inclusive) to
   * end (inclusive). For bytes the values are read as Java signed bytes.
   */
  static hashCode(array: Uint16Array | Uint8Array, start: number, end: number): number {
    let code = 0;
    if (array instanceof Uint8Array) {
      for (let i = end - 1; i >= start; i--) {
        code = (Math.imul(code, 31) + ((array[i]! << 24) >> 24)) | 0;
      }
    } else {
      for (let i = end - 1; i >= start; i--) {
        code = (Math.imul(code, 31) + array[i]!) | 0;
      }
    }
    return code;
  }

  // Since Arrays.equals doesn't implement offsets for equals

  /**
   * See if two array slices are the same.
   *
   * @param left        The left array to compare
   * @param offsetLeft  The offset into the array.  Must be positive
   * @param right       The right array to compare
   * @param offsetRight the offset into the right array.  Must be positive
   * @param length      The length of the section of the array to compare
   * @return true if the two arrays, starting at their respective offsets, are equal
   */
  static equals<T extends Uint8Array | Uint16Array | Int32Array>(
    left: T,
    offsetLeft: number,
    right: T,
    offsetRight: number,
    length: number,
  ): boolean {
    if (offsetLeft + length <= left.length && offsetRight + length <= right.length) {
      for (let i = 0; i < length; i++) {
        if (left[offsetLeft + i] !== right[offsetRight + i]) {
          return false;
        }
      }
      return true;
    }
    return false;
  }

  /** Copies the values of a collection of ints into a new int[]. */
  static toIntArray(ints: Iterable<number>): Int32Array {
    const result = Int32Array.from(ints);
    return result;
  }

  private static readonly NATURAL_COMPARATOR: Comparator<Comparable<unknown>> = (o1, o2) => o1.compareTo(o2);

  /** Natural ordering: o1.compareTo(o2). */
  static naturalComparator<T extends Comparable<T>>(): Comparator<T> {
    return ArrayUtil.NATURAL_COMPARATOR as unknown as Comparator<T>;
  }

  /** Swap values stored in slots i and j */
  static swap<T>(arr: T[], i: number, j: number): void {
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }

  /**
   * Sorts the given array slice using the Comparator (or natural order when none is given).
   * This method uses the intro sort algorithm, but falls back to insertion sort for small arrays.
   * Overloads: (a), (a, comp), (a, fromIndex, toIndex), (a, fromIndex, toIndex, comp).
   * @param fromIndex start index (inclusive)
   * @param toIndex end index (exclusive)
   */
  static introSort<T>(a: T[], fromIndex: number, toIndex: number, comp: Comparator<T>): void;
  static introSort<T>(a: T[], comp: Comparator<T>): void;
  static introSort<T extends Comparable<T>>(a: T[], fromIndex: number, toIndex: number): void;
  static introSort<T extends Comparable<T>>(a: T[]): void;
  static introSort<T>(a: T[], x?: number | Comparator<T>, y?: number, comp?: Comparator<T>): void {
    if (typeof x === "function") {
      ArrayUtil.introSort(a, 0, a.length, x);
      return;
    }
    if (x === undefined) {
      ArrayUtil.introSort(a, 0, a.length, ArrayUtil.naturalComparator() as unknown as Comparator<T>);
      return;
    }
    const fromIndex = x;
    const toIndex = y!;
    if (toIndex - fromIndex <= 1) return;
    new ArrayIntroSorter<T>(
      a,
      comp ?? (ArrayUtil.naturalComparator() as unknown as Comparator<T>),
    ).sort(fromIndex, toIndex);
  }

  // tim sorts:

  /**
   * Sorts the given array slice using the Comparator (or natural order when none is given).
   * This method uses the Tim sort algorithm, but falls back to binary sort for small arrays.
   * Overloads: (a), (a, comp), (a, fromIndex, toIndex), (a, fromIndex, toIndex, comp).
   * @param fromIndex start index (inclusive)
   * @param toIndex end index (exclusive)
   */
  static timSort<T>(a: T[], fromIndex: number, toIndex: number, comp: Comparator<T>): void;
  static timSort<T>(a: T[], comp: Comparator<T>): void;
  static timSort<T extends Comparable<T>>(a: T[], fromIndex: number, toIndex: number): void;
  static timSort<T extends Comparable<T>>(a: T[]): void;
  static timSort<T>(a: T[], x?: number | Comparator<T>, y?: number, comp?: Comparator<T>): void {
    if (typeof x === "function") {
      ArrayUtil.timSort(a, 0, a.length, x);
      return;
    }
    if (x === undefined) {
      ArrayUtil.timSort(a, 0, a.length, ArrayUtil.naturalComparator() as unknown as Comparator<T>);
      return;
    }
    const fromIndex = x;
    const toIndex = y!;
    if (toIndex - fromIndex <= 1) return;
    // note: maxTempSlots is a quarter... of the WHOLE array (Java int division), not of the sorted slice
    new ArrayTimSorter<T>(
      a,
      comp ?? (ArrayUtil.naturalComparator() as unknown as Comparator<T>),
      Math.trunc(a.length / 64),
    ).sort(fromIndex, toIndex);
  }
}
