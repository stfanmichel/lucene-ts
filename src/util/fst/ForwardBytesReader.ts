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

// Port of org.apache.lucene.util.fst.ForwardBytesReader (Lucene 5.2.1).

import { FSTBytesReader } from "./FSTBytesReader.js";

/**
 * Reads from a single byte[].
 * @internal
 */
export class ForwardBytesReader extends FSTBytesReader {
  private readonly bytes: Uint8Array;
  private pos = 0;

  constructor(bytes: Uint8Array) {
    super();
    this.bytes = bytes;
  }

  readByte(): number {
    return this.bytes[this.pos++]!;
  }

  readBytes(b: Uint8Array, offset: number, len: number): void {
    b.set(this.bytes.subarray(this.pos, this.pos + len), offset);
    this.pos += len;
  }

  override skipBytes(count: number): void {
    this.pos += count;
  }

  getPosition(): number {
    return this.pos;
  }

  setPosition(pos: number): void {
    this.pos = pos;
  }

  reversed(): boolean {
    return false;
  }
}
