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

import { DocIdSetIterator } from "../search/DocIdSetIterator.js";
import { lassert } from "./assertions.js";
import { BitSet } from "./BitSet.js";
import { FixedBitSet } from "./FixedBitSet.js";
import { SparseFixedBitSet } from "./SparseFixedBitSet.js";

/**
 * Port of org.apache.lucene.util.BitSetIterator: A {@link DocIdSetIterator} which iterates over set bits in a
 * {@link BitSet}.
 */
export class BitSetIterator extends DocIdSetIterator {
  private static getBitSet<T extends BitSet>(iterator: DocIdSetIterator, clazz: abstract new (...args: never[]) => T): T | null {
    if (iterator instanceof BitSetIterator) {
      const bits = iterator.bits;
      lassert(() => bits !== null);
      if (bits instanceof clazz) {
        return bits as T;
      }
    }
    return null;
  }

  /** If the provided iterator wraps a {@link FixedBitSet}, returns it, otherwise returns null. */
  static getFixedBitSetOrNull(iterator: DocIdSetIterator): FixedBitSet | null {
    return BitSetIterator.getBitSet(iterator, FixedBitSet);
  }

  /** If the provided iterator wraps a {@link SparseFixedBitSet}, returns it, otherwise returns null. */
  static getSparseFixedBitSetOrNull(iterator: DocIdSetIterator): SparseFixedBitSet | null {
    return BitSetIterator.getBitSet(iterator, SparseFixedBitSet);
  }

  private readonly bits: BitSet;
  private readonly length: number;
  private readonly _cost: number;
  private doc = -1;

  /** Sole constructor. */
  constructor(bits: BitSet, cost: number) {
    super();
    this.bits = bits;
    this.length = bits.length();
    this._cost = cost;
  }

  docID(): number {
    return this.doc;
  }

  nextDoc(): number {
    return this.advance(this.doc + 1);
  }

  advance(target: number): number {
    if (target >= this.length) {
      return (this.doc = DocIdSetIterator.NO_MORE_DOCS);
    }
    return (this.doc = this.bits.nextSetBit(target));
  }

  cost(): number {
    return this._cost;
  }
}
