/** Unit tests for the small util classes without a Java behaviour worth recording (the others are in golden-util-small). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NoSuchElementException, UnsupportedOperationException } from "../src/errors.js";
import { Bits } from "../src/util/Bits.js";
import { BytesRefIterator } from "../src/util/BytesRefIterator.js";
import { FilterIterator } from "../src/util/FilterIterator.js";
import type { JavaIterator } from "../src/util/JavaIterator.js";
import { MapOfSets } from "../src/util/MapOfSets.js";
import { StringBuilder } from "../src/util/StringBuilder.js";

function it<T>(a: T[]): JavaIterator<T> {
  let i = 0;
  return {
    hasNext: () => i < a.length,
    next: () => {
      if (i >= a.length) throw new NoSuchElementException();
      return a[i++]!;
    },
    remove: () => {
      throw new UnsupportedOperationException();
    },
  };
}

test("Bits.MatchAllBits / MatchNoBits / EMPTY_ARRAY", () => {
  const all = new Bits.MatchAllBits(5);
  const none = new Bits.MatchNoBits(7);
  assert.equal(all.length(), 5);
  assert.equal(none.length(), 7);
  assert.equal(all.get(0), true);
  assert.equal(all.get(1000), true);
  assert.equal(none.get(0), false);
  assert.equal(none.get(-1), false);
  assert.equal(Bits.EMPTY_ARRAY.length, 0);
});

test("BytesRefIterator.EMPTY", () => {
  assert.equal(BytesRefIterator.EMPTY.next(), null);
  assert.equal(BytesRefIterator.EMPTY.next(), null);
});

test("FilterIterator keeps what the predicate accepts", () => {
  class Even extends FilterIterator<number, number> {
    protected override predicateFunction(n: number): boolean {
      return n % 2 === 0;
    }
  }
  const f = new Even(it([1, 2, 3, 4, 5, 6, 7]));
  assert.equal(f.hasNext(), true);
  assert.equal(f.hasNext(), true); // idempotent
  assert.equal(f.next(), 2);
  assert.equal(f.next(), 4);
  assert.throws(() => f.remove(), UnsupportedOperationException);
  assert.equal(f.next(), 6);
  assert.equal(f.hasNext(), false);
  assert.throws(() => f.next(), NoSuchElementException);
  const empty = new Even(it([1, 3]));
  assert.throws(() => empty.next(), NoSuchElementException);
});

test("MapOfSets.put / putAll return the set size and share the backing map", () => {
  const m = new Map<string, Set<number>>();
  const s = new MapOfSets<string, number>(m);
  assert.equal(s.getMap(), m);
  assert.equal(s.put("a", 1), 1);
  assert.equal(s.put("a", 1), 1);
  assert.equal(s.put("a", 2), 2);
  assert.equal(s.putAll("b", [1, 2, 3, 3]), 3);
  assert.equal(s.putAll("a", []), 2);
  assert.deepEqual([...m.get("b")!], [1, 2, 3]);
  assert.equal(m.size, 2);
});

test("StringBuilder", () => {
  const sb = new StringBuilder("ab");
  sb.append("c").append(1).append(2n).append(true).append(null);
  assert.equal(sb.toString(), "abc12truenull");
  assert.equal(sb.length(), 13);
  sb.setLength(3);
  assert.equal(sb.toString(), "abc");
  sb.setLength(5);
  assert.equal(sb.toString(), "abc\0\0");
});

import { IllegalArgumentException } from "../src/errors.js";
import { ArrayUtil } from "../src/util/ArrayUtil.js";
import { NumericUtils } from "../src/util/NumericUtils.js";
import { PriorityQueue } from "../src/util/PriorityQueue.js";

test("NumericUtils constants", () => {
  assert.equal(NumericUtils.PRECISION_STEP_DEFAULT, 16);
  assert.equal(NumericUtils.PRECISION_STEP_DEFAULT_32, 8);
  assert.equal(NumericUtils.SHIFT_START_LONG, 0x20);
  assert.equal(NumericUtils.SHIFT_START_INT, 0x60);
  assert.equal(NumericUtils.BUF_SIZE_LONG, 11);
  assert.equal(NumericUtils.BUF_SIZE_INT, 6);
});

test("PriorityQueue: prepopulate defaults to true, maxSize is bounded", () => {
  class Q extends PriorityQueue<number> {
    protected override lessThan(a: number, b: number): boolean {
      return a < b;
    }
    protected override getSentinelObject(): number | null {
      return -1;
    }
  }
  const q = new Q(3);
  assert.equal(q.size(), 3);
  assert.equal(q.top(), -1);
  const tooBig = ArrayUtil.MAX_ARRAY_LENGTH;
  assert.throws(
    () => new Q(tooBig),
    (e: Error) => e instanceof IllegalArgumentException && e.message === "maxSize must be <= " + (ArrayUtil.MAX_ARRAY_LENGTH - 1) + "; got: " + tooBig
  );
});
