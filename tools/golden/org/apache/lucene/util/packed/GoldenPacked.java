package org.apache.lucene.util.packed;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Random;
import java.util.zip.CRC32;

import org.apache.lucene.store.ByteArrayDataOutput;
import org.apache.lucene.store.DataInput;
import org.apache.lucene.store.IOContext;
import org.apache.lucene.store.IndexInput;
import org.apache.lucene.store.IndexOutput;
import org.apache.lucene.store.RAMDirectory;
import org.apache.lucene.util.LongsRef;

/**
 * Generates test/golden/packed.json from the ORIGINAL Lucene 5.2.1 util.packed classes (BulkOperation* incl. the unrolled
 * generated ones, PackedInts and its Format/Reader/Mutable/Writer/ReaderIterator, Direct8..64, Packed64, Packed64SingleBlock,
 * Packed8/16ThreeBlocks, DirectPackedReader, DirectPacked64SingleBlockReader, PackedDataInput/Output).
 * Every section is a list of cases {"c": config, "ops": [...], "out": [...]}; the TypeScript test replays config and ops.
 * Assertions are enabled when running (like Lucene's tests).
 */
public class GoldenPacked {
  static final Random r = new Random(5217);
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

  static String ex(Throwable t) {
    if (t instanceof ArrayIndexOutOfBoundsException || t instanceof NullPointerException) return "EX:" + t.getClass().getSimpleName();
    return "EX:" + t.getClass().getSimpleName() + ":" + t.getMessage();
  }

  static String dig(String s) {
    if (s.length() <= 300) return s;
    CRC32 c = new CRC32();
    byte[] b = s.getBytes(java.nio.charset.StandardCharsets.UTF_8);
    c.update(b, 0, b.length);
    return "d" + s.length() + ":" + Long.toHexString(c.getValue());
  }

  static String hexs(long[] a, int off, int len) {
    StringBuilder s = new StringBuilder();
    for (int i = off; i < off + len; i++) s.append(Long.toHexString(a[i])).append(' ');
    return dig(s.toString());
  }

  static String hexs(int[] a, int off, int len) {
    StringBuilder s = new StringBuilder();
    for (int i = off; i < off + len; i++) s.append(Integer.toHexString(a[i])).append(' ');
    return dig(s.toString());
  }

  static String hexs(byte[] a, int off, int len) {
    StringBuilder s = new StringBuilder();
    for (int i = off; i < off + len; i++) s.append(String.format("%02x", a[i] & 0xff));
    return dig(s.toString());
  }

  static long[] parseLongs(String s) {
    if (s.isEmpty()) return new long[0];
    String[] p = s.split(",");
    long[] a = new long[p.length];
    for (int i = 0; i < a.length; i++) a[i] = Long.parseUnsignedLong(p[i], 16);
    return a;
  }

  static int[] parseInts(String s) {
    if (s.isEmpty()) return new int[0];
    String[] p = s.split(",");
    int[] a = new int[p.length];
    for (int i = 0; i < a.length; i++) a[i] = (int) Long.parseUnsignedLong(p[i], 16);
    return a;
  }

  static byte[] parseBytes(String s) {
    byte[] b = new byte[s.length() / 2];
    for (int i = 0; i < b.length; i++) b[i] = (byte) Integer.parseInt(s.substring(2 * i, 2 * i + 2), 16);
    return b;
  }

  static String joinHex(long[] a) {
    StringBuilder s = new StringBuilder();
    for (int i = 0; i < a.length; i++) {
      if (i > 0) s.append(',');
      s.append(Long.toHexString(a[i]));
    }
    return s.toString();
  }

  static String joinHex(int[] a) {
    StringBuilder s = new StringBuilder();
    for (int i = 0; i < a.length; i++) {
      if (i > 0) s.append(',');
      s.append(Integer.toHexString(a[i]));
    }
    return s.toString();
  }

  static String bytesHex(byte[] a) {
    StringBuilder s = new StringBuilder();
    for (byte b : a) s.append(String.format("%02x", b & 0xff));
    return s.toString();
  }

