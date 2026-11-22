/**
 * Differential tests for the small util classes ported in group 5: Float.toString / (int) casts (JavaNumbers),
 * SmallFloat, SloppyMath, NumericUtils, PriorityQueue, SentinelIntSet, MergedIterator, SetOnce, Counter, RefCount,
 * ToStringUtils and RamUsageEstimator.sizeOf. Expected values come from test/golden/util-small.json, produced by the
 * ORIGINAL Lucene 5.2.1 classes on the JDK (tools/golden/org/apache/lucene/util/GoldenUtilSmall.java).
 * Each case is {c: config, ops: [...], out: [...]}: the ops are replayed and every result string must be identical
 * ("EX:SimpleClassName:message" for exceptions; AIOOBE/NPE compared by class only).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ArrayIndexOutOfBoundsException, IOException, getMessage } from "../src/errors.js";
import { CRC32 } from "../src/zip/CRC32.js";
import { BytesRef } from "../src/util/BytesRef.js";
import { BytesRefBuilder } from "../src/util/BytesRefBuilder.js";
import { Counter } from "../src/util/Counter.js";
import { Double, Float, Integer, Long, doubleToInt, floatToString } from "../src/util/JavaNumbers.js";
import type { JavaIterator } from "../src/util/JavaIterator.js";
import { type Comparable, MergedIterator } from "../src/util/MergedIterator.js";
import { IntRangeBuilder, LongRangeBuilder, NumericUtils } from "../src/util/NumericUtils.js";
import { PriorityQueue } from "../src/util/PriorityQueue.js";
import { RamUsageEstimator } from "../src/util/RamUsageEstimator.js";
import { RefCount } from "../src/util/RefCount.js";
import { SentinelIntSet } from "../src/util/SentinelIntSet.js";
import { SetOnce } from "../src/util/SetOnce.js";
import { SloppyMath, sloppyMathTables } from "../src/util/SloppyMath.js";
import { SmallFloat } from "../src/util/SmallFloat.js";
import { StringBuilder } from "../src/util/StringBuilder.js";
import { ToStringUtils } from "../src/util/ToStringUtils.js";

/*
 * Deliberate deviation: SloppyMath.cos falls back to Math.cos for |a| > SIN_COS_MAX_VALUE_FOR_INT_MODULO. HotSpot
 * runs Math.cos as an intrinsic whose last bit can differ from fdlibm (V8's Math.cos), so those results are only
 * compared to within 1 ulp (and haversin, which uses them, to within 1e-6 km). Everything else is bit-exact.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Case {
  c: string;
  ops: string[];
  out: string[];
}
const golden: Record<string, Case[]> = JSON.parse(readFileSync(new URL("./golden/util-small.json", import.meta.url), "utf8"));

function ex(e: unknown): string {
  const err = e as Error;
  const name = err.constructor.name;
  if (e instanceof ArrayIndexOutOfBoundsException) return "EX:ArrayIndexOutOfBoundsException";
  return "EX:" + name + ":" + getMessage(err);
}

const dh = (d: number): string => BigInt.asUintN(64, Double.doubleToLongBits(d)).toString(16);
const fh = (f: number): string => (Float.floatToIntBits(f) >>> 0).toString(16);
const hexInt = (h: string): number => Number("0x" + h) | 0;
const hexLong = (h: string): bigint => BigInt.asIntN(64, BigInt("0x" + h));
const hexD = (h: string): number => Double.longBitsToDouble(hexLong(h));
const hexF = (h: string): number => Float.intBitsToFloat(hexInt(h));

function hex(b: Uint8Array, off: number, len: number): string {
  let s = "";
  for (let i = off; i < off + len; i++) s += b[i]!.toString(16).padStart(2, "0");
  return s;
}
function unhex(h: string): Uint8Array {
  const b = new Uint8Array(h.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(h.substring(2 * i, 2 * i + 2), 16);
  return b;
}
function dig(s: string): string {
  if (s.length <= 400) return s;
  const b = new TextEncoder().encode(s);
  const c = new CRC32();
  c.update(b, 0, b.length);
  return "d" + s.length + ":" + c.getValue().toString(16);
}
function crcOfDoubles(a: Float64Array): string {
  const c = new CRC32();
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  c.update(bytes, 0, bytes.length);
  return c.getValue().toString(16);
}

/** Runs every one-shot case of a section through f(config) and compares with out[0]. */
let goldenOut = "";
function single(section: string, f: (cfg: string) => string): void {
  const cases = golden[section]!;
  assert.ok(cases.length > 0);
  for (const cs of cases) {
    goldenOut = cs.out[0]!;
    let got: string;
    try {
      got = f(cs.c);
    } catch (e) {
      got = ex(e);
    }
    assert.equal(got, cs.out[0], `${section} ${cs.c}`);
  }
}

