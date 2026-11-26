/**
 * Differential tests for index.IndexFileNames, FieldInfo, FieldInfos (+ Long.parseLong, javaSplitChar used by them).
 * Expected values come from test/golden/indexmeta.json produced by the ORIGINAL Lucene 5.2.1 classes with assertions on
 * (tools/golden/org/apache/lucene/index/GoldenIndexMeta.java).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ArrayIndexOutOfBoundsException, getMessage } from "../src/errors.js";
import { DocValuesType } from "../src/index/DocValuesType.js";
import { FieldInfo } from "../src/index/FieldInfo.js";
import { FieldInfos } from "../src/index/FieldInfos.js";
import { IndexFileNames } from "../src/index/IndexFileNames.js";
import { IndexOptions } from "../src/index/IndexOptions.js";
import { javaSplitChar } from "../src/util/JavaStrings.js";

interface Section {
  ops: string[];
  out: string[];
}
const golden: Record<string, Section> = JSON.parse(readFileSync(new URL("./golden/indexmeta.json", import.meta.url), "utf8"));

function ex(e: unknown): string {
  if (e instanceof ArrayIndexOutOfBoundsException) return "EX:ArrayIndexOutOfBoundsException";
  return "EX:" + (e as Error).constructor.name + ":" + getMessage(e as Error);
}

function guard(f: () => string): string {
  try {
    return f();
  } catch (e) {
    return ex(e);
  }
}

test("IndexFileNames vs Java", () => {
  const g = golden.names!;
  for (let i = 0; i < g.ops.length; i++) {
    const op = g.ops[i]!;
    const kind = op === "CONST" ? op : op.substring(0, op.indexOf(":"));
    const arg = op.substring(op.indexOf(":") + 1);
    const got = guard(() => {
      switch (kind) {
        case "STRIP":
          return IndexFileNames.stripSegmentName(arg);
        case "PSEG":
          return IndexFileNames.parseSegmentName(arg);
        case "SEXT":
          return IndexFileNames.stripExtension(arg);
        case "GEXT":
          return "" + IndexFileNames.getExtension(arg);
        case "PAT":
          return "" + IndexFileNames.CODEC_FILE_PATTERN.test(arg);
        case "PGEN":
          return "" + IndexFileNames.parseGeneration(arg);
        case "MEXT": {
          const [f, e] = arg.split("\t");
          return "" + IndexFileNames.matchesExtension(f!, e!);
        }
        case "FNG": {
          const [b, e, gen] = arg.split("\t");
          return "" + IndexFileNames.fileNameFromGeneration(b!, e!, BigInt(gen!));
        }
        case "SFN": {
          const [b, s, e] = arg.split("\t");
          return IndexFileNames.segmentFileName(b!, s!, e!);
        }
        case "CONST":
          return IndexFileNames.SEGMENTS + "|" + IndexFileNames.PENDING_SEGMENTS + "|" + IndexFileNames.OLD_SEGMENTS_GEN;
      }
      throw new Error("unknown op " + op);
    });
    assert.equal(got, g.out[i], op);
  }
});

test("javaSplitChar behaves like String.split", () => {
  assert.deepEqual(javaSplitChar("", "_"), [""]);
  assert.deepEqual(javaSplitChar("a_b__", "_"), ["a", "b"]);
  assert.deepEqual(javaSplitChar("__", "_"), []);
  assert.deepEqual(javaSplitChar("_a", "_"), ["", "a"]);
  assert.deepEqual(javaSplitChar("abc", "_"), ["abc"]);
});

const IO_NAMES = ["NONE", "DOCS", "DOCS_AND_FREQS", "DOCS_AND_FREQS_AND_POSITIONS", "DOCS_AND_FREQS_AND_POSITIONS_AND_OFFSETS"];
const DV_NAMES = ["NONE", "NUMERIC", "BINARY", "SORTED", "SORTED_NUMERIC", "SORTED_SET"];
void IO_NAMES;
void DV_NAMES;

function make(p: string[]): FieldInfo {
  return new FieldInfo(
    p[0] === "<null>" ? (null as never) : p[0]!,
    parseInt(p[1]!),
    p[2] === "1",
    p[3] === "1",
    p[4] === "1",
    p[5] === "<null>" ? (null as never) : (parseInt(p[5]!) as IndexOptions),
    p[6] === "<null>" ? (null as never) : (parseInt(p[6]!) as DocValuesType),
    parseInt(p[7]!),
    new Map<string, string>(),
  );
}

function state(f: FieldInfo): string {
  const attrs = [...f.attributes().entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return (
    `${f.name}#${f.number} tv=${f.hasVectors()} on=${f.omitsNorms()} hn=${f.hasNorms()} sp=${f.hasPayloads()} io=${IndexOptions[f.getIndexOptions()]} ` +
    `dv=${DocValuesType[f.getDocValuesType()]} gen=${f.getDocValuesGen()} attrs={${attrs.map(([k, v]) => k + "=" + v).join(", ")}}`
  );
}

test("FieldInfo vs Java", () => {
  const g = golden.fieldinfo!;
  for (let i = 0; i < g.ops.length; i++) {
    const op = g.ops[i]!;
    const parts = op.substring(3).split("|");
    const p = parts.slice(0, 8);
    const muts = (parts[8] ?? "").split(";").filter((m) => m !== "");
    const got = guard(() => {
      const f = make(p);
      let s = state(f);
      for (const m of muts) {
        s += " ## " + m + ": ";
        const a = m.split(",");
        try {
          switch (a[0]) {
            case "update":
              f.update(a[1] === "1", a[2] === "1", a[3] === "1", a[4] === "<null>" ? (null as never) : (parseInt(a[4]!) as IndexOptions));
              break;
            case "setDV":
              f.setDocValuesType(a[1] === "<null>" ? (null as never) : (parseInt(a[1]!) as DocValuesType));
              break;
            case "setIO":
              f.setIndexOptions(parseInt(a[1]!) as IndexOptions);
              break;
            case "setP":
              f.setStorePayloads();
              break;
            case "setTV":
              f.setStoreTermVectors();
              break;
            case "setOmit":
              f.setOmitsNorms();
              break;
            case "put":
              s += "prev=" + f.putAttribute(a[1]!, a[2]!) + " " + f.getAttribute(a[1]!) + " " + f.getAttribute("zz") + " ";
              break;
            default:
              f.setDocValuesGen(parseInt(a[1]!));
              break;
          }
          s += state(f);
        } catch (e) {
          s += ex(e);
        }
      }
      return s;
    });
    assert.equal(got, g.out[i], op);
  }
});

test("FieldInfos vs Java", () => {
  const g = golden.fieldinfos!;
  for (let i = 0; i < g.ops.length; i++) {
    const op = g.ops[i]!;
    const body = op.substring(4);
    const ps = body === "" ? [] : body.split("/").map((x) => x.split("|"));
    const got = guard(() => {
      const infos = ps.map(make);
      const fis = new FieldInfos(infos);
      let s = `freq=${fis.hasFreq()} prox=${fis.hasProx()} pay=${fis.hasPayloads()} off=${fis.hasOffsets()} vec=${fis.hasVectors()} norms=${fis.hasNorms()} dv=${fis.hasDocValues()} size=${fis.size()} it=`;
      for (const f of fis) s += f.name + "#" + f.number + ";";
      s += " byName=";
      for (const nm of ["f0", "f1", "f2", "f3", "nope"]) s += (fis.fieldInfo(nm) === null ? "null" : fis.fieldInfo(nm)!.number) + ",";
      s += " byNum=";
      for (const num of [0, 1, 2, 3, 4, 6, 8, 10, 99]) s += (fis.fieldInfo(num) === null ? "null" : fis.fieldInfo(num)!.name) + ",";
      try {
        fis.fieldInfo(-1);
      } catch (e) {
        s += " " + ex(e);
      }
      return s;
    });
    assert.equal(got, g.out[i], op);
  }
});
