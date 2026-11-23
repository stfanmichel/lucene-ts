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

// Port of org.apache.lucene.util.packed.BulkOperationPacked (Lucene 5.2.1).
//
// Deviation: Lucene instantiates the generated, unrolled BulkOperationPacked1..24 for 1..24 bits per value and
// this generic class for the others. They are meant to behave identically, so this port uses the generic class
// for every number of bits (the unrolled classes are not ported; golden tests compare against them).
// Java long arithmetic is done on bigints (wrapped by BigInt64Array stores), int arithmetic with JS int32 operators.

import { UnsupportedOperationException } from "../../errors.js";
import { lassert } from "../assertions.js";
import { Long } from "../JavaNumbers.js";
import { BulkOperation } from "./BulkOperation.js";
import { packedBitsRequired, packedUnsignedBitsRequired } from "./PackedIntsBase.js";

const B: bigint[] = [];
for (let i = 0; i <= 64; i++) B.push(BigInt(i));

/** unsigned right shift of a 64-bit value (the result may be left unwrapped: it is stored in a BigInt64Array) */
function ushr(x: bigint, n: number): bigint {
  return BigInt.asUintN(64, x) >> B[n & 63]!;
}

/** Non-specialized {@link BulkOperation} for PackedInts.Format.PACKED. */
export class BulkOperationPacked extends BulkOperation {
  private readonly bitsPerValue: number;
  private readonly _longBlockCount: number;
  private readonly _longValueCount: number;
  private readonly _byteBlockCount: number;
  private readonly _byteValueCount: number;
  private readonly mask: bigint;
  private readonly intMask: number;

  constructor(bitsPerValue: number) {
    super();
    this.bitsPerValue = bitsPerValue;
    lassert(() => bitsPerValue > 0 && bitsPerValue <= 64);
    let blocks = bitsPerValue;
    while ((blocks & 1) === 0) {
      blocks >>>= 1;
    }
    this._longBlockCount = blocks;
    this._longValueCount = Math.floor((64 * this._longBlockCount) / bitsPerValue);
    let byteBlockCount = 8 * this._longBlockCount;
    let byteValueCount = this._longValueCount;
    while ((byteBlockCount & 1) === 0 && (byteValueCount & 1) === 0) {
      byteBlockCount >>>= 1;
      byteValueCount >>>= 1;
    }
    this._byteBlockCount = byteBlockCount;
    this._byteValueCount = byteValueCount;
    if (bitsPerValue === 64) {
      this.mask = -1n;
    } else {
      this.mask = (1n << B[bitsPerValue]!) - 1n;
    }
    this.intMask = Number(BigInt.asIntN(32, this.mask));
    lassert(() => this._longValueCount * bitsPerValue === 64 * this._longBlockCount);
  }

  longBlockCount(): number {
    return this._longBlockCount;
  }

  longValueCount(): number {
    return this._longValueCount;
  }

  byteBlockCount(): number {
    return this._byteBlockCount;
  }

  byteValueCount(): number {
    return this._byteValueCount;
  }

  decode(
    blocks: BigInt64Array | Uint8Array,
    blocksOffset: number,
    values: BigInt64Array | Int32Array,
    valuesOffset: number,
    iterations: number,
  ): void {
    if (blocks instanceof BigInt64Array) {
      if (values instanceof BigInt64Array) {
        this.decodeLongsToLongs(blocks, blocksOffset, values, valuesOffset, iterations);
      } else {
        this.decodeLongsToInts(blocks, blocksOffset, values, valuesOffset, iterations);
      }
    } else if (values instanceof BigInt64Array) {
      this.decodeBytesToLongs(blocks, blocksOffset, values, valuesOffset, iterations);
    } else {
      this.decodeBytesToInts(blocks, blocksOffset, values, valuesOffset, iterations);
    }
  }

  private decodeLongsToLongs(blocks: BigInt64Array, blocksOffset: number, values: BigInt64Array, valuesOffset: number, iterations: number): void {
    const bpv = this.bitsPerValue;
    let bitsLeft = 64;
    for (let i = 0; i < this._longValueCount * iterations; ++i) {
      bitsLeft -= bpv;
      if (bitsLeft < 0) {
        values[valuesOffset++] =
          ((blocks[blocksOffset++]! & Long.lowMask(bpv + bitsLeft)) << B[-bitsLeft & 63]!) | ushr(blocks[blocksOffset]!, 64 + bitsLeft);
        bitsLeft += 64;
      } else {
        values[valuesOffset++] = ushr(blocks[blocksOffset]!, bitsLeft) & this.mask;
      }
    }
  }

