/**
 * Differential tests for ArrayUtil, IntsRef, LongsRef, CharsRef, the three *RefBuilder classes,
 * StringHelper.intsRefToBytesRef and Character.digit. Every expected value in
 * test/golden/util-refs.json was produced by the ORIGINAL Lucene 5.2.1 / JDK classes
 * (tools/golden/GoldenRefs.java, run by tools/golden/generate.sh).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ArrayUtil } from "../src/util/ArrayUtil.js";
import { BytesRef } from "../src/util/BytesRef.js";
import { BytesRefBuilder } from "../src/util/BytesRefBuilder.js";
import { CharsRef } from "../src/util/CharsRef.js";
import { CharsRefBuilder } from "../src/util/CharsRefBuilder.js";
import { IntsRef } from "../src/util/IntsRef.js";
import { IntsRefBuilder } from "../src/util/IntsRefBuilder.js";
import { Character } from "../src/util/JavaNumbers.js";
import { LongsRef } from "../src/util/LongsRef.js";
import { StringHelper } from "../src/util/StringHelper.js";
import { hexToBytes, toHex } from "./helpers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const golden: any = JSON.parse(readFileSync(new URL("./golden/util-refs.json", import.meta.url), "utf8"));

const u16 = (a: number[]): Uint16Array => Uint16Array.from(a);
const i32 = (a: number[]): Int32Array => Int32Array.from(a);
const i64 = (a: string[]): BigInt64Array => BigInt64Array.from(a.map((s) => BigInt(s)));
const codesToString = (a: number[]): string => String.fromCharCode(...a);
const stringToCodes = (s: string): number[] => Array.from({ length: s.length }, (_, i) => s.charCodeAt(i));
const toCodes = (a: Uint16Array): number[] => Array.from(a);

/** Golden results are either a plain value or "EX:ClassName:message" for an exception. */
function expectResult(fn: () => unknown, expected: unknown, ctx: string): void {
  if (typeof expected === "string" && expected.startsWith("EX:")) {
    const [, cls, ...rest] = expected.split(":");
    const msg = rest.join(":");
    assert.throws(
      fn,
      (e: unknown) => {
        assert.ok(e instanceof Error, `${ctx}: not an Error`);
        assert.equal(e.name, cls, `${ctx}: exception class`);
        // the JDK's message for array bounds errors is version specific
        if (cls !== "ArrayIndexOutOfBoundsException") {
          assert.equal(e.message, msg, `${ctx}: exception message`);
        }
        return true;
      },
      ctx,
    );
  } else {
    assert.equal(fn(), expected, ctx);
  }
}

test("golden: ArrayUtil.MAX_ARRAY_LENGTH", () => {
  assert.equal(ArrayUtil.MAX_ARRAY_LENGTH, golden.maxArrayLength);
});

test("golden: ArrayUtil.oversize", () => {
  for (const [min, bpe, res] of golden.oversize) {
    expectResult(() => ArrayUtil.oversize(min, bpe), res, `oversize(${min}, ${bpe})`);
  }
});

test("golden: ArrayUtil.getShrinkSize (integer division, not float)", () => {
  for (const [cur, target, bpe, res] of golden.shrinkSize) {
    assert.equal(ArrayUtil.getShrinkSize(cur, target, bpe), res, `getShrinkSize(${cur}, ${target}, ${bpe})`);
  }
});

function makeArray(kind: string, len: number): any {
  switch (kind) {
    case "byte": return Uint8Array.from({ length: len }, (_, i) => (i * 7 + 1) & 0xff);
    case "char": return Uint16Array.from({ length: len }, (_, i) => (i * 131 + 1) & 0xffff);
    case "short": return Int16Array.from({ length: len }, (_, i) => i * 3 - 5);
    case "int": return Int32Array.from({ length: len }, (_, i) => i * 1000003 - 7);
    case "long": return BigInt64Array.from({ length: len }, (_, i) => BigInt(i) * 4000000007n - 9n);
    case "float": return Float32Array.from({ length: len }, (_, i) => i + 0.5);
    case "double": return Float64Array.from({ length: len }, (_, i) => i + 0.25);
    case "boolean": return Array.from({ length: len }, (_, i) => i % 3 === 0);
    default: return Array.from({ length: len }, (_, i) => (i % 2 === 0 ? Int32Array.of(i) : null)); // int[][] / float[][]
  }
}

