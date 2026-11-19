/**
 * Differential tests for the Directory family: RAMDirectory (+ RAMFile, RAMInputStream, RAMOutputStream),
 * Directory.copyFrom/openChecksumInput, FilterDirectory, TrackingDirectoryWrapper, Lock (+ Lock.With),
 * SingleInstanceLockFactory, NoLockFactory, IOUtils, Accountables and RamUsageEstimator.humanReadableUnits.
 * Every expected value in test/golden/store-dir.json was produced by the ORIGINAL Lucene 5.2.1 classes
 * (tools/golden/GoldenStoreDir.java, run by tools/golden/generate.sh). The scripts of random operations are
 * replayed here with the same interpreter as the Java side; every single result must be identical.
 *
 * Known, deliberate differences (normalized below): Throwable.toString() prints a package-qualified class name in
 * Java ("java.io.IOException: boom"), TypeScript has no packages; AIOOBE messages are not compared.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AssertionError, IllegalStateException, IOException, RuntimeException, getSuppressed } from "../src/errors.js";
import { ByteArrayOutputStream } from "../src/io/ByteArrayOutputStream.js";
import type { Closeable } from "../src/io/Closeable.js";
import type { DataOutput } from "../src/store/DataOutput.js";
import { Directory } from "../src/store/Directory.js";
import { FilterDirectory } from "../src/store/FilterDirectory.js";
import { IndexInput } from "../src/store/IndexInput.js";
import { IndexOutput } from "../src/store/IndexOutput.js";
import { IOContext } from "../src/store/IOContext.js";
import { Lock } from "../src/store/Lock.js";
import type { LockFactory } from "../src/store/LockFactory.js";
import { NoLockFactory } from "../src/store/NoLockFactory.js";
import { OutputStreamDataOutput } from "../src/store/OutputStreamDataOutput.js";
import { RAMDirectory } from "../src/store/RAMDirectory.js";
import { RAMFile } from "../src/store/RAMFile.js";
import { RAMOutputStream } from "../src/store/RAMOutputStream.js";
import { SingleInstanceLockFactory } from "../src/store/SingleInstanceLockFactory.js";
import { TrackingDirectoryWrapper } from "../src/store/TrackingDirectoryWrapper.js";
import type { Accountable } from "../src/util/Accountable.js";
import { Accountables } from "../src/util/Accountables.js";
import { IOUtils } from "../src/util/IOUtils.js";
import { compareJavaStrings } from "../src/util/JavaCollections.js";
import { RamUsageEstimator } from "../src/util/RamUsageEstimator.js";
import { hexToBytes, toHex } from "./helpers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const golden: any = JSON.parse(readFileSync(new URL("./golden/store-dir.json", import.meta.url), "utf8"));

type Op = any[];

function exs(e: unknown): string {
  assert.ok(e instanceof Error, "thrown value is not an Error: " + String(e));
  return "EX:" + e.name + ":" + e.message;
}

/** AIOOBE / NPE messages differ between JDK versions: only the class is compared. */
function sameResult(actual: string, expected: string, ctx: string): void {
  const cls = /^EX:(ArrayIndexOutOfBoundsException|NullPointerException)/.exec(expected);
  if (cls !== null) {
    assert.ok(actual.startsWith("EX:" + cls[1]), `${ctx}: ${actual}`);
  } else {
    assert.equal(actual, expected, ctx);
  }
}

const arraysToString = (l: string[]): string => "[" + l.join(", ") + "]";
const sortedJava = (l: string[]): string[] => [...l].sort(compareJavaStrings);
const normalize = (s: string): string => s.replace(/(?:[\w$]+[.$])*([\w$]+)@[0-9a-f]+/g, "$1@H");

