/**
 * Behavioural tests for IndexInput/IndexOutput/IOContext and friends that the golden file cannot express
 * (TypeScript-specific plumbing: markers, constructors, assertions).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { IllegalArgumentException } from "../src/errors.js";
import { ASSERTIONS_ENABLED } from "../src/util/assertions.js";
import { BufferedIndexInput } from "../src/store/BufferedIndexInput.js";
import { Context, IOContext } from "../src/store/IOContext.js";
import { FlushInfo } from "../src/store/FlushInfo.js";
import { IndexInput } from "../src/store/IndexInput.js";
import { IndexOutput } from "../src/store/IndexOutput.js";
import { MergeInfo } from "../src/store/MergeInfo.js";
import { RANDOM_ACCESS_INPUT, isRandomAccessInput } from "../src/store/RandomAccessInput.js";
import { BufferedChecksumIndexInput } from "../src/store/BufferedChecksumIndexInput.js";
import { randomBytes, mulberry32 } from "./helpers.js";

/** A minimal non-buffered IndexInput over an array: slices are plain copies (no RandomAccessInput). */
class ArrayIndexInput extends IndexInput {
  private pos = 0;
  constructor(desc: string, private readonly data: Uint8Array) {
    super(desc);
  }
  close(): void {}
  getFilePointer(): number { return this.pos; }
  seek(pos: number): void { this.pos = pos; }
  length(): number { return this.data.length; }
  readByte(): number { return this.data[this.pos++]; }
  readBytes(b: Uint8Array, off: number, len: number): void {
    b.set(this.data.subarray(this.pos, this.pos + len), off);
    this.pos += len;
  }
  slice(desc: string | null, offset: number, length: number): IndexInput {
    return new ArrayIndexInput(this.getFullSliceDescription(desc), this.data.subarray(offset, offset + length));
  }
}

class NullDescOut extends IndexOutput {
  constructor(d: string) { super(d); }
  close(): void {}
  getFilePointer(): number { return 0; }
  getChecksum(): bigint { return 0n; }
  writeByte(): void {}
  writeBytes(): void {}
}

test("IndexInput / IndexOutput: description, toString and null check", () => {
  const i = new ArrayIndexInput("desc", new Uint8Array(0));
  assert.equal(i.toString(), "desc");
  assert.equal(`${i}`, "desc");
  assert.throws(() => new ArrayIndexInput(null as unknown as string, new Uint8Array(0)),
    (e: Error) => e instanceof IllegalArgumentException && e.message === "resourceDescription must not be null");
  assert.equal(new NullDescOut("out").toString(), "out");
  assert.throws(() => new NullDescOut(null as unknown as string),
    (e: Error) => e instanceof IllegalArgumentException && e.message === "resourceDescription must not be null");
});

test("IndexInput.getFullSliceDescription and the default randomAccessSlice (seek + read)", () => {
  const data = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const i = new ArrayIndexInput("f", data);
  const slice = i.slice(null, 2, 4);
  assert.equal(slice.toString(), "f");
  assert.equal(i.slice("x", 2, 4).toString(), "f [slice=x]");
  assert.ok(!isRandomAccessInput(slice), "a plain IndexInput is not a RandomAccessInput");
  const ra = i.randomAccessSlice(4, 8); // bytes 5..12
  assert.ok(isRandomAccessInput(ra));
  assert.equal(ra[RANDOM_ACCESS_INPUT], true);
  assert.equal(ra.readByte(0), 5);
  assert.equal(ra.readByte(7), 12);
  assert.equal(ra.readShort(1), 0x0607);
  assert.equal(ra.readInt(2), 0x0708090a);
  assert.equal(ra.readLong(0), 0x05060708090a0b0cn);
});

