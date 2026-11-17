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

// Port of org.apache.lucene.util.MathUtil (Lucene 5.2.1).

import { IllegalArgumentException } from "../errors.js";
import { Long, doubleSignBit } from "./JavaNumbers.js";

/** Math static utility methods. */
export class MathUtil {
  private constructor() {} // No instance

  /**
   * Returns `x <= 0 ? 0 : Math.floor(Math.log(x) / Math.log(base))`
   * (Java `log(long, int)`). `x` may be a number (exact up to 2^53) or a bigint.
   * @param base must be `> 1`
   */
  static log(x: number | bigint, base: number): number {
    if (base <= 1) {
      throw new IllegalArgumentException("base must be > 1");
    }
    let ret = 0;
    if (typeof x === "bigint") {
      const b = BigInt(base);
      while (x >= b) {
        x /= b;
        ret++;
      }
    } else {
      while (x >= base) {
        x = (x - (x % base)) / base; // exact integer division
        ret++;
      }
    }
    return ret;
  }

  /**
   * Calculates logarithm in a given base with doubles
   * (Java `log(double base, double x)`; note the argument order).
   */
  static logDouble(base: number, x: number): number {
    return Math.log(x) / Math.log(base);
  }

  /**
   * Return the greatest common divisor of `a` and `b`,
   * consistently with BigInteger#gcd.
   *
   * NOTE: A greatest common divisor must be positive, but 2^64 cannot be
   * expressed as a long although it is the GCD of Long.MIN_VALUE and 0 and the
   * GCD of Long.MIN_VALUE and Long.MIN_VALUE. So in these 2 cases, and only
   * them, this method will return Long.MIN_VALUE.
   */
  // see http://en.wikipedia.org/wiki/Binary_GCD_algorithm#Iterative_version_in_C.2B.2B_using_ctz_.28count_trailing_zeros.29
  static gcd(a: bigint, b: bigint): bigint {
    a = Long.abs(a);
    b = Long.abs(b);
    if (a === 0n) {
      return b;
    } else if (b === 0n) {
      return a;
    }
    const commonTrailingZeros = Long.numberOfTrailingZeros(a | b);
    a = Long.ushr(a, Long.numberOfTrailingZeros(a));
    while (true) {
      b = Long.ushr(b, Long.numberOfTrailingZeros(b));
      if (a === b) {
        break;
      } else if (a > b || a === Long.MIN_VALUE) {
        // MIN_VALUE is treated as 2^64
        const tmp = a;
        a = b;
        b = tmp;
      }
      if (a === 1n) {
        break;
      }
      b = Long.wrap(b - a);
    }
    return Long.wrap(a << BigInt(commonTrailingZeros));
  }

  /**
   * Calculates inverse hyperbolic sine of a `double` value.
   *
   * Special cases:
   *  - If the argument is NaN, then the result is NaN.
   *  - If the argument is zero, then the result is a zero with the same sign as the argument.
   *  - If the argument is infinite, then the result is infinity with the same sign as the argument.
   */
  static asinh(a: number): number {
    let sign: number;
    // check the sign bit of the raw representation to handle -0
    if (doubleSignBit(a)) {
      a = Math.abs(a);
      sign = -1.0;
    } else {
      sign = 1.0;
    }
    return sign * Math.log(Math.sqrt(a * a + 1.0) + a);
  }

  /**
   * Calculates inverse hyperbolic cosine of a `double` value.
   *
   * Special cases:
   *  - If the argument is NaN, then the result is NaN.
   *  - If the argument is +1, then the result is a zero.
   *  - If the argument is positive infinity, then the result is positive infinity.
   *  - If the argument is less than 1, then the result is NaN.
   */
  static acosh(a: number): number {
    return Math.log(Math.sqrt(a * a - 1.0) + a);
  }

  /**
   * Calculates inverse hyperbolic tangent of a `double` value.
   *
   * Special cases:
   *  - If the argument is NaN, then the result is NaN.
   *  - If the argument is zero, then the result is a zero with the same sign as the argument.
   *  - If the argument is +1, then the result is positive infinity.
   *  - If the argument is -1, then the result is negative infinity.
   *  - If the argument's absolute value is greater than 1, then the result is NaN.
   */
  static atanh(a: number): number {
    let mult: number;
    // check the sign bit of the raw representation to handle -0
    if (doubleSignBit(a)) {
      a = Math.abs(a);
      mult = -0.5;
    } else {
      mult = 0.5;
    }
    return mult * Math.log((1.0 + a) / (1.0 - a));
  }
}
