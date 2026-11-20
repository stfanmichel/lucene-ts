/**
 * Differential tests for the file-system part of the store package: FSDirectory (via SimpleFSDirectory,
 * NIOFSDirectory and MMapDirectory), ByteBufferIndexInput, SimpleFSLockFactory, NativeFSLockFactory,
 * FSLockFactory, VerifyingLockFactory, IOUtils.fsync/rm/deleteFilesIfExist, and the java.nio.ByteBuffer subset
 * that the TypeScript port emulates. Expected values come from test/golden/store-fs.json, produced by the ORIGINAL
 * Lucene 5.2.1 classes and the JDK (tools/golden/org/apache/lucene/store/GoldenStoreFS.java). Scripts of random
 * operations are replayed here against a temporary directory; every result string must be identical
 * ("EX:SimpleClassName:message" for exceptions, the temporary directory shown as "<D>").
 *
 * Deliberate differences: AIOOBE / NPE messages are JDK-specific (class compared only); directory listings are
 * compared sorted (readdir order is unspecified in Java).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IOException } from "../src/errors.js";
import { ByteArrayInputStream } from "../src/io/ByteArrayInputStream.js";
import { ByteArrayOutputStream } from "../src/io/ByteArrayOutputStream.js";
import { ByteBuffer } from "../src/nio/ByteBuffer.js";
import { Files } from "../src/nio/Files.js";
import { ByteBufferIndexInput, type BufferCleaner } from "../src/store/ByteBufferIndexInput.js";
import type { FSDirectory } from "../src/store/FSDirectory.js";
import { FSDirectory as FSD } from "../src/store/FSDirectory.js";
import type { IndexInput } from "../src/store/IndexInput.js";
import type { IndexOutput } from "../src/store/IndexOutput.js";
import { IOContext } from "../src/store/IOContext.js";
import { Lock } from "../src/store/Lock.js";
import type { LockFactory } from "../src/store/LockFactory.js";
import { MergeInfo } from "../src/store/MergeInfo.js";
import { MMapDirectory } from "../src/store/MMapDirectory.js";
import { NativeFSLockFactory } from "../src/store/NativeFSLockFactory.js";
import { NIOFSDirectory } from "../src/store/NIOFSDirectory.js";
import { RAMDirectory } from "../src/store/RAMDirectory.js";
import { RANDOM_ACCESS_INPUT } from "../src/store/RandomAccessInput.js";
import { SimpleFSDirectory } from "../src/store/SimpleFSDirectory.js";
import { SimpleFSLockFactory } from "../src/store/SimpleFSLockFactory.js";
import { SingleInstanceLockFactory } from "../src/store/SingleInstanceLockFactory.js";
import { VerifyingLockFactory } from "../src/store/VerifyingLockFactory.js";
import { IOUtils } from "../src/util/IOUtils.js";
import { compareJavaStrings } from "../src/util/JavaCollections.js";
import { hexToBytes, toHex } from "./helpers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const golden: any = JSON.parse(readFileSync(new URL("./golden/store-fs.json", import.meta.url), "utf8"));
type Op = any[];

const BASE = realpathSync(mkdtempSync(join(tmpdir(), "lucene-ts-fs-")));
process.on("exit", () => {
  try {
    rmSync(BASE, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

/** the base directory and identity hashes are not comparable between runs / JVM and JS */
const norm = (s: string): string => s.split(BASE).join("<D>").replace(/(?:[\w$]+[.$])*([\w$]+)@[0-9a-f]+/g, "$1@H");

function exs(e: unknown): string {
  assert.ok(e instanceof Error, "thrown value is not an Error: " + String(e));
  return norm("EX:" + e.name + ":" + e.message);
}

function res(f: () => string): string {
  try {
    return norm(f());
  } catch (e) {
    return exs(e);
  }
}

/** AIOOBE / NPE messages are JDK-specific: only the class is compared. */
const jdkMsg = (s: string): string => s.replace(/EX:(ArrayIndexOutOfBoundsException|NullPointerException):[^|]*/g, "EX:$1");
function same(actual: string, expected: string, ctx: string): void {
  if (/EX:(ArrayIndexOutOfBoundsException|NullPointerException)/.test(expected)) {
    assert.equal(jdkMsg(actual), jdkMsg(expected), ctx);
  } else {
    assert.equal(actual, expected, ctx);
  }
}

const sorted = (l: string[]): string => "[" + [...l].sort(compareJavaStrings).join(", ") + "]";

