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

// Port of org.apache.lucene.util.SloppyMath (Lucene 5.2.1).
//
// Deviations: StrictMath.* is Math.* (V8 uses fdlibm for sin/cos/asin; checked bit for bit against the JDK by the
// golden tests); Math.toRadians follows JDK 21 (angdeg * DEGREES_TO_RADIANS), which the Java reference runs on.
// The tables are built at module load, in the order of the Java static initializer.

import { Double, doubleToInt } from "./JavaNumbers.js";

/* some code derived from jodk: http://code.google.com/p/jodk/ (apache 2.0)
 * asin() derived from fdlibm: http://www.netlib.org/fdlibm/e_asin.c (public domain):
 * =============================================================================
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 *
 * Developed at SunSoft, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * =============================================================================
 */

// haversin
const TO_RADIANS = Math.PI / 180;

// cos/asin
const ONE_DIV_F2 = 1 / 2.0;
const ONE_DIV_F3 = 1 / 6.0;
const ONE_DIV_F4 = 1 / 24.0;

const PIO2_HI = Double.longBitsToDouble(0x3ff921fb54400000n); // first 33 bits of pi/2
const PIO2_LO = Double.longBitsToDouble(0x3dd0b4611a626331n); // pi/2 - PIO2_HI
const TWOPI_HI = 4 * PIO2_HI;
const TWOPI_LO = 4 * PIO2_LO;
const SIN_COS_TABS_SIZE = (1 << 11) + 1;
const SIN_COS_DELTA_HI = TWOPI_HI / (SIN_COS_TABS_SIZE - 1);
const SIN_COS_DELTA_LO = TWOPI_LO / (SIN_COS_TABS_SIZE - 1);
const SIN_COS_INDEXER = 1 / (SIN_COS_DELTA_HI + SIN_COS_DELTA_LO);
const sinTab = new Float64Array(SIN_COS_TABS_SIZE);
const cosTab = new Float64Array(SIN_COS_TABS_SIZE);

// Max abs value for fast modulo, above which we use regular angle normalization.
const SIN_COS_MAX_VALUE_FOR_INT_MODULO = ((2147483647 >> 9) / SIN_COS_INDEXER) * 0.99;

// Math.toRadians(73.0) on JDK 21
const ASIN_MAX_VALUE_FOR_TABS = Math.sin(73.0 * 0.017453292519943295);

const ASIN_TABS_SIZE = (1 << 13) + 1;
const ASIN_DELTA = ASIN_MAX_VALUE_FOR_TABS / (ASIN_TABS_SIZE - 1);
const ASIN_INDEXER = 1 / ASIN_DELTA;
const asinTab = new Float64Array(ASIN_TABS_SIZE);
const asinDer1DivF1Tab = new Float64Array(ASIN_TABS_SIZE);
const asinDer2DivF2Tab = new Float64Array(ASIN_TABS_SIZE);
const asinDer3DivF3Tab = new Float64Array(ASIN_TABS_SIZE);
const asinDer4DivF4Tab = new Float64Array(ASIN_TABS_SIZE);

const ASIN_PIO2_HI = Double.longBitsToDouble(0x3ff921fb54442d18n);
const ASIN_PIO2_LO = Double.longBitsToDouble(0x3c91a62633145c07n);
const ASIN_PS0 = Double.longBitsToDouble(0x3fc5555555555555n);
const ASIN_PS1 = Double.longBitsToDouble(-0x402b29edfc149083n); // 0xbfd4d61203eb6f7d
const ASIN_PS2 = Double.longBitsToDouble(0x3fc9c1550e884455n);
const ASIN_PS3 = Double.longBitsToDouble(BigInt.asIntN(64, 0xbfa48228b5688f3bn));
const ASIN_PS4 = Double.longBitsToDouble(0x3f49efe07501b288n);
const ASIN_PS5 = Double.longBitsToDouble(0x3f023de10dfdf709n);
const ASIN_QS1 = Double.longBitsToDouble(BigInt.asIntN(64, 0xc0033a271c8a2d4bn));
const ASIN_QS2 = Double.longBitsToDouble(0x40002ae59c598ac8n);
const ASIN_QS3 = Double.longBitsToDouble(BigInt.asIntN(64, 0xbfe6066c1b8d0159n));
const ASIN_QS4 = Double.longBitsToDouble(0x3fb3b8c5b12e9282n);

const RADIUS_TABS_SIZE = (1 << 10) + 1;
const RADIUS_DELTA = Math.PI / 2 / (RADIUS_TABS_SIZE - 1);
const RADIUS_INDEXER = 1 / RADIUS_DELTA;
const earthDiameterPerLatitude = new Float64Array(RADIUS_TABS_SIZE);

