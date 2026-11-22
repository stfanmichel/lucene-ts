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

// Port of org.apache.lucene.util.FixedBitSet (Lucene 5.2.1).
//
// Deviations: long[] is a BigInt64Array; the overloaded set/clear/flip (index or range) and or/and/andNot (iterator or
// FixedBitSet) are single methods told apart by the arguments; counts (intersectionCount...) are numbers.
// BASE_RAM_BYTES_USED is RamUsageEstimator.shallowSizeOfInstance(FixedBitSet.class) of a 64-bit JVM with compressed
// oops: 12 (header) + 4 (bits) + 4 (numBits) + 4 (numWords) = 24.

import { ArrayIndexOutOfBoundsException, IllegalArgumentException, NegativeArraySizeException } from "../errors.js";
import { DocIdSetIterator } from "../search/DocIdSetIterator.js";
import { ArrayUtil } from "./ArrayUtil.js";
import { lassert } from "./assertions.js";
import { BitSet } from "./BitSet.js";
import { BitSetIterator } from "./BitSetIterator.js";
import { BitUtil } from "./BitUtil.js";
import { Long } from "./JavaNumbers.js";
import { RamUsageEstimator } from "./RamUsageEstimator.js";

const BASE_RAM_BYTES_USED = RamUsageEstimator.alignObjectSize(12 + 4 + 4 + 4);

/**
 * BitSet of fixed length (numBits), backed by accessible ({@link #getBits}) long[], with support for set/clear/flip
 * of ranges and the usual boolean operations. The ghost bits (beyond numBits in the last word) must stay clear.
 */
export class FixedBitSet extends BitSet {
  private readonly bits: BigInt64Array; // Array of longs holding the bits
  private readonly numBits: number; // The number of bits in use
  private readonly numWords: number; // The exact number of longs needed to hold numBits (<= bits.length)

  /**
   * If the given {@link FixedBitSet} is large enough to hold {@code numBits}, returns the given bits, otherwise
   * returns a new {@link FixedBitSet} which can hold the requested number of bits.
   * <p>
   * <b>NOTE:</b> the returned bitset reuses the underlying {@code long[]} of the given {@code bits} if possible.
   * Also, calling {@link #length()} on the returned bits may return a value greater than {@code numBits}.
   */
  static ensureCapacity(bits: FixedBitSet, numBits: number): FixedBitSet {
    if (numBits < bits.numBits) {
      return bits;
    } else {
      // Depends on the ghost bits being clear!
      // (Otherwise, they may become visible in the new instance)
      const numWords = FixedBitSet.bits2words(numBits);
      let arr = bits.getBits();
      if (numWords >= arr.length) {
        arr = ArrayUtil.grow(arr, numWords + 1);
      }
      return new FixedBitSet(arr, arr.length << 6);
    }
  }

  /** returns the number of 64 bit words it would take to hold numBits */
  static bits2words(numBits: number): number {
    return ((numBits - 1) >> 6) + 1; // I.e.: get the word-offset of the last bit and add one (make sure to use >> so 0 returns 0!)
  }

  /** Returns the popcount or cardinality of the intersection of the two sets. Neither set is modified. */
  static intersectionCount(a: FixedBitSet, b: FixedBitSet): number {
    // Depends on the ghost bits being clear!
    return BitUtil.pop_intersect(a.bits, b.bits, 0, Math.min(a.numWords, b.numWords));
  }

  /** Returns the popcount or cardinality of the union of the two sets. Neither set is modified. */
  static unionCount(a: FixedBitSet, b: FixedBitSet): number {
    // Depends on the ghost bits being clear!
    let tot = BitUtil.pop_union(a.bits, b.bits, 0, Math.min(a.numWords, b.numWords));
    if (a.numWords < b.numWords) {
      tot += BitUtil.pop_array(b.bits, a.numWords, b.numWords - a.numWords);
    } else if (a.numWords > b.numWords) {
      tot += BitUtil.pop_array(a.bits, b.numWords, a.numWords - b.numWords);
    }
    return tot;
  }

