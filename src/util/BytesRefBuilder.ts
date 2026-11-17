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

// Port of org.apache.lucene.util.BytesRefBuilder (Lucene 5.2.1).
//
// Note: Java's byte[] elements are signed; here they are unsigned (0..255), see PORTING.md.

import { UnsupportedOperationException } from "../errors.js";
import { lassert } from "./assertions.js";
import { ArrayUtil } from "./ArrayUtil.js";
import { BytesRef } from "./BytesRef.js";
import type { CharSequence } from "./CharsRef.js";
import { CharsRef } from "./CharsRef.js";
import { UnicodeUtil } from "./UnicodeUtil.js";

/**
 * A builder for {@link BytesRef} instances.
 * @lucene.internal
 */
export class BytesRefBuilder {
  private readonly ref: BytesRef;

  /** Sole constructor. */
  constructor() {
    this.ref = new BytesRef();
  }

  /** Return a reference to the bytes of this builder. */
  bytes(): Uint8Array {
    return this.ref.bytes;
  }

  /** Return the number of bytes in this buffer. */
  length(): number {
    return this.ref.length;
  }

  /** Set the length. */
  setLength(length: number): void {
    this.ref.length = length;
  }

  /** Return the byte at the given offset (0..255; Java would return a signed byte). */
  byteAt(offset: number): number {
    return this.ref.bytes[offset]!;
  }

  /** Set a byte. */
  setByteAt(offset: number, b: number): void {
    this.ref.bytes[offset] = b;
  }

  /**
   * Ensure that this builder can hold at least `capacity` bytes without resizing.
   */
  grow(capacity: number): void {
    this.ref.bytes = ArrayUtil.grow(this.ref.bytes, capacity);
  }

  /** Append a single byte to this builder. */
  append(b: number): void;
  /** Append the provided bytes to this builder. */
  append(b: Uint8Array, off: number, len: number): void;
  /** Append the provided bytes to this builder. */
  append(ref: BytesRef): void;
  /** Append the provided bytes to this builder. */
  append(builder: BytesRefBuilder): void;
  append(arg: number | Uint8Array | BytesRef | BytesRefBuilder, off?: number, len?: number): void {
    if (typeof arg === "number") {
      this.grow(this.ref.length + 1);
      this.ref.bytes[this.ref.length++] = arg;
    } else if (arg instanceof Uint8Array) {
      this.grow(this.ref.length + len!);
      this.ref.bytes.set(arg.subarray(off!, off! + len!), this.ref.length);
      this.ref.length += len!;
    } else if (arg instanceof BytesRef) {
      this.append(arg.bytes, arg.offset, arg.length);
    } else {
      this.append(arg.get());
    }
  }

  /** Reset this builder to the empty state. */
  clear(): void {
    this.setLength(0);
  }

  /** Replace the content of this builder with the provided bytes. Equivalent to calling {@link clear} and then append. */
  copyBytes(b: Uint8Array, off: number, len: number): void;
  copyBytes(ref: BytesRef): void;
  copyBytes(builder: BytesRefBuilder): void;
  copyBytes(arg: Uint8Array | BytesRef | BytesRefBuilder, off?: number, len?: number): void {
    this.clear();
    if (arg instanceof Uint8Array) {
      this.append(arg, off!, len!);
    } else if (arg instanceof BytesRef) {
      this.append(arg);
    } else {
      this.append(arg);
    }
  }

  /**
   * Replace the content of this buffer with UTF-8 encoded bytes that would
   * represent the provided text.
   */
  copyChars(text: CharSequence): void;
  copyChars(text: CharSequence, off: number, len: number): void;
  copyChars(text: Uint16Array, off: number, len: number): void;
  copyChars(text: CharSequence | Uint16Array, off?: number, len?: number): void {
    if (off === undefined) {
      this.copyChars(text as CharSequence, 0, text.length);
      return;
    }
    this.grow(len! * UnicodeUtil.MAX_UTF8_BYTES_PER_CHAR);
    if (text instanceof CharsRef) {
      this.ref.length = UnicodeUtil.UTF16toUTF8(text.chars, text.offset + off, len!, this.ref.bytes);
    } else {
      this.ref.length = UnicodeUtil.UTF16toUTF8(text, off, len!, this.ref.bytes);
    }
  }

  /**
   * Return a {@link BytesRef} that points to the internal content of this builder.
   * Any update to the content of this builder might invalidate the provided
   * `ref` and vice-versa.
   */
  get(): BytesRef {
    lassert(() => this.ref.offset === 0, "Modifying the offset of the returned ref is illegal");
    return this.ref;
  }

  /**
   * Build a new {@link BytesRef} that has the same content as this buffer.
   */
  toBytesRef(): BytesRef {
    // Arrays.copyOf(ref.bytes, ref.length): zero-padded when length > bytes.length
    const copy = new Uint8Array(this.ref.length);
    copy.set(this.ref.bytes.subarray(0, Math.min(this.ref.length, this.ref.bytes.length)));
    return new BytesRef(copy);
  }

  equals(_obj: unknown): boolean {
    throw new UnsupportedOperationException();
  }

  hashCode(): number {
    throw new UnsupportedOperationException();
  }
}
