package org.apache.lucene.util.packed;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.zip.CRC32;

import org.apache.lucene.store.ByteArrayDataInput;
import org.apache.lucene.store.DataInput;
import org.apache.lucene.store.DataOutput;
import org.apache.lucene.store.IOContext;
import org.apache.lucene.store.IndexInput;
import org.apache.lucene.store.IndexOutput;
import org.apache.lucene.store.RAMDirectory;
import org.apache.lucene.store.RandomAccessInput;
import org.apache.lucene.util.LongsRef;

/**
 * Generates test/golden/blockpacked.json from the ORIGINAL Lucene 5.2.1 classes BlockPackedWriter, BlockPackedReader,
 * BlockPackedReaderIterator, MonotonicBlockPackedWriter/Reader, AbstractBlockPackedWriter (writeVLong), DirectWriter,
 * DirectReader and the float/long conversions they rely on. Every section is a list of cases {"c": config, "ops": [...],
 * "out": [...]}. Assertions are enabled when running.
 */
public class GoldenBlockPacked {
  static final Random r = new Random(9917);
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

  static String hexs(byte[] a) {
    StringBuilder s = new StringBuilder();
    for (int i = 0; i < a.length; i++) s.append(String.format("%02x", a[i] & 0xff));
    return dig(s.toString());
  }

  static String joinHex(long[] a) {
    StringBuilder s = new StringBuilder();
    for (int i = 0; i < a.length; i++) {
      if (i > 0) s.append(',');
      s.append(Long.toHexString(a[i]));
    }
    return s.toString();
  }

  interface Op {
    String run() throws Exception;
  }

  static List<String> ops, out;

  static void run(String op, Op f) {
    ops.add(op);
    String res;
    try {
      res = f.run();
    } catch (Throwable t) {
      res = ex(t);
    }
    out.add(res);
  }

  // ---------------------------------------------------------------------------------------------------------------
  static RAMDirectory dir;
  static byte[] bytes; // content of file "f" after the W op, or null

  static byte[] readFile(String name) throws Exception {
    IndexInput in = dir.openInput(name, IOContext.DEFAULT);
    byte[] b = new byte[(int) in.length()];
    in.readBytes(b, 0, b.length);
    in.close();
    return b;
  }

  static long[] gen(int kind, int n, boolean mono) {
    long[] v = new long[n];
    if (!mono) {
      switch (kind) {
        case 0: break; // zeros
        case 1: java.util.Arrays.fill(v, 12345678901L); break;
        case 2: for (int i = 0; i < n; i++) v[i] = r.nextInt(10); break;
        case 3: for (int i = 0; i < n; i++) v[i] = r.nextInt(1 << 20); break;
        case 4: for (int i = 0; i < n; i++) v[i] = r.nextLong(); break;
        case 5: for (int i = 0; i < n; i++) v[i] = r.nextInt(201) - 100; break;
        case 6: for (int i = 0; i < n; i++) v[i] = (i % 3 == 0) ? Long.MIN_VALUE : (i % 3 == 1 ? Long.MAX_VALUE : 0); break;
        case 7: for (int i = 0; i < n; i++) v[i] = 1000000007L + 3L * i; break;
        case 8: for (int i = 0; i < n; i++) v[i] = (i / 64 % 2 == 0) ? 77 + r.nextInt(5) : -(1L << 40) + r.nextInt(1000); break;
      }
    } else {
      switch (kind) {
        case 0: break;
        case 1: java.util.Arrays.fill(v, 424242L); break;
        case 2: for (int i = 0; i < n; i++) v[i] = 17L * i; break;
        case 3: { long c = 0; for (int i = 0; i < n; i++) { c += r.nextInt(1000); v[i] = c; } break; }
        case 4: { long c = r.nextInt(100); for (int i = 0; i < n; i++) { c += (r.nextLong() >>> 24); v[i] = c; } break; }
        case 5: { long c = 1L << 61; for (int i = 0; i < n; i++) { c += (r.nextLong() >>> 14); v[i] = c; } break; }
        case 6: for (int i = 0; i < n; i++) v[i] = r.nextInt(1 << 30); break; // not monotonic
        case 7: { long c = 1L << 55; for (int i = 0; i < n; i++) { c += r.nextInt(100); v[i] = c; } break; }
        case 8: for (int i = 0; i < n; i++) v[i] = (i % 2 == 0) ? 0 : Long.MAX_VALUE; break; // overflow-ish
      }
    }
    return v;
  }

