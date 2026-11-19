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

import { addSuppressed, IndexOutOfBoundsException } from "../errors.js";
import type { OutputStream } from "./OutputStream.js";

/**
 * java.io.FilterOutputStream (JDK 21 semantics): wraps another output stream. close() flushes, then closes the
 * underlying stream exactly once, even when flush() fails.
 */
export class FilterOutputStream implements OutputStream {
  protected out: OutputStream;
  private closed = false;

  constructor(out: OutputStream) {
    this.out = out;
  }

  write(b: number): void;
  write(b: Uint8Array, off: number, len: number): void;
  write(b: number | Uint8Array, off?: number, len?: number): void {
    if (typeof b === "number") {
      this.out.write(b);
      return;
    }
    // The default FilterOutputStream implementation writes byte by byte.
    // Objects.checkFromIndexSize(off, len, b.length), as in JDK 21
    if ((off! | len!) < 0 || len! > b.length - off!) {
      throw new IndexOutOfBoundsException("Range [" + off + ", " + off + " + " + len + ") out of bounds for length " + b.length);
    }
    for (let i = 0; i < len!; i++) {
      this.write(b[off! + i]!);
    }
  }

  flush(): void {
    this.out.flush();
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    let flushException: unknown = null;
    try {
      this.flush();
    } catch (e) {
      flushException = e;
      throw e;
    } finally {
      if (flushException === null) {
        this.out.close();
      } else {
        try {
          this.out.close();
        } catch (closeException) {
          if (flushException !== closeException) {
            addSuppressed(closeException, flushException);
          }
          throw closeException;
        }
      }
    }
  }
}
