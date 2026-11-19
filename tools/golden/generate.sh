#!/usr/bin/env bash
# Regenerates test/golden/util.json, util-refs.json, util-sorters.json, store-data.json, store-io.json, store-dir.json and store-more.json from the ORIGINAL Lucene 5.2.1 Java classes.
#
# Usage: tools/golden/generate.sh [path/to/lucene-5.2.1] [scratch dir]
#
# Needs a JDK (javac + java). Only the few util classes the harness touches are
# compiled (javac pulls their dependencies from the Lucene source tree).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
LUCENE="${1:-$ROOT/../lucene-src/lucene-5.2.1}"
SCRATCH="${2:-$(mktemp -d)}"
SRC="$LUCENE/core/src/java"
UTIL="$SRC/org/apache/lucene/util"
STORE="$SRC/org/apache/lucene/store"

mkdir -p "$SCRATCH/classes"
javac --release 8 -nowarn -d "$SCRATCH/classes" -sourcepath "$SRC" \
  "$UTIL/BitUtil.java" "$UTIL/MathUtil.java" "$UTIL/UnicodeUtil.java" \
  "$UTIL/StringHelper.java" "$UTIL/BytesRef.java" "$HERE/Golden.java" \
  "$UTIL/ArrayUtil.java" "$UTIL/IntsRef.java" "$UTIL/LongsRef.java" "$UTIL/CharsRef.java" \
  "$UTIL/BytesRefBuilder.java" "$UTIL/CharsRefBuilder.java" "$UTIL/IntsRefBuilder.java" "$HERE/GoldenRefs.java" \
  "$UTIL/Sorter.java" "$UTIL/IntroSorter.java" "$UTIL/InPlaceMergeSorter.java" "$UTIL/TimSorter.java" \
  "$UTIL/CollectionUtil.java" "$HERE/org/apache/lucene/util/GoldenSorters.java" \
  "$STORE/DataInput.java" "$STORE/DataOutput.java" "$STORE/ByteArrayDataInput.java" "$STORE/ByteArrayDataOutput.java" \
  "$STORE/InputStreamDataInput.java" "$STORE/OutputStreamDataOutput.java" "$HERE/GoldenStore.java" \
  "$STORE/BufferedIndexInput.java" "$STORE/BufferedChecksumIndexInput.java" "$STORE/BufferedChecksum.java" \
  "$STORE/IOContext.java" "$STORE/FlushInfo.java" "$STORE/MergeInfo.java" "$STORE/IndexOutput.java" "$HERE/GoldenStoreIO.java" \
  "$STORE/RAMDirectory.java" "$STORE/RAMFile.java" "$STORE/RAMInputStream.java" "$STORE/RAMOutputStream.java" \
  "$STORE/Lock.java" "$STORE/NoLockFactory.java" "$STORE/SingleInstanceLockFactory.java" "$STORE/FilterDirectory.java" \
  "$STORE/TrackingDirectoryWrapper.java" "$UTIL/IOUtils.java" "$UTIL/Accountables.java" "$STORE/OutputStreamIndexOutput.java" "$STORE/RateLimiter.java" "$STORE/RateLimitedIndexOutput.java" \
  "$STORE/FileSwitchDirectory.java" "$STORE/NRTCachingDirectory.java" "$HERE/GoldenStoreDir.java" "$HERE/GoldenStoreMore.java"

# tests.seed makes StringHelper.randomId() and BytesRef.hashCode() reproducible
java -Dtests.seed=DEADBEEF -cp "$SCRATCH/classes" Golden > "$ROOT/test/golden/util.json"
echo "wrote $ROOT/test/golden/util.json"

# RamUsageEstimator (hence ArrayUtil.MAX_ARRAY_LENGTH and the growth sizes) depends on the JVM
# object layout; the TypeScript port models a 64-bit JVM with compressed oops, so pin it.
java -XX:+UseCompressedOops -cp "$SCRATCH/classes" GoldenRefs > "$ROOT/test/golden/util-refs.json"
echo "wrote $ROOT/test/golden/util-refs.json"

# GoldenSorters lives in package org.apache.lucene.util to reach package-private members of Sorter.
# Run with Lucene's assertions enabled (-ea, as in Lucene's own test suite): TimSorter.mergeLo/mergeHi
# call compare() inside an assert, and the TypeScript port evaluates its assertions by default
# (LUCENE_ASSERTIONS=0 turns them off), so the recorded call counts include those compare() calls.
java -ea:org.apache.lucene.util... -cp "$SCRATCH/classes" org.apache.lucene.util.GoldenSorters > "$ROOT/test/golden/util-sorters.json"
echo "wrote $ROOT/test/golden/util-sorters.json"

# Data IO classes of the store package (no assertions: ByteArrayDataOutput's assert is covered by a unit test).
java -cp "$SCRATCH/classes" GoldenStore > "$ROOT/test/golden/store-data.json"
echo "wrote $ROOT/test/golden/store-data.json"

java -cp "$SCRATCH/classes" GoldenStoreIO > "$ROOT/test/golden/store-io.json"
echo "wrote $ROOT/test/golden/store-io.json"

# Directory family: RAMDirectory, locks, copyFrom, IOUtils, Accountables. LOCK_POLL_INTERVAL is set to 1 ms in main().
java -cp "$SCRATCH/classes" GoldenStoreDir > "$ROOT/test/golden/store-dir.json"
echo "wrote $ROOT/test/golden/store-dir.json"

# OutputStreamIndexOutput, RateLimiter, RateLimitedIndexOutput, FileSwitchDirectory, NRTCachingDirectory, Double.toString.
java -cp "$SCRATCH/classes" GoldenStoreMore > "$ROOT/test/golden/store-more.json"
echo "wrote $ROOT/test/golden/store-more.json"
