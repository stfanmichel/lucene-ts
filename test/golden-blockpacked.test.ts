/**
 * Differential tests for BlockPackedWriter/Reader/ReaderIterator, MonotonicBlockPackedWriter/Reader, DirectWriter/Reader,
 * AbstractBlockPackedWriter.writeVLong, BlockPackedReaderIterator.readVLong, MonotonicBlockPackedReader.expected and
 * Long.toFloat. Expected values come from test/golden/blockpacked.json, produced by the ORIGINAL Lucene 5.2.1 classes with
 * assertions enabled (tools/golden/org/apache/lucene/util/packed/GoldenBlockPacked.java).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ArrayIndexOutOfBoundsException, NullPointerException, getMessage } from "../src/errors.js";
import { CRC32 } from "../src/zip/CRC32.js";
import { ByteArrayDataInput } from "../src/store/ByteArrayDataInput.js";
import { ByteArrayDataOutput } from "../src/store/ByteArrayDataOutput.js";
import { IOContext } from "../src/store/IOContext.js";
import { RAMDirectory } from "../src/store/RAMDirectory.js";
import type { DataInput } from "../src/store/DataInput.js";
import { Float, Long } from "../src/util/JavaNumbers.js";
import { LongValues } from "../src/util/LongValues.js";
import { AbstractBlockPackedWriter } from "../src/util/packed/AbstractBlockPackedWriter.js";
import { BlockPackedReader } from "../src/util/packed/BlockPackedReader.js";
import { BlockPackedReaderIterator } from "../src/util/packed/BlockPackedReaderIterator.js";
import { BlockPackedWriter } from "../src/util/packed/BlockPackedWriter.js";
import { DirectReader } from "../src/util/packed/DirectReader.js";
import { DirectWriter } from "../src/util/packed/DirectWriter.js";
import { MonotonicBlockPackedReader } from "../src/util/packed/MonotonicBlockPackedReader.js";
import { MonotonicBlockPackedWriter } from "../src/util/packed/MonotonicBlockPackedWriter.js";
import { PackedInts } from "../src/util/packed/PackedInts.js";

interface Case {
  c: string;
  ops: string[];
  out: string[];
}
const golden: Record<string, Case[]> = JSON.parse(readFileSync(new URL("./golden/blockpacked.json", import.meta.url), "utf8"));

function ex(e: unknown): string {
  if (e instanceof ArrayIndexOutOfBoundsException) return "EX:ArrayIndexOutOfBoundsException";
  if (e instanceof NullPointerException) return "EX:NullPointerException";
  return "EX:" + (e as Error).constructor.name + ":" + getMessage(e as Error);
}

function dig(s: string): string {
  if (s.length <= 300) return s;
  const b = new TextEncoder().encode(s);
  const c = new CRC32();
  c.update(b, 0, b.length);
  return "d" + s.length + ":" + c.getValue().toString(16);
}

const hx = (x: bigint): string => BigInt.asUintN(64, x).toString(16);
const H = (s: string): bigint => BigInt.asIntN(64, BigInt("0x" + s));
function hexsB(a: Uint8Array): string {
  let s = "";
  for (const x of a) s += x.toString(16).padStart(2, "0");
  return dig(s);
}
function parseL(s: string): BigInt64Array {
  if (s === "") return new BigInt64Array(0);
  return BigInt64Array.from(s.split(","), (x) => H(x));
}

function readFile(d: RAMDirectory, name: string): Uint8Array {
  const input = d.openInput(name, IOContext.DEFAULT);
  const b = new Uint8Array(input.length());
  input.readBytes(b, 0, b.length);
  input.close();
  return b;
}

function run(op: string, f: () => string): string {
  void op;
  try {
    return f();
  } catch (e) {
    return ex(e);
  }
}

function check(section: string, replay: (cfg: string, op: string) => string, prepare?: (cfg: string) => void): void {
  for (const cs of golden[section]!) {
    prepare?.(cs.c);
    for (let i = 0; i < cs.ops.length; i++) {
      const got = run(cs.ops[i]!, () => replay(cs.c, cs.ops[i]!));
      assert.equal(got, cs.out[i], `${section} [${cs.c.substring(0, 60)}] op ${cs.ops[i]}`);
    }
  }
}

test("blockpacked: writers, readers, iterators vs Java", () => {
  let d: RAMDirectory;
  let bytes: Uint8Array | null = null;
  let wr: AbstractBlockPackedWriter;
  let mono = false;
  let bs = 0;
  let v: BigInt64Array;
  const prepare = (cfg: string): void => {
    const p = cfg.split(",");
    mono = p[0] === "mono";
    bs = parseInt(p[1]!);
    v = parseL(p.slice(2).join(","));
    d = new RAMDirectory();
    bytes = null;
  };
  const mk = (o: ReturnType<RAMDirectory["createOutput"]>): AbstractBlockPackedWriter =>
    mono ? new MonotonicBlockPackedWriter(o, bs) : new BlockPackedWriter(o, bs);
  const n = (): number => v.length;
  check(
    "block",
    (_cfg, op) => {
      const a = op.split(":");
      switch (a[0]) {
        case "W": {
          const o = d.createOutput("f", IOContext.DEFAULT);
          const w = mk(o);
          wr = w;
          for (const x of v) w.add(x);
          w.finish();
          const ord = w.ord();
          o.close();
          bytes = readFile(d, "f");
          return "len=" + bytes.length + " ord=" + ord + " " + hexsB(bytes);
        }
        case "AF":
          wr.add(1n);
          return "no exception";
        case "FF":
          wr.finish();
          return "no exception";
        case "RW": {
          const o = d.createOutput("g", IOContext.DEFAULT);
          wr.reset(o);
          const s = "ord=" + wr.ord();
          for (const x of v) wr.add(x);
          wr.finish();
          o.close();
          const g = readFile(d, "g");
          return s + " same=" + (bytes !== null && Buffer.compare(g, bytes) === 0);
        }
        case "NEG": {
          const w = new MonotonicBlockPackedWriter(d.createOutput("h", IOContext.DEFAULT), bs);
          w.add(-1n);
          return "no exception";
        }
        case "Z": {
          const o = d.createOutput("z", IOContext.DEFAULT);
          const w = mk(o);
          w.addBlockOfZeros();
          w.addBlockOfZeros();
          w.add(5n);
          w.finish();
          const ord = w.ord();
          o.close();
          return "ord=" + ord + " " + hexsB(readFile(d, "z"));
        }
        case "Z2": {
          const w = mk(d.createOutput("z2", IOContext.DEFAULT));
          w.add(1n);
          w.addBlockOfZeros();
          return "no exception";
        }
        case "W-bad":
          new BlockPackedWriter(d.createOutput("b", IOContext.DEFAULT), 100);
          return "no exception";
        case "W-null":
          new BlockPackedWriter(null as never, 64);
          return "no exception";
        case "R": {
          if (bytes === null) return "nofile";
          const ver = parseInt(a[1]!);
          const direct = a[2] === "1";
          const input = d.openInput("f", IOContext.DEFAULT);
          try {
            let lv: LongValues;
            let rd: { ramBytesUsed(): number };
            if (mono) {
              const m = MonotonicBlockPackedReader.of(input, ver, bs, n(), direct);
              lv = m;
              rd = m;
            } else {
              const b = new BlockPackedReader(input, ver, bs, n(), direct);
              lv = b;
              rd = b;
            }
            const head = String(rd) + " fp=" + input.getFilePointer() + " ram=" + rd.ramBytesUsed() + " ";
            let vals = "";
            for (let i = 0; i < n(); i++) vals += hx(lv.get(i)) + " ";
            return head + dig(vals);
          } finally {
            input.close();
          }
        }
        case "I": {
          if (bytes === null) return "nofile";
          const ver = parseInt(a[1]!);
          const kind = parseInt(a[2]!);
          const md = parseInt(a[3]!);
          const input: DataInput = kind === 0 ? d.openInput("f", IOContext.DEFAULT) : new ByteArrayDataInput(bytes);
          const it = new BlockPackedReaderIterator(input, ver, bs, n());
          let s = "";
          try {
            if (md === 0) {
              for (let i = 0; i < n(); i++) s += hx(it.next()) + " ";
              s += "ord=" + it.ord() + " ";
              it.next();
            } else if (md === 1) {
              let pos = 0;
              while (pos < n()) {
                const ref = it.nextRef(1 + ((pos * 7) % 70));
                s += ref.offset + "/" + ref.length + ":";
                for (let i = 0; i < ref.length; i++) s += hx(ref.longs[ref.offset + i]!) + " ";
                pos += ref.length;
              }
              s += "ord=" + it.ord() + " ";
              it.nextRef(3);
            } else {
              let step = 0;
              while (it.ord() < n()) {
                const remaining = n() - it.ord();
                const sk = Math.min(remaining, (step * 37 + 5) % (2 * bs + 3));
                it.skip(sk);
                s += "s" + sk + "@" + it.ord() + " ";
                if (it.ord() < n()) s += hx(it.next()) + " ";
                step++;
              }
              s += "ord=" + it.ord() + " ";
              it.skip(1);
            }
          } catch (e) {
            s += ex(e);
          }
          return dig(s);
        }
        case "I-reset": {
          if (bytes === null) return "nofile";
          const it = new BlockPackedReaderIterator(new ByteArrayDataInput(bytes), PackedInts.VERSION_CURRENT, bs, n());
          let s = "";
          for (let i = 0; i < Math.floor(n() / 2); i++) s += hx(it.next()) + " ";
          it.reset(new ByteArrayDataInput(bytes), n());
          s += "ord=" + it.ord() + " ";
          for (let i = 0; i < n(); i++) s += hx(it.next()) + " ";
          it.reset(new ByteArrayDataInput(bytes), n());
          it.skip(n());
          s += "ord=" + it.ord() + " ";
          it.reset(new ByteArrayDataInput(bytes), n());
          it.skip(n() + 1);
          return dig(s);
        }
        case "I-bad":
          new BlockPackedReaderIterator(new ByteArrayDataInput(new Uint8Array(0)), PackedInts.VERSION_CURRENT, 100, 5);
          return "no exception";
      }
      throw new Error("unknown op " + op);
    },
    prepare,
  );
});

test("blockpacked: DirectWriter / DirectReader vs Java", () => {
  let d: RAMDirectory;
  let bytes: Uint8Array | null = null;
  let bpv = 0;
  let v: BigInt64Array;
  check(
    "direct",
    (_cfg, op) => {
      switch (op) {
        case "W": {
          const o = d.createOutput("f", IOContext.DEFAULT);
          const w = DirectWriter.getInstance(o, v.length, bpv);
          for (const x of v) w.add(x);
          w.finish();
          o.close();
          bytes = readFile(d, "f");
          return "len=" + bytes.length + " " + hexsB(bytes);
        }
        case "R": {
          if (bytes === null) return "nofile";
          const input = d.openInput("f", IOContext.DEFAULT);
          const rd = DirectReader.getInstance(input.randomAccessSlice(0, input.length()), bpv);
          let s = "";
          for (let i = 0; i < v.length; i++) s += hx(rd.get(i)) + " ";
          return dig(s);
        }
        case "R-off": {
          if (bytes === null || bytes.length < 8) return "skip";
          const input = d.openInput("f", IOContext.DEFAULT);
          const rd = DirectReader.getInstance(input.randomAccessSlice(0, input.length()), bpv);
          let s = "";
          for (let i = v.length - 1; i >= 0; i -= 2) s += hx(rd.get(i)) + " ";
          return dig(s);
        }
        case "OVER": {
          const w = DirectWriter.getInstance(d.createOutput("o", IOContext.DEFAULT), v.length, bpv);
          for (const x of v) w.add(x);
          w.add(1n);
          return "no exception";
        }
        case "SHORT": {
          const w = DirectWriter.getInstance(d.createOutput("s", IOContext.DEFAULT), v.length + 2, bpv);
          for (const x of v) w.add(x);
          w.finish();
          return "no exception";
        }
        case "BIG": {
          const w = DirectWriter.getInstance(d.createOutput("t", IOContext.DEFAULT), 3, bpv);
          w.add(bpv >= 64 ? -1n : 1n << BigInt(bpv));
          w.finish();
          return "no exception";
        }
        case "NEG": {
          const o = d.createOutput("u", IOContext.DEFAULT);
          const w = DirectWriter.getInstance(o, 3, bpv);
          w.add(-5n);
          w.finish();
          return "len=" + o.getFilePointer();
        }
      }
      throw new Error("unknown op " + op);
    },
    (cfg) => {
      const i = cfg.indexOf(",");
      bpv = parseInt(cfg.substring(0, i));
      v = parseL(cfg.substring(i + 1));
      d = new RAMDirectory();
      bytes = null;
    },
  );
});

test("blockpacked: DirectWriter.bitsRequired / unsignedBitsRequired", () => {
  check("bits", (_c, op) => {
    const x = H(op.substring(2));
    return op[0] === "B" ? DirectWriter.bitsRequired(x) + "" : DirectWriter.unsignedBitsRequired(x) + "";
  });
});

test("blockpacked: Long.toFloat equals Java (float) cast", () => {
  check("tofloat", (_c, op) => (Float.floatToIntBits(Long.toFloat(H(op.substring(2)))) >>> 0).toString(16));
});

test("blockpacked: MonotonicBlockPackedReader.expected", () => {
  check("expected", (_c, op) => {
    const [o, b, i] = op.substring(2).split(",");
    const avg = Float.intBitsToFloat(Number(BigInt.asIntN(32, BigInt("0x" + b!))));
    return hx(MonotonicBlockPackedReader.expected(H(o!), avg, parseInt(i!)));
  });
});

test("blockpacked: writeVLong / readVLong with negatives", () => {
  check("vlong", (_c, op) => {
    const x = H(op.substring(2));
    const buf = new Uint8Array(20);
    const o = new ByteArrayDataOutput(buf);
    AbstractBlockPackedWriter.writeVLong(o, x);
    const b = buf.slice(0, o.getPosition());
    const back = BlockPackedReaderIterator.readVLong(new ByteArrayDataInput(b));
    return hexsB(b) + ":" + hx(back);
  });
});

test("LongValues.IDENTITY", () => {
  assert.equal(LongValues.IDENTITY.get(0), 0n);
  assert.equal(LongValues.IDENTITY.get(123456789), 123456789n);
});
