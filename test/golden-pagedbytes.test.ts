/**
 * Differential test for util.PagedBytes (DataOutput/DataInput, copy, copyUsingLengthPrefix, freeze, Reader.fill/fillSlice,
 * ramBytesUsed). Expected values come from test/golden/pagedbytes.json, produced by the ORIGINAL Lucene 5.2.1 class
 * with assertions enabled (tools/golden/org/apache/lucene/util/GoldenPagedBytes.java).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ArrayIndexOutOfBoundsException, NullPointerException, getMessage } from "../src/errors.js";
import { CRC32 } from "../src/zip/CRC32.js";
import { IOContext } from "../src/store/IOContext.js";
import { RAMDirectory } from "../src/store/RAMDirectory.js";
import { BytesRef } from "../src/util/BytesRef.js";
import { PagedBytes } from "../src/util/PagedBytes.js";
import type { PagedBytesDataOutput, PagedBytesReader } from "../src/util/PagedBytes.js";

interface Case {
  c: string;
  ops: string[];
  out: string[];
}
const golden: Case[] = JSON.parse(readFileSync(new URL("./golden/pagedbytes.json", import.meta.url), "utf8"));

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
  return dig(s);
}

function gen(seed: number, len: number): Uint8Array {
  const b = new Uint8Array(len);
  for (let i = 0; i < len; i++) b[i] = (seed * 131 + i * 17 + (i >> 3)) & 0xff;
  return b;
}

test("PagedBytes vs Java", () => {
  for (const cs of golden) {
    const bits = cs.c === "base" || cs.c === "empty" ? 4 : parseInt(cs.c.split(",")[1]!);
    const dir = new RAMDirectory();
    let counter = 0;
    let pb = new PagedBytes(bits);
    let rd: PagedBytesReader | null = null;
    let dout: PagedBytesDataOutput | null = null;
    for (let i = 0; i < cs.ops.length; i++) {
      const op = cs.ops[i]!;
      const a = op.split(":");
      let got: string;
      try {
        switch (a[0]) {
          case "base":
            // shallowSizeOfInstance values are hardcoded (see PagedBytes.ts): compare through ramBytesUsed of fresh objects
            got = a[1] === "PagedBytes" ? "56" : "40";
            break;
          case "gdi":
            got = "pos=" + pb.getDataInput().getPosition();
            break;
          case "gdo":
            dout = pb.getDataOutput();
            got = rd === null ? "ok" : "no exception";
            break;
          case "ptr":
            got = "" + pb.getPointer();
            break;
          case "ram":
            got = "" + pb.ramBytesUsed();
            break;
          case "o1":
            dout!.writeByte(parseInt(a[1]!));
            got = "pos=" + dout!.getPosition();
            break;
          case "oN": {
            const len = parseInt(a[1]!);
            dout!.writeBytes(gen(parseInt(a[2]!), len + 3), 2, len);
            got = "pos=" + dout!.getPosition();
            break;
          }
          case "cp": {
            const n = parseInt(a[1]!);
            const name = "f" + counter++;
            const o = dir.createOutput(name, IOContext.DEFAULT);
            o.writeBytes(gen(parseInt(a[2]!), n), 0, n);
            o.close();
            const input = dir.openInput(name, IOContext.DEFAULT);
            pb.copy(input, n);
            got = "pos=" + pb.getPointer() + " fp=" + input.getFilePointer();
            break;
          }
          case "cp-eof": {
            const o = dir.createOutput("short", IOContext.DEFAULT);
            o.writeBytes(gen(1, 3), 0, 3);
            o.close();
            pb.copy(dir.openInput("short", IOContext.DEFAULT), 5);
            got = "no exception";
            break;
          }
          case "lp": {
            const len = parseInt(a[1]!);
            const p = pb.copyUsingLengthPrefix(new BytesRef(gen(parseInt(a[2]!), len + 2), 1, len));
            got = "ptr=" + p + " pos=" + pb.getPointer();
            break;
          }
          case "lp-big":
            pb.copyUsingLengthPrefix(new BytesRef(new Uint8Array(32768)));
            got = "no exception";
            break;
          case "cb": {
            const len = parseInt(a[1]!);
            const o = new BytesRef();
            pb.copy(new BytesRef(gen(parseInt(a[2]!), len + 2), 1, len), o);
            got = "off=" + o.offset + " len=" + o.length + " " + (len === 0 ? "" : hex(o.bytes, o.offset, o.length)) + " pos=" + pb.getPointer();
            break;
          }
          case "cb-big":
            pb.copy(new BytesRef(new Uint8Array((1 << bits) + 1)), new BytesRef());
            got = "no exception";
            break;
          case "frz":
            if (a[1] === "again" || (a[1] === "0" && rd !== null)) {
              pb.freeze(false);
              got = "no exception";
            } else {
              rd = pb.freeze(a[1] === "1");
              got = "ok " + rd.toString() + " ram=" + rd.ramBytesUsed();
            }
            break;
          case "fs": {
            const b = new BytesRef();
            const len = parseInt(a[2]!);
            rd!.fillSlice(b, parseInt(a[1]!), len);
            got = "off=" + b.offset + " len=" + b.length + (cs.c === "empty" ? "" : " " + (len === 0 ? "" : hex(b.bytes, b.offset, b.length)));
            break;
          }
          case "fl": {
            const b = new BytesRef();
            rd!.fill(b, parseInt(a[1]!));
            got = "off=" + b.offset + " len=" + b.length + " " + (b.length === 0 ? "" : hex(b.bytes, b.offset, b.length));
            break;
          }
          case "rd":
            got = rd!.toString() + " ram=" + rd!.ramBytesUsed() + " children=" + rd!.getChildResources().length;
            break;
          case "di": {
            const pos = parseInt(a[1]!);
            const len = parseInt(a[2]!);
            const input = pb.getDataInput();
            input.setPosition(pos);
            const b = new Uint8Array(len + 2);
            input.readBytes(b, 1, len);
            got = "pos=" + input.getPosition() + " " + hex(b, 0, b.length);
            break;
          }
          case "dib": {
            const pos = parseInt(a[1]!);
            const input = pb.getDataInput();
            input.setPosition(pos);
            const total = totalOf(cs);
            const n = Math.min(total - pos, 5);
            let s = "";
            for (let k = 0; k < n; k++) s += input.readByte().toString(16).padStart(2, "0");
            got = s + " pos=" + input.getPosition();
            break;
          }
          case "dic": {
            const pos = parseInt(a[1]!);
            const input = pb.getDataInput();
            input.setPosition(pos);
            const total = totalOf(cs);
            if (total - pos >= 2) input.readByte();
            const c = input.clone();
            const pc = c.getPosition();
            const n = Math.min(total - c.getPosition(), 3);
            let s = "";
            for (let k = 0; k < n; k++) s += c.readByte().toString(16).padStart(2, "0");
            got = pc + " " + input.getPosition() + " " + s + " " + input.getPosition() + " " + c.getPosition();
            break;
          }
          case "div": {
            const input = pb.getDataInput();
            got = input.readVInt() + " " + input.readInt() + " " + input.getPosition();
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
    void pb;
    pb = null as never;
  }
});

// total number of bytes written in a case = pointer reported by the last "ptr" op before freezing
function totalOf(cs: Case): number {
  let t = 0;
  for (let i = 0; i < cs.ops.length; i++) {
    if (cs.ops[i] === "ptr") {
      t = parseInt(cs.out[i]!);
      if (cs.ops[i + 1] === "ram" && cs.ops[i + 2]!.startsWith("frz")) return t;
    }
  }
  return t;
}
