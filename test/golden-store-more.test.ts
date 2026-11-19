/**
 * Differential tests for OutputStreamIndexOutput (with the java.io streams it relies on: BufferedOutputStream,
 * CheckedOutputStream, FilterOutputStream), SimpleRateLimiter, RateLimitedIndexOutput, FileSwitchDirectory,
 * NRTCachingDirectory and Double.toString. Expected values come from test/golden/store-more.json, produced by the
 * ORIGINAL Lucene 5.2.1 classes and the JDK (tools/golden/GoldenStoreMore.java). Scripts of random operations are
 * replayed here; every result must be identical.
 *
 * Directory listings are compared sorted: RAMDirectory.listAll() order is unspecified in Java (ConcurrentHashMap).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getSuppressed, IOException, NoSuchFileException } from "../src/errors.js";
import { BufferedOutputStream } from "../src/io/BufferedOutputStream.js";
import { FilterOutputStream } from "../src/io/FilterOutputStream.js";
import { CheckedOutputStream } from "../src/zip/CheckedOutputStream.js";
import { CRC32 } from "../src/zip/CRC32.js";
import type { OutputStream } from "../src/io/OutputStream.js";
import { Directory } from "../src/store/Directory.js";
import { FileSwitchDirectory } from "../src/store/FileSwitchDirectory.js";
import { FilterDirectory } from "../src/store/FilterDirectory.js";
import type { IndexInput } from "../src/store/IndexInput.js";
import { FlushInfo } from "../src/store/FlushInfo.js";
import { IOContext } from "../src/store/IOContext.js";
import type { Lock } from "../src/store/Lock.js";
import { MergeInfo } from "../src/store/MergeInfo.js";
import { NRTCachingDirectory } from "../src/store/NRTCachingDirectory.js";
import { OutputStreamIndexOutput } from "../src/store/OutputStreamIndexOutput.js";
import { RAMDirectory } from "../src/store/RAMDirectory.js";
import { RAMFile } from "../src/store/RAMFile.js";
import { RAMOutputStream } from "../src/store/RAMOutputStream.js";
import { RateLimitedIndexOutput } from "../src/store/RateLimitedIndexOutput.js";
import { RateLimiter, SimpleRateLimiter } from "../src/store/RateLimiter.js";
import { Accountables } from "../src/util/Accountables.js";
import { sleepSync } from "../src/util/JavaObjects.js";
import { doubleToString } from "../src/util/JavaNumbers.js";
import { compareJavaStrings } from "../src/util/JavaCollections.js";
import { hexToBytes, toHex } from "./helpers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const golden: any = JSON.parse(readFileSync(new URL("./golden/store-more.json", import.meta.url), "utf8"));
type Op = any[];

function exs(e: unknown): string {
  assert.ok(e instanceof Error, "thrown value is not an Error: " + String(e));
  return "EX:" + e.name + ":" + e.message;
}
/** "[Class:msg, Class:msg{nested suppressed}]", like the Java harness */
const suppressedString = (e: unknown): string =>
  "[" +
  getSuppressed(e)
    .map((x) => {
      const n = getSuppressed(x);
      return (x as Error).name + ":" + (x as Error).message + (n.length > 0 ? "{" + suppressedString(x) + "}" : "");
    })
    .join(", ") +
  "]";
const sorted = (l: string[]): string => "[" + [...l].sort(compareJavaStrings).join(", ") + "]";
const normalize = (s: string): string => s.replace(/(?:[\w$]+[.$])*([\w$]+)@[0-9a-f]+/g, "$1@H");

function applySteps(o: { writeByte(b: number): void; writeBytes(b: Uint8Array, off: number, len: number): void; writeVInt(i: number): void; writeString(s: string): void; writeLong(l: bigint): void }, steps: Op[]): void {
  for (const st of steps) {
    switch (st[0]) {
      case "b": { const b = hexToBytes(st[1]); o.writeBytes(b, 0, b.length); break; }
      case "B": o.writeByte(st[1]); break;
      case "vi": o.writeVInt(st[1]); break;
      case "s": o.writeString(st[1]); break;
      case "l": o.writeLong(BigInt(st[1])); break;
      default: throw new Error("bad step " + st[0]);
    }
  }
}

