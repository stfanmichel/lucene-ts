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

// Port of org.apache.lucene.util.InPlaceMergeSorter (Lucene 5.2.1).

import { Sorter } from "./Sorter.js";

/**
 * {@link Sorter} implementation based on the merge-sort algorithm that merges
 * in place (no additional memory will be allocated). Small arrays are sorted
 * with insertion sort.
 * @lucene.internal
 */
export abstract class InPlaceMergeSorter extends Sorter {
  /** Create a new {@link InPlaceMergeSorter} */
  constructor() {
    super();
  }

  override sort(from: number, to: number): void {
    this.checkRange(from, to);
    this.mergeSort(from, to);
  }

  /** @internal package-private in Java */
  mergeSort(from: number, to: number): void {
    if (to - from < Sorter.THRESHOLD) {
      this.insertionSort(from, to);
    } else {
      const mid = (from + to) >>> 1;
      this.mergeSort(from, mid);
      this.mergeSort(mid, to);
      this.mergeInPlace(from, mid, to);
    }
  }
}
