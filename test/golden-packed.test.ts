/**
 * Differential tests for util.packed: Format, BulkOperation (Java uses the unrolled generated classes for 1..24 bits,
 * the port the generic one), PackedInts (writer, readers, iterators, direct readers, old long-aligned versions,
 * corrupted headers, copy), the mutables (Direct8..64, Packed64, Packed64SingleBlock, Packed8/16ThreeBlocks) and
 * PackedDataInput/Output. Expected values come from test/golden/packed.json, produced by the ORIGINAL Lucene 5.2.1
 * classes with assertions enabled (tools/golden/org/apache/lucene/util/packed/GoldenPacked.java).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ArrayIndexOutOfBoundsException, getMessage } from "../src/errors.js";
import { CRC32 } from "../src/zip/CRC32.js";
import { ByteArrayDataInput } from "../src/store/ByteArrayDataInput.js";
import { ByteArrayDataOutput } from "../src/store/ByteArrayDataOutput.js";
import { IOContext } from "../src/store/IOContext.js";
import { RAMDirectory } from "../src/store/RAMDirectory.js";
import type { IndexInput } from "../src/store/IndexInput.js";
import { floatToString } from "../src/util/JavaNumbers.js";
import { bulkOperationOf } from "../src/util/packed/BulkOperationFactory.js";
import { Packed64 } from "../src/util/packed/Packed64.js";
import { PackedDataInput } from "../src/util/packed/PackedDataInput.js";
import { PackedDataOutput } from "../src/util/packed/PackedDataOutput.js";
import { PackedInts } from "../src/util/packed/PackedInts.js";
import type { PackedIntsMutable, PackedIntsReader } from "../src/util/packed/PackedInts.js";

interface Case {
  c: string;
  ops: string[];
  out: string[];
}
const golden: Record<string, Case[]> = JSON.parse(readFileSync(new URL("./golden/packed.json", import.meta.url), "utf8"));

function ex(e: unknown): string {
  if (e instanceof ArrayIndexOutOfBoundsException) return "EX:ArrayIndexOutOfBoundsException";
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
function hexsL(a: BigInt64Array, off = 0, len = a.length - off): string {
  let s = "";
  for (let i = off; i < off + len; i++) s += hx(a[i]!) + " ";
  return dig(s);
}
function hexsB(a: Uint8Array, off = 0, len = a.length - off): string {
  let s = "";
  for (let i = off; i < off + len; i++) s += a[i]!.toString(16).padStart(2, "0");
  return dig(s);
}
const joinL = (a: BigInt64Array): string => Array.from(a, hx).join(",");
const joinI = (a: Int32Array): string => Array.from(a, (x) => (x >>> 0).toString(16)).join(",");
const bytesHex = (a: Uint8Array): string => Array.from(a, (x) => x.toString(16).padStart(2, "0")).join("");
function parseL(s: string | undefined): BigInt64Array {
  if (s === undefined || s === "") return new BigInt64Array(0);
  return BigInt64Array.from(s.split(","), (x) => BigInt("0x" + x));
}
function parseI(s: string | undefined): Int32Array {
  if (s === undefined || s === "") return new Int32Array(0);
  return Int32Array.from(s.split(","), (x) => Number(BigInt.asIntN(32, BigInt("0x" + x))));
}
function parseB(s: string): Uint8Array {
  const b = new Uint8Array(s.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(s.substring(2 * i, 2 * i + 2), 16);
  return b;
}
const fl = (s: string): number => Math.fround(parseFloat(s));
const H = (s: string): bigint => BigInt("0x" + s);


test("packed: formats, version checks, bit helpers", () => {
  const fmts = { PACKED: PackedInts.Format.PACKED, PACKED_SINGLE_BLOCK: PackedInts.Format.PACKED_SINGLE_BLOCK } as const;
  for (const cs of golden["formats"]!) {
    const p = cs.c.split(" ");
    for (let i = 0; i < cs.ops.length; i++) {
      const op = cs.ops[i]!;
      const a = op.split(" ");
      let got: string;
      try {
        if (cs.c === "misc") {
          switch (a[0]) {
            case "byId":
              got = PackedInts.Format.byId(parseInt(a[1]!)).name();
              break;
            case "ver":
              PackedInts.checkVersion(parseInt(a[1]!));
              got = "ok";
              break;
            case "req": {
              const m = BigInt.asIntN(64, H(a[1]!));
              let o: string;
              try {
                o = PackedInts.bitsRequired(m) + "";
              } catch (e) {
                o = ex(e);
              }
              got = o + " " + PackedInts.unsignedBitsRequired(m);
              break;
            }
            case "max":
              got = hx(PackedInts.maxValue(parseInt(a[1]!)));
              break;
            case "cbs":
              got = PackedInts.checkBlockSize(parseInt(a[1]!), 64, 1 << 20) + "";
              break;
            case "nb":
              got = PackedInts.numBlocks(Number(a[1]), parseInt(a[2]!)) + "";
              break;
            default:
              throw new Error(op);
          }
        } else if (cs.c.startsWith("fast ")) {
          const vc = parseInt(cs.c.substring(5));
          got = PackedInts.fastestFormatAndBits(vc, parseInt(a[1]!), fl(a[2]!)).toString();
        } else {
          const f = fmts[p[0] as keyof typeof fmts];
          const bpv = parseInt(p[1]!);
          switch (a[0]) {
            case "sup":
              got = f.isSupported(bpv) + "";
              break;
            case "id":
              got = f.getId() + " " + f.name() + " " + f;
              break;
            case "ovh":
              got = floatToString(f.overheadPerValue(bpv)) + " " + floatToString(f.overheadRatio(bpv));
              break;
            case "cnt":
              got = f.byteCount(parseInt(a[1]!), parseInt(a[2]!), bpv) + " " + f.longCount(parseInt(a[1]!), parseInt(a[2]!), bpv);
              break;
            default:
              throw new Error(op);
          }
        }
      } catch (e) {
        got = ex(e);
      }
      assert.equal(got, cs.out[i], `formats [${cs.c}] ${op}`);
    }
  }
});

test("packed: bulk operations (generic port vs Java's unrolled/generated ones)", () => {
  for (const cs of golden["bulk"]!) {
    const [fname, bpvS] = cs.c.split(" ");
    const f = fname === "PACKED" ? PackedInts.Format.PACKED : PackedInts.Format.PACKED_SINGLE_BLOCK;
    const op = bulkOperationOf(f, parseInt(bpvS!));
    for (let i = 0; i < cs.ops.length; i++) {
      const o = cs.ops[i]!;
      const a = o.split(" ");
      let got: string;
      try {
        switch (a[0]) {
          case "props":
            got = [op.longBlockCount(), op.longValueCount(), op.byteBlockCount(), op.byteValueCount()].join(" ");
            break;
          case "it":
            got = op.computeIterations(parseInt(a[1]!), parseInt(a[2]!)) + "";
            break;
          case "encLL": {
            const it = parseInt(a[1]!);
            const blocks = new BigInt64Array(it * op.longBlockCount());
            op.encode(parseL(a[2]), 0, blocks, 0, it);
            got = joinL(blocks);
            break;
          }
          case "encLB": {
            const it = parseInt(a[1]!);
            const blocks = new Uint8Array(it * op.byteBlockCount());
            op.encode(parseL(a[2]), 0, blocks, 0, it);
            got = bytesHex(blocks);
            break;
          }
          case "encIL": {
            const it = parseInt(a[1]!);
            const blocks = new BigInt64Array(it * op.longBlockCount());
            op.encode(parseI(a[2]), 0, blocks, 0, it);
            got = joinL(blocks);
            break;
          }
          case "encIB": {
            const it = parseInt(a[1]!);
            const blocks = new Uint8Array(it * op.byteBlockCount());
            op.encode(parseI(a[2]), 0, blocks, 0, it);
            got = bytesHex(blocks);
            break;
          }
          case "decLL": {
            const it = parseInt(a[1]!);
            const v = new BigInt64Array(it * op.longValueCount());
            op.decode(parseL(a[2]), 0, v, 0, it);
            got = joinL(v);
            break;
          }
          case "decLI": {
            const it = parseInt(a[1]!);
            const v = new Int32Array(it * op.longValueCount());
            op.decode(parseL(a[2]), 0, v, 0, it);
            got = joinI(v);
            break;
          }
          case "decBL": {
            const it = parseInt(a[1]!);
            const v = new BigInt64Array(it * op.byteValueCount());
            op.decode(parseB(a[2]!), 0, v, 0, it);
            got = joinL(v);
            break;
          }
          case "decBI": {
            const it = parseInt(a[1]!);
            const v = new Int32Array(it * op.byteValueCount());
            op.decode(parseB(a[2]!), 0, v, 0, it);
            got = joinI(v);
            break;
          }
          default:
            throw new Error(o);
        }
      } catch (e) {
        got = ex(e);
      }
      assert.equal(got, cs.out[i], `bulk [${cs.c}] ${o.substring(0, 100)}`);
    }
  }
});

function mk(cfg: string): PackedIntsMutable {
  const p = cfg.split(" ");
  const n = parseInt(p[0]!);
  const bpv = parseInt(p[1]!);
  switch (p[2]) {
    case "ratio":
      return PackedInts.getMutable(n, bpv, fl(p[3]!));
    case "format":
      return PackedInts.getMutable(n, bpv, p[3] === "PACKED" ? PackedInts.Format.PACKED : PackedInts.Format.PACKED_SINGLE_BLOCK);
    case "p64":
      return new Packed64(n, bpv);
    default:
      throw new Error(cfg);
  }
}

function saveBytes(m: PackedIntsMutable): Uint8Array {
  const d = new RAMDirectory();
  const o = d.createOutput("x", IOContext.DEFAULT);
  m.save(o);
  o.close();
  const b = readAll(d, "x");
  d.close();
  return b;
}

function readAll(d: RAMDirectory, name: string): Uint8Array {
  const input = d.openInput(name, IOContext.DEFAULT);
  const b = new Uint8Array(input.length());
  input.readBytes(b, 0, b.length);
  input.close();
  return b;
}

test("packed: mutables (getMutable, Direct*, Packed64, Packed64SingleBlock, ThreeBlocks)", () => {
  for (const cs of golden["mutable"]!) {
    const m = mk(cs.c);
    for (let i = 0; i < cs.ops.length; i++) {
      const op = cs.ops[i]!;
      const p = op.split(" ");
      let got: string;
      try {
        switch (p[0]) {
          case "set":
            m.set(parseInt(p[1]!), H(p[2]!));
            got = "ok";
            break;
          case "get":
            got = hx(m.get(parseInt(p[1]!)));
            break;
          case "fill":
            m.fill(parseInt(p[1]!), parseInt(p[2]!), H(p[3]!));
            got = "ok";
            break;
          case "clear":
            m.clear();
            got = "ok";
            break;
          case "all": {
            const a = new BigInt64Array(m.size());
            for (let k = 0; k < a.length; k++) a[k] = m.get(k);
            got = hexsL(a);
            break;
          }
          case "setb": {
            const off = parseInt(p[2]!);
            const len = parseInt(p[3]!);
            const vals = parseL(p[4]);
            const arr = new BigInt64Array(off + vals.length);
            arr.set(vals, off);
            got = m.setBulk(parseInt(p[1]!), arr, off, len) + "";
            break;
          }
          case "getb": {
            const arr = new BigInt64Array(parseInt(p[4]!)).fill(0x5a5an);
            const ret = m.getBulk(parseInt(p[1]!), arr, parseInt(p[2]!), parseInt(p[3]!));
            got = ret + " " + hexsL(arr);
            break;
          }
          case "str":
            got = m.toString();
            break;
          case "ram":
            got = m.ramBytesUsed() + "";
            break;
          case "bpv":
            got = m.getBitsPerValue() + " " + m.size();
            break;
          case "fmt":
            got = m.getFormat().name();
            break;
          case "save": {
            const b = saveBytes(m);
            got = b.length + " " + hexsB(b);
            break;
          }
          default:
            throw new Error(op);
        }
      } catch (e) {
        got = ex(e);
      }
      assert.equal(got, cs.out[i], `mutable [${cs.c}] #${i} ${op.substring(0, 100)}`);
    }
  }
});

const strip = (s: string): string => s.replace(/@.*/, "");

