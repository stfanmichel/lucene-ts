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

// Port of org.apache.lucene.util.packed.PackedWriter (Lucene 5.2.1).

import { EOFException } from "../../errors.js";
import type { DataOutput } from "../../store/DataOutput.js";
import { lassert } from "../assertions.js";
import type { BulkOperation } from "./BulkOperation.js";
import { bulkOperationOf } from "./BulkOperationFactory.js";
import { PackedIntsFormat, PackedIntsWriter, packedUnsignedBitsRequired, PACKED_INTS_VERSION_CURRENT } from "./PackedIntsBase.js";

// Packs high order byte first, to match
// IndexOutput.writeInt/Long/Short byte order
export class PackedWriter extends PackedIntsWriter {
  finished: boolean;
  readonly format: PackedIntsFormat;
  readonly encoder: BulkOperation;
  readonly nextBlocks: Uint8Array;
  readonly nextValues: BigInt64Array;
  readonly iterations: number;
  off: number;
  written: number;

  constructor(format: PackedIntsFormat, out: DataOutput, valueCount: number, bitsPerValue: number, mem: number) {
    super(out, valueCount, bitsPerValue);
    this.format = format;
    this.encoder = bulkOperationOf(format, bitsPerValue);
    this.iterations = this.encoder.computeIterations(valueCount, mem);
    this.nextBlocks = new Uint8Array(this.iterations * this.encoder.byteBlockCount());
    this.nextValues = new BigInt64Array(this.iterations * this.encoder.byteValueCount());
    this.off = 0;
    this.written = 0;
    this.finished = false;
  }

  protected getFormat(): PackedIntsFormat {
    return this.format;
  }

  add(v: bigint): void {
    lassert(() => packedUnsignedBitsRequired(v) <= this._bitsPerValue);
    lassert(() => !this.finished);
    if (this.valueCount !== -1 && this.written >= this.valueCount) {
      throw new EOFException("Writing past end of stream");
    }
    this.nextValues[this.off++] = v;
    if (this.off === this.nextValues.length) {
      this.flush();
    }
    ++this.written;
  }

  finish(): void {
    lassert(() => !this.finished);
    if (this.valueCount !== -1) {
      while (this.written < this.valueCount) {
        this.add(0n);
      }
    }
    this.flush();
    this.finished = true;
  }

  private flush(): void {
    this.encoder.encode(this.nextValues, 0, this.nextBlocks, 0, this.iterations);
    const blockCount = this.format.byteCount(PACKED_INTS_VERSION_CURRENT, this.off, this._bitsPerValue);
    this.out.writeBytes(this.nextBlocks, 0, blockCount);
    this.nextValues.fill(0n);
    this.off = 0;
  }

  ord(): number {
    return this.written - 1;
  }
}
