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

// Port of org.apache.lucene.util.packed.Packed64 (Lucene 5.2.1).
//
// Deviations: values are bigints, the blocks a BigInt64Array; getBulk/setBulk are Java's get/set(index, long[], off, len).

import type { DataInput } from "../../store/DataInput.js";
import { lassert } from "../assertions.js";
import { RamUsageEstimator } from "../RamUsageEstimator.js";
import { bulkOperationOf } from "./BulkOperationFactory.js";
import { PackedIntsFormat, PackedIntsMutableImpl, packedUnsignedBitsRequired, PACKED_INTS_VERSION_CURRENT } from "./PackedIntsBase.js";

const B: bigint[] = [];
for (let i = 0; i <= 64; i++) B.push(BigInt(i));

function ushr(x: bigint, n: number): bigint {
  return BigInt.asUintN(64, x) >> B[n & 63]!;
}

/**
 * Space optimized random access capable array of values with a fixed number of bits/value. Values are packed
 * contiguously.
 *
 * The implementation strives to perform as fast as possible under the constraint of contiguous bits, by
 * avoiding expensive operations. This comes at the cost of code clarity.
 *
 * Technical details: This implementation is a refinement of a non-branching version. The non-branching
 * get and set methods meant that 2 or 4 atomic array accesses were always performed, even when only
 * one was needed.
 *
 * @lucene.internal
 */
export class Packed64 extends PackedIntsMutableImpl {
  static readonly BLOCK_SIZE = 64; // 32 = int, 64 = long
  static readonly BLOCK_BITS = 6; // The #bits representing BLOCK_SIZE
  static readonly MOD_MASK = Packed64.BLOCK_SIZE - 1; // x % BLOCK_SIZE

  /** Values are stores contiguously in the blocks array. @internal */
  readonly blocks: BigInt64Array;
  /** A right-aligned mask of width BitsPerValue used by {@link get}. */
  private readonly maskRight: bigint;
  /** Optimization: Saves one lookup in {@link get}. */
  private readonly bpvMinusBlockSize: number;

  /**
   * Creates an array with the internal structure adjusted for the given limits and initialized to 0.
   * @param valueCount   the number of elements.
   * @param bitsPerValue the number of bits available for any given value.
   */
  constructor(valueCount: number, bitsPerValue: number);
  /**
   * Creates an array with content retrieved from the given DataInput.
   * @param packedIntsVersion the version the stream was written with
   * @param input a DataInput, positioned at the start of Packed64-content.
   * @param valueCount  the number of elements.
   * @param bitsPerValue the number of bits available for any given value.
   */
  constructor(packedIntsVersion: number, input: DataInput, valueCount: number, bitsPerValue: number);
  constructor(a: number, b: number | DataInput, c?: number, d?: number) {
    if (typeof b === "number") {
      super(a, b);
      const format = PackedIntsFormat.PACKED;
      const longCount = format.longCount(PACKED_INTS_VERSION_CURRENT, a, b);
      this.blocks = new BigInt64Array(longCount);
    } else {
      super(c!, d!);
      const packedIntsVersion = a;
      const input = b;
      const valueCount = c!;
      const bitsPerValue = d!;
      const format = PackedIntsFormat.PACKED;
      const byteCount = format.byteCount(packedIntsVersion, valueCount, bitsPerValue); // to know how much to read
      const longCount = format.longCount(PACKED_INTS_VERSION_CURRENT, valueCount, bitsPerValue); // to size the array
      this.blocks = new BigInt64Array(longCount);
      // read as many longs as we can
      for (let i = 0; i < Math.floor(byteCount / 8); ++i) {
        this.blocks[i] = input.readLong();
      }
      const remaining = byteCount % 8;
      if (remaining !== 0) {
        // read the last bytes
        let lastLong = 0n;
        for (let i = 0; i < remaining; ++i) {
          lastLong |= BigInt(input.readByte() & 0xff) << BigInt(56 - i * 8);
        }
        this.blocks[this.blocks.length - 1] = lastLong;
      }
    }
    const bpv = this.bitsPerValue;
    // ~0L << (BLOCK_SIZE-bitsPerValue) >>> (BLOCK_SIZE-bitsPerValue)
    this.maskRight = bpv === 64 ? -1n : (1n << B[bpv]!) - 1n;
    this.bpvMinusBlockSize = bpv - Packed64.BLOCK_SIZE;
  }

