#!/usr/bin/env bash
# Regenerates test/golden/util.json and test/golden/util-refs.json from the ORIGINAL Lucene 5.2.1 Java classes.
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

mkdir -p "$SCRATCH/classes"
javac --release 8 -nowarn -d "$SCRATCH/classes" -sourcepath "$SRC" \
  "$UTIL/BitUtil.java" "$UTIL/MathUtil.java" "$UTIL/UnicodeUtil.java" \
  "$UTIL/StringHelper.java" "$UTIL/BytesRef.java" "$HERE/Golden.java" \
  "$UTIL/ArrayUtil.java" "$UTIL/IntsRef.java" "$UTIL/LongsRef.java" "$UTIL/CharsRef.java" \
  "$UTIL/BytesRefBuilder.java" "$UTIL/CharsRefBuilder.java" "$UTIL/IntsRefBuilder.java" "$HERE/GoldenRefs.java"

# tests.seed makes StringHelper.randomId() and BytesRef.hashCode() reproducible
java -Dtests.seed=DEADBEEF -cp "$SCRATCH/classes" Golden > "$ROOT/test/golden/util.json"
echo "wrote $ROOT/test/golden/util.json"

# RamUsageEstimator (hence ArrayUtil.MAX_ARRAY_LENGTH and the growth sizes) depends on the JVM
# object layout; the TypeScript port models a 64-bit JVM with compressed oops, so pin it.
java -XX:+UseCompressedOops -cp "$SCRATCH/classes" GoldenRefs > "$ROOT/test/golden/util-refs.json"
echo "wrote $ROOT/test/golden/util-refs.json"