  /** Returns the popcount or cardinality of "a and not b" or "intersection(a, not(b))". Neither set is modified. */
  static andNotCount(a: FixedBitSet, b: FixedBitSet): number {
    // Depends on the ghost bits being clear!
    let tot = BitUtil.pop_andnot(a.bits, b.bits, 0, Math.min(a.numWords, b.numWords));
    if (a.numWords > b.numWords) {
      tot += BitUtil.pop_array(a.bits, b.numWords, a.numWords - b.numWords);
    }
    return tot;
  }

  /** Creates a new FixedBitSet with the given number of bits, or one wrapping {@code storedBits}. */
  constructor(numBits: number);
  constructor(storedBits: BigInt64Array, numBits: number);
  constructor(arg: number | BigInt64Array, numBits?: number) {
    super();
    if (typeof arg === "number") {
      this.numBits = arg;
      const n = FixedBitSet.bits2words(arg);
      if (n < 0) throw new NegativeArraySizeException(String(n));
      this.bits = new BigInt64Array(n);
      this.numWords = this.bits.length;
    } else {
      this.numWords = FixedBitSet.bits2words(numBits!);
      if (this.numWords > arg.length) {
        throw new IllegalArgumentException("The given long array is too small  to hold " + numBits + " bits");
      }
      this.numBits = numBits!;
      this.bits = arg;
      lassert(() => this.verifyGhostBitsClear());
    }
  }

  /** Checks if the bits past numBits are clear. Some methods rely on this implicit assumption: search for "Depends on the ghost bits being clear!" */
  private verifyGhostBitsClear(): boolean {
    // (a negative numWords makes Java's bits[i] throw: the reads are bounds checked)
    for (let i = this.numWords; i < this.bits.length; i++) {
      if (this.checkedWord(i) !== 0n) return false;
    }

    if ((this.numBits & 0x3f) === 0) return true;

    const mask = Long.shl(-1n, this.numBits);
    return (this.checkedWord(this.numWords - 1) & mask) === 0n;
  }

  private checkedWord(i: number): bigint {
    if (i < 0 || i >= this.bits.length) {
      throw new ArrayIndexOutOfBoundsException("Index " + i + " out of bounds for length " + this.bits.length);
    }
    return this.bits[i]!;
  }

  length(): number {
    return this.numBits;
  }

  ramBytesUsed(): number {
    return BASE_RAM_BYTES_USED + RamUsageEstimator.sizeOf(this.bits);
  }

  /** Expert. */
  getBits(): BigInt64Array {
    return this.bits;
  }

  /** Returns number of set bits. NOTE: this visits every long in the backing bits array, and the result is not internally cached! */
  cardinality(): number {
    // Depends on the ghost bits being clear!
    return BitUtil.pop_array(this.bits, 0, this.numWords);
  }

  get(index: number): boolean {
    lassert(() => index >= 0 && index < this.numBits, () => "index=" + index + ", numBits=" + this.numBits);
    const i = index >> 6; // div 64
    // signed shift will keep a negative index and force an
    // array-index-out-of-bounds-exception, removing the need for an explicit check.
    const bitmask = Long.bit(index);
    return (this.bits[i]! & bitmask) !== 0n;
  }

  /** Sets the bit at {@code index}, or (two arguments) every bit of [startIndex, endIndex). */
  set(startIndex: number, endIndex?: number): void {
    if (endIndex === undefined) {
      const index = startIndex;
      lassert(() => index >= 0 && index < this.numBits, () => "index=" + index + ", numBits=" + this.numBits);
      const wordNum = index >> 6; // div 64
      this.bits[wordNum] = this.bits[wordNum]! | Long.bit(index);
      return;
    }
    lassert(() => startIndex >= 0 && startIndex < this.numBits, () => "startIndex=" + startIndex + ", numBits=" + this.numBits);
    lassert(() => endIndex >= 0 && endIndex <= this.numBits, () => "endIndex=" + endIndex + ", numBits=" + this.numBits);
    if (endIndex <= startIndex) {
      return;
    }

    const startWord = startIndex >> 6;
    const endWord = (endIndex - 1) >> 6;

    const startmask = Long.shl(-1n, startIndex);
    const endmask = Long.ushr(-1n, -endIndex); // 64-(endIndex&0x3f) is the same as -endIndex since only the lowest 6 bits are used

    if (startWord === endWord) {
      this.bits[startWord] = this.bits[startWord]! | (startmask & endmask);
      return;
    }

    this.bits[startWord] = this.bits[startWord]! | startmask;
    this.bits.fill(-1n, startWord + 1, endWord);
    this.bits[endWord] = this.bits[endWord]! | endmask;
  }

