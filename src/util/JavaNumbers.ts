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

/**
 * Helpers reproducing java.lang.Integer / java.lang.Long semantics.
 *
 * Conventions used across the port:
 *  - Java `int`  -> `number`, always kept as a signed 32-bit value (`| 0`).
 *  - Java `long` -> `bigint`, always kept as a signed 64-bit value
 *    (`BigInt.asIntN(64, ...)`), because a JS number cannot hold 64 bits.
 */

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

export const Integer = {
  MIN_VALUE: -2147483648,
  MAX_VALUE: 2147483647,

  /** Integer.bitCount */
  bitCount(i: number): number {
    i = i | 0;
    i = i - ((i >>> 1) & 0x55555555);
    i = (i & 0x33333333) + ((i >>> 2) & 0x33333333);
    i = (i + (i >>> 4)) & 0x0f0f0f0f;
    return Math.imul(i, 0x01010101) >>> 24;
  },

  /** Integer.rotateLeft */
  rotateLeft(i: number, distance: number): number {
    return ((i << distance) | (i >>> (32 - distance))) | 0;
  },

  /** Integer.numberOfTrailingZeros */
  numberOfTrailingZeros(i: number): number {
    i = i | 0;
    return i === 0 ? 32 : 31 - Math.clz32(i & -i);
  },

  /** Integer.toHexString (treats the value as unsigned, lower case, no padding). */
  toHexString(i: number): string {
    return (i >>> 0).toString(16);
  },
} as const;

export const Long = {
  MIN_VALUE: -(1n << 63n),
  MAX_VALUE: (1n << 63n) - 1n,

  /** Wraps any bigint to a signed 64-bit value. */
  wrap(x: bigint): bigint {
    return BigInt.asIntN(64, x);
  },

  /** Long.bitCount */
  bitCount(x: bigint): number {
    const u = BigInt.asUintN(64, x);
    return Integer.bitCount(Number(u & 0xffffffffn)) + Integer.bitCount(Number(u >> 32n));
  },

  /** Long.numberOfTrailingZeros */
  numberOfTrailingZeros(x: bigint): number {
    const u = BigInt.asUintN(64, x);
    if (u === 0n) {
      return 64;
    }
    const low = Number(u & 0xffffffffn);
    if (low !== 0) {
      return Integer.numberOfTrailingZeros(low);
    }
    return 32 + Integer.numberOfTrailingZeros(Number(u >> 32n));
  },

  /** The Java `>>>` operator on a long. */
  ushr(x: bigint, n: number): bigint {
    return BigInt.asIntN(64, BigInt.asUintN(64, x) >> BigInt(n & 63));
  },

  /** Math.abs on a long (Long.MIN_VALUE stays Long.MIN_VALUE, as in Java). */
  abs(x: bigint): bigint {
    return BigInt.asIntN(64, x < 0n ? -x : x);
  },
} as const;

/** True when the sign bit of the raw IEEE-754 representation is set (so -0.0 and negative NaNs count). */
export function doubleSignBit(a: number): boolean {
  f64[0] = a;
  // little-endian hosts store the high word second; check via a probe
  return (u32[LITTLE_ENDIAN ? 1 : 0]! & 0x80000000) !== 0;
}

const LITTLE_ENDIAN = (() => {
  const probe = new Uint32Array([1]);
  return new Uint8Array(probe.buffer)[0] === 1;
})();

/** String.hashCode() as computed by Java (UTF-16 code units, 31 multiplier, int overflow). */
export function javaStringHashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  return h;
}

/** Equivalents of the java.lang.Character helpers that Lucene relies on. */
export const Character = {
  MIN_RADIX: 2,
  MAX_RADIX: 36,

  /**
   * Character.digit(char, radix): the value of `ch` as a digit in `radix`, or -1.
   * Handles ASCII, the fullwidth Latin letters and every Unicode decimal digit
   * of the BMP (checked against the JDK for all 65536 chars, see the golden tests).
   */
  digit(ch: number, radix: number): number {
    if (radix < Character.MIN_RADIX || radix > Character.MAX_RADIX) {
      return -1;
    }
    let value = -1;
    if (ch >= 0x30 && ch <= 0x39) {
      value = ch - 0x30;
    } else if (ch >= 0x61 && ch <= 0x7a) {
      value = ch - 0x61 + 10;
    } else if (ch >= 0x41 && ch <= 0x5a) {
      value = ch - 0x41 + 10;
    } else if (ch >= 0xff21 && ch <= 0xff3a) {
      value = ch - 0xff21 + 10;
    } else if (ch >= 0xff41 && ch <= 0xff5a) {
      value = ch - 0xff41 + 10;
    } else if (ch >= 0x80 && ND.test(String.fromCharCode(ch))) {
      // Unicode decimal digits come in contiguous runs of ten starting at zero.
      let start = ch;
      while (start > 0 && ND.test(String.fromCharCode(start - 1))) {
        start--;
      }
      value = (ch - start) % 10;
    }
    return value >= 0 && value < radix ? value : -1;
  },
} as const;

const ND = /^\p{Nd}$/u;
