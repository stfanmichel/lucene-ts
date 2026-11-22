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

// Port of org.apache.lucene.util.BitDocIdSet (Lucene 5.2.1).
// BASE_RAM_BYTES_USED is shallowSizeOfInstance on a 64-bit JVM with compressed oops: 12 (header) + 4 (set) + 8 (cost) = 24.

import { DocIdSet } from "../search/DocIdSet.js";
import type { DocIdSetIterator } from "../search/DocIdSetIterator.js";
import type { BitSet } from "./BitSet.js";
import { BitSetIterator } from "./BitSetIterator.js";
import { FixedBitSet } from "./FixedBitSet.js";
import { RamUsageEstimator } from "./RamUsageEstimator.js";
import { SparseFixedBitSet } from "./SparseFixedBitSet.js";

const BASE_RAM_BYTES_USED = RamUsageEstimator.alignObjectSize(12 + 4 + 8);

/**
 * A builder of {@link DocIdSet}s that supports random access.
 * @lucene.internal
 */
export class BitDocIdSetBuilder {
  private readonly maxDoc: number;
  private readonly threshold: number;

  private sparseSet: SparseFixedBitSet | null = null;
  private denseSet: FixedBitSet | null = null;

  // we cache an upper bound of the cost of this builder so that we don't have
  // to re-compute approximateCardinality on the sparse set every time
  private costUpperBound = 0;

  /** Create a new instance that can hold <code>maxDoc</code> documents and is optionally <code>full</code>. */
  constructor(maxDoc: number, full: boolean = false) {
    this.maxDoc = maxDoc;
    this.threshold = maxDoc >>> 10;
    if (full) {
      this.denseSet = new FixedBitSet(maxDoc);
      this.denseSet.set(0, maxDoc);
    }
  }

  /** @internal pkg-private for testing */
  dense(): boolean {
    return this.denseSet !== null;
  }

  /** Is this builder definitely empty? If so, {@link #build()} will return null. This is useful to avoid building empty {@link DocIdSet}s for large indexes if a majority of segments are empty. */
  isDefinitelyEmpty(): boolean {
    return this.sparseSet === null && this.denseSet === null;
  }

  /** Add the content of the provided {@link DocIdSetIterator} to this builder. */
  or(it: DocIdSetIterator): void {
    if (this.denseSet !== null) {
      // already upgraded
      this.denseSet.or(it);
      return;
    }

    const itCost = it.cost();
    this.costUpperBound += itCost;
    if (this.costUpperBound >= this.threshold) {
      this.costUpperBound = (this.sparseSet === null ? 0 : this.sparseSet.approximateCardinality()) + itCost;

      if (this.costUpperBound >= this.threshold) {
        // upgrade
        this.denseSet = new FixedBitSet(this.maxDoc);
        this.denseSet.or(it);
        if (this.sparseSet !== null) {
          this.denseSet.or(new BitSetIterator(this.sparseSet, 0));
        }
        return;
      }
    }

    // we are still sparse
    if (this.sparseSet === null) {
      this.sparseSet = new SparseFixedBitSet(this.maxDoc);
    }
    this.sparseSet.or(it);
  }

  /** Removes from this builder documents that are not contained in <code>it</code>. @deprecated in Lucene 5.2 */
  and(it: DocIdSetIterator): void {
    if (this.denseSet !== null) {
      this.denseSet.and(it);
    } else if (this.sparseSet !== null) {
      this.sparseSet.and(it);
    }
  }

  /** Removes from this builder documents that are contained in <code>it</code>. @deprecated in Lucene 5.2 */
  andNot(it: DocIdSetIterator): void {
    if (this.denseSet !== null) {
      this.denseSet.andNot(it);
    } else if (this.sparseSet !== null) {
      this.sparseSet.andNot(it);
    }
  }

  /** Build a {@link DocIdSet} that contains all doc ids that have been added. This method may return <tt>null</tt> if no documents were added to this builder. NOTE: this is a destructive operation, the builder should not be used anymore after this method has been called! */
  build(): BitDocIdSet | null {
    let result: BitDocIdSet | null;
    if (this.denseSet !== null) {
      result = new BitDocIdSet(this.denseSet);
    } else if (this.sparseSet !== null) {
      result = new BitDocIdSet(this.sparseSet);
    } else {
      result = null;
    }
    this.denseSet = null;
    this.sparseSet = null;
    this.costUpperBound = 0;
    return result;
  }
}

/**
 * Implementation of the {@link DocIdSet} interface on top of a {@link BitSet}.
 */
export class BitDocIdSet extends DocIdSet {
  /** A builder of {@link DocIdSet}s that supports random access. */
  static readonly Builder = BitDocIdSetBuilder;

  private readonly set: BitSet;
  private readonly cost: number;

  /** Wrap the given {@link BitSet} as a {@link DocIdSet}. The provided {@link BitSet} must not be modified afterwards. */
  constructor(set: BitSet, cost?: number) {
    super();
    this.set = set;
    this.cost = cost === undefined ? set.approximateCardinality() : cost;
  }

  iterator(): DocIdSetIterator {
    return new BitSetIterator(this.set, this.cost);
  }

  override bits(): BitSet {
    return this.set;
  }

  override isCacheable(): boolean {
    return true;
  }

  ramBytesUsed(): number {
    return BASE_RAM_BYTES_USED + this.set.ramBytesUsed();
  }

  override toString(): string {
    return "BitDocIdSet(set=" + this.set + ",cost=" + this.cost + ")";
  }
}
