/**
 * Differential test for util.Version (constants, parse, parseLeniently, fromBits, onOrAfter, equals, hashCode) and
 * Integer.parseInt. Expected values come from test/golden/version.json, produced by the ORIGINAL Lucene 5.2.1 class
 * (tools/golden/org/apache/lucene/util/GoldenVersion.java).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ParseException } from "../src/errors.js";
import { Version } from "../src/util/Version.js";
import { Integer } from "../src/util/JavaNumbers.js";

const golden: { ops: string[]; out: string[] } = JSON.parse(readFileSync(new URL("./golden/version.json", import.meta.url), "utf8"));

const desc = (v: Version): string => `${v}|${v.major},${v.minor},${v.bugfix},${v.prerelease}|${v.hashCode()}`;

function ex(e: unknown): string {
  const t = e as Error & { cause?: Error };
  let s = "EX:" + t.constructor.name + ":" + t.message;
  if (t.cause) s += " <- " + t.cause.constructor.name + ":" + t.cause.message;
  if (e instanceof ParseException) s += " @" + e.getErrorOffset();
  return s;
}

test("Version vs Java", () => {
  const all: Version[] = [];
  const names = golden.ops.filter((o) => o.startsWith("C:")).map((o) => o.substring(2));
  for (let i = 0; i < golden.ops.length; i++) {
    const op = golden.ops[i]!;
    const arg = op.substring(2);
    let got: string;
    try {
      switch (op[0]) {
        case "C": {
          const v = (Version as unknown as Record<string, Version>)[arg]!;
          assert.ok(v instanceof Version, arg);
          all.push(v);
          got = desc(v);
          break;
        }
        case "P":
          got = desc(Version.parse(arg));
          break;
        case "L":
          got = desc(Version.parseLeniently(arg));
          break;
        case "B": {
          const [a, b, c] = arg.split(",").map(Number);
          got = desc(Version.fromBits(a!, b!, c!));
          break;
        }
        case "O": {
          if (all.length === names.length) {
            all.push(Version.parse("5.3.0"), Version.parse("3.6.2"), Version.parse("4.0.0.2"), Version.fromBits(4, 0, 0));
          }
          const idx = parseInt(arg.substring(arg.lastIndexOf("#") + 1));
          let s = "";
          for (const o of all) s += (all[idx]!.onOrAfter(o) ? "1" : "0") + (all[idx]!.equals(o) ? "1" : "0");
          got = s;
          break;
        }
        default:
          throw new Error("unknown op " + op);
      }
    } catch (e) {
      got = ex(e);
    }
    assert.equal(got, golden.out[i], op);
  }
});

test("Integer.parseInt follows Java", () => {
  assert.equal(Integer.parseInt("2147483647"), 2147483647);
  assert.equal(Integer.parseInt("-2147483648"), -2147483648);
  assert.equal(Integer.parseInt("+0"), 0);
  assert.equal(Integer.parseInt("ff", 16), 255);
  for (const s of ["", "+", "-", "2147483648", "-2147483649", "1_0", "1.0", " 1", "0x10", "99999999999"]) {
    assert.throws(() => Integer.parseInt(s), { name: "NumberFormatException", message: `For input string: "${s}"` });
  }
  assert.throws(() => Integer.parseInt("zz", 16), { message: 'For input string: "zz" under radix 16' });
});