  getAndSet(index: number): boolean {
    lassert(() => index >= 0 && index < this.numBits, () => "index=" + index + ", numBits=" + this.numBits);
    const wordNum = index >> 6; // div 64
    const bitmask = Long.bit(index);
    const val = (this.bits[wordNum]! & bitmask) !== 0n;
    this.bits[wordNum] = this.bits[wordNum]! | bitmask;
    return val;
  }

  /** Clears the bit at {@code startIndex} (one argument), or every bit of [startIndex, endIndex). */
  clear(startIndex: number, endIndex?: number): void {
    if (endIndex === undefined) {
      const index = startIndex;
      lassert(() => index >= 0 && index < this.numBits, () => "index=" + index + ", numBits=" + this.numBits);
      const wordNum = index >> 6;
      this.bits[wordNum] = this.bits[wordNum]! & ~Long.bit(index);
      return;
    }
    lassert(() => startIndex >= 0 && startIndex < this.numBits, () => "startIndex=" + startIndex + ", numBits=" + this.numBits);
    lassert(() => endIndex >= 0 && endIndex <= this.numBits, () => "endIndex=" + endIndex + ", numBits=" + this.numBits);
    if (endIndex <= startIndex) {
      return;
    }

    const startWord = startIndex >> 6;
    const endWord = (endIndex - 1) >> 6;

    let startmask = Long.shl(-1n, startIndex);
    let endmask = Long.ushr(-1n, -endIndex); // 64-(endIndex&0x3f) is the same as -endIndex since only the lowest 6 bits are used

    // invert masks since we are clearing
    startmask = ~startmask;
    endmask = ~endmask;

    if (startWord === endWord) {
      this.bits[startWord] = this.bits[startWord]! & (startmask | endmask);
      return;
    }

    this.bits[startWord] = this.bits[startWord]! & startmask;
    this.bits.fill(0n, startWord + 1, endWord);
    this.bits[endWord] = this.bits[endWord]! & endmask;
  }

  getAndClear(index: number): boolean {
    lassert(() => index >= 0 && index < this.numBits, () => "index=" + index + ", numBits=" + this.numBits);
    const wordNum = index >> 6; // div 64
    const bitmask = Long.bit(index);
    const val = (this.bits[wordNum]! & bitmask) !== 0n;
    this.bits[wordNum] = this.bits[wordNum]! & ~bitmask;
    return val;
  }

  /**
   * Returns the index of the first set bit starting at the index specified. {@link DocIdSetIterator#NO_MORE_DOCS}
   * is returned if there are no more set bits.
   */
  nextSetBit(index: number): number {
    // Depends on the ghost bits being clear!
    lassert(() => index >= 0 && index < this.numBits, () => "index=" + index + ", numBits=" + this.numBits);
    let i = index >> 6;
    let word = Long.shr(this.bits[i]!, index); // skip all the bits to the right of index

    if (word !== 0n) {
      return index + Long.numberOfTrailingZeros(word);
    }

    while (++i < this.numWords) {
      word = this.bits[i]!;
      if (word !== 0n) {
        return (i << 6) + Long.numberOfTrailingZeros(word);
      }
    }

    return DocIdSetIterator.NO_MORE_DOCS;
  }

  /** Returns the index of the last set bit before or on the index specified. -1 is returned if there are no more set bits. */
  prevSetBit(index: number): number {
    lassert(() => index >= 0 && index < this.numBits, () => "index=" + index + " numBits=" + this.numBits);
    let i = index >> 6;
    const subIndex = index & 0x3f; // index within the word
    let word = Long.shl(this.bits[i]!, 63 - subIndex); // skip all the bits to the left of index

    if (word !== 0n) {
      return (i << 6) + subIndex - Long.numberOfLeadingZeros(word); // See LUCENE-3197
    }

    while (--i >= 0) {
      word = this.bits[i]!;
      if (word !== 0n) {
        return (i << 6) + 63 - Long.numberOfLeadingZeros(word);
      }
    }

    return -1;
  }

