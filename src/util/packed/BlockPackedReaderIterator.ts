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

// Port of org.apache.lucene.util.packed.BlockPackedReaderIterator (Lucene 5.2.1).
//
// Deviation: Java's next(int count) is nextRef(count) (as in PackedInts.ReaderIterator); values are bigints;
// valueCount, ord and skip counts are numbers.

import { EOFException, IOException } from "../../errors.js";
import type { DataInput } from "../../store/DataInput.js";
import { IndexInput } from "../../store/IndexInput.js";
import { lassert } from "../assertions.js";
import { BitUtil } from "../BitUtil.js";
import { LongsRef } from "../LongsRef.js";
import { BPV_SHIFT, MAX_BLOCK_SIZE, MIN_BLOCK_SIZE, MIN_VALUE_EQUALS_0 } from "./AbstractBlockPackedWriter.js";
import { PackedInts } from "./PackedInts.js";

const sbyte = (b: number): number => (b << 24) >> 24;

// same as DataInput.readVLong but supports negative values
export function readVLong(input: DataInput): bigint {
  let b = sbyte(input.readByte());
  if (b >= 0) return BigInt(b);
  let i = BigInt(b & 0x7f);
  for (let shift = 7n; shift <= 49n; shift += 7n) {
    b = sbyte(input.readByte());
    i |= BigInt(b & 0x7f) << shift;
    if (b >= 0) return i;
  }
  b = sbyte(input.readByte());
  i |= BigInt(b & 0xff) << 56n;
  return BigInt.asIntN(64, i);
}

/**
 * Reader for sequences of longs written with {@link BlockPackedWriter}.
 *
 * @see BlockPackedWriter
 * @lucene.internal
 */
export class BlockPackedReaderIterator {
  static readonly readVLong = readVLong;

  /** @internal */
  in!: DataInput;
  readonly packedIntsVersion: number;
  valueCount = 0;
  readonly blockSize: number;
  readonly values: BigInt64Array;
  readonly valuesRef: LongsRef;
  blocks: Uint8Array | null = null;

  off = 0;
  ord_ = 0;

  /**
   * Sole constructor.
   * @param blockSize the number of values of a block, must be equal to the block size of the {@link BlockPackedWriter} which has been used to write the stream
   */
  constructor(input: DataInput, packedIntsVersion: number, blockSize: number, valueCount: number) {
    PackedInts.checkBlockSize(blockSize, MIN_BLOCK_SIZE, MAX_BLOCK_SIZE);
    this.packedIntsVersion = packedIntsVersion;
    this.blockSize = blockSize;
    this.values = new BigInt64Array(blockSize);
    this.valuesRef = new LongsRef(this.values, 0, 0);
    this.reset(input, valueCount);
  }

  /** Reset the current reader to wrap a stream of <code>valueCount</code> values contained in <code>in</code>. The block size remains unchanged. */
  reset(input: DataInput, valueCount: number): void {
    this.in = input;
    lassert(() => valueCount >= 0);
    this.valueCount = valueCount;
    this.off = this.blockSize;
    this.ord_ = 0;
  }

  /** Skip exactly <code>count</code> values. */
  skip(count: number): void {
    lassert(() => count >= 0);
    if (this.ord_ + count > this.valueCount || this.ord_ + count < 0) {
      throw new EOFException();
    }

    // 1. skip buffered values
    const skipBuffer = Math.min(count, this.blockSize - this.off);
    this.off += skipBuffer;
    this.ord_ += skipBuffer;
    count -= skipBuffer;
    if (count === 0) {
      return;
    }

    // 2. skip as many blocks as necessary
    lassert(() => this.off === this.blockSize);
    while (count >= this.blockSize) {
      const token = this.in.readByte() & 0xff;
      const bitsPerValue = token >>> BPV_SHIFT;
      if (bitsPerValue > 64) {
        throw new IOException("Corrupted");
      }
      if ((token & MIN_VALUE_EQUALS_0) === 0) {
        readVLong(this.in);
      }
      const blockBytes = PackedInts.Format.PACKED.byteCount(this.packedIntsVersion, this.blockSize, bitsPerValue);
      this.skipBytes(blockBytes);
      this.ord_ += this.blockSize;
      count -= this.blockSize;
    }
    if (count === 0) {
      return;
    }

    // 3. skip last values
    lassert(() => count < this.blockSize);
    this.refill();
    this.ord_ += count;
    this.off += count;
  }

  private skipBytes(count: number): void {
    if (this.in instanceof IndexInput) {
      const iin = this.in;
      iin.seek(iin.getFilePointer() + count);
    } else {
      if (this.blocks === null) {
        this.blocks = new Uint8Array(this.blockSize);
      }
      let skipped = 0;
      while (skipped < count) {
        const toSkip = Math.min(this.blocks.length, count - skipped);
        this.in.readBytes(this.blocks, 0, toSkip);
        skipped += toSkip;
      }
    }
  }

  /** Read the next value. */
  next(): bigint {
    if (this.ord_ === this.valueCount) {
      throw new EOFException();
    }
    if (this.off === this.blockSize) {
      this.refill();
    }
    const value = this.values[this.off++]!;
    ++this.ord_;
    return value;
  }

  /** Read between <tt>1</tt> and <code>count</code> values. (Java: next(int)) */
  nextRef(count: number): LongsRef {
    lassert(() => count > 0);
    if (this.ord_ === this.valueCount) {
      throw new EOFException();
    }
    if (this.off === this.blockSize) {
      this.refill();
    }

    count = Math.min(count, this.blockSize - this.off);
    count = Math.min(count, this.valueCount - this.ord_);

    this.valuesRef.offset = this.off;
    this.valuesRef.length = count;
    this.off += count;
    this.ord_ += count;
    return this.valuesRef;
  }

  private refill(): void {
    const token = this.in.readByte() & 0xff;
    const minEquals0 = (token & MIN_VALUE_EQUALS_0) !== 0;
    const bitsPerValue = token >>> BPV_SHIFT;
    if (bitsPerValue > 64) {
      throw new IOException("Corrupted");
    }
    const minValue = minEquals0 ? 0n : BitUtil.zigZagDecode(BigInt.asIntN(64, 1n + readVLong(this.in)));
    lassert(() => minEquals0 || minValue !== 0n);

    if (bitsPerValue === 0) {
      this.values.fill(minValue);
    } else {
      const decoder = PackedInts.getDecoder(PackedInts.Format.PACKED, this.packedIntsVersion, bitsPerValue);
      const iterations = Math.floor(this.blockSize / decoder.byteValueCount());
      const blocksSize = iterations * decoder.byteBlockCount();
      if (this.blocks === null || this.blocks.length < blocksSize) {
        this.blocks = new Uint8Array(blocksSize);
      }

      const valueCount = Math.min(this.valueCount - this.ord_, this.blockSize);
      const blocksCount = PackedInts.Format.PACKED.byteCount(this.packedIntsVersion, valueCount, bitsPerValue);
      this.in.readBytes(this.blocks, 0, blocksCount);

      decoder.decode(this.blocks, 0, this.values, 0, iterations);

      if (minValue !== 0n) {
        for (let i = 0; i < valueCount; ++i) {
          this.values[i] = this.values[i]! + minValue;
        }
      }
    }
    this.off = 0;
  }

  /** Return the offset of the next value to read. */
  ord(): number {
    return this.ord_;
  }
}
