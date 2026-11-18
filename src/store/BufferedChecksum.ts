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

// Port of org.apache.lucene.store.BufferedChecksum (Lucene 5.2.1).

import type { Checksum } from "../zip/Checksum.js";

/**
 * Wraps another {@link Checksum} with an internal buffer
 * to speed up checksum calculations.
 */
export class BufferedChecksum implements Checksum {
  private readonly in: Checksum;
  private readonly buffer: Uint8Array;
  private upto = 0;

  /** Default buffer size: 256 */
  static readonly DEFAULT_BUFFERSIZE = 256;

  /** Create a new BufferedChecksum with {@link BufferedChecksum.DEFAULT_BUFFERSIZE} or the specified bufferSize */
  constructor(inner: Checksum, bufferSize: number = BufferedChecksum.DEFAULT_BUFFERSIZE) {
    this.in = inner;
    this.buffer = new Uint8Array(bufferSize);
  }

  update(b: number): void;
  update(b: Uint8Array, off: number, len: number): void;
  update(b: number | Uint8Array, off?: number, len?: number): void {
    if (typeof b === "number") {
      if (this.upto === this.buffer.length) {
        this.flush();
      }
      this.buffer[this.upto++] = b; // (byte) b
    } else if (len! >= this.buffer.length) {
      this.flush();
      this.in.update(b, off!, len!);
    } else {
      if (this.upto + len! > this.buffer.length) {
        this.flush();
      }
      this.buffer.set(b.subarray(off!, off! + len!), this.upto); // System.arraycopy
      this.upto += len!;
    }
  }

  getValue(): bigint {
    this.flush();
    return this.in.getValue();
  }

  reset(): void {
    this.upto = 0;
    this.in.reset();
  }

  private flush(): void {
    if (this.upto > 0) {
      this.in.update(this.buffer, 0, this.upto);
    }
    this.upto = 0;
  }
}