  /** Does in-place OR of the bits provided by an iterator (or of another FixedBitSet). */
  override or(other: DocIdSetIterator | FixedBitSet): void {
    if (other instanceof FixedBitSet) {
      this.orWords(other.bits, other.numWords);
      return;
    }
    const iter = other;
    if (BitSetIterator.getFixedBitSetOrNull(iter) !== null) {
      this.assertUnpositioned(iter);
      const bits = BitSetIterator.getFixedBitSetOrNull(iter)!;
      this.or(bits);
    } else {
      super.or(iter);
    }
  }

  private orWords(otherArr: BigInt64Array, otherNumWords: number): void {
    lassert(() => otherNumWords <= this.numWords, () => "numWords=" + this.numWords + ", otherNumWords=" + otherNumWords);
    const thisArr = this.bits;
    let pos = Math.min(this.numWords, otherNumWords);
    while (--pos >= 0) {
      thisArr[pos] = thisArr[pos]! | otherArr[pos]!;
    }
  }

  /** this = this XOR other (another FixedBitSet or an iterator) */
  xor(other: DocIdSetIterator | FixedBitSet): void {
    if (other instanceof FixedBitSet) {
      this.xorWords(other.bits, other.numWords);
      return;
    }
    const iter = other;
    this.assertUnpositioned(iter);
    if (BitSetIterator.getFixedBitSetOrNull(iter) !== null) {
      const bits = BitSetIterator.getFixedBitSetOrNull(iter)!;
      this.xor(bits);
    } else {
      let doc: number;
      while ((doc = iter.nextDoc()) < this.numBits) {
        this.flip(doc);
      }
    }
  }

  private xorWords(otherBits: BigInt64Array, otherNumWords: number): void {
    lassert(() => otherNumWords <= this.numWords, () => "numWords=" + this.numWords + ", other.numWords=" + otherNumWords);
    const thisBits = this.bits;
    let pos = Math.min(this.numWords, otherNumWords);
    while (--pos >= 0) {
      thisBits[pos] = thisBits[pos]! ^ otherBits[pos]!;
    }
  }

  /** returns true if the sets have any elements in common */
  intersects(other: FixedBitSet): boolean {
    // Depends on the ghost bits being clear!
    let pos = Math.min(this.numWords, other.numWords);
    while (--pos >= 0) {
      if ((this.bits[pos]! & other.bits[pos]!) !== 0n) return true;
    }
    return false;
  }

  /** this = this AND other (another FixedBitSet or an iterator) */
  override and(other: DocIdSetIterator | FixedBitSet): void {
    if (other instanceof FixedBitSet) {
      this.andWords(other.bits, other.numWords);
      return;
    }
    const iter = other;
    if (BitSetIterator.getFixedBitSetOrNull(iter) !== null) {
      this.assertUnpositioned(iter);
      const bits = BitSetIterator.getFixedBitSetOrNull(iter)!;
      this.and(bits);
    } else {
      super.and(iter);
    }
  }

  private andWords(otherArr: BigInt64Array, otherNumWords: number): void {
    const thisArr = this.bits;
    let pos = Math.min(this.numWords, otherNumWords);
    while (--pos >= 0) {
      thisArr[pos] = thisArr[pos]! & otherArr[pos]!;
    }
    if (this.numWords > otherNumWords) {
      thisArr.fill(0n, otherNumWords, this.numWords);
    }
  }

  /** this = this AND NOT other (another FixedBitSet or an iterator) */
  override andNot(other: DocIdSetIterator | FixedBitSet): void {
    if (other instanceof FixedBitSet) {
      this.andNotWords(other.bits, other.numWords);
      return;
    }
    const iter = other;
    if (BitSetIterator.getFixedBitSetOrNull(iter) !== null) {
      this.assertUnpositioned(iter);
      const bits = BitSetIterator.getFixedBitSetOrNull(iter)!;
      this.andNot(bits);
    } else {
      super.andNot(iter);
    }
  }

