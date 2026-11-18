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

import { javaStringHashCode } from "./JavaNumbers.js";

/**
 * Orders string keys the way iterating a java.util.HashMap / HashSet would, for a map built with the
 * default constructor by inserting the (distinct) keys one by one in the given order, without removals.
 *
 * Lucene serializes maps and sets by iterating them, so reproducing the iteration order keeps the
 * bytes it writes identical to the Java ones. Table size: 16, doubling whenever the size exceeds 75%
 * of it; bucket = (h ^ (h >>> 16)) & (size - 1); entries of a bucket stay in insertion order (a resize
 * preserves the relative order). Java's tree bins (>= 8 colliding keys in a table of >= 64) are not modelled.
 */
export function javaHashOrder(distinctKeysInInsertionOrder: readonly string[]): string[] {
  let capacity = 16;
  while (distinctKeysInInsertionOrder.length > capacity * 0.75) {
    capacity *= 2;
  }
  const buckets = new Map<number, string[]>();
  for (const key of distinctKeysInInsertionOrder) {
    const h = javaStringHashCode(key);
    const bucket = ((h ^ (h >>> 16)) & (capacity - 1)) >>> 0;
    const list = buckets.get(bucket);
    if (list === undefined) buckets.set(bucket, [key]);
    else list.push(key);
  }
  const out: string[] = [];
  for (const bucket of [...buckets.keys()].sort((a, b) => a - b)) {
    out.push(...buckets.get(bucket)!);
  }
  return out;
}

/** Natural ordering of java.lang.String (UTF-16 code unit order, which is also JavaScript's default). */
export function compareJavaStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