function growBy(kind: string, a: any, min?: number): any {
  if (kind === "boolean") return ArrayUtil.growBoolean(a, min);
  if (kind === "intRefs" || kind === "floatRefs") return ArrayUtil.growRefs(a, min);
  return ArrayUtil.grow(a, min);
}

function shrinkBy(kind: string, a: any, target: number): any {
  if (kind === "boolean") return ArrayUtil.shrinkBoolean(a, target);
  if (kind === "intRefs" || kind === "floatRefs") return ArrayUtil.shrinkRefs(a, target);
  return ArrayUtil.shrink(a, target);
}

test("golden: ArrayUtil.grow / shrink for every array type (sizes, contents kept)", () => {
  for (const c of golden.growShrink) {
    const ctx = JSON.stringify(c);
    const src = makeArray(c.kind, c.len);

    const grown = growBy(c.kind, src, c.min);
    assert.equal(grown.length, c.grow, `grow ${ctx}`);
    assert.deepEqual(Array.from(grown as ArrayLike<unknown>).slice(0, c.len), Array.from(src as ArrayLike<unknown>), `grow keeps contents ${ctx}`);
    if (c.min <= c.len) assert.equal(grown, src, `grow returns the same array when large enough ${ctx}`);

    assert.equal(growBy(c.kind, src).length, c.growOne, `grow(array) ${ctx}`);

    if (c.shrink >= 0) {
      const shrunk = shrinkBy(c.kind, src, c.target);
      assert.equal(shrunk.length, c.shrink, `shrink ${ctx}`);
      assert.deepEqual(
        Array.from(shrunk as ArrayLike<unknown>),
        Array.from(src as ArrayLike<unknown>).slice(0, c.shrink),
        `shrink keeps contents ${ctx}`,
      );
    }
  }
});

test("golden: ArrayUtil.hashCode (bytes are signed in Java)", () => {
  for (const c of golden.arrayHash) {
    const arr = c.kind === "byte" ? hexToBytes(c.data) : u16(c.data);
    assert.equal(ArrayUtil.hashCode(arr, c.start, c.end), c.hash, JSON.stringify(c));
  }
});

test("golden: ArrayUtil.equals", () => {
  for (const c of golden.arrayEquals) {
    const [a, b]: any[] =
      c.kind === "byte" ? [hexToBytes(c.a), hexToBytes(c.b)] : c.kind === "char" ? [u16(c.a), u16(c.b)] : [i32(c.a), i32(c.b)];
    assert.equal(ArrayUtil.equals(a, c.offL, b, c.offR, c.len), c.eq, JSON.stringify(c));
  }
});

test("golden: Character.digit agrees with the JDK on every BMP char", () => {
  for (const [radix, entries] of Object.entries<number[][]>(golden.digit)) {
    const expected = new Map<number, number>(entries.map(([ch, d]) => [ch!, d!]));
    for (let ch = 0; ch < 65536; ch++) {
      const want = expected.get(ch) ?? -1;
      const got = Character.digit(ch, Number(radix));
      if (got !== want) assert.fail(`digit(U+${ch.toString(16)}, ${radix}): expected ${want}, got ${got}`);
    }
  }
});

test("golden: ArrayUtil.parseInt (offset/len/radix, overflow, exceptions)", () => {
  for (const c of golden.parseInt) {
    const chars = u16(c.chars);
    expectResult(() => ArrayUtil.parseInt(chars, c.offset, c.len, c.radix), c.result, JSON.stringify(c));
  }
});

test("golden: ArrayUtil.parseInt(chars) on a whole array", () => {
  for (const c of golden.parseIntWhole) {
    expectResult(() => ArrayUtil.parseInt(u16(c.chars)), c.result, JSON.stringify(c));
  }
});

test("golden: IntsRef", () => {
  for (const c of golden.intsRef) {
    const x = new IntsRef(i32(c.a), c.offA, c.lenA);
    const y = new IntsRef(i32(c.b), c.offB, c.lenB);
    assert.equal(x.hashCode(), c.hashA, "hashCode");
    assert.equal(x.toString(), c.strA, "toString");
    assert.equal(x.compareTo(y), c.cmp, "compareTo");
    assert.equal(x.equals(y), c.eq, "equals");
    assert.deepEqual(Array.from(IntsRef.deepCopyOf(x).ints), c.deepA, "deepCopyOf");
    assert.equal(x.clone().ints, x.ints, "clone is shallow");
  }
});

