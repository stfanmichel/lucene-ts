import { test } from "node:test";
import assert from "node:assert/strict";
import { ArrayIndexOutOfBoundsException, IllegalArgumentException } from "../src/errors.js";
import { BytesRef } from "../src/util/BytesRef.js";
import { UnicodeUtil, charsToString } from "../src/util/UnicodeUtil.js";
import { mulberry32, randomBelow } from "./helpers.js";

function encode(s: string): Uint8Array {
  const out = new Uint8Array(UnicodeUtil.MAX_UTF8_BYTES_PER_CHAR * s.length);
  const n = UnicodeUtil.UTF16toUTF8(s, 0, s.length, out);
  return out.slice(0, n);
}

function randomValidString(rnd: () => number, maxLen: number): string {
  const len = randomBelow(rnd, maxLen + 1);
  let s = "";
  for (let i = 0; i < len; i++) {
    switch (randomBelow(rnd, 4)) {
      case 0:
        s += String.fromCharCode(randomBelow(rnd, 0x80));
        break;
      case 1:
        s += String.fromCharCode(0x80 + randomBelow(rnd, 0x800 - 0x80));
        break;
      case 2: {
        let c = 0x800 + randomBelow(rnd, 0x10000 - 0x800);
        if (c >= 0xd800 && c <= 0xdfff) c = 0xe000 + (c - 0xd800);
        s += String.fromCharCode(c);
        break;
      }
      default:
        s += String.fromCodePoint(0x10000 + randomBelow(rnd, 0x100000));
    }
  }
  return s;
}

test("UTF16toUTF8 matches the platform UTF-8 encoder on valid strings", () => {
  const rnd = mulberry32(20);
  for (let n = 0; n < 2000; n++) {
    const s = randomValidString(rnd, 40);
    assert.deepEqual(Buffer.from(encode(s)), Buffer.from(s, "utf8"), JSON.stringify(s));
  }
  assert.deepEqual(Array.from(encode("lucene")), [0x6c, 0x75, 0x63, 0x65, 0x6e, 0x65]);
  assert.deepEqual(Array.from(encode("é")), [0xc3, 0xa9]);
  assert.deepEqual(Array.from(encode("€")), [0xe2, 0x82, 0xac]);
  assert.deepEqual(Array.from(encode("😀")), [0xf0, 0x9f, 0x98, 0x80]);
});

test("UTF16toUTF8 replaces unpaired surrogates with U+FFFD", () => {
  const repl = [0xef, 0xbf, 0xbd];
  assert.deepEqual(Array.from(encode("\ud800")), repl);
  assert.deepEqual(Array.from(encode("\udc00")), repl);
  assert.deepEqual(Array.from(encode("a\ud800b")), [0x61, ...repl, 0x62]);
  // out-of-order pair: low then high
  assert.deepEqual(Array.from(encode("\udc00\ud800")), [...repl, ...repl]);
});

test("UTF16toUTF8 accepts a Uint16Array with offset/length", () => {
  const s = "xxhé😀yy";
  const arr = new Uint16Array(s.length);
  for (let i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i);
  const out = new Uint8Array(3 * s.length);
  const n = UnicodeUtil.UTF16toUTF8(arr, 2, 4, out); // "hé😀" = 4 code units
  assert.deepEqual(Buffer.from(out.slice(0, n)), Buffer.from("hé😀", "utf8"));
});

test("UTF8toUTF16 round trips", () => {
  const rnd = mulberry32(21);
  for (let n = 0; n < 2000; n++) {
    const s = randomValidString(rnd, 40);
    const utf8 = encode(s);
    const chars = new Uint16Array(utf8.length);
    const len = UnicodeUtil.UTF8toUTF16(utf8, 0, utf8.length, chars);
    assert.equal(charsToString(chars, 0, len), s);
    // BytesRef overload, with a non-zero offset
    const padded = new Uint8Array(utf8.length + 5);
    padded.set(utf8, 3);
    const ref = new BytesRef(padded, 3, utf8.length);
    const chars2 = new Uint16Array(utf8.length);
    const len2 = UnicodeUtil.UTF8toUTF16(ref, chars2);
    assert.equal(charsToString(chars2, 0, len2), s);
  }
});

