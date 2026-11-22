package org.apache.lucene.util;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Random;
import java.util.zip.CRC32;

/**
 * Generates test/golden/util-small.json from the ORIGINAL Lucene 5.2.1 classes SloppyMath, NumericUtils (prefix coding,
 * sortable bits, range splitting), SmallFloat, PriorityQueue, SentinelIntSet, MergedIterator, SetOnce, Counter,
 * RefCount, ToStringUtils, RamUsageEstimator.sizeOf and the JDK's Float.toString / (int) casts.
 *
 * Lives in package org.apache.lucene.util to reach package-private members. Every section is a list of cases
 * {"c": config, "ops": [...], "out": [...]}; the TypeScript test replays the config and the ops and compares the
 * strings. Doubles/floats travel as the hex of their raw bits; results involving them as the hex of the canonical bits.
 */
public class GoldenUtilSmall {
  static final Random r = new Random(5215);
  static final StringBuilder sb = new StringBuilder();
  static boolean firstSection = true;

  static String js(String s) {
    StringBuilder o = new StringBuilder("\"");
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      if (c == '"') o.append("\\\"");
      else if (c == '\\') o.append("\\\\");
      else if (c < 0x20 || c > 0x7e) o.append(String.format("\\u%04x", (int) c));
      else o.append(c);
    }
    return o.append('"').toString();
  }

  static String arr(List<String> l) {
    StringBuilder o = new StringBuilder("[");
    for (int i = 0; i < l.size(); i++) {
      if (i > 0) o.append(',');
      o.append(js(l.get(i)));
    }
    return o.append(']').toString();
  }

  static List<String> cases;

  static void begin(String name) {
    if (!firstSection) sb.append(",\n");
    firstSection = false;
    sb.append(js(name)).append(":");
    cases = new ArrayList<>();
  }

  static void end() {
    sb.append("[\n");
    for (int i = 0; i < cases.size(); i++) {
      if (i > 0) sb.append(",\n");
      sb.append(cases.get(i));
    }
    sb.append("\n]");
  }

  static void cs(String cfg, List<String> ops, List<String> out) {
    cases.add("{\"c\":" + js(cfg) + ",\"ops\":" + arr(ops) + ",\"out\":" + arr(out) + "}");
  }

  static void one(String cfg, String out) {
    cs(cfg, new ArrayList<String>(), java.util.Collections.singletonList(out));
  }

  static String ex(Throwable t) {
    if (t instanceof ArrayIndexOutOfBoundsException || t instanceof NullPointerException) {
      return "EX:" + t.getClass().getSimpleName();
    }
    return "EX:" + t.getClass().getSimpleName() + ":" + t.getMessage();
  }

  static String dh(double d) { return Long.toHexString(Double.doubleToLongBits(d)); }
  static String fh(float f) { return Integer.toHexString(Float.floatToIntBits(f)); }
  static String drawh(double d) { return Long.toHexString(Double.doubleToRawLongBits(d)); }
  static String frawh(float f) { return Integer.toHexString(Float.floatToRawIntBits(f)); }

  static String hex(byte[] b, int off, int len) {
    StringBuilder o = new StringBuilder();
    for (int i = off; i < off + len; i++) o.append(String.format("%02x", b[i] & 0xff));
    return o.toString();
  }

  static String dig(String s) {
    if (s.length() <= 400) return s;
    CRC32 c = new CRC32();
    byte[] b = s.getBytes(java.nio.charset.StandardCharsets.UTF_8);
    c.update(b, 0, b.length);
    return "d" + s.length() + ":" + Long.toHexString(c.getValue());
  }

  static double dbits(String h) { return Double.longBitsToDouble(new java.math.BigInteger(h, 16).longValue()); }

  // ---------------------------------------------------------------- random values
  static float rndFloat() {
    switch (r.nextInt(8)) {
      case 0: return Float.intBitsToFloat(r.nextInt());
      case 1: return (r.nextFloat() - 0.5f) * 20f;
      case 2: return r.nextInt(2000) / 10f;
      case 3: return r.nextInt(100000) / 1000f;
      case 4: return (float) Math.pow(10, r.nextInt(80) - 40) * (1 + r.nextInt(9));
      case 5: return Float.intBitsToFloat(r.nextInt(1 << 23)); // subnormals
      case 6: return r.nextFloat();
      default: return r.nextInt(30000000) - 15000000;
    }
  }

  static double rndDouble() {
    switch (r.nextInt(8)) {
      case 0: return Double.longBitsToDouble(r.nextLong());
      case 1: return (r.nextDouble() - 0.5) * 20;
      case 2: return (r.nextDouble() - 0.5) * 2e5;
      case 3: return (r.nextDouble() - 0.5) * 2;
      case 4: return r.nextGaussian() * 1e12;
      case 5: return (r.nextDouble() - 0.5) * 2e10;
      case 6: return r.nextInt(2000) - 1000;
      default: return r.nextGaussian();
    }
  }

  static long rndLong() {
    switch (r.nextInt(6)) {
      case 0: return r.nextLong();
      case 1: return r.nextInt(1000) - 500;
      case 2: return Long.MIN_VALUE + r.nextInt(100);
      case 3: return Long.MAX_VALUE - r.nextInt(100);
      case 4: return r.nextInt();
      default: return r.nextLong() >> r.nextInt(64);
    }
  }

  static int rndInt() {
    switch (r.nextInt(5)) {
      case 0: return r.nextInt();
      case 1: return r.nextInt(1000) - 500;
      case 2: return Integer.MIN_VALUE + r.nextInt(100);
      case 3: return Integer.MAX_VALUE - r.nextInt(100);
      default: return r.nextInt() >> r.nextInt(32);
    }
  }

  // ---------------------------------------------------------------- sections
  static void floatToString() {
    begin("floatToString");
    List<Float> fs = new ArrayList<>();
    float[] special = {0f, -0f, Float.NaN, Float.POSITIVE_INFINITY, Float.NEGATIVE_INFINITY, Float.MAX_VALUE, Float.MIN_VALUE,
      Float.MIN_NORMAL, 1e-3f, Math.nextDown(1e-3f), Math.nextUp(1e-3f), 1e7f, Math.nextDown(1e7f), Math.nextUp(1e7f), 9999999f,
      1f, 0.1f, 0.2f, 0.3f, 1e10f, 1.0E-5f, 100f, 123456.7f, 3.4028235E38f, 2.0E-45f, 1.17549435E-38f, 16777216f, 33554432f};
    for (float f : special) fs.add(f);
    for (int e = -45; e <= 38; e++) {
      float p = Float.parseFloat("1e" + e);
      fs.add(p); fs.add(Math.nextUp(p)); fs.add(Math.nextDown(p)); fs.add(p * 9.999999f); fs.add(p * 5f);
    }
    for (int i = 1; i < 400; i++) { fs.add((float) i); fs.add(i / 10f); fs.add(i / 1000f); fs.add(i / 7f); fs.add(-i * 1e5f); }
    for (int i = 0; i < 2500; i++) fs.add(rndFloat());
    for (float f : fs) one(frawh(f), Float.toString(f));
    end();
  }

  static void doubleToInt() {
    begin("doubleToInt");
    double[] special = {0, -0.0, Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, 2147483647.0, 2147483648.0,
      -2147483648.0, -2147483649.0, 1e300, -1e300, 0.9999, -0.9999, 1.5, -1.5, 2147483646.5};
    List<Double> ds = new ArrayList<>();
    for (double d : special) ds.add(d);
    for (int i = 0; i < 300; i++) ds.add(rndDouble());
    for (double d : ds) one(drawh(d), Integer.toString((int) d));
    end();
  }

  static void smallFloat() {
    begin("smallFloat");
    List<Float> sf = new ArrayList<>();
    sf.add(0f); sf.add(-0f); sf.add(Float.NaN); sf.add(Float.POSITIVE_INFINITY); sf.add(Float.NEGATIVE_INFINITY);
    sf.add(Float.MIN_VALUE); sf.add(Float.MAX_VALUE); sf.add(1f); sf.add(-1f);
    int[][] combos = {{3, 15}, {5, 2}, {4, 10}, {6, 0}, {1, 7}, {7, -3}};
    for (int[] cb : combos) {
      int fzero = (63 - cb[1]) << cb[0];
      for (int k : new int[] {-1, 0, 1, 2, 0xfe, 0xff, 0x100, 0x101}) sf.add(Float.intBitsToFloat((fzero + k) << (24 - cb[0])));
    }
    for (int i = 0; i < 1500 + sf.size(); i++) {
      float f = i < sf.size() ? sf.get(i) : rndFloat();
      String in = frawh(f);
      cs(in, java.util.Arrays.asList("315", "52", "4,10", "3,15", "5,2", "6,0", "1,7", "7,-3"), java.util.Arrays.asList(
          Integer.toString(SmallFloat.floatToByte315(f) & 0xff), Integer.toString(SmallFloat.floatToByte52(f) & 0xff),
          Integer.toString(SmallFloat.floatToByte(f, 4, 10) & 0xff), Integer.toString(SmallFloat.floatToByte(f, 3, 15) & 0xff),
          Integer.toString(SmallFloat.floatToByte(f, 5, 2) & 0xff), Integer.toString(SmallFloat.floatToByte(f, 6, 0) & 0xff),
          Integer.toString(SmallFloat.floatToByte(f, 1, 7) & 0xff), Integer.toString(SmallFloat.floatToByte(f, 7, -3) & 0xff)));
    }
    List<String> out = new ArrayList<>();
    for (int b = 0; b < 256; b++) {
      byte bb = (byte) b;
      out.add(b + ":" + fh(SmallFloat.byte315ToFloat(bb)) + ":" + fh(SmallFloat.byte52ToFloat(bb)) + ":" + fh(SmallFloat.byteToFloat(bb, 4, 10))
          + ":" + fh(SmallFloat.byteToFloat(bb, 3, 15)) + ":" + fh(SmallFloat.byteToFloat(bb, 5, 2)) + ":" + fh(SmallFloat.byteToFloat(bb, 6, 0)));
    }
    cs("bytes", new ArrayList<String>(), out);
    end();
  }

  static long crcOfDoubles(double[] a) {
    CRC32 c = new CRC32();
    for (double d : a) {
      long l = Double.doubleToRawLongBits(d);
      for (int i = 0; i < 8; i++) c.update((int) (l >>> (8 * i)) & 0xff);
    }
    return c.getValue();
  }

  static void sloppy() throws Exception {
    begin("sloppy");
    one("maxForIntModulo", dh(SloppyMath.SIN_COS_MAX_VALUE_FOR_INT_MODULO));
    for (String name : new String[] {"sinTab", "cosTab", "asinTab", "asinDer1DivF1Tab", "asinDer2DivF2Tab", "asinDer3DivF3Tab",
        "asinDer4DivF4Tab", "earthDiameterPerLatitude"}) {
      Field f = SloppyMath.class.getDeclaredField(name);
      f.setAccessible(true);
      double[] t = (double[]) f.get(null);
      one("table:" + name, t.length + ":" + Long.toHexString(crcOfDoubles(t)));
    }
    double max = SloppyMath.SIN_COS_MAX_VALUE_FOR_INT_MODULO;
    double[] cosIn = {0, -0.0, 1, -1, Math.PI, Math.PI / 2, 2 * Math.PI, 1e-9, max, Math.nextUp(max), Math.nextDown(max), -max, 1e5, 1e10, 1e300,
      Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY};
    List<Double> ds = new ArrayList<>();
    for (double d : cosIn) ds.add(d);
    for (int i = 0; i < 1500; i++) ds.add(rndDouble());
    for (int i = 0; i < 200; i++) ds.add((r.nextDouble() - 0.5) * 2 * max * 1.001);
    for (double d : ds) one("cos:" + drawh(d), dh(SloppyMath.cos(d)));
    double tabMax = StrictMath.sin(Math.toRadians(73.0));
    double[] asinIn = {0, -0.0, 1, -1, 0.5, tabMax, Math.nextUp(tabMax), Math.nextDown(tabMax), 1.0000001, -1.0000001, 0.9999999999, Double.NaN,
      Double.POSITIVE_INFINITY, 1e300};
    ds.clear();
    for (double d : asinIn) ds.add(d);
    for (int i = 0; i < 2000; i++) ds.add((r.nextDouble() - 0.5) * 2.2);
    for (int i = 0; i < 500; i++) ds.add(tabMax + (r.nextDouble() - 0.5) * 0.05);
    for (int i = 0; i < 300; i++) ds.add(r.nextBoolean() ? 1 - r.nextDouble() * 1e-4 : -1 + r.nextDouble() * 1e-4);
    for (double d : ds) one("asin:" + drawh(d), dh(SloppyMath.asin(d)));
    ds.clear();
    for (int i = 0; i < 800; i++) ds.add(rndDouble() * (r.nextBoolean() ? 1 : 0.01));
    ds.add(Double.NaN); ds.add(Double.POSITIVE_INFINITY); ds.add(Double.NEGATIVE_INFINITY); ds.add(Math.PI / 2); ds.add(-Math.PI / 2); ds.add(1e300);
    for (double d : ds) one("diam:" + drawh(d), dh(SloppyMath.earthDiameter(d)));
    for (int i = 0; i < 2500; i++) {
      double a, b, c, d;
      if (r.nextInt(5) == 0) { a = rndDouble(); b = rndDouble(); c = rndDouble(); d = rndDouble(); }
      else { a = (r.nextDouble() - 0.5) * 180; b = (r.nextDouble() - 0.5) * 360; c = (r.nextDouble() - 0.5) * 180; d = (r.nextDouble() - 0.5) * 360; }
      if (r.nextInt(10) == 0) { c = a + (r.nextDouble() - 0.5) * 1e-3; d = b + (r.nextDouble() - 0.5) * 1e-3; }
      one("hav:" + drawh(a) + "," + drawh(b) + "," + drawh(c) + "," + drawh(d), dh(SloppyMath.haversin(a, b, c, d)));
    }
    one("hav:poles", dh(SloppyMath.haversin(90, 0, -90, 0)) + "," + dh(SloppyMath.haversin(0, -180, 0, 180)) + "," + dh(SloppyMath.haversin(0, 0, 0, 0)));
    end();
  }

  // ---- NumericUtils
  static String longCoded(long v, int shift) {
    BytesRefBuilder b = new BytesRefBuilder();
    try {
      NumericUtils.longToPrefixCoded(v, shift, b);
      BytesRef ref = b.get();
      String s = hex(ref.bytes, ref.offset, ref.length) + "|" + ref.offset;
      try { s += "|" + NumericUtils.getPrefixCodedLongShift(ref) + "|" + NumericUtils.prefixCodedToLong(ref); } catch (Throwable t) { s += "|" + ex(t); }
      return s;
    } catch (Throwable t) { return ex(t); }
  }

  static String intCoded(int v, int shift) {
    BytesRefBuilder b = new BytesRefBuilder();
    try {
      NumericUtils.intToPrefixCoded(v, shift, b);
      BytesRef ref = b.get();
      String s = hex(ref.bytes, ref.offset, ref.length) + "|" + ref.offset;
      try { s += "|" + NumericUtils.getPrefixCodedIntShift(ref) + "|" + NumericUtils.prefixCodedToInt(ref); } catch (Throwable t) { s += "|" + ex(t); }
      return s;
    } catch (Throwable t) { return ex(t); }
  }

  static String decodeAll(BytesRef ref) {
    String[] res = new String[4];
    try { res[0] = Integer.toString(NumericUtils.getPrefixCodedLongShift(ref)); } catch (Throwable t) { res[0] = ex(t); }
    try { res[1] = Integer.toString(NumericUtils.getPrefixCodedIntShift(ref)); } catch (Throwable t) { res[1] = ex(t); }
    try { res[2] = Long.toString(NumericUtils.prefixCodedToLong(ref)); } catch (Throwable t) { res[2] = ex(t); }
    try { res[3] = Integer.toString(NumericUtils.prefixCodedToInt(ref)); } catch (Throwable t) { res[3] = ex(t); }
    return String.join("|", res);
  }

  static class LRec extends NumericUtils.LongRangeBuilder {
    final StringBuilder o = new StringBuilder();
    @Override public void addRange(long min, long max, int shift) { o.append(min).append(':').append(max).append(':').append(shift).append(';'); }
  }
  static class LBytes extends NumericUtils.LongRangeBuilder {
    final StringBuilder o = new StringBuilder();
    @Override public void addRange(BytesRef a, BytesRef b) { o.append(hex(a.bytes, a.offset, a.length)).append(':').append(hex(b.bytes, b.offset, b.length)).append(';'); }
  }
  static class IRec extends NumericUtils.IntRangeBuilder {
    final StringBuilder o = new StringBuilder();
    @Override public void addRange(int min, int max, int shift) { o.append(min).append(':').append(max).append(':').append(shift).append(';'); }
  }
  static class IBytes extends NumericUtils.IntRangeBuilder {
    final StringBuilder o = new StringBuilder();
    @Override public void addRange(BytesRef a, BytesRef b) { o.append(hex(a.bytes, a.offset, a.length)).append(':').append(hex(b.bytes, b.offset, b.length)).append(';'); }
  }
  static class LNone extends NumericUtils.LongRangeBuilder {}

  static void numeric() {
    begin("numeric");
    for (int i = 0; i < 1500; i++) {
      long v = rndLong(); int shift = r.nextInt(70) - 3;
      if (r.nextInt(8) != 0) shift = r.nextInt(64);
      one("long:" + v + "," + shift, longCoded(v, shift));
      int iv = rndInt(); int ishift = r.nextInt(40) - 3;
      if (r.nextInt(8) != 0) ishift = r.nextInt(32);
      one("int:" + iv + "," + ishift, intCoded(iv, ishift));
    }
    for (long v : new long[] {0, -1, 1, Long.MIN_VALUE, Long.MAX_VALUE}) for (int s : new int[] {0, 1, 63, 64, -1, Integer.MIN_VALUE, Integer.MAX_VALUE, 32})
      one("long:" + v + "," + s, longCoded(v, s));
    for (int v : new int[] {0, -1, 1, Integer.MIN_VALUE, Integer.MAX_VALUE}) for (int s : new int[] {0, 1, 31, 32, -1, Integer.MIN_VALUE, Integer.MAX_VALUE, 63})
      one("int:" + v + "," + s, intCoded(v, s));
    // decoding arbitrary bytes
    for (int i = 0; i < 2500; i++) {
      int off = r.nextInt(3), len = r.nextInt(12), extra = r.nextInt(3);
      byte[] bytes = new byte[off + len + extra];
      r.nextBytes(bytes);
      for (int k = off + 1; k < off + len; k++) if (r.nextInt(6) != 0) bytes[k] &= 0x7f;
      if (len > 0) {
        switch (r.nextInt(4)) {
          case 0: bytes[off] = (byte) (0x20 + r.nextInt(70) - 3); break;
          case 1: bytes[off] = (byte) (0x60 + r.nextInt(36) - 2); break;
          case 2: bytes[off] = (byte) (0x20 + r.nextInt(64)); break;
          default: break;
        }
      }
      BytesRef ref = new BytesRef(bytes, off, len);
      one("dec:" + hex(bytes, 0, bytes.length) + "," + off + "," + len, decodeAll(ref));
    }
    one("dec:emptyArray", decodeAll(new BytesRef(new byte[0], 0, 0)));
    for (int i = 0; i < 1500; i++) {
      double d = rndDouble();
      if (r.nextInt(30) == 0) d = new double[] {Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, 0.0, -0.0}[r.nextInt(5)];
      long sl = NumericUtils.doubleToSortableLong(d);
      one("d2s:" + drawh(d), sl + "|" + dh(NumericUtils.sortableLongToDouble(sl)) + "|" + NumericUtils.sortableDoubleBits(sl));
      long raw = rndLong();
      one("s2d:" + raw, dh(NumericUtils.sortableLongToDouble(raw)) + "|" + NumericUtils.sortableDoubleBits(raw));
      float f = rndFloat();
      if (r.nextInt(30) == 0) f = new float[] {Float.NaN, Float.POSITIVE_INFINITY, Float.NEGATIVE_INFINITY, 0f, -0f}[r.nextInt(5)];
      int si = NumericUtils.floatToSortableInt(f);
      one("f2s:" + frawh(f), si + "|" + fh(NumericUtils.sortableIntToFloat(si)) + "|" + NumericUtils.sortableFloatBits(si));
      int rawi = rndInt();
      one("s2f:" + rawi, fh(NumericUtils.sortableIntToFloat(rawi)) + "|" + NumericUtils.sortableFloatBits(rawi));
    }
    // range splitting
    for (int i = 0; i < 700; i++) {
      int step = r.nextInt(5) == 0 ? r.nextInt(80) - 3 : 1 + r.nextInt(16);
      if (r.nextInt(30) == 0) step = new int[] {Integer.MAX_VALUE, 64, 65, 1000, 32, 33, 63}[r.nextInt(7)];
      long min = rndLong(), max = rndLong();
      switch (r.nextInt(6)) {
        case 5: max = min; break;
        case 0: if (min > max) { long t = min; min = max; max = t; } break;
        case 1: max = min + r.nextInt(2000); break;
        case 2: max = min + r.nextLong() % 100000L; break;
        default: break;
      }
      String cfg = "L:" + step + "," + min + "," + max;
      List<String> out = new ArrayList<>();
      try { LRec b = new LRec(); NumericUtils.splitLongRange(b, step, min, max); out.add(dig(b.o.toString())); } catch (Throwable t) { out.add(ex(t)); }
      try { LBytes b = new LBytes(); NumericUtils.splitLongRange(b, step, min, max); out.add(dig(b.o.toString())); } catch (Throwable t) { out.add(ex(t)); }
      try { NumericUtils.splitLongRange(new LNone(), step, min, max); out.add("none-ok"); } catch (Throwable t) { out.add(ex(t)); }
      cs(cfg, new ArrayList<String>(), out);
      int imin = rndInt(), imax = rndInt();
      switch (r.nextInt(5)) {
        case 4: imax = imin; break;
        case 0: if (imin > imax) { int t = imin; imin = imax; imax = t; } break;
        case 1: imax = imin + r.nextInt(2000); break;
        default: break;
      }
      String icfg = "I:" + step + "," + imin + "," + imax;
      out = new ArrayList<>();
      try { IRec b = new IRec(); NumericUtils.splitIntRange(b, step, imin, imax); out.add(dig(b.o.toString())); } catch (Throwable t) { out.add(ex(t)); }
      try { IBytes b = new IBytes(); NumericUtils.splitIntRange(b, step, imin, imax); out.add(dig(b.o.toString())); } catch (Throwable t) { out.add(ex(t)); }
      cs(icfg, new ArrayList<String>(), out);
    }
    end();
  }

  // ---- PriorityQueue
  static final class Box { int v; final int id; Box(int v, int id) { this.v = v; this.id = id; } }

  static class PQ extends PriorityQueue<Box> {
    final boolean sentinel;
    int made = 0;
    PQ(int max, boolean pre, boolean sentinel) { super(max, pre); this.sentinel = sentinel; }
    // note: with prepopulate the super constructor calls getSentinelObject before our fields are set
    @Override protected boolean lessThan(Box a, Box b) { return a.v < b.v; }
    @Override protected Box getSentinelObject() { return SENTINEL_MODE ? new Box(Integer.MIN_VALUE, -1) : null; }
  }
  static boolean SENTINEL_MODE;

  static String bx(Box b) { return b == null ? "null" : (b.id < 0 ? "S" : "") + b.v; }

  static void pq() {
    begin("priorityQueue");
    for (int c = 0; c < 400; c++) {
      int max = r.nextInt(12);
      boolean pre = r.nextBoolean();
      SENTINEL_MODE = r.nextBoolean();
      String cfg = max + "," + pre + "," + SENTINEL_MODE;
      List<String> ops = new ArrayList<>(), out = new ArrayList<>();
      PQ q;
      try { q = new PQ(max, pre, SENTINEL_MODE); } catch (Throwable t) { one(cfg, ex(t)); continue; }
      List<Box> made = new ArrayList<>();
      int n = 5 + r.nextInt(60);
      for (int k = 0; k < n; k++) {
        String op = "?";
        String res;
        int val = r.nextInt(20) - 5;
        try {
          switch (r.nextInt(11)) {
            case 0: case 1: { op = "add " + val; Box b = new Box(val, made.size()); made.add(b); res = bx(q.add(b)); break; }
            case 2: case 3: { op = "ins " + val; Box b = new Box(val, made.size()); made.add(b); res = bx(q.insertWithOverflow(b)); break; }
            case 4: op = "pop"; res = bx(q.pop()); break;
            case 5: op = "top"; res = bx(q.top()); break;
            case 6: { op = "upd " + val; Box t = q.top(); if (t != null) t.v = val; res = bx(q.updateTop()); break; }
            case 7: { op = "updn " + val; Box b = new Box(val, made.size()); made.add(b); res = bx(q.updateTop(b)); break; }
            case 8: { int idx = made.isEmpty() ? 0 : r.nextInt(made.size()); op = "rm " + idx; res = Boolean.toString(made.isEmpty() ? q.remove(null) : q.remove(made.get(idx))); break; }
            case 9: op = "size"; res = Integer.toString(q.size()); break;
            default: if (r.nextInt(4) == 0) { op = "clear"; q.clear(); res = "ok"; } else { op = "size"; res = Integer.toString(q.size()); } break;
          }
        } catch (Throwable t) {
          // after an overflow the queue is in an undefined state (size > capacity): stop the script there
          ops.add(op); out.add(ex(t));
          break;
        }
        ops.add(op); out.add(res);
      }
      ops.add("size"); out.add(Integer.toString(q.size()));
      StringBuilder st = new StringBuilder();
      Object[] h = q.getHeapArray();
      for (Object o : h) st.append(o == null ? "_" : bx((Box) o)).append(' ');
      ops.add("heap"); out.add(st.toString());
      cs(cfg, ops, out);
    }
    end();
  }

  // ---- SentinelIntSet
  static void sentinelSet() {
    begin("sentinelIntSet");
    for (int c = 0; c < 250; c++) {
      int size = r.nextInt(5) == 0 ? r.nextInt(300) : r.nextInt(30);
      int empty = new int[] {0, -1, Integer.MIN_VALUE, 7, Integer.MAX_VALUE}[r.nextInt(5)];
      boolean badHash = r.nextInt(3) == 0;
      String cfg = size + "," + empty + "," + badHash;
      List<String> ops = new ArrayList<>(), out = new ArrayList<>();
      SentinelIntSet s;
      final boolean bh = badHash;
      try {
        s = new SentinelIntSet(size, empty) {
          @Override public int hash(int key) { return bh ? (key * 8) | (key >> 3) : key; }
        };
      } catch (Throwable t) { one(cfg, ex(t)); continue; }
      int range = new int[] {10, 40, 200, 100000}[r.nextInt(4)];
      int n = 20 + r.nextInt(300);
      for (int k = 0; k < n; k++) {
        int key = r.nextInt(range) - (r.nextBoolean() ? range / 2 : 0);
        if (r.nextInt(25) == 0) key = empty;
        if (r.nextInt(40) == 0) key = r.nextInt();
        String op = "?", res;
        try {
          switch (r.nextInt(8)) {
            case 0: case 1: case 2: op = "put " + key; res = Integer.toString(s.put(key)); break;
            case 3: op = "exists " + key; res = Boolean.toString(s.exists(key)); break;
            case 4: op = "find " + key; res = Integer.toString(s.find(key)); break;
            case 5: op = "slot " + key; res = Integer.toString(s.getSlot(key)); break;
            case 6: op = "size"; res = s.size() + "/" + s.rehashCount + "/" + s.keys.length + "/" + s.ramBytesUsed(); break;
            default: if (r.nextInt(10) == 0) { op = "clear"; s.clear(); res = "ok"; } else { op = "put " + key; res = Integer.toString(s.put(key)); } break;
          }
        } catch (Throwable t) { res = ex(t); }
        ops.add(op); out.add(res);
      }
      StringBuilder st = new StringBuilder();
      for (int v : s.keys) st.append(v).append(' ');
      ops.add("keys"); out.add(dig(st.toString()));
      cs(cfg, ops, out);
    }
    end();
  }

  // ---- MergedIterator
  static void merged() {
    begin("mergedIterator");
    for (int c = 0; c < 400; c++) {
      int nl = r.nextInt(6);
      List<List<Integer>> lists = new ArrayList<>();
      StringBuilder cfg = new StringBuilder();
      int mode = r.nextInt(3); // 0: default ctor, 1: removeDuplicates=true, 2: false
      cfg.append(mode).append(';');
      @SuppressWarnings("unchecked") Iterator<Integer>[] its = new Iterator[nl];
      for (int i = 0; i < nl; i++) {
        List<Integer> l = new ArrayList<>();
        int len = r.nextInt(9);
        int v = r.nextInt(5);
        for (int k = 0; k < len; k++) { l.add(v); v += r.nextInt(4); }
        lists.add(l);
        its[i] = l.iterator();
        for (int x : l) cfg.append(x).append(',');
        cfg.append('|');
      }
      MergedIterator<Integer> mi;
      if (mode == 0) mi = new MergedIterator<Integer>(its);
      else mi = new MergedIterator<Integer>(mode == 1, its);
      List<String> ops = new ArrayList<>(), out = new ArrayList<>();
      int steps = 5 + r.nextInt(40);
      for (int k = 0; k < steps; k++) {
        String op, res;
        switch (r.nextInt(6)) {
          case 0: op = "h"; res = Boolean.toString(mi.hasNext()); break;
          case 5: op = "r"; try { mi.remove(); res = "ok"; } catch (Throwable t) { res = ex(t); } break;
          default: op = "n"; try { res = Integer.toString(mi.next()); } catch (Throwable t) { res = ex(t); } break;
        }
        ops.add(op); out.add(res);
      }
      cs(cfg.toString(), ops, out);
    }
    end();
  }

  // ---- small classes
  static void small() throws Exception {
    begin("small");
    for (int i = 0; i < 300; i++) {
      float f = i < 6 ? new float[] {1f, 0f, Float.NaN, -1f, 0.99999994f, 1.0000001f}[i] : rndFloat();
      one("boost:" + frawh(f), ToStringUtils.boost(f));
    }
    for (int i = 0; i < 100; i++) {
      byte[] b = new byte[r.nextInt(8)];
      r.nextBytes(b);
      StringBuilder s = new StringBuilder("x");
      ToStringUtils.byteArray(s, b);
      one("bytes:" + hex(b, 0, b.length), s.toString());
    }
    for (int i = 0; i < 100; i++) { long l = rndLong(); one("longHex:" + l, ToStringUtils.longHex(l)); }
    // SetOnce
    {
      List<String> ops = new ArrayList<>(), out = new ArrayList<>();
      SetOnce<String> so = new SetOnce<>();
      ops.add("get"); out.add(String.valueOf(so.get()));
      so.set("a"); ops.add("set a"); out.add("ok");
      ops.add("get"); out.add(String.valueOf(so.get()));
      try { so.set("b"); out.add("ok"); } catch (Throwable t) { out.add(ex(t)); } ops.add("set b");
      try { so.set(null); out.add("ok"); } catch (Throwable t) { out.add(ex(t)); } ops.add("set null");
      cs("setOnce", ops, out);
      ops = new ArrayList<>(); out = new ArrayList<>();
      SetOnce<String> so2 = new SetOnce<>("init");
      ops.add("get"); out.add(String.valueOf(so2.get()));
      try { so2.set("b"); out.add("ok"); } catch (Throwable t) { out.add(ex(t)); } ops.add("set b");
      cs("setOnceInit", ops, out);
      ops = new ArrayList<>(); out = new ArrayList<>();
      SetOnce<String> so3 = new SetOnce<>(null);
      ops.add("get"); out.add(String.valueOf(so3.get()));
      try { so3.set("b"); out.add("ok"); } catch (Throwable t) { out.add(ex(t)); } ops.add("set b");
      cs("setOnceNull", ops, out);
    }
    // Counter
    {
      List<String> ops = new ArrayList<>(), out = new ArrayList<>();
      for (boolean ts : new boolean[] {false, true}) {
        Counter c = Counter.newCounter(ts);
        ops.add("get"); out.add(Long.toString(c.get()));
        for (long d : new long[] {1, 5, -3, 1000000, -7, 0}) { ops.add("add " + d); out.add(Long.toString(c.addAndGet(d))); }
      }
      Counter c0 = Counter.newCounter();
      ops.add("def"); out.add(Long.toString(c0.addAndGet(41)));
      cs("counter", ops, out);
    }
    // RefCount
    {
      final List<String> log = new ArrayList<>();
      List<String> ops = new ArrayList<>(), out = new ArrayList<>();
      RefCount<String> rc = new RefCount<String>("obj") {
        boolean fail = false;
        @Override protected void release() throws java.io.IOException { log.add("release"); if (log.size() == 1) throw new java.io.IOException("boom"); }
      };
      ops.add("count"); out.add(Integer.toString(rc.getRefCount()));
      ops.add("get"); out.add(rc.get());
      try { rc.incRef(); out.add("ok"); } catch (Throwable t) { out.add(ex(t)); } ops.add("inc");
      ops.add("count"); out.add(Integer.toString(rc.getRefCount()));
      for (int i = 0; i < 4; i++) {
        ops.add("dec");
        try { rc.decRef(); out.add("ok"); } catch (Throwable t) { out.add(ex(t)); }
        ops.add("count"); out.add(Integer.toString(rc.getRefCount()) + "/" + log.size());
      }
      try { rc.incRef(); out.add("ok"); } catch (Throwable t) { out.add(ex(t)); } ops.add("inc");
      cs("refCount", ops, out);
    }
    // RamUsageEstimator
    {
      List<String> ops = new ArrayList<>(), out = new ArrayList<>();
      for (int n = 0; n < 70; n++) {
        ops.add("" + n);
        out.add(RamUsageEstimator.sizeOf(new byte[n]) + "," + RamUsageEstimator.sizeOf(new char[n]) + "," + RamUsageEstimator.sizeOf(new short[n]) + ","
            + RamUsageEstimator.sizeOf(new int[n]) + "," + RamUsageEstimator.sizeOf(new float[n]) + "," + RamUsageEstimator.sizeOf(new long[n]) + ","
            + RamUsageEstimator.sizeOf(new double[n]) + "," + RamUsageEstimator.alignObjectSize(n) + "," + RamUsageEstimator.alignObjectSize(n * 1000L + 3));
      }
      cs("ramUsage", ops, out);
    }
    end();
  }

  public static void main(String[] args) throws Exception {
    sb.append("{\n");
    floatToString();
    doubleToInt();
    smallFloat();
    sloppy();
    numeric();
    pq();
    sentinelSet();
    merged();
    small();
    sb.append("\n}\n");
    System.out.print(sb);
  }
}
