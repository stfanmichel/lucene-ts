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

import { IllegalArgumentException } from "../errors.js";
import { arraycopy } from "../util/JavaObjects.js";
import { FilterOutputStream } from "./FilterOutputStream.js";
import type { OutputStream } from "./OutputStream.js";

/**
 * java.io.BufferedOutputStream (JDK 21 semantics, so the sequence of writes reaching the underlying stream is
 * the same as in Java): bytes are collected in a buffer; a write at least as long as the buffer bypasses it.
 */
export class BufferedOutputStream extends FilterOutputStream {
  protected buf: Uint8Array;
  protected count = 0;

  constructor(out: OutputStream, size = 8192) {
    super(out);
    if (size <= 0) {
      throw new IllegalArgumentException("Buffer size <= 0");
    }
    this.buf = new Uint8Array(size);
  }

  private flushBuffer(): void {
    if (this.count > 0) {
      this.out.write(this.buf, 0, this.count);
      this.count = 0;
    }
  }

  override write(b: number): void;
  override write(b: Uint8Array, off: number, len: number): void;
  override write(b: number | Uint8Array, off?: number, len?: number): void {
    if (typeof b === "number") {
      if (this.count >= this.buf.length) {
        this.flushBuffer();
      }
      this.buf[this.count++] = b;
      return;
    }
    if (len! >= this.buf.length) {
      /* If the request length exceeds the size of the output buffer,
         flush the output buffer and then write the data directly.
         In this way buffered streams will cascade harmlessly. */
      this.flushBuffer();
      this.out.write(b, off!, len!);
      return;
    }
    if (len! > this.buf.length - this.count) {
      this.flushBuffer();
    }
    arraycopy(b, off!, this.buf, this.count, len!);
    this.count += len!;
  }

  override flush(): void {
    this.flushBuffer();
    this.out.flush();
  }
}