  static void blockCase(boolean mono, int bs, long[] v) {
    String cfg = (mono ? "mono" : "block") + "," + bs + "," + joinHex(v);
    ops = new ArrayList<>();
    out = new ArrayList<>();
    dir = new RAMDirectory();
    bytes = null;
    final int n = v.length;
    final AbstractBlockPackedWriter[] wr = new AbstractBlockPackedWriter[1];

    run("W", () -> {
      IndexOutput o = dir.createOutput("f", IOContext.DEFAULT);
      AbstractBlockPackedWriter w = mono ? new MonotonicBlockPackedWriter(o, bs) : new BlockPackedWriter(o, bs);
      wr[0] = w;
      for (long x : v) w.add(x);
      w.finish();
      long ord = w.ord();
      o.close();
      bytes = readFile("f");
      return "len=" + bytes.length + " ord=" + ord + " " + hexs(bytes);
    });
    run("AF", () -> {
      wr[0].add(1);
      return "no exception";
    });
    run("FF", () -> {
      wr[0].finish();
      return "no exception";
    });
    run("RW", () -> {
      IndexOutput o = dir.createOutput("g", IOContext.DEFAULT);
      wr[0].reset(o);
      String s = "ord=" + wr[0].ord();
      for (long x : v) wr[0].add(x);
      wr[0].finish();
      o.close();
      return s + " same=" + java.util.Arrays.equals(readFile("g"), bytes);
    });
    if (mono) {
      run("NEG", () -> {
        IndexOutput o = dir.createOutput("h", IOContext.DEFAULT);
        MonotonicBlockPackedWriter w = new MonotonicBlockPackedWriter(o, bs);
        w.add(-1);
        return "no exception";
      });
    }
    run("Z", () -> {
      IndexOutput o = dir.createOutput("z", IOContext.DEFAULT);
      AbstractBlockPackedWriter w = mono ? new MonotonicBlockPackedWriter(o, bs) : new BlockPackedWriter(o, bs);
      w.addBlockOfZeros();
      w.addBlockOfZeros();
      w.add(5);
      w.finish();
      long ord = w.ord();
      o.close();
      return "ord=" + ord + " " + hexs(readFile("z"));
    });
    run("Z2", () -> {
      IndexOutput o = dir.createOutput("z2", IOContext.DEFAULT);
      AbstractBlockPackedWriter w = mono ? new MonotonicBlockPackedWriter(o, bs) : new BlockPackedWriter(o, bs);
      w.add(1);
      w.addBlockOfZeros();
      return "no exception";
    });
    run("W-bad", () -> {
      new BlockPackedWriter(dir.createOutput("b", IOContext.DEFAULT), 100);
      return "no exception";
    });
    run("W-null", () -> {
      new BlockPackedWriter(null, 64);
      return "no exception";
    });

    for (int version = 0; version <= PackedInts.VERSION_CURRENT; version++) {
      for (int dd = 0; dd < 2; dd++) {
        final int ver = version;
        final boolean direct = dd == 1;
        run("R:" + ver + ":" + dd, () -> {
          if (bytes == null) return "nofile";
          IndexInput in = dir.openInput("f", IOContext.DEFAULT);
          try {
            org.apache.lucene.util.Accountable rd;
            LongValuesLike lv;
            if (mono) {
              final MonotonicBlockPackedReader m = MonotonicBlockPackedReader.of(in, ver, bs, n, direct);
              rd = m;
              lv = i -> m.get(i);
            } else {
              final BlockPackedReader b = new BlockPackedReader(in, ver, bs, n, direct);
              rd = b;
              lv = i -> b.get(i);
            }
            StringBuilder s = new StringBuilder();
            s.append(rd.toString()).append(" fp=").append(in.getFilePointer()).append(" ram=").append(rd.ramBytesUsed()).append(' ');
            StringBuilder vals = new StringBuilder();
            for (int i = 0; i < n; i++) vals.append(Long.toHexString(lv.get(i))).append(' ');
            return s + dig(vals.toString());
          } finally {
            in.close();
          }
        });
      }
    }

    if (!mono) {
      for (int version = 0; version <= PackedInts.VERSION_CURRENT; version++) {
        for (int kind = 0; kind < 2; kind++) {
          for (int mode = 0; mode < 3; mode++) {
            final int ver = version, kd = kind, md = mode;
            run("I:" + ver + ":" + kd + ":" + md, () -> {
              if (bytes == null) return "nofile";
              DataInput in = kd == 0 ? dir.openInput("f", IOContext.DEFAULT) : new ByteArrayDataInput(bytes);
              BlockPackedReaderIterator it = new BlockPackedReaderIterator(in, ver, bs, n);
              StringBuilder s = new StringBuilder();
              try {
                if (md == 0) {
                  for (int i = 0; i < n; i++) s.append(Long.toHexString(it.next())).append(' ');
                  s.append("ord=").append(it.ord()).append(' ');
                  it.next();
                } else if (md == 1) {
                  int pos = 0;
                  while (pos < n) {
                    LongsRef ref = it.next(1 + (pos * 7) % 70);
                    s.append(ref.offset).append('/').append(ref.length).append(':');
                    for (int i = 0; i < ref.length; i++) s.append(Long.toHexString(ref.longs[ref.offset + i])).append(' ');
                    pos += ref.length;
                  }
                  s.append("ord=").append(it.ord()).append(' ');
                  it.next(3);
                } else {
                  int step = 0;
                  while (it.ord() < n) {
                    int remaining = (int) (n - it.ord());
                    int sk = Math.min(remaining, (step * 37 + 5) % (2 * bs + 3));
                    it.skip(sk);
                    s.append("s").append(sk).append("@").append(it.ord()).append(' ');
                    if (it.ord() < n) s.append(Long.toHexString(it.next())).append(' ');
                    step++;
                  }
                  s.append("ord=").append(it.ord()).append(' ');
                  it.skip(1);
                }
              } catch (Throwable t) {
                s.append(ex(t));
              }
              return dig(s.toString());
            });
          }
        }
      }
      run("I-reset", () -> {
        if (bytes == null) return "nofile";
        DataInput in = new ByteArrayDataInput(bytes);
        BlockPackedReaderIterator it = new BlockPackedReaderIterator(in, PackedInts.VERSION_CURRENT, bs, n);
        StringBuilder s = new StringBuilder();
        for (int i = 0; i < n / 2; i++) s.append(Long.toHexString(it.next())).append(' ');
        it.reset(new ByteArrayDataInput(bytes), n);
        s.append("ord=").append(it.ord()).append(' ');
        for (int i = 0; i < n; i++) s.append(Long.toHexString(it.next())).append(' ');
        it.reset(new ByteArrayDataInput(bytes), n);
        it.skip(n);
        s.append("ord=").append(it.ord()).append(' ');
        it.reset(new ByteArrayDataInput(bytes), n);
        it.skip(n + 1);
        return dig(s.toString());
      });
      run("I-bad", () -> {
        new BlockPackedReaderIterator(new ByteArrayDataInput(new byte[0]), PackedInts.VERSION_CURRENT, 100, 5);
        return "no exception";
      });
    }
    cs(cfg, ops, out);
  }

