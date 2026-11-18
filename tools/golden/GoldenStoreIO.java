import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.util.*;
import java.util.zip.CRC32;
import java.util.zip.Checksum;
import org.apache.lucene.store.*;

/**
 * Generates test/golden/store-io.json from the original Lucene 5.2.1 classes BufferedIndexInput (+ its
 * SlicedIndexInput), ChecksumIndexInput, BufferedChecksumIndexInput, BufferedChecksum, CRC32, IOContext,
 * FlushInfo and MergeInfo. Same JSON conventions as GoldenStore.java.
 *
 * BufferedIndexInput is checked on its exact observable behaviour: results of scripted operations AND the
 * sequence of readInternal/seekInternal calls that it makes on the subclass.
 */
public class GoldenStoreIO {
  static final Random r = new Random(20261119);
  static final StringBuilder sb = new StringBuilder();

  static String js(String s) { return GoldenStore.js(s); }
  static String hex(byte[] b) { return GoldenStore.hex(b); }

  static String ex(Throwable t) {
    String m = t.getMessage();
    return js("EX:" + t.getClass().getSimpleName() + ":" + (m == null ? "" : m));
  }

  interface Thrower { Object run() throws Exception; }

  static String res(Thrower f) {
    try {
      Object v = f.run();
      if (v == null) return "null";
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

  static void section(String name, String json) {
    if (sb.length() > 1) sb.append(",\n");
    sb.append(js(name)).append(':').append(json);
  }

  // ---- test subclasses ----------------------------------------------------------
  static class TestBII extends BufferedIndexInput {
    final byte[] data;
    long pos;
    final List<String> log;

    TestBII(String desc, byte[] data, int bufSize, List<String> log) {
      super(desc, bufSize);
      this.data = data;
      this.log = log;
    }

    @Override
    protected void readInternal(byte[] b, int off, int len) throws IOException {
      log.add("r" + off + ":" + len + "@" + pos);
      if (pos + len > data.length) throw new EOFException("read past EOF: " + this);
      System.arraycopy(data, (int) pos, b, off, len);
      pos += len;
    }

    @Override
    protected void seekInternal(long p) {
      log.add("s" + p);
      pos = p;
    }

    @Override
    public long length() { return data.length; }

    @Override
    public void close() { log.add("c"); }

    int flush(IndexOutput out, long n) throws IOException { return flushBuffer(out, n); }

    @Override
    public TestBII clone() { return (TestBII) super.clone(); }
  }

  static class TestOut extends IndexOutput {
    final ByteArrayOutputStream bos = new ByteArrayOutputStream();
    TestOut() { super("TestOut"); }
    @Override public void close() {}
    @Override public long getFilePointer() { return bos.size(); }
    @Override public long getChecksum() { return 0; }
    @Override public void writeByte(byte b) { bos.write(b); }
    @Override public void writeBytes(byte[] b, int off, int len) { bos.write(b, off, len); }
  }

  // ---- operations -------------------------------------------------------------
  static String q(String s) { return s == null ? "null" : js(s); }

  static List<Object[]> randomOps(int fileLen, int n) {
    List<Object[]> ops = new ArrayList<>();
    for (int i = 0; i < n; i++) {
      int k = r.nextInt(38);
      long pos = r.nextInt(12) == 0 ? r.nextInt(fileLen + 20) : r.nextInt(Math.max(1, fileLen - 9));
      if (k < 4) ops.add(new Object[] {"byte"});
      else if (k < 6) ops.add(new Object[] {"short"});
      else if (k < 8) ops.add(new Object[] {"int"});
      else if (k < 10) ops.add(new Object[] {"long"});
      else if (k < 12) ops.add(new Object[] {"vint"});
      else if (k < 13) ops.add(new Object[] {"vlong"});
      else if (k < 16) ops.add(new Object[] {"bytes", r.nextInt(3) == 0 ? r.nextInt(300) : r.nextInt(25), r.nextInt(4) != 0});
      else if (k < 17) ops.add(new Object[] {"skip", r.nextInt(40)});
      else if (k < 20) ops.add(new Object[] {"seek", pos});
      else if (k < 21) ops.add(new Object[] {"abyte", pos});
      else if (k < 22) ops.add(new Object[] {"ashort", pos});
      else if (k < 23) ops.add(new Object[] {"aint", pos});
      else if (k < 24) ops.add(new Object[] {"along", pos});
      else if (k < 25) ops.add(new Object[] {"setbuf", new int[] {4, 8, 9, 16, 33, 100, 1024}[r.nextInt(7)]});
      else if (k < 26) ops.add(new Object[] {"clone"});
      else if (k < 27) {
        long off = r.nextInt(fileLen);
        long len = r.nextInt(8) == 0 ? r.nextInt(fileLen + 10) : r.nextInt((int) (fileLen - off) + 1);
        ops.add(new Object[] {"slice", r.nextBoolean() ? "sl" + i : null, off, len});
      }
      else if (k < 28) ops.add(new Object[] {"use", r.nextInt(5)});
      else if (k < 29) ops.add(new Object[] {"flush", r.nextInt(3) == 0 ? r.nextInt(2000) : r.nextInt(30)});
      else if (k < 30) ops.add(new Object[] {"fp"});
      else ops.add(new Object[] {"seek", pos});
    }
    return ops;
  }

  static String opJson(Object[] op) {
    StringBuilder s = new StringBuilder("[");
    for (int i = 0; i < op.length; i++) {
      if (i > 0) s.append(',');
      Object o = op[i];
      if (o instanceof String) s.append(js((String) o));
      else if (o == null) s.append("null");
      else s.append(o);
    }
    return s.append(']').toString();
  }

  static String runCase(byte[] data, int bufSize, List<Object[]> ops) {
    List<String> log = new ArrayList<>();
    TestBII main = new TestBII("main", data, bufSize, log);
    List<IndexInput> ins = new ArrayList<>();
    ins.add(main);
    final IndexInput[] cur = {main};
    List<String> results = new ArrayList<>();
    for (Object[] op : ops) {
      log.clear();
      String name = (String) op[0];
      final String[] extra = {null};
      String v = res(() -> {
        IndexInput in = cur[0];
        switch (name) {
          case "byte": return (long) (in.readByte() & 0xff);
          case "short": return (long) in.readShort();
          case "int": return (long) in.readInt();
          case "long": return in.readLong();
          case "vint": return (long) in.readVInt();
          case "vlong": return in.readVLong();
          case "bytes": {
            byte[] dst = new byte[(Integer) op[1]];
            Arrays.fill(dst, (byte) 0xaa);
            try {
              in.readBytes(dst, 0, dst.length, (Boolean) op[2]);
            } finally {
              extra[0] = hex(dst);
            }
            return "ok";
          }
          case "skip": in.skipBytes((Integer) op[1]); return "ok";
          case "seek": in.seek((Long) op[1]); return "ok";
          case "abyte": return (long) (((BufferedIndexInput) in).readByte((Long) op[1]) & 0xff);
          case "ashort": return (long) ((BufferedIndexInput) in).readShort((Long) op[1]);
          case "aint": return (long) ((BufferedIndexInput) in).readInt((Long) op[1]);
          case "along": return ((BufferedIndexInput) in).readLong((Long) op[1]);
          case "setbuf": ((BufferedIndexInput) in).setBufferSize((Integer) op[1]); return "ok";
          case "clone": { IndexInput c = in.clone(); ins.add(c); cur[0] = c; return "ok"; }
          case "slice": { IndexInput s = in.slice((String) op[1], (Long) op[2], (Long) op[3]); ins.add(s); cur[0] = s; return "ok:" + s; }
          case "use": cur[0] = ins.get(Math.min((Integer) op[1], ins.size() - 1)); return "ok";
          case "flush": {
            if (!(in instanceof TestBII)) return "n/a";
            TestOut out = new TestOut();
            int n = ((TestBII) in).flush(out, (Integer) op[1]);
            extra[0] = hex(out.bos.toByteArray());
            return (long) n;
          }
          case "fp": return in.getFilePointer();
          default: throw new AssertionError(name);
        }
      });
      long fp = cur[0].getFilePointer();
      results.add("{\"v\":" + v + ",\"fp\":" + fp + ",\"len\":" + cur[0].length() + ",\"log\":" + list(new ArrayList<>(log), GoldenStoreIO::q)
          + (extra[0] != null ? ",\"x\":\"" + extra[0] + "\"" : "") + "}");
    }
    return list(results, x -> x);
  }

  public static void main(String[] args) throws Exception {
    sb.append('{');

    // 1. BufferedIndexInput
    {
      List<String> cases = new ArrayList<>();
      int[] bufSizes = {8, 9, 16, 20, 64, 1024};
      for (int c = 0; c < 200; c++) {
        int fileLen = c % 12 == 0 ? 20 + r.nextInt(30) : 100 + r.nextInt(2000);
        byte[] data = new byte[fileLen];
        r.nextBytes(data);
        // make some multi-byte vints/vlongs likely
        if (c % 3 == 0) for (int i = 0; i < data.length; i += 1 + r.nextInt(4)) data[i] = (byte) (data[i] | 0x80);
        int bufSize = bufSizes[r.nextInt(bufSizes.length)];
        List<Object[]> ops = randomOps(fileLen, 50);
        cases.add("{\"data\":\"" + hex(data) + "\",\"bufSize\":" + bufSize + ",\"ops\":" + list(ops, GoldenStoreIO::opJson)
            + ",\"results\":" + runCase(data, bufSize, ops) + "}");
      }
      section("buffered", list(cases, x -> x));
    }

    // 2. BufferedIndexInput constructors and bufferSize(IOContext)
    {
      List<String> cs = new ArrayList<>();
      IOContext[] ctxs = {IOContext.DEFAULT, IOContext.READ, IOContext.READONCE, new IOContext(new MergeInfo(1, 2, true, 3)), new IOContext(new FlushInfo(4, 5))};
      for (IOContext c : ctxs) {
        cs.add("{\"ctx\":" + js(c.toString()) + ",\"bufferSize\":" + BufferedIndexInput.bufferSize(c)
            + ",\"viaCtor\":" + new TestBII("x", new byte[10], 8, new ArrayList<>()).getBufferSize() + "}");
      }
      List<String> bad = new ArrayList<>();
      for (int n : new int[] {-1, 0, 7, 8}) {
        bad.add("{\"n\":" + n + ",\"r\":" + res(() -> new TestBII("x", new byte[1], n, new ArrayList<>()).getBufferSize()) + "}");
      }
      section("bufferSizes", "{\"contexts\":" + list(cs, x -> x) + ",\"ctor\":" + list(bad, x -> x) + "}");
    }

    // 3. BufferedChecksum / CRC32
    {
      List<String> cases = new ArrayList<>();
      for (int c = 0; c < 120; c++) {
        int bufSize = new int[] {1, 2, 7, 16, 256}[r.nextInt(5)];
        CRC32 plain = new CRC32();
        BufferedChecksum bc = new BufferedChecksum(new CRC32(), bufSize);
        List<String> ops = new ArrayList<>();
        List<String> vals = new ArrayList<>();
        for (int i = 0; i < 40; i++) {
          int k = r.nextInt(10);
          if (k < 3) {
            int b = r.nextInt(512) - 256;
            ops.add("[\"b\"," + b + "]");
            plain.update(b);
            bc.update(b);
          } else if (k < 7) {
            byte[] a = new byte[r.nextInt(600)];
            r.nextBytes(a);
            int off = a.length == 0 ? 0 : r.nextInt(a.length);
            int len = a.length == 0 ? 0 : r.nextInt(a.length - off + 1);
            ops.add("[\"a\",\"" + hex(a) + "\"," + off + "," + len + "]");
            plain.update(a, off, len);
            bc.update(a, off, len);
          } else if (k < 9) {
            ops.add("[\"v\"]");
            if (plain.getValue() != bc.getValue()) throw new AssertionError("BufferedChecksum differs from CRC32");
            vals.add("\"" + bc.getValue() + "\"");
          } else {
            ops.add("[\"r\"]");
            plain.reset();
            bc.reset();
          }
        }
        vals.add("\"" + bc.getValue() + "\"");
        cases.add("{\"bufSize\":" + bufSize + ",\"ops\":" + list(ops, x -> x) + ",\"values\":" + list(vals, x -> x) + "}");
      }
      byte[] ab = "123456789".getBytes("US-ASCII");
      CRC32 known = new CRC32();
      known.update(ab, 0, ab.length);
      section("checksum", "{\"check123456789\":\"" + known.getValue() + "\",\"emptyValue\":\"" + new CRC32().getValue() + "\",\"cases\":" + list(cases, x -> x) + "}");
    }

    // 4. BufferedChecksumIndexInput (over a BufferedIndexInput), including backwards seeks and unsupported ops
    {
      List<String> cases = new ArrayList<>();
      for (int c = 0; c < 80; c++) {
        byte[] data = new byte[50 + r.nextInt(2000)];
        r.nextBytes(data);
        int bufSize = new int[] {8, 16, 1024}[r.nextInt(3)];
        List<String> log = new ArrayList<>();
        BufferedChecksumIndexInput in = new BufferedChecksumIndexInput(new TestBII("main", data, bufSize, log));
        List<String> ops = new ArrayList<>();
        List<String> results = new ArrayList<>();
        for (int i = 0; i < 25; i++) {
          int k = r.nextInt(12);
          final String[] opHolder = new String[1];
          final int[] arg = {0};
          String v;
          switch (k) {
            case 0: case 1: opHolder[0] = "byte"; v = res(() -> (long) (in.readByte() & 0xff)); break;
            case 2: opHolder[0] = "int"; v = res(() -> (long) in.readInt()); break;
            case 3: opHolder[0] = "vlong"; v = res(() -> in.readVLong()); break;
            case 4: case 5: {
              arg[0] = r.nextInt(60);
              opHolder[0] = "bytes";
              v = res(() -> { byte[] d = new byte[arg[0]]; in.readBytes(d, 0, d.length); return hex(d); });
              break;
            }
            case 6: case 7: {
              arg[0] = (int) in.getFilePointer() + r.nextInt(40) - (r.nextInt(5) == 0 ? 20 : 0);
              opHolder[0] = "seek";
              v = res(() -> { in.seek(arg[0]); return "ok"; });
              break;
            }
            case 8: opHolder[0] = "skip"; arg[0] = r.nextInt(50); v = res(() -> { in.skipBytes(arg[0]); return "ok"; }); break;
            case 9: opHolder[0] = "clone"; v = res(() -> in.clone()); break;
            case 10: opHolder[0] = "slice"; v = res(() -> in.slice("s", 0, 1)); break;
            default: opHolder[0] = "string"; v = res(() -> in.readString()); break;
          }
          ops.add("[" + js(opHolder[0]) + "," + arg[0] + "]");
          String chk = res(() -> in.getChecksum());
          results.add("{\"v\":" + v + ",\"fp\":" + in.getFilePointer() + ",\"len\":" + in.length() + ",\"crc\":" + chk + "}");
        }
        cases.add("{\"data\":\"" + hex(data) + "\",\"bufSize\":" + bufSize + ",\"desc\":" + js(in.toString())
            + ",\"ops\":" + list(ops, x -> x) + ",\"results\":" + list(results, x -> x) + "}");
      }
      section("checksumIndexInput", list(cases, x -> x));
    }

    // 5. IOContext / FlushInfo / MergeInfo
    {
      List<String> fl = new ArrayList<>();
      long[] sizes = {0, 1, -1, 4294967295L, 4294967296L, 1L << 40, Long.MAX_VALUE, Long.MIN_VALUE, 123456789012345L};
      int[] ints = {0, 1, -1, 100, Integer.MAX_VALUE, Integer.MIN_VALUE};
      for (int n : ints) for (long s : sizes) {
        FlushInfo f = new FlushInfo(n, s);
        fl.add("[" + n + ",\"" + s + "\"," + f.hashCode() + "," + js(f.toString()) + "]");
      }
      List<String> mi = new ArrayList<>();
      for (int n : ints) for (long s : sizes) for (boolean ext : new boolean[] {false, true}) {
        MergeInfo m = new MergeInfo(n, s, ext, n ^ 0x55);
        mi.add("[" + n + ",\"" + s + "\"," + ext + "," + (n ^ 0x55) + "," + m.hashCode() + "," + js(m.toString()) + "]");
      }
      IOContext[] cs = {IOContext.DEFAULT, IOContext.READ, IOContext.READONCE, new IOContext(), new IOContext(IOContext.Context.READ),
        new IOContext(new FlushInfo(3, 4)), new IOContext(new MergeInfo(5, 6, true, 7)), new IOContext(IOContext.DEFAULT, true),
        new IOContext(new IOContext(new MergeInfo(5, 6, false, 7)), true), new IOContext(IOContext.Context.MERGE.equals(null) ? null : IOContext.Context.DEFAULT)};
      List<String> ctx = new ArrayList<>();
      for (IOContext c : cs) ctx.add(js(c.toString()));
      // equality matrix
      List<String> eq = new ArrayList<>();
      for (IOContext a : cs) {
        StringBuilder row = new StringBuilder("[");
        for (int j = 0; j < cs.length; j++) row.append(j > 0 ? "," : "").append(a.equals(cs[j]));
        eq.add(row.append(']').toString());
      }
      List<String> asserts = new ArrayList<>();
      section("info", "{\"flushInfo\":" + list(fl, x -> x) + ",\"mergeInfo\":" + list(mi, x -> x) + ",\"contexts\":" + list(ctx, x -> x) + ",\"equals\":" + list(eq, x -> x) + "}");
    }

    sb.append("\n}\n");
    System.out.print(sb);
  }
}
