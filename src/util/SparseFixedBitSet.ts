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

// Port of org.apache.lucene.util.SparseFixedBitSet (Lucene 5.2.1).
//
// Deviations: long[] is a BigInt64Array and long[][] an array of BigInt64Array|null; the Java fields `length` and
// `ramBytesUsed` collide with the methods of the same name, so they are `_length` and `ramBytesUsedValue`; the
// overloaded private or(...) are orBlock (one 4096-bit block) and orSparse (another SparseFixedBitSet).
// BASE_RAM_BYTES_USED is shallowSizeOfInstance on a 64-bit JVM with compressed oops: 12 (header) + 4 (indices) + 4
// (bits) + 4 (length) + 4 (nonZeroLongCount) + 8 (ramBytesUsed) = 36, aligned to 40.

import { ArrayIndexOutOfBoundsException, IllegalArgumentException } from "../errors.js";
import { DocIdSetIterator } from "../search/DocIdSetIterator.js";
import type { Accountable } from "./Accountable.js";
import { lassert } from "./assertions.js";
import { BitSet } from "./BitSet.js";
import { BitSetIterator } from "./BitSetIterator.js";
import { Long } from "./JavaNumbers.js";
import { RamUsageEstimator } from "./RamUsageEstimator.js";
import type { Bits } from "./Bits.js";

const BASE_RAM_BYTES_USED = RamUsageEstimator.alignObjectSize(12 + 4 + 4 + 4 + 4 + 8);
const SINGLE_ELEMENT_ARRAY_BYTES_USED = RamUsageEstimator.sizeOf(new BigInt64Array(1));
const MASK_4096 = (1 << 12) - 1;

function blockCount(length: number): number {
  let blockCount = length >>> 12;
  if (blockCount << 12 < length) {
    ++blockCount;
  }
  lassert(() => blockCount << 12 >= length);
  return blockCount;
}

function oversize(s: number): number {
  let newSize = s + (s >>> 1);
  if (newSize > 50) {
    newSize = 64;
  }
  return newSize;
}

/** create a long that has bits set to one between from and to */
function mask(from: number, to: number): bigint {
  return Long.shl(BigInt.asIntN(64, Long.shl(Long.bit(to - from), 1) - 1n), from);
}

/**
 * A bit set that only stores longs that have at least one bit which is set. The way it works is that the space of
 * bits is divided into blocks of 4096 bits, which is 64 longs. Then for each block, we have:
 * <ul>
 * <li>a long[] which stores the non-zero longs for that block</li>
 * <li>a long so that bit <code>i</code> being set means that the <code>i-th</code> long of the block is non-null,
 *     and its offset in the array of longs is the number of one bits on the right of the <code>i-th</code> bit.</li>
 * </ul>
 */
export class SparseFixedBitSet extends BitSet implements Bits, Accountable {
  /** @internal */ indices: BigInt64Array;
  /** @internal */ bits: Array<BigInt64Array | null>;
  /** @internal */ _length: number;
  /** @internal */ nonZeroLongCount = 0;
  /** @internal */ ramBytesUsedValue: number;

  /** Create a {@link SparseFixedBitSet} that can contain bits between 0 included and <code>length</code> excluded. */
  constructor(length: number) {
    super();
    if (length < 1) {
      throw new IllegalArgumentException("length needs to be >= 1");
    }
    this._length = length;
    const blocks = blockCount(length);
    this.indices = new BigInt64Array(blocks);
    this.bits = new Array<BigInt64Array | null>(blocks).fill(null);
    this.ramBytesUsedValue = BASE_RAM_BYTES_USED + RamUsageEstimator.shallowSizeOf(this.indices) + RamUsageEstimator.shallowSizeOf(this.bits);
  }

  length(): number {
    return this._length;
  }

  private consistent(index: number): boolean {
    lassert(() => index >= 0 && index < this._length, () => "index=" + index + ",length=" + this._length);
    return true;
  }

  cardinality(): number {
    let cardinality = 0;
    for (const bitArray of this.bits) {
      if (bitArray !== null) {
        for (const bits of bitArray) {
          cardinality += Long.bitCount(bits);
        }
      }
    }
    return cardinality;
  }

