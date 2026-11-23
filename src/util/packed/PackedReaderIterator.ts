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

// Port of org.apache.lucene.util.packed.PackedReaderIterator (Lucene 5.2.1).

import { EOFException } from "../../errors.js";
import type { DataInput } from "../../store/DataInput.js";
import { lassert } from "../assertions.js";
import { LongsRef } from "../LongsRef.js";
import type { BulkOperation } from "./BulkOperation.js";
import { bulkOperationOf } from "./BulkOperationFactory.js";
import { PackedIntsFormat, PackedIntsReaderIteratorImpl, PACKED_INTS_VERSION_BYTE_ALIGNED } from "./PackedIntsBase.js";

export class PackedReaderIterator extends PackedIntsReaderIteratorImpl {
  readonly packedIntsVersion: number;
  readonly format: PackedIntsFormat;
  readonly bulkOperation: BulkOperation;
  readonly nextBlocks: Uint8Array;
  readonly nextValues: LongsRef;
  readonly iterations: number;
  position: number;

  constructor(format: PackedIntsFormat, packedIntsVersion: number, valueCount: number, bitsPerValue: number, input: DataInput, mem: number) {
    super(valueCount, bitsPerValue, input);
    this.format = format;
    this.packedIntsVersion = packedIntsVersion;
    this.bulkOperation = bulkOperationOf(format, bitsPerValue);
    this.iterations = this.computeIterations(mem);
    lassert(() => valueCount === 0 || this.iterations > 0);
    this.nextBlocks = new Uint8Array(this.iterations * this.bulkOperation.byteBlockCount());
    this.nextValues = new LongsRef(new BigInt64Array(this.iterations * this.bulkOperation.byteValueCount()), 0, 0);
    this.nextValues.offset = this.nextValues.longs.length;
    this.position = -1;
  }

  private computeIterations(mem: number): number {
    let iterations = this.bulkOperation.computeIterations(this.valueCount, mem);
    if (this.packedIntsVersion < PACKED_INTS_VERSION_BYTE_ALIGNED) {
      // make sure iterations is a multiple of 8
      iterations = (iterations + 7) & 0xfffffff8;
    }
    return iterations;
  }

  nextRef(count: number): LongsRef {
    lassert(() => this.nextValues.length >= 0);
    lassert(() => count > 0);
    lassert(() => this.nextValues.offset + this.nextValues.length <= this.nextValues.longs.length);

    this.nextValues.offset += this.nextValues.length;

    const remaining = this.valueCount - this.position - 1;
    if (remaining <= 0) {
      throw new EOFException();
    }
    count = Math.min(remaining, count);

    if (this.nextValues.offset === this.nextValues.longs.length) {
      const remainingBlocks = this.format.byteCount(this.packedIntsVersion, remaining, this.bitsPerValue);
      const blocksToRead = Math.min(remainingBlocks, this.nextBlocks.length);
      this.in.readBytes(this.nextBlocks, 0, blocksToRead);
      if (blocksToRead < this.nextBlocks.length) {
        this.nextBlocks.fill(0, blocksToRead, this.nextBlocks.length);
      }

      this.bulkOperation.decode(this.nextBlocks, 0, this.nextValues.longs, 0, this.iterations);
      this.nextValues.offset = 0;
    }

    this.nextValues.length = Math.min(this.nextValues.longs.length - this.nextValues.offset, count);
    this.position += this.nextValues.length;
    return this.nextValues;
  }

  ord(): number {
    return this.position;
  }
}
