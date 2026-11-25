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

// Port of org.apache.lucene.util.fst.BytesRefFSTEnum (Lucene 5.2.1).

import { lassert } from "../assertions.js";
import { ArrayUtil } from "../ArrayUtil.js";
import { BytesRef } from "../BytesRef.js";
import { FST } from "./FST.js";
import { FSTEnum } from "./FSTEnum.js";

/** Holds a single input (BytesRef) and output pair. */
export class BytesRefFSTEnumInputOutput<T> {
  input: BytesRef = null as unknown as BytesRef;
  output: T = null as unknown as T;
}

/**
 * Enumerates all input (BytesRef) + output pairs in an FST.
 *
 * @lucene.experimental
 */
export class BytesRefFSTEnum<T> extends FSTEnum<T> {
  static readonly InputOutput = BytesRefFSTEnumInputOutput;

  private readonly currentRef = new BytesRef(10);
  private readonly result = new BytesRefFSTEnumInputOutput<T>();
  private target!: BytesRef;

  /** doFloor controls the behavior of advance: if it's true doFloor is true, advance positions to the biggest term before target. */
  constructor(fst: FST<T>) {
    super(fst);
    this.result.input = this.currentRef;
    this.currentRef.offset = 1;
  }

  current(): BytesRefFSTEnumInputOutput<T> {
    return this.result;
  }

  next(): BytesRefFSTEnumInputOutput<T> | null {
    //System.out.println("  enum.next");
    this.doNext();
    return this.setResult();
  }

  /** Seeks to smallest term that's >= target. */
  seekCeil(target: BytesRef): BytesRefFSTEnumInputOutput<T> | null {
    this.target = target;
    this.targetLength = target.length;
    super.doSeekCeil();
    return this.setResult();
  }

  /** Seeks to biggest term that's <= target. */
  seekFloor(target: BytesRef): BytesRefFSTEnumInputOutput<T> | null {
    this.target = target;
    this.targetLength = target.length;
    super.doSeekFloor();
    return this.setResult();
  }

  /**
   * Seeks to exactly this term, returning null if the term doesn't exist. This is faster than using {@link seekFloor}
   * or {@link seekCeil} because it short-circuits as soon the match is not found.
   */
  seekExact(target: BytesRef): BytesRefFSTEnumInputOutput<T> | null {
    this.target = target;
    this.targetLength = target.length;
    if (super.doSeekExact()) {
      lassert(() => this.upto === 1 + target.length);
      return this.setResult();
    } else {
      return null;
    }
  }

  protected getTargetLabel(): number {
    if (this.upto - 1 === this.target.length) {
      return FST.END_LABEL;
    } else {
      return this.target.bytes[this.target.offset + this.upto - 1]! & 0xff;
    }
  }

  protected getCurrentLabel(): number {
    // current.offset fixed at 1
    return this.currentRef.bytes[this.upto]! & 0xff;
  }

  protected setCurrentLabel(label: number): void {
    this.currentRef.bytes[this.upto] = label;
  }

  protected grow(): void {
    this.currentRef.bytes = ArrayUtil.grow(this.currentRef.bytes, this.upto + 1);
  }

  private setResult(): BytesRefFSTEnumInputOutput<T> | null {
    if (this.upto === 0) {
      return null;
    } else {
      this.currentRef.length = this.upto - 1;
      this.result.output = this.output[this.upto]!;
      return this.result;
    }
  }
}