test("Float.toString and the (int) cast", () => {
  single("floatToString", (c) => floatToString(hexF(c)));
  single("doubleToInt", (c) => String(doubleToInt(hexD(c))));
});

test("SmallFloat", () => {
  for (const cs of golden["smallFloat"]!) {
    if (cs.c === "bytes") {
      const out: string[] = [];
      for (let b = 0; b < 256; b++) {
        out.push(
          [
            b,
            fh(SmallFloat.byte315ToFloat(b)),
            fh(SmallFloat.byte52ToFloat(b)),
            fh(SmallFloat.byteToFloat(b, 4, 10)),
            fh(SmallFloat.byteToFloat(b, 3, 15)),
            fh(SmallFloat.byteToFloat(b, 5, 2)),
            fh(SmallFloat.byteToFloat(b, 6, 0)),
          ].join(":")
        );
      }
      assert.deepEqual(out, cs.out);
      continue;
    }
    const f = hexF(cs.c);
    const got = [
      SmallFloat.floatToByte315(f),
      SmallFloat.floatToByte52(f),
      SmallFloat.floatToByte(f, 4, 10),
      SmallFloat.floatToByte(f, 3, 15),
      SmallFloat.floatToByte(f, 5, 2),
      SmallFloat.floatToByte(f, 6, 0),
      SmallFloat.floatToByte(f, 1, 7),
      SmallFloat.floatToByte(f, 7, -3),
    ].map((x) => String(x & 0xff));
    assert.deepEqual(got, cs.out, cs.c);
  }
});

test("SloppyMath (tables and functions bit for bit)", () => {
  single("sloppy", (c) => {
    const [kind, arg = ""] = [c.substring(0, c.indexOf(":")), c.substring(c.indexOf(":") + 1)];
    if (c === "maxForIntModulo") return dh(SloppyMath.SIN_COS_MAX_VALUE_FOR_INT_MODULO);
    if (kind === "table") {
      const t = (sloppyMathTables as any)[arg] as Float64Array;
      return t.length + ":" + crcOfDoubles(t);
    }
    if (kind === "cos") {
      const x = hexD(arg);
      const got = SloppyMath.cos(x);
      if (Math.abs(x) > SloppyMath.SIN_COS_MAX_VALUE_FOR_INT_MODULO && Number.isFinite(x)) {
        const want = hexD(goldenOut);
        const diff = Double.doubleToLongBits(got) - Double.doubleToLongBits(want);
        if (diff <= 1n && diff >= -1n) return goldenOut;
      }
      return dh(got);
    }
    if (kind === "asin") return dh(SloppyMath.asin(hexD(arg)));
    if (kind === "diam") return dh(SloppyMath.earthDiameter(hexD(arg)));
    if (c === "hav:poles") {
      return [SloppyMath.haversin(90, 0, -90, 0), SloppyMath.haversin(0, -180, 0, 180), SloppyMath.haversin(0, 0, 0, 0)].map(dh).join(",");
    }
    if (kind === "hav") {
      const [a, b, cc, d] = arg.split(",").map(hexD) as [number, number, number, number];
      const got = SloppyMath.haversin(a, b, cc, d);
      const lim = SloppyMath.SIN_COS_MAX_VALUE_FOR_INT_MODULO;
      const R = Math.PI / 180;
      const args = [a * R, cc * R, a * R - cc * R, (b - d) * R].map(Math.abs);
      if (args.some((x) => x > lim) && Number.isFinite(got)) {
        const want = hexD(goldenOut);
        if (Math.abs(got - want) <= 1e-6) return goldenOut;
      }
      return dh(got);
    }
    throw new Error("unknown case " + c);
  });
});

class LRec extends LongRangeBuilder {
  o = "";
  override addRange(min: bigint, max: bigint, shift: number): void {
    this.o += min + ":" + max + ":" + shift + ";";
  }
}
class LBytes extends LongRangeBuilder {
  o = "";
  override addRangeBytes(a: BytesRef, b: BytesRef): void {
    this.o += hex(a.bytes, a.offset, a.length) + ":" + hex(b.bytes, b.offset, b.length) + ";";
  }
}
class IRec extends IntRangeBuilder {
  o = "";
  override addRange(min: number, max: number, shift: number): void {
    this.o += min + ":" + max + ":" + shift + ";";
  }
}
class IBytes extends IntRangeBuilder {
  o = "";
  override addRangeBytes(a: BytesRef, b: BytesRef): void {
    this.o += hex(a.bytes, a.offset, a.length) + ":" + hex(b.bytes, b.offset, b.length) + ";";
  }
}
class LNone extends LongRangeBuilder {}