  interface LongValuesLike {
    long get(int i);
  }

  static void blocks() {
    begin("block");
    int[] bsz = {64, 128, 256};
    int[] ns = {0, 1, 5, 64, 65, 130, 300};
    for (int mono = 0; mono < 2; mono++) {
      for (int kind = 0; kind <= 8; kind++) {
        for (int bs : bsz) {
          for (int n : ns) {
            if (n > 130 && bs == 128) continue;
            blockCase(mono == 1, bs, gen(kind, n, mono == 1));
          }
        }
      }
    }
    // a bigger one for the multi-block skip path
    blockCase(false, 64, gen(3, 1000, false));
    blockCase(false, 64, gen(8, 1000, false));
    blockCase(true, 128, gen(3, 1000, true));
    end();
  }

  // ---------------------------------------------------------------------------------------------------------------
  static void direct() {
    begin("direct");
    int[] bpvs = {1, 2, 4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64, 0, 3, 5, 7, 65, -1};
    int[] ns = {0, 1, 7, 33, 200};
    for (int bpv : bpvs) {
      for (int n : ns) {
        long[] v = new long[n];
        for (int i = 0; i < n; i++) {
          if (bpv >= 64) v[i] = r.nextLong();
          else if (bpv <= 0) v[i] = 0;
          else v[i] = r.nextLong() & ((1L << bpv) - 1);
        }
        if (n > 3 && bpv > 0) {
          v[0] = 0;
          v[1] = bpv >= 64 ? -1L : (1L << bpv) - 1;
        }
        final int fb = bpv;
        ops = new ArrayList<>();
        out = new ArrayList<>();
        dir = new RAMDirectory();
        bytes = null;
        String cfg = bpv + "," + joinHex(v);
        run("W", () -> {
          IndexOutput o = dir.createOutput("f", IOContext.DEFAULT);
          DirectWriter w = DirectWriter.getInstance(o, v.length, fb);
          for (long x : v) w.add(x);
          w.finish();
          o.close();
          bytes = readFile("f");
          return "len=" + bytes.length + " " + hexs(bytes);
        });
        run("R", () -> {
          if (bytes == null) return "nofile";
          IndexInput in = dir.openInput("f", IOContext.DEFAULT);
          RandomAccessInput slice = in.randomAccessSlice(0, in.length());
          org.apache.lucene.util.LongValues rd = DirectReader.getInstance(slice, fb);
          StringBuilder s = new StringBuilder();
          for (int i = 0; i < v.length; i++) s.append(Long.toHexString(rd.get(i))).append(' ');
          return dig(s.toString());
        });
        run("R-off", () -> {
          if (bytes == null || bytes.length < 8) return "skip";
          IndexInput in = dir.openInput("f", IOContext.DEFAULT);
          RandomAccessInput slice = in.randomAccessSlice(0, in.length());
          org.apache.lucene.util.LongValues rd = DirectReader.getInstance(slice, fb);
          StringBuilder s = new StringBuilder();
          for (int i = v.length - 1; i >= 0; i -= 2) s.append(Long.toHexString(rd.get(i))).append(' ');
          return dig(s.toString());
        });
        run("OVER", () -> {
          IndexOutput o = dir.createOutput("o", IOContext.DEFAULT);
          DirectWriter w = DirectWriter.getInstance(o, v.length, fb);
          for (long x : v) w.add(x);
          w.add(1);
          return "no exception";
        });
        run("SHORT", () -> {
          IndexOutput o = dir.createOutput("s", IOContext.DEFAULT);
          DirectWriter w = DirectWriter.getInstance(o, v.length + 2, fb);
          for (long x : v) w.add(x);
          w.finish();
          return "no exception";
        });
        run("BIG", () -> {
          IndexOutput o = dir.createOutput("t", IOContext.DEFAULT);
          DirectWriter w = DirectWriter.getInstance(o, 3, fb);
          w.add(fb >= 64 ? -1L : (1L << fb));
          w.finish();
          return "no exception";
        });
        run("NEG", () -> {
          IndexOutput o = dir.createOutput("u", IOContext.DEFAULT);
          DirectWriter w = DirectWriter.getInstance(o, 3, fb);
          w.add(-5L);
          w.finish();
          return "len=" + o.getFilePointer();
        });
        cs(cfg, ops, out);
      }
    }
    end();

    begin("bits");
    {
      long[] vs = {0, 1, 2, 3, 255, 256, 65535, 65536, (1L << 24) - 1, 1L << 24, (1L << 31) - 1, 1L << 31, (1L << 40) - 1, 1L << 40,
          (1L << 56) - 1, 1L << 56, Long.MAX_VALUE, -1, Long.MIN_VALUE, -12345};
      List<Long> all = new ArrayList<>();
      for (long x : vs) all.add(x);
      for (int i = 0; i < 100; i++) all.add(r.nextLong() >>> r.nextInt(64));
      for (int i = 0; i < 20; i++) all.add(-(r.nextLong() >>> r.nextInt(64)));
      ops = new ArrayList<>();
      out = new ArrayList<>();
      for (final long x : all) {
        run("B:" + Long.toHexString(x), () -> "" + DirectWriter.bitsRequired(x));
        run("U:" + Long.toHexString(x), () -> "" + DirectWriter.unsignedBitsRequired(x));
      }
      cs("bits", ops, out);
    }
    end();
  }

