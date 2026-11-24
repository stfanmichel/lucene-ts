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

// Port of org.apache.lucene.util.packed.BlockPackedReader (Lucene 5.2.1).
//
// Deviation: valueCount and indexes are numbers; values are bigints.

import { IOException } from "../../errors.js";
import type { IndexInput } from "../../store/IndexInput.js";
import type { Accountable } from "../Accountable.js";
import { lassert } from "../assertions.js";
import { BitUtil } from "../BitUtil.js";
import { LongValues } from "../LongValues.js";
import { BPV_SHIFT, MAX_BLOCK_SIZE, MIN_BLOCK_SIZE, MIN_VALUE_EQUALS_0 } from "./AbstractBlockPackedWriter.js";
import { readVLong } from "./BlockPackedReaderIterator.js";
import { PackedInts } from "./PackedInts.js";
import { PackedIntsNullReader } from "./PackedInts.js";
import type { PackedIntsReader } from "./PackedInts.js";

/**
 * Provides random access to a stream written with {@link BlockPackedWriter}.
 *
 * @see BlockPackedWriter
 * @lucene.internal
 */
export class BlockPackedReader extends LongValues implements Accountable {
  private readonly blockShift: number;
  private readonly blockMask: number;
  private readonly valueCount: number;
  private readonly minValues: BigInt64Array | null;
  private readonly subReaders: PackedIntsReader[];
  private readonly sumBPV: number;

  /** Sole constructor. */
  constructor(input: IndexInput, packedIntsVersion: number, blockSize: number, valueCount: number, direct: boolean) {
    super();
    this.valueCount = valueCount;
    this.blockShift = PackedInts.checkBlockSize(blockSize, MIN_BLOCK_SIZE, MAX_BLOCK_SIZE);
    this.blockMask = blockSize - 1;
    const numBlocks = PackedInts.numBlocks(valueCount, blockSize);
    let minValues: BigInt64Array | null = null;
    this.subReaders = new Array<PackedIntsReader>(numBlocks);
    let sumBPV = 0;
    for (let i = 0; i < numBlocks; ++i) {
      const token = input.readByte() & 0xff;
      const bitsPerValue = token >>> BPV_SHIFT;
      sumBPV += bitsPerValue;
      if (bitsPerValue > 64) {
        throw new IOException("Corrupted");
      }
      if ((token & MIN_VALUE_EQUALS_0) === 0) {
        if (minValues === null) {
          minValues = new BigInt64Array(numBlocks);
        }
        minValues[i] = BitUtil.zigZagDecode(BigInt.asIntN(64, 1n + readVLong(input)));
      }
      if (bitsPerValue === 0) {
        this.subReaders[i] = new PackedIntsNullReader(blockSize);
      } else {
        const size = Math.min(blockSize, valueCount - i * blockSize);
        if (direct) {
          const pointer = input.getFilePointer();
          this.subReaders[i] = PackedInts.getDirectReaderNoHeader(input, PackedInts.Format.PACKED, packedIntsVersion, size, bitsPerValue);
          input.seek(pointer + PackedInts.Format.PACKED.byteCount(packedIntsVersion, size, bitsPerValue));
        } else {
          this.subReaders[i] = PackedInts.getReaderNoHeader(input, PackedInts.Format.PACKED, packedIntsVersion, size, bitsPerValue);
        }
      }
    }
    this.minValues = minValues;
    this.sumBPV = sumBPV;
  }

  get(index: number): bigint {
    lassert(() => index >= 0 && index < this.valueCount);
    const block = Math.floor(index / (this.blockMask + 1));
    const idx = index % (this.blockMask + 1);
    return BigInt.asIntN(64, (this.minValues === null ? 0n : this.minValues[block]!) + this.subReaders[block]!.get(idx));
  }

  ramBytesUsed(): number {
    let size = 0;
    for (const reader of this.subReaders) {
      size += reader.ramBytesUsed();
    }
    return size;
  }

  getChildResources(): readonly Accountable[] {
    return [];
  }

  override toString(): string {
    const avgBPV = this.subReaders.length === 0 ? 0 : Math.trunc(this.sumBPV / this.subReaders.length);
    return this.constructor.name + "(blocksize=" + (1 << this.blockShift) + ",size=" + this.valueCount + ",avgBPV=" + avgBPV + ")";
  }
}
