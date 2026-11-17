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

// Port of org.apache.lucene.util.StringHelper (Lucene 5.2.1).

import { randomBytes } from "node:crypto";
import { IllegalArgumentException } from "../errors.js";
import { BytesRef } from "./BytesRef.js";
import type { IntsRef } from "./IntsRef.js";
import { Integer, javaStringHashCode } from "./JavaNumbers.js";
import { lassert } from "./assertions.js";

const MASK_64 = (1n << 64n) - 1n;
const MASK_128 = (1n << 128n) - 1n;

/**
 * The Java code reads the `tests.seed` system property. The equivalent here is
 * the `TESTS_SEED` environment variable.
 */
const testsSeed: string | undefined = process.env["TESTS_SEED"];

// Poached from Guava: set a different salt/seed
// for each process, to frustrate hash key collision
// denial of service attacks, and to catch any places that
// somehow rely on hash function/order across processes:
const GOOD_FAST_HASH_SEED: number =
  testsSeed !== undefined
    ? // So if there is a test failure that relied on hash
      // order, we remain reproducible based on the test seed:
      javaStringHashCode(testsSeed)
    : Date.now() | 0; // (int) System.currentTimeMillis()

// Holds 128 bit unsigned value:
let nextId: bigint = (() => {
  // State for xorshift128:
  let x0: bigint;
  let x1: bigint;

  if (testsSeed !== undefined) {
    // So if there is a test failure that somehow relied on this id,
    // we remain reproducible based on the test seed:
    let prop = testsSeed;
    if (prop.length > 8) {
      prop = prop.substring(prop.length - 8);
    }
    x0 = BigInt.asUintN(64, BigInt("0x" + prop));
    x1 = x0;
  } else {
    const buf = randomBytes(16);
    x0 = buf.readBigUInt64BE(0);
    x1 = buf.readBigUInt64BE(8);
  }

  // Use a few iterations of xorshift128 to scatter the seed
  // in case multiple Lucene instances starting up "near" the same
  // time, since we use ++ (mod 2^128) for full period cycle:
  for (let i = 0; i < 10; i++) {
    let s1 = x0;
    const s0 = x1;
    x0 = s0;
    s1 ^= (s1 << 23n) & MASK_64; // a
    x1 = s1 ^ s0 ^ (s1 >> 17n) ^ (s0 >> 26n); // b, c
  }

  // Concatenate bits of x0 and x1, as unsigned 128 bit integer:
  return (x0 << 64n) | x1;
})();

/** Methods for manipulating strings. @lucene.internal */
export abstract class StringHelper {
  /**
   * Compares two BytesRef, element by element, and returns the
   * number of elements common to both arrays (from the start of each).
   *
   * @param left The first BytesRef to compare
   * @param right The second BytesRef to compare
   * @return The number of common elements (from the start of each).
   */
  static bytesDifference(left: BytesRef, right: BytesRef): number {
    const len = left.length < right.length ? left.length : right.length;
    const bytesLeft = left.bytes;
    const offLeft = left.offset;
    const bytesRight = right.bytes;
    const offRight = right.offset;
    for (let i = 0; i < len; i++) {
      if (bytesLeft[i + offLeft] !== bytesRight[i + offRight]) {
        return i;
      }
    }
    return len;
  }

  /**
   * Returns the length of `currentTerm` needed for use as a sort key,
   * so that BytesRef#compareTo still returns the same result.
   * This method assumes currentTerm comes after priorTerm.
   */
  static sortKeyLength(priorTerm: BytesRef, currentTerm: BytesRef): number {
    const currentTermOffset = currentTerm.offset;
    const priorTermOffset = priorTerm.offset;
    const limit = Math.min(priorTerm.length, currentTerm.length);
    for (let i = 0; i < limit; i++) {
      if (priorTerm.bytes[priorTermOffset + i] !== currentTerm.bytes[currentTermOffset + i]) {
        return i + 1;
      }
    }
    return Math.min(1 + priorTerm.length, currentTerm.length);
  }

  /** Null-safe string equality. */
  static equals(s1: string | null | undefined, s2: string | null | undefined): boolean {
    if (s1 === null || s1 === undefined) {
      return s2 === null || s2 === undefined;
    }
    return s1 === s2;
  }

  /**
   * Returns true iff the ref starts with the given prefix.
   * Otherwise false.
   *
   * @param ref the byte array or BytesRef to test
   * @param prefix the expected prefix
   */
  static startsWith(ref: Uint8Array | BytesRef, prefix: BytesRef): boolean {
    if (ref instanceof BytesRef) {
      return StringHelper.sliceEquals(ref, prefix, 0);
    }
    if (ref.length < prefix.length) {
      return false;
    }

    for (let i = 0; i < prefix.length; i++) {
      if (ref[i] !== prefix.bytes[prefix.offset + i]) {
        return false;
      }
    }

    return true;
  }

  /**
   * Returns true iff the ref ends with the given suffix. Otherwise false.
   *
   * @param ref the BytesRef to test
   * @param suffix the expected suffix
   */
  static endsWith(ref: BytesRef, suffix: BytesRef): boolean {
    return StringHelper.sliceEquals(ref, suffix, ref.length - suffix.length);
  }

