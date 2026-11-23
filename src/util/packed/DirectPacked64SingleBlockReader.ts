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

// Port of org.apache.lucene.util.packed.DirectPacked64SingleBlockReader (Lucene 5.2.1).

import { IllegalStateException, IOException } from "../../errors.js";
import type { IndexInput } from "../../store/IndexInput.js";
import { PackedIntsReaderImpl } from "./PackedIntsBase.js";

/** Reads directly from disk on each get */
// just for back compat, use DirectReader/DirectWriter for more efficient impl
export class DirectPacked64SingleBlockReader extends PackedIntsReaderImpl {
  private readonly in: IndexInput;
  private readonly bitsPerValue: number;
  private readonly startPointer: number;
  private readonly valuesPerBlock: number;
  private readonly mask: bigint;

  constructor(bitsPerValue: number, valueCount: number, input: IndexInput) {
    super(valueCount);
    this.in = input;
    this.bitsPerValue = bitsPerValue;
    this.startPointer = input.getFilePointer();
    this.valuesPerBlock = Math.floor(64 / bitsPerValue);
    this.mask = ~(-1n << BigInt(bitsPerValue));
  }

  get(index: number): bigint {
    const blockOffset = Math.floor(index / this.valuesPerBlock);
    const skip = blockOffset * 8;
    try {
      this.in.seek(this.startPointer + skip);

      const block = this.in.readLong();
      const offsetInBlock = index % this.valuesPerBlock;
      return (BigInt.asUintN(64, block) >> BigInt(offsetInBlock * this.bitsPerValue)) & this.mask;
    } catch (e) {
      if (e instanceof IOException) {
        const ise = new IllegalStateException("failed");
        (ise as { cause?: unknown }).cause = e;
        throw ise;
      }
      throw e;
    }
  }

  ramBytesUsed(): number {
    return 0;
  }
}
