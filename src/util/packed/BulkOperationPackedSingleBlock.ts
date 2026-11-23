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

// Port of org.apache.lucene.util.packed.BulkOperationPackedSingleBlock (Lucene 5.2.1).

import { UnsupportedOperationException } from "../../errors.js";
import { BulkOperation } from "./BulkOperation.js";

const BLOCK_COUNT = 1;

/** Non-specialized {@link BulkOperation} for PackedInts.Format.PACKED_SINGLE_BLOCK. */
export class BulkOperationPackedSingleBlock extends BulkOperation {
  private readonly bitsPerValue: number;
  private readonly valueCount: number;
  private readonly mask: bigint;
  private readonly shift: bigint;

  constructor(bitsPerValue: number) {
    super();
    this.bitsPerValue = bitsPerValue;
    this.valueCount = Math.floor(64 / bitsPerValue);
    this.mask = (1n << BigInt(bitsPerValue)) - 1n;
    this.shift = BigInt(bitsPerValue);
  }

  longBlockCount(): number {
    return BLOCK_COUNT;
  }

  byteBlockCount(): number {
    return BLOCK_COUNT * 8;
  }

  longValueCount(): number {
    return this.valueCount;
  }

  byteValueCount(): number {
    return this.valueCount;
  }

  private static readLong(blocks: Uint8Array, blocksOffset: number): bigint {
    let r = 0n;
    for (let i = 0; i < 8; i++) {
      r = (r << 8n) | BigInt(blocks[blocksOffset++]!);
    }
    return BigInt.asIntN(64, r);
  }

  private decodeBlockToLongs(block: bigint, values: BigInt64Array, valuesOffset: number): number {
    // (a long block is shifted as an unsigned value)
    let b = BigInt.asUintN(64, block);
    values[valuesOffset++] = b & this.mask;
    for (let j = 1; j < this.valueCount; ++j) {
      b >>= this.shift;
      values[valuesOffset++] = b & this.mask;
    }
    return valuesOffset;
  }

  private decodeBlockToInts(block: bigint, values: Int32Array, valuesOffset: number): number {
    let b = BigInt.asUintN(64, block);
    values[valuesOffset++] = Number(BigInt.asIntN(32, b & this.mask));
    for (let j = 1; j < this.valueCount; ++j) {
      b >>= this.shift;
      values[valuesOffset++] = Number(BigInt.asIntN(32, b & this.mask));
    }
    return valuesOffset;
  }

  private encodeLongs(values: BigInt64Array, valuesOffset: number): bigint {
    let block = values[valuesOffset++]!;
    for (let j = 1; j < this.valueCount; ++j) {
      block |= values[valuesOffset++]! << BigInt(j * this.bitsPerValue);
    }
    return BigInt.asIntN(64, block);
  }

  private encodeInts(values: Int32Array, valuesOffset: number): bigint {
    let block = BigInt(values[valuesOffset++]! >>> 0);
    for (let j = 1; j < this.valueCount; ++j) {
      block |= BigInt(values[valuesOffset++]! >>> 0) << BigInt(j * this.bitsPerValue);
    }
    return BigInt.asIntN(64, block);
  }

  decode(
    blocks: BigInt64Array | Uint8Array,
    blocksOffset: number,
    values: BigInt64Array | Int32Array,
    valuesOffset: number,
    iterations: number,
  ): void {
    if (!(values instanceof BigInt64Array) && this.bitsPerValue > 32) {
      throw new UnsupportedOperationException("Cannot decode " + this.bitsPerValue + "-bits values into an int[]");
    }
    for (let i = 0; i < iterations; ++i) {
      let block: bigint;
      if (blocks instanceof BigInt64Array) {
        block = blocks[blocksOffset++]!;
      } else {
        block = BulkOperationPackedSingleBlock.readLong(blocks, blocksOffset);
        blocksOffset += 8;
      }
      valuesOffset =
        values instanceof BigInt64Array
          ? this.decodeBlockToLongs(block, values, valuesOffset)
          : this.decodeBlockToInts(block, values, valuesOffset);
    }
  }

  encode(
    values: BigInt64Array | Int32Array,
    valuesOffset: number,
    blocks: BigInt64Array | Uint8Array,
    blocksOffset: number,
    iterations: number,
  ): void {
    for (let i = 0; i < iterations; ++i) {
      const block = values instanceof BigInt64Array ? this.encodeLongs(values, valuesOffset) : this.encodeInts(values, valuesOffset);
      valuesOffset += this.valueCount;
      if (blocks instanceof BigInt64Array) {
        blocks[blocksOffset++] = block;
      } else {
        blocksOffset = this.writeLong(block, blocks, blocksOffset);
      }
    }
  }
}
