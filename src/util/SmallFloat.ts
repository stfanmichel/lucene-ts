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

/**
 * Port of org.apache.lucene.util.SmallFloat: Floating point numbers smaller than 32 bits.
 * A Java `byte` result is returned here as an unsigned value 0..255 (the byte[] convention of the port);
 * `byte` parameters accept signed or unsigned values.
 */
export const SmallFloat = {
  /**
   * Converts a 32 bit float to an 8 bit float. Values less than zero are all mapped to zero. Values are truncated
   * (rounded down) to the nearest 8 bit value. Values between zero and the smallest representable value are rounded
   * up. Values above the largest representable value are mapped to 255.
   */
  floatToByte(f: number, numMantissaBits: number, zeroExp: number): number {
    // Adjustment from a float zero exponent to our zero exponent, shifted over to our exponent position.
    const fzero = (63 - zeroExp) << numMantissaBits;
    const bits = Float.floatToRawIntBits(f);
    const smallfloat = bits >> (24 - numMantissaBits);
    if (smallfloat <= fzero) {
      return bits <= 0
        ? 0 // negative numbers and zero both map to 0 byte
        : 1; // underflow is mapped to smallest non-zero number.
    } else if (smallfloat >= fzero + 0x100) {
      return 255; // overflow maps to largest number
    } else {
      return (smallfloat - fzero) & 0xff;
    }
  },

  /** Converts an 8 bit float to a 32 bit float. */
  byteToFloat(b: number, numMantissaBits: number, zeroExp: number): number {
    // on Java1.5 & 1.6 JVMs, prebuilding a decoding array and doing a lookup is only a little faster
    // (anywhere from 0% to 7%)
    if ((b & 0xff) === 0) return 0.0;
    let bits = (b & 0xff) << (24 - numMantissaBits);
    bits += (63 - zeroExp) << 24;
    return Float.intBitsToFloat(bits);
  },

  /** floatToByte(b, mantissaBits=3, zeroExponent=15): smallest non-zero value = 5.820766E-10, largest value = 7.5161928E9, epsilon = 0.125 */
  floatToByte315(f: number): number {
    const bits = Float.floatToRawIntBits(f);
    const smallfloat = bits >> (24 - 3);
    if (smallfloat <= (63 - 15) << 3) {
      return bits <= 0 ? 0 : 1;
    }
    if (smallfloat >= ((63 - 15) << 3) + 0x100) {
      return 255;
    }
    return (smallfloat - ((63 - 15) << 3)) & 0xff;
  },

  /** byteToFloat(b, mantissaBits=3, zeroExponent=15) */
  byte315ToFloat(b: number): number {
    // on Java1.5 & 1.6 JVMs, prebuilding a decoding array and doing a lookup is only a little faster
    // (anywhere from 0% to 7%)
    if ((b & 0xff) === 0) return 0.0;
    let bits = (b & 0xff) << (24 - 3);
    bits += (63 - 15) << 24;
    return Float.intBitsToFloat(bits);
  },

  /** floatToByte(b, mantissaBits=5, zeroExponent=2) */
  floatToByte52(f: number): number {
    const bits = Float.floatToRawIntBits(f);
    const smallfloat = bits >> (24 - 5);
    if (smallfloat <= (63 - 2) << 5) {
      return bits <= 0 ? 0 : 1;
    }
    if (smallfloat >= ((63 - 2) << 5) + 0x100) {
      return 255;
    }
    return (smallfloat - ((63 - 2) << 5)) & 0xff;
  },

  /** byteToFloat(b, mantissaBits=5, zeroExponent=2) */
  byte52ToFloat(b: number): number {
    // on Java1.5 & 1.6 JVMs, prebuilding a decoding array and doing a lookup is only a little faster
    // (anywhere from 0% to 7%)
    if ((b & 0xff) === 0) return 0.0;
    let bits = (b & 0xff) << (24 - 5);
    bits += (63 - 2) << 24;
    return Float.intBitsToFloat(bits);
  },
} as const;
