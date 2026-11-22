/**
 * Differential tests for FixedBitSet, LongBitSet, SparseFixedBitSet, BitSet's leap-frog operations, BitSetIterator,
 * BitDocIdSet(+Builder), DocIdSet.EMPTY and DocIdSetIterator.empty()/all(). Expected values come from
 * test/golden/bitsets.json, produced by the ORIGINAL Lucene 5.2.1 classes with assertions enabled
 * (tools/golden/org/apache/lucene/util/GoldenBitSets.java). Each case is {c: config, ops: [...], out: [...]}.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ArrayIndexOutOfBoundsException, getMessage } from "../src/errors.js";
import { CRC32 } from "../src/zip/CRC32.js";
import { DocIdSet } from "../src/search/DocIdSet.js";
import { DocIdSetIterator } from "../src/search/DocIdSetIterator.js";
import { BitDocIdSet } from "../src/util/BitDocIdSet.js";
import type { BitSet } from "../src/util/BitSet.js";
import { BitSetIterator } from "../src/util/BitSetIterator.js";
import { FixedBitSet } from "../src/util/FixedBitSet.js";
import { LongBitSet } from "../src/util/LongBitSet.js";
import { SparseFixedBitSet } from "../src/util/SparseFixedBitSet.js";

interface Case {
  c: string;
  ops: string[];
  out: string[];
}
const golden: Record<string, Case[]> = JSON.parse(readFileSync(new URL("./golden/bitsets.json", import.meta.url), "utf8"));

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
function words(w: BigInt64Array): string {
  let s = "";
  for (const x of w) s += BigInt.asUintN(64, x).toString(16) + " ";
  return dig(s);
}

/** Iterator over a sorted array of docs, with an explicit cost (same as the Java harness). */
class IntIt extends DocIdSetIterator {
  i = -1;
  doc = -1;
  constructor(
    readonly docs: number[],
    readonly _cost: number
  ) {
    super();
  }
  docID(): number {
    return this.doc;
  }
  nextDoc(): number {
    this.i++;
    return (this.doc = this.i < this.docs.length ? this.docs[this.i]! : DocIdSetIterator.NO_MORE_DOCS);
  }
  advance(target: number): number {
    let d: number;
    do {
      d = this.nextDoc();
    } while (d < target);
    return d;
  }
  cost(): number {
    return this._cost;
  }
  slow(target: number): number {
    return this.slowAdvance(target);
  }
}

/** "d1,d2,;cost;p" */
function parseSpec(spec: string): { docs: number[]; cost: number; positioned: boolean } {
  const [d, cost, p] = spec.split(";") as [string, string, string];
  return { docs: d.split(",").filter((x) => x !== "").map(Number), cost: Number(cost), positioned: p === "p" };
}
function mk(spec: string): IntIt {
  const { docs, cost, positioned } = parseSpec(spec);
  const it = new IntIt(docs, cost);
  if (positioned) it.nextDoc();
  return it;
}
function listIt(it: DocIdSetIterator): string {
  let o = "";
  let d: number;
  let cnt = 0;
  while ((d = it.nextDoc()) !== DocIdSetIterator.NO_MORE_DOCS && cnt++ < 100000) o += d + " ";
  return dig(o);
}
const rest = (op: string): string => op.substring(op.indexOf(" ") + 1);

