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

import type { OutputStream } from "./OutputStream.js";

/** java.io.ByteArrayOutputStream */
export class ByteArrayOutputStream implements OutputStream {
  protected buf: Uint8Array;
  protected count = 0;

  constructor(size: number = 32) {
    this.buf = new Uint8Array(size);
  }

  private ensureCapacity(minCapacity: number): void {
    if (minCapacity > this.buf.length) {
      const grown = new Uint8Array(Math.max(this.buf.length * 2, minCapacity));
      grown.set(this.buf.subarray(0, this.count));
      this.buf = grown;
    }
  }

  write(b: number): void;
  write(b: Uint8Array, off: number, len: number): void;
  write(b: number | Uint8Array, off?: number, len?: number): void {
    if (typeof b === "number") {
      this.ensureCapacity(this.count + 1);
      this.buf[this.count++] = b;
    } else {
      this.ensureCapacity(this.count + len!);
      this.buf.set(b.subarray(off!, off! + len!), this.count);
      this.count += len!;
    }
  }

  size(): number {
    return this.count;
  }

  toByteArray(): Uint8Array {
    return this.buf.slice(0, this.count);
  }

  reset(): void {
    this.count = 0;
  }

  close(): void {
    // closing a ByteArrayOutputStream has no effect
  }
}
