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

import type { InputStream } from "./InputStream.js";

/** java.io.ByteArrayInputStream */
export class ByteArrayInputStream implements InputStream {
  protected buf: Uint8Array;
  protected pos: number;
  protected count: number;

  constructor(buf: Uint8Array, offset: number = 0, length: number = buf.length - offset) {
    this.buf = buf;
    this.pos = offset;
    this.count = Math.min(offset + length, buf.length);
  }

  read(): number;
  read(b: Uint8Array, off: number, len: number): number;
  read(b?: Uint8Array, off?: number, len?: number): number {
    if (b === undefined) {
      return this.pos < this.count ? this.buf[this.pos++]! : -1;
    }
    if (this.pos >= this.count) {
      return -1;
    }
    const avail = this.count - this.pos;
    const n = Math.min(len!, avail);
    if (n <= 0) {
      return 0;
    }
    b.set(this.buf.subarray(this.pos, this.pos + n), off!);
    this.pos += n;
    return n;
  }

  close(): void {
    // closing a ByteArrayInputStream has no effect
  }
}
