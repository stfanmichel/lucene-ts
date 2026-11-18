/**
 * Differential tests for BufferedIndexInput (with SlicedIndexInput), BufferedChecksum, CRC32,
 * BufferedChecksumIndexInput, ChecksumIndexInput, IOContext, FlushInfo and MergeInfo. Every expected value in
 * test/golden/store-io.json was produced by the ORIGINAL Lucene 5.2.1 classes (tools/golden/GoldenStoreIO.java,
 * run by tools/golden/generate.sh).
 *
 * BufferedIndexInput is compared on its exact observable behaviour: the result of every scripted operation, the
 * file pointer afterwards, AND the sequence of readInternal/seekInternal calls made on the subclass.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ArrayIndexOutOfBoundsException, EOFException } from "../src/errors.js";
import { BufferedChecksum } from "../src/store/BufferedChecksum.js";
import { BufferedChecksumIndexInput } from "../src/store/BufferedChecksumIndexInput.js";
import { BufferedIndexInput } from "../src/store/BufferedIndexInput.js";
import { FlushInfo } from "../src/store/FlushInfo.js";
import { Context, IOContext } from "../src/store/IOContext.js";
import type { IndexInput } from "../src/store/IndexInput.js";
import { IndexOutput } from "../src/store/IndexOutput.js";
import { MergeInfo } from "../src/store/MergeInfo.js";
import { CRC32 } from "../src/zip/CRC32.js";
import { hexToBytes, toHex } from "./helpers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const golden: any = JSON.parse(readFileSync(new URL("./golden/store-io.json", import.meta.url), "utf8"));

/** Golden results are either a plain value or "EX:ClassName:message" for an exception. */
function expectResult(fn: () => unknown, expected: unknown, ctx: string, fixMessage: (m: string) => string = (m) => m): void {
  if (typeof expected === "string" && expected.startsWith("EX:")) {
    const [, cls, ...rest] = expected.split(":");
    const msg = fixMessage(rest.join(":"));
    assert.throws(
      fn,
      (e: unknown) => {
        assert.ok(e instanceof Error, `${ctx}: not an Error`);
        assert.equal(e.name, cls, `${ctx}: exception class`);
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

/** The Java test subclass: reads from a byte array and logs every readInternal/seekInternal call. */
class TestBII extends BufferedIndexInput {
  pos = 0;
  constructor(desc: string, readonly data: Uint8Array, bufSize: number, readonly log: string[]) {
    super(desc, bufSize);
  }
  protected readInternal(b: Uint8Array, off: number, len: number): void {
    this.log.push("r" + off + ":" + len + "@" + this.pos);
    if (this.pos + len > this.data.length) throw new EOFException("read past EOF: " + this);
    if (this.pos < 0) throw new ArrayIndexOutOfBoundsException();
    b.set(this.data.subarray(this.pos, this.pos + len), off);
    this.pos += len;
  }
  protected seekInternal(p: number): void {
    this.log.push("s" + p);
    this.pos = p;
  }
  length(): number {
    return this.data.length;
  }
  close(): void {
    this.log.push("c");
  }
  flush(out: IndexOutput, n: number): number {
    return this.flushBuffer(out, n);
  }
}

class TestOut extends IndexOutput {
  readonly bytes: number[] = [];
  constructor() {
    super("TestOut");
  }
  close(): void {}
  getFilePointer(): number {
    return this.bytes.length;
  }
  getChecksum(): bigint {
    return 0n;
  }
  writeByte(b: number): void {
    this.bytes.push(b & 0xff);
  }
  writeBytes(b: Uint8Array, off: number, len: number): void {
    for (let i = 0; i < len; i++) this.bytes.push(b[off + i]);
  }
}

function runBufferedCase(c: any, ci: number): void {
  const data = hexToBytes(c.data);
  const log: string[] = [];
  const main = new TestBII("main", data, c.bufSize, log);
  const ins: IndexInput[] = [main];
  let cur: IndexInput = main;
  c.ops.forEach((op: any[], i: number) => {
    const exp = c.results[i];
    const ctx = `buffered[${ci}] op ${i} ${JSON.stringify(op)}`;
    log.length = 0;
    let extra: string | undefined;
    const bi = (): BufferedIndexInput => cur as BufferedIndexInput;
    expectResult(
      () => {
        switch (op[0]) {
          case "byte": return String(cur.readByte());
          case "short": return String(cur.readShort());
          case "int": return String(cur.readInt());
          case "long": return String(cur.readLong());
          case "vint": return String(cur.readVInt());
          case "vlong": return String(cur.readVLong());
          case "bytes": {
            const dst = new Uint8Array(op[1]).fill(0xaa);
            try {
              cur.readBytes(dst, 0, dst.length, op[2]);
            } finally {
              extra = toHex(dst);
            }
            return "ok";
          }
          case "skip": cur.skipBytes(op[1]); return "ok";
          case "seek": cur.seek(op[1]); return "ok";
          case "abyte": return String(bi().readByte(op[1]));
          case "ashort": return String(bi().readShort(op[1]));
          case "aint": return String(bi().readInt(op[1]));
          case "along": return String(bi().readLong(op[1]));
          case "setbuf": bi().setBufferSize(op[1]); return "ok";
          case "clone": { const k = cur.clone(); ins.push(k); cur = k; return "ok"; }
          case "slice": { const s = cur.slice(op[1], op[2], op[3]); ins.push(s); cur = s; return "ok:" + s; }
          case "use": cur = ins[Math.min(op[1], ins.length - 1)]; return "ok";
          case "flush": {
            if (!(cur instanceof TestBII)) return "n/a";
            const out = new TestOut();
            const n = cur.flush(out, op[1]);
            extra = toHex(Uint8Array.from(out.bytes));
            return String(n);
          }
          case "fp": return String(cur.getFilePointer());
          default: throw new Error("unknown op " + op[0]);
        }
      },
      exp.v,
      ctx,
    );
    assert.equal(cur.getFilePointer(), exp.fp, `${ctx}: getFilePointer`);
    assert.equal(cur.length(), exp.len, `${ctx}: length`);
    assert.deepEqual(log, exp.log, `${ctx}: readInternal/seekInternal calls`);
    assert.equal(extra, exp.x, `${ctx}: extra`);
  });
}

test("golden: BufferedIndexInput, 200 scripted sequences of 50 operations (results AND readInternal/seekInternal calls)", () => {
  golden.buffered.forEach((c: any, i: number) => runBufferedCase(c, i));
});

test("golden: BufferedIndexInput buffer sizes and IOContext", () => {
  for (const c of golden.bufferSizes.contexts) {
    // the golden file prints the context with Java's toString: recover the TypeScript context from it
    const ctx = ((): IOContext => {
      const s: string = c.ctx;
      if (s.includes("context=MERGE")) return new IOContext(new MergeInfo(1, 2, true, 3));
      if (s.includes("context=FLUSH")) return new IOContext(new FlushInfo(4, 5));
      if (s.includes("context=DEFAULT")) return IOContext.DEFAULT;
      return s.includes("readOnce=true") ? IOContext.READONCE : IOContext.READ;
    })();
    assert.equal(ctx.toString(), c.ctx);
    assert.equal(BufferedIndexInput.bufferSize(ctx), c.bufferSize, c.ctx);
    // the (desc, IOContext) constructor takes the size from the context
    const viaCtx = new TestBII("x", new Uint8Array(10), 8, []);
    assert.equal(viaCtx.getBufferSize(), c.viaCtor);
  }
  for (const b of golden.bufferSizes.ctor) {
    expectResult(() => new TestBII("x", new Uint8Array(1), b.n, []).getBufferSize(), b.r, `ctor bufferSize ${b.n}`);
  }
});

test("BufferedIndexInput(desc, IOContext) and (desc) constructors", () => {
  class Plain extends BufferedIndexInput {
    protected readInternal(): void {}
    protected seekInternal(): void {}
    length(): number { return 0; }
    close(): void {}
  }
  assert.equal(new Plain("a").getBufferSize(), 1024);
  assert.equal(new Plain("a", IOContext.DEFAULT).getBufferSize(), 1024);
  assert.equal(new Plain("a", new IOContext(new MergeInfo(1, 1, false, 1))).getBufferSize(), 4096);
  assert.equal(new Plain("a", 77).getBufferSize(), 77);
});

test("golden: CRC32 and BufferedChecksum", () => {
  const cs = golden.checksum;
  const crc = new CRC32();
  assert.equal(String(crc.getValue()), cs.emptyValue);
  crc.update(new TextEncoder().encode("123456789"), 0, 9);
  assert.equal(String(crc.getValue()), cs.check123456789);
  cs.cases.forEach((c: any, ci: number) => {
    const plain = new CRC32();
    const bc = new BufferedChecksum(new CRC32(), c.bufSize);
    const vals: string[] = [];
    for (const op of c.ops) {
      switch (op[0]) {
        case "b": plain.update(op[1]); bc.update(op[1]); break;
        case "a": {
          const a = hexToBytes(op[1]);
          plain.update(a, op[2], op[3]);
          bc.update(a, op[2], op[3]);
          break;
        }
        case "v":
          assert.equal(plain.getValue(), bc.getValue(), `case ${ci}: BufferedChecksum == CRC32`);
          vals.push(String(bc.getValue()));
          break;
        case "r": plain.reset(); bc.reset(); break;
      }
    }
    vals.push(String(bc.getValue()));
    assert.deepEqual(vals, c.values, `checksum case ${ci}`);
  });
});

test("golden: BufferedChecksumIndexInput (reads, forward and backward seeks, unsupported clone/slice)", () => {
  golden.checksumIndexInput.forEach((c: any, ci: number) => {
    const data = hexToBytes(c.data);
    const inp = new BufferedChecksumIndexInput(new TestBII("main", data, c.bufSize, []));
    assert.equal(inp.toString(), c.desc);
    c.ops.forEach((op: any[], i: number) => {
      const exp = c.results[i];
      const ctx = `checksumIndexInput[${ci}] op ${i} ${JSON.stringify(op)}`;
      expectResult(
        () => {
          switch (op[0]) {
            case "byte": return String(inp.readByte());
            case "int": return String(inp.readInt());
            case "vlong": return String(inp.readVLong());
            case "bytes": { const d = new Uint8Array(op[1]); inp.readBytes(d, 0, d.length); return toHex(d); }
            case "seek": inp.seek(op[1]); return "ok";
            case "skip": inp.skipBytes(op[1]); return "ok";
            case "clone": return inp.clone();
            case "slice": return inp.slice("s", 0, 1);
            case "string": return inp.readString();
            default: throw new Error("unknown op " + op[0]);
          }
        },
        exp.v,
        ctx,
        // Java prints "class org.apache.lucene.store.X"; TypeScript only knows the simple class name
        (m) => m.replace("org.apache.lucene.store.", ""),
      );
      assert.equal(inp.getFilePointer(), exp.fp, `${ctx}: getFilePointer`);
      assert.equal(inp.length(), exp.len, `${ctx}: length`);
      assert.equal(String(inp.getChecksum()), exp.crc, `${ctx}: getChecksum`);
    });
  });
});

const SAFE = BigInt(Number.MAX_SAFE_INTEGER);

test("golden: FlushInfo and MergeInfo (hashCode, toString) for byte counts below 2^53", () => {
  let checked = 0;
  for (const [n, s, hash, str] of golden.info.flushInfo) {
    const size = BigInt(s);
    if (size > SAFE || size < -SAFE) continue; // a byte count is a number in this port
    const f = new FlushInfo(n, Number(size));
    assert.equal(f.hashCode(), hash, `FlushInfo(${n}, ${s}).hashCode`);
    assert.equal(f.toString(), str);
    assert.ok(f.equals(new FlushInfo(n, Number(size))));
    assert.ok(!f.equals(new FlushInfo(n + 1, Number(size))));
    assert.ok(!f.equals(new FlushInfo(n, Number(size) + 1)));
    checked++;
  }
  for (const [n, s, ext, seg, hash, str] of golden.info.mergeInfo) {
    const size = BigInt(s);
    if (size > SAFE || size < -SAFE) continue;
    const m = new MergeInfo(n, Number(size), ext, seg);
    assert.equal(m.hashCode(), hash, `MergeInfo(${n}, ${s}, ${ext}, ${seg}).hashCode`);
    assert.equal(m.toString(), str);
    assert.ok(m.equals(new MergeInfo(n, Number(size), ext, seg)));
    assert.ok(!m.equals(new MergeInfo(n, Number(size), !ext, seg)));
    checked++;
  }
  assert.ok(checked > 100, "enough cases were checked: " + checked);
});

test("golden: IOContext toString and equals", () => {
  const cs: IOContext[] = [
    IOContext.DEFAULT,
    IOContext.READ,
    IOContext.READONCE,
    new IOContext(),
    new IOContext(Context.READ),
    new IOContext(new FlushInfo(3, 4)),
    new IOContext(new MergeInfo(5, 6, true, 7)),
    new IOContext(IOContext.DEFAULT, true),
    new IOContext(new IOContext(new MergeInfo(5, 6, false, 7)), true),
    new IOContext(Context.DEFAULT),
  ];
  assert.deepEqual(cs.map((c) => c.toString()), golden.info.contexts);
  cs.forEach((a, i) => {
    assert.deepEqual(cs.map((b) => a.equals(b)), golden.info.equals[i], `equals row ${i}`);
    cs.forEach((b) => {
      if (a.equals(b)) assert.equal(a.hashCode(), b.hashCode(), "equal contexts have equal hash codes");
    });
  });
});