  /**
   * Return an approximate cardinality of this set. This method is accurate when the set is sparse but not accurate
   * when it is dense, since the estimate is based on the number of longs that are different from zero.
   */
  override approximateCardinality(): number {
    // we are assuming that bits are uniformly set and use the linear counting
    // algorithm to estimate the number of bits that are set based on the number
    // of longs that are different from zero
    const totalLongs = (this._length + 63) >>> 6; // total number of longs in the space
    lassert(() => totalLongs >= this.nonZeroLongCount);
    const zeroLongs = totalLongs - this.nonZeroLongCount; // number of longs that are zeros
    // No need to guard against division by zero, it will return +Infinity and things will work as expected
    const estimate = Math.round(totalLongs * Math.log(totalLongs / zeroLongs));
    return Math.min(this._length, estimate) | 0;
  }

  get(i: number): boolean {
    lassert(() => this.consistent(i));
    const i4096 = i >>> 12;
    const index = this.indices[i4096]!;
    const i64 = i >>> 6;
    // first check the index, if the i64-th bit is not set, then i is not set
    // note: this relies on the fact that shifts are mod 64 in java
    if ((index & Long.bit(i64)) === 0n) {
      return false;
    }

    // if it is set, then we count the number of bits that are set on the right
    // of i64, and that gives us the index of the long that stores the bits we
    // are interested in
    const bits = this.bits[i4096]![Long.bitCount(index & Long.lowMask(i64))]!;
    return (bits & Long.bit(i)) !== 0n;
  }

  /** Set the bit at index <code>i</code>. */
  set(i: number): void {
    lassert(() => this.consistent(i));
    const i4096 = i >>> 12;
    const index = this.indices[i4096]!;
    const i64 = i >>> 6;
    if ((index & Long.bit(i64)) !== 0n) {
      // in that case the sub 64-bits block we are interested in already exists,
      // we just need to set a bit in an existing long: the number of ones on
      // the right of i64 gives us the index of the long we need to update
      const arr = this.bits[i4096]!;
      const o = Long.bitCount(index & Long.lowMask(i64));
      arr[o] = arr[o]! | Long.bit(i); // shifts are mod 64 in java
    } else if (index === 0n) {
      // if the index is 0, it means that we just found a block of 4096 bits
      // that has no bit that is set yet. So let's initialize a new block:
      this.insertBlock(i4096, i64, i);
    } else {
      // in that case we found a block of 4096 bits that has some values, but
      // the sub-block of 64 bits that we are interested in has no value yet,
      // so we need to insert a new long
      this.insertLong(i4096, i64, i, index);
    }
  }

  private insertBlock(i4096: number, i64: number, i: number): void {
    this.indices[i4096] = Long.bit(i64); // shifts are mod 64 in java
    lassert(() => this.bits[i4096] === null);
    this.bits[i4096] = BigInt64Array.of(Long.bit(i)); // shifts are mod 64 in java
    ++this.nonZeroLongCount;
    this.ramBytesUsedValue += SINGLE_ELEMENT_ARRAY_BYTES_USED;
  }

  private insertLong(i4096: number, i64: number, i: number, index: bigint): void {
    this.indices[i4096] = this.indices[i4096]! | Long.bit(i64); // shifts are mod 64 in java
    // we count the number of bits that are set on the right of i64
    // this gives us the index at which to perform the insertion
    const o = Long.bitCount(index & Long.lowMask(i64));
    const bitArray = this.bits[i4096]!;
    if (bitArray[bitArray.length - 1] === 0n) {
      // since we only store non-zero longs, if the last value is 0, it means
      // that we alreay have extra space, make use of it
      bitArray.copyWithin(o + 1, o, bitArray.length - 1);
      bitArray[o] = Long.bit(i);
    } else {
      // we don't have extra space so we need to resize to insert the new long
      const newSize = oversize(bitArray.length + 1);
      const newBitArray = new BigInt64Array(newSize);
      newBitArray.set(bitArray.subarray(0, o), 0);
      newBitArray[o] = Long.bit(i);
      newBitArray.set(bitArray.subarray(o), o + 1);
      this.bits[i4096] = newBitArray;
      this.ramBytesUsedValue += RamUsageEstimator.sizeOf(newBitArray) - RamUsageEstimator.sizeOf(bitArray);
    }
    ++this.nonZeroLongCount;
  }