// ---- same read interpreter as golden-store-dir.test.ts
const canonLists = (s: string): string =>
  s.replace(/=\[([^\]]*)\]/g, (_m, l: string) => "=[" + l.split(", ").sort(compareJavaStrings).join(", ") + "]");

function execRead(input: IndexInput, ops: Op[]): string {
  let out = "";
  for (const op of ops) {
    let res: string;
    try {
      switch (op[0]) {
        case "seek": input.seek(op[1]); res = "ok"; break;
        case "byte": res = String(input.readByte() & 0xff); break;
        case "int": res = String(input.readInt()); break;
        case "vint": res = String(input.readVInt()); break;
        case "bytes": { const b = new Uint8Array(op[1]); input.readBytes(b, 0, b.length); res = toHex(b); break; }
        case "fp": res = String(input.getFilePointer()); break;
        case "len": res = String(input.length()); break;
        case "skip": input.skipBytes(op[1]); res = "ok"; break;
        case "slice": res = "[" + execRead(input.slice("sl", op[1], op[2]), op[3]) + "]"; break;
        case "clone": res = "[" + execRead(input.clone(), op[1]) + "]"; break;
        default: throw new Error("bad read op " + op[0]);
      }
    } catch (e) {
      res = exs(e);
    }
    if (out.length > 0) out += "|";
    out += res + "@" + input.getFilePointer();
  }
  return out;
}

/** AIOOBE / NPE messages are JDK-specific: only the class is compared. */
function sameResult(actual: string, expected: string, ctx: string): void {
  const cls = /^EX:(ArrayIndexOutOfBoundsException|NullPointerException)/.exec(expected);
  if (cls !== null) assert.ok(actual.startsWith("EX:" + cls[1]), `${ctx}: ${actual}`);
  else assert.equal(actual, expected, ctx);
}

// ---------------------------------------------------------------- OutputStreamIndexOutput
class Rec implements OutputStream {
  log = "";
  writes = 0;
  constructor(readonly failWriteAt: number, readonly failFlush: boolean, readonly failClose: boolean) {}
  write(b: number): void;
  write(b: Uint8Array, off: number, len: number): void;
  write(b: number | Uint8Array, off?: number, len?: number): void {
    this.writes++;
    if (this.writes === this.failWriteAt) throw new IOException("write failed");
    if (typeof b === "number") this.log += "b" + (b & 0xff) + " ";
    else this.log += "w" + off + ":" + len + ":" + toHex(b.subarray(off!, off! + len!)) + " ";
  }
  flush(): void {
    this.log += "f ";
    if (this.failFlush) throw new IOException("flush failed");
  }
  close(): void {
    this.log += "c ";
    if (this.failClose) throw new IOException("close failed");
  }
  drain(): string {
    const s = this.log.trim();
    this.log = "";
    return s;
  }
}

function execOs(o: OutputStreamIndexOutput, rec: Rec, op: Op): string {
  let res: string;
  try {
    switch (op[0]) {
      case "wb": o.writeByte(op[1]); res = "ok"; break;
      case "wbs": {
        const off = op[1] as number;
        const chunk = hexToBytes(op[2]);
        const arr = new Uint8Array(off + chunk.length + 2).fill(0x77);
        arr.set(chunk, off);
        o.writeBytes(arr, off, chunk.length);
        res = "ok";
        break;
      }
      case "fp": res = String(o.getFilePointer()); break;
      case "crc": res = String(o.getChecksum()); break;
      case "close": o.close(); res = "ok"; break;
      default: throw new Error("bad os op " + op[0]);
    }
  } catch (e) {
    res = exs(e) + " suppressed=" + suppressedString(e);
  }
  return res + " log=[" + rec.drain() + "]";
}