function applySteps(o: DataOutput, steps: Op[]): void {
  for (const st of steps) {
    switch (st[0]) {
      case "b": {
        const b = hexToBytes(st[1]);
        o.writeBytes(b, 0, b.length);
        break;
      }
      case "B": o.writeByte(st[1]); break;
      case "vi": o.writeVInt(st[1]); break;
      case "s": o.writeString(st[1]); break;
      case "l": o.writeLong(BigInt(st[1])); break;
      default: throw new Error("bad step " + st[0]);
    }
  }
}

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
        case "bytes": {
          const b = new Uint8Array(op[1]);
          input.readBytes(b, 0, b.length);
          res = toHex(b);
          break;
        }
        case "fp": res = String(input.getFilePointer()); break;
        case "len": res = String(input.length()); break;
        case "skip": input.skipBytes(op[1]); res = "ok"; break;
        case "slice": {
          const s = input.slice("sl", op[1], op[2]);
          res = "[" + execRead(s, op[3]) + "]";
          break;
        }
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

function execDir(d: RAMDirectory, op: Op): string {
  try {
    switch (op[0]) {
      case "write": {
        const o = d.createOutput(op[1], IOContext.DEFAULT);
        applySteps(o, op[2]);
        const s = "fp=" + o.getFilePointer() + " crc=" + o.getChecksum();
        o.close();
        return s;
      }
      case "list": return arraysToString(sortedJava(d.listAll()));
      case "length": return String(d.fileLength(op[1]));
      case "exists": return String(d.fileNameExists(op[1]));
      case "delete": d.deleteFile(op[1]); return "ok";
      case "rename": d.renameFile(op[1], op[2]); return "ok";
      case "copy": d.copyFrom(d, op[1], op[2], IOContext.DEFAULT); return "ok";
      case "ram": return String(d.ramBytesUsed());
      case "acct":
        return Accountables.toString(Accountables.namedAccountable("dir", d.getChildResources(), d.ramBytesUsed()));
      case "checksum": {
        const ci = d.openChecksumInput(op[1], IOContext.READ);
        const len = ci.length();
        const b = new Uint8Array(len);
        ci.readBytes(b, 0, b.length);
        const s = "len=" + len + " crc=" + ci.getChecksum() + " fp=" + ci.getFilePointer() + " data=" + toHex(b);
        ci.close();
        return s;
      }
      case "read": {
        const input = d.openInput(op[1], IOContext.READ);
        const s = execRead(input, op[2]);
        input.close();
        return s;
      }
      case "close": d.close(); return "ok";
      default: throw new Error("bad dir op " + op[0]);
    }
  } catch (e) {
    return exs(e);
  }
}

test("RAMDirectory: random scripts give the same result for every operation as Lucene 5.2.1", () => {
  let nonTrivial = 0;
  golden.ramScripts.forEach(([ops, results]: [Op[], string[]], sc: number) => {
    const d = new RAMDirectory();
    ops.forEach((op, i) => {
      const res = execDir(d, op);
      sameResult(res, results[i]!, `script ${sc} op ${i} ${JSON.stringify(op).slice(0, 120)}`);
      if (op[0] === "read" && !res.startsWith("EX:")) nonTrivial++;
    });
  });
  assert.ok(nonTrivial > 20, "the scripts must contain successful reads");
});

function execOut(o: RAMOutputStream, op: Op): string {
  try {
    switch (op[0]) {
      case "write": applySteps(o, op[1]); return "fp=" + o.getFilePointer();
      case "fp": return String(o.getFilePointer());
      case "crc": return String(o.getChecksum());
      case "ram": return String(o.ramBytesUsed());
      case "writeToOut": {
        const bos = new ByteArrayOutputStream();
        const out = new OutputStreamDataOutput(bos);
        o.writeTo(out);
        return toHex(bos.toByteArray());
      }
      case "writeToBytes": {
        const offset = op[1] as number;
        const arr = new Uint8Array(offset + 6000).fill(0x55);
        o.writeTo(arr, offset);
        let end = arr.length;
        while (end > 0 && arr[end - 1] === 0x55) end--;
        return toHex(arr.subarray(0, end));
      }
      case "reset": o.reset(); return "ok";
      case "toString": return o.toString();
      case "close": o.close(); return "ok";
      default: throw new Error("bad out op " + op[0]);
    }
  } catch (e) {
    return exs(e);
  }
}

