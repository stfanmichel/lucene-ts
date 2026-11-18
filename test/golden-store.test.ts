/**
 * Differential tests for DataInput, DataOutput, ByteArrayDataInput, ByteArrayDataOutput,
 * InputStreamDataInput and OutputStreamDataOutput. Every expected value in test/golden/store-data.json was
 * produced by the ORIGINAL Lucene 5.2.1 classes (tools/golden/GoldenStore.java, run by tools/golden/generate.sh).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ByteArrayInputStream } from "../src/io/ByteArrayInputStream.js";
import { ByteArrayOutputStream } from "../src/io/ByteArrayOutputStream.js";
import { ByteArrayDataInput } from "../src/store/ByteArrayDataInput.js";
import { ByteArrayDataOutput } from "../src/store/ByteArrayDataOutput.js";
import type { DataInput } from "../src/store/DataInput.js";
import type { DataOutput } from "../src/store/DataOutput.js";
import { InputStreamDataInput } from "../src/store/InputStreamDataInput.js";
import { OutputStreamDataOutput } from "../src/store/OutputStreamDataOutput.js";
import { decodeUtf8Java } from "../src/util/JavaUtf8Decoder.js";
import { hexToBytes, toHex } from "./helpers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const golden: any = JSON.parse(readFileSync(new URL("./golden/store-data.json", import.meta.url), "utf8"));

type Kind = "byte" | "short" | "int" | "long" | "vint" | "vlong" | "zint" | "zlong" | "string";
const KINDS: Kind[] = ["byte", "short", "int", "long", "vint", "vlong", "zint", "zlong", "string"];

function writeOp(out: DataOutput, [kind, v]: [Kind, string]): void {
  switch (kind) {
    case "byte": out.writeByte(Number(v)); break;
    case "short": out.writeShort(Number(v)); break;
    case "int": out.writeInt(Number(v)); break;
    case "long": out.writeLong(BigInt(v)); break;
    case "vint": out.writeVInt(Number(v)); break;
    case "vlong": out.writeVLong(BigInt(v)); break;
    case "zint": out.writeZInt(Number(v)); break;
    case "zlong": out.writeZLong(BigInt(v)); break;
    case "string": out.writeString(v); break;
  }
}

/** Reads one value, returning it the way the golden file spells it (numbers and longs as decimal strings). */
function readOp(inp: DataInput, kind: Kind): string {
  switch (kind) {
    case "byte": return String(inp.readByte());
    case "short": return String(inp.readShort());
    case "int": return String(inp.readInt());
    case "long": return String(inp.readLong());
    case "vint": return String(inp.readVInt());
    case "vlong": return String(inp.readVLong());
    case "zint": return String(inp.readZInt());
    case "zlong": return String(inp.readZLong());
    case "string": return inp.readString();
  }
}

function streamIn(data: Uint8Array): InputStreamDataInput {
  return new InputStreamDataInput(new ByteArrayInputStream(data));
}

/** Golden results are either a plain value or "EX:ClassName:message" for an exception. */
function expectResult(fn: () => unknown, expected: unknown, ctx: string): void {
  if (typeof expected === "string" && expected.startsWith("EX:")) {
    const [, cls, ...rest] = expected.split(":");
    const msg = rest.join(":");
    assert.throws(
      fn,
      (e: unknown) => {
        assert.ok(e instanceof Error, `${ctx}: not an Error`);
        assert.equal(e.name, cls, `${ctx}: exception class`);
        // the JDK's message for array bounds errors is version specific
        if (cls !== "ArrayIndexOutOfBoundsException") {
          assert.equal(e.message, msg, `${ctx}: exception message`);
        }
        return true;
      },
      ctx,
    );
  } else {
    assert.equal(fn(), expected, ctx);
  }
}