test("golden: LongsRef", () => {
  for (const c of golden.longsRef) {
    const x = new LongsRef(i64(c.a), c.offA, c.lenA);
    const y = new LongsRef(i64(c.b), c.offB, c.lenB);
    assert.equal(x.hashCode(), c.hashA, "hashCode");
    assert.equal(x.toString(), c.strA, "toString");
    assert.equal(x.compareTo(y), c.cmp, "compareTo");
    assert.equal(x.equals(y), c.eq, "equals");
    assert.deepEqual(Array.from(LongsRef.deepCopyOf(x).longs, String), c.deepA, "deepCopyOf");
  }
});

test("golden: CharsRef (incl. the UTF16-sorted-as-UTF8 comparator)", () => {
  for (const c of golden.charsRef) {
    const x = new CharsRef(u16(c.a), c.offA, c.lenA);
    const y = new CharsRef(u16(c.b), c.offB, c.lenB);
    assert.equal(x.hashCode(), c.hashA, "hashCode");
    assert.deepEqual(stringToCodes(x.toString()), c.strA, "toString");
    assert.equal(x.compareTo(y), c.cmp, "compareTo");
    assert.equal(x.equals(y), c.eq, "equals");
    assert.equal(CharsRef.getUTF16SortedAsUTF8Comparator()(x, y), c.cmp8, "UTF16SortedAsUTF8");
    assert.deepEqual(toCodes(CharsRef.deepCopyOf(x).chars), c.deepA, "deepCopyOf");
    assert.deepEqual(stringToCodes(x.subSequence(c.sub0, c.sub1).toString()), c.sub, "subSequence");
    if (c.lenA > 0) assert.equal(x.charAt(0), c.charAt0, "charAt");
  }
});

test("CharsRef: charAt / subSequence reject out-of-range indexes", () => {
  const r = new CharsRef("abc");
  assert.throws(() => r.charAt(3), { name: "IndexOutOfBoundsException" });
  assert.throws(() => r.charAt(-1), { name: "IndexOutOfBoundsException" });
  assert.throws(() => r.subSequence(2, 1), { name: "IndexOutOfBoundsException" });
  assert.throws(() => r.subSequence(0, 4), { name: "IndexOutOfBoundsException" });
});

test("golden: StringHelper.intsRefToBytesRef", () => {
  for (const c of golden.intsRefToBytesRef) {
    expectResult(
      () => {
        const br = StringHelper.intsRefToBytesRef(new IntsRef(i32(c.ints), c.off, c.len));
        return toHex(br.bytes.subarray(br.offset, br.offset + br.length));
      },
      c.result,
      JSON.stringify(c),
    );
  }
});

test("golden: BytesRefBuilder (state after every operation, incl. capacity growth)", () => {
  for (const program of golden.bytesBuilder) {
    const b = new BytesRefBuilder();
    for (const step of program) {
      const [name, ...a] = step.op as [string, ...any[]];
      switch (name) {
        case "appendByte": b.append(a[0]); break;
        case "appendBytes": b.append(hexToBytes(a[0]), a[1], a[2]); break;
        case "appendRef": b.append(new BytesRef(hexToBytes(a[0]), a[1], a[2])); break;
        case "copyBytes": b.copyBytes(hexToBytes(a[0]), a[1], a[2]); break;
        case "copyBytesRef": b.copyBytes(new BytesRef(hexToBytes(a[0]), a[1], a[2])); break;
        case "copyCharsStr": b.copyChars(codesToString(a[0])); break;
        case "copyCharsArr": b.copyChars(u16(a[0]), a[1], a[2]); break;
        case "copyCharsRef": b.copyChars(new CharsRef(u16(a[0]), a[1], a[2]), a[3], a[4]); break;
        case "clear": b.clear(); break;
        case "setLength": b.setLength(a[0]); break;
        case "grow": b.grow(a[0]); break;
        case "setByteAt": b.setByteAt(a[0], a[1]); break;
        case "toBytesRef": {
          const t = b.toBytesRef();
          assert.equal(toHex(t.bytes.subarray(t.offset, t.offset + t.length)), a[0], "toBytesRef");
          break;
        }
        default: assert.fail("unknown op " + name);
      }
      const ctx = JSON.stringify(step.op);
      assert.equal(b.length(), step.len, `length after ${ctx}`);
      assert.equal(b.bytes().length, step.cap, `capacity after ${ctx}`);
      assert.equal(toHex(b.bytes().subarray(0, b.length())), step.bytes, `content after ${ctx}`);
    }
  }
});

