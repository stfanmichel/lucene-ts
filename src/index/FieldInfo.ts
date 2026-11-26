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

// Port of org.apache.lucene.index.FieldInfo (Lucene 5.2.1).
//
// Deviations: the package-private mutators (update, setDocValuesType, setDocValuesGen, setStoreTermVectors,
// setStorePayloads) are public with @internal; dvGen is a number (a generation counter); attributes is a JS Map
// (insertion ordered, whereas Java's HashMap order is unspecified).

import { IllegalArgumentException, IllegalStateException, NullPointerException } from "../errors.js";
import { lassert } from "../util/assertions.js";
import { DocValuesType } from "./DocValuesType.js";
import { IndexOptions } from "./IndexOptions.js";

/**
 * Access to the Field Info file that describes document fields and whether or not they are indexed. Each segment has
 * a separate Field Info file. Objects of this class are thread-safe for multiple readers, but only one thread can be
 * adding documents at a time, with no other reader or writer threads accessing this object.
 **/
export class FieldInfo {
  /** Field's name */
  readonly name: string;
  /** Internal field number */
  readonly number: number;

  private docValuesType: DocValuesType = DocValuesType.NONE;

  // True if any document indexed term vectors
  private storeTermVector = false;

  private omitNorms = false; // omit norms associated with indexed fields

  private indexOptions: IndexOptions = IndexOptions.NONE;
  private storePayloads = false; // whether this field stores payloads together with term positions

  private readonly attributes_: Map<string, string>;

  private dvGen: number;

  /**
   * Sole constructor.
   *
   * @lucene.experimental
   */
  constructor(
    name: string,
    number: number,
    storeTermVector: boolean,
    omitNorms: boolean,
    storePayloads: boolean,
    indexOptions: IndexOptions,
    docValues: DocValuesType,
    dvGen: number,
    attributes: Map<string, string>,
  ) {
    if (name === null || name === undefined) {
      throw new NullPointerException();
    }
    this.name = name;
    this.number = number;
    if (docValues === null || docValues === undefined) {
      throw new NullPointerException('DocValuesType cannot be null (field: "' + name + '")');
    }
    this.docValuesType = docValues;
    if (indexOptions === null || indexOptions === undefined) {
      throw new NullPointerException('IndexOptions cannot be null (field: "' + name + '")');
    }
    this.indexOptions = indexOptions;
    if (indexOptions !== IndexOptions.NONE) {
      this.storeTermVector = storeTermVector;
      this.storePayloads = storePayloads;
      this.omitNorms = omitNorms;
    } else {
      // for non-indexed fields, leave defaults
      this.storeTermVector = false;
      this.storePayloads = false;
      this.omitNorms = false;
    }
    this.dvGen = dvGen;
    if (attributes === null || attributes === undefined) {
      throw new NullPointerException();
    }
    this.attributes_ = attributes;
    lassert(() => this.checkConsistency());
  }

  /** Performs internal consistency checks. Always returns true (or throws IllegalStateException) */
  checkConsistency(): boolean {
    if (this.indexOptions !== IndexOptions.NONE) {
      // Cannot store payloads unless positions are indexed:
      if (this.indexOptions < IndexOptions.DOCS_AND_FREQS_AND_POSITIONS && this.storePayloads) {
        throw new IllegalStateException("indexed field '" + this.name + "' cannot have payloads without positions");
      }
    } else {
      if (this.storeTermVector) {
        throw new IllegalStateException("non-indexed field '" + this.name + "' cannot store term vectors");
      }
      if (this.storePayloads) {
        throw new IllegalStateException("non-indexed field '" + this.name + "' cannot store payloads");
      }
      if (this.omitNorms) {
        throw new IllegalStateException("non-indexed field '" + this.name + "' cannot omit norms");
      }
    }

    if (this.dvGen !== -1 && this.docValuesType === DocValuesType.NONE) {
      throw new IllegalStateException("field '" + this.name + "' cannot have a docvalues update generation without having docvalues");
    }

    return true;
  }

  /** @internal */
  update(storeTermVector: boolean, omitNorms: boolean, storePayloads: boolean, indexOptions: IndexOptions): void {
    if (indexOptions === null || indexOptions === undefined) {
      throw new NullPointerException('IndexOptions cannot be null (field: "' + this.name + '")');
    }
    //System.out.println("FI.update field=" + name + " indexed=" + indexed + " omitNorms=" + omitNorms + " this.omitNorms=" + this.omitNorms);
    if (this.indexOptions !== indexOptions) {
      if (this.indexOptions === IndexOptions.NONE) {
        this.indexOptions = indexOptions;
      } else if (indexOptions !== IndexOptions.NONE) {
        // downgrade
        this.indexOptions = this.indexOptions < indexOptions ? this.indexOptions : indexOptions;
      }
    }

    if (this.indexOptions !== IndexOptions.NONE) {
      // if updated field data is not for indexing, leave the updates out
      this.storeTermVector = this.storeTermVector || storeTermVector; // once vector, always vector
      this.storePayloads = this.storePayloads || storePayloads;

      // Awkward: only drop norms if incoming update is indexed:
      if (indexOptions !== IndexOptions.NONE && this.omitNorms !== omitNorms) {
        this.omitNorms = true; // if one require omitNorms at least once, it remains off for life
      }
    }
    if (this.indexOptions === IndexOptions.NONE || this.indexOptions < IndexOptions.DOCS_AND_FREQS_AND_POSITIONS) {
      // cannot store payloads if we don't store positions:
      this.storePayloads = false;
    }
    lassert(() => this.checkConsistency());
  }