/** Initializes look-up tables. */
(function initTables(): void {
  // sin and cos
  const SIN_COS_PI_INDEX = (SIN_COS_TABS_SIZE - 1) / 2;
  const SIN_COS_PI_MUL_2_INDEX = 2 * SIN_COS_PI_INDEX;
  const SIN_COS_PI_MUL_0_5_INDEX = SIN_COS_PI_INDEX / 2;
  const SIN_COS_PI_MUL_1_5_INDEX = (3 * SIN_COS_PI_INDEX) / 2;
  for (let i = 0; i < SIN_COS_TABS_SIZE; i++) {
    // angle: in [0,2*PI].
    const angle = i * SIN_COS_DELTA_HI + i * SIN_COS_DELTA_LO;
    let sinAngle = Math.sin(angle);
    let cosAngle = Math.cos(angle);
    // For indexes corresponding to null cosine or sine, we make sure the value is zero
    // and not an epsilon. This allows for a much better accuracy for results close to zero.
    if (i === SIN_COS_PI_INDEX) {
      sinAngle = 0.0;
    } else if (i === SIN_COS_PI_MUL_2_INDEX) {
      sinAngle = 0.0;
    } else if (i === SIN_COS_PI_MUL_0_5_INDEX) {
      cosAngle = 0.0;
    } else if (i === SIN_COS_PI_MUL_1_5_INDEX) {
      cosAngle = 0.0;
    }
    sinTab[i] = sinAngle;
    cosTab[i] = cosAngle;
  }

  // asin
  for (let i = 0; i < ASIN_TABS_SIZE; i++) {
    // x: in [0,ASIN_MAX_VALUE_FOR_TABS].
    const x = i * ASIN_DELTA;
    asinTab[i] = Math.asin(x);
    const oneMinusXSqInv = 1.0 / (1 - x * x);
    const oneMinusXSqInv0_5 = Math.sqrt(oneMinusXSqInv);
    const oneMinusXSqInv1_5 = oneMinusXSqInv0_5 * oneMinusXSqInv;
    const oneMinusXSqInv2_5 = oneMinusXSqInv1_5 * oneMinusXSqInv;
    const oneMinusXSqInv3_5 = oneMinusXSqInv2_5 * oneMinusXSqInv;
    asinDer1DivF1Tab[i] = oneMinusXSqInv0_5;
    asinDer2DivF2Tab[i] = x * oneMinusXSqInv1_5 * ONE_DIV_F2;
    asinDer3DivF3Tab[i] = (1 + 2 * x * x) * oneMinusXSqInv2_5 * ONE_DIV_F3;
    asinDer4DivF4Tab[i] = (5 + 2 * x * (2 + x * (5 - 2 * x))) * oneMinusXSqInv3_5 * ONE_DIV_F4;
  }

  // WGS84 earth-ellipsoid major (a) and minor (b) radius
  const a = 6_378_137; // [m]
  const b = 6_356_752.3142; // [m]

  const a2 = a * a;
  const b2 = b * b;

  earthDiameterPerLatitude[0] = (2 * a) / 1000;
  earthDiameterPerLatitude[RADIUS_TABS_SIZE - 1] = (2 * b) / 1000;
  // earth radius
  for (let i = 1; i < RADIUS_TABS_SIZE - 1; i++) {
    const lat = (Math.PI * i) / (2 * RADIUS_TABS_SIZE - 1);
    const one = Math.pow(a2 * Math.cos(lat), 2);
    const two = Math.pow(b2 * Math.sin(lat), 2);
    const three = Math.pow(a * Math.cos(lat), 2);
    const four = Math.pow(b * Math.sin(lat), 2);

    const radius = Math.sqrt((one + two) / (three + four));
    earthDiameterPerLatitude[i] = (2 * radius) / 1000;
  }
})();

/** @internal the look-up tables, exposed for the golden tests. */
export const sloppyMathTables = {
  sinTab,
  cosTab,
  asinTab,
  asinDer1DivF1Tab,
  asinDer2DivF2Tab,
  asinDer3DivF3Tab,
  asinDer4DivF4Tab,
  earthDiameterPerLatitude,
};

/** Math functions that trade off accuracy for speed. */
export class SloppyMath {
  /** @internal (package-private in Java) */
  static readonly SIN_COS_MAX_VALUE_FOR_INT_MODULO = SIN_COS_MAX_VALUE_FOR_INT_MODULO;