test("RAMOutputStream: scripts (writes, checksum, writeTo, reset) match Lucene 5.2.1", () => {
  golden.ramOutScripts.forEach(([variant, checksum, ops, results]: [number, boolean, Op[], string[]], sc: number) => {
    const file = new RAMFile();
    const o =
      variant === 0 ? new RAMOutputStream() : variant === 1 ? new RAMOutputStream(file, checksum) : new RAMOutputStream("nm", file, checksum);
    ops.forEach((op, i) => {
      const res = op[0] === "lengthAfterClose" ? String(file.getLength()) : execOut(o, op);
      sameResult(res, results[i]!, `script ${sc} op ${i} ${JSON.stringify(op).slice(0, 100)}`);
    });
  });
});

test("RAMFile: hashCode, equals and toString match Lucene 5.2.1", () => {
  const [contents, hashes, strings, equal]: [string[], number[], string[], string[]] = golden.ramFiles;
  const files = contents.map((hex, i) => {
    const data = hexToBytes(hex);
    const f = new RAMFile();
    const o = new RAMOutputStream(f, false);
    const step = i % 2 === 0 ? Math.max(1, data.length) : 97;
    for (let p = 0; p < data.length; p += step) o.writeBytes(data, p, Math.min(step, data.length - p));
    o.close();
    return f;
  });
  files.forEach((f, i) => {
    assert.equal(f.hashCode(), hashes[i], `hashCode ${i}`);
    assert.equal(f.toString(), strings[i], `toString ${i}`);
    assert.equal(files.map((g) => (f.equals(g) ? "1" : "0")).join(""), equal[i], `equals row ${i}`);
  });
  assert.equal(String(files[0]!.equals(null)) + String(files[0]!.equals("x")) + String(files[0]!.equals(files[0])), "falsefalsetrue");
  assert.ok(equal.slice(0, files.length).some((row) => row.split("1").length > 2), "some files must be equal to each other");
});

function execLock(f: SingleInstanceLockFactory, dir: Directory, locks: Lock[], op: Op): string {
  try {
    const id = op[1] as number;
    switch (op[0]) {
      case "make": locks[id] = f.makeLock(dir, op[2]); return "ok";
      case "obtain": return String(locks[id]!.obtain());
      case "close": locks[id]!.close(); return "ok";
      case "isLocked": return String(locks[id]!.isLocked());
      case "toString": return normalize(locks[id]!.toString());
      default: throw new Error("bad lock op " + op[0]);
    }
  } catch (e) {
    return exs(e);
  }
}

test("SingleInstanceLockFactory: scripts match Lucene 5.2.1", () => {
  const dir = new RAMDirectory();
  golden.singleInstanceLocks.forEach(([ops, results]: [Op[], string[]], sc: number) => {
    const f = new SingleInstanceLockFactory();
    const locks: Lock[] = [];
    ops.forEach((op, i) => assert.equal(execLock(f, dir, locks, op), results[i], `script ${sc} op ${i} ${JSON.stringify(op)}`));
  });
  const flat = golden.singleInstanceLocks.flatMap((s: any) => s[1]);
  assert.ok(flat.some((r: string) => r.startsWith("EX:LockObtainFailedException")), "double obtain must be exercised");
});

test("NoLockFactory: singleton lock that is never held", () => {
  const dir = new RAMDirectory();
  const a = NoLockFactory.INSTANCE.makeLock(dir, "a");
  const b = NoLockFactory.INSTANCE.makeLock(dir, "b");
  assert.deepEqual(
    [String(a.obtain()), String(a.isLocked()), a.toString(), String(a === b), String(a.obtainWait(1000))],
    golden.noLock,
  );
});