function t<T>(f: () => T): string {
  try {
    return String(f());
  } catch (e) {
    return ex(e);
  }
}

test("NumericUtils", () => {
  for (const cs of golden["numeric"]!) {
    const c = cs.c;
    const colon = c.indexOf(":");
    const kind = c.substring(0, colon);
    const arg = c.substring(colon + 1);
    let got: string[];
    if (kind === "long") {
      const [v, shift] = arg.split(",") as [string, string];
      got = [
        (() => {
          const b = new BytesRefBuilder();
          try {
            NumericUtils.longToPrefixCoded(BigInt(v), Number(shift), b);
            const ref = b.get();
            let s = hex(ref.bytes, ref.offset, ref.length) + "|" + ref.offset;
            try {
              s += "|" + NumericUtils.getPrefixCodedLongShift(ref) + "|" + NumericUtils.prefixCodedToLong(ref);
            } catch (e) {
              s += "|" + ex(e);
            }
            return s;
          } catch (e) {
            return ex(e);
          }
        })(),
      ];
    } else if (kind === "int") {
      const [v, shift] = arg.split(",") as [string, string];
      got = [
        (() => {
          const b = new BytesRefBuilder();
          try {
            NumericUtils.intToPrefixCoded(Number(v), Number(shift), b);
            const ref = b.get();
            let s = hex(ref.bytes, ref.offset, ref.length) + "|" + ref.offset;
            try {
              s += "|" + NumericUtils.getPrefixCodedIntShift(ref) + "|" + NumericUtils.prefixCodedToInt(ref);
            } catch (e) {
              s += "|" + ex(e);
            }
            return s;
          } catch (e) {
            return ex(e);
          }
        })(),
      ];
    } else if (kind === "dec") {
      let ref: BytesRef;
      if (arg === "emptyArray") ref = new BytesRef(new Uint8Array(0), 0, 0);
      else {
        const [h, off, len] = arg.split(",") as [string, string, string];
        ref = new BytesRef(unhex(h), Number(off), Number(len));
      }
      got = [
        [
          t(() => NumericUtils.getPrefixCodedLongShift(ref)),
          t(() => NumericUtils.getPrefixCodedIntShift(ref)),
          t(() => NumericUtils.prefixCodedToLong(ref)),
          t(() => NumericUtils.prefixCodedToInt(ref)),
        ].join("|"),
      ];
    } else if (kind === "d2s") {
      const d = hexD(arg);
      const sl = NumericUtils.doubleToSortableLong(d);
      got = [sl + "|" + dh(NumericUtils.sortableLongToDouble(sl)) + "|" + NumericUtils.sortableDoubleBits(sl)];
    } else if (kind === "s2d") {
      const raw = BigInt(arg);
      got = [dh(NumericUtils.sortableLongToDouble(raw)) + "|" + NumericUtils.sortableDoubleBits(raw)];
    } else if (kind === "f2s") {
      const f = hexF(arg);
      const si = NumericUtils.floatToSortableInt(f);
      got = [si + "|" + fh(NumericUtils.sortableIntToFloat(si)) + "|" + NumericUtils.sortableFloatBits(si)];
    } else if (kind === "s2f") {
      const raw = Number(arg);
      got = [fh(NumericUtils.sortableIntToFloat(raw)) + "|" + NumericUtils.sortableFloatBits(raw)];
    } else if (kind === "L") {
      const [step, min, max] = arg.split(",") as [string, string, string];
      got = [
        t(() => {
          const b = new LRec();
          NumericUtils.splitLongRange(b, Number(step), BigInt(min), BigInt(max));
          return dig(b.o);
        }),
        t(() => {
          const b = new LBytes();
          NumericUtils.splitLongRange(b, Number(step), BigInt(min), BigInt(max));
          return dig(b.o);
        }),
        t(() => {
          NumericUtils.splitLongRange(new LNone(), Number(step), BigInt(min), BigInt(max));
          return "none-ok";
        }),
      ];
    } else if (kind === "I") {
      const [step, min, max] = arg.split(",") as [string, string, string];
      got = [
        t(() => {
          const b = new IRec();
          NumericUtils.splitIntRange(b, Number(step), Number(min), Number(max));
          return dig(b.o);
        }),
        t(() => {
          const b = new IBytes();
          NumericUtils.splitIntRange(b, Number(step), Number(min), Number(max));
          return dig(b.o);
        }),
      ];
    } else throw new Error("unknown case " + c);
    assert.deepEqual(got, cs.out, c);
  }
});

