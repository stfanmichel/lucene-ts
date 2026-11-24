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

// Port of org.apache.lucene.util.LongValues (Lucene 5.2.1).
//
// Deviation: Java's get(long) and get(int) are one method get(index: number): positions are numbers here.

import { NumericDocValues } from "../index/NumericDocValues.js";

/**
 * Abstraction over an array of longs. This class extends NumericDocValues so that we don't need to add another
 * level of abstraction every time we want eg. to use the {@link PackedInts} utility classes to represent a
 * {@link NumericDocValues} instance.
 *
 * @lucene.internal
 */
export abstract class LongValues extends NumericDocValues {
  /** An instance that returns the provided value. */
  static readonly IDENTITY: LongValues = new (class extends LongValues {
    get(index: number): bigint {
      return BigInt(index);
    }
  })();

  protected constructor() {
    super();
  }

  /** Get value at <code>index</code>. */
  abstract override get(index: number): bigint;
}
