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

import { lassert } from "./assertions.js";
import { BitUtil } from "./BitUtil.js";
import { RamUsageEstimator } from "./RamUsageEstimator.js";

/**
 * Port of org.apache.lucene.util.SentinelIntSet: A native int hash-based set where one value is reserved to mean
 * "EMPTY" internally. The space overhead is fairly low as there is only one power-of-two sized int[] to hold the
 * values. The set is re-hashed when adding a value that would make it &gt;= 75% full. Consider extending and
 * over-riding {@link #hash(int)} if the values might be poor hash keys; Lucene docids should be fine.
 * The internal fields are exposed publicly to enable more efficient use at the cost of some safety.
 */
export class SentinelIntSet {
  /** A power-of-2 sized array of keys: the hash table */
  keys: Int32Array;
  count = 0;
  readonly emptyVal: number;
  /** the count at which a rehash should be done */
  rehashCount: number;

  /**
   * Create a set with enough capacity to hold <code>size</code> items without rehashing.
   * @param size the number of items to hold without rehashing
   * @param emptyVal the integer value to use for EMPTY
   */
  constructor(size: number, emptyVal: number) {
    this.emptyVal = emptyVal;
    let tsize = Math.max(BitUtil.nextHighestPowerOfTwo(size), 1);
    this.rehashCount = tsize - (tsize >> 2);
    if (size >= this.rehashCount) {
      // should be able to hold "size" w/o re-hashing
      tsize <<= 1;
      this.rehashCount = tsize - (tsize >> 2);
    }
    this.keys = new Int32Array(tsize);
    if (emptyVal !== 0) this.clear();
  }

  clear(): void {
    this.keys.fill(this.emptyVal);
    this.count = 0;
  }

  /** (internal) Return the hash for the key. The default implementation just returns the key, which is not appropriate for general purpose use. */
  hash(key: number): number {
    return key;
  }

  /** The number of integers in this set. */
  size(): number {
    return this.count;
  }

  /** (internal) Returns the slot for this key */
  getSlot(key: number): number {
    lassert(() => key !== this.emptyVal);
    const h = this.hash(key);
    let s = h & (this.keys.length - 1);
    if (this.keys[s] === key || this.keys[s] === this.emptyVal) return s;

    const increment = (h >> 7) | 1;
    do {
      s = (s + increment) & (this.keys.length - 1);
    } while (this.keys[s] !== key && this.keys[s] !== this.emptyVal);
    return s;
  }

  /** (internal) Returns the slot for this key, or -slot-1 if not found */
  find(key: number): number {
    lassert(() => key !== this.emptyVal);
    const h = this.hash(key);
    let s = h & (this.keys.length - 1);
    if (this.keys[s] === key) return s;
    if (this.keys[s] === this.emptyVal) return -s - 1;

    const increment = (h >> 7) | 1;
    for (;;) {
      s = (s + increment) & (this.keys.length - 1);
      if (this.keys[s] === key) return s;
      if (this.keys[s] === this.emptyVal) return -s - 1;
    }
  }

  /** Does this set contain the specified integer? */
  exists(key: number): boolean {
    return this.find(key) >= 0;
  }

  /** Puts this integer (key) in the set, and returns the slot index it was added to. It rehashes if adding it would make the set more than 75% full. */
  put(key: number): number {
    let s = this.find(key);
    if (s < 0) {
      this.count++;
      if (this.count >= this.rehashCount) {
        this.rehash();
        s = this.getSlot(key);
      } else {
        s = -s - 1;
      }
      this.keys[s] = key;
    }
    return s;
  }

  /** (internal) Rehashes by doubling key (int) array and rehashing the keys. */
  rehash(): void {
    const newSize = this.keys.length << 1;
    const oldKeys = this.keys;
    this.keys = new Int32Array(newSize);
    if (this.emptyVal !== 0) this.keys.fill(this.emptyVal);

    for (const key of oldKeys) {
      if (key === this.emptyVal) continue;
      const newSlot = this.getSlot(key);
      this.keys[newSlot] = key;
    }
    this.rehashCount = newSize - (newSize >> 2);
  }

  /** Return the memory footprint of this class in bytes. */
  ramBytesUsed(): number {
    return (
      RamUsageEstimator.alignObjectSize(RamUsageEstimator.NUM_BYTES_INT * 3 + RamUsageEstimator.NUM_BYTES_OBJECT_REF) +
      RamUsageEstimator.sizeOf(this.keys)
    );
  }
}
