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

// Port of org.apache.lucene.util.fst.Outputs (Lucene 5.2.1).

import type { DataInput } from "../../store/DataInput.js";
import type { DataOutput } from "../../store/DataOutput.js";
import { UnsupportedOperationException } from "../../errors.js";

/**
 * Represents the outputs for an FST, providing the basic algebra required for building and traversing the FST.
 *
 * Note that any operation that returns NO_OUTPUT must return the same singleton object from {@link getNoOutput}.
 *
 * @lucene.experimental
 */
export abstract class Outputs<T> {
  // TODO: maybe change this API to allow for re-use of the output instances -- this is an insane amount of garbage
  // (new object per byte/char/int) if eg used during analysis

  /** Eg common("foobar", "food") -> "foo" */
  abstract common(output1: T, output2: T): T;

  /** Eg subtract("foobar", "foo") -> "bar" */
  abstract subtract(output: T, inc: T): T;

  /** Eg add("foo", "bar") -> "foobar" */
  abstract add(prefix: T, output: T): T;

  /** Encode an output value into a {@link DataOutput}. */
  abstract write(output: T, out: DataOutput): void;

  /**
   * Encode an final node output value into a {@link DataOutput}. By default this just calls {@link write}.
   */
  writeFinalOutput(output: T, out: DataOutput): void {
    this.write(output, out);
  }

  /** Decode an output value previously written with {@link write}. */
  abstract read(input: DataInput): T;

  /** Skip the output; defaults to just calling {@link read} and discarding the result. */
  skipOutput(input: DataInput): void {
    this.read(input);
  }

  /**
   * Decode an output value previously written with {@link writeFinalOutput}. By default this just calls {@link read}.
   */
  readFinalOutput(input: DataInput): T {
    return this.read(input);
  }

  /** Skip the output previously written with {@link writeFinalOutput}; defaults to just calling {@link skipOutput}. */
  skipFinalOutput(input: DataInput): void {
    this.skipOutput(input);
  }

  /** NOTE: this output is compared with == so you must ensure that all methods return the single object if it's really no output */
  abstract getNoOutput(): T;

  abstract outputToString(output: T): string;

  // TODO: maybe make valid(T output) public...?  for asserts

  merge(_first: T, _second: T): T {
    throw new UnsupportedOperationException();
  }

  /** Return memory usage for the provided output. */
  abstract ramBytesUsed(output: T): number;
}
