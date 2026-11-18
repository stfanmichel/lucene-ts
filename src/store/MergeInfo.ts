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

// Port of org.apache.lucene.store.MergeInfo (Lucene 5.2.1).

import { longHashCode } from "./FlushInfo.js";

/**
 * <p>A MergeInfo provides information required for a MERGE context.
 *  It is used as part of an {@link IOContext} in case of MERGE context.</p>
 */
export class MergeInfo {
  readonly totalMaxDoc: number;
  /** A byte count: a `number`, like every length in the store package. */
  readonly estimatedMergeBytes: number;
  readonly isExternal: boolean;
  readonly mergeMaxNumSegments: number;

  /**
   * <p>Creates a new {@link MergeInfo} instance from
   * the values required for a MERGE {@link IOContext} context.
   *
   * These values are only estimates and are not the actual values.
   */
  constructor(totalMaxDoc: number, estimatedMergeBytes: number, isExternal: boolean, mergeMaxNumSegments: number) {
    this.totalMaxDoc = totalMaxDoc;
    this.estimatedMergeBytes = estimatedMergeBytes;
    this.isExternal = isExternal;
    this.mergeMaxNumSegments = mergeMaxNumSegments;
  }

  hashCode(): number {
    const prime = 31;
    let result = 1;
    result = (Math.imul(prime, result) + longHashCode(this.estimatedMergeBytes)) | 0;
    result = (Math.imul(prime, result) + (this.isExternal ? 1231 : 1237)) | 0;
    result = (Math.imul(prime, result) + this.mergeMaxNumSegments) | 0;
    result = (Math.imul(prime, result) + this.totalMaxDoc) | 0;
    return result;
  }

  equals(obj: unknown): boolean {
    if (this === obj) return true;
    if (obj === null || obj === undefined) return false;
    if (Object.getPrototypeOf(obj) !== Object.getPrototypeOf(this)) return false;
    const other = obj as MergeInfo;
    if (this.estimatedMergeBytes !== other.estimatedMergeBytes) return false;
    if (this.isExternal !== other.isExternal) return false;
    if (this.mergeMaxNumSegments !== other.mergeMaxNumSegments) return false;
    if (this.totalMaxDoc !== other.totalMaxDoc) return false;
    return true;
  }

  toString(): string {
    return (
      "MergeInfo [totalMaxDoc=" + this.totalMaxDoc + ", estimatedMergeBytes=" + this.estimatedMergeBytes +
      ", isExternal=" + this.isExternal + ", mergeMaxNumSegments=" + this.mergeMaxNumSegments + "]"
    );
  }
}