test("packed: streams (writer, reader, iterator, direct reader, long-aligned versions, corrupted headers)", () => {
  for (const cs of golden["stream"]!) {
    if (cs.c === "corrupt") {
      for (let i = 0; i < cs.ops.length; i++) {
        const bad = parseB(cs.ops[i]!.substring(4));
        let got: string;
        try {
          const rd = PackedInts.getReader(new ByteArrayDataInput(bad));
          got = strip(rd.toString()) + " " + rd.get(0);
        } catch (e) {
          got = ex(e).replace(/\(resource[= ][^)]*\)/g, "(resource R)");
        }
        assert.equal(got, cs.out[i], `corrupt #${i}`);
      }
      continue;
    }
    const [nS, bpvS, ratioS] = cs.c.split(" ");
    const n = parseInt(nS!);
    const bpv = parseInt(bpvS!);
    const ratio = fl(ratioS!);
    const d = new RAMDirectory();
    let vals: BigInt64Array = new BigInt64Array(0);
    for (let i = 0; i < cs.ops.length; i++) {
      const op = cs.ops[i]!;
      const p = op.split(" ");
      let got: string;
      try {
        switch (p[0]) {
          case "write": {
            vals = parseL(p[2]);
            const o = d.createOutput("x", IOContext.DEFAULT);
            const w = PackedInts.getWriter(o, n, bpv, ratio);
            for (const v of vals) w.add(v);
            let wo = w.bitsPerValue() + " " + w.ord();
            try {
              w.add(0n);
              wo += " added";
            } catch (e) {
              wo += " " + ex(e);
            }
            w.finish();
            o.close();
            const bytes = readAll(d, "x");
            got = wo + " " + bytes.length + " " + hexsB(bytes);
            break;
          }
          case "read": {
            const input = d.openInput("x", IOContext.DEFAULT);
            const rd = PackedInts.getReader(input);
            const g = new BigInt64Array(n);
            for (let k = 0; k < n; k++) g[k] = rd.get(k);
            got = strip(rd.toString()) + " " + rd.size() + " " + input.getFilePointer() + " " + rd.ramBytesUsed() + " " + hexsL(g);
            input.close();
            lastReader = rd;
            break;
          }
          case "rbulk": {
            const off = parseInt(p[2]!);
            const len = parseInt(p[3]!);
            const arr = new BigInt64Array(off + len);
            const ret = lastReader!.getBulk(parseInt(p[1]!), arr, off, len);
            got = ret + " " + hexsL(arr);
            break;
          }
          case "iter": {
            const input = d.openInput("x", IOContext.DEFAULT);
            try {
              const it = PackedInts.getReaderIterator(input, parseInt(p[1]!));
              let s = it.getBitsPerValue() + " " + it.size() + " ";
              const g2 = new BigInt64Array(n);
              let pos = 0;
              let single = true;
              while (pos < n) {
                if (single) {
                  g2[pos++] = it.next();
                } else {
                  const ref = it.nextRef(1 + ((pos * 7) % 70));
                  for (let k = 0; k < ref.length; k++) g2[pos++] = ref.longs[ref.offset + k]!;
                }
                single = pos % 3 === 0;
                s += it.ord() + ",";
              }
              try {
                it.next();
                s += "no-eof";
              } catch (e) {
                s += ex(e);
              }
              got = dig(s) + " " + hexsL(g2);
            } finally {
              input.close();
            }
            break;
          }
          case "direct": {
            const input = d.openInput("x", IOContext.DEFAULT);
            const dr = PackedInts.getDirectReader(input);
            const g3 = new BigInt64Array(n);
            for (let k = 0; k < n; k++) g3[k] = dr.get(n - 1 - k);
            g3.reverse();
            got = dr.size() + " " + dr.ramBytesUsed() + " " + hexsL(g3);
            input.close();
            break;
          }
          case "nohdr": {
            const ver = parseInt(p[1]!);
            const f = p[2] === "PACKED" ? PackedInts.Format.PACKED : PackedInts.Format.PACKED_SINGLE_BLOCK;
            const ebpv = parseInt(p[3]!);
            const d2 = new RAMDirectory();
            const o2 = d2.createOutput("y", IOContext.DEFAULT);
            const w2 = PackedInts.getWriterNoHeader(o2, f, n, ebpv, 777);
            const mask = PackedInts.maxValue(ebpv);
            const v2 = new BigInt64Array(n);
            for (let k = 0; k < n; k++) {
              v2[k] = BigInt.asIntN(64, vals[k]! & (ebpv === 64 ? -1n : mask));
              w2.add(v2[k]!);
            }
            w2.finish();
            const want = f.byteCount(PackedInts.VERSION_CURRENT, n, ebpv);
            const padded = f.byteCount(ver, n, ebpv);
            for (let k = want; k < padded; k++) o2.writeByte(0);
            o2.writeInt(0x12345678);
            o2.close();
            const b2 = readAll(d2, "y");
            let i2: IndexInput = d2.openInput("y", IOContext.DEFAULT);
            const r2 = PackedInts.getReaderNoHeader(i2, f, ver, n, ebpv);
            const g4 = new BigInt64Array(n);
            for (let k = 0; k < n; k++) g4[k] = r2.get(k);
            let s = strip(r2.toString()) + " fp=" + i2.getFilePointer() + " " + hexsL(g4) + " " + hexsB(b2);
            i2.close();
            i2 = d2.openInput("y", IOContext.DEFAULT);
            const it2 = PackedInts.getReaderIteratorNoHeader(i2, f, ver, n, ebpv, 300);
            const g5 = new BigInt64Array(n);
            for (let k = 0; k < n; k++) g5[k] = it2.next();
            s += " it:" + hexsL(g5) + " fp=" + i2.getFilePointer();
            i2.close();
            i2 = d2.openInput("y", IOContext.DEFAULT);
            const dr2 = PackedInts.getDirectReaderNoHeader(i2, f, ver, n, ebpv);
            const g6 = new BigInt64Array(n);
            for (let k = 0; k < n; k++) g6[k] = dr2.get(k);
            s += " dr:" + hexsL(g6) + " fp=" + i2.getFilePointer();
            i2.close();
            d2.close();
            got = s;
            break;
          }
          default:
            throw new Error(op);
        }
      } catch (e) {
        got = ex(e);
      }
      assert.equal(got, cs.out[i], `stream [${cs.c}] ${op.substring(0, 80)}`);
    }
    d.close();
  }
});
let lastReader: PackedIntsReader | null = null;

