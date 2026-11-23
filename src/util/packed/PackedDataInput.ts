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

// Port of org.apache.lucene.util.packed.PackedDataInput (Lucene 5.2.1).

import type { DataInput } from "../../store/DataInput.js";
import { lassert } from "../assertions.js";

/**
 * A {@link DataInput} wrapper to read unaligned, variable-length packed integers. This API is much slower than the
 * {@link PackedInts} fixed-length API but can be convenient to save space.
 *
 * @see PackedDataOutput
 * @lucene.internal
 */
export class PackedDataInput {
  private readonly in: DataInput;
  private current = 0;
  private remainingBits = 0;

  /** Create a new instance that wraps `in`. */
  constructor(input: DataInput) {
    this.in = input;
    this.skipToNextByte();
  }

  /** Read the next long using exactly <code>bitsPerValue</code> bits. */
  readLong(bitsPerValue: number): bigint {
    lassert(() => bitsPerValue > 0 && bitsPerValue <= 64, () => String(bitsPerValue));
    let r = 0n;
    while (bitsPerValue > 0) {
      if (this.remainingBits === 0) {
        this.current = this.in.readByte() & 0xff;
        this.remainingBits = 8;
      }
      const bits = Math.min(bitsPerValue, this.remainingBits);
      r = BigInt.asIntN(64, r << BigInt(bits)) | BigInt((this.current >>> (this.remainingBits - bits)) & ((1 << bits) - 1));
      bitsPerValue -= bits;
      this.remainingBits -= bits;
    }
    return r;
  }

  /** If there are pending bits (at most 7), they will be ignored and the next value will be read starting at the next byte. */
  skipToNextByte(): void {
    this.remainingBits = 0;
  }
}