  private andNotWords(otherArr: BigInt64Array, otherNumWords: number): void {
    const thisArr = this.bits;
    let pos = Math.min(this.numWords, otherNumWords);
    while (--pos >= 0) {
      thisArr[pos] = thisArr[pos]! & ~otherArr[pos]!;
    }
  }

  /** returns true if the bit set is empty (scans every word). */
  scanIsEmpty(): boolean {
    // This 'slow' implementation is still faster than any external one could be
    // (e.g.: (bitSet.length() == 0 || bitSet.nextSetBit(0) == -1))
    // especially for small BitSets
    // Depends on the ghost bits being clear!
    const count = this.numWords;

    for (let i = 0; i < count; i++) {
      if (this.bits[i] !== 0n) return false;
    }
    return true;
  }

  /** Flips the bit at {@code startIndex} (one argument), or every bit of [startIndex, endIndex). */
  flip(startIndex: number, endIndex?: number): void {
    if (endIndex === undefined) {
      const index = startIndex;
      lassert(() => index >= 0 && index < this.numBits, () => "index=" + index + " numBits=" + this.numBits);
      const wordNum = index >> 6; // div 64
      this.bits[wordNum] = this.bits[wordNum]! ^ Long.bit(index); // mod 64 is implicit
      return;
    }
    lassert(() => startIndex >= 0 && startIndex < this.numBits);
    lassert(() => endIndex >= 0 && endIndex <= this.numBits);
    if (endIndex <= startIndex) {
      return;
    }

    const startWord = startIndex >> 6;
    const endWord = (endIndex - 1) >> 6;

    /* Grrr, java shifting uses only the lower 6 bits of the count so -1L>>>64 == -1
     * for that reason, make sure not to use endmask if the bits to flip will
     * be zero in the last word (redefine endWord to be the last changed...)
     * long startmask = -1L << (startIndex & 0x3f);     // example: 11111...111000
     * long endmask = -1L >>> (64-(endIndex & 0x3f));   // example: 00111...111111
     */
    const startmask = Long.shl(-1n, startIndex);
    const endmask = Long.ushr(-1n, -endIndex); // 64-(endIndex&0x3f) is the same as -endIndex since only the lowest 6 bits are used

    if (startWord === endWord) {
      this.bits[startWord] = this.bits[startWord]! ^ (startmask & endmask);
      return;
    }

    this.bits[startWord] = this.bits[startWord]! ^ startmask;

    for (let i = startWord + 1; i < endWord; i++) {
      this.bits[i] = ~this.bits[i]!;
    }

    this.bits[endWord] = this.bits[endWord]! ^ endmask;
  }

  clone(): FixedBitSet {
    const bits = new BigInt64Array(this.bits.length);
    bits.set(this.bits.subarray(0, this.numWords), 0);
    return new FixedBitSet(bits, this.numBits);
  }

  /** returns true if both sets have the same bits set */
  equals(o: unknown): boolean {
    if (this === o) {
      return true;
    }
    if (!(o instanceof FixedBitSet)) {
      return false;
    }
    const other = o;
    if (this.numBits !== other.numBits) {
      return false;
    }
    // Depends on the ghost bits being clear!
    if (this.bits.length !== other.bits.length) return false;
    for (let i = 0; i < this.bits.length; i++) {
      if (this.bits[i] !== other.bits[i]) return false;
    }
    return true;
  }

  hashCode(): number {
    // Depends on the ghost bits being clear!
    let h = 0n;
    for (let i = this.numWords; --i >= 0; ) {
      h ^= this.bits[i]!;
      h = BigInt.asIntN(64, h << 1n) | Long.ushr(h, 63); // rotate left
    }
    // fold leftmost bits into right and add a constant to prevent
    // empty sets from returning 0, which is too common.
    return (Number(BigInt.asIntN(32, (h >> 32n) ^ h)) + 0x98761234) | 0;
  }
}