test("packed: PackedDataOutput / PackedDataInput", () => {
  for (const cs of golden["dataio"]!) {
    const buf = new Uint8Array(4096);
    const bo = new ByteArrayDataOutput(buf);
    const po = new PackedDataOutput(bo);
    let bi: ByteArrayDataInput | null = null;
    let pi: PackedDataInput | null = null;
    let data = new Uint8Array(0);
    for (let i = 0; i < cs.ops.length; i++) {
      const p = cs.ops[i]!.split(" ");
      let got: string;
      try {
        switch (p[0]) {
          case "wl":
            po.writeLong(H(p[2]!), parseInt(p[1]!));
            got = "ok";
            break;
          case "flush":
            po.flush();
            data = buf.slice(0, bo.getPosition());
            got = bo.getPosition() + "";
            break;
          case "bytes":
            bi = new ByteArrayDataInput(data);
            pi = new PackedDataInput(bi);
            got = bytesHex(data);
            break;
          case "rl":
            got = hx(pi!.readLong(parseInt(p[1]!)));
            break;
          case "skip":
            pi!.skipToNextByte();
            got = "ok";
            break;
          case "pos":
            got = bi!.getPosition() + "";
            break;
          default:
            throw new Error(cs.ops[i]);
        }
      } catch (e) {
        got = ex(e);
      }
      assert.equal(got, cs.out[i], `dataio #${i} ${cs.ops[i]}`);
    }
  }
});

test("packed: PackedInts.copy", () => {
  for (const cs of golden["copy"]!) {
    const p = cs.c.split(" ");
    const sn = parseInt(p[0]!);
    const dn = parseInt(p[1]!);
    const bpv = parseInt(p[2]!);
    const rs = fl(p[5]!);
    const rd = fl(p[6]!);
    const sv = parseL(p[7]);
    const dv = parseL(p[8]);
    const src = PackedInts.getMutable(sn, bpv, rs);
    const dst = PackedInts.getMutable(dn, bpv, rd);
    for (let i = 0; i < sn; i++) src.set(i, sv[i]!);
    for (let i = 0; i < dn; i++) dst.set(i, dv[i]!);
    const a = cs.ops[0]!.split(" ");
    PackedInts.copy(src, parseInt(a[1]!), dst, parseInt(a[2]!), parseInt(a[3]!), parseInt(a[4]!));
    const res = new BigInt64Array(dn);
    for (let i = 0; i < dn; i++) res[i] = dst.get(i);
    assert.equal(hexsL(res), cs.out[0], `copy [${cs.c.substring(0, 60)}]`);
  }
});