  static long randBits(int bpv) {
    long v = r.nextLong();
    int mode = r.nextInt(6);
    if (mode == 0) v = 0;
    else if (mode == 1) v = -1L;
    else if (mode == 2) v = v >>> r.nextInt(64);
    return bpv == 64 ? v : v & PackedInts.maxValue(bpv);
  }

  static long[] randLongs(int n, int bpv) {
    long[] a = new long[n];
    for (int i = 0; i < n; i++) a[i] = randBits(bpv);
    return a;
  }

  static final float[] RATIOS = {-1f, 0f, 0.05f, 0.1f, 0.2f, 0.25f, 0.33333334f, 0.5f, 0.7f, 1f, 2f, 7f, 8f, 100f};

  // ---------------------------------------------------------------- formats
  static void formats() {
    begin("formats");
    int[] vcs = {0, 1, 7, 63, 64, 65, 100, 1000, 123457, 100000000};
    for (PackedInts.Format f : PackedInts.Format.values()) {
      for (int bpv = 1; bpv <= 64; bpv++) {
        List<String> ops = new ArrayList<>(), out = new ArrayList<>();
        ops.add("sup");
        out.add(f.isSupported(bpv) + "");
        ops.add("id");
        out.add(f.getId() + " " + f.name() + " " + f);
        if (f.isSupported(bpv)) {
          ops.add("ovh");
          out.add(f.overheadPerValue(bpv) + " " + f.overheadRatio(bpv));
        }
        for (int ver = 0; ver <= 2; ver++) {
          for (int vc : vcs) {
            String op = "cnt " + ver + " " + vc;
            ops.add(op);
            try {
              out.add(f.byteCount(ver, vc, bpv) + " " + f.longCount(ver, vc, bpv));
            } catch (Throwable t) {
              out.add(ex(t));
            }
          }
        }
        cs(f.name() + " " + bpv, ops, out);
      }
    }
    List<String> ops = new ArrayList<>(), out = new ArrayList<>();
    for (int id = -1; id <= 3; id++) {
      ops.add("byId " + id);
      try {
        out.add(PackedInts.Format.byId(id).name());
      } catch (Throwable t) {
        out.add(ex(t));
      }
    }
    for (int v = -2; v <= 4; v++) {
      ops.add("ver " + v);
      try {
        PackedInts.checkVersion(v);
        out.add("ok");
      } catch (Throwable t) {
        out.add(ex(t));
      }
    }
    for (long m : new long[] {0, 1, 2, 3, 255, 256, 65535, 1L << 40, Long.MAX_VALUE, -1L, Long.MIN_VALUE}) {
      ops.add("req " + Long.toHexString(m));
      String o;
      try {
        o = PackedInts.bitsRequired(m) + "";
      } catch (Throwable t) {
        o = ex(t);
      }
      out.add(o + " " + PackedInts.unsignedBitsRequired(m));
    }
    for (int b = 1; b <= 64; b++) {
      ops.add("max " + b);
      out.add(Long.toHexString(PackedInts.maxValue(b)));
    }
    for (int bs : new int[] {0, 1, 2, 3, 4, 63, 64, 1 << 10, 1 << 20, 1 << 21, 1 << 30}) {
      ops.add("cbs " + bs);
      try {
        out.add(PackedInts.checkBlockSize(bs, 64, 1 << 20) + "");
      } catch (Throwable t) {
        out.add(ex(t));
      }
    }
    for (long size : new long[] {0, 1, 100, 1 << 20, (1L << 31) - 1, 1L << 31, 1L << 40}) {
      for (int bs : new int[] {1, 64, 1024}) {
        ops.add("nb " + size + " " + bs);
        try {
          out.add(PackedInts.numBlocks(size, bs) + "");
        } catch (Throwable t) {
          out.add(ex(t));
        }
      }
    }
    cs("misc", ops, out);
    for (int vc : new int[] {-1, 0, 1, 100, 1000, 100000, Integer.MAX_VALUE / 3, Integer.MAX_VALUE / 3 + 1, 1 << 30}) {
      ops = new ArrayList<>();
      out = new ArrayList<>();
      for (int bpv = 1; bpv <= 64; bpv++) {
        for (float ratio : RATIOS) {
          ops.add("fast " + bpv + " " + ratio);
          out.add(PackedInts.fastestFormatAndBits(vc, bpv, ratio).toString());
        }
      }
      cs("fast " + vc, ops, out);
    }
    end();
  }

