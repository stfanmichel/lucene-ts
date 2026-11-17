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

// Port of org.apache.lucene.util.IntroSorter (Lucene 5.2.1).

import { Sorter } from "./Sorter.js";

/**
 * {@link Sorter} implementation based on a variant of the quicksort algorithm
 * called <a href="http://en.wikipedia.org/wiki/Introsort">introsort</a>: when
 * the recursion level exceeds the log of the length of the array to sort, it
 * falls back to heapsort. This prevents quicksort from running into its
 * worst-case quadratic runtime. Small arrays are sorted with
 * insertion sort.
 * @lucene.internal
 */
export abstract class IntroSorter extends Sorter {
  /** @internal package-private in Java */
  static ceilLog2(n: number): number {
    // Integer.SIZE - Integer.numberOfLeadingZeros(n - 1)
    return 32 - Math.clz32(n - 1);
  }

  /** Create a new {@link IntroSorter}. */
  constructor() {
    super();
  }

  override sort(from: number, to: number): void {
    this.checkRange(from, to);
    this.quicksort(from, to, IntroSorter.ceilLog2(to - from));
  }

  /** @internal package-private in Java */
  quicksort(from: number, to: number, maxDepth: number): void {
    if (to - from < Sorter.THRESHOLD) {
      this.insertionSort(from, to);
      return;
    } else if (--maxDepth < 0) {
      this.heapSort(from, to);
      return;
    }

    const mid = (from + to) >>> 1;

    if (this.compare(from, mid) > 0) {
      this.swap(from, mid);
    }

    if (this.compare(mid, to - 1) > 0) {
      this.swap(mid, to - 1);
      if (this.compare(from, mid) > 0) {
        this.swap(from, mid);
      }
    }

    let left = from + 1;
    let right = to - 2;

    this.setPivot(mid);
    for (;;) {
      while (this.comparePivot(right) < 0) {
        --right;
      }

      while (left < right && this.comparePivot(left) >= 0) {
        ++left;
      }

      if (left < right) {
        this.swap(left, right);
        --right;
      } else {
        break;
      }
    }

    this.quicksort(from, left + 1, maxDepth);
    this.quicksort(left + 1, to, maxDepth);
  }

  // Don't rely on the slow default impl of setPivot/comparePivot since
  // quicksort relies on these methods to be fast for good performance

  /** Save the value at slot i so that it can later be used as a pivot, see {@link comparePivot}. */
  protected abstract setPivot(i: number): void;

  /**
   * Compare the pivot with the slot at j, similarly to {@link compare}.
   */
  protected abstract comparePivot(j: number): number;
}
