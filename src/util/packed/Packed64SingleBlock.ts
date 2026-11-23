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

// Port of org.apache.lucene.util.packed.Packed64SingleBlock (Lucene 5.2.1).
//
// Deviations: values are bigints; getBulk/setBulk are Java's get/set(index, long[], off, len). Lucene generates a
// subclass per supported number of bits (Packed64SingleBlock1..32) with the shifts unrolled; here the single
// class Packed64SingleBlockN computes them generically (same results), and create() returns it.

import { IllegalArgumentException } from "../../errors.js";
import type { DataInput } from "../../store/DataInput.js";
import { lassert } from "../assertions.js";
import { RamUsageEstimator } from "../RamUsageEstimator.js";
import { bulkOperationOf } from "./BulkOperationFactory.js";
import {
  PackedIntsFormat,
  PackedIntsMutableImpl,
  packedUnsignedBitsRequired,
  SINGLE_BLOCK_SUPPORTED_BITS_PER_VALUE,
} from "./PackedIntsBase.js";

/**
 * This class is similar to {@link Packed64} except that it trades space for speed by ensuring that a single
 * block needs to be read/written in order to read/write a value.
 *
 * @lucene.internal
 */
export abstract class Packed64SingleBlock extends PackedIntsMutableImpl {
  static readonly MAX_SUPPORTED_BITS_PER_VALUE = 32;

  static isSupported(bitsPerValue: number): boolean {
    return SINGLE_BLOCK_SUPPORTED_BITS_PER_VALUE.includes(bitsPerValue);
  }

  private static requiredCapacity(valueCount: number, valuesPerBlock: number): number {
    return Math.floor(valueCount / valuesPerBlock) + (valueCount % valuesPerBlock === 0 ? 0 : 1);
  }

  /** @internal */
  readonly blocks: BigInt64Array;

  protected constructor(valueCount: number, bitsPerValue: number) {
    super(valueCount, bitsPerValue);
    lassert(() => Packed64SingleBlock.isSupported(bitsPerValue));
    const valuesPerBlock = Math.floor(64 / bitsPerValue);
    this.blocks = new BigInt64Array(Packed64SingleBlock.requiredCapacity(valueCount, valuesPerBlock));
  }

  override clear(): void {
    this.blocks.fill(0n);
  }

  ramBytesUsed(): number {
    return (
      RamUsageEstimator.alignObjectSize(
        RamUsageEstimator.NUM_BYTES_OBJECT_HEADER +
          2 * RamUsageEstimator.NUM_BYTES_INT + // valueCount,bitsPerValue
          RamUsageEstimator.NUM_BYTES_OBJECT_REF,
      ) + // blocks ref
      RamUsageEstimator.sizeOf(this.blocks)
    );
  }

  override getBulk(index: number, arr: BigInt64Array, off: number, len: number): number {
    lassert(() => len > 0, () => "len must be > 0 (got " + len + ")");
    lassert(() => index >= 0 && index < this.valueCount);
    len = Math.min(len, this.valueCount - index);
    lassert(() => off + len <= arr.length);

    const originalIndex = index;

    // go to the next block boundary
    const valuesPerBlock = Math.floor(64 / this.bitsPerValue);
    const offsetInBlock = index % valuesPerBlock;
    if (offsetInBlock !== 0) {
      for (let i = offsetInBlock; i < valuesPerBlock && len > 0; ++i) {
        arr[off++] = this.get(index++);
        --len;
      }
      if (len === 0) {
        return index - originalIndex;
      }
    }

    // bulk get
    lassert(() => index % valuesPerBlock === 0);
    const decoder = bulkOperationOf(PackedIntsFormat.PACKED_SINGLE_BLOCK, this.bitsPerValue);
    lassert(() => decoder.longBlockCount() === 1);
    lassert(() => decoder.longValueCount() === valuesPerBlock);
    const blockIndex = Math.floor(index / valuesPerBlock);
    const nblocks = Math.floor((index + len) / valuesPerBlock) - blockIndex;
    decoder.decode(this.blocks, blockIndex, arr, off, nblocks);
    const diff = nblocks * valuesPerBlock;
    index += diff;
    len -= diff;

    if (index > originalIndex) {
      // stay at the block boundary
      return index - originalIndex;
    } else {
      // no progress so far => already at a block boundary but no full block to
      // get
      lassert(() => index === originalIndex);
      return super.getBulk(index, arr, off, len);
    }
  }

