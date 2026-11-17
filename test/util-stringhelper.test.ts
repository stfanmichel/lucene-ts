import { test } from "node:test";
import assert from "node:assert/strict";
import { BytesRef } from "../src/util/BytesRef.js";
import { StringHelper } from "../src/util/StringHelper.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const hash = (s: string, seed: number): number => {
  const b = enc(s);
  return StringHelper.murmurhash3_x86_32(b, 0, b.length, seed);
};

test("murmurhash3_x86_32 reference vectors (seed 0 and 1)", () => {
  // Published MurmurHash3_x86_32 test vectors
  assert.equal(hash("", 0), 0);
  assert.equal(hash("", 1) >>> 0, 0x514e28b7);
  assert.equal(hash("hello", 0) >>> 0, 0x248bfa47);
  assert.equal(hash("The quick brown fox jumps over the lazy dog", 0) >>> 0, 0x2e4ff723);
});

test("murmurhash3_x86_32 handles every tail length and offsets", () => {
  const data = enc("abcdefghij");
  for (let len = 0; len <= 10; len++) {
    const direct = StringHelper.murmurhash3_x86_32(data, 0, len, 42);
    const padded = new Uint8Array(len + 7);
    padded.set(data.subarray(0, len), 3);
    assert.equal(StringHelper.murmurhash3_x86_32(padded, 3, len, 42), direct, `len=${len}`);
    assert.equal(StringHelper.murmurhash3_x86_32(new BytesRef(padded, 3, len), 42), direct);
  }
});

test("bytesDifference and sortKeyLength", () => {
  const a = new BytesRef("lucene");
  assert.equal(StringHelper.bytesDifference(a, new BytesRef("lucy")), 3);
  assert.equal(StringHelper.bytesDifference(a, new BytesRef("lucene")), 6);
  assert.equal(StringHelper.bytesDifference(a, new BytesRef("lucene!")), 6);
  assert.equal(StringHelper.bytesDifference(a, new BytesRef("")), 0);
  assert.equal(StringHelper.sortKeyLength(new BytesRef("abc"), new BytesRef("abd")), 3);
  assert.equal(StringHelper.sortKeyLength(new BytesRef("abc"), new BytesRef("abcd")), 4);
  assert.equal(StringHelper.sortKeyLength(new BytesRef("abc"), new BytesRef("b")), 1);
  assert.equal(StringHelper.sortKeyLength(new BytesRef(""), new BytesRef("x")), 1);
});

test("startsWith / endsWith", () => {
  const ref = new BytesRef("lucene");
  assert.equal(StringHelper.startsWith(ref, new BytesRef("luc")), true);
  assert.equal(StringHelper.startsWith(ref, new BytesRef("lucene")), true);
  assert.equal(StringHelper.startsWith(ref, new BytesRef("lucene!")), false);
  assert.equal(StringHelper.startsWith(ref, new BytesRef("")), true);
  assert.equal(StringHelper.startsWith(ref, new BytesRef("x")), false);
  assert.equal(StringHelper.startsWith(enc("lucene"), new BytesRef("luc")), true);
  assert.equal(StringHelper.startsWith(enc("lu"), new BytesRef("luc")), false);
  assert.equal(StringHelper.endsWith(ref, new BytesRef("ene")), true);
  assert.equal(StringHelper.endsWith(ref, new BytesRef("lucene")), true);
  assert.equal(StringHelper.endsWith(ref, new BytesRef("xlucene")), false);
  assert.equal(StringHelper.endsWith(ref, new BytesRef("nex")), false);
  // slices with a non-zero offset
  const big = new BytesRef(enc("..lucene.."), 2, 6);
  assert.equal(StringHelper.startsWith(big, new BytesRef("luc")), true);
  assert.equal(StringHelper.endsWith(big, new BytesRef("ene")), true);
});

test("equals is null safe", () => {
  assert.equal(StringHelper.equals(null, null), true);
  assert.equal(StringHelper.equals(null, undefined), true);
  assert.equal(StringHelper.equals(null, ""), false);
  assert.equal(StringHelper.equals("a", null), false);
  assert.equal(StringHelper.equals("a", "a"), true);
  assert.equal(StringHelper.equals("a", "b"), false);
});

test("randomId yields distinct 16 byte ids, sequential mod 2^128", () => {
  const seen = new Set<string>();
  let prev: bigint | undefined;
  for (let i = 0; i < 1000; i++) {
    const id = StringHelper.randomId();
    assert.equal(id.length, StringHelper.ID_LENGTH);
    let n = 0n;
    for (const b of id) n = (n << 8n) | BigInt(b);
    if (prev !== undefined) {
      assert.equal(n, (prev + 1n) & ((1n << 128n) - 1n));
    }
    prev = n;
    seen.add(Buffer.from(id).toString("hex"));
  }
  assert.equal(seen.size, 1000);
});

test("idToString", () => {
  assert.equal(StringHelper.idToString(null), "(null)");
  assert.equal(StringHelper.idToString(undefined), "(null)");
  const id = new Uint8Array(16);
  id[15] = 35;
  assert.equal(StringHelper.idToString(id), "z");
  id[15] = 36;
  assert.equal(StringHelper.idToString(id), "10");
  assert.equal(StringHelper.idToString(new Uint8Array(16)), "0");
  assert.equal(StringHelper.idToString(new Uint8Array([1, 2, 3])), (0x010203).toString(36) + " (INVALID FORMAT)");
  const ff = new Uint8Array(16).fill(255);
  assert.equal(StringHelper.idToString(ff), ((1n << 128n) - 1n).toString(36));
});