class ScriptedLock extends Lock {
  calls = 0;
  closes = 0;
  constructor(readonly outcomes: boolean[], readonly reason: string | null) {
    super();
  }
  obtain(): boolean {
    const ok = this.calls < this.outcomes.length && this.outcomes[this.calls]!;
    this.calls++;
    if (!ok && this.reason !== null) this.failureReason = new IOException(this.reason);
    return ok;
  }
  close(): void {
    this.closes++;
  }
  isLocked(): boolean {
    return false;
  }
  override toString(): string {
    return "ScriptedLock";
  }
}

/** Java prints Throwable.toString() with the package-qualified class name. */
const unqualify = (s: string): string => s.replace(/java\.io\./g, "");

function lockResult(e: unknown): string {
  const c = (e as Error).cause as Error | undefined;
  return exs(e) + " cause=" + (c === undefined || c === null ? "null" : c.name + ":" + c.message);
}

test("Lock.obtainWait: timeouts, number of obtain() calls and failure reasons match Lucene 5.2.1", () => {
  const saved = Lock.LOCK_POLL_INTERVAL;
  Lock.LOCK_POLL_INTERVAL = 1;
  try {
    for (const [oc, to, reason, expected] of golden.lockWait as [string, string, string | null, string][]) {
      const l = new ScriptedLock([...oc].map((c) => c === "1"), reason);
      let res: string;
      try {
        res = String(l.obtainWait(Number(to)));
      } catch (e) {
        res = lockResult(e);
      }
      assert.equal(res + " calls=" + l.calls, unqualify(expected), `outcomes=${oc} timeout=${to} reason=${reason}`);
    }
  } finally {
    Lock.LOCK_POLL_INTERVAL = saved;
  }
});

test("Lock.obtainWait: failureReason is reset by every call (same lock object reused)", () => {
  const saved = Lock.LOCK_POLL_INTERVAL;
  Lock.LOCK_POLL_INTERVAL = 1;
  try {
    const l = new (class extends ScriptedLock {
      override obtain(): boolean {
        const ok = this.calls < this.outcomes.length && this.outcomes[this.calls]!;
        this.calls++;
        if (!ok && this.reason !== null && this.calls === 1) this.failureReason = new IOException(this.reason);
        return ok;
      }
    })([false, false, false, false, true], "stale");
    const res: string[] = [];
    for (const to of [0, 0, 1, 5]) {
      let r: string;
      try {
        r = String(l.obtainWait(to));
      } catch (e) {
        r = lockResult(e);
      }
      res.push(r + " calls=" + l.calls);
    }
    assert.deepEqual(res.map(unqualify), golden.lockWaitReuse.map(unqualify));
  } finally {
    Lock.LOCK_POLL_INTERVAL = saved;
  }
});

test("Lock.With: runs the body under the lock and always releases it", () => {
  const saved = Lock.LOCK_POLL_INTERVAL;
  Lock.LOCK_POLL_INTERVAL = 1;
  try {
    const cases: [boolean[], number, string][] = [
      [[true], 0, "ok"],
      [[false, true], 5, "ok"],
      [[false, false], 1, "ok"],
      [[true], 0, "throw"],
      [[], -3, "ok"],
    ];
    golden.lockWith.forEach(([oc, to, kind, expected]: [string, string, string, string], i: number) => {
      const [outcomes, timeout, k] = cases[i]!;
      assert.equal(oc, outcomes.map((b) => (b ? "1" : "0")).join(""));
      assert.equal(Number(to), timeout);
      assert.equal(kind, k);
      const l = new ScriptedLock(outcomes, null);
      let bodyRuns = 0;
      let res: string;
      try {
        res = String(
          new (class extends Lock.With<string> {
            protected doBody(): string {
              bodyRuns++;
              if (k === "throw") throw new RuntimeException("body failed");
              return "body-result";
            }
          })(l, timeout).run(),
        );
      } catch (e) {
        res = exs(e);
      }
      assert.equal(`${res} body=${bodyRuns} closes=${l.closes} calls=${l.calls}`, expected, `case ${i}`);
    });
  } finally {
    Lock.LOCK_POLL_INTERVAL = saved;
  }
});