// ---------------------------------------------------------------- java.nio.ByteBuffer
test("ByteBuffer emulation matches java.nio.ByteBuffer", () => {
  const scripts: Op[][] = golden.byteBuffer;
  assert.ok(scripts.length > 0);
  scripts.forEach((ops, s) => {
    const n0: number = ops[0][0][1];
    const arr = new Uint8Array(n0);
    for (let i = 0; i < n0; i++) arr[i] = (i * 37 + 5 + s) & 0xff;
    const stack: ByteBuffer[] = [ByteBuffer.wrap(arr)];
    assert.equal("cap=" + stack[0]!.capacity(), ops[0][1]);
    ops.slice(1).forEach(([op, expected], k) => {
      const b = stack[stack.length - 1]!;
      let r: string;
      try {
        switch (op[0]) {
          case "clear": b.clear(); r = "ok"; break;
          case "pos": b.position(op[1]); r = "ok"; break;
          case "lim": b.limit(op[1]); r = "ok"; break;
          case "getPos": r = "" + b.position(); break;
          case "getLim": r = "" + b.limit(); break;
          case "rem": r = b.remaining() + "/" + b.hasRemaining(); break;
          case "get": r = "" + ((b.get() as number) & 0xff); break;
          case "getAt": r = "" + ((b.get(op[1]) as number) & 0xff); break;
          case "bulk": {
            const dst = new Uint8Array(op[1]).fill(0x77);
            try {
              b.get(dst, op[2], op[3]);
              r = "ok:" + toHex(dst);
            } catch (e) {
              r = exs(e) + "|" + toHex(dst);
            }
            break;
          }
          case "short": r = "" + b.getShort(); break;
          case "int": r = "" + b.getInt(); break;
          case "long": r = "" + b.getLong(); break;
          case "shortAt": r = "" + b.getShort(op[1]); break;
          case "intAt": r = "" + b.getInt(op[1]); break;
          case "longAt": r = "" + b.getLong(op[1]); break;
          case "dup": stack.push(b.duplicate()); r = "ok"; break;
          case "slice": stack.push(b.slice()); r = "ok"; break;
          case "pop": if (stack.length > 1) { stack.pop(); r = "ok"; } else r = "none"; break;
          case "cap": r = "" + b.capacity(); break;
          case "wrap": {
            assert.equal(op[1], n0);
            const w = ByteBuffer.wrap(arr, op[2], op[3]);
            stack.push(w);
            r = w.position() + "/" + w.limit() + "/" + w.capacity();
            break;
          }
          case "posLim": b.limit(op[2]); b.position(op[1]); r = "ok"; break;
          default: throw new Error("bad op " + op[0]);
        }
      } catch (e) {
        r = exs(e);
      }
      same(norm(r), expected, `script ${s} op ${k + 1} ${JSON.stringify(op)}`);
    });
  });
});

// ---------------------------------------------------------------- scripted reads on an IndexInput
class Session {
  readonly stack: IndexInput[];
  readonly random: boolean;
  constructor(readonly root: IndexInput) {
    this.stack = [root];
    this.random = (root as any)[RANDOM_ACCESS_INPUT] === true;
  }
  top(): IndexInput {
    return this.stack[this.stack.length - 1]!;
  }
  run(op: Op, log?: { text: string }): string {
    const inp = this.top();
    return res(() => {
      switch (op[0]) {
        case "rb": return "" + (inp.readByte() & 0xff);
        case "rbs": {
          const [n, off, mode] = [op[1] as number, op[2] as number, op[3] as number];
          const arr = new Uint8Array(off + n + 2).fill(0x77);
          let r: string;
          try {
            if (mode === 0) inp.readBytes(arr, off, n);
            else inp.readBytes(arr, off, n, mode === 2);
            r = "ok";
          } catch (e) {
            r = exs(e);
          }
          return r + "|" + toHex(arr);
        }
        case "rs": return "" + inp.readShort();
        case "ri": return "" + inp.readInt();
        case "rl": return "" + inp.readLong();
        case "rvi": return "" + inp.readVInt();
        case "rvl": return "" + inp.readVLong();
        case "seek": inp.seek(op[1]); return "ok";
        case "fp": return "" + inp.getFilePointer();
        case "len": return "" + inp.length();
        case "at": {
          if (!this.random) return "NA";
          const ra = inp as any;
          const p: number = op[2];
          switch (op[1]) {
            case "b": return "" + (ra.readByte(p) & 0xff);
            case "s": return "" + ra.readShort(p);
            case "i": return "" + ra.readInt(p);
            default: return "" + ra.readLong(p);
          }
        }
        case "slice": this.stack.push(inp.slice("sl" + this.stack.length, op[1], op[2])); return "ok";
        case "clone": this.stack.push(inp.clone()); return "ok";
        case "pop": if (this.stack.length > 1) { this.stack.pop(); return "ok"; } return "none";
        case "str": return inp.toString();
        case "close": inp.close(); return "ok";
        case "closeRoot": this.root.close(); return "ok";
        case "clog": { const l = (log?.text ?? "").trim(); if (log) log.text = ""; return l; }
        default: throw new Error("bad read op " + op[0]);
      }
    });
  }
}