  /** Clear the bit at index <code>i</code> (one argument), or every bit of [from, to). */
  clear(from: number, to?: number): void {
    if (to === undefined) {
      const i = from;
      lassert(() => this.consistent(i));
      const i4096 = i >>> 12;
      const i64 = i >>> 6;
      this.andBlock(i4096, i64, ~Long.bit(i));
      return;
    }
    lassert(() => from >= 0);
    lassert(() => to <= this._length);
    if (from >= to) {
      return;
    }
    const firstBlock = from >>> 12;
    const lastBlock = (to - 1) >>> 12;
    if (firstBlock === lastBlock) {
      this.clearWithinBlock(firstBlock, from & MASK_4096, (to - 1) & MASK_4096);
    } else {
      this.clearWithinBlock(firstBlock, from & MASK_4096, MASK_4096);
      for (let i = firstBlock + 1; i < lastBlock; ++i) {
        this.nonZeroLongCount -= Long.bitCount(this.indices[i]!);
        this.indices[i] = 0n;
        this.bits[i] = null;
      }
      this.clearWithinBlock(lastBlock, 0, (to - 1) & MASK_4096);
    }
  }

  /** Perform a logical AND on the long at position <code>i64</code> of the block <code>i4096</code>. */
  private andBlock(i4096: number, i64: number, mask: bigint): void {
    const index = this.indices[i4096]!;
    if ((index & Long.bit(i64)) !== 0n) {
      // offset of the long bits we are interested in in the array
      const o = Long.bitCount(index & Long.lowMask(i64));
      const bits = this.bits[i4096]![o]! & mask;
      if (bits === 0n) {
        this.removeLong(i4096, i64, index, o);
      } else {
        this.bits[i4096]![o] = bits;
      }
    }
  }

  private removeLong(i4096: number, i64: number, index: bigint, o: number): void {
    index &= ~Long.bit(i64);
    this.indices[i4096] = index;
    if (index === 0n) {
      // release memory, there is nothing in this block anymore
      this.bits[i4096] = null;
    } else {
      const length = Long.bitCount(index);
      const bitArray = this.bits[i4096]!;
      bitArray.copyWithin(o, o + 1, o + 1 + (length - o));
      bitArray[length] = 0n;
    }
    this.nonZeroLongCount -= 1;
  }

  private clearWithinBlock(i4096: number, from: number, to: number): void {
    const firstLong = from >>> 6;
    const lastLong = to >>> 6;

    if (firstLong === lastLong) {
      this.andBlock(i4096, firstLong, ~mask(from, to));
    } else {
      lassert(() => firstLong < lastLong);
      this.andBlock(i4096, lastLong, ~mask(0, to));
      for (let i = lastLong - 1; i >= firstLong + 1; --i) {
        this.andBlock(i4096, i, 0n);
      }
      this.andBlock(i4096, firstLong, ~mask(from, 63));
    }
  }

  /** Return the first document that occurs on or after the provided block index. */
  private firstDoc(i4096: number): number {
    let index = 0n;
    while (i4096 < this.indices.length) {
      index = this.indices[i4096]!;
      if (index !== 0n) {
        const i64 = Long.numberOfTrailingZeros(index);
        return (i4096 << 12) | (i64 << 6) | Long.numberOfTrailingZeros(this.bits[i4096]![0]!);
      }
      i4096 += 1;
    }
    return DocIdSetIterator.NO_MORE_DOCS;
  }

  nextSetBit(i: number): number {
    lassert(() => i < this._length);
    const i4096 = i >>> 12;
    if (i4096 >= this.indices.length) {
      // (Java's indices[i4096] throws here, a typed array would read undefined)
      throw new ArrayIndexOutOfBoundsException("Index " + i4096 + " out of bounds for length " + this.indices.length);
    }
    const index = this.indices[i4096]!;
    const bitArray = this.bits[i4096]!;
    let i64 = i >>> 6;
    let o = Long.bitCount(index & Long.lowMask(i64));
    if ((index & Long.bit(i64)) !== 0n) {
      // There is at least one bit that is set in the current long, check if
      // one of them is after i
      const bits = Long.ushr(bitArray[o]!, i); // shifts are mod 64
      if (bits !== 0n) {
        return i + Long.numberOfTrailingZeros(bits);
      }
      o += 1;
    }
    const indexBits = Long.ushr(Long.ushr(index, i64), 1);
    if (indexBits === 0n) {
      // no more bits are set in the current block of 4096 bits, go to the next one
      return this.firstDoc(i4096 + 1);
    }
    // there are still set bits
    i64 += 1 + Long.numberOfTrailingZeros(indexBits);
    const bits = bitArray[o]!;
    return (i64 << 6) | Long.numberOfTrailingZeros(bits);
  }