function replay(c: any, ctx: string): void {
  const ops: [Kind, string][] = c.ops;
  // writing, through both DataOutput implementations
  const bos = new ByteArrayOutputStream();
  const out = new OutputStreamDataOutput(bos);
  for (const op of ops) writeOp(out, op);
  out.close();
  assert.equal(toHex(bos.toByteArray()), c.hex, `${ctx}: OutputStreamDataOutput bytes`);
  const buf = new Uint8Array(bos.size() + 3);
  const bad = new ByteArrayDataOutput(buf);
  for (const op of ops) writeOp(bad, op);
  assert.equal(bad.getPosition(), bos.size(), `${ctx}: ByteArrayDataOutput position`);
  assert.equal(toHex(buf.subarray(0, bad.getPosition())), c.hex, `${ctx}: ByteArrayDataOutput bytes`);
  // reading back, through both DataInput implementations
  const data = hexToBytes(c.hex);
  const sin = streamIn(data);
  const bin = new ByteArrayDataInput(data);
  ops.forEach(([kind], i) => {
    assert.equal(readOp(sin, kind), c.read[i], `${ctx}: InputStreamDataInput op ${i} (${kind})`);
    assert.equal(readOp(bin, kind), c.read[i], `${ctx}: ByteArrayDataInput op ${i} (${kind})`);
  });
  assert.ok(bin.eof(), `${ctx}: eof`);
}

test("golden: boundary values of every type round-trip like Java", () => {
  golden.boundaries.forEach((c: any, i: number) => replay(c, `boundaries[${i}]`));
});

test("golden: 300 random mixed sequences write the same bytes and read the same values", () => {
  golden.random.forEach((c: any, i: number) => replay(c, `random[${i}]`));
});

test("golden: malformed and truncated input, every reader, both DataInput implementations", () => {
  for (const c of golden.reads) {
    const data = hexToBytes(c.hex);
    for (const kind of KINDS) {
      const g = c[kind];
      const ctx = `reads[${c.hex}].${kind}`;
      expectResult(() => readOp(streamIn(data), kind), g.stream, `${ctx} stream`);
      const bin = new ByteArrayDataInput(data);
      expectResult(() => readOp(bin, kind), g.bytes, `${ctx} bytes`);
      assert.equal(bin.getPosition(), g.pos, `${ctx} position after`);
    }
  }
});

test("golden: skipBytes (1024-byte skip buffer, EOF, negative counts, unchecked ByteArrayDataInput)", () => {
  const data = hexToBytes(golden.skip.data);
  for (const c of golden.skip.cases) {
    const ctx = `skip(${c.count})`;
    expectResult(() => {
      const inp = streamIn(data);
      inp.skipBytes(c.count);
      return String(inp.readByte());
    }, c.stream, `${ctx} stream`);
    const bin = new ByteArrayDataInput(data);
    expectResult(() => {
      bin.skipBytes(c.count);
      return String(bin.readByte());
    }, c.bytes, `${ctx} bytes`);
    assert.equal(bin.getPosition(), c.pos, `${ctx} position`);
  }
});

test("golden: copyBytes (16384-byte copy buffer)", () => {
  const data = hexToBytes(golden.copy.data);
  for (const c of golden.copy.cases) {
    const ctx = `copyBytes(${c.count})`;
    expectResult(() => {
      const bos = new ByteArrayOutputStream();
      new OutputStreamDataOutput(bos).copyBytes(streamIn(data), c.count);
      assert.equal(toHex(bos.toByteArray()), toHex(data.subarray(0, c.count)));
      return String(bos.size());
    }, c.stream, `${ctx} stream`);
    expectResult(() => {
      const dst = new Uint8Array(c.count);
      const out = new ByteArrayDataOutput(dst);
      out.copyBytes(new ByteArrayDataInput(data), c.count);
      assert.equal(toHex(dst), toHex(data.subarray(0, c.count)));
      return String(out.getPosition());
    }, c.bytes, `${ctx} bytes`);
  }
});

const pairs = (m: ReadonlyMap<string, string>): [string, string][] => [...m.entries()];

