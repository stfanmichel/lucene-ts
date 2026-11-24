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

// Port of org.apache.lucene.util.packed.DirectReader (Lucene 5.2.1).
//
// Deviation: the 14 nested classes DirectPackedReader1..64 are one class (DirectReaderN) that switches on the
// number of bits per value; positions are numbers, values bigints.

import { IllegalArgumentException, IOException, RuntimeException } from "../../errors.js";
import type { RandomAccessInput } from "../../store/RandomAccessInput.js";
import { LongValues } from "../LongValues.js";
import { Long } from "../JavaNumbers.js";

/**
 * Retrieves an instance previously written by {@link DirectWriter}
 *
 * Example usage:
 * <pre class="prettyprint">
 *   int bitsPerValue = 100;
 *   IndexInput in = dir.openInput("packed", IOContext.DEFAULT);
 *   LongValues values = DirectReader.getInstance(in.randomAccessSlice(start, end), bitsPerValue);
 *   for (int i = 0; i < numValues; i++) {
 *     long value = values.get(i);
 *   }
 * </pre>
 * @see DirectWriter
 */
export class DirectReader {
  private constructor() {}

  /**
   * Retrieves an instance from the specified <code>slice</code>.
   */
  static getInstance(slice: RandomAccessInput, bitsPerValue: number): LongValues {
    switch (bitsPerValue) {
      case 1:
      case 2:
      case 4:
      case 8:
      case 12:
      case 16:
      case 20:
      case 24:
      case 28:
      case 32:
      case 40:
      case 48:
      case 56:
      case 64:
        return new DirectReaderN(slice, bitsPerValue);
      default:
        throw new IllegalArgumentException("unsupported bitsPerValue: " + bitsPerValue);
    }
  }
}

class DirectReaderN extends LongValues {
  private readonly in: RandomAccessInput;
  private readonly bitsPerValue: number;

  constructor(input: RandomAccessInput, bitsPerValue: number) {
    super();
    this.in = input;
    this.bitsPerValue = bitsPerValue;
  }

  get(index: number): bigint {
    try {
      const input = this.in;
      switch (this.bitsPerValue) {
        case 1: {
          const shift = 7 - (index % 8);
          return BigInt((input.readByte(Math.floor(index / 8)) >>> shift) & 0x1);
        }
        case 2: {
          const shift = (3 - (index % 4)) << 1;
          return BigInt((input.readByte(Math.floor(index / 4)) >>> shift) & 0x3);
        }
        case 4: {
          const shift = ((index + 1) % 2) << 2;
          return BigInt((input.readByte(Math.floor(index / 2)) >>> shift) & 0xf);
        }
        case 8:
          return BigInt(input.readByte(index) & 0xff);
        case 12: {
          const offset = Math.floor((index * 12) / 8);
          const shift = ((index + 1) % 2) << 2;
          return BigInt((input.readShort(offset) >>> shift) & 0xfff);
        }
        case 16:
          return BigInt(input.readShort(index * 2) & 0xffff);
        case 20: {
          const offset = Math.floor((index * 20) / 8);
          // TODO: clean this up...
          const v = input.readInt(offset) >>> 8;
          const shift = ((index + 1) % 2) << 2;
          return BigInt((v >>> shift) & 0xfffff);
        }
        case 24:
          return BigInt(input.readInt(index * 3) >>> 8);
        case 28: {
          const offset = Math.floor((index * 28) / 8);
          const shift = ((index + 1) % 2) << 2;
          return BigInt((input.readInt(offset) >>> shift) & 0xfffffff);
        }
        case 32:
          return BigInt(input.readInt(index * 4) >>> 0);
        case 40:
          return Long.ushr(input.readLong(index * 5), 24);
        case 48:
          return Long.ushr(input.readLong(index * 6), 16);
        case 56:
          return Long.ushr(input.readLong(index * 7), 8);
        default: // 64
          return input.readLong(index * 8);
      }
    } catch (e) {
      if (e instanceof IOException) {
        throw new RuntimeException(String(e), { cause: e });
      }
      throw e;
    }
  }
}
