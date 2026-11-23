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

// Port of org.apache.lucene.util.packed.Packed16ThreeBlocks (Lucene 5.2.1) (generated from gen_PackedThreeBlocks.py in Java).
//
// Deviations: values are bigints; the backing array is an Int16Array (Java short[]); getBulk/setBulk are Java's
// get/set(index, long[], off, len).

import { ArrayIndexOutOfBoundsException } from "../../errors.js";
import type { DataInput } from "../../store/DataInput.js";
import { lassert } from "../assertions.js";
import { RamUsageEstimator } from "../RamUsageEstimator.js";
import { PackedIntsFormat, PackedIntsMutableImpl } from "./PackedIntsBase.js";

/** Packs integers into 3 shorts (48 bits per value). */
export class Packed16ThreeBlocks extends PackedIntsMutableImpl {
  /** @internal */
  readonly blocks: Int16Array;

  static readonly MAX_SIZE = Math.floor(2147483647 / 3);

  constructor(valueCount: number);
  /** @internal */
  constructor(packedIntsVersion: number, input: DataInput, valueCount: number);
  constructor(a: number, input?: DataInput, valueCount?: number) {
    const vc = input === undefined ? a : valueCount!;
    super(vc, 48);
    if (vc > Packed16ThreeBlocks.MAX_SIZE) {
      throw new ArrayIndexOutOfBoundsException("MAX_SIZE exceeded");
    }
    this.blocks = new Int16Array(vc * 3);
    if (input !== undefined) {
      const packedIntsVersion = a;
      for (let i = 0; i < 3 * vc; ++i) {
        this.blocks[i] = input.readShort();
      }
      // because packed ints have not always been byte-aligned
      const remaining = PackedIntsFormat.PACKED.byteCount(packedIntsVersion, vc, 48) - 3 * vc * 2;
      for (let i = 0; i < remaining; ++i) {
        input.readByte();
      }
    }
  }

  get(index: number): bigint {
    const o = index * 3;
    return (BigInt(this.blocks[o]! & 0xffff) << 32n) | (BigInt(this.blocks[o + 1]! & 0xffff) << 16n) | BigInt(this.blocks[o + 2]! & 0xffff);
  }

  override getBulk(index: number, arr: BigInt64Array, off: number, len: number): number {
    lassert(() => len > 0, () => "len must be > 0 (got " + len + ")");
    lassert(() => index >= 0 && index < this.valueCount);
    lassert(() => off + len <= arr.length);

    const gets = Math.min(this.valueCount - index, len);
    for (let i = index * 3, end = (index + gets) * 3; i < end; i += 3) {
      arr[off++] = (BigInt(this.blocks[i]! & 0xffff) << 32n) | (BigInt(this.blocks[i + 1]! & 0xffff) << 16n) | BigInt(this.blocks[i + 2]! & 0xffff);
    }
    return gets;
  }

  set(index: number, value: bigint): void {
    const o = index * 3;
    this.blocks[o] = Number(BigInt.asIntN(16, value >> 32n));
    this.blocks[o + 1] = Number(BigInt.asIntN(16, value >> 16n));
    this.blocks[o + 2] = Number(BigInt.asIntN(16, value));
  }

  override setBulk(index: number, arr: BigInt64Array, off: number, len: number): number {
    lassert(() => len > 0, () => "len must be > 0 (got " + len + ")");
    lassert(() => index >= 0 && index < this.valueCount);
    lassert(() => off + len <= arr.length);

    const sets = Math.min(this.valueCount - index, len);
    for (let i = off, o = index * 3, end = off + sets; i < end; ++i) {
      const value = BigInt.asUintN(64, arr[i]!);
      this.blocks[o++] = Number(BigInt.asIntN(16, value >> 32n));
      this.blocks[o++] = Number(BigInt.asIntN(16, value >> 16n));
      this.blocks[o++] = Number(BigInt.asIntN(16, value));
    }
    return sets;
  }

  override fill(fromIndex: number, toIndex: number, val: bigint): void {
    const u = BigInt.asUintN(64, val);
    const block1 = Number(BigInt.asIntN(16, u >> 32n));
    const block2 = Number(BigInt.asIntN(16, u >> 16n));
    const block3 = Number(BigInt.asIntN(16, u));
    for (let i = fromIndex * 3, end = toIndex * 3; i < end; i += 3) {
      this.blocks[i] = block1;
      this.blocks[i + 1] = block2;
      this.blocks[i + 2] = block3;
    }
  }

  override clear(): void {
    this.blocks.fill(0);
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

  override toString(): string {
    return this.constructor.name + "(bitsPerValue=" + this.bitsPerValue + ",size=" + this.size() + ",blocks=" + this.blocks.length + ")";
  }
}