function replayReads(root: IndexInput, script: Op[], ctx: string): void {
  const s = new Session(root);
  script.forEach(([op, expected], i) => same(s.run(op), expected, `${ctx} read op ${i} ${JSON.stringify(op)}`));
}

// ---------------------------------------------------------------- directories
const ioctx = (k: number): IOContext => (k === 0 ? IOContext.DEFAULT : k === 1 ? IOContext.READONCE : k === 2 ? IOContext.READ : new IOContext(new MergeInfo(10, 1000, false, 1)));

function makeDir(kind: number, p: string, chunk: number): FSDirectory {
  switch (kind) {
    case 0: return new SimpleFSDirectory(p);
    case 1: return new NIOFSDirectory(p);
    default: {
      const m = new MMapDirectory(p, chunk);
      m.setUseUnmap(false);
      return m;
    }
  }
}

function dirOp(d: FSDirectory, op: Op): string {
  return res(() => {
    switch (op[0]) {
      case "len": return "" + d.fileLength(op[1]);
      case "list": return "[" + d.listAll().join(", ") + "]";
      case "delete": d.deleteFile(op[1]); return "ok";
      case "rename": d.renameFile(op[1], op[2]); return "ok";
      case "sync": d.sync(op[1]); return "ok";
      case "str": return d.toString();
      case "getDir": return d.getDirectory();
      case "lockStr": return d.makeLock("write.lock").toString();
      case "read": return "" + d.openInput(op[1], IOContext.DEFAULT);
      case "create": { const out = d.createOutput(op[1], IOContext.DEFAULT); out.close(); return "ok"; }
      default: throw new Error("bad dir op " + op[0]);
    }
  });
}

test("SimpleFSDirectory, NIOFSDirectory and MMapDirectory behave like the Java classes", () => {
  const scripts: Op[][] = golden.dirs;
  assert.ok(scripts.length > 100);
  scripts.forEach((ops, si) => {
    const [, kind, chunk, id] = ops[0][0] as [string, number, number, number];
    const p = join(BASE, "s" + id);
    const d = makeDir(kind, p, chunk);
    const open: IndexOutput[] = [];
    const ctx0 = `dir script ${si} (kind ${kind}, chunk ${chunk})`;
    assert.equal(norm("ok " + d.toString() + " " + d.getDirectory()), ops[0][1], ctx0 + " ctor");
    let closed = false;
    ops.slice(1).forEach(([op, expected], i) => {
      const ctx = `${ctx0} op ${i + 1} ${JSON.stringify(op).substring(0, 200)}`;
      if (closed) {
        same(dirOp(d, op), expected, ctx);
        return;
      }
      let r: string;
      switch (op[0]) {
        case "create": {
          const [, name, hex, piece, close, c] = op as [string, string, string, number, boolean, number];
          const data = hexToBytes(hex);
          r = res(() => {
            const o = d.createOutput(name, ioctx(c));
            if (!close) open.push(o);
            if (piece === 0) {
              for (const b of data) o.writeByte(b);
            } else {
              for (let off = 0; off < data.length; off += piece) {
                const n = Math.min(piece, data.length - off);
                const arr = new Uint8Array(n + 3);
                arr.set(data.subarray(off, off + n), 1);
                o.writeBytes(arr, 1, n);
              }
            }
            let s = "fp=" + o.getFilePointer() + " crc=" + o.getChecksum() + " len=" + d.fileLength(name);
            if (close) {
              o.close();
              s += " closed len=" + d.fileLength(name);
            }
            return s;
          });
          break;
        }
        case "read": {
          const [, nm, c] = op as [string, string, number];
          let inp: IndexInput | null = null;
          r = "";
          try {
            inp = d.openInput(nm, ioctx(c));
          } catch (e) {
            r = exs(e);
          }
          if (inp !== null) {
            assert.equal(op.length, 5, ctx + ": opened here but not in Java: " + String(inp));
            replayReads(inp, op[3], ctx);
            const fin = inp;
            same(res(() => { fin.close(); return "closed"; }), op[4], ctx + " close");
            r = "opened";
          } else {
            assert.equal(op.length, 3, ctx + ": open failed here but not in Java: " + r);
          }
          break;
        }
        case "mkdir": r = res(() => { Files.createDirectories(join(d.getDirectory(), op[1])); return "ok"; }); break;
        case "mkdirNonEmpty":
          r = res(() => {
            const q = join(d.getDirectory(), op[1]);
            Files.createDirectories(q);
            writeFileSync(join(q, "x"), new Uint8Array([1]));
            return "ok";
          });
          break;
        case "listStatic": {
          const w: number = op[1];
          r = res(() => {
            const q = w === 0 ? p : w === 1 ? join(BASE, "nonexistent") : join(p, op[2]);
            return sorted(FSD.listAllIn(q));
          });
          break;
        }
        case "readDir":
          r = res(() => {
            const inp = d.openInput(op[1], IOContext.DEFAULT);
            try {
              return "" + ((inp.readByte() << 24) >> 24); // Java bytes are signed
            } finally {
              inp.close();
            }
          });
          break;
        case "closeOuts": r = res(() => { for (const o of open) o.close(); open.length = 0; return "ok"; }); break;
        case "closeDir": r = res(() => { d.close(); return "ok"; }); closed = true; break;
        case "list": r = res(() => sorted(d.listAll())); break;
        default: r = dirOp(d, op);
      }
      same(r, expected, ctx);
    });
    for (const o of open) {
      try { o.close(); } catch { /* ignore */ }
    }
    try { d.close(); } catch { /* ignore */ }
    IOUtils.rm(p);
  });
});

