import { test } from "node:test";
import assert from "node:assert/strict";
import { IllegalStateException } from "../src/errors.js";
import { BytesRef } from "../src/util/BytesRef.js";
import { StringHelper } from "../src/util/StringHelper.js";
import { mulberry32, randomBelow, randomBytes } from "./helpers.js";

test("constructors", () => {
  const empty = new BytesRef();
  assert.equal(empty.bytes, BytesRef.EMPTY_BYTES);
  assert.equal(empty.offset, 0);
  assert.equal(empty.length, 0);

  const bytes = new Uint8Array([1, 2, 3, 4]);
  const whole = new BytesRef(bytes);
  assert.equal(whole.bytes, bytes); // no copy
  assert.equal(whole.length, 4);

  const slice = new BytesRef(bytes, 1, 2);
  assert.equal(slice.offset, 1);
  assert.equal(slice.length, 2);

  const cap = new BytesRef(16);
  assert.equal(cap.bytes.length, 16);
  assert.equal(cap.offset, 0);
  assert.equal(cap.length, 0);

  const text = new BytesRef("lucène");
  assert.equal(text.length, 7); // è takes two bytes
  assert.equal(text.utf8ToString(), "lucène");
});

test("toString prints hex bytes", () => {
  assert.equal(new BytesRef("lucene").toString(), "[6c 75 63 65 6e 65]");
  assert.equal(new BytesRef().toString(), "[]");
  assert.equal(new BytesRef(new Uint8Array([0, 1, 0xff])).toString(), "[0 1 ff]");
  assert.equal(new BytesRef(new Uint8Array([9, 0xab, 0xcd, 7]), 1, 2).toString(), "[ab cd]");
});

test("utf8ToString keeps unpaired surrogates produced by 3-byte sequences", () => {
  // Lucene would decode the CESU-8 style bytes for U+D800 as the char 0xD800
  const ref = new BytesRef(new Uint8Array([0xed, 0xa0, 0x80]));
  assert.equal(ref.utf8ToString(), "\ud800");
});

test("equals / bytesEquals / hashCode ignore the backing array layout", () => {
  const a = new BytesRef("lucene");
  const b = new BytesRef(new TextEncoder().encode("xxlucenexx"), 2, 6);
  assert.equal(a.equals(b), true);
  assert.equal(a.bytesEquals(b), true);
  assert.equal(a.hashCode(), b.hashCode());
  assert.equal(a.equals(new BytesRef("lucenf")), false);
  assert.equal(a.equals(new BytesRef("lucen")), false);
  assert.equal(a.equals(null), false);
  assert.equal(a.equals("lucene"), false);
  assert.equal(a.hashCode(), StringHelper.murmurhash3_x86_32(a.bytes, 0, 6, StringHelper.GOOD_FAST_HASH_SEED));
});

test("compareTo uses unsigned byte order", () => {
  const lo = new BytesRef(new Uint8Array([0x01]));
  const hi = new BytesRef(new Uint8Array([0xff])); // would be negative if bytes were signed
  assert.ok(lo.compareTo(hi) < 0);
  assert.ok(hi.compareTo(lo) > 0);
  assert.equal(lo.compareTo(new BytesRef(new Uint8Array([0x01]))), 0);
  // prefix sorts first, difference is the length delta
  assert.equal(new BytesRef("ab").compareTo(new BytesRef("abcd")), -2);
  assert.equal(new BytesRef("abcd").compareTo(new BytesRef("ab")), 2);
  // difference of first mismatching bytes
  assert.equal(new BytesRef("b").compareTo(new BytesRef("a")), 1);
  assert.equal(BytesRef.getUTF8SortedAsUnicodeComparator()(lo, hi), lo.compareTo(hi));
});

test("compareTo agrees with Buffer.compare on random data", () => {
  const rnd = mulberry32(30);
  for (let n = 0; n < 2000; n++) {
    const a = randomBytes(rnd, randomBelow(rnd, 8));
    const b = randomBytes(rnd, randomBelow(rnd, 8));
    const expected = Math.sign(Buffer.compare(Buffer.from(a), Buffer.from(b)));
    assert.equal(Math.sign(new BytesRef(a).compareTo(new BytesRef(b))), expected);
  }
});

test("UTF16 order comparator differs from unicode order for supplementary characters", () => {
  const utf16 = BytesRef.getUTF8SortedAsUTF16Comparator();
  const supplementary = new BytesRef("\u{10000}"); // surrogates D800 DC00, sorts below U+E000 in UTF-16
  const bmpHigh = new BytesRef("");
  assert.ok(supplementary.compareTo(bmpHigh) > 0); // code point order
  assert.ok(utf16(supplementary, bmpHigh) < 0); // UTF-16 order
  assert.equal(utf16(new BytesRef("abc"), new BytesRef("abd")) < 0, true);
  assert.equal(utf16(new BytesRef("ab"), new BytesRef("abcd")), -2);
});

test("clone is shallow, deepCopyOf copies", () => {
  const bytes = new TextEncoder().encode("..lucene..");
  const ref = new BytesRef(bytes, 2, 6);

  const shallow = ref.clone();
  assert.equal(shallow.bytes, ref.bytes);
  assert.equal(shallow.offset, 2);
  assert.equal(shallow.length, 6);

  const deep = BytesRef.deepCopyOf(ref);
  assert.notEqual(deep.bytes, ref.bytes);
  assert.equal(deep.offset, 0);
  assert.equal(deep.length, 6);
  assert.equal(deep.bytes.length, 6);
  assert.equal(deep.utf8ToString(), "lucene");

  bytes[2] = 0x58; // mutate the original: shallow sees it, deep does not
  assert.equal(shallow.utf8ToString(), "Xucene");
  assert.equal(deep.utf8ToString(), "lucene");
});

test("isValid rejects inconsistent slices", () => {
  const bytes = new Uint8Array(4);
  const ref = new BytesRef(bytes, 1, 2);
  assert.equal(ref.isValid(), true);

  ref.length = -1;
  assert.throws(() => ref.isValid(), IllegalStateException);
  ref.length = 5;
  assert.throws(() => ref.isValid(), IllegalStateException);
  ref.length = 2;
  ref.offset = -1;
  assert.throws(() => ref.isValid(), IllegalStateException);
  ref.offset = 5;
  assert.throws(() => ref.isValid(), IllegalStateException);
  ref.offset = 3;
  ref.length = 2;
  assert.throws(() => ref.isValid(), IllegalStateException);

  // the constructors assert validity
  assert.throws(() => new BytesRef(bytes, 3, 2), /./);
});
