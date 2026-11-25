/**
 * Differential tests for util.fst (BytesStore, FST reading with ByteSequenceOutputs incl. packed FSTs and page sizes,
 * arcs traversal, findTargetArc, BytesRefFSTEnum seeks). The FSTs are built and saved by the ORIGINAL Lucene 5.2.1
 * Builder; expected values come from test/golden/fst.json (tools/golden/org/apache/lucene/util/fst/GoldenFST.java).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ArrayIndexOutOfBoundsException, NullPointerException, getMessage } from "../src/errors.js";
import { CRC32 } from "../src/zip/CRC32.js";
import { ByteArrayDataInput } from "../src/store/ByteArrayDataInput.js";
import { ByteArrayDataOutput } from "../src/store/ByteArrayDataOutput.js";
import { BytesRef } from "../src/util/BytesRef.js";
import { BytesRefFSTEnum } from "../src/util/fst/BytesRefFSTEnum.js";
import type { BytesRefFSTEnumInputOutput } from "../src/util/fst/BytesRefFSTEnum.js";
import { BytesStore } from "../src/util/fst/BytesStore.js";
import { ByteSequenceOutputs } from "../src/util/fst/ByteSequenceOutputs.js";
import { FST, FSTArc } from "../src/util/fst/FST.js";
import type { FSTBytesReader } from "../src/util/fst/FSTBytesReader.js";

interface Case {
  c: string;
  ops: string[];
  out: string[];
}
const golden: Case[] = JSON.parse(readFileSync(new URL("./golden/fst.json", import.meta.url), "utf8"));

function ex(e: unknown): string {
  if (e instanceof ArrayIndexOutOfBoundsException) return "EX:ArrayIndexOutOfBoundsException";
  if (e instanceof NullPointerException) return "EX:NullPointerException";
  return "EX:" + (e as Error).constructor.name + ":" + getMessage(e as Error);
}

function dig(s: string): string {
  if (s.length <= 300) return s;
  const b = new TextEncoder().encode(s);
  const c = new CRC32();
  c.update(b, 0, b.length);
  return "d" + s.length + ":" + c.getValue().toString(16);
}

function hex(a: Uint8Array, off: number, len: number): string {
  let s = "";
  for (let i = off; i < off + len; i++) s += a[i]!.toString(16).padStart(2, "0");
  return s;
}
function unhex(s: string): Uint8Array {
  const b = new Uint8Array(s.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(s.substring(2 * i, 2 * i + 2), 16);
  return b;
}
function gen(seed: number, len: number): Uint8Array {
  const b = new Uint8Array(len);
  for (let i = 0; i < len; i++) b[i] = (seed * 131 + i * 17 + (i >> 3)) & 0xff;
  return b;
}

test("fst: shallow sizes used by ramBytesUsed", () => {
  const base = golden.find((c) => c.c === "base")!;
  assert.deepEqual(base.out, ["104", "72", "64", "24"]);
});

test("fst: BytesStore vs Java", () => {
  for (const cs of golden.filter((c) => c.c.startsWith("bytesstore"))) {
    const bits = parseInt(cs.c.split(",")[1]!);
    let bs = new BytesStore(bits);
    for (let i = 0; i < cs.ops.length; i++) {
      const op = cs.ops[i]!;
      const a = op.split(":");
      let got: string;
      try {
        switch (a[0]) {
          case "pos":
          case "tot":
            got = "" + bs.getPosition();
            break;
          case "ram":
            got = "" + bs.ramBytesUsed();
            break;
          case "w1":
            bs.writeByte(parseInt(a[1]!));
            got = "pos=" + bs.getPosition();
            break;
          case "wN": {
            const len = parseInt(a[1]!);
            bs.writeBytes(gen(parseInt(a[2]!), len + 3), 2, len);
            got = "pos=" + bs.getPosition();
            break;
          }
          case "wi":
            bs.writeInt(parseInt(a[1]!), parseInt(a[2]!) | 0);
            got = "pos=" + bs.getPosition();
            break;
          case "wb": {
            const len = parseInt(a[2]!);
            bs.writeBytesAt(parseInt(a[1]!), gen(parseInt(a[3]!), len + 2), 1, len);
            got = "pos=" + bs.getPosition();
            break;
          }
          case "cp":
            bs.copyBytes(parseInt(a[1]!), parseInt(a[2]!), parseInt(a[3]!));
            got = "pos=" + bs.getPosition();
            break;
          case "rev":
            bs.reverse(parseInt(a[1]!), parseInt(a[2]!));
            got = "pos=" + bs.getPosition();
            break;
          case "skip":
            bs.skipBytes(parseInt(a[1]!));
            got = "pos=" + bs.getPosition();
            break;
          case "trunc":
            bs.truncate(parseInt(a[1]!));
            got = "pos=" + bs.getPosition();
            break;
          case "rd": {
            const fwd = a[1] === "f";
            const p = parseInt(a[2]!);
            const len = parseInt(a[3]!);
            const rd = fwd ? bs.getForwardReader() : bs.getReverseReader();
            rd.setPosition(p);
            let s = "";
            if (a[4] === "1") {
              const b = new Uint8Array(len);
              rd.readBytes(b, 0, len);
              s = hex(b, 0, len);
            } else {
              for (let k = 0; k < len; k++) s += rd.readByte().toString(16).padStart(2, "0");
            }
            got = dig(s) + " pos=" + rd.getPosition() + " rev=" + rd.reversed();
            break;
          }
          case "rs": {
            const fwd = a[1] === "f";
            const p = parseInt(a[2]!);
            const total = totalBeforeFinish(cs);
            const rd = fwd ? bs.getForwardReader() : bs.getReverseReader();
            rd.setPosition(p);
            rd.skipBytes(fwd ? Math.min(3, total - p - 1) : Math.min(3, p));
            got = "pos=" + rd.getPosition() + " " + rd.readByte().toString(16).padStart(2, "0");
            break;
          }
          case "rr": {
            const rd = bs.getReverseReader(false);
            got = rd.reversed() + " " + rd.getPosition();
            break;
          }
          case "wto": {
            const buf = new Uint8Array(Math.max(1, bs.blocks.reduce((n, b) => n + b.length, 0)));
            const o = new ByteArrayDataOutput(buf);
            bs.writeTo(o);
            const b = buf.subarray(0, o.getPosition());
            got = "len=" + b.length + " " + dig(hex(b, 0, b.length));
            break;
          }
          case "fin":
            bs.finish();
            got = "pos=" + bs.getPosition() + " " + bs;
            break;
          case "fwdr": {
            const rd = bs.getForwardReader();
            got = rd.reversed() + " " + rd.getPosition();
            break;
          }
          case "revr": {
            const rd = bs.getReverseReader();
            got = rd.reversed() + " " + rd.getPosition();
            break;
          }
          default:
            throw new Error("unknown op " + op);
        }
      } catch (e) {
        got = ex(e);
      }
      assert.equal(got, cs.out[i], `[${cs.c}] op ${op}`);
    }
    bs = null as never;
  }
});

// the position of the store before finish(), reported by the "tot" op
function totalBeforeFinish(cs: Case): number {
  return parseInt(cs.out[cs.ops.indexOf("tot")]!);
}

const OUT = ByteSequenceOutputs.getSingleton();

function arcStr(a: FSTArc<BytesRef>): string {
  return a.toString();
}

function walkNodes(f: FST<BytesRef>, follow: FSTArc<BytesRef>, depth: number, s: { v: string }, budget: number[]): void {
  if (budget[0]!-- <= 0) return;
  const input = f.getBytesReader();
  if (!FST.targetHasArcs(follow)) return;
  const arc = new FSTArc<BytesRef>();
  f.readFirstTargetArc(follow, arc, input);
  const kids: FSTArc<BytesRef>[] = [];
  for (;;) {
    s.v += depth + ":" + arcStr(arc) + ";";
    if (arc.label !== FST.END_LABEL) kids.push(new FSTArc<BytesRef>().copyFrom(arc));
    if (arc.isLast()) break;
    s.v += "n" + f.readNextArcLabel(arc, input) + ";";
    f.readNextArc(arc, input);
  }
  const last = new FSTArc<BytesRef>();
  f.readLastTargetArc(follow, last, input);
  s.v += "L:" + arcStr(last) + ";x=" + f.isExpandedTarget(follow, input) + ";";
  if (depth < 6) {
    for (const k of kids) walkNodes(f, k, depth + 1, s, budget);
  }
}

function get(f: FST<BytesRef>, key: Uint8Array): string {
  const arc = f.getFirstArc(new FSTArc<BytesRef>());
  const input = f.getBytesReader();
  let output = f.outputs.getNoOutput();
  for (let i = 0; i < key.length; i++) {
    if (f.findTargetArc(key[i]!, arc, arc, input) === null) {
      return "null";
    }
    output = f.outputs.add(output, arc.output);
  }
  if (arc.isFinal()) {
    return f.outputs.add(output, arc.nextFinalOutput).toString();
  } else {
    return "null";
  }
}

function enumRes(io: BytesRefFSTEnumInputOutput<BytesRef> | null): string {
  return io === null ? "null" : io.input.toString() + "=" + String(io.output);
}

test("fst: FST + BytesRefFSTEnum vs Java", () => {
  const fsts = golden.filter((c) => c.c.startsWith("fst,"));
  assert.ok(fsts.length > 50);
  for (const cs of fsts) {
    const p = cs.c.split(",");
    const inputType = parseInt(p[1]!);
    const saved = unhex(p[4]!);
    let fst: FST<BytesRef> = null as never;
    for (let i = 0; i < cs.ops.length; i++) {
      const op = cs.ops[i]!;
      const kind = op.split(":")[0]!;
      const arg = op.substring(kind.length + 1);
      let got: string;
      try {
        switch (kind) {
          case "L":
            fst = new FST<BytesRef>(new ByteArrayDataInput(saved), OUT, parseInt(arg));
            got =
              String(fst) +
              " empty=" +
              String(fst.getEmptyOutput()) +
              " nodes=" +
              fst.getNodeCount() +
              " arcs=" +
              fst.getArcCount() +
              " awo=" +
              fst.getArcWithOutputCount() +
              " in=" +
              fst.getInputType() +
              " ram=" +
              fst.ramBytesUsed() +
              " ch=" +
              fst.getChildResources().length;
            break;
          case "ARCS": {
            const s = { v: "" };
            const root = fst.getFirstArc(new FSTArc<BytesRef>());
            s.v += arcStr(root) + "|";
            walkNodes(fst, root, 0, s, [3000]);
            got = dig(s.v);
            break;
          }
          case "ARC1": {
            const root = fst.getFirstArc(new FSTArc<BytesRef>());
            got = arcStr(fst.readFirstTargetArc(root, new FSTArc<BytesRef>(), fst.getBytesReader()));
            break;
          }
          case "ENDARC": {
            const root = fst.getFirstArc(new FSTArc<BytesRef>());
            const a = fst.findTargetArc(FST.END_LABEL, root, new FSTArc<BytesRef>(), fst.getBytesReader());
            got = a === null ? "null" : arcStr(a);
            break;
          }
          case "ENUM": {
            const e = new BytesRefFSTEnum<BytesRef>(fst);
            let s = "";
            let count = 0;
            for (let io = e.next(); io !== null; io = e.next()) {
              s += enumRes(io) + ";";
              count++;
            }
            got = count + " " + dig(s);
            break;
          }
          case "GET":
            got = get(fst, unhex(arg));
            break;
          case "SC": {
            const e = new BytesRefFSTEnum<BytesRef>(fst);
            const a = enumRes(e.seekCeil(new BytesRef(unhex(arg))));
            const c = enumRes(e.current().input === null ? null : e.current());
            got = a + " cur=" + c + " next=" + enumRes(e.next());
            break;
          }
          case "SF": {
            const e = new BytesRefFSTEnum<BytesRef>(fst);
            const a = enumRes(e.seekFloor(new BytesRef(unhex(arg))));
            got = a + " next=" + enumRes(e.next());
            break;
          }
          case "SE": {
            const e = new BytesRefFSTEnum<BytesRef>(fst);
            const a = enumRes(e.seekExact(new BytesRef(unhex(arg))));
            got = a + " next=" + enumRes(e.next());
            break;
          }
          case "SEQ": {
            const second = cs.ops.indexOf(cs.ops[i - 0] === undefined ? "" : "L:3");
            const probes = cs.ops
              .slice(0, second)
              .filter((o) => o.startsWith("GET:"))
              .map((o) => unhex(o.substring(4)));
            const e = new BytesRefFSTEnum<BytesRef>(fst);
            let s = "";
            for (let k = 0; k < probes.length; k++) {
              const pb = new BytesRef(probes[k]!);
              switch (k % 3) {
                case 0:
                  s += enumRes(e.seekCeil(pb));
                  break;
                case 1:
                  s += enumRes(e.seekFloor(pb));
                  break;
                default:
                  s += enumRes(e.seekExact(pb));
                  break;
              }
              s += ";";
              if (k % 4 === 0) s += enumRes(e.next()) + ";";
            }
            got = dig(s);
            break;
          }
          default:
            throw new Error("unknown op " + op);
        }
      } catch (e) {
        got = ex(e);
      }
      assert.equal(got, cs.out[i], `[${cs.c.substring(0, 40)}] op ${op.substring(0, 60)}`);
    }
    void inputType;
  }
});
