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

// Port of org.apache.lucene.util.packed.MonotonicBlockPackedReader (Lucene 5.2.1).
//
// Deviations: valueCount and indexes are numbers; values are bigints; the Java private constructor is protected
// (an anonymous subclass of the 'of' factory needs it); float arithmetic is rounded with Math.fround.

import { IOException } from "../../errors.js";
import type { IndexInput } from "../../store/IndexInput.js";
import type { Accountable } from "../Accountable.js";
import { lassert } from "../assertions.js";
import { BitUtil } from "../BitUtil.js";
import { Float, doubleToLong } from "../JavaNumbers.js";
import { LongValues } from "../LongValues.js";
import { RamUsageEstimator } from "../RamUsageEstimator.js";
import { MAX_BLOCK_SIZE, MIN_BLOCK_SIZE } from "./AbstractBlockPackedWriter.js";
import { PackedInts, PackedIntsNullReader } from "./PackedInts.js";
import type { PackedIntsReader } from "./PackedInts.js";

/**
 * Provides random access to a stream written with {@link MonotonicBlockPackedWriter}.
 *
 * @see MonotonicBlockPackedWriter
 * @lucene.internal
 */
export class MonotonicBlockPackedReader extends LongValues implements Accountable {
  /** origin + (long) (average * (long) index) @internal */
  static expected(origin: bigint, average: number, index: number): bigint {
    // float * long: the long is converted to a float, the product is a float
    return BigInt.asIntN(64, origin + doubleToLong(Math.fround(average * Math.fround(index))));
  }

  readonly blockShift: number;
  readonly blockMask: number;
  readonly valueCount: number;
  readonly minValues: BigInt64Array;
  readonly averages: Float32Array;
  readonly subReaders: PackedIntsReader[];
  readonly sumBPV: number;

  /** Sole constructor. */
  static of(input: IndexInput, packedIntsVersion: number, blockSize: number, valueCount: number, direct: boolean): MonotonicBlockPackedReader {
    if (packedIntsVersion < PackedInts.VERSION_MONOTONIC_WITHOUT_ZIGZAG) {
      return new (class extends MonotonicBlockPackedReader {
        constructor(i: IndexInput, v: number, b: number, c: number, d: boolean) {
          super(i, v, b, c, d);
        }
        protected override decodeDelta(delta: bigint): bigint {
          return BitUtil.zigZagDecode(delta);
        }
      })(input, packedIntsVersion, blockSize, valueCount, direct);
    }
    return new MonotonicBlockPackedReader(input, packedIntsVersion, blockSize, valueCount, direct);
  }

  protected constructor(input: IndexInput, packedIntsVersion: number, blockSize: number, valueCount: number, direct: boolean) {
    super();
    this.valueCount = valueCount;
    this.blockShift = PackedInts.checkBlockSize(blockSize, MIN_BLOCK_SIZE, MAX_BLOCK_SIZE);
    this.blockMask = blockSize - 1;
    const numBlocks = PackedInts.numBlocks(valueCount, blockSize);
    this.minValues = new BigInt64Array(numBlocks);
    this.averages = new Float32Array(numBlocks);
    this.subReaders = new Array<PackedIntsReader>(numBlocks);
    let sumBPV = 0;
    for (let i = 0; i < numBlocks; ++i) {
      if (packedIntsVersion < PackedInts.VERSION_MONOTONIC_WITHOUT_ZIGZAG) {
        this.minValues[i] = input.readVLong();
      } else {
        this.minValues[i] = input.readZLong();
      }
      this.averages[i] = Float.intBitsToFloat(input.readInt());
      const bitsPerValue = input.readVInt();
      sumBPV += bitsPerValue;
      if (bitsPerValue > 64) {
        throw new IOException("Corrupted");
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
    this.sumBPV = sumBPV;
  }

  get(index: number): bigint {
    lassert(() => index >= 0 && index < this.valueCount);
    const block = Math.floor(index / (this.blockMask + 1));
    const idx = index % (this.blockMask + 1);
    return BigInt.asIntN(
      64,
      MonotonicBlockPackedReader.expected(this.minValues[block]!, this.averages[block]!, idx) + this.decodeDelta(this.subReaders[block]!.get(idx)),
    );
  }

  protected decodeDelta(delta: bigint): bigint {
    return delta;
  }

  /** Returns the number of values */
  size(): number {
    return this.valueCount;
  }

  ramBytesUsed(): number {
    let sizeInBytes = 0;
    sizeInBytes += RamUsageEstimator.sizeOf(this.minValues);
    sizeInBytes += RamUsageEstimator.sizeOf(this.averages);
    for (const reader of this.subReaders) {
      sizeInBytes += reader.ramBytesUsed();
    }
    return sizeInBytes;
  }

  getChildResources(): readonly Accountable[] {
    return [];
  }

  override toString(): string {
    const avgBPV = this.subReaders.length === 0 ? 0 : Math.trunc(this.sumBPV / this.subReaders.length);
    return this.constructor.name + "(blocksize=" + (1 << this.blockShift) + ",size=" + this.valueCount + ",avgBPV=" + avgBPV + ")";
  }
}
