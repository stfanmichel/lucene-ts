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

// Port of org.apache.lucene.util.IntsRefBuilder (Lucene 5.2.1).

import { UnsupportedOperationException } from "../errors.js";
import { lassert } from "./assertions.js";
import { ArrayUtil } from "./ArrayUtil.js";
import type { BytesRef } from "./BytesRef.js";
import { IntsRef } from "./IntsRef.js";
import { UnicodeUtil } from "./UnicodeUtil.js";

/**
 * A builder for {@link IntsRef} instances.
 * @lucene.internal
 */
export class IntsRefBuilder {
  private readonly ref: IntsRef;

  /** Sole constructor. */
  constructor() {
    this.ref = new IntsRef();
  }

  /** Return a reference to the ints of this builder. */
  ints(): Int32Array {
    return this.ref.ints;
  }

  /** Return the number of ints in this builder. */
  length(): number {
    return this.ref.length;
  }

  /** Set the length. */
  setLength(length: number): void {
    this.ref.length = length;
  }

  /** Empty this builder. */
  clear(): void {
    this.setLength(0);
  }

  /** Return the int at the given offset. */
  intAt(offset: number): number {
    return this.ref.ints[offset]!;
  }

  /** Set an int. */
  setIntAt(offset: number, b: number): void {
    this.ref.ints[offset] = b;
  }

  /** Append the provided int to this buffer. */
  append(i: number): void {
    this.grow(this.ref.length + 1);
    this.ref.ints[this.ref.length++] = i;
  }

  /**
   * Used to grow the reference array.
   *
   * In general this should not be used as it does not take the offset into account.
   * @lucene.internal
   */
  grow(newLength: number): void {
    this.ref.ints = ArrayUtil.grow(this.ref.ints, newLength);
  }

  /** Copies the given array into this instance (or the given IntsRef). */
  copyInts(otherInts: Int32Array, otherOffset: number, otherLength: number): void;
  copyInts(ints: IntsRef): void;
  copyInts(arg: Int32Array | IntsRef, otherOffset?: number, otherLength?: number): void {
    if (arg instanceof IntsRef) {
      this.copyInts(arg.ints, arg.offset, arg.length);
    } else {
      this.grow(otherLength!);
      this.ref.ints.set(arg.subarray(otherOffset!, otherOffset! + otherLength!), 0);
      this.ref.length = otherLength!;
    }
  }

  /**
   * Copy the given UTF-8 bytes into this builder, as Unicode code points.
   * Each int of the builder is a code point.
   */
  copyUTF8Bytes(bytes: BytesRef): void {
    this.grow(bytes.length);
    this.ref.length = UnicodeUtil.UTF8toUTF32(bytes, this.ref.ints);
  }

  /**
   * Return a {@link IntsRef} that points to the internal content of this builder.
   * Any update to the content of this builder might invalidate the provided
   * `ref` and vice-versa.
   */
  get(): IntsRef {
    lassert(() => this.ref.offset === 0, "Modifying the offset of the returned ref is illegal");
    return this.ref;
  }

  /** Build a new {@link IntsRef} that has the same content as this builder. */
  toIntsRef(): IntsRef {
    return IntsRef.deepCopyOf(this.get());
  }

  equals(_obj: unknown): boolean {
    throw new UnsupportedOperationException();
  }

  hashCode(): number {
    throw new UnsupportedOperationException();
  }
}
