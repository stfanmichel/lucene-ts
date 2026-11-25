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

// Port of org.apache.lucene.util.fst.ByteSequenceOutputs (Lucene 5.2.1).
//
// BASE_NUM_BYTES is RamUsageEstimator.shallowSizeOf(new BytesRef()) on a 64-bit HotSpot JVM with compressed oops.

import type { DataInput } from "../../store/DataInput.js";
import type { DataOutput } from "../../store/DataOutput.js";
import { lassert } from "../assertions.js";
import { BytesRef } from "../BytesRef.js";
import { RamUsageEstimator } from "../RamUsageEstimator.js";
import { StringHelper } from "../StringHelper.js";
import { Outputs } from "./Outputs.js";

/**
 * An FST {@link Outputs} implementation where each output is a sequence of bytes.
 *
 * @lucene.experimental
 */
export class ByteSequenceOutputs extends Outputs<BytesRef> {
  private static readonly NO_OUTPUT = new BytesRef();
  private static readonly singleton = new ByteSequenceOutputs();
  private static readonly BASE_NUM_BYTES = 24;

  private constructor() {
    super();
  }

  static getSingleton(): ByteSequenceOutputs {
    return ByteSequenceOutputs.singleton;
  }

  common(output1: BytesRef, output2: BytesRef): BytesRef {
    lassert(() => output1 !== null);
    lassert(() => output2 !== null);

    let pos1 = output1.offset;
    let pos2 = output2.offset;
    const stopAt1 = pos1 + Math.min(output1.length, output2.length);
    while (pos1 < stopAt1) {
      if (output1.bytes[pos1] !== output2.bytes[pos2]) {
        break;
      }
      pos1++;
      pos2++;
    }

    if (pos1 === output1.offset) {
      // no common prefix
      return ByteSequenceOutputs.NO_OUTPUT;
    } else if (pos1 === output1.offset + output1.length) {
      // output1 is a prefix of output2
      return output1;
    } else if (pos2 === output2.offset + output2.length) {
      // output2 is a prefix of output1
      return output2;
    } else {
      return new BytesRef(output1.bytes, output1.offset, pos1 - output1.offset);
    }
  }

  subtract(output: BytesRef, inc: BytesRef): BytesRef {
    lassert(() => output !== null);
    lassert(() => inc !== null);
    if (inc === ByteSequenceOutputs.NO_OUTPUT) {
      // no prefix removed
      return output;
    } else {
      lassert(() => StringHelper.startsWith(output, inc));
      if (inc.length === output.length) {
        // entire output removed
        return ByteSequenceOutputs.NO_OUTPUT;
      } else {
        lassert(() => inc.length < output.length, () => "inc.length=" + inc.length + " vs output.length=" + output.length);
        lassert(() => inc.length > 0);
        return new BytesRef(output.bytes, output.offset + inc.length, output.length - inc.length);
      }
    }
  }

  add(prefix: BytesRef, output: BytesRef): BytesRef {
    lassert(() => prefix !== null);
    lassert(() => output !== null);
    if (prefix === ByteSequenceOutputs.NO_OUTPUT) {
      return output;
    } else if (output === ByteSequenceOutputs.NO_OUTPUT) {
      return prefix;
    } else {
      lassert(() => prefix.length > 0);
      lassert(() => output.length > 0);
      const result = new BytesRef(prefix.length + output.length);
      result.bytes.set(prefix.bytes.subarray(prefix.offset, prefix.offset + prefix.length), 0);
      result.bytes.set(output.bytes.subarray(output.offset, output.offset + output.length), prefix.length);
      result.length = prefix.length + output.length;
      return result;
    }
  }

  write(prefix: BytesRef, out: DataOutput): void {
    lassert(() => prefix !== null);
    out.writeVInt(prefix.length);
    out.writeBytes(prefix.bytes, prefix.offset, prefix.length);
  }

  read(input: DataInput): BytesRef {
    const len = input.readVInt();
    if (len === 0) {
      return ByteSequenceOutputs.NO_OUTPUT;
    } else {
      const output = new BytesRef(len);
      input.readBytes(output.bytes, 0, len);
      output.length = len;
      return output;
    }
  }

  override skipOutput(input: DataInput): void {
    const len = input.readVInt();
    if (len !== 0) {
      input.skipBytes(len);
    }
  }

  getNoOutput(): BytesRef {
    return ByteSequenceOutputs.NO_OUTPUT;
  }

  outputToString(output: BytesRef): string {
    return output.toString();
  }

  ramBytesUsed(output: BytesRef): number {
    return ByteSequenceOutputs.BASE_NUM_BYTES + RamUsageEstimator.sizeOf(output.bytes);
  }

  override toString(): string {
    return "ByteSequenceOutputs";
  }
}
