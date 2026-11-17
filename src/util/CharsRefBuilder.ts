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

// Port of org.apache.lucene.util.CharsRefBuilder (Lucene 5.2.1).
//
// Java's Appendable overloads are told apart by argument type:
//   append(csq) / append(csq, start, end)  -> string | CharsRef (end index, returns this)
//   append(c)                               -> a number: one UTF-16 code unit (returns this)
//   append(chars, offset, length)           -> Uint16Array (returns void)

import { UnsupportedOperationException } from "../errors.js";
import { lassert } from "./assertions.js";
import { ArrayUtil } from "./ArrayUtil.js";
import type { BytesRef } from "./BytesRef.js";
import type { CharSequence } from "./CharsRef.js";
import { CharsRef, charSequenceCharAt, charSequenceLength } from "./CharsRef.js";
import { UnicodeUtil } from "./UnicodeUtil.js";

const NULL_STRING = "null";

/**
 * A builder for {@link CharsRef} instances.
 * @lucene.internal
 */
export class CharsRefBuilder {
  private readonly ref: CharsRef;

  /** Sole constructor. */
  constructor() {
    this.ref = new CharsRef();
  }

  /** Return a reference to the chars of this builder. */
  chars(): Uint16Array {
    return this.ref.chars;
  }

  /** Return the number of chars in this buffer. */
  length(): number {
    return this.ref.length;
  }

  /** Set the length. */
  setLength(length: number): void {
    this.ref.length = length;
  }

  /** Return the char at the given offset (a UTF-16 code unit). */
  charAt(offset: number): number {
    return this.ref.chars[offset]!;
  }

  /** Set a char. */
  setCharAt(offset: number, b: number): void {
    this.ref.chars[offset] = b;
  }

  /** Reset this builder to the empty state. */
  clear(): void {
    this.ref.length = 0;
  }

  append(csq: CharSequence | null | undefined): this;
  append(csq: CharSequence | null | undefined, start: number, end: number): this;
  append(c: number): this;
  append(chars: Uint16Array, offset: number, length: number): void;
  append(arg: CharSequence | Uint16Array | number | null | undefined, a?: number, b?: number): this | void {
    if (arg instanceof Uint16Array) {
      const otherOffset = a!;
      const otherLength = b!;
      const newLen = this.ref.length + otherLength;
      this.grow(newLen);
      this.ref.chars.set(arg.subarray(otherOffset, otherOffset + otherLength), this.ref.length);
      this.ref.length = newLen;
      return;
    }
    if (typeof arg === "number") {
      this.grow(this.ref.length + 1);
      this.setCharAt(this.ref.length++, arg);
      return this;
    }
    if (arg === null || arg === undefined) {
      return this.append(NULL_STRING);
    }
    const start = a === undefined ? 0 : a;
    const end = a === undefined ? charSequenceLength(arg) : b!;
    this.grow(this.ref.length + end - start);
    for (let i = start; i < end; ++i) {
      this.setCharAt(this.ref.length++, charSequenceCharAt(arg, i));
    }
    return this;
  }

  /** Copy the provided bytes, interpreted as UTF-8 bytes. */
  copyUTF8Bytes(bytes: Uint8Array, offset: number, length: number): void;
  copyUTF8Bytes(bytes: BytesRef): void;
  copyUTF8Bytes(arg: Uint8Array | BytesRef, offset?: number, length?: number): void {
    if (arg instanceof Uint8Array) {
      this.grow(length!);
      this.ref.length = UnicodeUtil.UTF8toUTF16(arg, offset!, length!, this.ref.chars);
    } else {
      this.copyUTF8Bytes(arg.bytes, arg.offset, arg.length);
    }
  }

  /** Copy the content of the given CharsRef (or char slice) into this builder. */
  copyChars(other: CharsRef): void;
  copyChars(otherChars: Uint16Array, otherOffset: number, otherLength: number): void;
  copyChars(arg: CharsRef | Uint16Array, otherOffset?: number, otherLength?: number): void {
    if (arg instanceof CharsRef) {
      this.copyChars(arg.chars, arg.offset, arg.length);
    } else {
      this.grow(otherLength!);
      this.ref.chars.set(arg.subarray(otherOffset!, otherOffset! + otherLength!), 0);
      this.ref.length = otherLength!;
    }
  }

  /**
   * Ensure that this builder can hold at least `newLength` chars without resizing.
   */
  grow(newLength: number): void {
    this.ref.chars = ArrayUtil.grow(this.ref.chars, newLength);
  }

  /**
   * Return a {@link CharsRef} that points to the internal content of this builder.
   * Any update to the content of this builder might invalidate the provided
   * `ref` and vice-versa.
   */
  get(): CharsRef {
    lassert(() => this.ref.offset === 0, "Modifying the offset of the returned ref is illegal");
    return this.ref;
  }

  /** Build a new {@link CharsRef} that has the same content as this builder. */
  toCharsRef(): CharsRef {
    const copy = new Uint16Array(this.ref.length);
    copy.set(this.ref.chars.subarray(0, Math.min(this.ref.length, this.ref.chars.length)));
    return new CharsRef(copy, 0, this.ref.length);
  }

  toString(): string {
    return this.get().toString();
  }

  equals(_obj: unknown): boolean {
    throw new UnsupportedOperationException();
  }

  hashCode(): number {
    throw new UnsupportedOperationException();
  }
}