  private static sliceEquals(sliceToTest: BytesRef, other: BytesRef, pos: number): boolean {
    if (pos < 0 || sliceToTest.length - pos < other.length) {
      return false;
    }
    let i = sliceToTest.offset + pos;
    let j = other.offset;
    const k = other.offset + other.length;

    while (j < k) {
      if (sliceToTest.bytes[i++] !== other.bytes[j++]) {
        return false;
      }
    }

    return true;
  }

  /** Pass this as the seed to {@link StringHelper.murmurhash3_x86_32}. */
  static get GOOD_FAST_HASH_SEED(): number {
    return GOOD_FAST_HASH_SEED;
  }

  /**
   * Returns the MurmurHash3_x86_32 hash (as a signed 32-bit int).
   * Original source/tests at https://github.com/yonik/java_util/
   */
  static murmurhash3_x86_32(data: Uint8Array, offset: number, len: number, seed: number): number;
  static murmurhash3_x86_32(bytes: BytesRef, seed: number): number;
  static murmurhash3_x86_32(a: Uint8Array | BytesRef, b: number, c?: number, d?: number): number {
    if (a instanceof BytesRef) {
      return StringHelper.murmurhash3_x86_32(a.bytes, a.offset, a.length, b);
    }
    const data = a;
    const offset = b;
    const len = c as number;
    const seed = d as number;

    const c1 = 0xcc9e2d51 | 0;
    const c2 = 0x1b873593;

    let h1 = seed | 0;
    const roundedEnd = offset + (len & 0xfffffffc); // round down to 4 byte block

    for (let i = offset; i < roundedEnd; i += 4) {
      // little endian load order
      let k1 = data[i]! | (data[i + 1]! << 8) | (data[i + 2]! << 16) | (data[i + 3]! << 24);
      k1 = Math.imul(k1, c1);
      k1 = Integer.rotateLeft(k1, 15);
      k1 = Math.imul(k1, c2);

      h1 ^= k1;
      h1 = Integer.rotateLeft(h1, 13);
      h1 = (Math.imul(h1, 5) + (0xe6546b64 | 0)) | 0;
    }

    // tail
    let k1 = 0;

    switch (len & 0x03) {
      case 3:
        k1 = data[roundedEnd + 2]! << 16;
      // fallthrough
      case 2:
        k1 |= data[roundedEnd + 1]! << 8;
      // fallthrough
      case 1:
        k1 |= data[roundedEnd]!;
        k1 = Math.imul(k1, c1);
        k1 = Integer.rotateLeft(k1, 15);
        k1 = Math.imul(k1, c2);
        h1 ^= k1;
    }

    // finalization
    h1 ^= len;

    // fmix(h1);
    h1 ^= h1 >>> 16;
    h1 = Math.imul(h1, 0x85ebca6b | 0);
    h1 ^= h1 >>> 13;
    h1 = Math.imul(h1, 0xc2b2ae35 | 0);
    h1 ^= h1 >>> 16;

    return h1;
  }

  /** length in bytes of an ID */
  static readonly ID_LENGTH = 16;

  /** Generates a non-cryptographic globally unique id. */
  static randomId(): Uint8Array {
    // NOTE: like the Java version this is a simple ++ (mod 2^128) counter,
    // which is guaranteed to have the full period. (JS is single threaded,
    // so no lock is needed around the update.)
    let bits = nextId;
    nextId = (nextId + 1n) & MASK_128;

    const result = new Uint8Array(StringHelper.ID_LENGTH);
    for (let i = StringHelper.ID_LENGTH - 1; i >= 0; i--) {
      result[i] = Number(bits & 0xffn);
      bits >>= 8n;
    }
    lassert(() => bits === 0n);
    return result;
  }

  /**
   * Helper method to render an ID as a string, for debugging
   *
   * Returns the string `(null)` if the id is null.
   * Otherwise, returns a string representation for debugging.
   * Never throws an exception. The returned string may
   * indicate if the id is definitely invalid.
   */
  static idToString(id: Uint8Array | null | undefined): string {
    if (id === null || id === undefined) {
      return "(null)";
    }
    let n = 0n;
    for (const byte of id) {
      n = (n << 8n) | BigInt(byte);
    }
    // Character.MAX_RADIX is 36
    let sb = n.toString(36);
    if (id.length !== StringHelper.ID_LENGTH) {
      sb += " (INVALID FORMAT)";
    }
    return sb;
  }

  /**
   * Just converts each int in the incoming {@link IntsRef} to each byte
   * in the returned {@link BytesRef}, throwing {@code IllegalArgumentException}
   * if any int value is out of bounds for a byte.
   */
  static intsRefToBytesRef(ints: IntsRef): BytesRef {
    const bytes = new Uint8Array(ints.length);
    for (let i = 0; i < ints.length; i++) {
      const x = ints.ints[ints.offset + i]!;
      if (x < 0 || x > 255) {
        throw new IllegalArgumentException("int at pos=" + i + " with value=" + x + " is out-of-bounds for byte");
      }
      bytes[i] = x;
    }

    return new BytesRef(bytes);
  }
}