  get(index: number): bigint {
    // The abstract index in a bit stream
    const majorBitPos = index * this.bitsPerValue;
    // The index in the backing long-array
    const elementPos = Math.floor(majorBitPos / 64);
    // The number of value-bits in the second long
    const endBits = (majorBitPos % 64) + this.bpvMinusBlockSize;

    if (endBits <= 0) {
      // Single block
      return BigInt.asIntN(64, ushr(this.blocks[elementPos]!, -endBits) & this.maskRight);
    }
    // Two blocks
    return BigInt.asIntN(
      64,
      ((this.blocks[elementPos]! << B[endBits]!) | ushr(this.blocks[elementPos + 1]!, Packed64.BLOCK_SIZE - endBits)) & this.maskRight,
    );
  }

  override getBulk(index: number, arr: BigInt64Array, off: number, len: number): number {
    lassert(() => len > 0, () => "len must be > 0 (got " + len + ")");
    lassert(() => index >= 0 && index < this.valueCount);
    len = Math.min(len, this.valueCount - index);
    lassert(() => off + len <= arr.length);

    const originalIndex = index;
    const decoder = bulkOperationOf(PackedIntsFormat.PACKED, this.bitsPerValue);

    // go to the next block where the value does not span across two blocks
    const offsetInBlocks = index % decoder.longValueCount();
    if (offsetInBlocks !== 0) {
      for (let i = offsetInBlocks; i < decoder.longValueCount() && len > 0; ++i) {
        arr[off++] = this.get(index++);
        --len;
      }
      if (len === 0) {
        return index - originalIndex;
      }
    }

    // bulk get
    lassert(() => index % decoder.longValueCount() === 0);
    const blockIndex = Math.floor((index * this.bitsPerValue) / 64);
    lassert(() => (index * this.bitsPerValue) % 64 === 0);
    const iterations = Math.floor(len / decoder.longValueCount());
    decoder.decode(this.blocks, blockIndex, arr, off, iterations);
    const gotValues = iterations * decoder.longValueCount();
    index += gotValues;
    len -= gotValues;
    lassert(() => len >= 0);

    if (index > originalIndex) {
      // stay at the block boundary
      return index - originalIndex;
    } else {
      // no progress so far => already at a block boundary but no full block to get
      lassert(() => index === originalIndex);
      return super.getBulk(index, arr, off, len);
    }
  }

  set(index: number, value: bigint): void {
    // The abstract index in a contiguous bit stream
    const majorBitPos = index * this.bitsPerValue;
    // The index in the backing long-array
    const elementPos = Math.floor(majorBitPos / 64); // / BLOCK_SIZE
    // The number of value-bits in the second long
    const endBits = (majorBitPos % 64) + this.bpvMinusBlockSize;

    if (endBits <= 0) {
      // Single block
      this.blocks[elementPos] = (this.blocks[elementPos]! & ~(this.maskRight << B[-endBits]!)) | (value << B[-endBits]!);
      return;
    }
    // Two blocks
    this.blocks[elementPos] = (this.blocks[elementPos]! & ~ushr(this.maskRight, endBits)) | ushr(value, endBits);
    this.blocks[elementPos + 1] =
      (this.blocks[elementPos + 1]! & ushr(-1n, endBits)) | (value << B[Packed64.BLOCK_SIZE - endBits]!);
  }