  // ---------------------------------------------------------------- bulk operations
  static void bulk() {
    begin("bulk");
    for (PackedInts.Format f : PackedInts.Format.values()) {
      for (int bpv = 1; bpv <= 64; bpv++) {
        if (!f.isSupported(bpv)) continue;
        BulkOperation op = BulkOperation.of(f, bpv);
        List<String> ops = new ArrayList<>(), out = new ArrayList<>();
        ops.add("props");
        out.add(op.longBlockCount() + " " + op.longValueCount() + " " + op.byteBlockCount() + " " + op.byteValueCount());
        for (int vc : new int[] {0, 1, 10, 100, 5000}) {
          for (int ram : new int[] {0, 1, 100, 1024, 100000}) {
            ops.add("it " + vc + " " + ram);
            out.add(op.computeIterations(vc, ram) + "");
          }
        }
        for (int rep = 0; rep < 6; rep++) {
          int it = 1 + r.nextInt(4);
          // values -> long blocks / byte blocks
          long[] vals = randLongs(it * op.longValueCount(), bpv);
          ops.add("encLL " + it + " " + joinHex(vals));
          long[] blocks = new long[it * op.longBlockCount()];
          try {
            op.encode(vals, 0, blocks, 0, it);
            out.add(joinHex(blocks));
          } catch (Throwable t) {
            out.add(ex(t));
          }
          // decode the long blocks again, into long[] and int[]
          ops.add("decLL " + it + " " + joinHex(blocks));
          long[] back = new long[it * op.longValueCount()];
          op.decode(blocks, 0, back, 0, it);
          out.add(joinHex(back));
          ops.add("decLI " + it + " " + joinHex(blocks));
          int[] backi = new int[it * op.longValueCount()];
          try {
            op.decode(blocks, 0, backi, 0, it);
            out.add(joinHex(backi));
          } catch (Throwable t) {
            out.add(ex(t));
          }
          // byte encoding
          int bit = 1 + r.nextInt(4);
          long[] bvals = randLongs(bit * op.byteValueCount(), bpv);
          ops.add("encLB " + bit + " " + joinHex(bvals));
          byte[] bblocks = new byte[bit * op.byteBlockCount()];
          try {
            op.encode(bvals, 0, bblocks, 0, bit);
            out.add(bytesHex(bblocks));
          } catch (Throwable t) {
            out.add(ex(t));
          }
          ops.add("decBL " + bit + " " + bytesHex(bblocks));
          long[] bback = new long[bit * op.byteValueCount()];
          op.decode(bblocks, 0, bback, 0, bit);
          out.add(joinHex(bback));
          ops.add("decBI " + bit + " " + bytesHex(bblocks));
          int[] bbacki = new int[bit * op.byteValueCount()];
          try {
            op.decode(bblocks, 0, bbacki, 0, bit);
            out.add(joinHex(bbacki));
          } catch (Throwable t) {
            out.add(ex(t));
          }
          if (bpv <= 32) {
            int[] ivals = new int[it * op.longValueCount()];
            for (int i = 0; i < ivals.length; i++) ivals[i] = (int) randBits(bpv);
            ops.add("encIL " + it + " " + joinHex(ivals));
            long[] iblocks = new long[it * op.longBlockCount()];
            op.encode(ivals, 0, iblocks, 0, it);
            out.add(joinHex(iblocks));
            int[] ivals2 = new int[bit * op.byteValueCount()];
            for (int i = 0; i < ivals2.length; i++) ivals2[i] = (int) randBits(bpv);
            ops.add("encIB " + bit + " " + joinHex(ivals2));
            byte[] ib = new byte[bit * op.byteBlockCount()];
            op.encode(ivals2, 0, ib, 0, bit);
            out.add(bytesHex(ib));
          }
          // decode arbitrary (random) blocks
          long[] rb = new long[it * op.longBlockCount()];
          for (int i = 0; i < rb.length; i++) rb[i] = r.nextLong();
          ops.add("decLL " + it + " " + joinHex(rb));
          long[] rv = new long[it * op.longValueCount()];
          op.decode(rb, 0, rv, 0, it);
          out.add(joinHex(rv));
          byte[] rbb = new byte[bit * op.byteBlockCount()];
          r.nextBytes(rbb);
          ops.add("decBL " + bit + " " + bytesHex(rbb));
          long[] rbv = new long[bit * op.byteValueCount()];
          op.decode(rbb, 0, rbv, 0, bit);
          out.add(joinHex(rbv));
          ops.add("decBI " + bit + " " + bytesHex(rbb));
          try {
            int[] rbi = new int[bit * op.byteValueCount()];
            op.decode(rbb, 0, rbi, 0, bit);
            out.add(joinHex(rbi));
          } catch (Throwable t) {
            out.add(ex(t));
          }
        }
        // value too large for the byte encoder
        if (bpv < 64) {
          long[] bad = new long[op.byteValueCount()];
          bad[bad.length - 1] = 1L << bpv;
          ops.add("encLB 1 " + joinHex(bad));
          try {
            byte[] bb = new byte[op.byteBlockCount()];
            op.encode(bad, 0, bb, 0, 1);
            out.add(bytesHex(bb));
          } catch (Throwable t) {
            out.add(ex(t));
          }
        }
        cs(f.name() + " " + bpv, ops, out);
      }
    }
    end();
  }

