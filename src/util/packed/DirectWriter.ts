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

// Port of org.apache.lucene.util.packed.DirectWriter (Lucene 5.2.1).
//
// Deviation: numValues and the value count are numbers; values are bigints.

import { ArrayIndexOutOfBoundsException, EOFException, IllegalArgumentException, IllegalStateException } from "../../errors.js";
import type { IndexOutput } from "../../store/IndexOutput.js";
import { lassert } from "../assertions.js";
import type { BulkOperation } from "./BulkOperation.js";
import { bulkOperationOf } from "./BulkOperationFactory.js";
import { PackedInts } from "./PackedInts.js";

const SUPPORTED_BITS_PER_VALUE: readonly number[] = [1, 2, 4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64];

/** Arrays.binarySearch on SUPPORTED_BITS_PER_VALUE */
function binarySearch(key: number): number {
  let lo = 0;
  let hi = SUPPORTED_BITS_PER_VALUE.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = SUPPORTED_BITS_PER_VALUE[mid]!;
    if (v < key) lo = mid + 1;
    else if (v > key) hi = mid - 1;
    else return mid;
  }
  return -(lo + 1);
}

/**
 * Class for writing packed integers to be directly read from Directory. Integers can be read on-the-fly via
 * {@link DirectReader}.
 *
 * Unlike PackedInts, it optimizes for read i/o operations and supports > 2B values. Example usage:
 * <pre class="prettyprint">
 *   int bitsPerValue = DirectWriter.bitsRequired(100); // values up to and including 100
 *   IndexOutput output = dir.createOutput("packed", IOContext.DEFAULT);
 *   DirectWriter writer = DirectWriter.getInstance(output, numberOfValues, bitsPerValue);
 *   for (int i = 0; i < numberOfValues; i++) {
 *     writer.add(value);
 *   }
 *   writer.finish();
 *   output.close();
 * </pre>
 * @see DirectReader
 */
export class DirectWriter {
  readonly bitsPerValue: number;
  readonly numValues: number;
  readonly output: IndexOutput;

  count = 0;
  finished = false;

  // for now, just use the existing writer under the hood
  off = 0;
  readonly nextBlocks: Uint8Array;
  readonly nextValues: BigInt64Array;
  readonly encoder: BulkOperation;
  readonly iterations: number;

  /** @internal */
  constructor(output: IndexOutput, numValues: number, bitsPerValue: number) {
    this.output = output;
    this.numValues = numValues;
    this.bitsPerValue = bitsPerValue;
    this.encoder = bulkOperationOf(PackedInts.Format.PACKED, bitsPerValue);
    this.iterations = this.encoder.computeIterations(Math.min(numValues, 2147483647), PackedInts.DEFAULT_BUFFER_SIZE);
    this.nextBlocks = new Uint8Array(this.iterations * this.encoder.byteBlockCount());
    this.nextValues = new BigInt64Array(this.iterations * this.encoder.byteValueCount());
  }

  /** Adds a value to this writer */
  add(l: bigint): void {
    lassert(
      () => this.bitsPerValue === 64 || (l >= 0n && l <= PackedInts.maxValue(this.bitsPerValue)),
      () => String(this.bitsPerValue),
    );
    lassert(() => !this.finished);
    if (this.count >= this.numValues) {
      throw new EOFException("Writing past end of stream");
    }
    this.nextValues[this.off++] = l;
    if (this.off === this.nextValues.length) {
      this.flush();
    }
    this.count++;
  }

  private flush(): void {
    this.encoder.encode(this.nextValues, 0, this.nextBlocks, 0, this.iterations);
    const blockCount = PackedInts.Format.PACKED.byteCount(PackedInts.VERSION_CURRENT, this.off, this.bitsPerValue);
    this.output.writeBytes(this.nextBlocks, 0, blockCount);
    this.nextValues.fill(0n);
    this.off = 0;
  }

  /** finishes writing */
  finish(): void {
    if (this.count !== this.numValues) {
      throw new IllegalStateException("Wrong number of values added, expected: " + this.numValues + ", got: " + this.count);
    }
    lassert(() => !this.finished);
    this.flush();
    // pad for fast io: we actually only need this for certain BPV, but its just 3 bytes...
    for (let i = 0; i < 3; i++) {
      this.output.writeByte(0);
    }
    this.finished = true;
  }

  /**
   * Returns an instance suitable for encoding <code>numValues</code> using <code>bitsPerValue</code>
   */
  static getInstance(output: IndexOutput, numValues: number, bitsPerValue: number): DirectWriter {
    if (binarySearch(bitsPerValue) < 0) {
      throw new IllegalArgumentException("Unsupported bitsPerValue " + bitsPerValue + ". Did you use bitsRequired?");
    }
    return new DirectWriter(output, numValues, bitsPerValue);
  }

  /**
   * Round a number of bits per value to the next amount of bits per value that is supported by this writer.
   */
  private static roundBits(bitsRequired: number): number {
    const index = binarySearch(bitsRequired);
    if (index < 0) {
      const at = -index - 1;
      if (at >= SUPPORTED_BITS_PER_VALUE.length) {
        throw new ArrayIndexOutOfBoundsException("Index " + at + " out of bounds for length " + SUPPORTED_BITS_PER_VALUE.length);
      }
      return SUPPORTED_BITS_PER_VALUE[at]!;
    } else {
      return bitsRequired;
    }
  }

  /**
   * Returns how many bits are required to hold values up to and including maxValue
   *
   * @param maxValue the maximum value that should be representable.
   * @return the amount of bits needed to represent values from 0 to maxValue.
   * @see PackedInts#bitsRequired(long)
   */
  static bitsRequired(maxValue: bigint): number {
    return DirectWriter.roundBits(PackedInts.bitsRequired(maxValue));
  }

  /**
   * Returns how many bits are required to hold values up to and including maxValue, interpreted as an unsigned value.
   *
   * @param maxValue the maximum value that should be representable.
   * @return the amount of bits needed to represent values from 0 to maxValue.
   * @see PackedInts#unsignedBitsRequired(long)
   */
  static unsignedBitsRequired(maxValue: bigint): number {
    return DirectWriter.roundBits(PackedInts.unsignedBitsRequired(maxValue));
  }

  static readonly SUPPORTED_BITS_PER_VALUE: readonly number[] = SUPPORTED_BITS_PER_VALUE;
}