  /** Return the last document that occurs on or before the provided block index. */
  private lastDoc(i4096: number): number {
    let index: bigint;
    while (i4096 >= 0) {
      index = this.indices[i4096]!;
      if (index !== 0n) {
        const i64 = 63 - Long.numberOfLeadingZeros(index);
        const bits = this.bits[i4096]![Long.bitCount(index) - 1]!;
        return (i4096 << 12) | (i64 << 6) | (63 - Long.numberOfLeadingZeros(bits));
      }
      i4096 -= 1;
    }
    return -1;
  }

  prevSetBit(i: number): number {
    lassert(() => i >= 0);
    const i4096 = i >>> 12;
    if (i4096 >= this.indices.length) {
      // (Java's indices[i4096] throws here, a typed array would read undefined)
      throw new ArrayIndexOutOfBoundsException("Index " + i4096 + " out of bounds for length " + this.indices.length);
    }
    const index = this.indices[i4096]!;
    const bitArray = this.bits[i4096]!;
    let i64 = i >>> 6;
    const indexBits = index & Long.lowMask(i64);
    const o = Long.bitCount(indexBits);
    if ((index & Long.bit(i64)) !== 0n) {
      // There is at least one bit that is set in the same long, check if there
      // is one bit that is set that is lower than i
      const bits = bitArray[o]! & BigInt.asIntN(64, Long.shl(Long.shl(1n, i), 1) - 1n);
      if (bits !== 0n) {
        return (i64 << 6) | (63 - Long.numberOfLeadingZeros(bits));
      }
    }
    if (indexBits === 0n) {
      // no more bits are set in this block, go find the last bit in the
      // previous block
      return this.lastDoc(i4096 - 1);
    }
    // go to the previous long
    i64 = 63 - Long.numberOfLeadingZeros(indexBits);
    const bits = bitArray[o - 1]!;
    return (i4096 << 12) | (i64 << 6) | (63 - Long.numberOfLeadingZeros(bits));
  }

  /** Return the long bits at the given <code>i64</code> index. */
  private longBits(index: bigint, bits: BigInt64Array, i64: number): bigint {
    if ((index & Long.bit(i64)) === 0n) {
      return 0n;
    } else {
      return bits[Long.bitCount(index & Long.lowMask(i64))]!;
    }
  }

  private orBlock(i4096: number, index: bigint, bits: BigInt64Array, nonZeroLongCount: number): void {
    lassert(() => Long.bitCount(index) === nonZeroLongCount);
    if (i4096 < 0 || i4096 >= this.indices.length) {
      // e.g. or-ing a longer set: Java's indices[i4096] throws (a typed array would read undefined)
      throw new ArrayIndexOutOfBoundsException("Index " + i4096 + " out of bounds for length " + this.indices.length);
    }
    const currentIndex = this.indices[i4096]!;
    if (currentIndex === 0n) {
      // fast path: if we currently have nothing in the block, just copy the data
      // this especially happens all the time if you call OR on an empty set
      this.indices[i4096] = index;
      this.bits[i4096] = bits.slice(0, nonZeroLongCount);
      this.nonZeroLongCount += nonZeroLongCount;
      return;
    }
    const currentBits = this.bits[i4096]!;
    let newBits: BigInt64Array;
    const newIndex = currentIndex | index;
    const requiredCapacity = Long.bitCount(newIndex);
    if (currentBits.length >= requiredCapacity) {
      newBits = currentBits;
    } else {
      newBits = new BigInt64Array(oversize(requiredCapacity));
    }
    // we iterate backwards in order to not override data we might need on the next iteration if the
    // array is reused
    for (
      let i = Long.numberOfLeadingZeros(newIndex), newO = Long.bitCount(newIndex) - 1;
      i < 64;
      i += 1 + Long.numberOfLeadingZeros(Long.shl(newIndex, i + 1)), newO -= 1
    ) {
      // bitIndex is the index of a bit which is set in newIndex and newO is the number of 1 bits on its right
      const bitIndex = 63 - i;
      const o = newO;
      lassert(() => o === Long.bitCount(newIndex & Long.lowMask(bitIndex)));
      newBits[newO] = this.longBits(currentIndex, currentBits, bitIndex) | this.longBits(index, bits, bitIndex);
    }
    this.indices[i4096] = newIndex;
    this.bits[i4096] = newBits;
    this.nonZeroLongCount += nonZeroLongCount - Long.bitCount(currentIndex & index);
  }

