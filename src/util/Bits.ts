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

/**
 * Port of org.apache.lucene.util.Bits: Interface for Bitset-like structures.
 * The nested classes and the constant of the Java interface live on the `Bits` value of the same name.
 */
export interface Bits {
  /** Returns the value of the bit with the specified <code>index</code>. */
  get(index: number): boolean;

  /** Returns the number of bits in this set */
  length(): number;
}

/** Bits impl of the specified length with all bits set. */
class MatchAllBits implements Bits {
  /** @internal */
  readonly len: number;

  constructor(len: number) {
    this.len = len;
  }

  get(_index: number): boolean {
    return true;
  }

  length(): number {
    return this.len;
  }
}

/** Bits impl of the specified length with no bits set. */
class MatchNoBits implements Bits {
  /** @internal */
  readonly len: number;

  constructor(len: number) {
    this.len = len;
  }

  get(_index: number): boolean {
    return false;
  }

  length(): number {
    return this.len;
  }
}

export const Bits = {
  EMPTY_ARRAY: [] as Bits[],
  MatchAllBits,
  MatchNoBits,
} as const;
