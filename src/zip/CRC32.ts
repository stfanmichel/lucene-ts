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

import { ArrayIndexOutOfBoundsException } from "../errors.js";
import type { Checksum } from "./Checksum.js";

const TABLE: Int32Array = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

/** java.util.zip.CRC32: CRC-32 (IEEE 802.3, as in zlib), a pure TypeScript table implementation. */
export class CRC32 implements Checksum {
  private crc = 0; // unsigned 32 bits, same representation as Java's `crc` field

  update(b: number): void;
  update(b: Uint8Array, off: number, len: number): void;
  update(b: number | Uint8Array, off?: number, len?: number): void {
    let c = ~this.crc;
    if (typeof b === "number") {
      c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    } else {
      if (off! < 0 || len! < 0 || off! > b.length - len!) {
        throw new ArrayIndexOutOfBoundsException();
      }
      for (let i = off!, end = off! + len!; i < end; i++) {
        c = TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
      }
    }
    this.crc = ~c >>> 0;
  }

  getValue(): bigint {
    return BigInt(this.crc);
  }

  reset(): void {
    this.crc = 0;
  }
}