  // ---------------------------------------------------------------------------------------------------------------
  static void conversions() {
    begin("tofloat");
    {
      List<Long> all = new ArrayList<>();
      long[] edge = {0, 1, -1, 255, 1L << 24, (1L << 24) + 1, (1L << 24) + 2, (1L << 24) + 3, (1L << 53) - 1, 1L << 53, (1L << 53) + 1,
          (1L << 53) + 2, (1L << 53) + 3, Long.MAX_VALUE, Long.MIN_VALUE, Long.MIN_VALUE + 1, Long.MAX_VALUE - 1, -(1L << 53) - 1};
      for (long x : edge) all.add(x);
      for (int k = 24; k < 63; k++) {
        long b = 1L << k;
        long half = 1L << (k - 24); // half ulp in a 24-bit mantissa for magnitude 2^k.. (tie point)
        for (long d : new long[] {-1, 0, 1}) {
          all.add(b + half + d);
          all.add(b + 3 * half + d);
          all.add(-(b + half + d));
          all.add(b + d);
        }
        for (int i = 0; i < 4; i++) all.add(b | (r.nextLong() & (b - 1)));
      }
      for (int i = 0; i < 300; i++) all.add(r.nextLong() >> r.nextInt(64));
      ops = new ArrayList<>();
      out = new ArrayList<>();
      for (final long x : all) {
        run("F:" + Long.toHexString(x), () -> Integer.toHexString(Float.floatToRawIntBits((float) x)));
      }
      cs("tofloat", ops, out);
    }
    end();

    begin("expected");
    {
      ops = new ArrayList<>();
      out = new ArrayList<>();
      int[] avgBits = {0, 0x3f800000, 0x7fc00000, 0x7f800000, 0xff800000, 0x7f7fffff, 0x00000001, 0x80000000, 0xbf800000};
      for (int i = 0; i < 400; i++) {
        final long origin = (i % 4 == 0) ? r.nextLong() : (i % 4 == 1 ? (1L << 40) + r.nextInt(1000) : r.nextInt(100000));
        final int bits;
        if (i < avgBits.length * 3) bits = avgBits[i % avgBits.length];
        else if (i % 3 == 0) bits = Float.floatToRawIntBits((float) (r.nextDouble() * 1e6));
        else if (i % 3 == 1) bits = Float.floatToRawIntBits((float) (r.nextDouble() * 1e17));
        else bits = Float.floatToRawIntBits((float) (r.nextDouble() * 1e2));
        final int idx = (i % 5 == 0) ? r.nextInt(1 << 27) : r.nextInt(1000);
        run("E:" + Long.toHexString(origin) + "," + Integer.toHexString(bits) + "," + idx, () ->
            Long.toHexString(MonotonicBlockPackedReader.expected(origin, Float.intBitsToFloat(bits), idx)));
      }
      cs("expected", ops, out);
    }
    end();

    begin("vlong");
    {
      ops = new ArrayList<>();
      out = new ArrayList<>();
      List<Long> all = new ArrayList<>();
      long[] edge = {0, 1, 127, 128, 16383, 16384, -1, -2, Long.MIN_VALUE, Long.MAX_VALUE, 1L << 56, (1L << 56) - 1, 1L << 63 >>> 1};
      for (long x : edge) all.add(x);
      for (int i = 0; i < 200; i++) all.add(r.nextLong() >> r.nextInt(64));
      for (final long x : all) {
        run("V:" + Long.toHexString(x), () -> {
          java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
          DataOutput o = new org.apache.lucene.store.OutputStreamDataOutput(bo);
          AbstractBlockPackedWriter.writeVLong(o, x);
          byte[] b = bo.toByteArray();
          long back = BlockPackedReaderIterator.readVLong(new ByteArrayDataInput(b));
          return hexs(b) + ":" + Long.toHexString(back);
        });
      }
      cs("vlong", ops, out);
    }
    end();
  }

  public static void main(String[] args) throws Exception {
    sb.append("{\n");
    blocks();
    direct();
    conversions();
    sb.append("\n}\n");
    System.out.print(sb);
  }
}
