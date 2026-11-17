import java.util.Random;
import org.apache.lucene.util.ArrayUtil;
import org.apache.lucene.util.BytesRef;
import org.apache.lucene.util.BytesRefBuilder;
import org.apache.lucene.util.CharsRef;
import org.apache.lucene.util.CharsRefBuilder;
import org.apache.lucene.util.IntsRef;
import org.apache.lucene.util.IntsRefBuilder;
import org.apache.lucene.util.LongsRef;
import org.apache.lucene.util.StringHelper;

/**
 * Generates test/golden/util-refs.json: inputs AND outputs computed by the original
 * Lucene 5.2.1 classes ArrayUtil, IntsRef, LongsRef, CharsRef, BytesRefBuilder,
 * CharsRefBuilder, IntsRefBuilder and StringHelper.intsRefToBytesRef, plus
 * java.lang.Character.digit, so that the TypeScript port can be checked against them.
 *
 * Run through tools/golden/generate.sh. The JVM is started with -XX:+UseCompressedOops
 * because RamUsageEstimator (and so ArrayUtil.MAX_ARRAY_LENGTH) depends on it.
 *
 * Conventions in the JSON: Java chars and ints are JSON numbers, longs are decimal strings,
 * byte[] are lower-case hex strings, "EX:Class:message" stands for a thrown exception.
 */
public class GoldenRefs {
  static final StringBuilder sb = new StringBuilder();
  static final Random r = new Random(20261117);

  // ---- tiny JSON helpers ----------------------------------------------------
  static String q(String s) {
    return "\"" + s + "\"";
  }

  static String hex(byte[] b, int off, int len) {
    StringBuilder h = new StringBuilder();
    for (int i = off; i < off + len; i++) {
      h.append(String.format("%02x", b[i] & 0xff));
    }
    return h.toString();
  }

  static String hex(byte[] b) {
    return hex(b, 0, b.length);
  }

  static String ints(int[] a, int off, int n) {
    StringBuilder s = new StringBuilder("[");
    for (int i = 0; i < n; i++) {
      if (i > 0) s.append(',');
      s.append(a[off + i]);
    }
    return s.append(']').toString();
  }

  static String ints(int[] a) {
    return ints(a, 0, a.length);
  }

  static String chars(char[] a, int off, int n) {
    StringBuilder s = new StringBuilder("[");
    for (int i = 0; i < n; i++) {
      if (i > 0) s.append(',');
      s.append((int) a[off + i]);
    }
    return s.append(']').toString();
  }

  static String chars(char[] a) {
    return chars(a, 0, a.length);
  }

  static String chars(String s) {
    return chars(s.toCharArray());
  }

  static String longs(long[] a, int off, int n) {
    StringBuilder s = new StringBuilder("[");
    for (int i = 0; i < n; i++) {
      if (i > 0) s.append(',');
      s.append(q(Long.toString(a[off + i])));
    }
    return s.append(']').toString();
  }

  static String longs(long[] a) {
    return longs(a, 0, a.length);
  }

  static String ex(Throwable t) {
    String m = t.getMessage();
    return q("EX:" + t.getClass().getSimpleName() + ":" + (m == null ? "" : m.replace("\\", "\\\\").replace("\"", "\\\"")));
  }

  static void section(String name, boolean first) {
    if (!first) sb.append(",\n");
    sb.append(q(name)).append(": ");
  }

  // ---- random data ----------------------------------------------------------
  static final int[] INT_ALPHA = {0, 1, -1, 2, 7, 255, 256, -128, 127, Integer.MAX_VALUE, Integer.MIN_VALUE, 65535, 0x10ffff};
  static final long[] LONG_ALPHA = {0L, 1L, -1L, 2L, 0xffffffffL, 0x100000000L, Long.MAX_VALUE, Long.MIN_VALUE, -0x7fffffffL, 0x8000000000000000L >>> 3};
  // chosen to hit every branch of the UTF16-sorted-as-UTF8 fix-up
  static final char[] CHAR_ALPHA = {0x41, 0x42, 0x7f, 0x800, 0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000, 0xf000, 0xffff};

  static int[] randInts(int n) {
    int[] a = new int[n];
    for (int i = 0; i < n; i++) a[i] = r.nextInt(3) == 0 ? r.nextInt() : INT_ALPHA[r.nextInt(INT_ALPHA.length)];
    return a;
  }

