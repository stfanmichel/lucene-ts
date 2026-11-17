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

// Port of org.apache.lucene.util.CollectionUtil (Lucene 5.2.1).
//
// Java's java.util.List (restricted to RandomAccess lists, which is all CollectionUtil accepts)
// is a plain TypeScript array here, so the "can only sort random access lists" check is moot.

import { ArrayUtil } from "./ArrayUtil.js";
import type { Comparable, Comparator } from "./Comparator.js";
import { IntroSorter } from "./IntroSorter.js";
import { TimSorter } from "./TimSorter.js";

class ListIntroSorter<T> extends IntroSorter {
  pivot: T | undefined;
  readonly list: T[];
  readonly comp: Comparator<T>;

  constructor(list: T[], comp: Comparator<T>) {
    super();
    this.list = list;
    this.comp = comp;
  }

  protected override setPivot(i: number): void {
    this.pivot = this.list[i];
  }

  protected override swap(i: number, j: number): void {
    // Collections.swap
    const tmp = this.list[i]!;
    this.list[i] = this.list[j]!;
    this.list[j] = tmp;
  }

  protected override compare(i: number, j: number): number {
    return this.comp(this.list[i]!, this.list[j]!);
  }

  protected override comparePivot(j: number): number {
    return this.comp(this.pivot!, this.list[j]!);
  }
}

class ListTimSorter<T> extends TimSorter {
  readonly list: T[];
  readonly comp: Comparator<T>;
  readonly tmp: T[] | null;

  constructor(list: T[], comp: Comparator<T>, maxTempSlots: number) {
    super(maxTempSlots);
    this.list = list;
    this.comp = comp;
    if (maxTempSlots > 0) {
      this.tmp = new Array<T>(maxTempSlots);
    } else {
      this.tmp = null;
    }
  }

  protected override swap(i: number, j: number): void {
    // Collections.swap
    const tmp = this.list[i]!;
    this.list[i] = this.list[j]!;
    this.list[j] = tmp;
  }

  protected override copy(src: number, dest: number): void {
    this.list[dest] = this.list[src]!;
  }

  protected override save(i: number, len: number): void {
    for (let j = 0; j < len; ++j) {
      this.tmp![j] = this.list[i + j]!;
    }
  }

  protected override restore(i: number, j: number): void {
    this.list[j] = this.tmp![i]!;
  }

  protected override compare(i: number, j: number): number {
    return this.comp(this.list[i]!, this.list[j]!);
  }

  protected override compareSaved(i: number, j: number): number {
    return this.comp(this.tmp![i]!, this.list[j]!);
  }
}

/**
 * Methods for manipulating (sorting) collections.
 * Sort methods work directly on the supplied lists and don't copy to/from arrays
 * before/after. For medium size collections as used in the Lucene indexer that is
 * much more efficient.
 *
 * @lucene.internal
 */
export class CollectionUtil {
  private constructor() {} // no instance

  /**
   * Sorts the given list in natural order, or with the given comparator.
   * This method uses the intro sort algorithm, but falls back to insertion sort for small lists.
   */
  static introSort<T>(list: T[], comp: Comparator<T>): void;
  static introSort<T extends Comparable<T>>(list: T[]): void;
  static introSort<T>(list: T[], comp?: Comparator<T>): void {
    const size = list.length;
    if (size <= 1) return;
    new ListIntroSorter<T>(list, comp ?? (ArrayUtil.naturalComparator() as unknown as Comparator<T>)).sort(0, size);
  }

  // Tim sorts:

  /**
   * Sorts the given list in natural order, or with the given comparator.
   * This method uses the Tim sort algorithm, but falls back to binary sort for small lists.
   */
  static timSort<T>(list: T[], comp: Comparator<T>): void;
  static timSort<T extends Comparable<T>>(list: T[]): void;
  static timSort<T>(list: T[], comp?: Comparator<T>): void {
    const size = list.length;
    if (size <= 1) return;
    new ListTimSorter<T>(
      list,
      comp ?? (ArrayUtil.naturalComparator() as unknown as Comparator<T>),
      Math.trunc(list.length / 64),
    ).sort(0, size);
  }
}