test("FixedBitSet", () => {
  for (const cs of golden["fixedBitSet"]!) {
    if (cs.c === "ctors") continue;
    const [n, m] = cs.c.split(",").map(Number) as [number, number];
    let A: FixedBitSet;
    let B: FixedBitSet;
    const out: string[] = [];
    try {
      A = new FixedBitSet(n);
      B = new FixedBitSet(m);
    } catch (e) {
      assert.deepEqual([ex(e)], cs.out, cs.c);
      continue;
    }
    const dump = (): string => A.length() + "/" + A.cardinality() + "/" + A.hashCode() + "/" + words(A.getBits()) + "/" + words(B.getBits());
    for (const op of cs.ops) {
      const p = op.split(" ");
      const name = p[0]!;
      const x = Number(p[1]);
      const y = Number(p[2]);
      let res = "ok";
      try {
        switch (name) {
          case "setB":
            if (p.length === 3) B.set(x, y);
            else B.set(x);
            break;
          case "set":
            if (p.length === 3) A.set(x, y);
            else A.set(x);
            break;
          case "clear":
            if (p.length === 3) A.clear(x, y);
            else A.clear(x);
            break;
          case "flip":
            if (p.length === 3) A.flip(x, y);
            else A.flip(x);
            break;
          case "get":
            res = String(A.get(x));
            break;
          case "getAndSet":
            res = String(A.getAndSet(x));
            break;
          case "getAndClear":
            res = String(A.getAndClear(x));
            break;
          case "next":
            res = String(A.nextSetBit(x));
            break;
          case "prev":
            res = String(A.prevSetBit(x));
            break;
          case "card":
            res = String(A.cardinality());
            break;
          case "scanEmpty":
            res = String(A.scanIsEmpty());
            break;
          case "intersects":
            res = String(A.intersects(B));
            break;
          case "or":
            A.or(B);
            break;
          case "xor":
            A.xor(B);
            break;
          case "and":
            A.and(B);
            break;
          case "andNot":
            A.andNot(B);
            break;
          case "orBIt":
            A.or(new BitSetIterator(B, 7));
            break;
          case "xorBIt":
            A.xor(new BitSetIterator(B, 7));
            break;
          case "andBIt":
            A.and(new BitSetIterator(B, 7));
            break;
          case "andNotBIt":
            A.andNot(new BitSetIterator(B, 7));
            break;
          case "orIt":
            A.or(mk(rest(op)));
            break;
          case "xorIt":
            A.xor(mk(rest(op)));
            break;
          case "andIt":
            A.and(mk(rest(op)));
            break;
          case "andNotIt":
            A.andNot(mk(rest(op)));
            break;
          case "equalsB":
            res = String(A.equals(B));
            break;
          case "cloneEq": {
            const cl = A.clone();
            res = A.equals(cl) + "/" + cl.hashCode() + "/" + (cl !== A) + "/" + words(cl.getBits());
            break;
          }
          case "static":
            res = [
              FixedBitSet.intersectionCount(A, B),
              FixedBitSet.unionCount(A, B),
              FixedBitSet.andNotCount(A, B),
              FixedBitSet.unionCount(B, A),
              FixedBitSet.andNotCount(B, A),
            ].join("/");
            break;
          case "ensure": {
            const e = FixedBitSet.ensureCapacity(A, x);
            res = e === A ? "true" : "false";
            res += "/" + e.length() + "/" + e.getBits().length;
            A = e;
            break;
          }
          case "ram":
            res = A.ramBytesUsed() + "/" + B.ramBytesUsed();
            break;
          case "hash":
            res = A.hashCode() + "/" + A.length() + "/" + B.hashCode();
            break;
          case "dump":
            res = dump();
            break;
          default:
            throw new Error("unknown op " + op);
        }
      } catch (e) {
        res = ex(e);
      }
      out.push(res);
    }
    assert.deepEqual(out, cs.out, cs.c);
  }
});

test("FixedBitSet constructors and bits2words", () => {
  const cs = golden["fixedBitSet"]!.find((c) => c.c === "ctors")!;
  const out: string[] = [];
  for (const op of cs.ops) {
    const p = op.split(" ");
    const a = Number(p[1]);
    const b = Number(p[2]);
    try {
      switch (p[0]) {
        case "ctor": {
          const w = new BigInt64Array(a);
          const f = new FixedBitSet(w, b);
          out.push(f.length() + "/" + f.cardinality() + "/" + (f.getBits() === w));
          break;
        }
        case "ghost": {
          const w = new BigInt64Array(a);
          w[a - 1] = -1n;
          const f = new FixedBitSet(w, b);
          out.push(f.length() + "/" + f.cardinality());
          break;
        }
        case "new": {
          const f = new FixedBitSet(a);
          out.push(f.length() + "/" + f.getBits().length + "/" + f.ramBytesUsed());
          break;
        }
        case "b2w":
          out.push(String(FixedBitSet.bits2words(a)));
          break;
        default:
          throw new Error(op);
      }
    } catch (e) {
      out.push(ex(e));
    }
  }
  assert.deepEqual(out, cs.out);
});

