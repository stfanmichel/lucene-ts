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

// Port of org.apache.lucene.store.ByteArrayDataOutput (Lucene 5.2.1).

import { ArrayIndexOutOfBoundsException } from "../errors.js";
import { lassert } from "../util/assertions.js";
import { BytesRef } from "../util/BytesRef.js";
import { DataOutput } from "./DataOutput.js";

/**
 * DataOutput backed by a byte array.
 * <b>WARNING:</b> This class omits most low-level checks,
 * so be sure to test heavily with assertions enabled.
 * @lucene.experimental
 */
export class ByteArrayDataOutput extends DataOutput {
  private bytes: Uint8Array = BytesRef.EMPTY_BYTES;
  private pos = 0;
  private limit = 0;

  constructor(bytes?: Uint8Array, offset?: number, len?: number) {
    super();
    if (bytes === undefined) {
      this.reset(BytesRef.EMPTY_BYTES);
    } else if (offset === undefined) {
      this.reset(bytes);
    } else {
      this.reset(bytes, offset, len!);
    }
  }

  reset(bytes: Uint8Array, offset?: number, len?: number): void {
    if (offset === undefined) {
      offset = 0;
      len = bytes.length;
    }
    this.bytes = bytes;
    this.pos = offset;
    this.limit = offset + len!;
  }

  getPosition(): number {
    return this.pos;
  }

  writeByte(b: number): void {
    lassert(() => this.pos < this.limit);
    const p = this.pos++;
    if (p < 0 || p >= this.bytes.length) {
      throw new ArrayIndexOutOfBoundsException("Index " + p + " out of bounds for length " + this.bytes.length);
    }
    this.bytes[p] = b; // stores the low 8 bits, like Java's (byte) cast
  }

  writeBytes(b: Uint8Array, offset: number, length: number): void {
    lassert(() => this.pos + length <= this.limit);
    // System.arraycopy
    if (
      length < 0 || offset < 0 || this.pos < 0 ||
      offset + length > b.length || this.pos + length > this.bytes.length
    ) {
      throw new ArrayIndexOutOfBoundsException("arraycopy: last destination index " + (this.pos + length) +
        " out of bounds for byte[" + this.bytes.length + "]");
    }
    this.bytes.set(b.subarray(offset, offset + length), this.pos);
    this.pos += length;
  }
}
