/**
 * Seed-dependent behaviour (BytesRef.hashCode, StringHelper.randomId). The Java golden values
 * were produced with -Dtests.seed=DEADBEEF; the port reads the TESTS_SEED environment variable
 * instead, which must be set BEFORE StringHelper is first loaded, hence the dynamic imports.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hexToBytes, toHex } from "./helpers.js";

const golden = JSON.parse(readFileSync(new URL("./golden/util.json", import.meta.url), "utf8")).seeded;

process.env["TESTS_SEED"] = golden.testsSeed;
const { StringHelper } = await import("../src/util/StringHelper.js");
const { BytesRef } = await import("../src/util/BytesRef.js");

test("golden: GOOD_FAST_HASH_SEED derives from the seed like String.hashCode()", () => {
  assert.equal(golden.testsSeed, "DEADBEEF");
  assert.equal(StringHelper.GOOD_FAST_HASH_SEED, golden.hashSeed);
});

test("golden: BytesRef.hashCode", () => {
  for (const c of golden.hashes) {
    assert.equal(new BytesRef(hexToBytes(c.data)).hashCode(), c.hash, c.data);
  }
});

test("golden: randomId sequence and idToString", () => {
  for (const c of golden.ids) {
    const id = StringHelper.randomId();
    assert.equal(toHex(id), c.id);
    assert.equal(StringHelper.idToString(id), c.str);
  }
});