// ---------------------------------------------------------------- ByteBufferIndexInput on its own
test("ByteBufferIndexInput behaves like the Java class (clone tracking, cleaner, slices over several buffers)", () => {
  const scripts: Op[][] = golden.bbii;
  assert.ok(scripts.length > 100);
  scripts.forEach((ops, s) => {
    const [, power, length, hex, track, withCleaner, failAt] = ops[0][0] as [string, number, number, string, boolean, boolean, number];
    const data = hexToBytes(hex);
    const chunk = 1 << power;
    const nr = (length >>> power) + 1;
    const bufs: ByteBuffer[] = [];
    for (let i = 0; i < nr; i++) {
      const start = i * chunk;
      const size = Math.max(0, Math.min(chunk, length - start));
      bufs.push(ByteBuffer.wrap(data.slice(start, start + size)));
    }
    const log = { text: "" };
    let n = 0;
    const cleaner: BufferCleaner | null = withCleaner
      ? {
          freeBuffer(parent: ByteBufferIndexInput, b: ByteBuffer): void {
            n++;
            log.text += `free(${parent},${b.capacity()},${b.position()},${b.limit()}) `;
            if (n === failAt) throw new IOException("clean failed");
          },
        }
      : null;
    const inp = ByteBufferIndexInput.newInstance("bb" + s, bufs, length, power, cleaner, track);
    assert.equal(inp.constructor.name + " " + inp.length(), ops[0][1], `bbii ${s} new`);
    const sess = new Session(inp);
    ops.slice(1).forEach(([op, expected], i) => {
      const ctx = `bbii script ${s} op ${i + 1} ${JSON.stringify(op)}`;
      same(norm(sess.run(op, log)), expected, ctx);
    });
  });
});

// ---------------------------------------------------------------- lock factories
test("SimpleFSLockFactory and NativeFSLockFactory behave like the Java classes", () => {
  Lock.LOCK_POLL_INTERVAL = 1;
  const scripts: Op[][] = golden.locks;
  assert.ok(scripts.length === 80);
  scripts.forEach((ops, si) => {
    const [, kind, id, nio] = ops[0][0] as [string, number, number, number];
    const p = join(BASE, "s" + id);
    const lf: LockFactory = kind === 0 ? SimpleFSLockFactory.INSTANCE : NativeFSLockFactory.INSTANCE;
    const d: FSDirectory = nio === 1 ? new NIOFSDirectory(p, lf) : new SimpleFSDirectory(p, lf);
    assert.equal(norm(d.toString()), ops[0][1], `lock script ${si} ctor`);
    const locks: Array<Lock | null> = [null, null, null];
    ops.slice(1).forEach(([op, expected], i) => {
      const ctx = `lock script ${si} (kind ${kind}) op ${i + 1} ${JSON.stringify(op)}`;
      const li: number = op[1];
      let r: string;
      switch (op[0]) {
        case "make": r = res(() => { locks[li] = d.makeLock(op[2]); return locks[li]!.toString(); }); break;
        case "obtain": r = res(() => "" + locks[li]!.obtain()); break;
        case "obtainWait": r = res(() => "" + locks[li]!.obtainWait(op[2])); break;
        case "isLocked": r = res(() => "" + locks[li]!.isLocked()); break;
        case "close": r = res(() => { locks[li]!.close(); return "ok"; }); break;
        case "str": r = res(() => locks[li]!.toString()); break;
        case "touch": r = res(() => { Files.createFile(join(p, op[1])); return "ok"; }); break;
        case "rmfile": r = res(() => "" + Files.deleteIfExists(join(p, op[1]))); break;
        case "list": r = res(() => sorted(FSD.listAllIn(p))); break;
        case "ramLock": r = res(() => lf.makeLock(new RAMDirectory(), "x").toString()); break;
        default: throw new Error("bad lock op " + op[0]);
      }
      same(r, expected, ctx);
    });
    for (const l of locks) {
      try { l?.close(); } catch { /* ignore */ }
    }
    d.close();
    IOUtils.rm(p);
  });
});

