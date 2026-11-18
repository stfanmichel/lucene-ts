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

// Port of org.apache.lucene.store.InputStreamDataInput (Lucene 5.2.1).

import { EOFException } from "../errors.js";
import type { Closeable } from "../io/Closeable.js";
import type { InputStream } from "../io/InputStream.js";
import { DataInput } from "./DataInput.js";

/**
 * A {@link DataInput} wrapping a plain {@link InputStream}.
 */
export class InputStreamDataInput extends DataInput implements Closeable {
  private readonly is: InputStream;

  constructor(is: InputStream) {
    super();
    this.is = is;
  }

  readByte(): number {
    const v = this.is.read();
    if (v === -1) throw new EOFException();
    return v & 0xff;
  }

  readBytes(b: Uint8Array, offset: number, len: number): void {
    while (len > 0) {
      const cnt = this.is.read(b, offset, len);
      if (cnt < 0) {
        // Partially read the input, but no more data available in the stream.
        throw new EOFException();
      }
      len -= cnt;
      offset += cnt;
    }
  }

  close(): void {
    this.is.close();
  }
}
