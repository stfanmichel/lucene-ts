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

// Small helpers for java.lang.Object / java.lang.Thread / java.util.Arrays behaviour the port needs.

import { ArrayIndexOutOfBoundsException } from "../errors.js";

const identityHashes = new WeakMap<object, number>();
let identityHashState = 0x2545f491;

/**
 * System.identityHashCode: a stable per-object 31-bit number (a xorshift sequence, so different objects
 * get different, well-spread hashes). Java's real values are unspecified and run-dependent.
 */
export function identityHashCode(o: object | null): number {
  if (o === null) return 0;
  let h = identityHashes.get(o);
  if (h === undefined) {
    let x = identityHashState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    identityHashState = x | 0;
    h = (x >>> 1) || 1;
    identityHashes.set(o, h);
  }
  return h;
}

/** Integer.toHexString */
export function toHexString(i: number): string {
  return (i >>> 0).toString(16);
}

/** Object.toString(): getClass().getName() + '@' + Integer.toHexString(hashCode()), with the JS class name. */
export function objectToString(o: object): string {
  return o.constructor.name + "@" + toHexString(identityHashCode(o));
}

/** Thread.sleep(millis): blocks the (single) thread. */
export function sleepSync(millis: number): void {
  if (millis <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, millis);
}

/** java.util.Arrays.hashCode(byte[]) (the bytes are held unsigned, Java sums them signed). */
export function arraysHashCode(a: Uint8Array | null): number {
  if (a === null) return 0;
  let result = 1;
  for (let i = 0; i < a.length; i++) {
    result = (Math.imul(31, result) + ((a[i]! << 24) >> 24)) | 0;
  }
  return result;
}

/** java.util.Arrays.equals(byte[], byte[]) */
export function arraysEquals(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a === b) return true;
  if (a === null || b === null || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * System.arraycopy for byte arrays: bounds are checked up front like the JVM does (nothing is copied when an
 * ArrayIndexOutOfBoundsException is thrown), with the JDK's messages.
 */
export function arraycopy(src: Uint8Array, srcPos: number, dest: Uint8Array, destPos: number, length: number): void {
  if (srcPos < 0) {
    throw new ArrayIndexOutOfBoundsException("arraycopy: source index " + srcPos + " out of bounds for byte[" + src.length + "]");
  }
  if (destPos < 0) {
    throw new ArrayIndexOutOfBoundsException("arraycopy: destination index " + destPos + " out of bounds for byte[" + dest.length + "]");
  }
  if (length < 0) {
    throw new ArrayIndexOutOfBoundsException("arraycopy: length " + length + " is negative");
  }
  if (srcPos + length > src.length) {
    throw new ArrayIndexOutOfBoundsException(
      "arraycopy: last source index " + (srcPos + length) + " out of bounds for byte[" + src.length + "]");
  }
  if (destPos + length > dest.length) {
    throw new ArrayIndexOutOfBoundsException(
      "arraycopy: last destination index " + (destPos + length) + " out of bounds for byte[" + dest.length + "]");
  }
  dest.set(src.subarray(srcPos, srcPos + length), destPos);
}
