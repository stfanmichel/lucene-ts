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

// Port of org.apache.lucene.util.ArrayTimSorter (Lucene 5.2.1), package-private in Java.

import type { Comparator } from "./Comparator.js";
import { TimSorter } from "./TimSorter.js";

/**
 * A {@link TimSorter} for object arrays.
 * @lucene.internal
 */
export class ArrayTimSorter<T> extends TimSorter {
  private readonly comparator: Comparator<T>;
  private readonly arr: T[];
  private readonly tmp: T[] | null;

  /** Create a new {@link ArrayTimSorter}. */
  constructor(arr: T[], comparator: Comparator<T>, maxTempSlots: number) {
    super(maxTempSlots);
    this.arr = arr;
    this.comparator = comparator;
    if (maxTempSlots > 0) {
      this.tmp = new Array<T>(maxTempSlots);
    } else {
      this.tmp = null;
    }
  }

  protected override compare(i: number, j: number): number {
    return this.comparator(this.arr[i]!, this.arr[j]!);
  }

  protected override swap(i: number, j: number): void {
    // ArrayUtil.swap (inlined to avoid an import cycle with ArrayUtil)
    const tmp = this.arr[i]!;
    this.arr[i] = this.arr[j]!;
    this.arr[j] = tmp;
  }

  protected override copy(src: number, dest: number): void {
    this.arr[dest] = this.arr[src]!;
  }

  protected override save(start: number, len: number): void {
    // System.arraycopy(arr, start, tmp, 0, len)
    for (let k = 0; k < len; k++) {
      this.tmp![k] = this.arr[start + k]!;
    }
  }

  protected override restore(src: number, dest: number): void {
    this.arr[dest] = this.tmp![src]!;
  }

  protected override compareSaved(i: number, j: number): number {
    return this.comparator(this.tmp![i]!, this.arr[j]!);
  }
}
