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

import { IllegalStateException } from "../errors.js";
import { DocIdSetIterator } from "../search/DocIdSetIterator.js";
import type { Accountable } from "./Accountable.js";
import { lassert } from "./assertions.js";
import type { MutableBits } from "./MutableBits.js";

/**
 * Port of org.apache.lucene.util.BitSet: Base implementation for a bit set.
 *
 * Deviation: the Java overloads {@code clear(int)} (from MutableBits) and {@code clear(int, int)} are one method
 * here, told apart by the number of arguments.
 */
export abstract class BitSet implements MutableBits, Accountable {
  abstract get(index: number): boolean;

  abstract length(): number;

  /** Set the bit at <code>i</code>. */
  abstract set(i: number): void;

  /** Clears a range of bits, or (one argument) the bit at <code>index</code>. */
  abstract clear(startIndex: number, endIndex?: number): void;

  /** Return the number of bits that are set. NOTE: this method is likely to run in linear time */
  abstract cardinality(): number;

  /**
   * Return an approximation of the cardinality of this set. Some implementations may trade accuracy for speed if
   * they have the ability to estimate the cardinality of the set without iterating over all the data. The default
   * implementation returns {@link #cardinality()}.
   */
  approximateCardinality(): number {
    return this.cardinality();
  }

  /**
   * Returns the index of the last set bit before or on the index specified. -1 is returned if there are no more
   * set bits.
   */
  abstract prevSetBit(index: number): number;

  /**
   * Returns the index of the first set bit starting at the index specified. {@link DocIdSetIterator#NO_MORE_DOCS}
   * is returned if there are no more set bits.
   */
  abstract nextSetBit(index: number): number;

  /** Assert that the current doc is -1. */
  protected assertUnpositioned(iter: DocIdSetIterator): void {
    if (iter.docID() !== -1) {
      throw new IllegalStateException("This operation only works with an unpositioned iterator, got current position = " + iter.docID());
    }
  }

  /** Does in-place OR of the bits provided by the iterator. */
  or(iter: DocIdSetIterator): void {
    this.assertUnpositioned(iter);
    for (let doc = iter.nextDoc(); doc !== DocIdSetIterator.NO_MORE_DOCS; doc = iter.nextDoc()) {
      this.set(doc);
    }
  }

  private leapFrog(iter: DocIdSetIterator, onMatch: (doc: number) => void, finish: () => void): void {
    const length = this.length();
    let bitSetDoc = -1;
    let disiDoc = iter.nextDoc();
    for (;;) {
      // invariant: bitSetDoc <= disiDoc
      lassert(() => bitSetDoc <= disiDoc);
      if (disiDoc >= length) {
        finish();
        return;
      }
      if (bitSetDoc < disiDoc) {
        bitSetDoc = this.nextSetBit(disiDoc);
      }
      if (bitSetDoc === disiDoc) {
        onMatch(bitSetDoc);
        disiDoc = iter.nextDoc();
      } else {
        disiDoc = iter.advance(bitSetDoc);
      }
    }
  }

  /** Does in-place AND of the bits provided by the iterator. @deprecated in Lucene 5.2 */
  and(iter: DocIdSetIterator): void {
    this.assertUnpositioned(iter);
    let previous = -1;
    this.leapFrog(
      iter,
      (doc) => {
        this.clear(previous + 1, doc);
        previous = doc;
      },
      () => {
        if (previous + 1 < this.length()) {
          this.clear(previous + 1, this.length());
        }
      }
    );
  }

  /** Does in-place AND NOT of the bits provided by the iterator. @deprecated in Lucene 5.2 */
  andNot(iter: DocIdSetIterator): void {
    this.assertUnpositioned(iter);
    this.leapFrog(
      iter,
      (doc) => {
        this.clear(doc);
      },
      () => {}
    );
  }

  abstract ramBytesUsed(): number;

  getChildResources(): readonly Accountable[] {
    return [];
  }
}
