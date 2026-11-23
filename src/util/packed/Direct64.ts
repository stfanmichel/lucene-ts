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

// Port of org.apache.lucene.util.packed.Direct64 (Lucene 5.2.1) (generated from gen_Direct.py in Java).
//
// Deviations: values are bigints; the backing array is a BigInt64Array (Java long[]); getBulk/setBulk are Java's
// get/set(index, long[], off, len).

import type { DataInput } from "../../store/DataInput.js";
import { lassert } from "../assertions.js";
import { RamUsageEstimator } from "../RamUsageEstimator.js";
import { PackedIntsFormat, PackedIntsMutableImpl } from "./PackedIntsBase.js";

/** Direct wrapping of 64-bits values to a backing array. */
export class Direct64 extends PackedIntsMutableImpl {
  /** @internal */
  readonly values: BigInt64Array;

  constructor(valueCount: number);
  /** @internal */
  constructor(packedIntsVersion: number, input: DataInput, valueCount: number);
  constructor(a: number, input?: DataInput, valueCount?: number) {
    if (input === undefined) {
      super(a, 64);
      this.values = new BigInt64Array(a);
    } else {
      super(valueCount!, 64);
      this.values = new BigInt64Array(valueCount!);
      const packedIntsVersion = a;
      for (let i = 0; i < valueCount!; ++i) {
        this.values[i] = input.readLong();
      }
      // because packed ints have not always been byte-aligned
      const remaining = PackedIntsFormat.PACKED.byteCount(packedIntsVersion, valueCount!, 64) - 8 * valueCount!;
      for (let i = 0; i < remaining; ++i) {
        input.readByte();
      }
    }
  }

  get(index: number): bigint {
    return this.values[index]!;
  }

  set(index: number, value: bigint): void {
    this.values[index] = value;
  }

  ramBytesUsed(): number {
    return (
      RamUsageEstimator.alignObjectSize(
        RamUsageEstimator.NUM_BYTES_OBJECT_HEADER +
          2 * RamUsageEstimator.NUM_BYTES_INT + // valueCount,bitsPerValue
          RamUsageEstimator.NUM_BYTES_OBJECT_REF,
      ) + // values ref
      RamUsageEstimator.sizeOf(this.values)
    );
  }

  override clear(): void {
    this.values.fill(0n);
  }

  override getBulk(index: number, arr: BigInt64Array, off: number, len: number): number {
    lassert(() => len > 0, () => "len must be > 0 (got " + len + ")");
    lassert(() => index >= 0 && index < this.valueCount);
    lassert(() => off + len <= arr.length);

    const gets = Math.min(this.valueCount - index, len);
    arr.set(this.values.subarray(index, index + gets), off);
    return gets;
  }

  override setBulk(index: number, arr: BigInt64Array, off: number, len: number): number {
    lassert(() => len > 0, () => "len must be > 0 (got " + len + ")");
    lassert(() => index >= 0 && index < this.valueCount);
    lassert(() => off + len <= arr.length);

    const sets = Math.min(this.valueCount - index, len);
    this.values.set(arr.subarray(off, off + sets), index);
    return sets;
  }

  override fill(fromIndex: number, toIndex: number, val: bigint): void {
    this.values.fill(val, fromIndex, toIndex);
  }
}