  private orSparse(other: SparseFixedBitSet): void {
    for (let i = 0; i < other.indices.length; ++i) {
      const index = other.indices[i]!;
      if (index !== 0n) {
        this.orBlock(i, index, other.bits[i]!, Long.bitCount(index));
      }
    }
  }

  /**
   * Add the documents contained in the provided {@link DocIdSetIterator} to this bit set.
   * This is the dense path: the iterator is assumed to return many docs.
   */
  private orDense(it: DocIdSetIterator): void {
    this.assertUnpositioned(it);
    // The goal here is to try to take advantage of the ordering of documents
    // to build the data-structure more efficiently
    // NOTE: this heavily relies on the fact that shifts are mod 64
    const firstDoc = it.nextDoc();
    if (firstDoc === DocIdSetIterator.NO_MORE_DOCS) {
      return;
    }
    let i4096 = firstDoc >>> 12;
    let i64 = firstDoc >>> 6;
    let index = Long.bit(i64);
    let currentLong = Long.bit(firstDoc);
    // we store at most 64 longs per block so preallocate in order never to have to resize
    const longs = new BigInt64Array(64);
    let numLongs = 0;

    for (let doc = it.nextDoc(); doc !== DocIdSetIterator.NO_MORE_DOCS; doc = it.nextDoc()) {
      const doc64 = doc >>> 6;
      if (doc64 === i64) {
        // still in the same long, just set the bit
        currentLong |= Long.bit(doc);
      } else {
        longs[numLongs++] = currentLong;

        const doc4096 = doc >>> 12;
        if (doc4096 === i4096) {
          index |= Long.bit(doc64);
        } else {
          // we are on a new block, flush what we buffered
          this.orBlock(i4096, index, longs, numLongs);
          // and reset state for the new block
          i4096 = doc4096;
          index = Long.bit(doc64);
          numLongs = 0;
        }

        // we are on a new long, reset state
        i64 = doc64;
        currentLong = Long.bit(doc);
      }
    }

    // flush
    longs[numLongs++] = currentLong;
    this.orBlock(i4096, index, longs, numLongs);
  }

  override or(it: DocIdSetIterator): void {
    {
      // specialize union with another SparseFixedBitSet
      const other = BitSetIterator.getSparseFixedBitSetOrNull(it);
      if (other !== null) {
        this.assertUnpositioned(it);
        this.orSparse(other);
        return;
      }
    }

    // We do not specialize the union with a FixedBitSet since FixedBitSets are
    // supposed to be used for dense data and sparse fixed bit sets for sparse
    // data, so a sparse set would likely get upgraded by DocIdSetBuilder before
    // being or'ed with a FixedBitSet

    if (it.cost() < this.indices.length) {
      // the default impl is good for sparse iterators
      super.or(it);
    } else {
      this.orDense(it);
    }
  }

  // AND and AND_NOT do not need much specialization here since this sparse set
  // is supposed to be used on sparse data and the default AND/AND_NOT impl
  // (leap frog) is efficient when at least one of the sets contains sparse data

  override and(it: DocIdSetIterator): void {
    const other = BitSetIterator.getSparseFixedBitSetOrNull(it);
    if (other !== null) {
      // if we are merging with another SparseFixedBitSet, a quick win is
      // to clear up some blocks by only looking at their index. Then the set
      // is sparser and the leap-frog approach of the parent class is more
      // efficient. Since SparseFixedBitSet is supposed to be used for sparse
      // sets, the intersection of two SparseFixedBitSet is likely very sparse
      const numCommonBlocks = Math.min(this.indices.length, other.indices.length);
      for (let i = 0; i < numCommonBlocks; ++i) {
        if ((this.indices[i]! & other.indices[i]!) === 0n) {
          this.nonZeroLongCount -= Long.bitCount(this.indices[i]!);
          this.indices[i] = 0n;
          this.bits[i] = null;
        }
      }
    }
    super.and(it);
  }

  ramBytesUsed(): number {
    return this.ramBytesUsedValue;
  }

  override toString(): string {
    return "SparseFixedBitSet(size=" + this._length + ",cardinality=~" + this.approximateCardinality();
  }
}
