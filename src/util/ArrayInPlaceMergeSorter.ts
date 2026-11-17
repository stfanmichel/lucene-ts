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

// Port of org.apache.lucene.util.ArrayInPlaceMergeSorter (Lucene 5.2.1), package-private in Java.

import type { Comparator } from "./Comparator.js";
import { InPlaceMergeSorter } from "./InPlaceMergeSorter.js";

/**
 * An {@link InPlaceMergeSorter} for object arrays.
 * @lucene.internal
 */
export class ArrayInPlaceMergeSorter<T> extends InPlaceMergeSorter {
  private readonly arr: T[];
  private readonly comparator: Comparator<T>;

  /** Create a new {@link ArrayInPlaceMergeSorter}. */
  constructor(arr: T[], comparator: Comparator<T>) {
    super();
    this.arr = arr;
    this.comparator = comparator;
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
}