  override setBulk(index: number, arr: BigInt64Array, off: number, len: number): number {
    lassert(() => len > 0, () => "len must be > 0 (got " + len + ")");
    lassert(() => index >= 0 && index < this.valueCount);
    len = Math.min(len, this.valueCount - index);
    lassert(() => off + len <= arr.length);

    const originalIndex = index;
    const encoder = bulkOperationOf(PackedIntsFormat.PACKED, this.bitsPerValue);

    // go to the next block where the value does not span across two blocks
    const offsetInBlocks = index % encoder.longValueCount();
    if (offsetInBlocks !== 0) {
      for (let i = offsetInBlocks; i < encoder.longValueCount() && len > 0; ++i) {
        this.set(index++, arr[off++]!);
        --len;
      }
      if (len === 0) {
        return index - originalIndex;
      }
    }

    // bulk set
    lassert(() => index % encoder.longValueCount() === 0);
    const blockIndex = Math.floor((index * this.bitsPerValue) / 64);
    lassert(() => (index * this.bitsPerValue) % 64 === 0);
    const iterations = Math.floor(len / encoder.longValueCount());
    encoder.encode(arr, off, this.blocks, blockIndex, iterations);
    const setValues = iterations * encoder.longValueCount();
    index += setValues;
    len -= setValues;
    lassert(() => len >= 0);

    if (index > originalIndex) {
      // stay at the block boundary
      return index - originalIndex;
    } else {
      // no progress so far => already at a block boundary but no full block to get
      lassert(() => index === originalIndex);
      return super.setBulk(index, arr, off, len);
    }
  }

  override toString(): string {
    return "Packed64(bitsPerValue=" + this.bitsPerValue + ",size=" + this.size() + ",blocks=" + this.blocks.length + ")";
  }

  ramBytesUsed(): number {
    return (
      RamUsageEstimator.alignObjectSize(
        RamUsageEstimator.NUM_BYTES_OBJECT_HEADER +
          3 * RamUsageEstimator.NUM_BYTES_INT + // bpvMinusBlockSize,valueCount,bitsPerValue
          RamUsageEstimator.NUM_BYTES_LONG + // maskRight
          RamUsageEstimator.NUM_BYTES_OBJECT_REF,
      ) + // blocks ref
      RamUsageEstimator.sizeOf(this.blocks)
    );
  }

  override fill(fromIndex: number, toIndex: number, val: bigint): void {
    lassert(() => packedUnsignedBitsRequired(val) <= this.getBitsPerValue());
    lassert(() => fromIndex <= toIndex);

    // minimum number of values that use an exact number of full blocks
    const nAlignedValues = 64 / Packed64.gcd(64, this.bitsPerValue);
    const span = toIndex - fromIndex;
    if (span <= 3 * nAlignedValues) {
      // there needs be at least 2 * nAlignedValues aligned values for the
      // block approach to be worth trying
      super.fill(fromIndex, toIndex, val);
      return;
    }

    // fill the first values naively until the next block start
    const fromIndexModNAlignedValues = fromIndex % nAlignedValues;
    if (fromIndexModNAlignedValues !== 0) {
      for (let i = fromIndexModNAlignedValues; i < nAlignedValues; ++i) {
        this.set(fromIndex++, val);
      }
    }
    lassert(() => fromIndex % nAlignedValues === 0);

    // compute the long[] blocks for nAlignedValues consecutive values and
    // use them to set as many values as possible without applying any mask
    // or shift
    const nAlignedBlocks = (nAlignedValues * this.bitsPerValue) >> 6;
    let nAlignedValuesBlocks: BigInt64Array;
    {
      const values = new Packed64(nAlignedValues, this.bitsPerValue);
      for (let i = 0; i < nAlignedValues; ++i) {
        values.set(i, val);
      }
      nAlignedValuesBlocks = values.blocks;
      lassert(() => nAlignedBlocks <= nAlignedValuesBlocks.length);
    }
    const startBlock = Math.floor((fromIndex * this.bitsPerValue) / 64);
    const endBlock = Math.floor((toIndex * this.bitsPerValue) / 64);
    for (let block = startBlock; block < endBlock; ++block) {
      const blockValue = nAlignedValuesBlocks[block % nAlignedBlocks]!;
      this.blocks[block] = blockValue;
    }

    // fill the gap
    for (let i = Math.floor((endBlock * 64) / this.bitsPerValue); i < toIndex; ++i) {
      this.set(i, val);
    }
  }

  private static gcd(a: number, b: number): number {
    if (a < b) {
      return Packed64.gcd(b, a);
    } else if (b === 0) {
      return a;
    } else {
      return Packed64.gcd(b, a % b);
    }
  }

  override clear(): void {
    this.blocks.fill(0n);
  }
}
