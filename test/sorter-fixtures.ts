/**
 * Instrumented sorters used by the differential tests: they mirror, line for line, the classes of
 * tools/golden/org/apache/lucene/util/GoldenSorters.java. Every sorter works on parallel (key, id)
 * arrays and counts each primitive call, so the tests compare the exact sequence of operations.
 */
import { InPlaceMergeSorter } from "../src/util/InPlaceMergeSorter.js";
import { IntroSorter } from "../src/util/IntroSorter.js";
import { TimSorter } from "../src/util/TimSorter.js";

export interface Counts {
  compare: number;
  swap: number;
  copy: number;
  save: number;
  restore: number;
  compareSaved: number;
  setPivot: number;
  comparePivot: number;
}

const cmpInt = (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0);

export class Data {
  readonly key: Int32Array;
  readonly id: Int32Array;
  readonly tk: Int32Array;
  readonly ti: Int32Array;
  pivotKey = 0;
  nCompare = 0;
  nSwap = 0;
  nCopy = 0;
  nSave = 0;
  nRestore = 0;
  nCompareSaved = 0;
  nSetPivot = 0;
  nComparePivot = 0;

  constructor(keys: ArrayLike<number>, slots: number) {
    this.key = Int32Array.from(keys);
    this.id = Int32Array.from({ length: this.key.length }, (_, i) => i);
    this.tk = new Int32Array(Math.max(slots, 0));
    this.ti = new Int32Array(Math.max(slots, 0));
  }

  compare(i: number, j: number): number {
    this.nCompare++;
    return cmpInt(this.key[i]!, this.key[j]!);
  }
  swap(i: number, j: number): void {
    this.nSwap++;
    let t = this.key[i]!;
    this.key[i] = this.key[j]!;
    this.key[j] = t;
    t = this.id[i]!;
    this.id[i] = this.id[j]!;
    this.id[j] = t;
  }
  copy(s: number, d: number): void {
    this.nCopy++;
    this.key[d] = this.key[s]!;
    this.id[d] = this.id[s]!;
  }
  save(i: number, len: number): void {
    this.nSave++;
    this.tk.set(this.key.subarray(i, i + len), 0);
    this.ti.set(this.id.subarray(i, i + len), 0);
  }
  restore(s: number, d: number): void {
    this.nRestore++;
    this.key[d] = this.tk[s]!;
    this.id[d] = this.ti[s]!;
  }
  compareSaved(i: number, j: number): number {
    this.nCompareSaved++;
    return cmpInt(this.tk[i]!, this.key[j]!);
  }
  setPivot(i: number): void {
    this.nSetPivot++;
    this.pivotKey = this.key[i]!;
  }
  comparePivot(j: number): number {
    this.nComparePivot++;
    return cmpInt(this.pivotKey, this.key[j]!);
  }

  counts(): Counts {
    return {
      compare: this.nCompare,
      swap: this.nSwap,
      copy: this.nCopy,
      save: this.nSave,
      restore: this.nRestore,
      compareSaved: this.nCompareSaved,
      setPivot: this.nSetPivot,
      comparePivot: this.nComparePivot,
    };
  }
}

export class SIntro extends IntroSorter {
  heapUsed = false;
  constructor(readonly d: Data) {
    super();
  }
  protected override compare(i: number, j: number): number {
    return this.d.compare(i, j);
  }
  protected override swap(i: number, j: number): void {
    this.d.swap(i, j);
  }
  protected override setPivot(i: number): void {
    this.d.setPivot(i);
  }
  protected override comparePivot(j: number): number {
    return this.d.comparePivot(j);
  }
  override heapSort(from: number, to: number): void {
    this.heapUsed = true;
    super.heapSort(from, to);
  }
}

export class SMerge extends InPlaceMergeSorter {
  constructor(readonly d: Data) {
    super();
  }
  protected override compare(i: number, j: number): number {
    return this.d.compare(i, j);
  }
  protected override swap(i: number, j: number): void {
    this.d.swap(i, j);
  }
}

export class STim extends TimSorter {
  constructor(
    readonly d: Data,
    slots: number,
  ) {
    super(slots);
  }
  protected override compare(i: number, j: number): number {
    return this.d.compare(i, j);
  }
  protected override swap(i: number, j: number): void {
    this.d.swap(i, j);
  }
  protected override copy(s: number, dd: number): void {
    this.d.copy(s, dd);
  }
  protected override save(i: number, len: number): void {
    this.d.save(i, len);
  }
  protected override restore(s: number, dd: number): void {
    this.d.restore(s, dd);
  }
  protected override compareSaved(i: number, j: number): number {
    return this.d.compareSaved(i, j);
  }

  /** Public door to the protected save(), for tests that probe the *Saved searches (package access in Java). */
  saveSlots(i: number, len: number): void {
    this.save(i, len);
  }
}

/** The 31-polynomial int hash that GoldenSorters uses for big id arrays. */
export function hashInts(a: ArrayLike<number>): number {
  let h = 0;
  for (let i = 0; i < a.length; i++) h = (Math.imul(h, 31) + a[i]!) | 0;
  return h;
}