  private decodeBytesToLongs(blocks: Uint8Array, blocksOffset: number, values: BigInt64Array, valuesOffset: number, iterations: number): void {
    const bpv = this.bitsPerValue;
    let nextValue = 0n;
    let bitsLeft = bpv;
    for (let i = 0; i < iterations * this._byteBlockCount; ++i) {
      const bytes = BigInt(blocks[blocksOffset++]!);
      if (bitsLeft > 8) {
        // just buffer
        bitsLeft -= 8;
        nextValue |= bytes << B[bitsLeft]!;
      } else {
        // flush
        let bits = 8 - bitsLeft;
        values[valuesOffset++] = nextValue | (bytes >> B[bits]!);
        while (bits >= bpv) {
          bits -= bpv;
          values[valuesOffset++] = (bytes >> B[bits]!) & this.mask;
        }
        // then buffer
        bitsLeft = bpv - bits;
        nextValue = (bytes & Long.lowMask(bits)) << B[bitsLeft]!;
      }
    }
    lassert(() => bitsLeft === bpv);
  }

  private decodeLongsToInts(blocks: BigInt64Array, blocksOffset: number, values: Int32Array, valuesOffset: number, iterations: number): void {
    const bpv = this.bitsPerValue;
    if (bpv > 32) {
      throw new UnsupportedOperationException("Cannot decode " + bpv + "-bits values into an int[]");
    }
    let bitsLeft = 64;
    for (let i = 0; i < this._longValueCount * iterations; ++i) {
      bitsLeft -= bpv;
      if (bitsLeft < 0) {
        values[valuesOffset++] = Number(
          BigInt.asIntN(
            32,
            ((blocks[blocksOffset++]! & Long.lowMask(bpv + bitsLeft)) << B[-bitsLeft & 63]!) | ushr(blocks[blocksOffset]!, 64 + bitsLeft),
          ),
        );
        bitsLeft += 64;
      } else {
        values[valuesOffset++] = Number(BigInt.asIntN(32, ushr(blocks[blocksOffset]!, bitsLeft) & this.mask));
      }
    }
  }

  private decodeBytesToInts(blocks: Uint8Array, blocksOffset: number, values: Int32Array, valuesOffset: number, iterations: number): void {
    const bpv = this.bitsPerValue;
    let nextValue = 0;
    let bitsLeft = bpv;
    for (let i = 0; i < iterations * this._byteBlockCount; ++i) {
      const bytes = blocks[blocksOffset++]! & 0xff;
      if (bitsLeft > 8) {
        // just buffer
        bitsLeft -= 8;
        nextValue |= bytes << bitsLeft;
      } else {
        // flush
        let bits = 8 - bitsLeft;
        values[valuesOffset++] = nextValue | (bytes >>> bits);
        while (bits >= bpv) {
          bits -= bpv;
          values[valuesOffset++] = (bytes >>> bits) & this.intMask;
        }
        // then buffer
        bitsLeft = bpv - bits;
        nextValue = (bytes & ((1 << bits) - 1)) << bitsLeft;
      }
    }
    lassert(() => bitsLeft === bpv);
  }

  encode(
    values: BigInt64Array | Int32Array,
    valuesOffset: number,
    blocks: BigInt64Array | Uint8Array,
    blocksOffset: number,
    iterations: number,
  ): void {
    if (blocks instanceof BigInt64Array) {
      if (values instanceof BigInt64Array) {
        this.encodeLongsToLongs(values, valuesOffset, blocks, blocksOffset, iterations);
      } else {
        this.encodeIntsToLongs(values, valuesOffset, blocks, blocksOffset, iterations);
      }
    } else if (values instanceof BigInt64Array) {
      this.encodeLongsToBytes(values, valuesOffset, blocks, blocksOffset, iterations);
    } else {
      this.encodeIntsToBytes(values, valuesOffset, blocks, blocksOffset, iterations);
    }
  }

