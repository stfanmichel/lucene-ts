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

import { Float } from "./JavaNumbers.js";
import type { StringBuilder } from "./StringBuilder.js";

const HEX = "0123456789abcdef";

/** Port of org.apache.lucene.util.ToStringUtils: Helper methods to ease implementing {@link Object#toString()}. */
export const ToStringUtils = {
  /** for printing boost only if not 1.0 */
  boost(boost: number): string {
    if (Math.fround(boost) !== 1.0) {
      return "^" + Float.toString(boost);
    } else return "";
  },

  /** Appends "b[0]=x,b[1]=y,..." (the bytes are signed, as in Java). */
  byteArray(buffer: StringBuilder, bytes: Uint8Array): void {
    for (let i = 0; i < bytes.length; i++) {
      buffer.append("b[").append(i).append("]=").append((bytes[i]! << 24) >> 24);
      if (i < bytes.length - 1) {
        buffer.append(",");
      }
    }
  },

  /** Returns "0x" + the 16 lower-case hex digits of the long. */
  longHex(x: bigint): string {
    let u = BigInt.asUintN(64, x);
    const asHex: string[] = new Array(16);
    for (let i = 16; --i >= 0; u >>= 4n) {
      asHex[i] = HEX[Number(u & 0xfn)]!;
    }
    return "0x" + asHex.join("");
  },
} as const;
