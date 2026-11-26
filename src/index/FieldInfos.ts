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

// Port of org.apache.lucene.index.FieldInfos (Lucene 5.2.1) -- READ PATH ONLY.
//
// Not ported yet (index writing): FieldNumbers and Builder (used by IndexWriter to assign field numbers).
// Deviation: iteration order is by field number (Java: TreeMap values), implemented with a sorted array.

import { IllegalArgumentException } from "../errors.js";
import { lassert } from "../util/assertions.js";
import { DocValuesType } from "./DocValuesType.js";
import type { FieldInfo } from "./FieldInfo.js";
import { IndexOptions } from "./IndexOptions.js";

/**
 * Collection of {@link FieldInfo}s (accessible by number or by name).
 *  @lucene.experimental
 */
export class FieldInfos implements Iterable<FieldInfo> {
  private readonly hasFreq_: boolean;
  private readonly hasProx_: boolean;
  private readonly hasPayloads_: boolean;
  private readonly hasOffsets_: boolean;
  private readonly hasVectors_: boolean;
  private readonly hasNorms_: boolean;
  private readonly hasDocValues_: boolean;

  private readonly byNumber = new Map<number, FieldInfo>();
  private readonly byName = new Map<string, FieldInfo>();
  private readonly values: readonly FieldInfo[]; // for an unmodifiable iterator, sorted by field number

  /** Constructs a new FieldInfos from an array of FieldInfo objects */
  constructor(infos: FieldInfo[]) {
    let hasVectors = false;
    let hasProx = false;
    let hasPayloads = false;
    let hasOffsets = false;
    let hasFreq = false;
    let hasNorms = false;
    let hasDocValues = false;

    for (const info of infos) {
      if (info.number < 0) {
        throw new IllegalArgumentException("illegal field number: " + info.number + " for field " + info.name);
      }
      let previous = this.byNumber.get(info.number);
      this.byNumber.set(info.number, info);
      if (previous !== undefined) {
        throw new IllegalArgumentException("duplicate field numbers: " + previous.name + " and " + info.name + " have: " + info.number);
      }
      previous = this.byName.get(info.name);
      this.byName.set(info.name, info);
      if (previous !== undefined) {
        throw new IllegalArgumentException("duplicate field names: " + previous.number + " and " + info.number + " have: " + info.name);
      }

      hasVectors = hasVectors || info.hasVectors();
      hasProx = hasProx || info.getIndexOptions() >= IndexOptions.DOCS_AND_FREQS_AND_POSITIONS;
      hasFreq = hasFreq || info.getIndexOptions() !== IndexOptions.DOCS;
      hasOffsets = hasOffsets || info.getIndexOptions() >= IndexOptions.DOCS_AND_FREQS_AND_POSITIONS_AND_OFFSETS;
      hasNorms = hasNorms || info.hasNorms();
      hasDocValues = hasDocValues || info.getDocValuesType() !== DocValuesType.NONE;
      hasPayloads = hasPayloads || info.hasPayloads();
    }

    this.hasVectors_ = hasVectors;
    this.hasProx_ = hasProx;
    this.hasPayloads_ = hasPayloads;
    this.hasOffsets_ = hasOffsets;
    this.hasFreq_ = hasFreq;
    this.hasNorms_ = hasNorms;
    this.hasDocValues_ = hasDocValues;
    this.values = [...this.byNumber.values()].sort((a, b) => a.number - b.number);
  }

  /** Returns true if any fields have freqs */
  hasFreq(): boolean {
    return this.hasFreq_;
  }

  /** Returns true if any fields have positions */
  hasProx(): boolean {
    return this.hasProx_;
  }

  /** Returns true if any fields have payloads */
  hasPayloads(): boolean {
    return this.hasPayloads_;
  }

  /** Returns true if any fields have offsets */
  hasOffsets(): boolean {
    return this.hasOffsets_;
  }

  /** Returns true if any fields have vectors */
  hasVectors(): boolean {
    return this.hasVectors_;
  }

  /** Returns true if any fields have norms */
  hasNorms(): boolean {
    return this.hasNorms_;
  }

  /** Returns true if any fields have DocValues */
  hasDocValues(): boolean {
    return this.hasDocValues_;
  }

  /** Returns the number of fields */
  size(): number {
    lassert(() => this.byNumber.size === this.byName.size);
    return this.byNumber.size;
  }

  /** Returns an iterator over all the fieldinfo objects present, ordered by ascending field number */
  [Symbol.iterator](): Iterator<FieldInfo> {
    return this.values[Symbol.iterator]();
  }

  /**
   * Return the fieldinfo object referenced by the field name (Java: fieldInfo(String)); or the one referenced by the
   * field number (Java: fieldInfo(int)).
   * @return the FieldInfo object or null when the given fieldName doesn't exist.
   */
  fieldInfo(field: string | number): FieldInfo | null {
    if (typeof field === "string") {
      return this.byName.get(field) ?? null;
    }
    if (field < 0) {
      throw new IllegalArgumentException("Illegal field number: " + field);
    }
    return this.byNumber.get(field) ?? null;
  }
}
