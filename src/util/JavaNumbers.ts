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

import { NumberFormatException } from "../errors.js";

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

  /**
   * Integer.parseInt(String s, int radix): optional '+'/'-' sign followed by digits (any Unicode decimal digit, as
   * Character.digit). Throws NumberFormatException with the JDK 21 messages.
   */
  parseInt(s: string | null, radix = 10): number {
    if (s === null || s === undefined) {
      throw new NumberFormatException("Cannot parse null string: null");
    }
    const bad = (): NumberFormatException =>
      new NumberFormatException('For input string: "' + s + '"' + (radix === 10 ? "" : " under radix " + radix));
    if (radix < Character.MIN_RADIX) {
      throw new NumberFormatException("radix " + radix + " less than Character.MIN_RADIX");
    }
    if (radix > Character.MAX_RADIX) {
      throw new NumberFormatException("radix " + radix + " greater than Character.MAX_RADIX");
    }
    const len = s.length;
    if (len === 0) {
      throw bad();
    }
    let i = 0;
    let negative = false;
    const first = s.charCodeAt(0);
    if (first < 0x30) {
      if (first === 0x2d) negative = true;
      else if (first !== 0x2b) throw bad();
      if (len === 1) throw bad();
      i++;
    }
    let result = 0;
    for (; i < len; i++) {
      const digit = Character.digit(s.charCodeAt(i), radix);
      if (digit < 0) throw bad();
      result = result * radix + digit;
      if (result > 2147483648) throw bad();
    }
    if (negative) return -result;
    if (result > 2147483647) throw bad();
    return result;
  },

  /** Integer.toHexString (treats the value as unsigned, lower case, no padding). */
  toHexString(i: number): string {
    return (i >>> 0).toString(16);
  },
} as const;

// BigInt64Array wraps what is stored in it to 64 bits, which is exactly what Java's long arithmetic does.
const BIT = new BigInt64Array(64);
const LOW_MASK = new BigInt64Array(64);
for (let i = 0; i < 64; i++) {
  BIT[i] = 1n << BigInt(i);
  LOW_MASK[i] = (1n << BigInt(i)) - 1n;
}