  /**
   * Returns the distance in kilometers between two points
   * specified in decimal degrees (latitude/longitude).
   * @param lat1 Latitude of the first point.
   * @param lon1 Longitude of the first point.
   * @param lat2 Latitude of the second point.
   * @param lon2 Longitude of the second point.
   * @return distance in kilometers.
   */
  static haversin(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const x1 = lat1 * TO_RADIANS;
    const x2 = lat2 * TO_RADIANS;
    const h1 = 1 - SloppyMath.cos(x1 - x2);
    const h2 = 1 - SloppyMath.cos((lon1 - lon2) * TO_RADIANS);
    const h = (h1 + SloppyMath.cos(x1) * SloppyMath.cos(x2) * h2) / 2;

    const avgLat = (x1 + x2) / 2;
    const diameter = SloppyMath.earthDiameter(avgLat);

    return diameter * SloppyMath.asin(Math.min(1, Math.sqrt(h)));
  }

  /**
   * Returns the trigonometric cosine of an angle.
   * <p>
   * Error is around 1E-15.
   * <p>
   * Special cases:
   * <ul>
   *  <li>If the argument is {@code NaN} or an infinity, then the result is {@code NaN}.
   * </ul>
   * @param a an angle, in radians.
   * @return the cosine of the argument.
   */
  static cos(a: number): number {
    if (a < 0.0) {
      a = -a;
    }
    if (a > SIN_COS_MAX_VALUE_FOR_INT_MODULO) {
      return Math.cos(a);
    }
    // index: possibly outside tables range.
    let index = doubleToInt(a * SIN_COS_INDEXER + 0.5);
    const delta = a - index * SIN_COS_DELTA_HI - index * SIN_COS_DELTA_LO;
    // Making sure index is within tables range.
    // Last value of each table is the same than first, so we ignore it (tabs size minus one) for modulo.
    index &= SIN_COS_TABS_SIZE - 2; // index % (SIN_COS_TABS_SIZE-1)
    const indexCos = cosTab[index]!;
    const indexSin = sinTab[index]!;
    return (
      indexCos +
      delta * (-indexSin + delta * (-indexCos * ONE_DIV_F2 + delta * (indexSin * ONE_DIV_F3 + delta * indexCos * ONE_DIV_F4)))
    );
  }

  /**
   * Returns the arc sine of a value.
   * <p>
   * The returned angle is in the range <i>-pi</i>/2 through <i>pi</i>/2.
   * Error is around 1E-7.
   * <p>
   * Special cases:
   * <ul>
   *  <li>If the argument is {@code NaN} or its absolute value is greater than 1, then the result is {@code NaN}.
   * </ul>
   * @param a the value whose arc sine is to be returned.
   * @return arc sine of the argument
   */
  // because asin(-x) = -asin(x), asin(x) only needs to be computed on [0,1].
  // ---> we only have to compute asin(x) on [0,1].
  // For values not close to +-1, we use look-up tables;
  // for values near +-1, we use code derived from fdlibm.
  static asin(a: number): number {
    let negateResult: boolean;
    if (a < 0.0) {
      a = -a;
      negateResult = true;
    } else {
      negateResult = false;
    }
    if (a <= ASIN_MAX_VALUE_FOR_TABS) {
      const index = doubleToInt(a * ASIN_INDEXER + 0.5);
      const delta = a - index * ASIN_DELTA;
      const result =
        asinTab[index]! +
        delta *
          (asinDer1DivF1Tab[index]! +
            delta * (asinDer2DivF2Tab[index]! + delta * (asinDer3DivF3Tab[index]! + delta * asinDer4DivF4Tab[index]!)));
      return negateResult ? -result : result;
    } else {
      // value > ASIN_MAX_VALUE_FOR_TABS, or value is NaN
      // This part is derived from fdlibm.
      if (a < 1.0) {
        const t = (1.0 - a) * 0.5;
        const p = t * (ASIN_PS0 + t * (ASIN_PS1 + t * (ASIN_PS2 + t * (ASIN_PS3 + t * (ASIN_PS4 + t * ASIN_PS5)))));
        const q = 1.0 + t * (ASIN_QS1 + t * (ASIN_QS2 + t * (ASIN_QS3 + t * ASIN_QS4)));
        const s = Math.sqrt(t);
        const z = s + s * (p / q);
        const result = ASIN_PIO2_HI - (z + z - ASIN_PIO2_LO);
        return negateResult ? -result : result;
      } else {
        // value >= 1.0, or value is NaN
        if (a === 1.0) {
          return negateResult ? -Math.PI / 2 : Math.PI / 2;
        } else {
          return NaN;
        }
      }
    }
  }

  /** Return an approximate value of the diameter of the earth at the given latitude, in kilometers. */
  static earthDiameter(latitude: number): number {
    const index = doubleToInt(Math.abs(latitude) * RADIUS_INDEXER + 0.5) % earthDiameterPerLatitude.length;
    return earthDiameterPerLatitude[index]!;
  }
}
