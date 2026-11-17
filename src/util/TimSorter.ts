/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Port of org.apache.lucene.util.TimSorter (Lucene 5.2.1).

import { lassert } from "./assertions.js";
import { Sorter } from "./Sorter.js";

/**
 * {@link Sorter} implementation based on the
 * <a href="http://svn.python.org/projects/python/trunk/Objects/listsort.txt">TimSort</a>
 * algorithm.
 * <p>This implementation is especially good at sorting partially-sorted
 * arrays and sorts small arrays with binary sort.
 * <p><b>NOTE</b>:There are a few differences with the original implementation:<ul>
 * <li><a name="maxTempSlots"></a>The extra amount of memory to perform merges is
 * configurable. This allows small merges to be very fast while large merges
 * will be performed in-place (slightly slower). You can make sure that the
 * fast merge routine will always be used by having <code>maxTempSlots</code>
 * equal to half of the length of the slice of data to sort.
 * <li>Only the fast merge routine can gallop (the one that doesn't run
 * in-place) and it only gallops on the longest slice.
 * </ul>
 * @lucene.internal
 */
export abstract class TimSorter extends Sorter {
  static readonly MINRUN: number = 32;
  /** Hides Sorter.THRESHOLD, as in Java. */
  static override readonly THRESHOLD: number = 64;
  static readonly STACKSIZE: number = 49; // depends on MINRUN
  static readonly MIN_GALLOP: number = 7;

  readonly maxTempSlots: number;
  minRun: number = 0;
  to: number = 0;
  stackSize: number = 0;
  runEnds: Int32Array;

  /**
   * Create a new {@link TimSorter}.
   * @param maxTempSlots the maximum amount of extra memory to run merges
   */
  protected constructor(maxTempSlots: number) {
    super();
    this.runEnds = new Int32Array(1 + TimSorter.STACKSIZE);
    this.maxTempSlots = maxTempSlots;
  }

  /**
   * Minimum run length for an array of length <code>length</code>.
   * @internal package-private in Java
   */
  static minRun(length: number): number {
    lassert(() => length >= TimSorter.MINRUN);
    let n = length;
    let r = 0;
    while (n >= 64) {
      r |= n & 1;
      n >>>= 1;
    }
    const minRun = n + r;
    lassert(() => minRun >= TimSorter.MINRUN && minRun <= TimSorter.THRESHOLD);
    return minRun;
  }

  /** @internal package-private in Java */
  runLen(i: number): number {
    const off = this.stackSize - i;
    return this.runEnds[off]! - this.runEnds[off - 1]!;
  }

  /** @internal package-private in Java */
  runBase(i: number): number {
    return this.runEnds[this.stackSize - i - 1]!;
  }

  /** @internal package-private in Java */
  runEnd(i: number): number {
    return this.runEnds[this.stackSize - i]!;
  }

  /** @internal package-private in Java */
  setRunEnd(i: number, runEnd: number): void {
    this.runEnds[this.stackSize - i] = runEnd;
  }

  /** @internal package-private in Java */
  pushRunLen(len: number): void {
    this.runEnds[this.stackSize + 1] = this.runEnds[this.stackSize]! + len;
    ++this.stackSize;
  }

  /**
   * Compute the length of the next run, make the run sorted and return its
   * length.
   * @internal package-private in Java
   */
  nextRun(): number {
    const runBase = this.runEnd(0);
    lassert(() => runBase < this.to);
    if (runBase === this.to - 1) {
      return 1;
    }
    let o = runBase + 2;
    if (this.compare(runBase, runBase + 1) > 0) {
      // run must be strictly descending
      while (o < this.to && this.compare(o - 1, o) > 0) {
        ++o;
      }
      this.reverse(runBase, o);
    } else {
      // run must be non-descending
      while (o < this.to && this.compare(o - 1, o) <= 0) {
        ++o;
      }
    }
    // compute minimum run length
    const runHi = Math.max(o, Math.min(this.to, runBase + this.minRun));
    this.binarySort(runBase, runHi, o);
    return runHi - runBase;
  }