test("UTF8toUTF16 throws on a truncated sequence, like Java", () => {
  const chars = new Uint16Array(8);
  // lead byte of a 3-byte sequence with nothing after it
  assert.throws(() => UnicodeUtil.UTF8toUTF16(new Uint8Array([0xe2]), 0, 1, chars), ArrayIndexOutOfBoundsException);
});

test("validUTF16String", () => {
  assert.equal(UnicodeUtil.validUTF16String(""), true);
  assert.equal(UnicodeUtil.validUTF16String("abc😀é"), true);
  assert.equal(UnicodeUtil.validUTF16String("\ud800"), false);
  assert.equal(UnicodeUtil.validUTF16String("\udc00"), false);
  assert.equal(UnicodeUtil.validUTF16String("a\ud800b"), false);
  assert.equal(UnicodeUtil.validUTF16String("\ud800𐀀"), false);
  const arr = new Uint16Array([0x61, 0xd83d, 0xde00, 0xd800]);
  assert.equal(UnicodeUtil.validUTF16String(arr, 3), true);
  assert.equal(UnicodeUtil.validUTF16String(arr, 4), false);
});

test("codePointCount", () => {
  assert.equal(UnicodeUtil.codePointCount(new BytesRef("")), 0);
  assert.equal(UnicodeUtil.codePointCount(new BytesRef("lucene")), 6);
  assert.equal(UnicodeUtil.codePointCount(new BytesRef("aé€😀")), 4);
  // continuation byte as lead byte is invalid
  assert.throws(() => UnicodeUtil.codePointCount(new BytesRef(new Uint8Array([0x80]))), IllegalArgumentException);
  // 5-byte sequences are invalid
  assert.throws(() => UnicodeUtil.codePointCount(new BytesRef(new Uint8Array([0xf8, 0x80, 0x80, 0x80, 0x80]))), IllegalArgumentException);
  // truncated multi-byte sequence
  assert.throws(() => UnicodeUtil.codePointCount(new BytesRef(new Uint8Array([0xe2, 0x82]))), IllegalArgumentException);
});

test("UTF8toUTF32 and newString", () => {
  const s = "aé€😀z";
  const ref = new BytesRef(s);
  const ints = new Int32Array(10);
  const n = UnicodeUtil.UTF8toUTF32(ref, ints);
  assert.deepEqual(Array.from(ints.subarray(0, n)), [0x61, 0xe9, 0x20ac, 0x1f600, 0x7a]);
  assert.equal(UnicodeUtil.newString(ints, 0, n), s);
  assert.equal(UnicodeUtil.newString(ints, 1, 3), "é€😀");
  assert.equal(UnicodeUtil.newString(ints, 2, 0), "");
  assert.throws(() => UnicodeUtil.newString(ints, 0, -1), IllegalArgumentException);
  assert.throws(() => UnicodeUtil.newString(new Int32Array([0x110000]), 0, 1), IllegalArgumentException);
  assert.throws(() => UnicodeUtil.newString(new Int32Array([-1]), 0, 1), IllegalArgumentException);
  assert.throws(() => UnicodeUtil.newString(ints, 8, 5), ArrayIndexOutOfBoundsException);
  // invalid lead bytes
  assert.throws(() => UnicodeUtil.UTF8toUTF32(new BytesRef(new Uint8Array([0x80])), ints), IllegalArgumentException);
  assert.throws(() => UnicodeUtil.UTF8toUTF32(new BytesRef(new Uint8Array([0xf8])), ints), ArrayIndexOutOfBoundsException);
});

test("toHexString", () => {
  assert.equal(UnicodeUtil.toHexString("ab"), "a b");
  assert.equal(UnicodeUtil.toHexString("é"), "0xe9");
  assert.equal(UnicodeUtil.toHexString("𐀀"), "H:0xd800 L:0xdc00");
  assert.equal(UnicodeUtil.toHexString("￿"), "F:0xffff");
  assert.equal(UnicodeUtil.toHexString(""), "E:0xe000");
});

test("BIG_TERM is ten 0xff bytes", () => {
  assert.equal(UnicodeUtil.BIG_TERM.length, 10);
  assert.ok(Array.from(UnicodeUtil.BIG_TERM.bytes).every((b) => b === 0xff));
  assert.equal(UnicodeUtil.BIG_TERM, UnicodeUtil.BIG_TERM);
});