  /** @internal */
  setDocValuesType(type: DocValuesType): void {
    if (type === null || type === undefined) {
      throw new NullPointerException('DocValuesType cannot be null (field: "' + this.name + '")');
    }
    if (this.docValuesType !== DocValuesType.NONE && type !== DocValuesType.NONE && this.docValuesType !== type) {
      throw new IllegalArgumentException(
        "cannot change DocValues type from " + DocValuesType[this.docValuesType] + " to " + DocValuesType[type] + ' for field "' + this.name + '"',
      );
    }
    this.docValuesType = type;
    lassert(() => this.checkConsistency());
  }

  /** Returns IndexOptions for the field, or IndexOptions.NONE if the field is not indexed */
  getIndexOptions(): IndexOptions {
    return this.indexOptions;
  }

  /** Record the {@link IndexOptions} to use with this field. */
  setIndexOptions(newIndexOptions: IndexOptions): void {
    if (this.indexOptions !== newIndexOptions) {
      if (this.indexOptions === IndexOptions.NONE) {
        this.indexOptions = newIndexOptions;
      } else if (newIndexOptions !== IndexOptions.NONE) {
        // downgrade
        this.indexOptions = this.indexOptions < newIndexOptions ? this.indexOptions : newIndexOptions;
      }
    }

    if (this.indexOptions === IndexOptions.NONE || this.indexOptions < IndexOptions.DOCS_AND_FREQS_AND_POSITIONS) {
      // cannot store payloads if we don't store positions:
      this.storePayloads = false;
    }
  }

  /** Returns {@link DocValuesType} of the docValues; this is DocValuesType.NONE if the field has no docvalues. */
  getDocValuesType(): DocValuesType {
    return this.docValuesType;
  }

  /** @internal */
  setDocValuesGen(dvGen: number): void {
    this.dvGen = dvGen;
    lassert(() => this.checkConsistency());
  }

  /** Returns the docValues generation of this field, or -1 if no docValues updates exist for it. */
  getDocValuesGen(): number {
    return this.dvGen;
  }

  /** @internal */
  setStoreTermVectors(): void {
    this.storeTermVector = true;
    lassert(() => this.checkConsistency());
  }

  /** @internal */
  setStorePayloads(): void {
    if (this.indexOptions !== IndexOptions.NONE && this.indexOptions >= IndexOptions.DOCS_AND_FREQS_AND_POSITIONS) {
      this.storePayloads = true;
    }
    lassert(() => this.checkConsistency());
  }

  /** Returns true if norms are explicitly omitted for this field */
  omitsNorms(): boolean {
    return this.omitNorms;
  }

  /** Omit norms for this field. */
  setOmitsNorms(): void {
    if (this.indexOptions === IndexOptions.NONE) {
      throw new IllegalStateException("cannot omit norms: this field is not indexed");
    }
    this.omitNorms = true;
  }

  /** Returns true if this field actually has any norms. */
  hasNorms(): boolean {
    return this.indexOptions !== IndexOptions.NONE && this.omitNorms === false;
  }

  /** Returns true if any payloads exist for this field. */
  hasPayloads(): boolean {
    return this.storePayloads;
  }

  /** Returns true if any term vectors exist for this field. */
  hasVectors(): boolean {
    return this.storeTermVector;
  }

  /** Get a codec attribute value, or null if it does not exist */
  getAttribute(key: string): string | null {
    return this.attributes_.get(key) ?? null;
  }

  /**
   * Puts a codec attribute value.
   *
   * This is a key-value mapping for the field that the codec can use to store additional metadata, and will be
   * available to the codec when reading the segment via {@link getAttribute(String)}
   *
   * If a value already exists for the field, it will be replaced with the new value.
   *
   * @return the previous value, or null
   */
  putAttribute(key: string, value: string): string | null {
    const old = this.attributes_.get(key) ?? null;
    this.attributes_.set(key, value);
    return old;
  }

  /**
   * Returns internal codec attributes map.
   *
   * @return internal codec attributes map.
   */
  attributes(): Map<string, string> {
    return this.attributes_;
  }
}