  static long[] randLongs(int n) {
    long[] a = new long[n];
    for (int i = 0; i < n; i++) a[i] = r.nextInt(3) == 0 ? r.nextLong() : LONG_ALPHA[r.nextInt(LONG_ALPHA.length)];
    return a;
  }

  static char[] randChars(int n) {
    char[] a = new char[n];
    for (int i = 0; i < n; i++) a[i] = r.nextInt(4) == 0 ? (char) r.nextInt(65536) : CHAR_ALPHA[r.nextInt(CHAR_ALPHA.length)];
    return a;
  }

  static byte[] randBytes(int n) {
    byte[] a = new byte[n];
    r.nextBytes(a);
    return a;
  }

  /** A valid (no lone surrogates) random string, so that it has a UTF-8 form. */
  static String randValidString(int maxCodePoints) {
    StringBuilder s = new StringBuilder();
    int n = r.nextInt(maxCodePoints + 1);
    for (int i = 0; i < n; i++) {
      int cp;
      switch (r.nextInt(4)) {
        case 0: cp = r.nextInt(0x80); break;
        case 1: cp = 0x80 + r.nextInt(0x780); break;
        case 2: cp = 0x800 + r.nextInt(0xd800 - 0x800); break;
        default: cp = 0x10000 + r.nextInt(0x100000); break;
      }
      s.appendCodePoint(cp);
    }
    return s.toString();
  }