class FIn extends IndexInput {
  constructor(readonly inn: IndexInput, readonly failRead: boolean, readonly failClose: boolean) {
    super("FIn");
  }
  close(): void {
    this.inn.close();
    if (this.failClose) throw new IOException("is close failed");
  }
  getFilePointer(): number { return this.inn.getFilePointer(); }
  seek(pos: number): void { this.inn.seek(pos); }
  length(): number { return this.inn.length(); }
  slice(d: string | null, o: number, l: number): IndexInput { return this.inn.slice(d, o, l); }
  readByte(): number { return this.inn.readByte(); }
  readBytes(b: Uint8Array, o: number, l: number): void {
    if (this.failRead) throw new IOException("read failed");
    this.inn.readBytes(b, o, l);
  }
}

class FOut extends IndexOutput {
  constructor(readonly o: IndexOutput, readonly failWrite: boolean, readonly failClose: boolean) {
    super("FOut");
  }
  close(): void {
    this.o.close();
    if (this.failClose) throw new IOException("os close failed");
  }
  getFilePointer(): number { return this.o.getFilePointer(); }
  getChecksum(): bigint { return this.o.getChecksum(); }
  writeByte(b: number): void { this.o.writeByte(b); }
  writeBytes(b: Uint8Array, off: number, len: number): void {
    if (this.failWrite) throw new IOException("write failed");
    this.o.writeBytes(b, off, len);
  }
}

class FDir extends FilterDirectory {
  constructor(inn: Directory, readonly failRead: boolean, readonly failIsClose: boolean, readonly failOsClose: boolean, readonly failWrite: boolean) {
    super(inn);
  }
  override openInput(n: string, c: IOContext): IndexInput { return new FIn(this.in.openInput(n, c), this.failRead, this.failIsClose); }
  override createOutput(n: string, c: IOContext): IndexOutput { return new FOut(this.in.createOutput(n, c), this.failWrite, this.failOsClose); }
}

const suppressedString = (e: unknown): string =>
  "[" +
  getSuppressed(e)
    .map((x) => {
      const n = getSuppressed(x);
      return (x as Error).name + ":" + (x as Error).message + (n.length > 0 ? "{" + suppressedString(x) + "}" : "");
    })
    .join(", ") +
  "]";

test("Directory.copyFrom: failures, suppressed exceptions and clean-up match Lucene 5.2.1 (64 combinations)", () => {
  for (const [mask, expected] of golden.copyFrom as [number, string][]) {
    const fr = (mask & 1) !== 0, fic = (mask & 2) !== 0, foc = (mask & 4) !== 0, fw = (mask & 8) !== 0;
    const missing = (mask & 16) !== 0, destExists = (mask & 32) !== 0;
    const base = new RAMDirectory();
    if (!missing) {
      const o = base.createOutput("src", IOContext.DEFAULT);
      // same content size as the Java run (3000 bytes); only the length matters
      o.writeBytes(new Uint8Array(3000), 0, 3000);
      o.close();
    }
    if (destExists) {
      const o = base.createOutput("dest", IOContext.DEFAULT);
      o.writeByte(7);
      o.close();
    }
    const fd = new FDir(base, fr, fic, foc, fw);
    let res: string;
    try {
      fd.copyFrom(fd, "src", "dest", IOContext.DEFAULT);
      res = "ok";
    } catch (e) {
      res = exs(e) + " suppressed=" + suppressedString(e);
    }
    const destLen = base.fileNameExists("dest") ? String(base.fileLength("dest")) : "none";
    assert.equal(
      `${res} files=${arraysToString(sortedJava(base.listAll()))} destLen=${destLen}`,
      expected,
      `mask ${mask}: readFail=${fr} isCloseFail=${fic} osCloseFail=${foc} writeFail=${fw} missing=${missing} destExists=${destExists}`,
    );
  }
});

