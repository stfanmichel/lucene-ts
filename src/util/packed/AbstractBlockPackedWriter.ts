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

// Port of org.apache.lucene.util.packed.AbstractBlockPackedWriter (Lucene 5.2.1).
//
// Deviation: values are bigints (BigInt64Array); ord is a number.

import { IllegalStateException } from "../../errors.js";
import type { DataOutput } from "../../store/DataOutput.js";
import { lassert } from "../assertions.js";
import { Long } from "../JavaNumbers.js";
import { PackedInts } from "./PackedInts.js";

export const MIN_BLOCK_SIZE = 64;
export const MAX_BLOCK_SIZE = 1 << (30 - 3);
export const MIN_VALUE_EQUALS_0 = 1 << 0;
export const BPV_SHIFT = 1;

// same as DataOutput.writeVLong but accepts negative values
export function writeVLong(out: DataOutput, i: bigint): void {
  let k = 0;
  while ((i & ~0x7fn) !== 0n && k++ < 8) {
    out.writeByte(Number((i & 0x7fn) | 0x80n));
    i = Long.ushr(i, 7);
  }
  out.writeByte(Number(i & 0xffn));
}

/**
 * Abstract class to buffer a list of longs in blocks of 2 * 8 * 8 * 8 values in order to prepare delta or other
 * encodings. Subclasses write them.
 *
 * @lucene.internal
 */
export abstract class AbstractBlockPackedWriter {
  static readonly MIN_BLOCK_SIZE = MIN_BLOCK_SIZE;
  static readonly MAX_BLOCK_SIZE = MAX_BLOCK_SIZE;
  static readonly MIN_VALUE_EQUALS_0 = MIN_VALUE_EQUALS_0;
  static readonly BPV_SHIFT = BPV_SHIFT;
  static readonly writeVLong = writeVLong;

  protected out!: DataOutput;
  protected readonly values: BigInt64Array;
  protected blocks: Uint8Array | null = null;
  protected off = 0;
  protected ord_ = 0;
  protected finished = false;

  /**
   * Sole constructor.
   * @param blockSize the number of values of a single block, must be a power of 2
   */
  constructor(out: DataOutput, blockSize: number) {
    PackedInts.checkBlockSize(blockSize, MIN_BLOCK_SIZE, MAX_BLOCK_SIZE);
    this.reset(out);
    this.values = new BigInt64Array(blockSize);
  }

  /** Reset this writer to wrap <code>out</code>. The block size remains unchanged. */
  reset(out: DataOutput): void {
    lassert(() => out !== null && out !== undefined);
    this.out = out;
    this.off = 0;
    this.ord_ = 0;
    this.finished = false;
  }

  private checkNotFinished(): void {
    if (this.finished) {
      throw new IllegalStateException("Already finished");
    }
  }

  /** Append a new long. */
  add(l: bigint): void {
    this.checkNotFinished();
    if (this.off === this.values.length) {
      this.flush();
    }
    this.values[this.off++] = l;
    ++this.ord_;
  }

  // For testing only
  /** @internal */
  addBlockOfZeros(): void {
    this.checkNotFinished();
    if (this.off !== 0 && this.off !== this.values.length) {
      throw new IllegalStateException("" + this.off);
    }
    if (this.off === this.values.length) {
      this.flush();
    }
    this.values.fill(0n);
    this.off = this.values.length;
    this.ord_ += this.values.length;
  }

  /** Flush all buffered data to disk. This instance is not usable anymore after this method has been called until {@link reset} has been called. */
  finish(): void {
    this.checkNotFinished();
    if (this.off > 0) {
      this.flush();
    }
    this.finished = true;
  }

  /** Return the number of values which have been added. */
  ord(): number {
    return this.ord_;
  }

  protected abstract flush(): void;

  protected writeValues(bitsRequired: number): void {
    const encoder = PackedInts.getEncoder(PackedInts.Format.PACKED, PackedInts.VERSION_CURRENT, bitsRequired);
    const iterations = Math.floor(this.values.length / encoder.byteValueCount());
    const blockSize = encoder.byteBlockCount() * iterations;
    if (this.blocks === null || this.blocks.length < blockSize) {
      this.blocks = new Uint8Array(blockSize);
    }
    if (this.off < this.values.length) {
      this.values.fill(0n, this.off, this.values.length);
    }
    encoder.encode(this.values, 0, this.blocks, 0, iterations);
    const blockCount = PackedInts.Format.PACKED.byteCount(PackedInts.VERSION_CURRENT, this.off, bitsRequired);
    this.out.writeBytes(this.blocks, 0, blockCount);
  }
}
