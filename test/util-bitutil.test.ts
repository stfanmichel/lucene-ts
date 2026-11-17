import { test } from "node:test";
import assert from "node:assert/strict";
import { BitUtil } from "../src/util/BitUtil.js";
import { Integer, Long } from "../src/util/JavaNumbers.js";
import { mulberry32, randomInt32, randomInt64 } from "./helpers.js";

test("Integer.bitCount matches a naive popcount", () => {
  const rnd = mulberry32(1);
  for (let n = 0; n < 5000; n++) {
    const x = randomInt32(rnd);
    let naive = 0;
    for (let b = 0; b < 32; b++) naive += (x >>> b) & 1;
    assert.equal(Integer.bitCount(x), naive, `x=${x}`);
  }
  assert.equal(Integer.bitCount(-1), 32);
  assert.equal(Integer.bitCount(Integer.MIN_VALUE), 1);
});

test("Long.bitCount / numberOfTrailingZeros", () => {
  assert.equal(Long.bitCount(-1n), 64);
  assert.equal(Long.bitCount(0n), 0);
  assert.equal(Long.bitCount(Long.MIN_VALUE), 1);
  assert.equal(Long.numberOfTrailingZeros(0n), 64);
  assert.equal(Long.numberOfTrailingZeros(Long.MIN_VALUE), 63);
  assert.equal(Long.numberOfTrailingZeros(8n), 3);
  assert.equal(Long.numberOfTrailingZeros(1n << 40n), 40);
});

test("bitCount(byte) and bitList(byte)", () => {
  for (let b = 0; b < 256; b++) {
    assert.equal(BitUtil.bitCount(b), Integer.bitCount(b));
  }
  // example from the javadoc: bitList(12) returns 0x43
  assert.equal(BitUtil.bitList(12), 0x43);
  assert.equal(BitUtil.bitList(0), 0);
  assert.equal(BitUtil.bitList(1), 1);
  assert.equal(BitUtil.bitList(255), 0x87654321 | 0);
});

test("pop_* helpers agree with a per-bit count", () => {
  const rnd = mulberry32(2);
  const a = new BigInt64Array(9);
  const b = new BigInt64Array(9);
  for (let i = 0; i < a.length; i++) {
    a[i] = randomInt64(rnd);
    b[i] = randomInt64(rnd);
  }
  const naive = (f: (x: bigint, y: bigint) => bigint, off: number, n: number): number => {
    let c = 0;
    for (let i = off; i < off + n; i++) {
      let w = BigInt.asUintN(64, f(a[i]!, b[i]!));
      while (w) {
        c += Number(w & 1n);
        w >>= 1n;
      }
    }
    return c;
  };
  for (const [off, n] of [[0, 9], [2, 5], [4, 0], [8, 1]] as const) {
    assert.equal(BitUtil.pop_array(a, off, n), naive((x) => x, off, n));
    assert.equal(BitUtil.pop_intersect(a, b, off, n), naive((x, y) => x & y, off, n));
    assert.equal(BitUtil.pop_union(a, b, off, n), naive((x, y) => x | y, off, n));
    assert.equal(BitUtil.pop_andnot(a, b, off, n), naive((x, y) => x & ~y, off, n));
    assert.equal(BitUtil.pop_xor(a, b, off, n), naive((x, y) => x ^ y, off, n));
  }
});

test("nextHighestPowerOfTwo (int)", () => {
  assert.equal(BitUtil.nextHighestPowerOfTwo(0), 0);
  assert.equal(BitUtil.nextHighestPowerOfTwo(1), 1);
  assert.equal(BitUtil.nextHighestPowerOfTwo(2), 2);
  assert.equal(BitUtil.nextHighestPowerOfTwo(3), 4);
  assert.equal(BitUtil.nextHighestPowerOfTwo(5), 8);
  assert.equal(BitUtil.nextHighestPowerOfTwo(1000), 1024);
  assert.equal(BitUtil.nextHighestPowerOfTwo(1 << 30), 1 << 30);
  // overflows to Integer.MIN_VALUE in Java as well
  assert.equal(BitUtil.nextHighestPowerOfTwo((1 << 30) + 1), Integer.MIN_VALUE);
});

test("nextHighestPowerOfTwo (long)", () => {
  assert.equal(BitUtil.nextHighestPowerOfTwo(0n), 0n);
  assert.equal(BitUtil.nextHighestPowerOfTwo(1n), 1n);
  assert.equal(BitUtil.nextHighestPowerOfTwo(3n), 4n);
  assert.equal(BitUtil.nextHighestPowerOfTwo((1n << 40n) + 1n), 1n << 41n);
  assert.equal(BitUtil.nextHighestPowerOfTwo(1n << 62n), 1n << 62n);
});

test("zigZag encode/decode round trip (int)", () => {
  const rnd = mulberry32(3);
  assert.equal(BitUtil.zigZagEncode(0), 0);
  assert.equal(BitUtil.zigZagEncode(-1), 1);
  assert.equal(BitUtil.zigZagEncode(1), 2);
  assert.equal(BitUtil.zigZagEncode(-2), 3);
  assert.equal(BitUtil.zigZagEncode(Integer.MAX_VALUE), -2);
  assert.equal(BitUtil.zigZagEncode(Integer.MIN_VALUE), -1);
  for (let n = 0; n < 5000; n++) {
    const x = randomInt32(rnd);
    assert.equal(BitUtil.zigZagDecode(BitUtil.zigZagEncode(x)), x);
  }
});

test("zigZag encode/decode round trip (long)", () => {
  const rnd = mulberry32(4);
  assert.equal(BitUtil.zigZagEncode(0n), 0n);
  assert.equal(BitUtil.zigZagEncode(-1n), 1n);
  assert.equal(BitUtil.zigZagEncode(1n), 2n);
  assert.equal(BitUtil.zigZagEncode(Long.MAX_VALUE), -2n);
  assert.equal(BitUtil.zigZagEncode(Long.MIN_VALUE), -1n);
  for (let n = 0; n < 5000; n++) {
    const x = randomInt64(rnd);
    assert.equal(BitUtil.zigZagDecode(BitUtil.zigZagEncode(x)), x);
  }
});