  // ---------------------------------------------------------------- mutables
  static PackedInts.Mutable mk(String cfg) {
    String[] p = cfg.split(" ");
    int n = Integer.parseInt(p[0]);
    int bpv = Integer.parseInt(p[1]);
    String kind = p[2];
    if (kind.equals("ratio")) return PackedInts.getMutable(n, bpv, Float.parseFloat(p[3]));
    if (kind.equals("format")) return PackedInts.getMutable(n, bpv, PackedInts.Format.valueOf(p[3]));
    if (kind.equals("p64")) return new Packed64(n, bpv);
    throw new IllegalArgumentException(cfg);
  }

  static String ramOf(PackedInts.Reader m) {
    return m.ramBytesUsed() + "";
  }

  static String run(PackedInts.Mutable m, String op) {
    String[] p = op.split(" ");
    try {
      switch (p[0]) {
        case "set":
          m.set(Integer.parseInt(p[1]), Long.parseUnsignedLong(p[2], 16));
          return "ok";
        case "get":
          return Long.toHexString(m.get(Integer.parseInt(p[1])));
        case "fill":
          m.fill(Integer.parseInt(p[1]), Integer.parseInt(p[2]), Long.parseUnsignedLong(p[3], 16));
          return "ok";
        case "clear":
          m.clear();
          return "ok";
        case "all": {
          long[] a = new long[m.size()];
          for (int i = 0; i < a.length; i++) a[i] = m.get(i);
          return hexs(a, 0, a.length);
        }
        case "setb": { // setb index off len v,v,...  (arr = off zeros + values)
          int off = Integer.parseInt(p[2]);
          int len = Integer.parseInt(p[3]);
          long[] vals = parseLongs(p.length > 4 ? p[4] : "");
          long[] arr = new long[off + vals.length];
          System.arraycopy(vals, 0, arr, off, vals.length);
          return m.set(Integer.parseInt(p[1]), arr, off, len) + "";
        }
        case "getb": { // getb index off len arrlen
          long[] arr = new long[Integer.parseInt(p[4])];
          Arrays.fill(arr, 0x5a5aL);
          int ret = m.get(Integer.parseInt(p[1]), arr, Integer.parseInt(p[2]), Integer.parseInt(p[3]));
          return ret + " " + hexs(arr, 0, arr.length);
        }
        case "str":
          return m.toString();
        case "ram":
          return ramOf(m);
        case "bpv":
          return m.getBitsPerValue() + " " + m.size();
        case "fmt":
          return m.getFormat().name();
        case "save": {
          RAMDirectory d = new RAMDirectory();
          IndexOutput o = d.createOutput("x", IOContext.DEFAULT);
          m.save(o);
          o.close();
          IndexInput in = d.openInput("x", IOContext.DEFAULT);
          byte[] b = new byte[(int) in.length()];
          in.readBytes(b, 0, b.length);
          in.close();
          d.close();
          return b.length + " " + hexs(b, 0, b.length);
        }
        default:
          throw new IllegalArgumentException(op);
      }
    } catch (Throwable t) {
      return ex(t);
    }
  }