test("VerifyingLockFactory follows the lock server protocol like the Java class", () => {
  const scripts: Op[][] = golden.verifying;
  assert.ok(scripts.length > 0);
  scripts.forEach((ops, si) => {
    const answers = hexToBytes(ops[0][0][1]);
    const out = new ByteArrayOutputStream();
    const dir = new RAMDirectory();
    const vf = new VerifyingLockFactory(new SingleInstanceLockFactory(), new ByteArrayInputStream(answers), out);
    const locks: Array<Lock | null> = [null, null];
    ops.slice(1).forEach(([op, expected], i) => {
      const ctx = `verifying script ${si} op ${i + 1} ${JSON.stringify(op)}`;
      const li: number = op[1];
      let r: string;
      switch (op[0]) {
        case "make": r = res(() => { locks[li] = vf.makeLock(dir, "l" + li); return "ok"; }); break;
        case "obtain": r = res(() => "" + locks[li]!.obtain()); break;
        case "close": r = res(() => { locks[li]!.close(); return "ok"; }); break;
        case "isLocked": r = res(() => "" + locks[li]!.isLocked()); break;
        default: throw new Error("bad op " + op[0]);
      }
      assert.equal(r + " out=" + toHex(out.toByteArray()), expected, ctx);
    });
  });
});

// ---------------------------------------------------------------- IOUtils.fsync / rm / deleteFiles*
test("IOUtils.fsync, rm and deleteFiles* behave like the Java methods", () => {
  const scripts: Op[][] = golden.fsutil;
  assert.ok(scripts.length > 0);
  const paths = (p: string, names: Array<string | null>): Array<string | null> => names.map((n) => (n === null ? null : join(p, n)));
  const tree = (root: string, q: string, out: string[]): void => {
    for (const n of FSD.listAllIn(q)) {
      const c = join(q, n);
      const dir = Files.isDirectory(c);
      out.push(c.substring(root.length + 1) + (dir ? "/" : ":" + Files.size(c)));
      if (dir) tree(root, c, out);
    }
  };
  scripts.forEach((ops, si) => {
    const p = join(BASE, "u" + si);
    Files.createDirectories(p);
    ops.forEach(([op, expected], i) => {
      const ctx = `fsutil script ${si} op ${i} ${JSON.stringify(op)}`;
      let r: string;
      switch (op[0]) {
        case "file":
          r = res(() => {
            const q = join(p, op[1]);
            Files.createDirectories(join(q, ".."));
            const o = Files.newOutputStream(q);
            try {
              if (op[2] > 0) o.write(new Uint8Array(op[2]), 0, op[2]);
            } finally {
              o.close();
            }
            return "ok";
          });
          break;
        case "dir": r = res(() => { Files.createDirectories(join(p, op[1])); return "ok"; }); break;
        case "fsync": r = res(() => { IOUtils.fsync(join(p, op[1]), op[2]); return "ok"; }); break;
        case "rm": r = res(() => { IOUtils.rm(...paths(p, op[1])); return "ok"; }); break;
        case "deleteFilesIfExist": r = res(() => { IOUtils.deleteFilesIfExist(...paths(p, op[1])); return "ok"; }); break;
        case "deleteFilesIfExistColl": r = res(() => { IOUtils.deleteFilesIfExist(paths(p, op[1])); return "ok"; }); break;
        case "deleteFilesIgnoringExceptions": r = res(() => { IOUtils.deleteFilesIgnoringExceptions(...paths(p, op[1])); return "ok"; }); break;
        case "tree": r = res(() => { const l: string[] = []; tree(p, p, l); return "[" + l.sort(compareJavaStrings).join(", ") + "]"; }); break;
        default: throw new Error("bad op " + op[0]);
      }
      same(r, expected, ctx);
    });
    IOUtils.rm(p);
  });
});
