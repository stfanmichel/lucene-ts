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

// Port of org.apache.lucene.util.packed.PackedDataOutput (Lucene 5.2.1).

import type { DataOutput } from "../../store/DataOutput.js";
import { lassert } from "../assertions.js";
import { packedMaxValue } from "./PackedIntsBase.js";

/**
 * A {@link DataOutput} wrapper to write unaligned, variable-length packed integers.
 *
 * @see PackedDataInput
 * @lucene.internal
 */
export class PackedDataOutput {
  private readonly out: DataOutput;
  private current = 0n;
  private remainingBits = 8;

  /** Create a new instance that wraps <code>out</code>. */
  constructor(out: DataOutput) {
    this.out = out;
  }

  /** Write a value using exactly <code>bitsPerValue</code> bits. */
  writeLong(value: bigint, bitsPerValue: number): void {
    lassert(() => bitsPerValue === 64 || (value >= 0n && value <= packedMaxValue(bitsPerValue)));
    while (bitsPerValue > 0) {
      if (this.remainingBits === 0) {
        this.out.writeByte(Number(BigInt.asUintN(8, this.current)));
        this.current = 0n;
        this.remainingBits = 8;
      }
      const bits = Math.min(this.remainingBits, bitsPerValue);
      this.current =
        this.current |
        (((BigInt.asUintN(64, value) >> BigInt(bitsPerValue - bits)) & ((1n << BigInt(bits)) - 1n)) << BigInt(this.remainingBits - bits));
      bitsPerValue -= bits;
      this.remainingBits -= bits;
    }
  }

  /** Flush pending bits to the underlying {@link DataOutput}. */
  flush(): void {
    if (this.remainingBits < 8) {
      this.out.writeByte(Number(BigInt.asUintN(8, this.current)));
    }
    this.remainingBits = 8;
    this.current = 0n;
  }
}