export const Long = {
  MIN_VALUE: -(1n << 63n),
  MAX_VALUE: (1n << 63n) - 1n,

  /** Wraps any bigint to a signed 64-bit value. */
  wrap(x: bigint): bigint {
    return BigInt.asIntN(64, x);
  },

  /**
   * The widening conversion (float) l of a long: rounded once to the nearest float, ties to even (Number(l) would
   * round twice above 2^53).
   */
  toFloat(l: bigint): number {
    const neg = l < 0n;
    let a = neg ? -l : l;
    if (a < 1n << 53n) {
      const f = Math.fround(Number(a));
      return neg ? -f : f;
    }
    // keep the top 24 bits, round to nearest even using the dropped bits
    const bits = a.toString(2).length;
    const drop = BigInt(bits - 24);
    const rest = a & ((1n << drop) - 1n);
    const half = 1n << (drop - 1n);
    a >>= drop;
    if (rest > half || (rest === half && (a & 1n) === 1n)) a += 1n;
    const f = Number(a) * Math.pow(2, Number(drop));
    return neg ? -f : f;
  },

  /** Long.bitCount */
  bitCount(x: bigint): number {
    const u = BigInt.asUintN(64, x);
    return Integer.bitCount(Number(u & 0xffffffffn)) + Integer.bitCount(Number(u >> 32n));
  },


  /**
   * Long.parseLong(String s, int radix): optional '+'/'-' sign followed by digits (any Unicode decimal digit, as
   * Character.digit). Throws NumberFormatException with the JDK 21 messages.
   */
  parseLong(s: string | null, radix = 10): bigint {
    if (s === null || s === undefined) {
      throw new NumberFormatException("Cannot parse null string: null");
    }
    const bad = (): NumberFormatException =>
      new NumberFormatException('For input string: "' + s + '"' + (radix === 10 ? "" : " under radix " + radix));
    if (radix < Character.MIN_RADIX) {
      throw new NumberFormatException("radix " + radix + " less than Character.MIN_RADIX");
    }
    if (radix > Character.MAX_RADIX) {
      throw new NumberFormatException("radix " + radix + " greater than Character.MAX_RADIX");
    }
    const len = s.length;
    if (len === 0) {
      throw bad();
    }
    let i = 0;
    let negative = false;
    const first = s.charCodeAt(0);
    if (first < 0x30) {
      if (first === 0x2d) negative = true;
      else if (first !== 0x2b) throw bad();
      if (len === 1) throw bad();
      i++;
    }
    let result = 0n;
    const r = BigInt(radix);
    for (; i < len; i++) {
      const digit = Character.digit(s.charCodeAt(i), radix);
      if (digit < 0) throw bad();
      result = result * r + BigInt(digit);
      if (result > 9223372036854775808n) throw bad();
    }
    if (negative) return -result;
    if (result > 9223372036854775807n) throw bad();
    return result;
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

  /** Long.numberOfLeadingZeros */
  numberOfLeadingZeros(x: bigint): number {
    const u = BigInt.asUintN(64, x);
    const hi = Number(u >> 32n);
    return hi !== 0 ? Math.clz32(hi) : 32 + Math.clz32(Number(u & 0xffffffffn));
  },

  /** The Java `<<` operator on a long: the count is taken modulo 64 and the result wraps. */
  shl(x: bigint, n: number): bigint {
    return BigInt.asIntN(64, x << BigInt(n & 63));
  },

  /** The Java `>>` operator on a long (arithmetic, count modulo 64). */
  shr(x: bigint, n: number): bigint {
    return x >> BigInt(n & 63);
  },

  /** `1L << n` (count modulo 64), from a table. */
  bit(n: number): bigint {
    return BIT[n & 63]!;
  },

  /** `(1L << n) - 1` (count modulo 64; n = 63 gives Long.MAX_VALUE), from a table. */
  lowMask(n: number): bigint {
    return LOW_MASK[n & 63]!;
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

/**
 * Double.toString(double): "1.0", "0.001", "1.0E7", "-0.0", "NaN", "Infinity"... The digits are the shortest
 * decimal that round-trips, as in JDK 19+ (earlier JDKs sometimes printed one digit more).
 */
export function doubleToString(d: number): string {
  if (Number.isNaN(d)) return "NaN";
  if (d === Infinity) return "Infinity";
  if (d === -Infinity) return "-Infinity";
  if (d === 0) return Object.is(d, -0) ? "-0.0" : "0.0";
  const sign = d < 0 ? "-" : "";
  const abs = Math.abs(d);
  let [mant, exp] = abs.toExponential().split("e") as [string, string];
  if (mant.length === 1) {
    // JDK 19+ never prints a single significant digit when two digits identify the value: it then picks the
    // two-digit decimal closest to the exact value (Double.MIN_VALUE prints as 4.9E-324, not 5.0E-324).
    const two = abs.toExponential(1);
    if (Number(two) === abs) [mant, exp] = two.split("e") as [string, string];
  }
  const digits = mant.replace(".", "").replace(/0+$/, "") || "0";
  const e = Number(exp);
  if (abs >= 1e-3 && abs < 1e7) {
    if (e >= 0) {
      const intPart = digits.padEnd(e + 1, "0").slice(0, e + 1);
      const frac = digits.slice(e + 1);
      return sign + intPart + "." + (frac === "" ? "0" : frac);
    }
    return sign + "0." + "0".repeat(-e - 1) + digits;
  }
  const frac = digits.slice(1);
  return sign + digits[0] + "." + (frac === "" ? "0" : frac) + "E" + e;
}

/** The narrowing conversion (long) d: NaN is 0, out-of-range values saturate, the rest truncates toward zero. */
export function doubleToLong(d: number): bigint {
  if (Number.isNaN(d)) return 0n;
  if (d >= 9223372036854775808) return 9223372036854775807n;
  if (d <= -9223372036854775808) return -9223372036854775808n;
  return BigInt(Math.trunc(d));
}

const f32 = new Float32Array(1);
const i32 = new Int32Array(f32.buffer);
const dbl = new Float64Array(1);
const i64 = new BigInt64Array(dbl.buffer);

/** java.lang.Float: the bit-level conversions and Float.toString. A Java `float` is a `number` rounded with Math.fround. */
export const Float = {
  MAX_VALUE: 3.4028234663852886e38,
  MIN_VALUE: 1.401298464324817e-45,
  /** canonical NaN bits */
  NaNBits: 0x7fc00000,

  /** Float.floatToRawIntBits: the value is first rounded to a float. */
  floatToRawIntBits(f: number): number {
    f32[0] = f;
    return i32[0]!;
  },

  /** Float.floatToIntBits: every NaN collapses to 0x7fc00000. */
  floatToIntBits(f: number): number {
    return Number.isNaN(f) ? 0x7fc00000 : Float.floatToRawIntBits(f);
  },

  /** Float.intBitsToFloat */
  intBitsToFloat(bits: number): number {
    i32[0] = bits;
    return f32[0]!;
  },

  /** Float.toString(float): the shortest decimal that identifies the float (JDK 19+), Java's layout. */
  toString(f: number): string {
    return floatToString(f);
  },
} as const;

/** java.lang.Double: the bit-level conversions (longs are bigint). */
export const Double = {
  MAX_VALUE: Number.MAX_VALUE,
  MIN_VALUE: Number.MIN_VALUE,

  /** Double.doubleToRawLongBits */
  doubleToRawLongBits(d: number): bigint {
    dbl[0] = d;
    return i64[0]!;
  },

  /** Double.doubleToLongBits: every NaN collapses to 0x7ff8000000000000. */
  doubleToLongBits(d: number): bigint {
    return Number.isNaN(d) ? 0x7ff8000000000000n : Double.doubleToRawLongBits(d);
  },

  /** Double.longBitsToDouble */
  longBitsToDouble(bits: bigint): number {
    i64[0] = bits;
    return dbl[0]!;
  },

  /** Double.toString(double) */
  toString(d: number): string {
    return doubleToString(d);
  },
} as const;

/**
 * Float.toString(float): like doubleToString, but the digits identify the value among floats (so 0.1f prints
 * "0.1" and 1.0E10f prints "1.0E10").
 */
export function floatToString(f: number): string {
  f = Math.fround(f);
  if (Number.isNaN(f)) return "NaN";
  if (f === Infinity) return "Infinity";
  if (f === -Infinity) return "-Infinity";
  if (f === 0) return Object.is(f, -0) ? "-0.0" : "0.0";
  const sign = f < 0 ? "-" : "";
  const abs = Math.abs(f);
  // shortest digit count p such that the p-digit decimal nearest to abs reads back as the same float
  let p = 1;
  while (p < 9 && Math.fround(Number(abs.toExponential(p - 1))) !== abs) p++;
  if (p === 1) {
    // JDK 19+: two digits are printed when they identify the value; they are the two digits nearest to it
    if (Math.fround(Number(abs.toExponential(1))) === abs) p = 2;
  }
  const [mant, exp] = abs.toExponential(p - 1).split("e") as [string, string];
  const digits = mant.replace(".", "").replace(/0+$/, "") || "0";
  const e = Number(exp);
  if (abs >= 1e-3 && abs < 1e7) {
    if (e >= 0) {
      const intPart = digits.padEnd(e + 1, "0").slice(0, e + 1);
      const frac = digits.slice(e + 1);
      return sign + intPart + "." + (frac === "" ? "0" : frac);
    }
    return sign + "0." + "0".repeat(-e - 1) + digits;
  }
  const frac = digits.slice(1);
  return sign + digits[0] + "." + (frac === "" ? "0" : frac) + "E" + e;
}

/** The narrowing conversion (int) d: NaN is 0, out-of-range values saturate, the rest truncates toward zero. */
export function doubleToInt(d: number): number {
  if (Number.isNaN(d)) return 0;
  if (d >= 2147483647) return 2147483647;
  if (d <= -2147483648) return -2147483648;
  return Math.trunc(d) | 0;
}
