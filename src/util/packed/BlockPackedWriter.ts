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

// Port of org.apache.lucene.util.packed.BlockPackedWriter (Lucene 5.2.1).

import type { DataOutput } from "../../store/DataOutput.js";
import { lassert } from "../assertions.js";
import { BitUtil } from "../BitUtil.js";
import { AbstractBlockPackedWriter, BPV_SHIFT, MIN_VALUE_EQUALS_0, writeVLong } from "./AbstractBlockPackedWriter.js";
import { PackedInts } from "./PackedInts.js";

/**
 * A writer for large sequences of longs.
 *
 * The sequence is divided into fixed-size blocks and for each block, the difference between each value and the
 * minimum value of the block is encoded using as few bits as possible. Memory usage of this class is proportional
 * to the block size. Each block has an overhead between 1 and 10 bytes to store the minimum value and the number
 * of bits per value of the block.
 *
 * Format:
 * <ul>
 * <li>&lt;BLock&gt;<sup>BlockCount</sup>
 * <li>BlockCount: &lceil; ValueCount / BlockSize &rceil;
 * <li>Block: &lt;Header, (Ints)&gt;
 * <li>Header: &lt;Token, (MinValue)&gt;
 * <li>Token: a {@link DataOutput#writeByte(byte) byte}, first 7 bits are the number of bits per value (<code>bitsPerValue</code>). If the 8th bit is 1, then MinValue (see next) is <code>0</code>, otherwise MinValue and needs to be decoded
 * <li>MinValue: a <a href="https://developers.google.com/protocol-buffers/docs/encoding#types">zigzag-encoded</a> {@link DataOutput#writeVLong(long) variable-length long} whose value should be added to every int from the block to restore the original values
 * <li>Ints: If the number of bits per value is <code>0</code>, then there is nothing to decode and all values are equal to MinValue. Otherwise: BlockSize {@link PackedInts packed ints} encoded on exactly <code>bitsPerValue</code> bits per value. They are the subtraction result of the original values and MinValue
 * </ul>
 * @see BlockPackedReaderIterator
 * @see BlockPackedReader
 * @lucene.internal
 */
export class BlockPackedWriter extends AbstractBlockPackedWriter {
  /**
   * Sole constructor.
   * @param blockSize the number of values of a single block, must be a power of 2
   */
  constructor(out: DataOutput, blockSize: number) {
    super(out, blockSize);
  }

  protected flush(): void {
    lassert(() => this.off > 0);
    let min = 9223372036854775807n;
    let max = -9223372036854775808n;
    for (let i = 0; i < this.off; ++i) {
      const v = this.values[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }

    const delta = BigInt.asIntN(64, max - min);
    const bitsRequired = delta === 0n ? 0 : PackedInts.unsignedBitsRequired(delta);
    if (bitsRequired === 64) {
      // no need to delta-encode
      min = 0n;
    } else if (min > 0n) {
      // make min as small as possible so that writeVLong requires fewer bytes
      const m = BigInt.asIntN(64, max - PackedInts.maxValue(bitsRequired));
      min = m > 0n ? m : 0n;
    }

    const token = (bitsRequired << BPV_SHIFT) | (min === 0n ? MIN_VALUE_EQUALS_0 : 0);
    this.out.writeByte(token);

    if (min !== 0n) {
      writeVLong(this.out, BigInt.asIntN(64, BitUtil.zigZagEncode(min) - 1n));
    }

    if (bitsRequired > 0) {
      if (min !== 0n) {
        for (let i = 0; i < this.off; ++i) {
          this.values[i] = this.values[i]! - min;
        }
      }
      this.writeValues(bitsRequired);
    }

    this.off = 0;
  }
}
