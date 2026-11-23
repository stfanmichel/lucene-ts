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

// Port of org.apache.lucene.util.packed.Direct8 (Lucene 5.2.1) (generated from gen_Direct.py in Java).
//
// Deviations: values are bigints; the backing array is a Uint8Array (Java byte[]); getBulk/setBulk are Java's
// get/set(index, long[], off, len).

import type { DataInput } from "../../store/DataInput.js";
import { lassert } from "../assertions.js";
import { RamUsageEstimator } from "../RamUsageEstimator.js";
import { PackedIntsFormat, PackedIntsMutableImpl } from "./PackedIntsBase.js";

/** Direct wrapping of 8-bits values to a backing array. */
export class Direct8 extends PackedIntsMutableImpl {
  /** @internal */
  readonly values: Uint8Array;

  constructor(valueCount: number);
  /** @internal */
  constructor(packedIntsVersion: number, input: DataInput, valueCount: number);
  constructor(a: number, input?: DataInput, valueCount?: number) {
    if (input === undefined) {
      super(a, 8);
      this.values = new Uint8Array(a);
    } else {
      super(valueCount!, 8);
      this.values = new Uint8Array(valueCount!);
      const packedIntsVersion = a;
      input.readBytes(this.values, 0, valueCount!);
      // because packed ints have not always been byte-aligned
      const remaining = PackedIntsFormat.PACKED.byteCount(packedIntsVersion, valueCount!, 8) - 1 * valueCount!;
      for (let i = 0; i < remaining; ++i) {
        input.readByte();
      }
    }
  }

  get(index: number): bigint {
    return BigInt(this.values[index]!);
  }

  set(index: number, value: bigint): void {
    this.values[index] = Number(BigInt.asUintN(8, value));
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
    this.values.fill(0);
  }

  override getBulk(index: number, arr: BigInt64Array, off: number, len: number): number {
    lassert(() => len > 0, () => "len must be > 0 (got " + len + ")");
    lassert(() => index >= 0 && index < this.valueCount);
    lassert(() => off + len <= arr.length);

    const gets = Math.min(this.valueCount - index, len);
    for (let i = index, o = off, end = index + gets; i < end; ++i, ++o) {
      arr[o] = BigInt(this.values[i]!);
    }
    return gets;
  }

  override setBulk(index: number, arr: BigInt64Array, off: number, len: number): number {
    lassert(() => len > 0, () => "len must be > 0 (got " + len + ")");
    lassert(() => index >= 0 && index < this.valueCount);
    lassert(() => off + len <= arr.length);

    const sets = Math.min(this.valueCount - index, len);
    for (let i = index, o = off, end = index + sets; i < end; ++i, ++o) {
      this.values[i] = Number(BigInt.asUintN(8, arr[o]!));
    }
    return sets;
  }

  override fill(fromIndex: number, toIndex: number, val: bigint): void {
    lassert(() => val === BigInt.asUintN(8, val));
    this.values.fill(Number(val), fromIndex, toIndex);
  }
}