  private encodeLongsToLongs(values: BigInt64Array, valuesOffset: number, blocks: BigInt64Array, blocksOffset: number, iterations: number): void {
    const bpv = this.bitsPerValue;
    let nextBlock = 0n;
    let bitsLeft = 64;
    for (let i = 0; i < this._longValueCount * iterations; ++i) {
      bitsLeft -= bpv;
      if (bitsLeft > 0) {
        nextBlock |= values[valuesOffset++]! << B[bitsLeft]!;
      } else if (bitsLeft === 0) {
        nextBlock |= values[valuesOffset++]!;
        blocks[blocksOffset++] = nextBlock;
        nextBlock = 0n;
        bitsLeft = 64;
      } else {
        // bitsLeft < 0
        nextBlock |= ushr(values[valuesOffset]!, -bitsLeft);
        blocks[blocksOffset++] = nextBlock;
        nextBlock = (values[valuesOffset++]! & Long.lowMask(-bitsLeft)) << B[64 + bitsLeft]!;
        bitsLeft += 64;
      }
    }
  }

  private encodeIntsToLongs(values: Int32Array, valuesOffset: number, blocks: BigInt64Array, blocksOffset: number, iterations: number): void {
    const bpv = this.bitsPerValue;
    let nextBlock = 0n;
    let bitsLeft = 64;
    for (let i = 0; i < this._longValueCount * iterations; ++i) {
      bitsLeft -= bpv;
      if (bitsLeft > 0) {
        nextBlock |= BigInt(values[valuesOffset++]! >>> 0) << B[bitsLeft]!;
      } else if (bitsLeft === 0) {
        nextBlock |= BigInt(values[valuesOffset++]! >>> 0);
        blocks[blocksOffset++] = nextBlock;
        nextBlock = 0n;
        bitsLeft = 64;
      } else {
        // bitsLeft < 0
        nextBlock |= BigInt(values[valuesOffset]! >>> 0) >> B[-bitsLeft]!;
        blocks[blocksOffset++] = nextBlock;
        nextBlock = (BigInt(values[valuesOffset++]! >>> 0) & Long.lowMask(-bitsLeft)) << B[64 + bitsLeft]!;
        bitsLeft += 64;
      }
    }
  }

  private encodeLongsToBytes(values: BigInt64Array, valuesOffset: number, blocks: Uint8Array, blocksOffset: number, iterations: number): void {
    const bpv = this.bitsPerValue;
    let nextBlock = 0;
    let bitsLeft = 8;
    for (let i = 0; i < this._byteValueCount * iterations; ++i) {
      const v = values[valuesOffset++]!;
      lassert(() => packedUnsignedBitsRequired(v) <= bpv);
      if (bpv < bitsLeft) {
        // just buffer
        nextBlock |= Number(BigInt.asIntN(32, v << B[bitsLeft - bpv]!));
        bitsLeft -= bpv;
      } else {
        // flush as many blocks as possible
        let bits = bpv - bitsLeft;
        blocks[blocksOffset++] = (nextBlock & 0xff) | Number(BigInt.asUintN(8, ushr(v, bits)));
        while (bits >= 8) {
          bits -= 8;
          blocks[blocksOffset++] = Number(BigInt.asUintN(8, ushr(v, bits)));
        }
        // then buffer
        bitsLeft = 8 - bits;
        nextBlock = Number(BigInt.asIntN(32, (v & Long.lowMask(bits)) << B[bitsLeft]!));
      }
    }
    lassert(() => bitsLeft === 8);
  }

  private encodeIntsToBytes(values: Int32Array, valuesOffset: number, blocks: Uint8Array, blocksOffset: number, iterations: number): void {
    const bpv = this.bitsPerValue;
    let nextBlock = 0;
    let bitsLeft = 8;
    for (let i = 0; i < this._byteValueCount * iterations; ++i) {
      const v = values[valuesOffset++]!;
      lassert(() => packedBitsRequired(BigInt(v >>> 0)) <= bpv);
      if (bpv < bitsLeft) {
        // just buffer
        nextBlock |= v << (bitsLeft - bpv);
        bitsLeft -= bpv;
      } else {
        // flush as many blocks as possible
        let bits = bpv - bitsLeft;
        blocks[blocksOffset++] = (nextBlock | (v >>> bits)) & 0xff;
        while (bits >= 8) {
          bits -= 8;
          blocks[blocksOffset++] = (v >>> bits) & 0xff;
        }
        // then buffer
        bitsLeft = 8 - bits;
        nextBlock = (v & ((1 << bits) - 1)) << bitsLeft;
      }
    }
    lassert(() => bitsLeft === 8);
  }
}