test("OutputStreamIndexOutput: bytes reaching the stream, checksum and failures match Lucene 5.2.1 (buffer sizes 1..8192, failing write/flush/close)", () => {
  golden.osio.forEach(([bufSize, cfg, ops, results]: [number, number, Op[], string[]], sc: number) => {
    const rec = new Rec(cfg === 1 ? 3 : 0, cfg === 2 || cfg === 4, cfg === 3 || cfg === 4);
    const o = new OutputStreamIndexOutput("osio", rec, bufSize);
    ops.forEach((op, i) => assert.equal(execOs(o, rec, op), results[i], `script ${sc} (buf ${bufSize}, cfg ${cfg}) op ${i} ${JSON.stringify(op).slice(0, 80)}`));
  });
  // both buffering paths and every failure mode must be exercised
  const all: string[] = golden.osio.flatMap((s: any) => s[3]);
  assert.ok(all.some((r) => /log=\[w\d+:\d+:/.test(r)), "buffer flushes");
  assert.ok(all.some((r) => r.includes("EX:IOException:write failed")));
  assert.ok(all.some((r) => r.includes("EX:IOException:flush failed")));
  assert.ok(all.some((r) => r.includes("EX:IOException:close failed")));
  assert.ok(all.some((r) => r.includes("suppressed=[IOException:")), "suppressed exception on close");
  assert.ok(all.some((r) => r.includes("{[IOException:")), "nested suppressed exceptions");
});

test("OutputStreamIndexOutput: buffer size must be positive", () => {
  for (const [size, expected] of golden.osioCtor as [number, string][]) {
    let res: string;
    try {
      new OutputStreamIndexOutput("d", new Rec(0, false, false), size);
      res = "ok";
    } catch (e) {
      res = exs(e);
    }
    assert.equal(res, expected, `size ${size}`);
  }
});

// ---------------------------------------------------------------- RateLimitedIndexOutput
class FakeLimiter extends RateLimiter {
  idx = 0;
  log = "";
  constructor(readonly mins: number[]) {
    super();
  }
  setMBPerSec(_d: number): void {}
  getMBPerSec(): number { return 1; }
  pause(bytes: number): number { this.log += "pause:" + bytes + " "; return 0; }
  getMinPauseCheckBytes(): number { return this.mins[this.idx++ % this.mins.length]!; }
  drain(): string {
    const s = this.log.trim();
    this.log = "";
    return s + "|idx=" + this.idx;
  }
}

function execRl(o: RateLimitedIndexOutput, lim: FakeLimiter, op: Op): string {
  let res: string;
  try {
    switch (op[0]) {
      case "wb": o.writeByte(op[1]); res = "ok"; break;
      case "wbs": { const b = hexToBytes(op[1]); o.writeBytes(b, 0, b.length); res = "ok"; break; }
      case "fp": res = String(o.getFilePointer()); break;
      case "crc": res = String(o.getChecksum()); break;
      case "toString": res = o.toString(); break;
      case "close": o.close(); res = "ok"; break;
      default: throw new Error("bad rl op " + op[0]);
    }
  } catch (e) {
    res = exs(e);
  }
  return res + " log=[" + lim.drain() + "]";
}

test("RateLimitedIndexOutput: pause() calls and delegation match Lucene 5.2.1", () => {
  golden.rateLimited.forEach(([mins, ops, results]: [number[], Op[], string[]], sc: number) => {
    const lim = new FakeLimiter(mins);
    const o = new RateLimitedIndexOutput(lim, new RAMOutputStream("dd", new RAMFile(), true));
    ops.forEach((op, i) => assert.equal(execRl(o, lim, op), results[i], `script ${sc} mins=${mins} op ${i}`));
  });
  const all: string[] = golden.rateLimited.flatMap((s: any) => s[2]);
  assert.ok(all.some((r) => r.includes("pause:")), "pauses must happen");
});

test("SimpleRateLimiter: min pause check bytes, MB/s and the no-sleep paths match Lucene 5.2.1", () => {
  for (const [v, minPause, mb] of golden.simpleRateLimiter as [string, string, string][]) {
    const l = new SimpleRateLimiter(Number(v));
    // longs from 2^53 on are approximated by a double: saturated values must simply be >= 2^63 - 1
    if (minPause === "9223372036854775807") assert.ok(l.getMinPauseCheckBytes() >= 2 ** 63 - 1024, v);
    else assert.equal(String(l.getMinPauseCheckBytes()), minPause, v);
    assert.equal(doubleToString(l.getMBPerSec()), mb, v);
  }
  for (const [v, expected] of golden.simpleRateLimiterPause as [string, string][]) {
    assert.equal(String(new SimpleRateLimiter(Number(v)).pause(10)), expected, `pause with ${v} MB/s`);
  }
});

test("SimpleRateLimiter.pause really sleeps (1 MB/s: 50000 bytes take ~48 ms) and returns the paused nanoseconds", () => {
  const l = new SimpleRateLimiter(1);
  const t0 = process.hrtime.bigint();
  const paused = l.pause(50000);
  const elapsedNs = Number(process.hrtime.bigint() - t0);
  assert.ok(paused >= 40e6 && paused <= 1e9, `paused ${paused} ns`);
  assert.ok(elapsedNs >= paused * 0.9, "elapsed time covers the pause");
  // being behind schedule: no pause at all and the clock restarts from now
  const slow = new SimpleRateLimiter(1000);
  assert.equal(slow.pause(1), 0);

  // ... "restarts from now": after a late (zero) pause, the next pause is measured from that moment
  const l2 = new SimpleRateLimiter(1);
  sleepSync(100);
  assert.equal(l2.pause(1), 0);
  const paused2 = l2.pause(50000);
  assert.ok(paused2 >= 40e6 && paused2 <= 1e9, `second pause ${paused2} ns`);
});

test("Double.toString emulation matches the JDK (special values, boundaries 1e-3 / 1e7, random bit patterns)", () => {
  const view = new DataView(new ArrayBuffer(8));
  for (const [bits, expected] of golden.doubleToString as [string, string][]) {
    view.setBigUint64(0, BigInt("0x" + bits));
    assert.equal(doubleToString(view.getFloat64(0)), expected, `bits ${bits}`);
  }
});

// ---------------------------------------------------------------- directories
function ctxOf(c: Op): IOContext {
  switch (c[0]) {
    case "default": return IOContext.DEFAULT;
    case "flush": return new IOContext(new FlushInfo(10, c[1]));
    case "merge": return new IOContext(new MergeInfo(10, c[1], false, -1));
    default: throw new Error("bad ctx " + c[0]);
  }
}

/** operations every Directory supports; returns null when the op is not one of them */
function common(d: Directory, op: Op, locks: Map<string, Lock>): string | null {
  try {
    switch (op[0]) {
      case "write": {
        const o = d.createOutput(op[1], ctxOf(op[2]));
        applySteps(o, op[3]);
        const s = "fp=" + o.getFilePointer() + " crc=" + o.getChecksum();
        o.close();
        return s;
      }
      case "list": return sorted(d.listAll());
      case "length": return String(d.fileLength(op[1]));
      case "delete": d.deleteFile(op[1]); return "ok";
      case "rename": d.renameFile(op[1], op[2]); return "ok";
      case "sync": d.sync(op[1]); return "ok";
      case "read": {
        const input = d.openInput(op[1], IOContext.READ);
        const s = execRead(input, op[2]);
        input.close();
        return s;
      }
      case "close": d.close(); return "ok";
      case "lock": {
        const l = d.makeLock(op[1]);
        const got = l.obtain();
        if (got) locks.set(op[1], l);
        return String(got);
      }
      case "unlock": {
        const l = locks.get(op[1]);
        if (l === undefined) return "none";
        locks.delete(op[1]);
        l.close();
        return "closed";
      }
      default: return null;
    }
  } catch (e) {
    return exs(e);
  }
}

test("FileSwitchDirectory: routing by extension, rename across directories, locks, close match Lucene 5.2.1", () => {
  const exts = new Set(["fdt", "fdx", "tim"]);
  golden.fileSwitch.forEach(([doClose, ops, results]: [boolean, Op[], string[]], sc: number) => {
    const p = new RAMDirectory();
    const s = new RAMDirectory();
    const fsd = new FileSwitchDirectory(exts, p, s, doClose);
    const locks = new Map<string, Lock>();
    ops.forEach((op, i) => {
      let res: string;
      switch (op[0]) {
        case "primaryList": try { res = sorted(p.listAll()); } catch (e) { res = exs(e); } break;
        case "secondaryList": try { res = sorted(s.listAll()); } catch (e) { res = exs(e); } break;
        case "ext": res = FileSwitchDirectory.getExtension(op[1]); break;
        default: res = common(fsd, op, locks)!;
      }
      sameResult(res, results[i]!, `script ${sc} op ${i} ${JSON.stringify(op).slice(0, 100)}`);
    });
  });
  const all: string[] = golden.fileSwitch.flatMap((s: any) => s[2]);
  assert.ok(all.some((r) => r.includes("source and dest are in different directories")), "cross-directory rename");
  assert.ok(all.some((r) => r.includes("AlreadyClosedException")), "closed directories");
});

class FailList extends FilterDirectory {
  constructor(base: Directory, readonly kind: number, readonly tag: string) {
    super(base);
  }
  override listAll(): string[] {
    if (this.kind === 1) throw new NoSuchFileException(this.tag + "-nsf");
    if (this.kind === 2) throw new IOException(this.tag + "-io");
    return this.in.listAll();
  }
}

function failingList(kind: number, tag: string, withFile: boolean): Directory {
  const base = new RAMDirectory();
  if (withFile) {
    const o = base.createOutput(tag + "1.fdt", IOContext.DEFAULT);
    o.writeByte(1);
    o.close();
    base.createOutput(tag + "2.cfs", IOContext.DEFAULT).close();
  }
  return new FailList(base, kind, tag);
}

test("FileSwitchDirectory.listAll: NoSuchFileException / IOException from either directory (36 combinations)", () => {
  const exts = new Set(["fdt", "fdx", "tim"]);
  for (const [pk, sk, pf, sf, expected] of golden.fileSwitchListAll as [number, number, number, number, string][]) {
    const fsd = new FileSwitchDirectory(exts, failingList(pk, "p", pf === 1), failingList(sk, "s", sf === 1), false);
    let res: string;
    try {
      res = sorted(fsd.listAll());
    } catch (e) {
      res = exs(e);
    }
    assert.equal(res, expected, `primary=${pk} secondary=${sk} primaryFiles=${pf} secondaryFiles=${sf}`);
  }
});

test("NRTCachingDirectory: caching decisions, uncache on sync/rename/close, listings match Lucene 5.2.1", () => {
  golden.nrt.forEach(([maxMerge, maxCached, ops, results]: [string, string, Op[], string[]], sc: number) => {
    const delegate = new RAMDirectory();
    const nrt = new NRTCachingDirectory(delegate, Number(maxMerge), Number(maxCached));
    const locks = new Map<string, Lock>();
    ops.forEach((op, i) => {
      let res: string;
      try {
        switch (op[0]) {
          case "cached": res = sorted(nrt.listCachedFiles()); break;
          case "delegateList": res = sorted(delegate.listAll()); break;
          case "ram": res = String(nrt.ramBytesUsed()); break;
          case "acct":
            res = normalize(Accountables.toString(Accountables.namedAccountable("nrt", nrt.getChildResources(), nrt.ramBytesUsed())));
            break;
          case "toString": res = normalize(nrt.toString()); break;
          default: res = common(nrt, op, locks)!;
        }
      } catch (e) {
        res = exs(e);
      }
      const ctx = `script ${sc} (${maxMerge}/${maxCached} MB) op ${i} ${JSON.stringify(op).slice(0, 100)}`;
      const expected = results[i]!;
      if (expected.startsWith("EX:IllegalStateException:file:")) {
        // the file lists inside the message come from RAMDirectory.listAll(), whose order is unspecified
        assert.equal(canonLists(normalize(res)), canonLists(normalize(expected)), ctx);
      } else {
        sameResult(res, expected, ctx);
      }
    });
  });
  const all: string[] = golden.nrt.flatMap((s: any) => s[3]);
  assert.ok(all.some((r) => /^\[(.+)\]$/.test(r) && !r.includes("EX:")), "cached files exist in some scripts");
});

test("NRTCachingDirectory: file in both cache and delegate, and a doCacheWrite override", () => {
  const delegate = new RAMDirectory();
  const nrt = new NRTCachingDirectory(delegate, 5.0, 60.0);
  nrt.createOutput("dup", IOContext.DEFAULT).close();
  delegate.createOutput("dup", IOContext.DEFAULT).close();
  let res: string;
  try {
    res = sorted(nrt.listAll());
  } catch (e) {
    res = normalize(exs(e));
  }
  assert.deepEqual([res], golden.nrtDuplicate);

  const never = new (class extends NRTCachingDirectory {
    protected override doCacheWrite(): boolean {
      return false;
    }
  })(new RAMDirectory(), 5.0, 60.0);
  const o2 = never.createOutput("n", IOContext.DEFAULT);
  o2.writeByte(1);
  o2.close();
  assert.deepEqual([sorted(never.listCachedFiles()), sorted(never.listAll()), String(never.fileLength("n"))], golden.nrtNever);
});

// ---------------------------------------------------------------- JDK streams, used on their own
function execStream(s: OutputStream, crc: CRC32, rec: Rec, op: Op): string {
  let res: string;
  try {
    switch (op[0]) {
      case "wb": s.write(op[1]); res = "ok"; break;
      case "wbs": s.write(hexToBytes(op[3]), op[1], op[2]); res = "ok"; break;
      case "flush": s.flush(); res = "ok"; break;
      case "close": s.close(); res = "ok"; break;
      case "crc": res = String(crc.getValue()); break;
      default: throw new Error("bad stream op " + op[0]);
    }
  } catch (e) {
    res = (e as Error).name === "ArrayIndexOutOfBoundsException" ? "EX:" + (e as Error).name : exs(e) + " suppressed=" + suppressedString(e);
  }
  return res + " log=[" + rec.drain() + "]";
}

test("BufferedOutputStream / CheckedOutputStream / FilterOutputStream behave like the JDK (writes, bounds, close with failing flush/close)", () => {
  golden.javaStreams.forEach(([kind, cfg, bufSize, ops, results]: [number, number, number, Op[], string[]], sc: number) => {
    const rec = new Rec(cfg === 1 ? 4 : 0, cfg === 2 || cfg === 4, cfg === 3 || cfg === 4);
    const crc = new CRC32();
    const s: OutputStream = kind === 0 ? new CheckedOutputStream(rec, crc) : kind === 1 ? new FilterOutputStream(rec) : new BufferedOutputStream(rec, bufSize);
    ops.forEach((op, i) =>
      assert.equal(execStream(s, crc, rec, op), results[i], `script ${sc} (kind ${kind}, cfg ${cfg}, buf ${bufSize}) op ${i} ${JSON.stringify(op).slice(0, 80)}`));
  });
  const all: string[] = golden.javaStreams.flatMap((x: any) => x[4]);
  assert.ok(all.some((r) => r.startsWith("EX:IndexOutOfBoundsException")), "bounds check of FilterOutputStream.write");
  assert.ok(all.some((r) => r.includes("EX:IOException:close failed suppressed=[IOException:flush failed]")), "flush failure suppressed by close failure");
});

// ---------------------------------------------------------------- what the wrappers hand to their delegates
class Spy extends FilterDirectory {
  log = "";
  constructor(inner: Directory) {
    super(inner);
  }
  override sync(names: Iterable<string>): void {
    const l = [...names];
    this.log += "sync[" + l.join(", ") + "] ";
    this.in.sync(l);
  }
  override close(): void {
    const l = this.in.listAll().sort(compareJavaStrings);
    this.log += ("atClose=[" + l.map((n) => n + ":" + this.in.fileLength(n) + " ").join("")).trim() + "] ";
    this.in.close();
  }
  drain(): string {
    const s = this.log.trim();
    this.log = "";
    return s;
  }
}

test("FileSwitchDirectory.sync hands each name to the right directory (order kept)", () => {
  const exts = new Set(["fdt", "fdx", "tim"]);
  for (const [names, expected] of golden.fileSwitchSync as [string[], string][]) {
    const p = new Spy(new RAMDirectory());
    const s = new Spy(new RAMDirectory());
    new FileSwitchDirectory(exts, p, s, false).sync(names);
    assert.equal(`p=${p.drain()} s=${s.drain()}`, expected, JSON.stringify(names));
  }
  assert.ok(golden.fileSwitchSync.some((c: any) => c[0].length >= 2));
});

test("NRTCachingDirectory.close copies the cached files to the delegate before closing it", () => {
  for (const [ops, cached, expected] of golden.nrtCloseSnapshot as [Op[], string, string][]) {
    const spy = new Spy(new RAMDirectory());
    const nrt = new NRTCachingDirectory(spy, 0.001, 0.01);
    const locks = new Map<string, Lock>();
    for (const op of ops) common(nrt, op, locks);
    assert.equal(sorted(nrt.listCachedFiles()), cached);
    spy.drain();
    nrt.close();
    assert.equal(spy.drain(), expected, JSON.stringify(ops).slice(0, 100));
  }
  assert.ok(golden.nrtCloseSnapshot.some((c: any) => c[1] !== "[]"), "some files are cached at close time");
});
