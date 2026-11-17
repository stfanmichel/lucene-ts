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

// Port of org.apache.lucene.util.Sorter (Lucene 5.2.1).
//
// Java's package-private members (everything but compare/swap/sort) are public here, because
// TypeScript has no package visibility; they are internal and marked as such. The members that
// are `protected` in Java stay protected.

import { IllegalArgumentException } from "../errors.js";
import { lassert } from "./assertions.js";

/**
 * Base class for sorting algorithms implementations.
 * @lucene.internal
 */
export abstract class Sorter {
  static readonly THRESHOLD: number = 20;

  /** Sole constructor, used for invocation by sub-classes. */
  protected constructor() {}

  /** Compare entries found in slots i and j. The contract for the returned value is the same as {@link Comparator.compare}. */
  protected abstract compare(i: number, j: number): number;

  /** Swap values at slots i and j. */
  protected abstract swap(i: number, j: number): void;

  /** Sort the slice which starts at from (inclusive) and ends at to (exclusive). */
  abstract sort(from: number, to: number): void;

  /** @internal package-private in Java */
  checkRange(from: number, to: number): void {
    if (to < from) {
      throw new IllegalArgumentException("'to' must be >= 'from', got from=" + from + " and to=" + to);
    }
  }

  /** @internal package-private in Java */
  mergeInPlace(from: number, mid: number, to: number): void {
    if (from === mid || mid === to || this.compare(mid - 1, mid) <= 0) {
      return;
    } else if (to - from === 2) {
      this.swap(mid - 1, mid);
      return;
    }
    while (this.compare(from, mid) <= 0) {
      ++from;
    }
    while (this.compare(mid - 1, to - 1) <= 0) {
      --to;
    }
    let firstCut: number, secondCut: number;
    let len11: number, len22: number;
    if (mid - from > to - mid) {
      len11 = (mid - from) >>> 1;
      firstCut = from + len11;
      secondCut = this.lower(mid, to, firstCut);
      len22 = secondCut - mid;
    } else {
      len22 = (to - mid) >>> 1;
      secondCut = mid + len22;
      firstCut = this.upper(from, mid, secondCut);
      len11 = firstCut - from;
    }
    this.rotate(firstCut, mid, secondCut);
    const newMid = firstCut + len22;
    this.mergeInPlace(from, firstCut, newMid);
    this.mergeInPlace(newMid, secondCut, to);
  }

  /**
   * Find the first element in from-to which is greater than or equal to val.
   * @internal package-private in Java
   */
  lower(from: number, to: number, val: number): number {
    let len = to - from;
    while (len > 0) {
      const half = len >>> 1;
      const mid = from + half;
      if (this.compare(mid, val) < 0) {
        from = mid + 1;
        len = len - half - 1;
      } else {
        len = half;
      }
    }
    return from;
  }

  /**
   * Find the first element in from-to which is greater than val.
   * @internal package-private in Java
   */
  upper(from: number, to: number, val: number): number {
    let len = to - from;
    while (len > 0) {
      const half = len >>> 1;
      const mid = from + half;
      if (this.compare(val, mid) < 0) {
        len = half;
      } else {
        from = mid + 1;
        len = len - half - 1;
      }
    }
    return from;
  }

  // faster than lower when val is at the end of [from:to[
  /** @internal package-private in Java */
  lower2(from: number, to: number, val: number): number {
    let f = to - 1,
      t = to;
    while (f > from) {
      if (this.compare(f, val) < 0) {
        return this.lower(f, t, val);
      }
      const delta = t - f;
      t = f;
      f -= delta << 1;
    }
    return this.lower(from, t, val);
  }

  // faster than upper when val is at the beginning of [from:to[
  /** @internal package-private in Java */
  upper2(from: number, to: number, val: number): number {
    let f = from,
      t = f + 1;
    while (t < to) {
      if (this.compare(t, val) > 0) {
        return this.upper(f, t, val);
      }
      const delta = t - f;
      f = t;
      t += delta << 1;
    }
    return this.upper(f, to, val);
  }

  /** @internal package-private in Java */
  reverse(from: number, to: number): void {
    for (--to; from < to; ++from, --to) {
      this.swap(from, to);
    }
  }

  /** @internal package-private in Java */
  rotate(lo: number, mid: number, hi: number): void {
    lassert(() => lo <= mid && mid <= hi);
    if (lo === mid || mid === hi) {
      return;
    }
    this.doRotate(lo, mid, hi);
  }

  /** @internal package-private in Java */
  doRotate(lo: number, mid: number, hi: number): void {
    if (mid - lo === hi - mid) {
      // happens rarely but saves n/2 swaps
      while (mid < hi) {
        this.swap(lo++, mid++);
      }
    } else {
      this.reverse(lo, mid);
      this.reverse(mid, hi);
      this.reverse(lo, hi);
    }
  }

  /** A binary sort implementation that has good performance on small arrays or nearly sorted ones. @internal */
  insertionSort(from: number, to: number): void {
    for (let i = from + 1; i < to; ++i) {
      for (let j = i; j > from; --j) {
        if (this.compare(j - 1, j) > 0) {
          this.swap(j - 1, j);
        } else {
          break;
        }
      }
    }
  }

  /** @internal package-private in Java */
  binarySort(from: number, to: number, i: number = from + 1): void {
    for (; i < to; ++i) {
      let l = from;
      let h = i - 1;
      while (l <= h) {
        const mid = (l + h) >>> 1;
        const cmp = this.compare(i, mid);
        if (cmp < 0) {
          h = mid - 1;
        } else {
          l = mid + 1;
        }
      }
      switch (i - l) {
        case 2:
          this.swap(l + 1, l + 2);
          this.swap(l, l + 1);
          break;
        case 1:
          this.swap(l, l + 1);
          break;
        case 0:
          break;
        default:
          for (let j = i; j > l; --j) {
            this.swap(j - 1, j);
          }
          break;
      }
    }
  }

  /** @internal package-private in Java */
  heapSort(from: number, to: number): void {
    if (to - from <= 1) {
      return;
    }
    this.heapify(from, to);
    for (let end = to - 1; end > from; --end) {
      this.swap(from, end);
      this.siftDown(from, from, end);
    }
  }

  /** @internal package-private in Java */
  heapify(from: number, to: number): void {
    for (let i = Sorter.heapParent(from, to - 1); i >= from; --i) {
      this.siftDown(i, from, to);
    }
  }

  /** @internal package-private in Java */
  siftDown(i: number, from: number, to: number): void {
    for (let leftChild = Sorter.heapChild(from, i); leftChild < to; leftChild = Sorter.heapChild(from, i)) {
      const rightChild = leftChild + 1;
      if (this.compare(i, leftChild) < 0) {
        if (rightChild < to && this.compare(leftChild, rightChild) < 0) {
          this.swap(i, rightChild);
          i = rightChild;
        } else {
          this.swap(i, leftChild);
          i = leftChild;
        }
      } else if (rightChild < to && this.compare(i, rightChild) < 0) {
        this.swap(i, rightChild);
        i = rightChild;
      } else {
        break;
      }
    }
  }

  /** @internal package-private in Java */
  static heapParent(from: number, i: number): number {
    return ((i - 1 - from) >>> 1) + from;
  }

  /** @internal package-private in Java */
  static heapChild(from: number, i: number): number {
    return ((i - from) << 1) + 1 + from;
  }
}