  /** @internal package-private in Java */
  ensureInvariants(): void {
    while (this.stackSize > 1) {
      const runLen0 = this.runLen(0);
      const runLen1 = this.runLen(1);

      if (this.stackSize > 2) {
        const runLen2 = this.runLen(2);

        if (runLen2 <= runLen1 + runLen0) {
          // merge the smaller of 0 and 2 with 1
          if (runLen2 < runLen0) {
            this.mergeAt(1);
          } else {
            this.mergeAt(0);
          }
          continue;
        }
      }

      if (runLen1 <= runLen0) {
        this.mergeAt(0);
        continue;
      }

      break;
    }
  }

  /** @internal package-private in Java */
  exhaustStack(): void {
    while (this.stackSize > 1) {
      this.mergeAt(0);
    }
  }

  /** @internal package-private in Java */
  reset(from: number, to: number): void {
    this.stackSize = 0;
    this.runEnds.fill(0);
    this.runEnds[0] = from;
    this.to = to;
    const length = to - from;
    this.minRun = length <= TimSorter.THRESHOLD ? length : TimSorter.minRun(length);
  }

  /** @internal package-private in Java */
  mergeAt(n: number): void {
    lassert(() => this.stackSize >= 2);
    this.merge(this.runBase(n + 1), this.runBase(n), this.runEnd(n));
    for (let j = n + 1; j > 0; --j) {
      this.setRunEnd(j, this.runEnd(j - 1));
    }
    --this.stackSize;
  }

  /** @internal package-private in Java */
  merge(lo: number, mid: number, hi: number): void {
    if (this.compare(mid - 1, mid) <= 0) {
      return;
    }
    lo = this.upper2(lo, mid, mid);
    hi = this.lower2(mid, hi, mid - 1);

    if (hi - mid <= mid - lo && hi - mid <= this.maxTempSlots) {
      this.mergeHi(lo, mid, hi);
    } else if (mid - lo <= this.maxTempSlots) {
      this.mergeLo(lo, mid, hi);
    } else {
      this.mergeInPlace(lo, mid, hi);
    }
  }

  override sort(from: number, to: number): void {
    this.checkRange(from, to);
    if (to - from <= 1) {
      return;
    }
    this.reset(from, to);
    do {
      this.ensureInvariants();
      this.pushRunLen(this.nextRun());
    } while (this.runEnd(0) < to);
    this.exhaustStack();
    lassert(() => this.runEnd(0) === to);
  }

  override doRotate(lo: number, mid: number, hi: number): void {
    const len1 = mid - lo;
    const len2 = hi - mid;
    if (len1 === len2) {
      while (mid < hi) {
        this.swap(lo++, mid++);
      }
    } else if (len2 < len1 && len2 <= this.maxTempSlots) {
      this.save(mid, len2);
      for (let i = lo + len1 - 1, j = hi - 1; i >= lo; --i, --j) {
        this.copy(i, j);
      }
      for (let i = 0, j = lo; i < len2; ++i, ++j) {
        this.restore(i, j);
      }
    } else if (len1 <= this.maxTempSlots) {
      this.save(lo, len1);
      for (let i = mid, j = lo; i < hi; ++i, ++j) {
        this.copy(i, j);
      }
      for (let i = 0, j = lo + len2; j < hi; ++i, ++j) {
        this.restore(i, j);
      }
    } else {
      this.reverse(lo, mid);
      this.reverse(mid, hi);
      this.reverse(lo, hi);
    }
  }

