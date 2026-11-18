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

// Port of org.apache.lucene.store.RandomAccessInput (Lucene 5.2.1).
//
// Java tells RandomAccessInput implementations apart with `instanceof`. A TypeScript interface has no runtime
// identity (and `readByte(pos)` cannot be told from DataInput's `readByte()` by shape), so implementations carry
// the RANDOM_ACCESS_INPUT marker and are recognized with isRandomAccessInput().

/** Runtime marker of the RandomAccessInput interface (a getter on the implementing class' prototype). */
export const RANDOM_ACCESS_INPUT: unique symbol = Symbol.for("lucene-ts.RandomAccessInput");

/**
 * Random Access Index API.
 * Unlike {@link IndexInput}, this has no concept of file position, all reads
 * are absolute. However, like IndexInput, it is only intended for use by a single thread.
 */
export interface RandomAccessInput {
  readonly [RANDOM_ACCESS_INPUT]: true;

  /**
   * Reads a byte (0..255) at the given position in the file
   * @see DataInput.readByte
   */
  readByte(pos: number): number;

  /**
   * Reads a short at the given position in the file
   * @see DataInput.readShort
   */
  readShort(pos: number): number;

  /**
   * Reads an integer at the given position in the file
   * @see DataInput.readInt
   */
  readInt(pos: number): number;

  /**
   * Reads a long at the given position in the file
   * @see DataInput.readLong
   */
  readLong(pos: number): bigint;
}

/** Java's `x instanceof RandomAccessInput`. */
export function isRandomAccessInput(x: unknown): x is RandomAccessInput {
  return typeof x === "object" && x !== null && (x as Record<symbol, unknown>)[RANDOM_ACCESS_INPUT] === true;
}
