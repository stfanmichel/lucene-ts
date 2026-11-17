/**
 * Differential tests: every expected value in test/golden/util.json was produced by
 * the ORIGINAL Lucene 5.2.1 Java classes (see tools/golden/generate.sh), so these
 * tests check that the TypeScript port behaves like the Java code, edge cases included.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BitUtil } from "../src/util/BitUtil.js";
import { BytesRef } from "../src/util/BytesRef.js";
import { MathUtil } from "../src/util/MathUtil.js";
import { StringHelper } from "../src/util/StringHelper.js";
import { UnicodeUtil, charsToString } from "../src/util/UnicodeUtil.js";
import { hexToBytes, toHex } from "./helpers.js";

const golden = JSON.parse(readFileSync(new URL("./golden/util.json", import.meta.url), "utf8"));

const longs = (a: string[]): BigInt64Array => BigInt64Array.from(a.map((s) => BigInt(s)));

function bitsToDouble(hex: string): number {
  const b = new DataView(new ArrayBuffer(8));
  b.setBigUint64(0, BigInt("0x" + hex));
  return b.getFloat64(0);
}

test("golden: murmurhash3_x86_32", () => {
  for (const c of golden.murmur) {
    const data = hexToBytes(c.data);
    assert.equal(StringHelper.murmurhash3_x86_32(data, c.offset, c.len, c.seed), c.hash, JSON.stringify(c));
  }
});

test("golden: zigZag (int)", () => {
  for (const [v, enc, dec] of golden.zigzagInt as number[][]) {
    assert.equal(BitUtil.zigZagEncode(v!), enc, `encode ${v}`);
    assert.equal(BitUtil.zigZagDecode(v!), dec, `decode ${v}`);
  }
});

test("golden: zigZag (long)", () => {
  for (const [v, enc, dec] of golden.zigzagLong as string[][]) {
    assert.equal(BitUtil.zigZagEncode(BigInt(v!)), BigInt(enc!), `encode ${v}`);
    assert.equal(BitUtil.zigZagDecode(BigInt(v!)), BigInt(dec!), `decode ${v}`);
  }
});

test("golden: nextHighestPowerOfTwo", () => {
  for (const [v, out] of golden.nhpotInt as number[][]) {
    assert.equal(BitUtil.nextHighestPowerOfTwo(v!), out, `int ${v}`);
  }
  for (const [v, out] of golden.nhpotLong as string[][]) {
    assert.equal(BitUtil.nextHighestPowerOfTwo(BigInt(v!)), BigInt(out!), `long ${v}`);
  }
});

test("golden: gcd", () => {
  for (const [a, b, g] of golden.gcd as string[][]) {
    assert.equal(MathUtil.gcd(BigInt(a!), BigInt(b!)), BigInt(g!), `gcd(${a}, ${b})`);
  }
});

test("golden: log", () => {
  for (const [x, base, out] of golden.log as [string, number, number][]) {
    assert.equal(MathUtil.log(BigInt(x), base), out, `log(${x}, ${base})`);
  }
});

test("golden: asinh / acosh / atanh", () => {
  const same = (actual: number, expectedBits: string, what: string): void => {
    const expected = bitsToDouble(expectedBits);
    if (Number.isNaN(expected)) {
      assert.ok(Number.isNaN(actual), `${what}: expected NaN, got ${actual}`);
    } else if (expected === 0 || !Number.isFinite(expected)) {
      assert.ok(Object.is(actual, expected), `${what}: expected ${expected}, got ${actual}`);
    } else {
      // Java and V8 may differ by an ulp in Math.log
      assert.ok(Math.abs(actual - expected) <= 1e-12 * Math.abs(expected), `${what}: expected ${expected}, got ${actual}`);
    }
  };
  for (const [x, as, ac, at] of golden.hyper as string[][]) {
    const d = bitsToDouble(x!);
    same(MathUtil.asinh(d), as!, `asinh(${d})`);
    same(MathUtil.acosh(d), ac!, `acosh(${d})`);
    same(MathUtil.atanh(d), at!, `atanh(${d})`);
  }
});

test("golden: bitCount / bitList tables", () => {
  for (let b = 0; b < 256; b++) {
    assert.equal(BitUtil.bitCount(b), golden.bitTables.bitCount[b], `bitCount(${b})`);
    assert.equal(BitUtil.bitList(b), golden.bitTables.bitList[b], `bitList(${b})`);
  }
});

test("golden: pop_* population counts", () => {
  for (const c of golden.pop) {
    const a = longs(c.a);
    const b = longs(c.b);
    assert.equal(BitUtil.pop_array(a, c.offset, c.n), c.array);
    assert.equal(BitUtil.pop_intersect(a, b, c.offset, c.n), c.intersect);
    assert.equal(BitUtil.pop_union(a, b, c.offset, c.n), c.union);
    assert.equal(BitUtil.pop_andnot(a, b, c.offset, c.n), c.andnot);
    assert.equal(BitUtil.pop_xor(a, b, c.offset, c.n), c.xor);
  }
});

test("golden: UTF16toUTF8 (including unpaired surrogates)", () => {
  for (const c of golden.utf16toutf8) {
    const units = Uint16Array.from(c.units as number[]);
    const out = new Uint8Array(3 * units.length + 1);
    const n = UnicodeUtil.UTF16toUTF8(units, 0, units.length, out);
    assert.equal(toHex(out.subarray(0, n)), c.bytes, JSON.stringify(c.units));

    const s = charsToString(units, 0, units.length);
    const out2 = new Uint8Array(3 * s.length + 1);
    const n2 = UnicodeUtil.UTF16toUTF8(s, 0, s.length, out2);
    assert.equal(toHex(out2.subarray(0, n2)), c.bytes, `string variant ${JSON.stringify(c.units)}`);

    assert.equal(UnicodeUtil.validUTF16String(units, units.length), c.valid);
    assert.equal(UnicodeUtil.validUTF16String(s), c.valid);
  }
});

test("golden: UTF8toUTF16 / UTF8toUTF32 / codePointCount / newString", () => {
  for (const c of golden.utf8decode) {
    const utf8 = hexToBytes(c.bytes);
    const ref = new BytesRef(utf8);

    const u16 = new Uint16Array(utf8.length);
    const n16 = UnicodeUtil.UTF8toUTF16(utf8, 0, utf8.length, u16);
    assert.deepEqual(Array.from(u16.subarray(0, n16)), c.units, c.bytes);

    const u32 = new Int32Array(utf8.length);
    const n32 = UnicodeUtil.UTF8toUTF32(ref, u32);
    assert.deepEqual(Array.from(u32.subarray(0, n32)), c.cps, c.bytes);

    assert.equal(UnicodeUtil.codePointCount(ref), c.codePointCount, c.bytes);

    const s = UnicodeUtil.newString(u32, 0, n32);
    // (not Array.from(s): that iterates by code point, not by UTF-16 code unit)
    const units = Array.from({ length: s.length }, (_, i) => s.charCodeAt(i));
    assert.deepEqual(units, c.newString, c.bytes);
  }
});

test("golden: BytesRef ordering and StringHelper slice helpers", () => {
  const utf16 = BytesRef.getUTF8SortedAsUTF16Comparator();
  for (const c of golden.compare) {
    const a = new BytesRef(hexToBytes(c.a));
    const b = new BytesRef(hexToBytes(c.b));
    const what = `${c.a} vs ${c.b}`;
    assert.equal(a.compareTo(b), c.cmp, `compareTo ${what}`);
    assert.equal(utf16(a, b), c.cmp16, `UTF16 comparator ${what}`);
    assert.equal(StringHelper.bytesDifference(a, b), c.diff, `bytesDifference ${what}`);
    assert.equal(StringHelper.sortKeyLength(a, b), c.sortKey, `sortKeyLength ${what}`);
    assert.equal(StringHelper.startsWith(a, b), c.startsWith, `startsWith ${what}`);
    assert.equal(StringHelper.endsWith(a, b), c.endsWith, `endsWith ${what}`);
    assert.equal(a.equals(b), c.equals, `equals ${what}`);
  }
});