test("LongBitSet", () => {
  for (const cs of golden["longBitSet"]!) {
    if (cs.c === "ctors") continue;
    const [n, m] = cs.c.split(",").map(Number) as [number, number];
    let A = new LongBitSet(n);
    const B = new LongBitSet(m);
    const out: string[] = [];
    for (const op of cs.ops) {
      const p = op.split(" ");
      const name = p[0]!;
      const x = Number(p[1]);
      const y = Number(p[2]);
      let res = "ok";
      try {
        switch (name) {
          case "setB":
            B.set(x, y);
            break;
          case "setB1":
            B.set(x);
            break;
          case "set":
            if (p.length === 3) A.set(x, y);
            else A.set(x);
            break;
          case "clear":
            if (p.length === 3) A.clear(x, y);
            else A.clear(x);
            break;
          case "flip":
            if (p.length === 3) A.flip(x, y);
            else A.flip(x);
            break;
          case "get":
            res = String(A.get(x));
            break;
          case "getAndSet":
            res = String(A.getAndSet(x));
            break;
          case "getAndClear":
            res = String(A.getAndClear(x));
            break;
          case "next":
            res = String(A.nextSetBit(x));
            break;
          case "prev":
            res = String(A.prevSetBit(x));
            break;
          case "card":
            res = String(A.cardinality());
            break;
          case "scanEmpty":
            res = String(A.scanIsEmpty());
            break;
          case "intersects":
            res = String(A.intersects(B));
            break;
          case "or":
            A.or(B);
            break;
          case "xor":
            A.xor(B);
            break;
          case "and":
            A.and(B);
            break;
          case "andNot":
            A.andNot(B);
            break;
          case "equalsB":
            res = String(A.equals(B));
            break;
          case "cloneEq": {
            const cl = A.clone();
            res = A.equals(cl) + "/" + cl.hashCode() + "/" + words(cl.getBits());
            break;
          }
          case "ensure": {
            const e = LongBitSet.ensureCapacity(A, x);
            res = (e === A ? "true" : "false") + "/" + e.length() + "/" + e.getBits().length;
            A = e;
            break;
          }
          case "hash":
            res = A.hashCode() + "/" + A.length() + "/" + B.hashCode();
            break;
          case "dump":
            res = A.length() + "/" + A.cardinality() + "/" + A.hashCode() + "/" + words(A.getBits()) + "/" + words(B.getBits());
            break;
          default:
            throw new Error("unknown op " + op);
        }
      } catch (e) {
        res = ex(e);
      }
      out.push(res);
    }
    assert.deepEqual(out, cs.out, cs.c);
  }
  const cs = golden["longBitSet"]!.find((c) => c.c === "ctors")!;
  const out: string[] = [];
  for (const op of cs.ops) {
    const p = op.split(" ");
    const a = Number(p[1]);
    const b = Number(p[2]);
    try {
      if (p[0] === "ctor") {
        const w = new BigInt64Array(a);
        const f = new LongBitSet(w, b);
        out.push(f.length() + "/" + f.cardinality() + "/" + (f.getBits() === w));
      } else out.push(String(LongBitSet.bits2words(a)));
    } catch (e) {
      out.push(ex(e));
    }
  }
  assert.deepEqual(out, cs.out);
});

function listSparse(s: SparseFixedBitSet): string {
  let o = "";
  const len = s.length();
  let i = s.nextSetBit(0);
  let count = 0;
  while (i !== DocIdSetIterator.NO_MORE_DOCS && count++ < 100000) {
    o += i + " ";
    if (i + 1 >= len) break;
    i = s.nextSetBit(i + 1);
  }
  o += "|";
  let p = s.prevSetBit(len - 1);
  count = 0;
  while (p >= 0 && count++ < 100000) {
    o += p + " ";
    if (p === 0) break;
    p = s.prevSetBit(p - 1);
  }
  return dig(o);
}
function dumpSparse(s: SparseFixedBitSet): string {
  let approx: string;
  try {
    approx = String(s.approximateCardinality());
  } catch (e) {
    approx = ex(e);
  }
  return s.length() + "/" + s.cardinality() + "/" + approx + "/" + s.ramBytesUsed() + "/" + s.nonZeroLongCount + "/" + listSparse(s);
}