function execTrack(t: TrackingDirectoryWrapper, from: RAMDirectory, op: Op): string {
  try {
    switch (op[0]) {
      case "create": {
        const o = t.createOutput(op[1], IOContext.DEFAULT);
        o.writeByte(1);
        o.close();
        return "ok";
      }
      case "delete": t.deleteFile(op[1]); return "ok";
      case "rename": t.renameFile(op[1], op[2]); return "ok";
      case "copy": t.copyFrom(from, op[1], op[2], IOContext.DEFAULT); return "ok";
      case "created": return "ok";
      default: throw new Error("bad track op " + op[0]);
    }
  } catch (e) {
    return exs(e);
  }
}

test("TrackingDirectoryWrapper: created-file set follows create/delete/rename/copy like Lucene 5.2.1", () => {
  golden.tracking.forEach(([ops, results]: [Op[], string[]], sc: number) => {
    const inner = new RAMDirectory();
    const from = new RAMDirectory();
    for (const n of ["f1", "f2"]) {
      const o = from.createOutput(n, IOContext.DEFAULT);
      o.writeString(n);
      o.close();
    }
    const t = new TrackingDirectoryWrapper(inner);
    ops.forEach((op, i) => {
      const res = execTrack(t, from, op);
      const created = sortedJava([...t.getCreatedFiles()]);
      assert.equal(
        `${res} created=${arraysToString(created)} inner=${arraysToString(sortedJava(inner.listAll()))}`,
        results[i],
        `script ${sc} op ${i} ${JSON.stringify(op)}`,
      );
    });
  });
});

test("FilterDirectory / BaseDirectory: unwrap, delegate, toString, null lock factory", () => {
  const base = new RAMDirectory();
  const t1 = new TrackingDirectoryWrapper(base);
  const t2 = new TrackingDirectoryWrapper(t1);
  let npe: string;
  try {
    new RAMDirectory(null as unknown as LockFactory);
    npe = "no exception";
  } catch (e) {
    npe = exs(e);
  }
  assert.deepEqual(
    [
      normalize(base.toString()),
      normalize(t1.toString()),
      normalize(t2.toString()),
      normalize(new RAMDirectory(NoLockFactory.INSTANCE).toString()),
      String(FilterDirectory.unwrap(t2) === base),
      String(FilterDirectory.unwrap(base) === base),
      String(t2.getDelegate() === t1),
      normalize(t1.makeLock("x").toString()),
      npe,
    ],
    golden.filterDirectory,
  );
});

class TestCloseable implements Closeable {
  closed = false;
  constructor(readonly kind: string, readonly msg: string) {}
  close(): void {
    this.closed = true;
    if (this.kind === "io") throw new IOException(this.msg);
    if (this.kind === "rt") throw new IllegalStateException(this.msg);
    if (this.kind === "err") throw new AssertionError(this.msg);
  }
}

test("IOUtils.close / closeWhileHandlingException: first exception wins, the others are suppressed", () => {
  for (const [specs, expected] of golden.ioutilsClose as [[string, string][], string][]) {
    const cl1 = specs.map(([k, m]) => (k === "null" ? null : new TestCloseable(k, m)));
    const cl2 = specs.map(([k, m]) => (k === "null" ? null : new TestCloseable(k, m)));
    let res = "ok";
    try {
      IOUtils.close(cl1);
    } catch (e) {
      res = exs(e) + " suppressed=" + suppressedString(e);
    }
    IOUtils.closeWhileHandlingException(cl2);
    const closed = cl1
      .map((c, j) => (c === null ? "-" : c.closed ? "1" : "0") + (cl2[j] === null ? "-" : cl2[j]!.closed ? "1" : "0"))
      .join(" ");
    assert.equal(`${res} closed=${closed}`, expected, JSON.stringify(specs));

    // varargs form gives the same outcome
    const cl3 = specs.map(([k, m]) => (k === "null" ? null : new TestCloseable(k, m)));
    let res3 = "ok";
    try {
      IOUtils.close(...cl3);
    } catch (e) {
      res3 = exs(e) + " suppressed=" + suppressedString(e);
    }
    assert.equal(res3, res, "varargs form");
  }
});

