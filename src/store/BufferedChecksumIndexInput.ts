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

// Port of org.apache.lucene.store.BufferedChecksumIndexInput (Lucene 5.2.1).

import { UnsupportedOperationException } from "../errors.js";
import type { Checksum } from "../zip/Checksum.js";
import { CRC32 } from "../zip/CRC32.js";
import { BufferedChecksum } from "./BufferedChecksum.js";
import { ChecksumIndexInput } from "./ChecksumIndexInput.js";
import type { IndexInput } from "./IndexInput.js";

/**
 * Simple implementation of {@link ChecksumIndexInput} that wraps
 * another input and delegates calls.
 */
export class BufferedChecksumIndexInput extends ChecksumIndexInput {
  /** @internal package-private in Java */
  readonly main: IndexInput;
  /** @internal package-private in Java */
  readonly digest: Checksum;

  /** Creates a new BufferedChecksumIndexInput */
  constructor(main: IndexInput) {
    super("BufferedChecksumIndexInput(" + main + ")");
    this.main = main;
    this.digest = new BufferedChecksum(new CRC32());
  }

  readByte(): number {
    const b = this.main.readByte();
    this.digest.update(b);
    return b;
  }

  readBytes(b: Uint8Array, offset: number, len: number): void {
    this.main.readBytes(b, offset, len);
    this.digest.update(b, offset, len);
  }

  getChecksum(): bigint {
    return this.digest.getValue();
  }

  close(): void {
    this.main.close();
  }

  getFilePointer(): number {
    return this.main.getFilePointer();
  }

  length(): number {
    return this.main.length();
  }

  override clone(): this {
    throw new UnsupportedOperationException();
  }

  slice(_sliceDescription: string | null, _offset: number, _length: number): IndexInput {
    throw new UnsupportedOperationException();
  }
}