test("golden: CharsRefBuilder (state after every operation, incl. capacity growth)", () => {
  for (const program of golden.charsBuilder) {
    const b = new CharsRefBuilder();
    for (const step of program) {
      const [name, ...a] = step.op as [string, ...any[]];
      switch (name) {
        case "appendChar": b.append(a[0]); break;
        case "appendStr": b.append(codesToString(a[0]), a[1], a[2]); break;
        case "appendStrFull": b.append(codesToString(a[0])); break;
        case "appendRef": b.append(new CharsRef(u16(a[0]), a[1], a[2]), a[3], a[4]); break;
        case "appendNull": b.append(null); break;
        case "appendChars": b.append(u16(a[0]), a[1], a[2]); break;
        case "copyChars": b.copyChars(u16(a[0]), a[1], a[2]); break;
        case "copyCharsRef": b.copyChars(new CharsRef(u16(a[0]), a[1], a[2])); break;
        case "copyUTF8": b.copyUTF8Bytes(new BytesRef(hexToBytes(a[0]))); break;
        case "copyUTF8Arr": b.copyUTF8Bytes(hexToBytes(a[0]), a[1], a[2]); break;
        case "clear": b.clear(); break;
        case "setLength": b.setLength(a[0]); break;
        case "grow": b.grow(a[0]); break;
        case "toCharsRef": {
          const t = b.toCharsRef();
          assert.deepEqual(toCodes(t.chars.subarray(t.offset, t.offset + t.length)), a[0], "toCharsRef");
          break;
        }
        default: assert.fail("unknown op " + name);
      }
      const ctx = JSON.stringify(step.op);
      assert.equal(b.length(), step.len, `length after ${ctx}`);
      assert.equal(b.chars().length, step.cap, `capacity after ${ctx}`);
      assert.deepEqual(toCodes(b.chars().subarray(0, b.length())), step.chars, `content after ${ctx}`);
      assert.deepEqual(stringToCodes(b.toString()), step.str, `toString after ${ctx}`);
    }
  }
});

test("golden: IntsRefBuilder (state after every operation, incl. capacity growth)", () => {
  for (const program of golden.intsBuilder) {
    const b = new IntsRefBuilder();
    for (const step of program) {
      const [name, ...a] = step.op as [string, ...any[]];
      switch (name) {
        case "append": b.append(a[0]); break;
        case "copyInts": b.copyInts(i32(a[0]), a[1], a[2]); break;
        case "copyIntsRef": b.copyInts(new IntsRef(i32(a[0]), a[1], a[2])); break;
        case "copyUTF8": b.copyUTF8Bytes(new BytesRef(hexToBytes(a[0]))); break;
        case "clear": b.clear(); break;
        case "setLength": b.setLength(a[0]); break;
        case "grow": b.grow(a[0]); break;
        case "setIntAt": b.setIntAt(a[0], a[1]); break;
        case "toIntsRef": {
          const t = b.toIntsRef();
          assert.deepEqual(Array.from(t.ints.subarray(t.offset, t.offset + t.length)), a[0], "toIntsRef");
          break;
        }
        default: assert.fail("unknown op " + name);
      }
      const ctx = JSON.stringify(step.op);
      assert.equal(b.length(), step.len, `length after ${ctx}`);
      assert.equal(b.ints().length, step.cap, `capacity after ${ctx}`);
      assert.deepEqual(Array.from(b.ints().subarray(0, b.length())), step.ints, `content after ${ctx}`);
    }
  }
});

test("builders: equals/hashCode are unsupported, as in Java", () => {
  for (const b of [new BytesRefBuilder(), new CharsRefBuilder(), new IntsRefBuilder()]) {
    assert.throws(() => b.hashCode(), { name: "UnsupportedOperationException" });
    assert.throws(() => b.equals(b), { name: "UnsupportedOperationException" });
  }
});