class Box {
  constructor(
    public v: number,
    readonly id: number
  ) {}
}
let SENTINEL_MODE = false;
class PQ extends PriorityQueue<Box> {
  protected override lessThan(a: Box, b: Box): boolean {
    return a.v < b.v;
  }
  protected override getSentinelObject(): Box | null {
    return SENTINEL_MODE ? new Box(-2147483648, -1) : null;
  }
}
const bx = (b: Box | null): string => (b === null ? "null" : (b.id < 0 ? "S" : "") + b.v);

test("PriorityQueue", () => {
  for (const cs of golden["priorityQueue"]!) {
    const [max, pre, sent] = cs.c.split(",") as [string, string, string];
    SENTINEL_MODE = sent === "true";
    let q: PQ;
    try {
      q = new PQ(Number(max), pre === "true");
    } catch (e) {
      assert.equal(ex(e), cs.out[0], cs.c);
      continue;
    }
    const made: Box[] = [];
    const out: string[] = [];
    for (const op of cs.ops) {
      const [name, a] = op.split(" ") as [string, string | undefined];
      const val = Number(a);
      try {
        switch (name) {
          case "add": {
            const b = new Box(val, made.length);
            made.push(b);
            out.push(bx(q.add(b)));
            break;
          }
          case "ins": {
            const b = new Box(val, made.length);
            made.push(b);
            out.push(bx(q.insertWithOverflow(b)));
            break;
          }
          case "pop":
            out.push(bx(q.pop()));
            break;
          case "top":
            out.push(bx(q.top()));
            break;
          case "upd": {
            const top = q.top();
            if (top !== null) top.v = val;
            out.push(bx(q.updateTop()));
            break;
          }
          case "updn": {
            const b = new Box(val, made.length);
            made.push(b);
            out.push(bx(q.updateTop(b)));
            break;
          }
          case "rm":
            out.push(String(made.length === 0 ? q.remove(null as any) : q.remove(made[val]!)));
            break;
          case "size":
            out.push(String(q.size()));
            break;
          case "clear":
            q.clear();
            out.push("ok");
            break;
          case "heap": {
            let st = "";
            for (const o of q.getHeapArray()) st += (o === null ? "_" : bx(o)) + " ";
            out.push(st);
            break;
          }
          default:
            throw new Error("op " + op);
        }
      } catch (e) {
        out.push(ex(e));
      }
    }
    assert.deepEqual(out, cs.out, cs.c);
  }
});

test("SentinelIntSet", () => {
  for (const cs of golden["sentinelIntSet"]!) {
    const [size, empty, bad] = cs.c.split(",") as [string, string, string];
    const bh = bad === "true";
    class S extends SentinelIntSet {
      override hash(key: number): number {
        return bh ? Math.imul(key, 8) | (key >> 3) : key;
      }
    }
    let s: S;
    try {
      s = new S(Number(size), Number(empty));
    } catch (e) {
      assert.equal(ex(e), cs.out[0], cs.c);
      continue;
    }
    const out: string[] = [];
    for (const op of cs.ops) {
      const [name, a] = op.split(" ") as [string, string | undefined];
      const key = Number(a);
      try {
        switch (name) {
          case "put":
            out.push(String(s.put(key)));
            break;
          case "exists":
            out.push(String(s.exists(key)));
            break;
          case "find":
            out.push(String(s.find(key)));
            break;
          case "slot":
            out.push(String(s.getSlot(key)));
            break;
          case "size":
            out.push(s.size() + "/" + s.rehashCount + "/" + s.keys.length + "/" + s.ramBytesUsed());
            break;
          case "clear":
            s.clear();
            out.push("ok");
            break;
          case "keys": {
            let st = "";
            for (const v of s.keys) st += v + " ";
            out.push(dig(st));
            break;
          }
          default:
            throw new Error("op " + op);
        }
      } catch (e) {
        out.push(ex(e));
      }
    }
    assert.deepEqual(out, cs.out, cs.c);
  }
});