  public static void main(String[] args) {
    sb.append("{\n");

    // ---- ArrayUtil.oversize / getShrinkSize ----------------------------------
    section("oversize", true);
    sb.append("[");
    int[] bpes = {1, 2, 4, 8, 3, 16};
    long[] bigTargets = {
      0, 1, 2, 3, 4, 5, 8, 9, 15, 16, 17, 100, 1000, 1 << 20, 1 << 28, 1 << 29, (1 << 29) + 1, 1 << 30, (1 << 30) + 1,
      1879048192, 1900000000, 2000000000, 2100000000, 2147483000, Integer.MAX_VALUE - 17, Integer.MAX_VALUE - 16,
      Integer.MAX_VALUE - 15, Integer.MAX_VALUE - 1, Integer.MAX_VALUE, -1, -5, Integer.MIN_VALUE
    };
    boolean firstCase = true;
    for (int bpe : bpes) {
      for (int t = 0; t < 140 + bigTargets.length; t++) {
        int min = t < bigTargets.length ? (int) bigTargets[t] : (t < bigTargets.length + 60 ? t - bigTargets.length : r.nextInt(Integer.MAX_VALUE) >> r.nextInt(31));
        String res;
        try {
          res = Integer.toString(ArrayUtil.oversize(min, bpe));
        } catch (RuntimeException e) {
          res = ex(e);
        }
        if (!firstCase) sb.append(",");
        firstCase = false;
        sb.append("[").append(min).append(",").append(bpe).append(",").append(res.startsWith("\"") ? res : res).append("]");
      }
    }
    sb.append("]");

    section("shrinkSize", false);
    sb.append("[");
    for (int i = 0; i < 400; i++) {
      int cur = i < 60 ? i : r.nextInt(1 << 20);
      int target = r.nextInt(3) == 0 ? r.nextInt(Math.max(1, cur + 1)) : r.nextInt(Math.max(1, cur / 3 + 1));
      int bpe = bpes[r.nextInt(5)];
      if (i > 0) sb.append(",");
      sb.append("[").append(cur).append(",").append(target).append(",").append(bpe).append(",")
          .append(ArrayUtil.getShrinkSize(cur, target, bpe)).append("]");
    }
    sb.append("]");

    sb.append(",\n").append(q("maxArrayLength")).append(": ").append(ArrayUtil.MAX_ARRAY_LENGTH);

    // ---- grow / shrink: resulting lengths for every array type ----------------
    section("growShrink", false);
    sb.append("[");
    String[] kinds = {"byte", "char", "short", "int", "long", "float", "double", "boolean", "intRefs", "floatRefs"};
    boolean fg = true;
    for (String kind : kinds) {
      for (int i = 0; i < 90; i++) {
        int len = i < 40 ? i : r.nextInt(5000);
        int min = r.nextInt(3) == 0 ? len + 1 : r.nextInt(len + 200);
        int target = r.nextInt(Math.max(1, len + 1));
        int growLen, growOneLen, shrinkLen;
        switch (kind) {
          case "byte": growLen = ArrayUtil.grow(new byte[len], min).length; growOneLen = ArrayUtil.grow(new byte[len]).length; shrinkLen = ArrayUtil.shrink(new byte[len], target).length; break;
          case "char": growLen = ArrayUtil.grow(new char[len], min).length; growOneLen = ArrayUtil.grow(new char[len]).length; shrinkLen = ArrayUtil.shrink(new char[len], target).length; break;
          case "short": growLen = ArrayUtil.grow(new short[len], min).length; growOneLen = ArrayUtil.grow(new short[len]).length; shrinkLen = ArrayUtil.shrink(new short[len], target).length; break;
          case "int": growLen = ArrayUtil.grow(new int[len], min).length; growOneLen = ArrayUtil.grow(new int[len]).length; shrinkLen = ArrayUtil.shrink(new int[len], target).length; break;
          case "long": growLen = ArrayUtil.grow(new long[len], min).length; growOneLen = ArrayUtil.grow(new long[len]).length; shrinkLen = ArrayUtil.shrink(new long[len], target).length; break;
          case "float": growLen = ArrayUtil.grow(new float[len], min).length; growOneLen = ArrayUtil.grow(new float[len]).length; shrinkLen = -1; /* Lucene 5.2.1 has no shrink(float[]) */ break;
          case "double": growLen = ArrayUtil.grow(new double[len], min).length; growOneLen = ArrayUtil.grow(new double[len]).length; shrinkLen = -1; /* Lucene 5.2.1 has no shrink(double[]) */ break;
          case "boolean": growLen = ArrayUtil.grow(new boolean[len], min).length; growOneLen = ArrayUtil.grow(new boolean[len]).length; shrinkLen = ArrayUtil.shrink(new boolean[len], target).length; break;
          case "intRefs": growLen = ArrayUtil.grow(new int[len][], min).length; growOneLen = ArrayUtil.grow(new int[len][]).length; shrinkLen = ArrayUtil.shrink(new int[len][], target).length; break;
          default: growLen = ArrayUtil.grow(new float[len][], min).length; growOneLen = ArrayUtil.grow(new float[len][]).length; shrinkLen = ArrayUtil.shrink(new float[len][], target).length; break;
        }
        if (!fg) sb.append(",");
        fg = false;
        sb.append("{\"kind\":").append(q(kind)).append(",\"len\":").append(len).append(",\"min\":").append(min)
            .append(",\"target\":").append(target).append(",\"grow\":").append(growLen)
            .append(",\"growOne\":").append(growOneLen).append(",\"shrink\":").append(shrinkLen).append("}");
      }
    }
    sb.append("]");

    // ---- ArrayUtil.hashCode / equals ----------------------------------------
    section("arrayHash", false);
    sb.append("[");
    for (int i = 0; i < 300; i++) {
      boolean isBytes = r.nextBoolean();
      int n = r.nextInt(30);
      int start = r.nextInt(n + 1);
      int end = start + r.nextInt(n - start + 1);
      if (i > 0) sb.append(",");
      if (isBytes) {
        byte[] a = randBytes(n);
        sb.append("{\"kind\":\"byte\",\"data\":").append(q(hex(a))).append(",\"start\":").append(start).append(",\"end\":").append(end)
            .append(",\"hash\":").append(ArrayUtil.hashCode(a, start, end)).append("}");
      } else {
        char[] a = randChars(n);
        sb.append("{\"kind\":\"char\",\"data\":").append(chars(a)).append(",\"start\":").append(start).append(",\"end\":").append(end)
            .append(",\"hash\":").append(ArrayUtil.hashCode(a, start, end)).append("}");
      }
    }
    sb.append("]");

    section("arrayEquals", false);
    sb.append("[");
    for (int i = 0; i < 450; i++) {
      int kind = i % 3;
      int n = r.nextInt(12);
      int m = n + r.nextInt(4) - 1;
      if (m < 0) m = 0;
      int offL = r.nextInt(4), offR = r.nextInt(4), len = r.nextInt(10);
      if (i > 0) sb.append(",");
      if (kind == 0) {
        byte[] a = new byte[n];
        for (int j = 0; j < n; j++) a[j] = (byte) r.nextInt(3);
        byte[] b = new byte[m];
        for (int j = 0; j < m; j++) b[j] = (byte) r.nextInt(3);
        sb.append("{\"kind\":\"byte\",\"a\":").append(q(hex(a))).append(",\"b\":").append(q(hex(b)))
            .append(",\"offL\":").append(offL).append(",\"offR\":").append(offR).append(",\"len\":").append(len)
            .append(",\"eq\":").append(ArrayUtil.equals(a, offL, b, offR, len)).append("}");
      } else if (kind == 1) {
        char[] a = new char[n];
        for (int j = 0; j < n; j++) a[j] = (char) (0xd7fe + r.nextInt(3));
        char[] b = new char[m];
        for (int j = 0; j < m; j++) b[j] = (char) (0xd7fe + r.nextInt(3));
        sb.append("{\"kind\":\"char\",\"a\":").append(chars(a)).append(",\"b\":").append(chars(b))
            .append(",\"offL\":").append(offL).append(",\"offR\":").append(offR).append(",\"len\":").append(len)
            .append(",\"eq\":").append(ArrayUtil.equals(a, offL, b, offR, len)).append("}");
      } else {
        int[] a = new int[n];
        for (int j = 0; j < n; j++) a[j] = r.nextInt(3) - 1;
        int[] b = new int[m];
        for (int j = 0; j < m; j++) b[j] = r.nextInt(3) - 1;
        sb.append("{\"kind\":\"int\",\"a\":").append(ints(a)).append(",\"b\":").append(ints(b))
            .append(",\"offL\":").append(offL).append(",\"offR\":").append(offR).append(",\"len\":").append(len)
            .append(",\"eq\":").append(ArrayUtil.equals(a, offL, b, offR, len)).append("}");
      }
    }
    sb.append("]");

    // ---- Character.digit over the whole BMP + ArrayUtil.parseInt -------------
    section("digit", false);
    sb.append("{");
    int[] radixes = {2, 8, 10, 16, 36};
    for (int ri = 0; ri < radixes.length; ri++) {
      if (ri > 0) sb.append(",");
      sb.append(q("" + radixes[ri])).append(":[");
      boolean fd = true;
      for (int ch = 0; ch < 65536; ch++) {
        int d = Character.digit((char) ch, radixes[ri]);
        if (d != -1) {
          if (!fd) sb.append(",");
          fd = false;
          sb.append("[").append(ch).append(",").append(d).append("]");
        }
      }
      sb.append("]");
    }
    sb.append("}");

    section("parseInt", false);
    sb.append("[");
    String[] fixedInts = {
      "0", "1", "-1", "42", "-42", "2147483647", "-2147483648", "2147483648", "-2147483649", "99999999999", "-", "", "+5",
      "12a", "a12", "1 2", "00012", "-0", "ff", "FF", "zz", "-zz", "7fffffff", "80000000", "-80000000", "-80000001",
      "٣٤", "-٣٤", "１２", "ＡＢ", "०१२", "①", "²", "๑๒"
    };
    int[] parseRadixes = {10, 16, 36, 2, 8, 1, 37, 10};
    boolean fp = true;
    for (int i = 0; i < 520; i++) {
      char[] chars;
      if (i < fixedInts.length * parseRadixes.length) {
        chars = fixedInts[i % fixedInts.length].toCharArray();
      } else {
        // random numbers, sometimes with a stray character
        StringBuilder s = new StringBuilder();
        if (r.nextInt(3) == 0) s.append('-');
        int digits = 1 + r.nextInt(11);
        for (int j = 0; j < digits; j++) s.append((char) ('0' + r.nextInt(10)));
        if (r.nextInt(8) == 0) s.setCharAt(r.nextInt(s.length()), (char) ('a' + r.nextInt(26)));
        chars = s.toString().toCharArray();
      }
      int radix = i < fixedInts.length * parseRadixes.length ? parseRadixes[i / fixedInts.length] : (r.nextInt(4) == 0 ? 16 : 10);
      int pad = r.nextInt(3);
      char[] padded = new char[pad + chars.length + r.nextInt(3)];
      for (int j = 0; j < padded.length; j++) padded[j] = 'x';
      System.arraycopy(chars, 0, padded, pad, chars.length);
      int offset = pad, len = chars.length;
      if (i % 29 == 7) { offset = padded.length + 1; } // out of bounds
      if (i % 31 == 5) { len = len + 3; }               // runs past the end
      String res;
      try {
        res = Integer.toString(ArrayUtil.parseInt(padded, offset, len, radix));
      } catch (RuntimeException e) {
        res = ex(e);
      }
      if (!fp) sb.append(",");
      fp = false;
      sb.append("{\"chars\":").append(chars(padded)).append(",\"offset\":").append(offset).append(",\"len\":").append(len)
          .append(",\"radix\":").append(radix).append(",\"result\":").append(res.startsWith("\"") ? res : res).append("}");
    }
    sb.append("]");

    section("parseIntWhole", false);
    sb.append("[");
    for (int i = 0; i < fixedInts.length; i++) {
      char[] c = fixedInts[i].toCharArray();
      String res;
      try {
        res = Integer.toString(ArrayUtil.parseInt(c));
      } catch (RuntimeException e) {
        res = ex(e);
      }
      if (i > 0) sb.append(",");
      sb.append("{\"chars\":").append(chars(c)).append(",\"result\":").append(res).append("}");
    }
    sb.append("]");

    // ---- IntsRef ---------------------------------------------------------------
    section("intsRef", false);
    sb.append("[");
    for (int i = 0; i < 300; i++) {
      int n = r.nextInt(8);
      int[] a = randInts(n + 4);
      int off = r.nextInt(3), len = Math.min(n, a.length - off);
      int[] b;
      int offB, lenB;
      if (r.nextInt(3) == 0) { // share a prefix
        b = a.clone();
        offB = off;
        lenB = Math.max(0, len - r.nextInt(2));
        if (lenB > 0 && r.nextBoolean()) b[offB + lenB - 1]++;
      } else {
        b = randInts(r.nextInt(8) + 4);
        offB = r.nextInt(3);
        lenB = r.nextInt(Math.min(6, b.length - offB) + 1);
      }
      IntsRef x = new IntsRef(a, off, len);
      IntsRef y = new IntsRef(b, offB, lenB);
      if (i > 0) sb.append(",");
      sb.append("{\"a\":").append(ints(a)).append(",\"offA\":").append(off).append(",\"lenA\":").append(len)
          .append(",\"b\":").append(ints(b)).append(",\"offB\":").append(offB).append(",\"lenB\":").append(lenB)
          .append(",\"hashA\":").append(x.hashCode()).append(",\"strA\":").append(q(x.toString()))
          .append(",\"cmp\":").append(x.compareTo(y)).append(",\"eq\":").append(x.equals(y)).append(",\"deepA\":")
          .append(ints(IntsRef.deepCopyOf(x).ints)).append("}");
    }
    sb.append("]");

    // ---- LongsRef --------------------------------------------------------------
    section("longsRef", false);
    sb.append("[");
    for (int i = 0; i < 300; i++) {
      int n = r.nextInt(8);
      long[] a = randLongs(n + 4);
      int off = r.nextInt(3), len = Math.min(n, a.length - off);
      long[] b;
      int offB, lenB;
      if (r.nextInt(3) == 0) {
        b = a.clone();
        offB = off;
        lenB = Math.max(0, len - r.nextInt(2));
        if (lenB > 0 && r.nextBoolean()) b[offB + lenB - 1]++;
      } else {
        b = randLongs(r.nextInt(8) + 4);
        offB = r.nextInt(3);
        lenB = r.nextInt(Math.min(6, b.length - offB) + 1);
      }
      LongsRef x = new LongsRef(a, off, len);
      LongsRef y = new LongsRef(b, offB, lenB);
      if (i > 0) sb.append(",");
      sb.append("{\"a\":").append(longs(a)).append(",\"offA\":").append(off).append(",\"lenA\":").append(len)
          .append(",\"b\":").append(longs(b)).append(",\"offB\":").append(offB).append(",\"lenB\":").append(lenB)
          .append(",\"hashA\":").append(x.hashCode()).append(",\"strA\":").append(q(x.toString()))
          .append(",\"cmp\":").append(x.compareTo(y)).append(",\"eq\":").append(x.equals(y)).append(",\"deepA\":")
          .append(longs(LongsRef.deepCopyOf(x).longs)).append("}");
    }
    sb.append("]");

    // ---- CharsRef --------------------------------------------------------------
    section("charsRef", false);
    sb.append("[");
    for (int i = 0; i < 400; i++) {
      int n = r.nextInt(8);
      char[] a = randChars(n + 4);
      int off = r.nextInt(3), len = Math.min(n, a.length - off);
      char[] b;
      int offB, lenB;
      if (r.nextInt(3) == 0) {
        b = a.clone();
        offB = off;
        lenB = Math.max(0, len - r.nextInt(2));
        if (lenB > 0 && r.nextBoolean()) b[offB + lenB - 1] = CHAR_ALPHA[r.nextInt(CHAR_ALPHA.length)];
      } else {
        b = randChars(r.nextInt(8) + 4);
        offB = r.nextInt(3);
        lenB = r.nextInt(Math.min(6, b.length - offB) + 1);
      }
      CharsRef x = new CharsRef(a, off, len);
      CharsRef y = new CharsRef(b, offB, lenB);
      int sub0 = r.nextInt(len + 1), sub1 = sub0 + r.nextInt(len - sub0 + 1);
      if (i > 0) sb.append(",");
      sb.append("{\"a\":").append(chars(a)).append(",\"offA\":").append(off).append(",\"lenA\":").append(len)
          .append(",\"b\":").append(chars(b)).append(",\"offB\":").append(offB).append(",\"lenB\":").append(lenB)
          .append(",\"hashA\":").append(x.hashCode()).append(",\"strA\":").append(chars(x.toString()))
          .append(",\"cmp\":").append(x.compareTo(y)).append(",\"eq\":").append(x.equals(y))
          .append(",\"cmp8\":").append(CharsRef.getUTF16SortedAsUTF8Comparator().compare(x, y))
          .append(",\"deepA\":").append(chars(CharsRef.deepCopyOf(x).chars))
          .append(",\"sub0\":").append(sub0).append(",\"sub1\":").append(sub1)
          .append(",\"sub\":").append(chars(x.subSequence(sub0, sub1).toString()))
          .append(",\"charAt0\":").append(len > 0 ? (int) x.charAt(0) : -1).append("}");
    }
    sb.append("]");

    // ---- StringHelper.intsRefToBytesRef -----------------------------------------
    section("intsRefToBytesRef", false);
    sb.append("[");
    for (int i = 0; i < 200; i++) {
      int n = r.nextInt(8);
      int[] a = new int[n + 3];
      for (int j = 0; j < a.length; j++) a[j] = r.nextInt(12) == 0 ? INT_ALPHA[r.nextInt(INT_ALPHA.length)] : r.nextInt(256);
      int off = r.nextInt(3);
      int len = Math.min(n, a.length - off);
      String res;
      try {
        BytesRef br = StringHelper.intsRefToBytesRef(new IntsRef(a, off, len));
        res = q(hex(br.bytes, br.offset, br.length));
      } catch (RuntimeException e) {
        res = ex(e);
      }
      if (i > 0) sb.append(",");
      sb.append("{\"ints\":").append(ints(a)).append(",\"off\":").append(off).append(",\"len\":").append(len)
          .append(",\"result\":").append(res).append("}");
    }
    sb.append("]");

    // ---- BytesRefBuilder: random op programs, state recorded after every op -----
    section("bytesBuilder", false);
    sb.append("[");
    for (int p = 0; p < 60; p++) {
      BytesRefBuilder bb = new BytesRefBuilder();
      if (p > 0) sb.append(",");
      sb.append("[");
      for (int s = 0; s < 25; s++) {
        String op;
        int kind = r.nextInt(13);
        switch (kind) {
          case 0: { int v = r.nextInt(256); bb.append((byte) v); op = "[\"appendByte\"," + v + "]"; break; }
          case 1: { byte[] d = randBytes(3 + r.nextInt(12)); int off = r.nextInt(3), len = r.nextInt(d.length - off + 1); bb.append(d, off, len); op = "[\"appendBytes\"," + q(hex(d)) + "," + off + "," + len + "]"; break; }
          case 2: { byte[] d = randBytes(3 + r.nextInt(12)); int off = r.nextInt(3), len = r.nextInt(d.length - off + 1); bb.append(new BytesRef(d, off, len)); op = "[\"appendRef\"," + q(hex(d)) + "," + off + "," + len + "]"; break; }
          case 3: { byte[] d = randBytes(3 + r.nextInt(12)); int off = r.nextInt(3), len = r.nextInt(d.length - off + 1); bb.copyBytes(d, off, len); op = "[\"copyBytes\"," + q(hex(d)) + "," + off + "," + len + "]"; break; }
          case 4: { byte[] d = randBytes(3 + r.nextInt(12)); int off = r.nextInt(3), len = r.nextInt(d.length - off + 1); bb.copyBytes(new BytesRef(d, off, len)); op = "[\"copyBytesRef\"," + q(hex(d)) + "," + off + "," + len + "]"; break; }
          case 5: { String str = randValidString(8); bb.copyChars(str); op = "[\"copyCharsStr\"," + chars(str) + "]"; break; }
          case 6: { char[] c = randChars(3 + r.nextInt(8)); int off = r.nextInt(3), len = r.nextInt(c.length - off + 1); bb.copyChars(c, off, len); op = "[\"copyCharsArr\"," + chars(c) + "," + off + "," + len + "]"; break; }
          case 7: { char[] c = randChars(3 + r.nextInt(8)); int off = r.nextInt(3), len = r.nextInt(c.length - off + 1); int a0 = r.nextInt(len + 1), a1 = a0 + r.nextInt(len - a0 + 1); bb.copyChars(new CharsRef(c, off, len), a0, a1 - a0); op = "[\"copyCharsRef\"," + chars(c) + "," + off + "," + len + "," + a0 + "," + (a1 - a0) + "]"; break; }
          case 8: { bb.clear(); op = "[\"clear\"]"; break; }
          case 9: { int n = r.nextInt(bb.bytes().length + 1); bb.setLength(n); op = "[\"setLength\"," + n + "]"; break; }
          case 10: { int n = r.nextInt(100); bb.grow(n); op = "[\"grow\"," + n + "]"; break; }
          case 11: { if (bb.length() > 0) { int at = r.nextInt(bb.length()), v = r.nextInt(256); bb.setByteAt(at, (byte) v); op = "[\"setByteAt\"," + at + "," + v + "]"; } else { bb.clear(); op = "[\"clear\"]"; } break; }
          default: { BytesRef t = bb.toBytesRef(); op = "[\"toBytesRef\"," + q(hex(t.bytes, t.offset, t.length)) + "]"; break; }
        }
        if (s > 0) sb.append(",");
        sb.append("{\"op\":").append(op).append(",\"len\":").append(bb.length()).append(",\"cap\":").append(bb.bytes().length)
            .append(",\"bytes\":").append(q(hex(bb.bytes(), 0, bb.length()))).append("}");
      }
      sb.append("]");
    }
    sb.append("]");

    // ---- CharsRefBuilder -----------------------------------------------------------
    section("charsBuilder", false);
    sb.append("[");
    for (int p = 0; p < 60; p++) {
      CharsRefBuilder cb = new CharsRefBuilder();
      if (p > 0) sb.append(",");
      sb.append("[");
      for (int s = 0; s < 25; s++) {
        String op;
        int kind = r.nextInt(14);
        switch (kind) {
          case 0: { char c = r.nextInt(3) == 0 ? (char) r.nextInt(65536) : CHAR_ALPHA[r.nextInt(CHAR_ALPHA.length)]; cb.append(c); op = "[\"appendChar\"," + (int) c + "]"; break; }
          case 1: { char[] c = randChars(2 + r.nextInt(8)); int start = r.nextInt(c.length + 1), end = start + r.nextInt(c.length - start + 1); cb.append(new String(c), start, end); op = "[\"appendStr\"," + chars(c) + "," + start + "," + end + "]"; break; }
          case 2: { char[] c = randChars(2 + r.nextInt(8)); cb.append(new String(c)); op = "[\"appendStrFull\"," + chars(c) + "]"; break; }
          case 3: { char[] c = randChars(3 + r.nextInt(8)); int off = r.nextInt(3), len = r.nextInt(c.length - off + 1); int start = r.nextInt(len + 1), end = start + r.nextInt(len - start + 1); cb.append(new CharsRef(c, off, len), start, end); op = "[\"appendRef\"," + chars(c) + "," + off + "," + len + "," + start + "," + end + "]"; break; }
          case 4: { cb.append((CharSequence) null); op = "[\"appendNull\"]"; break; }
          case 5: { char[] c = randChars(3 + r.nextInt(8)); int off = r.nextInt(3), len = r.nextInt(c.length - off + 1); cb.append(c, off, len); op = "[\"appendChars\"," + chars(c) + "," + off + "," + len + "]"; break; }
          case 6: { char[] c = randChars(3 + r.nextInt(8)); int off = r.nextInt(3), len = r.nextInt(c.length - off + 1); cb.copyChars(c, off, len); op = "[\"copyChars\"," + chars(c) + "," + off + "," + len + "]"; break; }
          case 7: { char[] c = randChars(3 + r.nextInt(8)); int off = r.nextInt(3), len = r.nextInt(c.length - off + 1); cb.copyChars(new CharsRef(c, off, len)); op = "[\"copyCharsRef\"," + chars(c) + "," + off + "," + len + "]"; break; }
          case 8: { BytesRef u = new BytesRef(randValidString(8)); cb.copyUTF8Bytes(u); op = "[\"copyUTF8\"," + q(hex(u.bytes, u.offset, u.length)) + "]"; break; }
          case 9: { BytesRef u = new BytesRef(randValidString(8)); byte[] d = new byte[u.length + 4]; System.arraycopy(u.bytes, 0, d, 2, u.length); cb.copyUTF8Bytes(d, 2, u.length); op = "[\"copyUTF8Arr\"," + q(hex(d)) + ",2," + u.length + "]"; break; }
          case 10: { cb.clear(); op = "[\"clear\"]"; break; }
          case 11: { int n = r.nextInt(cb.chars().length + 1); cb.setLength(n); op = "[\"setLength\"," + n + "]"; break; }
          case 12: { int n = r.nextInt(100); cb.grow(n); op = "[\"grow\"," + n + "]"; break; }
          default: { CharsRef t = cb.toCharsRef(); op = "[\"toCharsRef\"," + chars(t.chars, t.offset, t.length) + "]"; break; }
        }
        if (s > 0) sb.append(",");
        sb.append("{\"op\":").append(op).append(",\"len\":").append(cb.length()).append(",\"cap\":").append(cb.chars().length)
            .append(",\"chars\":").append(chars(cb.chars(), 0, cb.length())).append(",\"str\":").append(chars(cb.toString())).append("}");
      }
      sb.append("]");
    }
    sb.append("]");

    // ---- IntsRefBuilder ------------------------------------------------------------
    section("intsBuilder", false);
    sb.append("[");
    for (int p = 0; p < 60; p++) {
      IntsRefBuilder ib = new IntsRefBuilder();
      if (p > 0) sb.append(",");
      sb.append("[");
      for (int s = 0; s < 25; s++) {
        String op;
        int kind = r.nextInt(9);
        switch (kind) {
          case 0: { int v = randInts(1)[0]; ib.append(v); op = "[\"append\"," + v + "]"; break; }
          case 1: { int[] d = randInts(3 + r.nextInt(8)); int off = r.nextInt(3), len = r.nextInt(d.length - off + 1); ib.copyInts(d, off, len); op = "[\"copyInts\"," + ints(d) + "," + off + "," + len + "]"; break; }
          case 2: { int[] d = randInts(3 + r.nextInt(8)); int off = r.nextInt(3), len = r.nextInt(d.length - off + 1); ib.copyInts(new IntsRef(d, off, len)); op = "[\"copyIntsRef\"," + ints(d) + "," + off + "," + len + "]"; break; }
          case 3: { BytesRef u = new BytesRef(randValidString(8)); ib.copyUTF8Bytes(u); op = "[\"copyUTF8\"," + q(hex(u.bytes, u.offset, u.length)) + "]"; break; }
          case 4: { ib.clear(); op = "[\"clear\"]"; break; }
          case 5: { int n = r.nextInt(ib.ints().length + 1); ib.setLength(n); op = "[\"setLength\"," + n + "]"; break; }
          case 6: { int n = r.nextInt(100); ib.grow(n); op = "[\"grow\"," + n + "]"; break; }
          case 7: { if (ib.length() > 0) { int at = r.nextInt(ib.length()), v = randInts(1)[0]; ib.setIntAt(at, v); op = "[\"setIntAt\"," + at + "," + v + "]"; } else { ib.clear(); op = "[\"clear\"]"; } break; }
          default: { IntsRef t = ib.toIntsRef(); op = "[\"toIntsRef\"," + ints(t.ints, t.offset, t.length) + "]"; break; }
        }
        if (s > 0) sb.append(",");
        sb.append("{\"op\":").append(op).append(",\"len\":").append(ib.length()).append(",\"cap\":").append(ib.ints().length)
            .append(",\"ints\":").append(ints(ib.ints(), 0, ib.length())).append("}");
      }
      sb.append("]");
    }
    sb.append("]");

    sb.append("\n}\n");
    System.out.print(sb);
  }
}
