import java.util.Random;
import org.apache.lucene.util.BitUtil;
import org.apache.lucene.util.BytesRef;
import org.apache.lucene.util.MathUtil;
import org.apache.lucene.util.StringHelper;
import org.apache.lucene.util.UnicodeUtil;

/**
 * Generates test/golden/util.json: inputs AND outputs computed by the original
 * Lucene 5.2.1 Java classes, so the TypeScript port can be checked against them.
 *
 * Run through tools/golden/generate.sh (needs the Lucene sources and a JDK).
 * The JVM must be started with -Dtests.seed=DEADBEEF so that the id generator and
 * the BytesRef hash seed are reproducible.
 */
public class Golden {
  static final StringBuilder sb = new StringBuilder();

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

  static String q(String s) {
    return "\"" + s + "\"";
  }

  static String ints(int[] a, int n) {
    StringBuilder s = new StringBuilder("[");
    for (int i = 0; i < n; i++) {
      if (i > 0) s.append(',');
      s.append(a[i]);
    }
    return s.append(']').toString();
  }

  static String chars(char[] a, int n) {
    StringBuilder s = new StringBuilder("[");
    for (int i = 0; i < n; i++) {
      if (i > 0) s.append(',');
      s.append((int) a[i]);
    }
    return s.append(']').toString();
  }

  static String longs(long[] a) {
    StringBuilder s = new StringBuilder("[");
    for (int i = 0; i < a.length; i++) {
      if (i > 0) s.append(',');
      s.append(q(Long.toString(a[i])));
    }
    return s.append(']').toString();
  }

  static String dbits(double d) {
    return q(Long.toHexString(Double.doubleToRawLongBits(d)));
  }

  static void section(String name, boolean first) {
    if (!first) sb.append(",\n");
    sb.append(q(name)).append(": ");
  }

  static long randomLong(Random r) {
    // random bit length so that small and large magnitudes are both well covered
    long v = r.nextLong() >>> r.nextInt(64);
    return r.nextBoolean() ? v : -v;
  }