test("golden: maps and sets (write bytes; read back in Java's HashMap / TreeMap / unmodifiable order)", () => {
  golden.collections.forEach((c: any, i: number) => {
    const ctx = `collections[${i}] (${c.entries.length} entries)`;
    const m = new Map<string, string>(c.entries);
    const keys = new Set<string>(m.keys());
    const w = (f: (o: DataOutput) => void): string => {
      const bos = new ByteArrayOutputStream();
      f(new OutputStreamDataOutput(bos));
      return toHex(bos.toByteArray());
    };
    assert.equal(w((o) => o.writeStringStringMap(m)), c.stringStringMapHex, `${ctx}: writeStringStringMap`);
    assert.equal(w((o) => o.writeMapOfStrings(m)), c.mapOfStringsHex, `${ctx}: writeMapOfStrings`);
    assert.equal(w((o) => o.writeStringSet(keys)), c.stringSetHex, `${ctx}: writeStringSet`);
    assert.equal(w((o) => o.writeSetOfStrings(keys)), c.setOfStringsHex, `${ctx}: writeSetOfStrings`);
    const bin = (h: string): ByteArrayDataInput => new ByteArrayDataInput(hexToBytes(h));
    assert.deepEqual(pairs(bin(c.stringStringMapHex).readStringStringMap()), c.readStringStringMap, `${ctx}: readStringStringMap`);
    assert.deepEqual(pairs(bin(c.mapOfStringsHex).readMapOfStrings()), c.readMapOfStrings, `${ctx}: readMapOfStrings`);
    assert.deepEqual([...bin(c.stringSetHex).readStringSet()], c.readStringSet, `${ctx}: readStringSet`);
    assert.deepEqual([...bin(c.setOfStringsHex).readSetOfStrings()], c.readSetOfStrings, `${ctx}: readSetOfStrings`);
    assert.deepEqual(
      pairs(streamIn(hexToBytes(c.mapOfStringsHex)).readMapOfStrings()),
      c.streamReadMapOfStrings,
      `${ctx}: readMapOfStrings through a stream`,
    );
  });
});

test("golden: duplicate keys in a serialized map or set", () => {
  golden.duplicates.forEach((c: any, i: number) => {
    const ctx = `duplicates[${i}] (n=${c.n})`;
    const bin = (h: string): ByteArrayDataInput => new ByteArrayDataInput(hexToBytes(h));
    assert.deepEqual(pairs(bin(c.mapHex).readMapOfStrings()), c.mapOfStrings, `${ctx}: readMapOfStrings`);
    assert.deepEqual([...bin(c.setHex).readSetOfStrings()], c.setOfStrings, `${ctx}: readSetOfStrings`);
    assert.deepEqual(pairs(bin(c.mapHexInt).readStringStringMap()), c.stringStringMap, `${ctx}: readStringStringMap`);
    assert.deepEqual([...bin(c.setHexInt).readStringSet()], c.stringSet, `${ctx}: readStringSet`);
  });
});

test("golden: null map and set are written as an empty int count", () => {
  const bos = new ByteArrayOutputStream();
  const out = new OutputStreamDataOutput(bos);
  out.writeStringStringMap(null);
  out.writeStringSet(null);
  assert.equal(toHex(bos.toByteArray()), golden.nulls);
});

test("golden: UTF-8 decoding of malformed input matches Java's new String(bytes, UTF_8) (exhaustive families)", () => {
  for (const f of golden.utf8.exhaustive) {
    const len: number = f.len;
    const alphabet: number[] | null = f.alphabet;
    const base = alphabet === null ? 256 : alphabet.length;
    const h = createHash("sha256");
    const buf = new Uint8Array(len);
    const unit = new Uint8Array(2);
    for (let n = 0; n < f.count; n++) {
      let x = n;
      for (let i = len - 1; i >= 0; i--) {
        const d = x % base;
        x = Math.floor(x / base);
        buf[i] = alphabet === null ? d : alphabet[d];
      }
      const str = decodeUtf8Java(buf, 0, len);
      unit[0] = str.length >> 8;
      unit[1] = str.length & 0xff;
      h.update(unit);
      for (let i = 0; i < str.length; i++) {
        unit[0] = str.charCodeAt(i) >> 8;
        unit[1] = str.charCodeAt(i) & 0xff;
        h.update(unit);
      }
    }
    assert.equal(h.digest("hex"), f.sha256, `all ${f.count} ${len}-byte inputs`);
  }
});

test("golden: UTF-8 decoding of 600 random malformed inputs, also through DataInput.readString", () => {
  for (const [hex, expected] of golden.utf8.random) {
    const b = hexToBytes(hex);
    assert.equal(decodeUtf8Java(b, 0, b.length), expected, `decode ${hex}`);
    const withLength = new Uint8Array(b.length + 1);
    withLength[0] = b.length; // < 128: a one-byte vInt
    withLength.set(b, 1);
    assert.equal(new ByteArrayDataInput(withLength).readString(), expected, `readString ${hex}`);
  }
});

test("decodeUtf8Java: offset/length window and a long string", () => {
  const b = new TextEncoder().encode("xxé€😀yy");
  assert.equal(decodeUtf8Java(b, 2, b.length - 4), "é€😀");
  const long = "abé".repeat(50000);
  const lb = new TextEncoder().encode(long);
  assert.equal(decodeUtf8Java(lb, 0, lb.length), long);
});
