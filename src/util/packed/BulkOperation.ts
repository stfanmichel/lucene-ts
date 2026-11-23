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

// Port of org.apache.lucene.util.packed.BulkOperation (Lucene 5.2.1).
//
// Deviation: the static factory BulkOperation.of(format, bitsPerValue) is the function bulkOperationOf in
// BulkOperationFactory.ts (it instantiates the subclasses, which would make an import cycle here).

import { Long } from "../JavaNumbers.js";
import type { PackedIntsDecoder, PackedIntsEncoder } from "./PackedIntsBase.js";

/** Efficient sequential read/write of packed integers. */
export abstract class BulkOperation implements PackedIntsDecoder, PackedIntsEncoder {
  abstract longBlockCount(): number;
  abstract longValueCount(): number;
  abstract byteBlockCount(): number;
  abstract byteValueCount(): number;

  abstract decode(
    blocks: BigInt64Array | Uint8Array,
    blocksOffset: number,
    values: BigInt64Array | Int32Array,
    valuesOffset: number,
    iterations: number,
  ): void;

  abstract encode(
    values: BigInt64Array | Int32Array,
    valuesOffset: number,
    blocks: BigInt64Array | Uint8Array,
    blocksOffset: number,
    iterations: number,
  ): void;

  protected writeLong(block: bigint, blocks: Uint8Array, blocksOffset: number): number {
    for (let j = 1; j <= 8; ++j) {
      blocks[blocksOffset++] = Number(BigInt.asUintN(8, Long.ushr(block, 64 - (j << 3))));
    }
    return blocksOffset;
  }

  /**
   * For every number of bits per value, there is a minimum number of blocks (b) / values (v) you need to write in
   * order to reach the next block boundary: - 16 bits per value -> b=2, v=1 - 24 bits per value -> b=3, v=1 - 50
   * bits per value -> b=25, v=4 - 63 bits per value -> b=63, v=8 - ...
   *
   * A bulk read consists in copying <code>iterations*v</code> values that are contained in
   * <code>iterations*b</code> blocks into a <code>long[]</code> (higher values of <code>iterations</code> are likely
   * to yield a better throughput): this requires n * (b + 8v) bytes of memory.
   *
   * This method computes <code>iterations</code> as <code>ramBudget / (b + 8v)</code> (since a long is 8 bytes).
   */
  computeIterations(valueCount: number, ramBudget: number): number {
    const iterations = Math.trunc(ramBudget / (this.byteBlockCount() + 8 * this.byteValueCount()));
    if (iterations === 0) {
      // at least 1
      return 1;
    } else if ((iterations - 1) * this.byteValueCount() >= valueCount) {
      // don't allocate for more than the size of the reader
      return Math.ceil(valueCount / this.byteValueCount());
    } else {
      return iterations;
    }
  }
}
