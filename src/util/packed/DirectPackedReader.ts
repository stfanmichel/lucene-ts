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

// Port of org.apache.lucene.util.packed.DirectPackedReader (Lucene 5.2.1).

import { AssertionError, IOException, RuntimeException } from "../../errors.js";
import type { IndexInput } from "../../store/IndexInput.js";
import { PackedIntsReaderImpl } from "./PackedIntsBase.js";

const B: bigint[] = [];
for (let i = 0; i <= 64; i++) B.push(BigInt(i));

/** Reads directly from disk on each get */
// just for back compat, use DirectReader/DirectWriter for more efficient impl
export class DirectPackedReader extends PackedIntsReaderImpl {
  /** @internal */
  readonly in: IndexInput;
  /** @internal */
  readonly bitsPerValue: number;
  /** @internal */
  readonly startPointer: number;
  /** @internal */
  readonly valueMask: bigint;

  constructor(bitsPerValue: number, valueCount: number, input: IndexInput) {
    super(valueCount);
    this.in = input;
    this.bitsPerValue = bitsPerValue;

    this.startPointer = input.getFilePointer();
    if (bitsPerValue === 64) {
      this.valueMask = -1n;
    } else {
      this.valueMask = (1n << B[bitsPerValue]!) - 1n;
    }
  }

  get(index: number): bigint {
    const majorBitPos = index * this.bitsPerValue;
    // The index in the backing byte-array
    const elementPos = Math.floor(majorBitPos / 8);
    try {
      this.in.seek(this.startPointer + elementPos);

      const bitPos = majorBitPos % 8;
      // round up bits to a multiple of 8 to find total bytes needed to read
      const roundedBits = (bitPos + this.bitsPerValue + 7) & ~7;
      // the number of extra bits read at the end to shift out
      let shiftRightBits = roundedBits - bitPos - this.bitsPerValue;

      let rawValue: bigint;
      switch (roundedBits >>> 3) {
        case 1:
          rawValue = BigInt(this.signedByte());
          break;
        case 2:
          rawValue = BigInt(this.in.readShort());
          break;
        case 3: {
          const s = BigInt(this.in.readShort());
          rawValue = (s << 8n) | BigInt(this.in.readByte() & 0xff);
          break;
        }
        case 4:
          rawValue = BigInt(this.in.readInt());
          break;
        case 5: {
          const i = BigInt(this.in.readInt());
          rawValue = (i << 8n) | BigInt(this.in.readByte() & 0xff);
          break;
        }
        case 6: {
          const i = BigInt(this.in.readInt());
          rawValue = (i << 16n) | BigInt(this.in.readShort() & 0xffff);
          break;
        }
        case 7: {
          const i = BigInt(this.in.readInt());
          const s = BigInt(this.in.readShort() & 0xffff);
          rawValue = (i << 24n) | (s << 8n) | BigInt(this.in.readByte() & 0xff);
          break;
        }
        case 8:
          rawValue = this.in.readLong();
          break;
        case 9: {
          // We must be very careful not to shift out relevant bits. So we account for right shift
          // we would normally do on return here, and reset it.
          const l = this.in.readLong();
          rawValue = (l << B[8 - shiftRightBits]!) | (BigInt(this.in.readByte() & 0xff) >> B[shiftRightBits]!);
          shiftRightBits = 0;
          break;
        }
        default:
          throw new AssertionError("bitsPerValue too large: " + this.bitsPerValue);
      }
      return BigInt.asIntN(64, (BigInt.asUintN(64, rawValue) >> B[shiftRightBits]!) & this.valueMask);
    } catch (ioe) {
      if (ioe instanceof IOException) {
        throw new RuntimeException(String(ioe), { cause: ioe });
      }
      throw ioe;
    }
  }

  /** Java's readByte() (a signed byte) */
  private signedByte(): number {
    return (this.in.readByte() << 24) >> 24;
  }

  ramBytesUsed(): number {
    return 0;
  }
}