class JInt implements Comparable<JInt> {
  constructor(readonly v: number) {}
  compareTo(o: JInt): number {
    return this.v < o.v ? -1 : this.v > o.v ? 1 : 0;
  }
  equals(o: unknown): boolean {
    return o instanceof JInt && o.v === this.v;
  }
}
function iter(a: number[]): JavaIterator<JInt> {
  let i = 0;
  return {
    hasNext: () => i < a.length,
    next: () => new JInt(a[i++]!),
    remove: () => {
      throw new Error("unused");
    },
  };
}

test("MergedIterator", () => {
  for (const cs of golden["mergedIterator"]!) {
    const [mode, rest] = cs.c.split(";") as [string, string];
    const pieces = rest.split("|");
    pieces.pop();
    const its = pieces.map((p) => iter(p === "" ? [] : p.split(",").filter((x) => x !== "").map(Number)));
    const mi = mode === "0" ? new MergedIterator<JInt>(...its) : new MergedIterator<JInt>(mode === "1", ...its);
    const out: string[] = [];
    for (const op of cs.ops) {
      try {
        if (op === "h") out.push(String(mi.hasNext()));
        else if (op === "n") out.push(String(mi.next().v));
        else {
          mi.remove();
          out.push("ok");
        }
      } catch (e) {
        out.push(ex(e));
      }
    }
    assert.deepEqual(out, cs.out, cs.c);
  }
});

test("small classes", () => {
  for (const cs of golden["small"]!) {
    const c = cs.c;
    const colon = c.indexOf(":");
    const kind = colon < 0 ? c : c.substring(0, colon);
    const arg = colon < 0 ? "" : c.substring(colon + 1);
    const out: string[] = [];
    const run = (f: () => string): void => {
      try {
        out.push(f());
      } catch (e) {
        out.push(ex(e));
      }
    };
    switch (kind) {
      case "boost":
        out.push(ToStringUtils.boost(hexF(arg)));
        break;
      case "bytes": {
        const s = new StringBuilder();
        s.append("x");
        ToStringUtils.byteArray(s, unhex(arg));
        out.push(s.toString());
        break;
      }
      case "longHex":
        out.push(ToStringUtils.longHex(BigInt(arg)));
        break;
      case "setOnce": {
        const so = new SetOnce<string>();
        out.push(String(so.get()));
        so.set("a");
        out.push("ok");
        out.push(String(so.get()));
        run(() => (so.set("b"), "ok"));
        run(() => (so.set(null), "ok"));
        break;
      }
      case "setOnceInit": {
        const so = new SetOnce<string>("init");
        out.push(String(so.get()));
        run(() => (so.set("b"), "ok"));
        break;
      }
      case "setOnceNull": {
        const so = new SetOnce<string>(null);
        out.push(String(so.get()));
        run(() => (so.set("b"), "ok"));
        break;
      }
      case "counter": {
        for (const ts of [false, true]) {
          const k = Counter.newCounter(ts);
          out.push(String(k.get()));
          for (const d of [1, 5, -3, 1000000, -7, 0]) out.push(String(k.addAndGet(d)));
        }
        out.push(String(Counter.newCounter().addAndGet(41)));
        break;
      }
      case "refCount": {
        const log: string[] = [];
        class RC extends RefCount<string> {
          protected override release(): void {
            log.push("release");
            if (log.length === 1) throw new IOException("boom");
          }
        }
        const rc = new RC("obj");
        out.push(String(rc.getRefCount()));
        out.push(rc.get());
        run(() => (rc.incRef(), "ok"));
        out.push(String(rc.getRefCount()));
        for (let i = 0; i < 4; i++) {
          run(() => (rc.decRef(), "ok"));
          out.push(rc.getRefCount() + "/" + log.length);
        }
        run(() => (rc.incRef(), "ok"));
        break;
      }
      case "ramUsage": {
        for (let n = 0; n < 70; n++) {
          out.push(
            [
              RamUsageEstimator.sizeOf(new Uint8Array(n)),
              RamUsageEstimator.sizeOf(new Uint16Array(n)),
              RamUsageEstimator.sizeOf(new Int16Array(n)),
              RamUsageEstimator.sizeOf(new Int32Array(n)),
              RamUsageEstimator.sizeOf(new Float32Array(n)),
              RamUsageEstimator.sizeOf(new BigInt64Array(n)),
              RamUsageEstimator.sizeOf(new Float64Array(n)),
              RamUsageEstimator.alignObjectSize(n),
              RamUsageEstimator.alignObjectSize(n * 1000 + 3),
            ].join(",")
          );
        }
        break;
      }
      default:
        throw new Error("unknown case " + c);
    }
    assert.deepEqual(out, cs.out, c);
  }
  void Integer;
  void Long;
});
