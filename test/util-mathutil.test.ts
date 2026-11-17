import { test } from "node:test";
import assert from "node:assert/strict";
import { IllegalArgumentException } from "../src/errors.js";
import { MathUtil } from "../src/util/MathUtil.js";
import { Long } from "../src/util/JavaNumbers.js";
import { mulberry32, randomBelow, randomInt64 } from "./helpers.js";

/** Reference GCD (plain Euclid on arbitrary precision integers). */
function refGcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }
  return a;
}

test("log(long, base)", () => {
  assert.equal(MathUtil.log(0, 2), 0);
  assert.equal(MathUtil.log(-5, 2), 0);
  assert.equal(MathUtil.log(1, 2), 0);
  assert.equal(MathUtil.log(2, 2), 1);
  assert.equal(MathUtil.log(7, 2), 2);
  assert.equal(MathUtil.log(8, 2), 3);
  assert.equal(MathUtil.log(999, 10), 2);
  assert.equal(MathUtil.log(1000, 10), 3);
  assert.equal(MathUtil.log(Long.MAX_VALUE, 2), 62);
  assert.equal(MathUtil.log(Long.MAX_VALUE, 10), 18);
  assert.equal(MathUtil.log(Number.MAX_SAFE_INTEGER, 2), 52);
  assert.throws(() => MathUtil.log(10, 1), IllegalArgumentException);
  assert.throws(() => MathUtil.log(10, 0), IllegalArgumentException);
});

test("log(long, base) agrees between number and bigint inputs", () => {
  const rnd = mulberry32(10);
  for (let n = 0; n < 2000; n++) {
    const x = Math.floor(rnd() * Number.MAX_SAFE_INTEGER);
    const base = 2 + randomBelow(rnd, 30);
    assert.equal(MathUtil.log(x, base), MathUtil.log(BigInt(x), base), `x=${x} base=${base}`);
  }
});

test("logDouble(base, x)", () => {
  assert.ok(Math.abs(MathUtil.logDouble(2, 8) - 3) < 1e-12);
  assert.ok(Math.abs(MathUtil.logDouble(10, 1000) - 3) < 1e-12);
});

test("gcd edge cases", () => {
  assert.equal(MathUtil.gcd(0n, 0n), 0n);
  assert.equal(MathUtil.gcd(0n, 5n), 5n);
  assert.equal(MathUtil.gcd(-5n, 0n), 5n);
  assert.equal(MathUtil.gcd(12n, 18n), 6n);
  assert.equal(MathUtil.gcd(-12n, 18n), 6n);
  assert.equal(MathUtil.gcd(17n, 13n), 1n);
  // 2^64 does not fit in a long, so these are the two documented exceptions
  assert.equal(MathUtil.gcd(Long.MIN_VALUE, 0n), Long.MIN_VALUE);
  assert.equal(MathUtil.gcd(0n, Long.MIN_VALUE), Long.MIN_VALUE);
  assert.equal(MathUtil.gcd(Long.MIN_VALUE, Long.MIN_VALUE), Long.MIN_VALUE);
  assert.equal(MathUtil.gcd(Long.MIN_VALUE, 1n << 40n), 1n << 40n);
  assert.equal(MathUtil.gcd(Long.MAX_VALUE, Long.MAX_VALUE), Long.MAX_VALUE);
});

test("gcd agrees with Euclid on random longs", () => {
  const rnd = mulberry32(11);
  for (let n = 0; n < 3000; n++) {
    let a = randomInt64(rnd);
    let b = randomInt64(rnd);
    // make a common factor likely in a good share of the cases
    if (n % 3 === 0) {
      const f = BigInt(1 + randomBelow(rnd, 1 << 20));
      a = BigInt.asIntN(64, a / (1n << 22n)) * f;
      b = BigInt.asIntN(64, b / (1n << 22n)) * f;
    }
    if (a === Long.MIN_VALUE || b === Long.MIN_VALUE) continue;
    assert.equal(MathUtil.gcd(a, b), refGcd(a, b), `a=${a} b=${b}`);
  }
});

test("asinh / acosh / atanh", () => {
  for (const x of [-100, -2.5, -1, -0.1, 0.1, 1, 2.5, 100]) {
    assert.ok(Math.abs(MathUtil.asinh(x) - Math.asinh(x)) < 1e-9, `asinh(${x})`);
  }
  for (const x of [1, 1.5, 10, 1000]) {
    assert.ok(Math.abs(MathUtil.acosh(x) - Math.acosh(x)) < 1e-9, `acosh(${x})`);
  }
  for (const x of [-0.9, -0.5, 0.1, 0.5, 0.9]) {
    assert.ok(Math.abs(MathUtil.atanh(x) - Math.atanh(x)) < 1e-9, `atanh(${x})`);
  }
  // special cases from the javadoc
  assert.ok(Number.isNaN(MathUtil.asinh(NaN)));
  assert.equal(MathUtil.asinh(Infinity), Infinity);
  assert.equal(MathUtil.asinh(-Infinity), -Infinity);
  assert.ok(Object.is(MathUtil.asinh(0), 0));
  assert.ok(Object.is(MathUtil.asinh(-0), -0));
  assert.equal(MathUtil.acosh(1), 0);
  assert.equal(MathUtil.acosh(Infinity), Infinity);
  assert.ok(Number.isNaN(MathUtil.acosh(0.5)));
  assert.ok(Object.is(MathUtil.atanh(0), 0));
  assert.ok(Object.is(MathUtil.atanh(-0), -0));
  assert.equal(MathUtil.atanh(1), Infinity);
  assert.equal(MathUtil.atanh(-1), -Infinity);
  assert.ok(Number.isNaN(MathUtil.atanh(2)));
});
