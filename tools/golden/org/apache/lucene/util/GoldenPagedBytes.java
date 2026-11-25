package org.apache.lucene.util;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.zip.CRC32;

import org.apache.lucene.store.IOContext;
import org.apache.lucene.store.IndexInput;
import org.apache.lucene.store.IndexOutput;
import org.apache.lucene.store.RAMDirectory;

/** Generates test/golden/pagedbytes.json from the ORIGINAL Lucene 5.2.1 PagedBytes (assertions on). Ops carry all parameters. */
public class GoldenPagedBytes {
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

  static String hex(byte[] a, int off, int len) {
    StringBuilder s = new StringBuilder();
    for (int i = off; i < off + len; i++) s.append(String.format("%02x", a[i] & 0xff));
    return dig(s.toString());
  }

  static byte[] gen(int seed, int len) {
    byte[] b = new byte[len];
    for (int i = 0; i < len; i++) b[i] = (byte) (seed * 131 + i * 17 + (i >> 3));
    return b;
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

  static PagedBytes pb;
  static PagedBytes.Reader rd;
  static final List<StringBuilder> cases = new ArrayList<>();
  static int counter = 0;

  static void finish(String cfg) {
    StringBuilder sb = new StringBuilder("{\"c\":" + js(cfg) + ",\"ops\":[");
    for (int i = 0; i < ops.size(); i++) sb.append(i > 0 ? "," : "").append(js(ops.get(i)));
    sb.append("],\"out\":[");
    for (int i = 0; i < out.size(); i++) sb.append(i > 0 ? "," : "").append(js(out.get(i)));
    sb.append("]}");
    cases.add(sb);
  }

  static void common(Random r, int bits, long total, boolean readerOps, List<Long> ptrs) {
    int bs = 1 << bits;
    if (readerOps) {
      for (int i = 0; i < 12 && total > 0; i++) {
        final long start = (long) (r.nextDouble() * total);
        final int len = (int) Math.min(total - start, r.nextInt(bs + 2));
        run("fs:" + start + ":" + len, () -> {
          BytesRef b = new BytesRef();
          rd.fillSlice(b, start, len);
          return "off=" + b.offset + " len=" + b.length + " " + (len == 0 ? "" : hex(b.bytes, b.offset, b.length));
        });
      }
      run("fs:0:" + (bs + 2), () -> {
        BytesRef b = new BytesRef();
        rd.fillSlice(b, 0, bs + 2);
        return "no exception";
      });
      run("fs:0:-1", () -> {
        BytesRef b = new BytesRef();
        rd.fillSlice(b, 0, -1);
        return "no exception";
      });
      if (ptrs != null) {
        for (long p : ptrs) {
          run("fl:" + p, () -> {
            BytesRef b = new BytesRef();
            rd.fill(b, p);
            return "off=" + b.offset + " len=" + b.length + " " + (b.length == 0 ? "" : hex(b.bytes, b.offset, b.length));
          });
        }
      }
      run("rd", () -> rd.toString() + " ram=" + rd.ramBytesUsed() + " children=" + rd.getChildResources().size());
      // DataInput
      for (int i = 0; i < 10 && total > 0; i++) {
        final long pos = (long) (r.nextDouble() * total);
        final int len = (int) Math.min(total - pos, r.nextInt(2 * bs + 3));
        run("di:" + pos + ":" + len, () -> {
          PagedBytes.PagedBytesDataInput in = pb.getDataInput();
          in.setPosition(pos);
          byte[] b = new byte[len + 2];
          in.readBytes(b, 1, len);
          return "pos=" + in.getPosition() + " " + hex(b, 0, b.length);
        });
        run("dib:" + pos, () -> {
          PagedBytes.PagedBytesDataInput in = pb.getDataInput();
          in.setPosition(pos);
          StringBuilder s = new StringBuilder();
          long n = Math.min(total - pos, 5);
          for (int k = 0; k < n; k++) s.append(String.format("%02x", in.readByte() & 0xff));
          return s + " pos=" + in.getPosition();
        });
        run("dic:" + pos, () -> {
          PagedBytes.PagedBytesDataInput in = pb.getDataInput();
          in.setPosition(pos);
          if (total - pos >= 2) in.readByte();
          PagedBytes.PagedBytesDataInput c = in.clone();
          long pc = c.getPosition();
          long n = Math.min(total - c.getPosition(), 3);
          StringBuilder s = new StringBuilder();
          for (int k = 0; k < n; k++) s.append(String.format("%02x", c.readByte() & 0xff));
          return pc + " " + in.getPosition() + " " + s + " " + in.getPosition() + " " + c.getPosition();
        });
      }
      if (total >= 3) {
        run("div:0", () -> {
          PagedBytes.PagedBytesDataInput in = pb.getDataInput();
          return in.readVInt() + " " + in.readInt() + " " + in.getPosition();
        });
      }
      run("gdo", () -> {
        pb.getDataOutput();
        return "no exception";
      });
      run("frz:0", () -> {
        pb.freeze(false);
        return "no exception";
      });
    }
  }

  static void mode(int mode, int bits, long seed) {
    Random r = new Random(seed);
    ops = new ArrayList<>();
    out = new ArrayList<>();
    final int bs = 1 << bits;
    pb = new PagedBytes(bits);
    rd = null;
    String cfg = mode + "," + bits;
    final long[] total = {0};
    List<Long> ptrs = new ArrayList<>();
    run("gdi", () -> {
      pb.getDataInput();
      return "no exception";
    });
    run("ptr", () -> "" + pb.getPointer());
    run("ram", () -> "" + pb.ramBytesUsed());
    int nOps = 3 + r.nextInt(25);
    final RAMDirectory dir = new RAMDirectory();
    boolean skip = false;
    if (mode == 0) {
      final PagedBytes.PagedBytesDataOutput[] dout = {null};
      run("gdo", () -> {
        dout[0] = pb.getDataOutput();
        return "ok";
      });
      for (int i = 0; i < nOps; i++) {
        if (r.nextInt(4) == 0) {
          final int b = r.nextInt(256);
          run("o1:" + b, () -> {
            dout[0].writeByte((byte) b);
            total[0]++;
            return "pos=" + dout[0].getPosition();
          });
        } else {
          final int len = r.nextInt(4) == 0 ? 0 : r.nextInt(3 * bs + 2);
          final int sd = r.nextInt(1000);
          run("oN:" + len + ":" + sd, () -> {
            byte[] g = gen(sd, len + 3);
            dout[0].writeBytes(g, 2, len);
            total[0] += len;
            return "pos=" + dout[0].getPosition();
          });
        }
        if (r.nextInt(5) == 0) run("ram", () -> "" + pb.ramBytesUsed());
      }
    } else if (mode == 1) {
      for (int i = 0; i < nOps; i++) {
        final int n = r.nextInt(4) == 0 ? 0 : r.nextInt(3 * bs + 2);
        final int sd = r.nextInt(1000);
        run("cp:" + n + ":" + sd, () -> {
          IndexOutput o = dir.createOutput("f" + (counter++), IOContext.DEFAULT);
          String name = "f" + (counter - 1);
          byte[] g = gen(sd, n);
          o.writeBytes(g, 0, n);
          o.close();
          IndexInput in = dir.openInput(name, IOContext.DEFAULT);
          pb.copy(in, n);
          total[0] += n;
          return "pos=" + pb.getPointer() + " fp=" + in.getFilePointer();
        });
        if (r.nextInt(5) == 0) run("ram", () -> "" + pb.ramBytesUsed());
      }
      run("cp-eof:" + 5, () -> {
        IndexOutput o = dir.createOutput("short", IOContext.DEFAULT);
        o.writeBytes(gen(1, 3), 0, 3);
        o.close();
        IndexInput in = dir.openInput("short", IOContext.DEFAULT);
        pb.copy(in, 5);
        return "no exception";
      });
      total[0] = -1; // content after a failed copy is undefined: no more reader ops that depend on the total
    } else if (mode == 2) {
      for (int i = 0; i < nOps; i++) {
        final int len = r.nextInt(5) == 0 ? 0 : r.nextInt(Math.min(bs, 300) + 3);
        final int sd = r.nextInt(1000);
        run("lp:" + len + ":" + sd, () -> {
          byte[] g = gen(sd, len + 2);
          long p = pb.copyUsingLengthPrefix(new BytesRef(g, 1, len));
          ptrs.add(p);
          return "ptr=" + p + " pos=" + pb.getPointer();
        });
      }
      run("lp-big", () -> {
        pb.copyUsingLengthPrefix(new BytesRef(new byte[32768]));
        return "no exception";
      });
    } else {
      for (int i = 0; i < nOps; i++) {
        final int len = r.nextInt(4) == 0 ? 0 : r.nextInt(bs + 1);
        final int sd = r.nextInt(1000);
        run("cb:" + len + ":" + sd, () -> {
          byte[] g = gen(sd, len + 2);
          BytesRef o = new BytesRef();
          pb.copy(new BytesRef(g, 1, len), o);
          return "off=" + o.offset + " len=" + o.length + " " + (len == 0 ? "" : hex(o.bytes, o.offset, o.length)) + " pos=" + pb.getPointer();
        });
      }
      run("cb-big", () -> {
        pb.copy(new BytesRef(new byte[bs + 1]), new BytesRef());
        return "no exception";
      });
    }
    run("ptr", () -> "" + pb.getPointer());
    run("ram", () -> "" + pb.ramBytesUsed());
    final boolean trim = r.nextBoolean();
    run("frz:" + (trim ? 1 : 0), () -> {
      rd = pb.freeze(trim);
      return "ok " + rd.toString() + " ram=" + rd.ramBytesUsed();
    });
    run("frz:again", () -> {
      pb.freeze(false);
      return "no exception";
    });
    run("ptr", () -> "" + pb.getPointer());
    run("ram", () -> "" + pb.ramBytesUsed());
    if (mode == 0 || mode == 1) {
      if (total[0] >= 0) common(r, bits, total[0], rd != null, null);
    } else if (mode == 2) {
      common(r, bits, 0, rd != null, ptrs);
    }
    finish(cfg);
  }

  public static void main(String[] args) throws Exception {
    // base sizes
    ops = new ArrayList<>();
    out = new ArrayList<>();
    run("base:PagedBytes", () -> "" + RamUsageEstimator.shallowSizeOfInstance(PagedBytes.class));
    run("base:Reader", () -> "" + RamUsageEstimator.shallowSizeOfInstance(PagedBytes.Reader.class));
    finish("base");
    int[] bitsList = {1, 2, 3, 4, 6, 8, 10, 15};
    long seed = 100;
    for (int mode = 0; mode < 4; mode++) {
      for (int bits : bitsList) {
        for (int rep = 0; rep < 3; rep++) mode(mode, bits, seed++);
      }
    }
    // special: empty paged bytes
    ops = new ArrayList<>();
    out = new ArrayList<>();
    pb = new PagedBytes(4);
    run("ptr", () -> "" + pb.getPointer());
    run("frz:1", () -> {
      rd = pb.freeze(true);
      return "ok " + rd.toString() + " ram=" + rd.ramBytesUsed();
    });
    run("fs:0:0", () -> {
      BytesRef b = new BytesRef();
      rd.fillSlice(b, 0, 0);
      return "off=" + b.offset + " len=" + b.length;
    });
    run("gdi", () -> {
      PagedBytes.PagedBytesDataInput in = pb.getDataInput();
      return "pos=" + in.getPosition();
    });
    finish("empty");
    StringBuilder sb = new StringBuilder("[\n");
    for (int i = 0; i < cases.size(); i++) sb.append(i > 0 ? ",\n" : "").append(cases.get(i));
    sb.append("\n]");
    System.out.println(sb);
  }
}