test("BufferedIndexInput is a RandomAccessInput and its slices are served directly (no seek+read wrapper)", () => {
  class Mem extends BufferedIndexInput {
    pos = 0;
    constructor(readonly data: Uint8Array) { super("mem"); }
    protected readInternal(b: Uint8Array, off: number, len: number): void {
      b.set(this.data.subarray(this.pos, this.pos + len), off);
      this.pos += len;
    }
    protected seekInternal(p: number): void { this.pos = p; }
    length(): number { return this.data.length; }
    close(): void {}
  }
  const data = randomBytes(mulberry32(7), 5000);
  const m = new Mem(data);
  assert.ok(isRandomAccessInput(m));
  const s = m.randomAccessSlice(100, 3000);
  assert.ok(isRandomAccessInput(s));
  assert.equal(s.readByte(10), data[110]);
  assert.equal(s.readInt(2000), (data[2100] << 24 | data[2101] << 16 | data[2102] << 8 | data[2103]) | 0);
  // reading relative still works afterwards, on the original, unaffected
  assert.equal(m.getFilePointer(), 0);
  assert.equal(m.readByte(), data[0]);
  // clones are independent
  m.seek(10);
  const c = m.clone();
  assert.equal(c.getFilePointer(), 10);
  assert.equal(c.readByte(), data[10]);
  assert.equal(m.getFilePointer(), 10);
  // the slice's toString / description
  assert.equal(m.slice("part", 5, 10).toString(), "mem [slice=part]");
  assert.equal(m.slice(null, 5, 10).toString(), "mem");
  assert.throws(() => m.slice("bad", 4990, 11), (e: Error) => e.name === "IllegalArgumentException" && e.message === "slice() bad out of bounds: mem");
  assert.throws(() => m.slice("bad", -1, 2), IllegalArgumentException);
  assert.throws(() => m.slice("bad", 1, -2), IllegalArgumentException);
});

test("BufferedIndexInput.setBufferSize asserts consistency of the buffer", { skip: !ASSERTIONS_ENABLED }, () => {
  class Mem extends BufferedIndexInput {
    constructor() { super("m"); }
    protected readInternal(): void {}
    protected seekInternal(): void {}
    length(): number { return 0; }
    close(): void {}
    breakBuffer(): void { this.buffer = new Uint8Array(3); }
  }
  const m = new Mem();
  m.setBufferSize(64); // fine: no buffer yet
  m.breakBuffer();
  assert.throws(() => m.setBufferSize(32), (e: Error) => e.name === "AssertionError");
});

test("IOContext: constants, constructors, assertions", () => {
  assert.equal(IOContext.DEFAULT.context, Context.DEFAULT);
  assert.equal(IOContext.READ.context, Context.READ);
  assert.equal(IOContext.READ.readOnce, false);
  assert.equal(IOContext.READONCE.readOnce, true);
  assert.equal(new IOContext().context, Context.READ);
  assert.equal(new IOContext(Context.DEFAULT).context, Context.DEFAULT);
  const fi = new FlushInfo(1, 2);
  const mi = new MergeInfo(1, 2, false, 3);
  assert.equal(new IOContext(fi).flushInfo, fi);
  assert.equal(new IOContext(fi).context, Context.FLUSH);
  assert.equal(new IOContext(mi).mergeInfo, mi);
  assert.equal(new IOContext(mi).context, Context.MERGE);
  const copy = new IOContext(new IOContext(mi), true);
  assert.equal(copy.mergeInfo, mi);
  assert.equal(copy.readOnce, true);
  assert.equal(Context.MERGE, "MERGE");
  if (ASSERTIONS_ENABLED) {
    assert.throws(() => new IOContext(Context.MERGE), (e: Error) => e.name === "AssertionError" && e.message.includes("MergeInfo must not be null"));
    assert.throws(() => new IOContext(Context.FLUSH), (e: Error) => e.name === "AssertionError" && e.message.includes("FLUSH IOContext"));
  }
});

test("equals() of the info classes rejects other types and null", () => {
  assert.ok(!new FlushInfo(1, 2).equals(null));
  assert.ok(!new FlushInfo(1, 2).equals(new MergeInfo(1, 2, false, 3)));
  assert.ok(!new MergeInfo(1, 2, false, 3).equals(undefined));
  assert.ok(!new IOContext().equals(null));
  assert.ok(!IOContext.READ.equals(new FlushInfo(1, 2)));
});

test("BufferedChecksumIndexInput.seek forwards only; length/getFilePointer delegate to the wrapped input", () => {
  const data = randomBytes(mulberry32(3), 100);
  const inp = new BufferedChecksumIndexInput(new ArrayIndexInput("a", data));
  assert.equal(inp.length(), 100);
  inp.seek(10);
  assert.equal(inp.getFilePointer(), 10);
  assert.throws(() => inp.seek(9), (e: Error) => e.name === "IllegalStateException" && e.message === "class BufferedChecksumIndexInput cannot seek backwards");
  inp.seek(10); // same position: allowed
  assert.equal(inp.getFilePointer(), 10);
  assert.equal(inp.toString(), "BufferedChecksumIndexInput(a)");
});