  /** @internal package-private in Java */
  mergeLo(lo: number, mid: number, hi: number): void {
    lassert(() => this.compare(lo, mid) > 0);
    const len1 = mid - lo;
    this.save(lo, len1);
    this.copy(mid, lo);
    let i = 0,
      j = mid + 1,
      dest = lo + 1;
    outer: for (;;) {
      for (let count = 0; count < TimSorter.MIN_GALLOP; ) {
        if (i >= len1 || j >= hi) {
          break outer;
        } else if (this.compareSaved(i, j) <= 0) {
          this.restore(i++, dest++);
          count = 0;
        } else {
          this.copy(j++, dest++);
          ++count;
        }
      }
      // galloping...
      const next = this.lowerSaved3(j, hi, i);
      for (; j < next; ++dest) {
        this.copy(j++, dest);
      }
      this.restore(i++, dest++);
    }
    for (; i < len1; ++dest) {
      this.restore(i++, dest);
    }
    const jj = j;
    const dd = dest;
    lassert(() => jj === dd);
  }

  /** @internal package-private in Java */
  mergeHi(lo: number, mid: number, hi: number): void {
    lassert(() => this.compare(mid - 1, hi - 1) > 0);
    const len2 = hi - mid;
    this.save(mid, len2);
    this.copy(mid - 1, hi - 1);
    let i = mid - 2,
      j = len2 - 1,
      dest = hi - 2;
    outer: for (;;) {
      for (let count = 0; count < TimSorter.MIN_GALLOP; ) {
        if (i < lo || j < 0) {
          break outer;
        } else if (this.compareSaved(j, i) >= 0) {
          this.restore(j--, dest--);
          count = 0;
        } else {
          this.copy(i--, dest--);
          ++count;
        }
      }
      // galloping
      const next = this.upperSaved3(lo, i + 1, j);
      while (i >= next) {
        this.copy(i--, dest--);
      }
      this.restore(j--, dest--);
    }
    for (; j >= 0; --dest) {
      this.restore(j--, dest);
    }
    const ii = i;
    const dd = dest;
    lassert(() => ii === dd);
  }

  /** @internal package-private in Java */
  lowerSaved(from: number, to: number, val: number): number {
    let len = to - from;
    while (len > 0) {
      const half = len >>> 1;
      const mid = from + half;
      if (this.compareSaved(val, mid) > 0) {
        from = mid + 1;
        len = len - half - 1;
      } else {
        len = half;
      }
    }
    return from;
  }

  /** @internal package-private in Java */
  upperSaved(from: number, to: number, val: number): number {
    let len = to - from;
    while (len > 0) {
      const half = len >>> 1;
      const mid = from + half;
      if (this.compareSaved(val, mid) < 0) {
        len = half;
      } else {
        from = mid + 1;
        len = len - half - 1;
      }
    }
    return from;
  }

  // faster than lowerSaved when val is at the beginning of [from:to[
  /** @internal package-private in Java */
  lowerSaved3(from: number, to: number, val: number): number {
    let f = from,
      t = f + 1;
    while (t < to) {
      if (this.compareSaved(val, t) <= 0) {
        return this.lowerSaved(f, t, val);
      }
      const delta = t - f;
      f = t;
      t += delta << 1;
    }
    return this.lowerSaved(f, to, val);
  }

  //faster than upperSaved when val is at the end of [from:to[
  /** @internal package-private in Java */
  upperSaved3(from: number, to: number, val: number): number {
    let f = to - 1,
      t = to;
    while (f > from) {
      if (this.compareSaved(val, f) >= 0) {
        return this.upperSaved(f, t, val);
      }
      const delta = t - f;
      t = f;
      f -= delta << 1;
    }
    return this.upperSaved(from, t, val);
  }

  /** Copy data from slot src to slot dest. */
  protected abstract copy(src: number, dest: number): void;

  /** Save all elements between slots i and i+len into the temporary storage. */
  protected abstract save(i: number, len: number): void;

  /** Restore element j from the temporary storage into slot i. */
  protected abstract restore(i: number, j: number): void;

  /** Compare element i from the temporary storage with element j from the slice to sort, similarly to {@link compare}. */
  protected abstract compareSaved(i: number, j: number): number;
}