  static void mutables() {
    begin("mutable");
    List<String> cfgs = new ArrayList<>();
    for (int bpv = 1; bpv <= 64; bpv++) {
      for (float ratio : new float[] {0f, 0.25f, 0.5f, 7f}) cfgs.add((1 + r.nextInt(300)) + " " + bpv + " ratio " + ratio);
      cfgs.add((1 + r.nextInt(300)) + " " + bpv + " format PACKED");
      if (PackedInts.Format.PACKED_SINGLE_BLOCK.isSupported(bpv)) cfgs.add((1 + r.nextInt(300)) + " " + bpv + " format PACKED_SINGLE_BLOCK");
      cfgs.add((1 + r.nextInt(300)) + " " + bpv + " p64");
    }
    cfgs.add("1 1 p64");
    cfgs.add("64 8 p64");
    cfgs.add("1000 5 p64");
    for (String cfg : cfgs) {
      int n = Integer.parseInt(cfg.split(" ")[0]);
      int bpv = Integer.parseInt(cfg.split(" ")[1]);
      PackedInts.Mutable m = mk(cfg);
      List<String> ops = new ArrayList<>(), out = new ArrayList<>();
      List<String> script = new ArrayList<>();
      script.add("str");
      script.add("bpv");
      script.add("fmt");
      script.add("ram");
      for (int i = 0; i < 20; i++) script.add("get " + r.nextInt(n));
      for (int i = 0; i < n; i++) {
        if (r.nextInt(4) != 0) script.add("set " + i + " " + Long.toHexString(randBits(bpv)));
      }
      script.add("all");
      for (int i = 0; i < 25; i++) script.add("get " + r.nextInt(n));
      for (int i = 0; i < 12; i++) {
        int idx = r.nextInt(n);
        int off = r.nextInt(5);
        int len = 1 + r.nextInt(2 * 64 + 3);
        script.add("getb " + idx + " " + off + " " + len + " " + (off + len + r.nextInt(3)));
        int nv = len + r.nextInt(3);
        long[] vals = randLongs(nv, bpv);
        script.add("setb " + r.nextInt(n) + " " + off + " " + len + " " + joinHex(vals));
        script.add("all");
      }
      script.add("getb 0 0 0 5");
      script.add("setb 0 0 0 1");
      for (int i = 0; i < 8; i++) {
        int a = r.nextInt(n + 1), b = r.nextInt(n + 1);
        int from = Math.min(a, b), to = Math.max(a, b);
        long v = randBits(bpv);
        script.add("fill " + from + " " + to + " " + Long.toHexString(v));
        script.add("all");
      }
      // a large fill exercising the block paths
      if (n > 200) {
        script.add("fill 3 " + (n - 2) + " " + Long.toHexString(randBits(bpv)));
        script.add("all");
      }
      script.add("fill 0 " + n + " " + Long.toHexString(randBits(bpv)));
      script.add("all");
      script.add("save");
      script.add("clear");
      script.add("all");
      script.add("ram");
      script.add("str");
      for (String op : script) {
        ops.add(op);
        out.add(run(m, op));
      }
      cs(cfg, ops, out);
    }
    end();
  }

  // ---------------------------------------------------------------- streams (writer, reader, iterator, direct reader)
  static byte[] readAll(RAMDirectory d, String name) throws Exception {
    IndexInput in = d.openInput(name, IOContext.DEFAULT);
    byte[] b = new byte[(int) in.length()];
    in.readBytes(b, 0, b.length);
    in.close();
    return b;
  }