test("SparseFixedBitSet", () => {
  for (const cs of golden["sparseFixedBitSet"]!) {
    if (cs.c === "ctors") continue;
    const [n, m] = cs.c.split(",").map(Number) as [number, number];
    const A = new SparseFixedBitSet(n);
    const B = new SparseFixedBitSet(m);
    const out: string[] = [];
    for (const op of cs.ops) {
      const p = op.split(" ");
      const name = p[0]!;
      const x = Number(p[1]);
      const y = Number(p[2]);
      let res = "ok";
      try {
        switch (name) {
          case "setMany":
            for (const v of p[1]!.split(",").filter((q) => q !== "")) A.set(Number(v));
            break;
          case "setManyB":
            for (const v of p[1]!.split(",").filter((q) => q !== "")) B.set(Number(v));
            break;
          case "set":
            A.set(x);
            break;
          case "clear":
            if (p.length === 3) A.clear(x, y);
            else A.clear(x);
            break;
          case "get":
            res = String(A.get(x));
            break;
          case "next":
            res = String(A.nextSetBit(x));
            break;
          case "prev":
            res = String(A.prevSetBit(x));
            break;
          case "card":
            res = A.cardinality() + "/" + A.approximateCardinality();
            break;
          case "orIt":
            A.or(mk(rest(op)));
            break;
          case "andIt":
            A.and(mk(rest(op)));
            break;
          case "andNotIt":
            A.andNot(mk(rest(op)));
            break;
          case "orB":
            A.or(new BitSetIterator(B, 1));
            break;
          case "andB":
            A.and(new BitSetIterator(B, 1));
            break;
          case "andNotB":
            A.andNot(new BitSetIterator(B, 1));
            break;
          case "ram":
            res = A.ramBytesUsed() + "/" + B.ramBytesUsed();
            break;
          case "str":
            res = A.toString();
            break;
          case "orFixed": {
            const { docs } = parseSpec(rest(op));
            const f = new FixedBitSet(Math.min(n, 50000));
            for (const v of docs) f.set(v);
            A.or(new BitSetIterator(f, docs.length));
            break;
          }
          case "dump":
            res = dumpSparse(A);
            break;
          case "dumpB":
            res = dumpSparse(B);
            break;
          default:
            throw new Error("unknown op " + op);
        }
      } catch (e) {
        res = ex(e);
      }
      out.push(res);
    }
    assert.deepEqual(out, cs.out, cs.c);
  }
  const cs = golden["sparseFixedBitSet"]!.find((c) => c.c === "ctors")!;
  const out: string[] = [];
  for (const op of cs.ops) {
    try {
      const s = new SparseFixedBitSet(Number(op.split(" ")[1]));
      out.push(s.length() + "/" + s.ramBytesUsed() + "/" + s.cardinality() + "/" + s.approximateCardinality());
    } catch (e) {
      out.push(ex(e));
    }
  }
  assert.deepEqual(out, cs.out);
});

test("BitSetIterator, DocIdSetIterator.empty()/all(), DocIdSet.EMPTY", () => {
  for (const cs of golden["iterators"]!) {
    const out: string[] = [];
    let it: DocIdSetIterator;
    let slow: IntIt | null = null;
    const head = cs.c.split(" ")[0]!;
    if (cs.c === "empty") {
      // DocIdSet.EMPTY
      for (const op of cs.ops) {
        try {
          switch (op) {
            case "cacheable":
              out.push(String(DocIdSet.EMPTY.isCacheable()));
              break;
            case "bits":
              out.push(String(DocIdSet.EMPTY.bits()));
              break;
            case "ram":
              out.push(String(DocIdSet.EMPTY.ramBytesUsed()));
              break;
            case "children":
              out.push(String(DocIdSet.EMPTY.getChildResources().length));
              break;
            case "sameInstance":
              out.push(String(DocIdSet.EMPTY === DocIdSet.EMPTY));
              break;
            default:
              throw new Error(op);
          }
        } catch (e) {
          out.push(ex(e));
        }
      }
      assert.deepEqual(out, cs.out, cs.c);
      continue;
    }
    if (head === "all") {
      it = DocIdSetIterator.all(Number(cs.c.split(" ")[1]));
    } else if (head === "empty") {
      it = DocIdSetIterator.empty();
    } else if (head === "slow") {
      slow = mk(cs.c.substring(5));
      it = slow;
    } else {
      const parts = cs.c.split(",");
      const [n, sparse, cost] = parts as [string, string, string];
      const { docs } = parseSpec(parts.slice(3).join(","));
      let bs: BitSet;
      if (sparse === "true") {
        const s = new SparseFixedBitSet(Number(n));
        for (const v of docs) s.set(v);
        bs = s;
      } else {
        const f = new FixedBitSet(Number(n));
        for (const v of docs) f.set(v);
        bs = f;
      }
      it = new BitSetIterator(bs, Number(cost));
    }
    for (const op of cs.ops) {
      const p = op.split(" ");
      try {
        switch (p[0]) {
          case "fixedOrNull":
            out.push(
              [
                BitSetIterator.getFixedBitSetOrNull(it) !== null,
                BitSetIterator.getSparseFixedBitSetOrNull(it) !== null,
                BitSetIterator.getFixedBitSetOrNull(DocIdSetIterator.empty()) !== null,
                BitSetIterator.getSparseFixedBitSetOrNull(new IntIt([], 0)) !== null,
              ].join("/")
            );
            break;
          case "doc":
            out.push(String(it.docID()));
            break;
          case "cost":
            out.push(String(it.cost()));
            break;
          case "adv":
            out.push(String(it.advance(Number(p[1]))));
            break;
          case "next":
            out.push(String(it.nextDoc()));
            break;
          case "slow":
            out.push(String(slow!.slow(Number(p[1]))));
            break;
          default:
            throw new Error("unknown op " + op);
        }
      } catch (e) {
        out.push(ex(e));
      }
    }
    assert.deepEqual(out, cs.out, cs.c);
  }
});

