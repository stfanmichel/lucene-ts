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

// Port of org.apache.lucene.store.FlushInfo (Lucene 5.2.1).

/** Java's Long.hashCode for a non-negative-or-negative integer-valued double (a byte count). */
export function longHashCode(v: number): number {
  const b = BigInt.asUintN(64, BigInt(v));
  return Number(BigInt.asIntN(32, b ^ (b >> 32n)));
}

/**
 * <p>A FlushInfo provides information required for a FLUSH context.
 *  It is used as part of an {@link IOContext} in case of FLUSH context.</p>
 */
export class FlushInfo {
  readonly numDocs: number;
  /** A byte count: a `number`, like every length in the store package. */
  readonly estimatedSegmentSize: number;

  /**
   * <p>Creates a new {@link FlushInfo} instance from
   * the values required for a FLUSH {@link IOContext} context.
   *
   * These values are only estimates and are not the actual values.
   */
  constructor(numDocs: number, estimatedSegmentSize: number) {
    this.numDocs = numDocs;
    this.estimatedSegmentSize = estimatedSegmentSize;
  }

  hashCode(): number {
    const prime = 31;
    let result = 1;
    result = (Math.imul(prime, result) + longHashCode(this.estimatedSegmentSize)) | 0;
    result = (Math.imul(prime, result) + this.numDocs) | 0;
    return result;
  }

  equals(obj: unknown): boolean {
    if (this === obj) return true;
    if (obj === null || obj === undefined) return false;
    if (Object.getPrototypeOf(obj) !== Object.getPrototypeOf(this)) return false;
    const other = obj as FlushInfo;
    if (this.estimatedSegmentSize !== other.estimatedSegmentSize) return false;
    if (this.numDocs !== other.numDocs) return false;
    return true;
  }

  toString(): string {
    return "FlushInfo [numDocs=" + this.numDocs + ", estimatedSegmentSize=" + this.estimatedSegmentSize + "]";
  }
}
