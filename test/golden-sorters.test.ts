/**
 * Differential tests for Sorter, IntroSorter, InPlaceMergeSorter, TimSorter, ArrayUtil.introSort/timSort
 * and CollectionUtil. test/golden/util-sorters.json was produced by the ORIGINAL Lucene 5.2.1 classes
 * (tools/golden/org/apache/lucene/util/GoldenSorters.java): for every case it holds the input, the
 * resulting order and the exact number of each primitive call (compare, swap, copy, save, restore...).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ArrayUtil } from "../src/util/ArrayUtil.js";
import { ASSERTIONS_ENABLED } from "../src/util/assertions.js";
import { CollectionUtil } from "../src/util/CollectionUtil.js";
import type { Comparable } from "../src/util/Comparator.js";
import { IntroSorter } from "../src/util/IntroSorter.js";
import { Sorter } from "../src/util/Sorter.js";
import { TimSorter } from "../src/util/TimSorter.js";
import { Data, hashInts, SIntro, SMerge, STim } from "./sorter-fixtures.js";
import type { Counts } from "./sorter-fixtures.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const cases: any[] = JSON.parse(readFileSync(new URL("./golden/util-sorters.json", import.meta.url), "utf8"));
const byType = (t: string): any[] => cases.filter((c) => c.t === t);

// The recorded call counts include the compare() calls made inside Lucene's own `assert`s (the golden
// file is generated with -ea), so they only match while the port evaluates its assertions too.
const COUNTS_NEED_ASSERTIONS = ASSERTIONS_ENABLED ? false : "call counts assume assertions on (LUCENE_ASSERTIONS=0 is set)";

function ctx(c: any): string {
  const { key, ids, ...rest } = c;
  return JSON.stringify(rest) + (key ? ` n=${key.length}` : "");
}

function checkIds(c: any, id: ArrayLike<number>): void {
  if (c.ids !== undefined) {
    assert.deepEqual(Array.from(id), c.ids, `final order: ${ctx(c)}`);
  } else {
    assert.equal(hashInts(id), c.idsHash, `final order (hash): ${ctx(c)}`);
  }
}

function makeSorter(algo: string, d: Data, slots: number): Sorter {
  return algo === "intro" ? new SIntro(d) : algo === "merge" ? new SMerge(d) : new STim(d, slots);
}

test("golden: the case file is non-trivial", () => {
  assert.ok(cases.length > 3000, "expected thousands of cases, got " + cases.length);
  for (const t of ["sort", "introDepth", "badRange", "op", "minRun", "ceilLog2", "heapIdx", "api"]) {
    assert.ok(byType(t).length > 0, "no case of type " + t);
  }
});

for (const algo of ["intro", "merge", "tim"]) {
  test(`golden: ${algo} sort — final order and exact call counts`, { skip: COUNTS_NEED_ASSERTIONS }, () => {
    const list = byType("sort").filter((c) => c.algo === algo);
    assert.ok(list.length > 100);
    for (const c of list) {
      const d = new Data(c.key, c.slots);
      makeSorter(algo, d, c.slots).sort(c.from, c.to);
      checkIds(c, d.id);
      assert.deepEqual(d.counts(), c.n as Counts, `call counts: ${ctx(c)}`);
    }
  });
}

test("golden: IntroSorter heapsort fallback (forced recursion depth)", { skip: COUNTS_NEED_ASSERTIONS }, () => {
  const list = byType("introDepth");
  assert.ok(list.some((c) => c.heap) && list.some((c) => !c.heap), "both branches expected in the data");
  for (const c of list) {
    const d = new Data(c.key, 0);
    const s = new SIntro(d);
    s.quicksort(0, c.key.length, c.depth);
    checkIds(c, d.id);
    assert.equal(s.heapUsed, c.heap, `heapSort used: ${ctx(c)}`);
    assert.deepEqual(d.counts(), c.n as Counts, `call counts: ${ctx(c)}`);
  }
});

test("golden: sort(from, to) rejects to < from", () => {
  for (const c of byType("badRange")) {
    const d = new Data(new Int32Array(10), 4);
    const s = makeSorter(c.algo, d, 4);
    const [, cls, ...rest] = (c.result as string).split(":");
    assert.throws(
      () => s.sort(5, 3),
      (e: unknown) => {
        assert.ok(e instanceof Error);
        assert.equal(e.name, cls);
        assert.equal(e.message, rest.join(":"));
        return true;
      },
    );
  }
});

test("golden: Sorter / TimSorter building blocks", { skip: COUNTS_NEED_ASSERTIONS }, () => {
  const ops = byType("op");
  assert.ok(ops.length > 1500);
  const seen = new Set<string>();
  for (const c of ops) {
    seen.add(c.op);
    const a: number[] = c.args;
    const slots: number = c.slots ?? 0;
    const d = new Data(c.key, slots);
    let result: number | undefined;
    const merge = new SMerge(d);
    switch (c.op) {
      case "insertionSort": merge.insertionSort(a[0]!, a[1]!); break;
      case "binarySort": merge.binarySort(a[0]!, a[1]!); break;
      case "binarySort3": merge.binarySort(a[0]!, a[1]!, a[2]!); break;
      case "heapSort": merge.heapSort(a[0]!, a[1]!); break;
      case "reverse": merge.reverse(a[0]!, a[1]!); break;
      case "rotate": (c.sorter === "merge" ? merge : new STim(d, slots)).rotate(a[0]!, a[1]!, a[2]!); break;
      case "mergeInPlace": merge.mergeInPlace(a[0]!, a[1]!, a[2]!); break;
      case "lower": result = merge.lower(a[0]!, a[1]!, a[2]!); break;
      case "upper": result = merge.upper(a[0]!, a[1]!, a[2]!); break;
      case "lower2": result = merge.lower2(a[0]!, a[1]!, a[2]!); break;
      case "upper2": result = merge.upper2(a[0]!, a[1]!, a[2]!); break;
      case "timMerge": new STim(d, slots).merge(a[0]!, a[1]!, a[2]!); break;
      case "lowerSaved":
      case "upperSaved":
      case "lowerSaved3":
      case "upperSaved3": {
        const s = new STim(d, slots);
        s.saveSlots(c.save[0], c.save[1]);
        d.nSave = 0; // the golden counts only the search itself
        result =
          c.op === "lowerSaved" ? s.lowerSaved(a[0]!, a[1]!, a[2]!)
          : c.op === "upperSaved" ? s.upperSaved(a[0]!, a[1]!, a[2]!)
          : c.op === "lowerSaved3" ? s.lowerSaved3(a[0]!, a[1]!, a[2]!)
          : s.upperSaved3(a[0]!, a[1]!, a[2]!);
        break;
      }
      default: assert.fail("unknown op " + c.op);
    }
    if (c.result !== undefined) assert.equal(result, c.result, `result: ${ctx(c)}`);
    else checkIds(c, d.id);
    assert.deepEqual(d.counts(), c.n as Counts, `call counts: ${ctx(c)}`);
  }
  for (const op of ["insertionSort", "binarySort", "binarySort3", "heapSort", "reverse", "rotate", "mergeInPlace",
    "lower", "upper", "lower2", "upper2", "timMerge", "lowerSaved", "upperSaved", "lowerSaved3", "upperSaved3"]) {
    assert.ok(seen.has(op), "op never exercised: " + op);
  }
});

test("golden: TimSorter.minRun, IntroSorter.ceilLog2, heap index helpers", () => {
  for (const [len, want] of byType("minRun")[0].values) assert.equal(TimSorter.minRun(len), want, `minRun(${len})`);
  for (const [n, want] of byType("ceilLog2")[0].values) assert.equal(IntroSorter.ceilLog2(n), want, `ceilLog2(${n})`);
  for (const [from, idx, parent, child] of byType("heapIdx")[0].values) {
    assert.equal(Sorter.heapParent(from, idx + 1), parent, `heapParent(${from}, ${idx + 1})`);
    assert.equal(Sorter.heapChild(from, idx), child, `heapChild(${from}, ${idx})`);
  }
});

let itemCalls = 0;
class Item implements Comparable<Item> {
  constructor(
    readonly key: number,
    readonly id: number,
  ) {}
  compareTo(o: Item): number {
    itemCalls++;
    return this.key < o.key ? -1 : this.key > o.key ? 1 : 0;
  }
}
const itemCmp = (x: Item, y: Item): number => {
  itemCalls++;
  return x.key < y.key ? -1 : x.key > y.key ? 1 : 0;
};

// Besides the final order, the number of comparisons is checked: a stable sort has a unique result, so
// only the comparison count reveals e.g. a wrong maxTempSlots handed to the TimSorter by ArrayUtil.timSort.
test("golden: ArrayUtil.introSort/timSort and CollectionUtil (every overload, comparison counts)", { skip: COUNTS_NEED_ASSERTIONS }, () => {
  const list = byType("api");
  const names = new Set<string>();
  for (const c of list) {
    names.add(c.name);
    const a = (c.key as number[]).map((k, i) => new Item(k, i));
    const from: number = c.from;
    const to: number = c.to;
    itemCalls = 0;
    switch (c.name) {
      case "introSort(a,cmp)": ArrayUtil.introSort(a, itemCmp); break;
      case "introSort(a,from,to,cmp)": ArrayUtil.introSort(a, from, to, itemCmp); break;
      case "introSort(a)": ArrayUtil.introSort(a); break;
      case "introSort(a,from,to)": ArrayUtil.introSort(a, from, to); break;
      case "timSort(a,cmp)": ArrayUtil.timSort(a, itemCmp); break;
      case "timSort(a,from,to,cmp)": ArrayUtil.timSort(a, from, to, itemCmp); break;
      case "timSort(a)": ArrayUtil.timSort(a); break;
      case "timSort(a,from,to)": ArrayUtil.timSort(a, from, to); break;
      case "CollectionUtil.introSort(list,cmp)": CollectionUtil.introSort(a, itemCmp); break;
      case "CollectionUtil.introSort(list)": CollectionUtil.introSort(a); break;
      case "CollectionUtil.timSort(list,cmp)": CollectionUtil.timSort(a, itemCmp); break;
      case "CollectionUtil.timSort(list)": CollectionUtil.timSort(a); break;
      default: assert.fail("unknown api " + c.name);
    }
    checkIds(c, a.map((x) => x.id));
    assert.equal(itemCalls, c.calls, `comparator calls: ${ctx(c)}`);
  }
  assert.equal(names.size, 12, "every overload must be covered");
});

test("sorting: results are really sorted (sanity check independent of the golden data)", () => {
  let seed = 12345;
  const rnd = (n: number): number => ((seed = (Math.imul(seed, 1103515245) + 12345) | 0) >>> 8) % n;
  for (const n of [0, 1, 2, 19, 20, 21, 64, 65, 500, 3000]) {
    for (const fn of ["intro", "tim", "cintro", "ctim"]) {
      const a = Array.from({ length: n }, () => rnd(50));
      const expected = [...a].sort((x, y) => x - y);
      const cmp = (x: number, y: number): number => x - y;
      if (fn === "intro") ArrayUtil.introSort(a, cmp);
      else if (fn === "tim") ArrayUtil.timSort(a, cmp);
      else if (fn === "cintro") CollectionUtil.introSort(a, cmp);
      else CollectionUtil.timSort(a, cmp);
      assert.deepEqual(a, expected, `${fn} n=${n}`);
    }
  }
});
