/**
 * Behavioural tests of the store data-IO classes and the java.io shims that are not covered by the golden file:
 * assertions, reset/rewind/offsets, clone, chunked streams, stream plumbing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ByteArrayInputStream } from "../src/io/ByteArrayInputStream.js";
import { ByteArrayOutputStream } from "../src/io/ByteArrayOutputStream.js";
import type { InputStream } from "../src/io/InputStream.js";
import { ASSERTIONS_ENABLED } from "../src/util/assertions.js";
import { ByteArrayDataInput } from "../src/store/ByteArrayDataInput.js";
import { ByteArrayDataOutput } from "../src/store/ByteArrayDataOutput.js";
import { DataInput } from "../src/store/DataInput.js";
import { InputStreamDataInput } from "../src/store/InputStreamDataInput.js";
import { OutputStreamDataOutput } from "../src/store/OutputStreamDataOutput.js";
import { AlreadyClosedException } from "../src/store/AlreadyClosedException.js";
import { EOFException, IllegalStateException, IOException } from "../src/errors.js";
import { javaHashOrder, compareJavaStrings } from "../src/util/JavaCollections.js";
import { mulberry32, randomBytes } from "./helpers.js";

test("ByteArrayDataInput: constructors, reset with offset, rewind, position, eof, length", () => {
  const data = Uint8Array.from([9, 1, 2, 3, 4, 5, 6]);
  const a = new ByteArrayDataInput(data, 1, 4); // bytes 1..4
  assert.equal(a.getPosition(), 1);
  assert.equal(a.length(), 5, "length() is the limit (offset + len), as in Java");
  assert.equal(a.readByte(), 1);
  assert.equal(a.eof(), false);
  a.skipBytes(3);
  assert.ok(a.eof());
  a.rewind(); // goes to 0, not to the offset
  assert.equal(a.getPosition(), 0);
  assert.equal(a.readByte(), 9);
  a.setPosition(2);
  assert.equal(a.readByte(), 2);
  a.reset(data);
  assert.equal(a.length(), 7);
  assert.equal(a.getPosition(), 0);
  const empty = new ByteArrayDataInput();
  assert.ok(empty.eof());
  assert.equal(empty.length(), 0);
  assert.throws(() => empty.readByte(), (e: Error) => e.name === "ArrayIndexOutOfBoundsException");
});

test("ByteArrayDataInput ignores its limit when reading (WARNING: omits all low-level checks)", () => {
  const a = new ByteArrayDataInput(Uint8Array.from([1, 2, 3, 4]), 0, 2);
  assert.equal(a.readInt(), 0x01020304);
  assert.equal(a.getPosition(), 4);
});

test("ByteArrayDataInput.readBytes copies into the destination at an offset", () => {
  const a = new ByteArrayDataInput(Uint8Array.from([1, 2, 3, 4, 5]));
  a.readByte();
  const dst = new Uint8Array(6);
  a.readBytes(dst, 2, 3);
  assert.deepEqual([...dst], [0, 0, 2, 3, 4, 0]);
  assert.equal(a.getPosition(), 4);
  assert.throws(() => a.readBytes(dst, 5, 2), (e: Error) => e.name === "ArrayIndexOutOfBoundsException");
  assert.equal(a.getPosition(), 4, "a failed arraycopy does not move the position");
});

test("ByteArrayDataOutput: offsets, reset, position, byte wrap-around", () => {
  const buf = new Uint8Array(8);
  const o = new ByteArrayDataOutput(buf, 2, 4);
  assert.equal(o.getPosition(), 2);
  o.writeByte(-1);
  o.writeByte(256 + 7);
  o.writeBytes(Uint8Array.from([5, 6, 7]), 1, 2);
  assert.deepEqual([...buf], [0, 0, 255, 7, 6, 7, 0, 0]);
  assert.equal(o.getPosition(), 6);
  o.reset(buf);
  assert.equal(o.getPosition(), 0);
  new ByteArrayDataOutput().reset(buf, 1, 1);
});

test("ByteArrayDataOutput: writing past the limit trips Lucene's assertion", { skip: !ASSERTIONS_ENABLED }, () => {
  const o = new ByteArrayDataOutput(new Uint8Array(4), 0, 2);
  o.writeShort(1);
  assert.throws(() => o.writeByte(1), (e: Error) => e.name === "AssertionError");
  assert.throws(() => o.writeBytes(new Uint8Array(1), 0, 1), (e: Error) => e.name === "AssertionError");
});

test("ByteArrayDataOutput: without the limit assertion, the array bound is still enforced", { skip: ASSERTIONS_ENABLED }, () => {
  const o = new ByteArrayDataOutput(new Uint8Array(2));
  o.writeShort(1);
  assert.throws(() => o.writeByte(1), (e: Error) => e.name === "ArrayIndexOutOfBoundsException");
});

test("DataInput.clone is a shallow copy positioned like the original", () => {
  const a = new ByteArrayDataInput(Uint8Array.from([1, 2, 3, 4]));
  a.readByte();
  const c = a.clone();
  assert.ok(c instanceof ByteArrayDataInput);
  assert.notEqual(c, a);
  assert.equal(c.readByte(), 2);
  assert.equal(a.readByte(), 2, "the original keeps its own position");
  assert.equal(a.getPosition(), 2);
});

test("InputStreamDataInput.readBytes loops over short reads and reports EOF on partial data", () => {
  const data = randomBytes(mulberry32(1), 100);
  let calls = 0;
  const chunky: InputStream = {
    pos: 0,
    read(b?: Uint8Array, off?: number, len?: number): number {
      const self = this as unknown as { pos: number };
      calls++;
      if (b === undefined) return self.pos < data.length ? data[self.pos++] : -1;
      if (self.pos >= data.length) return -1;
      const n = Math.min(3, len!, data.length - self.pos); // at most 3 bytes per call
      b.set(data.subarray(self.pos, self.pos + n), off!);
      self.pos += n;
      return n;
    },
    close(): void {},
  } as InputStream;
  const inp = new InputStreamDataInput(chunky);
  const dst = new Uint8Array(100);
  inp.readBytes(dst, 0, 100);
  assert.deepEqual(dst, data);
  assert.equal(calls, 34);
  assert.throws(() => inp.readBytes(new Uint8Array(1), 0, 1), EOFException);
  assert.throws(() => inp.readByte(), EOFException);
  assert.doesNotThrow(() => inp.readBytes(new Uint8Array(0), 0, 0), "len 0 never touches the stream, even at EOF");
});

test("InputStreamDataInput / OutputStreamDataOutput close the underlying stream", () => {
  let closed = 0;
  const is: InputStream = { read: () => -1, close: () => void closed++ } as InputStream;
  new InputStreamDataInput(is).close();
  const bos = new ByteArrayOutputStream();
  bos.close = () => void closed++;
  new OutputStreamDataOutput(bos).close();
  assert.equal(closed, 2);
});

test("OutputStreamDataOutput.writeByte keeps the low 8 bits (Java's (byte) cast)", () => {
  const bos = new ByteArrayOutputStream(1);
  const o = new OutputStreamDataOutput(bos);
  o.writeByte(-2);
  o.writeByte(0x1ff);
  assert.deepEqual([...bos.toByteArray()], [0xfe, 0xff]);
});

test("java.io shims: ByteArrayInputStream / ByteArrayOutputStream", () => {
  const bis = new ByteArrayInputStream(Uint8Array.from([1, 2, 3, 4, 5]), 1, 3); // 2,3,4
  assert.equal(bis.read(), 2);
  const b = new Uint8Array(5);
  assert.equal(bis.read(b, 1, 4), 2);
  assert.deepEqual([...b], [0, 3, 4, 0, 0]);
  assert.equal(bis.read(), -1);
  assert.equal(bis.read(b, 0, 1), -1);
  assert.equal(bis.read(b, 0, 0), -1, "at EOF even a zero-length read returns -1 (Java)");
  const bos = new ByteArrayOutputStream(1);
  for (let i = 0; i < 100; i++) bos.write(i);
  bos.write(Uint8Array.from([7, 8, 9]), 1, 2);
  assert.equal(bos.size(), 102);
  assert.deepEqual([...bos.toByteArray().subarray(98)], [98, 99, 8, 9]);
  bos.reset();
  assert.equal(bos.size(), 0);
});

test("exceptions: hierarchy and cause", () => {
  assert.ok(new EOFException() instanceof IOException);
  const cause = new Error("x");
  assert.equal(new IOException("m", { cause }).cause, cause);
  const e = new AlreadyClosedException("closed");
  assert.ok(e instanceof IllegalStateException);
  assert.equal(e.name, "AlreadyClosedException");
  assert.equal(new AlreadyClosedException("m", { cause }).cause, cause);
});

test("skipBytes on a DataInput subclass reads through readBytes with useBuffer=false", () => {
  const seen: [number, number, boolean | undefined][] = [];
  class Counting extends DataInput {
    readByte(): number { return 0; }
    readBytes(b: Uint8Array, offset: number, len: number, useBuffer?: boolean): void {
      seen.push([offset, len, useBuffer]);
    }
  }
  new Counting().skipBytes(2500);
  assert.deepEqual(seen, [[0, 1024, false], [0, 1024, false], [0, 452, false]]);
});

test("JavaCollections.javaHashOrder / compareJavaStrings", () => {
  assert.deepEqual(javaHashOrder([]), []);
  // "a"=97 -> bucket 1, "b"=98 -> 2, "Aa" and "BB" collide (hash 2112) and keep insertion order
  assert.deepEqual(javaHashOrder(["b", "a"]), ["a", "b"]);
  assert.deepEqual(javaHashOrder(["BB", "Aa"]), ["BB", "Aa"]);
  assert.deepEqual(javaHashOrder(["Aa", "BB"]), ["Aa", "BB"]);
  assert.ok(compareJavaStrings("￿", "😀") > 0, "UTF-16 code unit order, not code point order");
  assert.ok(compareJavaStrings("a", "ab") < 0);
  assert.equal(compareJavaStrings("x", "x"), 0);
});