  override setBulk(index: number, arr: BigInt64Array, off: number, len: number): number {
    lassert(() => len > 0, () => "len must be > 0 (got " + len + ")");
    lassert(() => index >= 0 && index < this.valueCount);
    len = Math.min(len, this.valueCount - index);
    lassert(() => off + len <= arr.length);

    const originalIndex = index;

    // go to the next block boundary
    const valuesPerBlock = Math.floor(64 / this.bitsPerValue);
    const offsetInBlock = index % valuesPerBlock;
    if (offsetInBlock !== 0) {
      for (let i = offsetInBlock; i < valuesPerBlock && len > 0; ++i) {
        this.set(index++, arr[off++]!);
        --len;
      }
      if (len === 0) {
        return index - originalIndex;
      }
    }

    // bulk set
    lassert(() => index % valuesPerBlock === 0);
    const op = bulkOperationOf(PackedIntsFormat.PACKED_SINGLE_BLOCK, this.bitsPerValue);
    lassert(() => op.longBlockCount() === 1);
    lassert(() => op.longValueCount() === valuesPerBlock);
    const blockIndex = Math.floor(index / valuesPerBlock);
    const nblocks = Math.floor((index + len) / valuesPerBlock) - blockIndex;
    op.encode(arr, off, this.blocks, blockIndex, nblocks);
    const diff = nblocks * valuesPerBlock;
    index += diff;
    len -= diff;

    if (index > originalIndex) {
      // stay at the block boundary
      return index - originalIndex;
    } else {
      // no progress so far => already at a block boundary but no full block to
      // set
      lassert(() => index === originalIndex);
      return super.setBulk(index, arr, off, len);
    }
  }

  override fill(fromIndex: number, toIndex: number, val: bigint): void {
    lassert(() => fromIndex >= 0);
    lassert(() => fromIndex <= toIndex);
    lassert(() => packedUnsignedBitsRequired(val) <= this.bitsPerValue);

    const valuesPerBlock = Math.floor(64 / this.bitsPerValue);
    if (toIndex - fromIndex <= valuesPerBlock << 1) {
      // there needs to be at least one full block to set for the block
      // approach to be worth trying
      super.fill(fromIndex, toIndex, val);
      return;
    }

    // set values naively until the next block start
    const fromOffsetInBlock = fromIndex % valuesPerBlock;
    if (fromOffsetInBlock !== 0) {
      for (let i = fromOffsetInBlock; i < valuesPerBlock; ++i) {
        this.set(fromIndex++, val);
      }
      lassert(() => fromIndex % valuesPerBlock === 0);
    }

    // bulk set of the inner blocks
    const fromBlock = Math.floor(fromIndex / valuesPerBlock);
    const toBlock = Math.floor(toIndex / valuesPerBlock);
    lassert(() => fromBlock * valuesPerBlock === fromIndex);

    let blockValue = 0n;
    for (let i = 0; i < valuesPerBlock; ++i) {
      blockValue = blockValue | (val << BigInt(i * this.bitsPerValue));
    }
    this.blocks.fill(BigInt.asIntN(64, blockValue), fromBlock, toBlock);

    // fill the gap
    for (let i = valuesPerBlock * toBlock; i < toIndex; ++i) {
      this.set(i, val);
    }
  }

  override getFormat(): PackedIntsFormat {
    return PackedIntsFormat.PACKED_SINGLE_BLOCK;
  }

  override toString(): string {
    return this.constructor.name + "(bitsPerValue=" + this.bitsPerValue + ",size=" + this.size() + ",blocks=" + this.blocks.length + ")";
  }

  /** Reads the blocks from the input after creating the reader. */
  static create(input: DataInput, valueCount: number, bitsPerValue: number): Packed64SingleBlock;
  /** Creates an empty reader. */
  static create(valueCount: number, bitsPerValue: number): Packed64SingleBlock;
  static create(a: DataInput | number, b: number, c?: number): Packed64SingleBlock {
    if (typeof a === "number") {
      return Packed64SingleBlock.createEmpty(a, b);
    }
    const reader = Packed64SingleBlock.createEmpty(b, c!);
    for (let i = 0; i < reader.blocks.length; ++i) {
      reader.blocks[i] = a.readLong();
    }
    return reader;
  }

  private static createEmpty(valueCount: number, bitsPerValue: number): Packed64SingleBlock {
    if (!Packed64SingleBlock.isSupported(bitsPerValue)) {
      // (Java's message always says 32)
      throw new IllegalArgumentException("Unsupported number of bits per value: " + 32);
    }
    return new Packed64SingleBlockN(valueCount, bitsPerValue);
  }
}

/** Stands for Lucene's Packed64SingleBlock1 ... Packed64SingleBlock32. */
class Packed64SingleBlockN extends Packed64SingleBlock {
  private readonly valuesPerBlock: number;
  private readonly mask: bigint;

  constructor(valueCount: number, bitsPerValue: number) {
    super(valueCount, bitsPerValue);
    this.valuesPerBlock = Math.floor(64 / bitsPerValue);
    this.mask = (1n << BigInt(bitsPerValue)) - 1n;
  }

  get(index: number): bigint {
    const o = Math.floor(index / this.valuesPerBlock);
    const b = index % this.valuesPerBlock;
    const shift = BigInt(b * this.bitsPerValue);
    return (BigInt.asUintN(64, this.blocks[o]!) >> shift) & this.mask;
  }

  set(index: number, value: bigint): void {
    const o = Math.floor(index / this.valuesPerBlock);
    const b = index % this.valuesPerBlock;
    const shift = BigInt(b * this.bitsPerValue);
    this.blocks[o] = (this.blocks[o]! & ~(this.mask << shift)) | (value << shift);
  }

  override toString(): string {
    return "Packed64SingleBlock" + this.bitsPerValue + "(bitsPerValue=" + this.bitsPerValue + ",size=" + this.size() + ",blocks=" + this.blocks.length + ")";
  }
}
