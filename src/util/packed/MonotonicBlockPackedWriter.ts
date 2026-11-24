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

// Port of org.apache.lucene.util.packed.MonotonicBlockPackedWriter (Lucene 5.2.1).

import type { DataOutput } from "../../store/DataOutput.js";
import { lassert } from "../assertions.js";
import { Float, Long } from "../JavaNumbers.js";
import { AbstractBlockPackedWriter } from "./AbstractBlockPackedWriter.js";
import { MonotonicBlockPackedReader } from "./MonotonicBlockPackedReader.js";
import { PackedInts } from "./PackedInts.js";

/**
 * A writer for large monotonically increasing sequences of positive longs.
 *
 * The sequence is divided into fixed-size blocks and for each block, values are modeled after a linear function
 * f: x &rarr; A &times; x + B. The block encodes deltas from the expected values computed from this function using
 * as few bits as possible. Each block has an overhead between 6 and 14 bytes.
 *
 * @see MonotonicBlockPackedReader
 * @lucene.internal
 */
export class MonotonicBlockPackedWriter extends AbstractBlockPackedWriter {
  /**
   * Sole constructor.
   * @param blockSize the number of values of a single block, must be a power of 2
   */
  constructor(out: DataOutput, blockSize: number) {
    super(out, blockSize);
  }

  override add(l: bigint): void {
    lassert(() => l >= 0n);
    super.add(l);
  }

  protected flush(): void {
    lassert(() => this.off > 0);

    // (float) (values[off - 1] - values[0]) / (off - 1)
    const avg =
      this.off === 1
        ? 0
        : Math.fround(Long.toFloat(BigInt.asIntN(64, this.values[this.off - 1]! - this.values[0]!)) / (this.off - 1));
    let min = this.values[0]!;
    // adjust min so that all deltas will be positive
    for (let i = 1; i < this.off; ++i) {
      const actual = this.values[i]!;
      const expected = MonotonicBlockPackedReader.expected(min, avg, i);
      if (expected > actual) {
        min = BigInt.asIntN(64, min - (expected - actual));
      }
    }

    let maxDelta = 0n;
    for (let i = 0; i < this.off; ++i) {
      this.values[i] = this.values[i]! - MonotonicBlockPackedReader.expected(min, avg, i);
      if (this.values[i]! > maxDelta) maxDelta = this.values[i]!;
    }

    this.out.writeZLong(min);
    this.out.writeInt(Float.floatToIntBits(avg));
    if (maxDelta === 0n) {
      this.out.writeVInt(0);
    } else {
      const bitsRequired = PackedInts.bitsRequired(maxDelta);
      this.out.writeVInt(bitsRequired);
      this.writeValues(bitsRequired);
    }

    this.off = 0;
  }
}