  static void streams() throws Exception {
    begin("stream");
    for (int rep = 0; rep < 400; rep++) {
      int bpv = rep < 64 ? rep + 1 : 1 + r.nextInt(64);
      int[] vcs = {0, 1, 2, 3, 7, 8, 9, 31, 33, 63, 64, 65, 127, 129, 500, 1100, 4000};
      int n = rep < 17 ? vcs[rep] : vcs[r.nextInt(vcs.length)] + r.nextInt(3);
      float ratio = RATIOS[r.nextInt(RATIOS.length)];
      if (n == 0 && rep % 2 == 0) n = 1 + r.nextInt(100);
      List<String> ops = new ArrayList<>(), out = new ArrayList<>();
      long[] vals = randLongs(n, bpv);
      RAMDirectory d = new RAMDirectory();
      IndexOutput o = d.createOutput("x", IOContext.DEFAULT);
      PackedInts.Writer w = PackedInts.getWriter(o, n, bpv, ratio);
      ops.add("write " + ratio + " " + joinHex(vals));
      for (long v : vals) w.add(v);
      String wo = w.bitsPerValue() + " " + w.ord();
      try {
        w.add(0L);
        wo += " added";
      } catch (Throwable t) {
        wo += " " + ex(t);
      }
      w.finish();
      o.close();
      byte[] bytes = readAll(d, "x");
      out.add(wo + " " + bytes.length + " " + hexs(bytes, 0, bytes.length));

      // reader
      ops.add("read");
      IndexInput in = d.openInput("x", IOContext.DEFAULT);
      PackedInts.Reader rd = PackedInts.getReader(in);
      long[] got = new long[n];
      for (int i = 0; i < n; i++) got[i] = rd.get(i);
      out.add(rd.toString().replaceAll("@.*", "") + " " + rd.size() + " " + in.getFilePointer() + " " + rd.ramBytesUsed() + " " + hexs(got, 0, n));
      // bulk gets
      for (int k = 0; k < 4 && n > 0; k++) {
        int idx = r.nextInt(n), len = 1 + r.nextInt(150), off = r.nextInt(3);
        long[] arr = new long[off + len];
        ops.add("rbulk " + idx + " " + off + " " + len);
        int ret = rd.get(idx, arr, off, len);
        out.add(ret + " " + hexs(arr, 0, arr.length));
      }
      in.close();

      // iterator
      for (int mem : new int[] {0, 1, 100, 1024, 100000}) {
        ops.add("iter " + mem);
        in = d.openInput("x", IOContext.DEFAULT);
        try {
          PackedInts.ReaderIterator it = PackedInts.getReaderIterator(in, mem);
          StringBuilder s = new StringBuilder(it.getBitsPerValue() + " " + it.size() + " ");
          long[] g2 = new long[n];
          int pos = 0;
          boolean single = true;
          while (pos < n) {
            if (single) {
              g2[pos++] = it.next();
            } else {
              LongsRef ref = it.next(1 + (pos * 7) % 70);
              for (int i = 0; i < ref.length; i++) g2[pos++] = ref.longs[ref.offset + i];
            }
            single = pos % 3 == 0;
            s.append(it.ord()).append(',');
          }
          try {
            it.next();
            s.append("no-eof");
          } catch (Throwable t) {
            s.append(ex(t));
          }
          out.add(dig(s.toString()) + " " + hexs(g2, 0, n));
        } catch (Throwable t) {
          out.add(ex(t));
        }
        in.close();
      }

      // direct reader
      ops.add("direct");
      in = d.openInput("x", IOContext.DEFAULT);
      PackedInts.Reader dr = PackedInts.getDirectReader(in);
      long[] g3 = new long[n];
      for (int i = 0; i < n; i++) g3[i] = dr.get(n - 1 - i);
      for (int i = 0; i < n / 2; i++) {
        long t = g3[i];
        g3[i] = g3[n - 1 - i];
        g3[n - 1 - i] = t;
      }
      out.add(dr.size() + " " + dr.ramBytesUsed() + " " + hexs(g3, 0, n));
      in.close();

      // "old" versions: pad the stream (written with the current version) to the long-aligned size of version 0 and read
      // with that version: readers must consume the padding.
      PackedInts.FormatAndBits fb = PackedInts.fastestFormatAndBits(n, bpv, ratio);
      PackedInts.Format f = fb.format;
      int ebpv = fb.bitsPerValue;
      for (int ver = 0; ver <= 2; ver++) {
        ops.add("nohdr " + ver + " " + f.name() + " " + ebpv + " " + n);
        try {
          // write the raw values with getWriterNoHeader
          RAMDirectory d2 = new RAMDirectory();
          IndexOutput o2 = d2.createOutput("y", IOContext.DEFAULT);
          PackedInts.Writer w2 = PackedInts.getWriterNoHeader(o2, f, n, ebpv, 1 + r.nextInt(2000));
          long[] v2 = new long[n];
          for (int i = 0; i < n; i++) {
            v2[i] = vals[i] & (ebpv == 64 ? -1L : PackedInts.maxValue(ebpv));
            w2.add(v2[i]);
          }
          w2.finish();
          long want = f.byteCount(PackedInts.VERSION_CURRENT, n, ebpv);
          long padded = f.byteCount(ver, n, ebpv);
          for (long i = want; i < padded; i++) o2.writeByte((byte) 0);
          o2.writeInt(0x12345678);
          o2.close();
          byte[] b2 = readAll(d2, "y");
          IndexInput i2 = d2.openInput("y", IOContext.DEFAULT);
          PackedInts.Reader r2 = PackedInts.getReaderNoHeader(i2, f, ver, n, ebpv);
          long[] g4 = new long[n];
          for (int i = 0; i < n; i++) g4[i] = r2.get(i);
          String s = r2.toString().replaceAll("@.*", "") + " fp=" + i2.getFilePointer() + " " + hexs(g4, 0, n) + " " + hexs(b2, 0, b2.length);
          i2.close();
          // iterator over the same data
          i2 = d2.openInput("y", IOContext.DEFAULT);
          PackedInts.ReaderIterator it2 = PackedInts.getReaderIteratorNoHeader(i2, f, ver, n, ebpv, 64 + r.nextInt(600));
          long[] g5 = new long[n];
          for (int i = 0; i < n; i++) g5[i] = it2.next();
          s += " it:" + hexs(g5, 0, n) + " fp=" + i2.getFilePointer();
          i2.close();
          // direct reader
          i2 = d2.openInput("y", IOContext.DEFAULT);
          PackedInts.Reader dr2 = PackedInts.getDirectReaderNoHeader(i2, f, ver, n, ebpv);
          long[] g6 = new long[n];
          for (int i = 0; i < n; i++) g6[i] = dr2.get(i);
          s += " dr:" + hexs(g6, 0, n) + " fp=" + i2.getFilePointer();
          i2.close();
          d2.close();
          out.add(s);
        } catch (Throwable t) {
          out.add(ex(t));
        }
      }
      d.close();
      cs(n + " " + bpv + " " + ratio, ops, out);
    }
    // corrupted headers
    {
      List<String> ops = new ArrayList<>(), out = new ArrayList<>();
      RAMDirectory d = new RAMDirectory();
      IndexOutput o = d.createOutput("x", IOContext.DEFAULT);
      PackedInts.Writer w = PackedInts.getWriter(o, 10, 5, 0f);
      for (int i = 0; i < 10; i++) w.add(i);
      w.finish();
      o.close();
      byte[] good = readAll(d, "x");
      for (int pos = 0; pos < 26; pos++) {
        byte[] bad = good.clone();
        bad[pos] ^= (byte) (1 + r.nextInt(255));
        ops.add("bad " + bytesHex(bad));
        try {
          org.apache.lucene.store.ByteArrayDataInput in = new org.apache.lucene.store.ByteArrayDataInput(bad);
          PackedInts.Reader rd = PackedInts.getReader(in);
          out.add(rd.toString().replaceAll("@.*", "") + " " + rd.get(0));
        } catch (Throwable t) {
          out.add(ex(t).replaceAll("\\(resource[= ][^)]*\\)", "(resource R)"));
        }
      }
      cs("corrupt", ops, out);
    }
    end();
  }

