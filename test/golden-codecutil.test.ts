/**
 * Differential test for CodecUtil (headers, index headers, footers, checksums) and the index format exceptions.
 * Expected values come from test/golden/codecutil.json, produced by the ORIGINAL Lucene 5.2.1 CodecUtil with
 * assertions enabled (tools/golden/org/apache/lucene/codecs/GoldenCodecUtil.java).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CodecUtil } from "../src/codecs/CodecUtil.js";
import { getMessage, getSuppressed, IOException } from "../src/errors.js";
import { ByteArrayDataInput } from "../src/store/ByteArrayDataInput.js";
import { ByteArrayDataOutput } from "../src/store/ByteArrayDataOutput.js";
import { IOContext } from "../src/store/IOContext.js";
import { RAMDirectory } from "../src/store/RAMDirectory.js";

const golden: { ops: string[]; out: string[] } = JSON.parse(readFileSync(new URL("./golden/codecutil.json", import.meta.url), "utf8"));

const hex = (a: Uint8Array): string => Array.from(a, (x) => x.toString(16).padStart(2, "0")).join("");
function unhex(s: string): Uint8Array {
  const b = new Uint8Array(s.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(s.substring(2 * i, 2 * i + 2), 16);
  return b;
}
const norm = (s: string): string => s.replace(/\(resource[= ][^)]*\)/g, "(resource R)");
function ex(t: unknown): string {
  const e = t as Error & { cause?: unknown };
  let s = "EX:" + e.constructor.name + ":" + norm(String(getMessage(e)));
  for (const x of getSuppressed(e)) s += " | SUP:" + (x as Error).constructor.name + ":" + norm(String(getMessage(x as Error)));
  if (e.cause !== undefined && e.cause !== null) {
    s += " | CAUSE:" + (e.cause as Error).constructor.name + ":" + norm(String(getMessage(e.cause as Error)));
  }
  return s;
}

function make(data: Uint8Array): Uint8Array {
  const d = new RAMDirectory();
  const o = d.createOutput("f", IOContext.DEFAULT);
  o.writeBytes(data, 0, data.length);
  CodecUtil.writeFooter(o);
  o.close();
  return slurp(d);
}
function slurp(d: RAMDirectory): Uint8Array {
  const input = d.openInput("f", IOContext.DEFAULT);
  const b = new Uint8Array(input.length());
  input.readBytes(b, 0, b.length);
  input.close();
  return b;
}
function dirWith(file: Uint8Array): RAMDirectory {
  const d = new RAMDirectory();
  const o = d.createOutput("f", IOContext.DEFAULT);
  o.writeBytes(file, 0, file.length);
  o.close();
  return d;
}
const lh = (x: bigint): string => BigInt.asUintN(64, x).toString(16);

function run(op: string): string {
  const p = op.split(" ");
  switch (p[0]) {
    case "wh": {
      const b = new Uint8Array(400);
      const o = new ByteArrayDataOutput(b);
      CodecUtil.writeHeader(o, p[1]!, parseInt(p[2]!));
      return hex(b.subarray(0, o.getPosition()));
    }
    case "wih": {
      const b = new Uint8Array(800);
      const o = new ByteArrayDataOutput(b);
      CodecUtil.writeIndexHeader(o, p[1]!, parseInt(p[2]!), unhex(p[3]!), p[4]!);
      return hex(b.subarray(0, o.getPosition()));
    }
    case "len":
      return CodecUtil.headerLength(p[1]!) + " " + CodecUtil.indexHeaderLength(p[1]!, p[2]!) + " " + CodecUtil.footerLength();
    case "ch": {
      const input = new ByteArrayDataInput(unhex(p[1]!));
      const v = CodecUtil.checkHeader(input, p[2]!, parseInt(p[3]!), parseInt(p[4]!));
      return v + " " + input.getPosition();
    }
    case "cih": {
      const input = new ByteArrayDataInput(unhex(p[1]!));
      const v = CodecUtil.checkIndexHeader(input, p[2]!, parseInt(p[3]!), parseInt(p[4]!), unhex(p[5]!), p[6]!);
      return v + " " + input.getPosition();
    }
    case "foot":
      return hex(make(unhex(p[1]!)));
    case "cf": {
      const d = dirWith(unhex(p[1]!));
      const input = d.openChecksumInput("f", IOContext.DEFAULT);
      input.skipBytes(parseInt(p[2]!));
      const c = CodecUtil.checkFooter(input);
      return lh(c) + " " + input.getFilePointer();
    }
    case "cfp": {
      const d = dirWith(unhex(p[1]!));
      const input = d.openChecksumInput("f", IOContext.DEFAULT);
      input.skipBytes(parseInt(p[2]!));
      try {
        CodecUtil.checkFooter(input, new IOException(p[3]!));
        return "returned";
      } catch (t) {
        return ex(t) + " fp=" + input.getFilePointer();
      }
    }
    case "ret": {
      const d = dirWith(unhex(p[1]!));
      return lh(CodecUtil.retrieveChecksum(d.openInput("f", IOContext.DEFAULT)));
    }
    case "eof": {
      const d = dirWith(unhex(p[1]!));
      const input = d.openInput("f", IOContext.DEFAULT);
      input.seek(parseInt(p[2]!));
      CodecUtil.checkEOF(input);
      return "ok";
    }
    case "ent": {
      const d = dirWith(unhex(p[1]!));
      return lh(CodecUtil.checksumEntireFile(d.openInput("f", IOContext.DEFAULT)));
    }
    default:
      throw new Error(op);
  }
}

test("CodecUtil: headers, index headers, footers, checksums, format exceptions", () => {
  for (let i = 0; i < golden.ops.length; i++) {
    let got: string;
    try {
      got = run(golden.ops[i]!);
    } catch (e) {
      got = ex(e);
    }
    assert.equal(got, golden.out[i], `#${i} ${golden.ops[i]!.substring(0, 100)}`);
  }
});