test("IOUtils.reThrow / reThrowUnchecked / deleteFilesIgnoringExceptions", () => {
  const shape = (fn: () => void, t: unknown): string => {
    try {
      fn();
      return "ok";
    } catch (x) {
      const c = (x as Error).cause as Error | undefined;
      return (x as Error).constructor.name + (x === t ? "=same" : " cause=" + (c === undefined ? "null" : c.name + ":" + c.message));
    }
  };
  // The Java case "new Exception("checked")" has no TypeScript counterpart (every non-IOException Error is unchecked).
  const ts: (Error | null)[] = [null, new IOException("io"), new IllegalStateException("rt"), new AssertionError("err")];
  ts.forEach((t, i) => {
    const [desc, a, b] = golden.ioutilsRethrow[i];
    assert.equal(t === null ? "null" : t.name + ":" + t.message, desc);
    assert.equal(shape(() => IOUtils.reThrow(t), t), a, "reThrow " + desc);
    assert.equal(shape(() => IOUtils.reThrowUnchecked(t), t), b, "reThrowUnchecked " + desc);
  });
  const d = new RAMDirectory();
  for (const n of ["x", "y"]) d.createOutput(n, IOContext.DEFAULT).close();
  IOUtils.deleteFilesIgnoringExceptions(d, "x", "missing", "y");
  assert.deepEqual([arraysToString(d.listAll())], golden.ioutilsDelete);
});

class Node implements Accountable {
  readonly kids: Accountable[];
  constructor(readonly desc: string, readonly bytes: number, ...kids: Accountable[]) {
    this.kids = kids;
  }
  ramBytesUsed(): number { return this.bytes; }
  getChildResources(): readonly Accountable[] { return this.kids; }
  toString(): string { return this.desc; }
}

test("Accountables: tree rendering, named accountables and sorted children match Lucene 5.2.1", () => {
  const tree = new Node(
    "root",
    5 * 1024 * 1024 + 300000,
    new Node("a", 1500, new Node("a1", 10), new Node("a2", 2048, new Node("deep", 1))),
    new Node("b", 3 * 1024 * 1024 * 1024 + 1234567),
  );
  const named = Accountables.namedAccountable("named", tree);
  const plain = Accountables.namedAccountable("plain", 12345);
  const m = new Map<unknown, Accountable>();
  for (const k of ["b", "a", "B", "10", "9", "aa", "é", "Z"]) m.set(k, new Node("n-" + k, k.length * 100));
  const kids = Accountables.namedAccountables("file", m)
    .map((a) => a.toString() + ":" + a.ramBytesUsed() + ";")
    .join("");
  assert.deepEqual(
    [
      Accountables.toString(tree),
      Accountables.toString(named),
      Accountables.toString(plain),
      named.toString() + "|" + named.ramBytesUsed() + "|" + named.getChildResources().length,
      kids,
    ],
    golden.accountables,
  );
});

test("RamUsageEstimator.humanReadableUnits matches Lucene 5.2.1 (float division, DecimalFormat 0.#, HALF_EVEN)", () => {
  for (const [v, expected] of golden.humanReadableUnits as [string, string][]) {
    assert.equal(RamUsageEstimator.humanReadableUnits(Number(v)), expected, `humanReadableUnits(${v})`);
  }
});

test("toString of RAM streams and files matches Lucene 5.2.1", () => {
  const d = new RAMDirectory();
  const o = d.createOutput("a", IOContext.DEFAULT);
  o.writeByte(1);
  o.close();
  const input = d.openInput("a", IOContext.READ);
  const sl = input.slice("part", 0, 1);
  const sl2 = sl.slice(null, 0, 1);
  assert.deepEqual(
    [input.toString(), sl.toString(), sl2.toString(), new RAMFile().toString(), new RAMOutputStream().toString(), new RAMOutputStream("zz", new RAMFile(), true).toString()],
    golden.toStrings,
  );
});