  public static void main(String[] args) {
    Random r = new Random(12345);
    sb.append("{\n");

    // ---- murmurhash3 -------------------------------------------------------
    section("murmur", true);
    sb.append("[");
    for (int i = 0; i < 300; i++) {
      int len = r.nextInt(40);
      int off = r.nextInt(5);
      byte[] data = new byte[off + len + r.nextInt(5)];
      r.nextBytes(data);
      int seed = r.nextInt();
      if (i > 0) sb.append(",");
      sb.append("{\"data\":").append(q(hex(data))).append(",\"offset\":").append(off).append(",\"len\":").append(len)
          .append(",\"seed\":").append(seed).append(",\"hash\":")
          .append(StringHelper.murmurhash3_x86_32(data, off, len, seed)).append("}");
    }
    sb.append("]");

    // ---- zig zag -----------------------------------------------------------
    section("zigzagInt", false);
    sb.append("[");
    int[] edgeInts = {0, 1, -1, 2, -2, Integer.MAX_VALUE, Integer.MIN_VALUE, Integer.MAX_VALUE - 1, Integer.MIN_VALUE + 1};
    for (int i = 0; i < 300; i++) {
      int v = i < edgeInts.length ? edgeInts[i] : r.nextInt() >> r.nextInt(32);
      if (i > 0) sb.append(",");
      sb.append("[").append(v).append(",").append(BitUtil.zigZagEncode(v)).append(",").append(BitUtil.zigZagDecode(v)).append("]");
    }
    sb.append("]");

    section("zigzagLong", false);
    sb.append("[");
    long[] edgeLongs = {0, 1, -1, 2, -2, Long.MAX_VALUE, Long.MIN_VALUE, Long.MAX_VALUE - 1, Long.MIN_VALUE + 1};
    for (int i = 0; i < 300; i++) {
      long v = i < edgeLongs.length ? edgeLongs[i] : randomLong(r);
      if (i > 0) sb.append(",");
      sb.append("[").append(q("" + v)).append(",").append(q("" + BitUtil.zigZagEncode(v))).append(",")
          .append(q("" + BitUtil.zigZagDecode(v))).append("]");
    }
    sb.append("]");

    // ---- nextHighestPowerOfTwo --------------------------------------------
    section("nhpotInt", false);
    sb.append("[");
    for (int i = 0; i < 300; i++) {
      int v;
      if (i <= 100) v = i;
      else if (i == 101) v = 1 << 30;
      else if (i == 102) v = (1 << 30) + 1;
      else if (i == 103) v = Integer.MAX_VALUE;
      else if (i == 104) v = -1;
      else if (i == 105) v = Integer.MIN_VALUE;
      else v = r.nextInt(Integer.MAX_VALUE) >> r.nextInt(31);
      if (i > 0) sb.append(",");
      sb.append("[").append(v).append(",").append(BitUtil.nextHighestPowerOfTwo(v)).append("]");
    }
    sb.append("]");

    section("nhpotLong", false);
    sb.append("[");
    for (int i = 0; i < 300; i++) {
      long v;
      if (i <= 100) v = i;
      else if (i == 101) v = 1L << 62;
      else if (i == 102) v = (1L << 62) + 1;
      else if (i == 103) v = Long.MAX_VALUE;
      else if (i == 104) v = -1;
      else if (i == 105) v = Long.MIN_VALUE;
      else v = randomLong(r);
      if (i > 0) sb.append(",");
      sb.append("[").append(q("" + v)).append(",").append(q("" + BitUtil.nextHighestPowerOfTwo(v))).append("]");
    }
    sb.append("]");

    // ---- gcd / log ---------------------------------------------------------
    section("gcd", false);
    sb.append("[");
    long[][] gcdEdge = {
      {0, 0}, {0, 5}, {5, 0}, {-5, 0}, {12, 18}, {-12, 18}, {17, 13},
      {Long.MIN_VALUE, 0}, {0, Long.MIN_VALUE}, {Long.MIN_VALUE, Long.MIN_VALUE},
      {Long.MIN_VALUE, 1L << 40}, {1L << 40, Long.MIN_VALUE}, {Long.MIN_VALUE, 3}, {Long.MIN_VALUE, -6},
      {Long.MAX_VALUE, Long.MAX_VALUE}, {Long.MAX_VALUE, Long.MIN_VALUE}, {Long.MIN_VALUE + 1, Long.MAX_VALUE}
    };
    for (int i = 0; i < 400; i++) {
      long a, b;
      if (i < gcdEdge.length) {
        a = gcdEdge[i][0];
        b = gcdEdge[i][1];
      } else if (i % 3 == 0) {
        long f = 1 + r.nextInt(1 << 20);
        a = (randomLong(r) >> 22) * f;
        b = (randomLong(r) >> 22) * f;
      } else {
        a = randomLong(r);
        b = randomLong(r);
      }
      if (i > 0) sb.append(",");
      sb.append("[").append(q("" + a)).append(",").append(q("" + b)).append(",").append(q("" + MathUtil.gcd(a, b))).append("]");
    }
    sb.append("]");

    section("log", false);
    sb.append("[");
    for (int i = 0; i < 300; i++) {
      long x = i == 0 ? 0 : i == 1 ? -5 : i == 2 ? Long.MAX_VALUE : i == 3 ? Long.MIN_VALUE : randomLong(r);
      int base = 2 + r.nextInt(39);
      if (i > 0) sb.append(",");
      sb.append("[").append(q("" + x)).append(",").append(base).append(",").append(MathUtil.log(x, base)).append("]");
    }
    sb.append("]");

    // ---- hyperbolic functions (doubles are exchanged as raw bits) ---------
    section("hyper", false);
    sb.append("[");
    double[] hv = {0.0, -0.0, 1.0, -1.0, 0.5, -0.5, 2.0, 100.0, -100.0, 1e-10, 1e10, Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, 0.999999, 1.000001};
    for (int i = 0; i < 100; i++) {
      double d = i < hv.length ? hv[i] : (r.nextDouble() * 4 - 2) * Math.pow(10, r.nextInt(5) - 2);
      if (i > 0) sb.append(",");
      sb.append("[").append(dbits(d)).append(",").append(dbits(MathUtil.asinh(d))).append(",").append(dbits(MathUtil.acosh(d)))
          .append(",").append(dbits(MathUtil.atanh(d))).append("]");
    }
    sb.append("]");

    // ---- BitUtil tables and population counts -----------------------------
    section("bitTables", false);
    sb.append("{\"bitCount\":[");
    for (int b = 0; b < 256; b++) {
      if (b > 0) sb.append(",");
      sb.append(BitUtil.bitCount((byte) b));
    }
    sb.append("],\"bitList\":[");
    for (int b = 0; b < 256; b++) {
      if (b > 0) sb.append(",");
      sb.append(BitUtil.bitList((byte) b));
    }
    sb.append("]}");

    section("pop", false);
    sb.append("[");
    for (int i = 0; i < 60; i++) {
      long[] a = new long[7];
      long[] b = new long[7];
      for (int j = 0; j < 7; j++) {
        a[j] = r.nextLong() & (r.nextBoolean() ? -1L : r.nextLong());
        b[j] = r.nextLong() | (r.nextBoolean() ? 0L : r.nextLong());
      }
      int off = r.nextInt(4);
      int n = r.nextInt(8 - off);
      if (i > 0) sb.append(",");
      sb.append("{\"a\":").append(longs(a)).append(",\"b\":").append(longs(b)).append(",\"offset\":").append(off).append(",\"n\":").append(n)
          .append(",\"array\":").append(BitUtil.pop_array(a, off, n))
          .append(",\"intersect\":").append(BitUtil.pop_intersect(a, b, off, n))
          .append(",\"union\":").append(BitUtil.pop_union(a, b, off, n))
          .append(",\"andnot\":").append(BitUtil.pop_andnot(a, b, off, n))
          .append(",\"xor\":").append(BitUtil.pop_xor(a, b, off, n)).append("}");
    }
    sb.append("]");

    // ---- UTF-16 -> UTF-8 (random code units, lone surrogates included) -----
    section("utf16toutf8", false);
    sb.append("[");
    for (int i = 0; i < 400; i++) {
      int len = r.nextInt(12);
      char[] units = new char[len];
      for (int j = 0; j < len; j++) {
        switch (r.nextInt(6)) {
          case 0: units[j] = (char) r.nextInt(0x80); break;
          case 1: units[j] = (char) (0x80 + r.nextInt(0x780)); break;
          case 2: units[j] = (char) (0x800 + r.nextInt(0xf800)); break;
          case 3: units[j] = (char) (0xd800 + r.nextInt(0x400)); break; // high surrogate
          case 4: units[j] = (char) (0xdc00 + r.nextInt(0x400)); break; // low surrogate
          default:
            // a well-formed pair, when there is room
            units[j] = (char) (0xd800 + r.nextInt(0x400));
            if (j + 1 < len) {
              units[++j] = (char) (0xdc00 + r.nextInt(0x400));
            }
        }
      }
      byte[] out = new byte[3 * len + 1];
      int n = UnicodeUtil.UTF16toUTF8(units, 0, len, out);
      byte[] out2 = new byte[3 * len + 1];
      int n2 = UnicodeUtil.UTF16toUTF8(new String(units), 0, len, out2);
      if (n != n2 || !hex(out, 0, n).equals(hex(out2, 0, n2))) {
        throw new IllegalStateException("char[] and CharSequence variants disagree");
      }
      if (i > 0) sb.append(",");
      sb.append("{\"units\":").append(chars(units, len)).append(",\"bytes\":").append(q(hex(out, 0, n)))
          .append(",\"valid\":").append(UnicodeUtil.validUTF16String(units, len)).append("}");
    }
    sb.append("]");

    // ---- UTF-8 -> UTF-16 / UTF-32 / newString ------------------------------
    section("utf8decode", false);
    sb.append("[");
    for (int i = 0; i < 400; i++) {
      int cpCount = r.nextInt(10);
      byte[] buf = new byte[cpCount * 4];
      int n = 0;
      for (int j = 0; j < cpCount; j++) {
        int k = r.nextInt(4);
        if (k == 0) {
          buf[n++] = (byte) r.nextInt(0x80);
        } else if (k == 1) {
          int c = 0x80 + r.nextInt(0x780);
          buf[n++] = (byte) (0xc0 | (c >> 6));
          buf[n++] = (byte) (0x80 | (c & 0x3f));
        } else if (k == 2) {
          int c = 0x800 + r.nextInt(0xf800); // surrogates D800..DFFF are allowed: Lucene does not validate
          buf[n++] = (byte) (0xe0 | (c >> 12));
          buf[n++] = (byte) (0x80 | ((c >> 6) & 0x3f));
          buf[n++] = (byte) (0x80 | (c & 0x3f));
        } else {
          int c = 0x10000 + r.nextInt(0x100000);
          buf[n++] = (byte) (0xf0 | (c >> 18));
          buf[n++] = (byte) (0x80 | ((c >> 12) & 0x3f));
          buf[n++] = (byte) (0x80 | ((c >> 6) & 0x3f));
          buf[n++] = (byte) (0x80 | (c & 0x3f));
        }
      }
      byte[] utf8 = new byte[n];
      System.arraycopy(buf, 0, utf8, 0, n);
      BytesRef ref = new BytesRef(utf8);
      char[] u16 = new char[n];
      int n16 = UnicodeUtil.UTF8toUTF16(utf8, 0, n, u16);
      int[] u32 = new int[n];
      int n32 = UnicodeUtil.UTF8toUTF32(ref, u32);
      if (i > 0) sb.append(",");
      sb.append("{\"bytes\":").append(q(hex(utf8))).append(",\"units\":").append(chars(u16, n16))
          .append(",\"cps\":").append(ints(u32, n32)).append(",\"codePointCount\":").append(UnicodeUtil.codePointCount(ref))
          .append(",\"newString\":").append(chars(UnicodeUtil.newString(u32, 0, n32).toCharArray(), UnicodeUtil.newString(u32, 0, n32).length()))
          .append("}");
    }
    sb.append("]");

    // ---- BytesRef ordering / hash ------------------------------------------
    int[] alphabet = {0x00, 0x41, 0x7f, 0x80, 0xc3, 0xed, 0xee, 0xef, 0xf0, 0xff};
    section("compare", false);
    sb.append("[");
    for (int i = 0; i < 500; i++) {
      byte[] a = new byte[r.nextInt(6)];
      byte[] b = new byte[r.nextInt(6)];
      for (int j = 0; j < a.length; j++) a[j] = (byte) alphabet[r.nextInt(alphabet.length)];
      if (r.nextInt(3) == 0) {
        // share a prefix
        b = new byte[a.length + r.nextInt(3)];
        for (int j = 0; j < b.length; j++) b[j] = j < a.length ? a[j] : (byte) alphabet[r.nextInt(alphabet.length)];
        if (b.length > 0 && r.nextBoolean()) b[b.length - 1] = (byte) alphabet[r.nextInt(alphabet.length)];
      } else {
        for (int j = 0; j < b.length; j++) b[j] = (byte) alphabet[r.nextInt(alphabet.length)];
      }
      BytesRef ra = new BytesRef(a);
      BytesRef rb = new BytesRef(b);
      if (i > 0) sb.append(",");
      sb.append("{\"a\":").append(q(hex(a))).append(",\"b\":").append(q(hex(b))).append(",\"cmp\":").append(ra.compareTo(rb))
          .append(",\"cmp16\":").append(BytesRef.getUTF8SortedAsUTF16Comparator().compare(ra, rb))
          .append(",\"diff\":").append(StringHelper.bytesDifference(ra, rb))
          .append(",\"sortKey\":").append(StringHelper.sortKeyLength(ra, rb))
          .append(",\"startsWith\":").append(StringHelper.startsWith(ra, rb))
          .append(",\"endsWith\":").append(StringHelper.endsWith(ra, rb))
          .append(",\"equals\":").append(ra.equals(rb)).append("}");
    }
    sb.append("]");

    // ---- hash seed dependent values (JVM started with -Dtests.seed=DEADBEEF) ----
    section("seeded", false);
    sb.append("{\"testsSeed\":").append(q(System.getProperty("tests.seed", "")))
        .append(",\"hashSeed\":").append(StringHelper.GOOD_FAST_HASH_SEED).append(",\"hashes\":[");
    for (int i = 0; i < 50; i++) {
      byte[] data = new byte[r.nextInt(20)];
      r.nextBytes(data);
      if (i > 0) sb.append(",");
      sb.append("{\"data\":").append(q(hex(data))).append(",\"hash\":").append(new BytesRef(data).hashCode()).append("}");
    }
    sb.append("],\"ids\":[");
    for (int i = 0; i < 40; i++) {
      byte[] id = StringHelper.randomId();
      if (i > 0) sb.append(",");
      sb.append("{\"id\":").append(q(hex(id))).append(",\"str\":").append(q(StringHelper.idToString(id))).append("}");
    }
    sb.append("]}");

    sb.append("\n}\n");
    System.out.print(sb);
  }
}