  // ---------------------------------------------------------------- PackedDataInput/Output
  static void dataIO() throws Exception {
    begin("dataio");
    for (int rep = 0; rep < 60; rep++) {
      List<String> ops = new ArrayList<>(), out = new ArrayList<>();
      byte[] buf = new byte[4096];
      ByteArrayDataOutput bo = new ByteArrayDataOutput(buf);
      PackedDataOutput po = new PackedDataOutput(bo);
      int cnt = 1 + r.nextInt(40);
      List<int[]> written = new ArrayList<>();
      List<Long> vals = new ArrayList<>();
      for (int i = 0; i < cnt; i++) {
        int bpv = 1 + r.nextInt(64);
        long v = bpv == 64 ? r.nextLong() : randBits(bpv);
        if (bpv == 64 && v < 0 && r.nextBoolean()) v = -v - 1 >= 0 ? v : v; // keep arbitrary 64-bit values
        ops.add("wl " + bpv + " " + Long.toHexString(v));
        try {
          po.writeLong(v, bpv);
          out.add("ok");
        } catch (Throwable t) {
          out.add(ex(t));
        }
        written.add(new int[] {bpv});
        vals.add(v);
      }
      ops.add("flush");
      po.flush();
      out.add(bo.getPosition() + "");
      byte[] data = Arrays.copyOf(buf, bo.getPosition());
      ops.add("bytes");
      out.add(bytesHex(data));
      org.apache.lucene.store.ByteArrayDataInput bi = new org.apache.lucene.store.ByteArrayDataInput(data);
      PackedDataInput pi = new PackedDataInput(bi);
      for (int i = 0; i < cnt; i++) {
        ops.add("rl " + written.get(i)[0]);
        out.add(Long.toHexString(pi.readLong(written.get(i)[0])));
        if (r.nextInt(7) == 0) {
          ops.add("skip");
          pi.skipToNextByte();
          out.add("ok");
          // after skipping, the writer-side stream and the reader no longer agree: stop here
          break;
        }
      }
      ops.add("pos");
      out.add(bi.getPosition() + "");
      cs("dataio", ops, out);
    }
    end();
  }

