import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.apache.lucene.store.*;

/**
 * Generates test/golden/store-data.json: inputs AND outputs computed by the original Lucene 5.2.1 classes
 * DataInput, DataOutput, ByteArrayDataInput, ByteArrayDataOutput, InputStreamDataInput and
 * OutputStreamDataOutput (over java.io.ByteArray{Input,Output}Stream), so that the TypeScript port can be
 * checked against them. Run through tools/golden/generate.sh.
 *
 * Conventions in the JSON: ints are numbers, longs are decimal strings, byte[] are lower-case hex strings,
 * Java Strings are JSON strings (every char outside 32..126 is written as a \\uXXXX escape, so lone
 * surrogates survive), "EX:Class:message" stands for a thrown exception.
 */
public class GoldenStore {
  static final Random r = new Random(20261118);
  static final StringBuilder sb = new StringBuilder();

  // ---- JSON helpers -----------------------------------------------------------
  static String js(String s) {
    StringBuilder b = new StringBuilder("\"");
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      if (c == '"' || c == '\\') b.append('\\').append(c);
      else if (c >= 32 && c <= 126) b.append(c);
      else b.append(String.format("\\u%04x", (int) c));
    }
    return b.append('"').toString();
  }

  static String hex(byte[] b) {
    StringBuilder h = new StringBuilder();
    for (byte x : b) h.append(String.format("%02x", x & 0xff));
    return h.toString();
  }

  static byte[] unhex(String h) {
    byte[] b = new byte[h.length() / 2];
    for (int i = 0; i < b.length; i++) b[i] = (byte) Integer.parseInt(h.substring(2 * i, 2 * i + 2), 16);
    return b;
  }

  static String ex(Throwable t) {
    String m = t.getMessage();
    return js("EX:" + t.getClass().getSimpleName() + ":" + (m == null ? "" : m));
  }

  interface Thrower<T> { T run() throws Exception; }

  /** Value as JSON (long -> decimal string, int -> number, String -> JSON string) or the exception. */
  static String res(Thrower<Object> f) {
    try {
      Object v = f.run();
      if (v instanceof Long) return "\"" + v + "\"";
      if (v instanceof String) return js((String) v);
      return String.valueOf(v);
    } catch (Throwable t) {
      return ex(t);
    }
  }

  static <T> String list(List<T> l, java.util.function.Function<T, String> f) {
    StringBuilder s = new StringBuilder("[");
    for (int i = 0; i < l.size(); i++) {
      if (i > 0) s.append(',');
      s.append(f.apply(l.get(i)));
    }
    return s.append(']').toString();
  }

  // ---- ops ---------------------------------------------------------------------
  static final String[] KINDS = {"byte", "short", "int", "long", "vint", "vlong", "zint", "zlong", "string"};

  static class Op {
    final String kind;
    final long v; // numeric value
    final String s; // string value
    Op(String kind, long v, String s) { this.kind = kind; this.v = v; this.s = s; }
    String json() {
      return "[" + js(kind) + "," + (kind.equals("string") ? js(s) : "\"" + v + "\"") + "]";
    }
  }

  static void write(DataOutput out, Op op) throws IOException {
    switch (op.kind) {
      case "byte": out.writeByte((byte) op.v); break;
      case "short": out.writeShort((short) op.v); break;
      case "int": out.writeInt((int) op.v); break;
      case "long": out.writeLong(op.v); break;
      case "vint": out.writeVInt((int) op.v); break;
      case "vlong": out.writeVLong(op.v); break;
      case "zint": out.writeZInt((int) op.v); break;
      case "zlong": out.writeZLong(op.v); break;
      case "string": out.writeString(op.s); break;
      default: throw new AssertionError(op.kind);
    }
  }

  static Object read(DataInput in, String kind) throws IOException {
    switch (kind) {
      case "byte": return (long) (in.readByte() & 0xff);
      case "short": return (long) in.readShort();
      case "int": return (long) in.readInt();
      case "long": return in.readLong();
      case "vint": return (long) in.readVInt();
      case "vlong": return in.readVLong();
      case "zint": return (long) in.readZInt();
      case "zlong": return in.readZLong();
      case "string": return in.readString();
      default: throw new AssertionError(kind);
    }
  }

  static String readJson(DataInput in, String kind) throws IOException {
    Object o = read(in, kind);
    return o instanceof String ? js((String) o) : "\"" + o + "\"";
  }

  static byte[] writeAll(List<Op> ops) throws IOException {
    ByteArrayOutputStream bos = new ByteArrayOutputStream();
    OutputStreamDataOutput out = new OutputStreamDataOutput(bos);
    for (Op op : ops) write(out, op);
    out.close();
    // the same through ByteArrayDataOutput must give the same bytes
    byte[] big = new byte[bos.size() + 3];
    ByteArrayDataOutput bad = new ByteArrayDataOutput(big);
    for (Op op : ops) write(bad, op);
    if (bad.getPosition() != bos.size() || !Arrays.equals(Arrays.copyOf(big, bos.size()), bos.toByteArray()))
      throw new AssertionError("ByteArrayDataOutput differs from OutputStreamDataOutput");
    return bos.toByteArray();
  }

  static String roundTrip(List<Op> ops) throws IOException {
    byte[] data = writeAll(ops);
    InputStreamDataInput sin = new InputStreamDataInput(new ByteArrayInputStream(data));
    ByteArrayDataInput bin = new ByteArrayDataInput(data);
    List<String> back = new ArrayList<>();
    for (Op op : ops) {
      String a = readJson(sin, op.kind);
      String b = readJson(bin, op.kind);
      if (!a.equals(b)) throw new AssertionError("readers differ " + a + " " + b);
      back.add(a);
    }
    if (!bin.eof()) throw new AssertionError("not at eof");
    return "{\"ops\":" + list(ops, Op::json) + ",\"hex\":\"" + hex(data) + "\",\"read\":"
        + list(back, x -> x) + "}";
  }

  static final long[] LONGS;
  static {
    List<Long> l = new ArrayList<>(Arrays.asList(0L, 1L, -1L, 2L, -2L, 255L, 256L, 32767L, 32768L, -32768L,
        65535L, 65536L, Long.MAX_VALUE, Long.MIN_VALUE, Long.MAX_VALUE - 1, Long.MIN_VALUE + 1,
        (long) Integer.MAX_VALUE, (long) Integer.MIN_VALUE, 4294967295L, 4294967296L, -4294967296L));
    for (int k = 1; k <= 9; k++) {
      long p = 1L << (7 * k);
      l.add(p - 1); l.add(p); l.add(p + 1); l.add(-p); l.add(-p - 1); l.add(-p + 1);
    }
    LONGS = new long[l.size()];
    for (int i = 0; i < LONGS.length; i++) LONGS[i] = l.get(i);
  }

  static long randomLong(boolean nonNegative) {
    long v = r.nextLong() >>> r.nextInt(64);
    if (r.nextBoolean()) v = -v;
    if (r.nextInt(8) == 0) v = LONGS[r.nextInt(LONGS.length)];
    return nonNegative ? (v & Long.MAX_VALUE) : v;
  }

  static final String[] STRINGS = {
    "", "a", "abc", "héllo", "日本語", "😀", "a😀b", "\ud800", "\udc00x",
    "x\ud800", "\ud800\ud800", "\udc00\ud800", "a\u0000b", "\u0000", "﻿", "﻿abc", "\u007f\u0080߿ࠀ￿",
    "ÿĀ", "�", "tab\tnl\n\"q\"\\",
  };

  static String randomString() {
    int n = r.nextInt(6) == 0 ? r.nextInt(400) : r.nextInt(12);
    StringBuilder s = new StringBuilder();
    for (int i = 0; i < n; i++) {
      switch (r.nextInt(6)) {
        case 0: s.append((char) r.nextInt(128)); break;
        case 1: s.append((char) (128 + r.nextInt(0x700))); break;
        case 2: s.append((char) (0x800 + r.nextInt(0xd000))); break;
        case 3: s.appendCodePoint(0x10000 + r.nextInt(0x100000)); break;
        case 4: s.append((char) (0xd800 + r.nextInt(0x800))); break; // maybe unpaired
        default: s.append((char) ('a' + r.nextInt(26)));
      }
    }
    return s.toString();
  }

  static Op randomOp() {
    String k = KINDS[r.nextInt(KINDS.length)];
    switch (k) {
      case "byte": return new Op(k, (byte) r.nextInt(256), null);
      case "short": return new Op(k, (short) r.nextInt(65536), null);
      case "int": case "vint": case "zint": {
        long v = (int) randomLong(false);
        return new Op(k, v, null);
      }
      case "long": case "zlong": return new Op(k, randomLong(false), null);
      case "vlong": return new Op(k, randomLong(true), null);
      default: return new Op(k, 0, randomString());
    }
  }

  // ---- sections -------------------------------------------------------------
  static void section(String name, String json) {
    if (sb.length() > 1) sb.append(",\n");
    sb.append(js(name)).append(':').append(json);
  }

  static String allReads(String hexIn) {
    // Every primitive reader on both DataInput implementations, with the ByteArrayDataInput position after.
    byte[] data = unhex(hexIn);
    StringBuilder s = new StringBuilder("{\"hex\":\"" + hexIn + "\"");
    for (String kind : KINDS) {
      String sres = res(() -> {
        InputStreamDataInput in = new InputStreamDataInput(new ByteArrayInputStream(data));
        Object o = read(in, kind);
        return o;
      });
      final int[] pos = {-1};
      String bres = res(() -> {
        ByteArrayDataInput in = new ByteArrayDataInput(data);
        try {
          return read(in, kind);
        } finally {
          pos[0] = in.getPosition();
        }
      });
      s.append(",").append(js(kind)).append(":{\"stream\":").append(sres).append(",\"bytes\":").append(bres)
          .append(",\"pos\":").append(pos[0]).append('}');
    }
    return s.append('}').toString();
  }

  public static void main(String[] args) throws Exception {
    sb.append('{');

    // 1. boundary values, one sequence per kind (all values in a row)
    {
      List<String> cases = new ArrayList<>();
      for (String k : KINDS) {
        if (k.equals("string")) continue;
        List<Op> ops = new ArrayList<>();
        for (long v : LONGS) {
          if (k.equals("vlong") && v < 0) continue;
          long vv = v;
          if (k.equals("byte")) vv = (byte) v;
          if (k.equals("short")) vv = (short) v;
          if (k.equals("int") || k.equals("vint") || k.equals("zint")) vv = (int) v;
          ops.add(new Op(k, vv, null));
        }
        cases.add(roundTrip(ops));
      }
      List<Op> ops = new ArrayList<>();
      for (String s : STRINGS) ops.add(new Op("string", 0, s));
      cases.add(roundTrip(ops));
      section("boundaries", list(cases, x -> x));
    }

    // 2. random mixed sequences
    {
      List<String> cases = new ArrayList<>();
      for (int i = 0; i < 300; i++) {
        List<Op> ops = new ArrayList<>();
        int n = 1 + r.nextInt(25);
        for (int j = 0; j < n; j++) ops.add(randomOp());
        cases.add(roundTrip(ops));
      }
      section("random", list(cases, x -> x));
    }

    // 3. malformed / truncated inputs through every reader on both implementations
    {
      String[] hexes = {
        "", "00", "01", "7f", "80", "ff", "0102", "010203", "01020304", "0102030405060708", "ffff", "80000000",
        "ffffffff", "ffffffffffffffff", "7fffffff", "8000", "8001", "ff7f", "808080808000",
        // vint
        "ffffff7f", "ffffffff0f", "ffffffff1f", "ffffffff10", "ffffffff7f", "ffffffff0e", "80808080 08".replace(" ", ""),
        // vlong / zlong, 9 and 10 bytes
        "ffffffffffffff7f", "ffffffffffffffff7f", "ffffffffffffffff00", "ffffffffffffffff80", "ffffffffffffffff80 00".replace(" ", ""),
        "ffffffffffffffffff00", "ffffffffffffffffff01", "ffffffffffffffffff02", "ffffffffffffffffff7f", "ffffffffffffffffffff",
        "8080808080808080 80 01".replace(" ", ""), "80808080808080808000",
        // strings: ok, truncated, negative length, malformed UTF-8
        "03616263", "0361", "ffffffff0f", "feffffff0f", "00", "01c3", "01ff", "03eda080", "02c080", "04f4908080",
        "03e282", "02e282", "04f09f98", "03efbbbf", "03e08080", "04f0808080", "03edbfbf", "02c1bf", "02c3a9",
        "04f09f9880", "03e282ac", "05e282ac41", "02feff", "03c328 41".replace(" ", ""), "04c328c328", "0541e2 8241 42".replace(" ", ""),
        "0480f09f98", "06f09f98f09f98", "04f09f9841",
      };
      section("reads", list(Arrays.asList(hexes), GoldenStore::allReads));
    }

    // 4. skipBytes
    {
      byte[] data = new byte[5000];
      r.nextBytes(data);
      int[] counts = {0, 1, 2, 1023, 1024, 1025, 2048, 3000, 4999, 5000, 5001, 10000, -1, -1000};
      List<String> cases = new ArrayList<>();
      for (int c : counts) {
        String sres = res(() -> {
          InputStreamDataInput in = new InputStreamDataInput(new ByteArrayInputStream(data));
          in.skipBytes(c);
          return (long) (in.readByte() & 0xff);
        });
        final int[] pos = {-1};
        String bres = res(() -> {
          ByteArrayDataInput in = new ByteArrayDataInput(data);
          try {
            in.skipBytes(c);
            return (long) (in.readByte() & 0xff);
          } finally {
            pos[0] = in.getPosition();
          }
        });
        cases.add("{\"count\":" + c + ",\"stream\":" + sres + ",\"bytes\":" + bres + ",\"pos\":" + pos[0] + "}");
      }
      section("skip", "{\"data\":\"" + hex(data) + "\",\"cases\":" + list(cases, x -> x) + "}");
    }

    // 5. copyBytes
    {
      byte[] data = new byte[50000];
      r.nextBytes(data);
      int[] counts = {0, 1, 2, 16383, 16384, 16385, 32768, 32769, 40000, 50000, 50001};
      List<String> cases = new ArrayList<>();
      for (int c : counts) {
        String viaStream = res(() -> {
          ByteArrayOutputStream bos = new ByteArrayOutputStream();
          OutputStreamDataOutput out = new OutputStreamDataOutput(bos);
          out.copyBytes(new InputStreamDataInput(new ByteArrayInputStream(data)), c);
          if (!Arrays.equals(bos.toByteArray(), Arrays.copyOf(data, c))) throw new AssertionError("copy differs");
          return (long) bos.size();
        });
        String viaBytes = res(() -> {
          byte[] dst = new byte[c];
          ByteArrayDataOutput out = new ByteArrayDataOutput(dst);
          ByteArrayDataInput in = new ByteArrayDataInput(data);
          out.copyBytes(in, c);
          if (!Arrays.equals(dst, Arrays.copyOf(data, c))) throw new AssertionError("copy differs");
          return (long) out.getPosition();
        });
        cases.add("{\"count\":" + c + ",\"stream\":" + viaStream + ",\"bytes\":" + viaBytes + "}");
      }
      section("copy", "{\"data\":\"" + hex(data) + "\",\"cases\":" + list(cases, x -> x) + "}");
    }

    // 6. maps and sets
    {
      int[] sizes = {0, 1, 2, 3, 5, 9, 10, 11, 12, 13, 24, 25, 48, 49, 100, 200};
      List<String> cases = new ArrayList<>();
      for (int n : sizes) {
        for (int variant = 0; variant < 3; variant++) {
          LinkedHashMap<String, String> m = new LinkedHashMap<>();
          while (m.size() < n) {
            String k;
            switch (variant) {
              case 0: k = "k" + m.size(); break;
              case 1: k = "" + (char) ('a' + r.nextInt(26)) + (char) ('a' + r.nextInt(26)) + r.nextInt(1000); break;
              default: k = randomString(); break;
            }
            m.put(k, "v" + r.nextInt(100));
          }
          cases.add(mapCase(m));
        }
      }
      section("collections", list(cases, x -> x));
    }

    // 7. maps and sets with duplicate entries in the stream (HashMap/TreeMap replace the value)
    {
      List<String> cases = new ArrayList<>();
      for (int n : new int[] {3, 12}) {
        ByteArrayOutputStream a = new ByteArrayOutputStream();
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        OutputStreamDataOutput ma = new OutputStreamDataOutput(a);
        OutputStreamDataOutput sa = new OutputStreamDataOutput(b);
        ma.writeVInt(n);
        sa.writeVInt(n);
        for (int i = 0; i < n; i++) {
          String k = "key" + (i % 2 == 0 ? i % 4 : 99 - i);
          ma.writeString(k);
          ma.writeString("val" + i);
          sa.writeString(k);
        }
        byte[] md = a.toByteArray();
        byte[] sd = b.toByteArray();
        ByteArrayOutputStream a2 = new ByteArrayOutputStream();
        OutputStreamDataOutput ma2 = new OutputStreamDataOutput(a2);
        ma2.writeInt(n);
        for (int i = 0; i < n; i++) {
          ma2.writeString("key" + (i % 2 == 0 ? i % 4 : 99 - i));
          ma2.writeString("val" + i);
        }
        ByteArrayOutputStream b2 = new ByteArrayOutputStream();
        OutputStreamDataOutput sa2 = new OutputStreamDataOutput(b2);
        sa2.writeInt(n);
        for (int i = 0; i < n; i++) sa2.writeString("key" + (i % 2 == 0 ? i % 4 : 99 - i));
        cases.add("{\"n\":" + n
            + ",\"mapOfStrings\":" + mapJson(new ByteArrayDataInput(md), true, false)
            + ",\"setOfStrings\":" + setJson(new ByteArrayDataInput(sd), true)
            + ",\"stringStringMap\":" + mapJson(new ByteArrayDataInput(a2.toByteArray()), false, true)
            + ",\"stringSet\":" + setJson(new ByteArrayDataInput(b2.toByteArray()), false)
            + ",\"mapHex\":\"" + hex(md) + "\",\"setHex\":\"" + hex(sd) + "\""
            + ",\"mapHexInt\":\"" + hex(a2.toByteArray()) + "\",\"setHexInt\":\"" + hex(b2.toByteArray()) + "\"}");
      }
      section("duplicates", list(cases, x -> x));
    }

    // 8. null collections
    {
      ByteArrayOutputStream bos = new ByteArrayOutputStream();
      OutputStreamDataOutput out = new OutputStreamDataOutput(bos);
      out.writeStringStringMap(null);
      out.writeStringSet(null);
      section("nulls", "\"" + hex(bos.toByteArray()) + "\"");
    }

    // 9. UTF-8 decoding of malformed input: exhaustive families (as a SHA-256 over all results) + explicit random cases
    {
      int[][] alphabets = {
        null, // all 256 values
        null,
        {0x00, 0x41, 0x7f, 0x80, 0x81, 0x8f, 0x90, 0x9f, 0xa0, 0xbf, 0xc0, 0xc1, 0xc2, 0xdf, 0xe0, 0xe1, 0xec, 0xed, 0xee, 0xef, 0xf0, 0xf1, 0xf4, 0xf5, 0xff},
        {0x41, 0x80, 0x8f, 0x90, 0xbf, 0xc3, 0xe0, 0xed, 0xf0, 0xf1, 0xf4, 0xf5, 0xf8, 0xff},
        {0x41, 0x80, 0xbf, 0xe2, 0xf0, 0xf4, 0x90},
        {0x41, 0x80, 0xbf, 0xe2, 0xf0, 0x90},
      };
      List<String> fams = new ArrayList<>();
      for (int len = 1; len <= 6; len++) {
        int[] al = alphabets[len - 1];
        int base = al == null ? 256 : al.length;
        if (len == 2) base = 256;
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        long total = 1;
        for (int i = 0; i < len; i++) total *= base;
        byte[] buf = new byte[len];
        for (long n = 0; n < total; n++) {
          long x = n;
          for (int i = len - 1; i >= 0; i--) {
            int d = (int) (x % base);
            x /= base;
            buf[i] = (byte) (al == null || len == 2 ? d : al[d]);
          }
          String str = new String(buf, StandardCharsets.UTF_8);
          md.update((byte) (str.length() >> 8));
          md.update((byte) str.length());
          for (int i = 0; i < str.length(); i++) {
            md.update((byte) (str.charAt(i) >> 8));
            md.update((byte) str.charAt(i));
          }
        }
        fams.add("{\"len\":" + len + ",\"alphabet\":" + (al == null || len == 2 ? "null" : Arrays.toString(al))
            + ",\"count\":" + total + ",\"sha256\":\"" + hex(md.digest()) + "\"}");
      }
      int[] lead = {0x41, 0x7f, 0x80, 0xbf, 0xc0, 0xc2, 0xdf, 0xe0, 0xe2, 0xed, 0xef, 0xf0, 0xf4, 0xf5, 0xff};
      List<String> rnd = new ArrayList<>();
      for (int i = 0; i < 600; i++) {
        byte[] b = new byte[r.nextInt(17)];
        for (int j = 0; j < b.length; j++) b[j] = (byte) (r.nextInt(3) == 0 ? r.nextInt(256) : lead[r.nextInt(lead.length)] + (r.nextInt(4) == 0 ? r.nextInt(3) : 0));
        rnd.add("[\"" + hex(b) + "\"," + js(new String(b, StandardCharsets.UTF_8)) + "]");
      }
      section("utf8", "{\"exhaustive\":" + list(fams, x -> x) + ",\"random\":" + list(rnd, x -> x) + "}");
    }

    sb.append("\n}\n");
    System.out.print(sb);
  }

  static String mapJson(DataInput in, boolean ofStrings, boolean legacy) {
    try {
      Map<String, String> m = ofStrings ? in.readMapOfStrings() : in.readStringStringMap();
      return list(new ArrayList<>(m.entrySet()), e -> "[" + js(e.getKey()) + "," + js(e.getValue()) + "]");
    } catch (Throwable t) {
      return ex(t);
    }
  }

  static String setJson(DataInput in, boolean ofStrings) {
    try {
      Set<String> s = ofStrings ? in.readSetOfStrings() : in.readStringSet();
      return list(new ArrayList<>(s), GoldenStore::js);
    } catch (Throwable t) {
      return ex(t);
    }
  }

  static String mapCase(LinkedHashMap<String, String> m) throws IOException {
    // writes (in the map's insertion order, which the TypeScript test replays)
    ByteArrayOutputStream b1 = new ByteArrayOutputStream();
    new OutputStreamDataOutput(b1).writeStringStringMap(m);
    ByteArrayOutputStream b2 = new ByteArrayOutputStream();
    new OutputStreamDataOutput(b2).writeMapOfStrings(m);
    LinkedHashSet<String> keys = new LinkedHashSet<>(m.keySet());
    ByteArrayOutputStream b3 = new ByteArrayOutputStream();
    new OutputStreamDataOutput(b3).writeStringSet(keys);
    ByteArrayOutputStream b4 = new ByteArrayOutputStream();
    new OutputStreamDataOutput(b4).writeSetOfStrings(keys);
    return "{\"entries\":" + list(new ArrayList<>(m.entrySet()), e -> "[" + js(e.getKey()) + "," + js(e.getValue()) + "]")
        + ",\"stringStringMapHex\":\"" + hex(b1.toByteArray()) + "\""
        + ",\"mapOfStringsHex\":\"" + hex(b2.toByteArray()) + "\""
        + ",\"stringSetHex\":\"" + hex(b3.toByteArray()) + "\""
        + ",\"setOfStringsHex\":\"" + hex(b4.toByteArray()) + "\""
        + ",\"readStringStringMap\":" + mapJson(new ByteArrayDataInput(b1.toByteArray()), false, true)
        + ",\"readMapOfStrings\":" + mapJson(new ByteArrayDataInput(b2.toByteArray()), true, false)
        + ",\"readStringSet\":" + setJson(new ByteArrayDataInput(b3.toByteArray()), false)
        + ",\"readSetOfStrings\":" + setJson(new ByteArrayDataInput(b4.toByteArray()), true)
        + ",\"streamReadMapOfStrings\":" + mapJson(new InputStreamDataInput(new ByteArrayInputStream(b2.toByteArray())), true, false)
        + "}";
  }
}