test("BitDocIdSet and its Builder", () => {
  for (const cs of golden["bitDocIdSetBuilder"]!) {
    const out: string[] = [];
    if (cs.c === "direct") {
      for (const op of cs.ops) {
        const [, n, sp, explicit, cost, spec] = op.split(" ") as [string, string, string, string, string, string];
        const { docs } = parseSpec(spec);
        let bs: BitSet;
        if (sp === "true") {
          const s = new SparseFixedBitSet(Number(n));
          for (const v of docs) s.set(v);
          bs = s;
        } else {
          const f = new FixedBitSet(Number(n));
          for (const v of docs) f.set(v);
          bs = f;
        }
        const s = explicit === "true" ? new BitDocIdSet(bs, Number(cost)) : new BitDocIdSet(bs);
        const it = s.iterator();
        out.push(
          it.cost() + "/" + s.ramBytesUsed() + "/" + listIt(it) + "/" + s.bits().length() + "/" + (sp === "true" ? s.toString() : "dense") + "/" + s.getChildResources().length
        );
      }
      assert.deepEqual(out, cs.out, cs.c);
      continue;
    }
    const [maxDoc, full] = cs.c.split(",") as [string, string];
    const b = new BitDocIdSet.Builder(Number(maxDoc), full === "true");
    for (const op of cs.ops) {
      const name = op.split(" ")[0]!;
      let res = "ok";
      try {
        switch (name) {
          case "or":
            b.or(mk(rest(op)));
            break;
          case "orSet": {
            const [, sp, spec] = op.split(" ") as [string, string, string];
            const { docs } = parseSpec(spec);
            let bs: BitSet;
            if (sp === "true") {
              const s = new SparseFixedBitSet(Number(maxDoc));
              for (const v of docs) s.set(v);
              bs = s;
            } else {
              const f = new FixedBitSet(Number(maxDoc));
              for (const v of docs) f.set(v);
              bs = f;
            }
            b.or(new BitSetIterator(bs, docs.length));
            break;
          }
          case "and":
            b.and(mk(rest(op)));
            break;
          case "andNot":
            b.andNot(mk(rest(op)));
            break;
          case "state":
            res = b.dense() + "/" + b.isDefinitelyEmpty();
            break;
          case "build": {
            const s = b.build();
            if (s === null) res = "null";
            else {
              const it = s.iterator();
              const isSparse = s.bits() instanceof SparseFixedBitSet;
              res =
                s.bits().length() + "/" + isSparse + "/" + it.cost() + "/" + s.ramBytesUsed() + "/" + s.isCacheable() + "/" + listIt(it) + "/" +
                (isSparse ? s.toString() : "dense") + "/" + b.isDefinitelyEmpty();
            }
            break;
          }
          default:
            throw new Error("unknown op " + op);
        }
      } catch (e) {
        res = ex(e);
      }
      out.push(res);
    }
    assert.deepEqual(out, cs.out, cs.c);
  }
});
