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

// Partial port of org.apache.lucene.util.RamUsageEstimator (Lucene 5.2.1).
//
// Only the size constants are ported (they drive ArrayUtil.oversize). The Java
// class measures them from the running JVM; here they are fixed to what a
// 64-bit HotSpot JVM with compressed object references reports, which is also
// what the golden tests are generated with (java -XX:+UseCompressedOops).
// humanReadableUnits(), alignObjectSize() and sizeOf() of primitive arrays (typed arrays here) are ported too.
// shallowSizeOf(), sizeOf(Object) and friends are not ported yet.

export const RamUsageEstimator = {
  NUM_BYTES_BOOLEAN: 1,
  NUM_BYTES_BYTE: 1,
  NUM_BYTES_CHAR: 2,
  NUM_BYTES_SHORT: 2,
  NUM_BYTES_INT: 4,
  NUM_BYTES_FLOAT: 4,
  NUM_BYTES_LONG: 8,
  NUM_BYTES_DOUBLE: 8,

  COMPRESSED_REFS_ENABLED: true,
  NUM_BYTES_OBJECT_REF: 4,
  NUM_BYTES_OBJECT_HEADER: 12,
  /** object header + int length, aligned to the object alignment (8) */
  NUM_BYTES_ARRAY_HEADER: 16,
  NUM_BYTES_OBJECT_ALIGNMENT: 8,

  /** One kilobyte bytes. */
  ONE_KB: 1024,
  /** One megabyte bytes. */
  ONE_MB: 1024 * 1024,
  /** One gigabyte bytes. */
  ONE_GB: 1024 * 1024 * 1024,

  /** Aligns an object size to the object alignment (a long computation in Java). */
  alignObjectSize(size: number): number {
    size += 8 - 1; // NUM_BYTES_OBJECT_ALIGNMENT - 1
    return size - (size % 8);
  },

  /**
   * Returns the size in bytes of a primitive array (byte[]: Uint8Array/Int8Array, char[]: Uint16Array,
   * short[]: Int16Array, int[]: Int32Array, float[]: Float32Array, long[]: BigInt64Array, double[]: Float64Array).
   */
  sizeOf(arr: { length: number; BYTES_PER_ELEMENT: number }): number {
    const el = arr.BYTES_PER_ELEMENT;
    return RamUsageEstimator.alignObjectSize(16 + el * arr.length); // NUM_BYTES_ARRAY_HEADER
  },

  /**
   * Returns <code>size</code> in human-readable units (GB, MB, KB or bytes).
   * Java formats the <code>float</code> quotient with DecimalFormat("0.#") (HALF_EVEN, Locale.ROOT).
   */
  humanReadableUnits(bytes: number): string {
    const fmt = (units: number, suffix: string): string => {
      // (float) bytes / units: a float division. The float quotient times 10 is exact in a double.
      const t = Math.fround(Math.fround(bytes) / units) * 10;
      let n = Math.floor(t);
      const frac = t - n;
      if (frac > 0.5 || (frac === 0.5 && n % 2 !== 0)) n += 1;
      const whole = Math.floor(n / 10);
      const dec = n - whole * 10;
      return (dec === 0 ? String(whole) : whole + "." + dec) + " " + suffix;
    };
    if (Math.trunc(bytes / RamUsageEstimator.ONE_GB) > 0) {
      return fmt(RamUsageEstimator.ONE_GB, "GB");
    } else if (Math.trunc(bytes / RamUsageEstimator.ONE_MB) > 0) {
      return fmt(RamUsageEstimator.ONE_MB, "MB");
    } else if (Math.trunc(bytes / RamUsageEstimator.ONE_KB) > 0) {
      return fmt(RamUsageEstimator.ONE_KB, "KB");
    } else {
      return bytes + " bytes";
    }
  },
} as const;