  // ---------------------------------------------------------------- PackedInts.copy
  static void copies() {
    begin("copy");
    for (int rep = 0; rep < 150; rep++) {
      int bpv = 1 + r.nextInt(64);
      int sn = 1 + r.nextInt(400);
      int dn = 1 + r.nextInt(400);
      float rs = RATIOS[r.nextInt(RATIOS.length)], rd = RATIOS[r.nextInt(RATIOS.length)];
      PackedInts.Mutable src = PackedInts.getMutable(sn, bpv, rs);
      PackedInts.Mutable dst = PackedInts.getMutable(dn, bpv, rd);
      long[] sv = randLongs(sn, bpv), dv = randLongs(dn, bpv);
      for (int i = 0; i < sn; i++) src.set(i, sv[i]);
      for (int i = 0; i < dn; i++) dst.set(i, dv[i]);
      int len = r.nextInt(Math.min(sn, dn) + 1);
      int sp = r.nextInt(sn - len + 1), dp = r.nextInt(dn - len + 1);
      int mem = new int[] {0, 7, 8, 16, 64, 800, 100000}[r.nextInt(7)];
      List<String> ops = new ArrayList<>(), out = new ArrayList<>();
      ops.add("copy " + sp + " " + dp + " " + len + " " + mem);
      PackedInts.copy(src, sp, dst, dp, len, mem);
      long[] res = new long[dn];
      for (int i = 0; i < dn; i++) res[i] = dst.get(i);
      out.add(hexs(res, 0, dn));
      cs(sn + " " + dn + " " + bpv + " " + src.getClass().getSimpleName() + " " + dst.getClass().getSimpleName() + " " + rs + " " + rd + " " + joinHex(sv) + " " + joinHex(dv), ops, out);
    }
    end();
  }

  public static void main(String[] args) throws Exception {
    sb.append("{\n");
    formats();
    bulk();
    mutables();
    streams();
    dataIO();
    copies();
    sb.append("\n}\n");
    System.out.print(sb);
  }
}
