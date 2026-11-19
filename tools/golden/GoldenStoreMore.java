import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.NoSuchFileException;
import java.util.*;
import org.apache.lucene.store.*;
import org.apache.lucene.util.*;

/**
 * Generates test/golden/store-more.json from the original Lucene 5.2.1 classes OutputStreamIndexOutput,
 * RateLimiter.SimpleRateLimiter, RateLimitedIndexOutput, FileSwitchDirectory and NRTCachingDirectory (+ the
 * JDK's BufferedOutputStream/CheckedOutputStream/FilterOutputStream it relies on) and from Double.toString.
 * Same conventions as GoldenStoreDir: scripts of random operations replayed by the TypeScript test.
 */
public class GoldenStoreMore {
  static final Random r = GoldenStoreDir.r;
  static final StringBuilder sb = new StringBuilder("{");

  static String js(String s) { return GoldenStore.js(s); }
  static String hex(byte[] b) { return GoldenStore.hex(b); }
  static String exs(Throwable t) { return GoldenStoreDir.exs(t); }
  static String toJson(Object o) { return GoldenStoreDir.toJson(o); }
  static List<Object> L(Object... a) { return GoldenStoreDir.L(a); }

  static void section(String name, String json) {
    if (sb.length() > 1) sb.append(",\n");
    sb.append(js(name)).append(':').append(json);
  }

  // ---------------------------------------------------------------- OutputStreamIndexOutput
  static class Rec extends OutputStream {
    final StringBuilder log = new StringBuilder();
    int writes = 0;
    final int failWriteAt;
    final boolean failFlush, failClose;
    Rec(int failWriteAt, boolean failFlush, boolean failClose) { this.failWriteAt = failWriteAt; this.failFlush = failFlush; this.failClose = failClose; }
    @Override public void write(int b) throws IOException {
      writes++;
      if (writes == failWriteAt) throw new IOException("write failed");
      log.append("b").append(b & 0xff).append(' ');
    }
    @Override public void write(byte[] b, int off, int len) throws IOException {
      writes++;
      if (writes == failWriteAt) throw new IOException("write failed");
      log.append("w").append(off).append(':').append(len).append(':').append(hex(Arrays.copyOfRange(b, off, off + len))).append(' ');
    }
    @Override public void flush() throws IOException {
      log.append("f ");
      if (failFlush) throw new IOException("flush failed");
    }
    @Override public void close() throws IOException {
      log.append("c ");
      if (failClose) throw new IOException("close failed");
    }
    String drain() { String s = log.toString().trim(); log.setLength(0); return s; }
  }

  static final int[] BUFSIZES = {1, 2, 7, 16, 100, 8192};
  static final int[] CHUNKS = {0, 1, 5, 15, 16, 17, 99, 100, 101, 8191, 8192, 8193};

  static String execOs(OutputStreamIndexOutput o, Rec rec, List<Object> op) {
    String res;
    try {
      switch ((String) op.get(0)) {
        case "wb": o.writeByte((byte) ((Integer) op.get(1)).intValue()); res = "ok"; break;
        case "wbs": {
          int off = (Integer) op.get(1);
          byte[] chunk = GoldenStore.unhex((String) op.get(2));
          byte[] arr = new byte[off + chunk.length + 2];
          Arrays.fill(arr, (byte) 0x77);
          System.arraycopy(chunk, 0, arr, off, chunk.length);
          o.writeBytes(arr, off, chunk.length);
          res = "ok";
          break;
        }
        case "fp": res = "" + o.getFilePointer(); break;
        case "crc": res = "" + o.getChecksum(); break;
        case "close": o.close(); res = "ok"; break;
        default: throw new AssertionError(op.get(0));
      }
    } catch (Throwable t) {
      res = exs(t) + " suppressed=" + GoldenStoreDir.suppressed(t);
    }
    return res + " log=[" + rec.drain() + "]";
  }

  static void osio() throws IOException {
    List<Object> scripts = new ArrayList<Object>();
    for (int sc = 0; sc < 30; sc++) {
      int bufSize = BUFSIZES[sc % BUFSIZES.length];
      int cfg = (sc / BUFSIZES.length) % 5;
      Rec rec = new Rec(cfg == 1 ? 3 : 0, cfg == 2 || cfg == 4, cfg == 3 || cfg == 4);
      OutputStreamIndexOutput o = new OutputStreamIndexOutput("osio", rec, bufSize);
      List<Object> ops = new ArrayList<Object>();
      List<Object> results = new ArrayList<Object>();
      int n = 30;
      for (int i = 0; i < n + 4; i++) {
        List<Object> op;
        int k = r.nextInt(8);
        if (i == n) op = L("close");
        else if (i == n + 1) op = L("close");
        else if (i == n + 2) op = L("crc");
        else if (i == n + 3) op = L("fp");
        else if (k < 3) op = L("wb", r.nextInt(256));
        else if (k < 6) {
          int len = CHUNKS[r.nextInt(CHUNKS.length)];
          byte[] chunk = new byte[len];
          r.nextBytes(chunk);
          op = L("wbs", r.nextInt(4), hex(chunk));
        } else if (k == 6) op = L("fp");
        else op = L("crc");
        ops.add(op);
        results.add(execOs(o, rec, op));
      }
      scripts.add(L(bufSize, cfg, ops, results));
    }
    section("osio", toJson(scripts));

    List<Object> ctor = new ArrayList<Object>();
    for (int size : new int[] {0, -1, -8192, 1}) {
      String res;
      try { new OutputStreamIndexOutput("d", new Rec(0, false, false), size); res = "ok"; } catch (Throwable t) { res = exs(t); }
      ctor.add(L(size, res));
    }
    section("osioCtor", toJson(ctor));
  }

  // ---------------------------------------------------------------- RateLimitedIndexOutput
  static class FakeLimiter extends RateLimiter {
    final int[] mins; int idx = 0; final StringBuilder log = new StringBuilder();
    FakeLimiter(int[] mins) { this.mins = mins; }
    @Override public void setMBPerSec(double d) {}
    @Override public double getMBPerSec() { return 1; }
    @Override public long pause(long bytes) { log.append("pause:").append(bytes).append(' '); return 0; }
    @Override public long getMinPauseCheckBytes() { return mins[idx++ % mins.length]; }
    String drain() { String s = log.toString().trim(); log.setLength(0); return s + "|idx=" + idx; }
  }

  static String execRl(RateLimitedIndexOutput o, FakeLimiter lim, List<Object> op) {
    String res;
    try {
      switch ((String) op.get(0)) {
        case "wb": o.writeByte((byte) ((Integer) op.get(1)).intValue()); res = "ok"; break;
        case "wbs": { byte[] b = GoldenStore.unhex((String) op.get(1)); o.writeBytes(b, 0, b.length); res = "ok"; break; }
        case "fp": res = "" + o.getFilePointer(); break;
        case "crc": res = "" + o.getChecksum(); break;
        case "toString": res = o.toString(); break;
        case "close": o.close(); res = "ok"; break;
        default: throw new AssertionError(op.get(0));
      }
    } catch (Throwable t) { res = exs(t); }
    return res + " log=[" + lim.drain() + "]";
  }

  static void rateLimited() throws IOException {
    int[][] minsList = {{0}, {10}, {10, 100, 1, 5}, {1000}, {3, 0, 7}, {1 << 30}};
    List<Object> scripts = new ArrayList<Object>();
    for (int sc = 0; sc < 12; sc++) {
      int[] mins = minsList[sc % minsList.length];
      FakeLimiter lim = new FakeLimiter(mins);
      RAMFile file = new RAMFile();
      RAMOutputStream delegate = new RAMOutputStream("dd", file, true);
      RateLimitedIndexOutput o = new RateLimitedIndexOutput(lim, delegate);
      List<Object> ops = new ArrayList<Object>();
      List<Object> results = new ArrayList<Object>();
      for (int i = 0; i < 40; i++) {
        List<Object> op;
        int k = r.nextInt(9);
        if (i == 0) op = L("toString");
        else if (i == 39) op = L("close");
        else if (k < 4) op = L("wb", r.nextInt(256));
        else if (k < 7) { byte[] b = new byte[r.nextInt(60)]; r.nextBytes(b); op = L("wbs", hex(b)); }
        else if (k == 7) op = L("fp");
        else op = L("crc");
        ops.add(op);
        results.add(execRl(o, lim, op));
      }
      scripts.add(L(toJsonInts(mins), ops, results));
    }
    section("rateLimited", toJson(scripts));
  }

  static List<Object> toJsonInts(int[] a) { List<Object> l = new ArrayList<Object>(); for (int x : a) l.add(x); return l; }

  // ---------------------------------------------------------------- SimpleRateLimiter (deterministic parts) / Double.toString
  static void simpleRateLimiter() {
    String[] vals = {"0", "0.001", "1", "2.5", "1.0E6", "1e300", "Infinity", "NaN", "-3", "0.5", "1e-9", "1000", "0.2", "3.7", "-0.0", "123456.789"};
    List<Object> list = new ArrayList<Object>();
    for (String v : vals) {
      RateLimiter.SimpleRateLimiter l = new RateLimiter.SimpleRateLimiter(Double.parseDouble(v));
      list.add(L(v, "" + l.getMinPauseCheckBytes(), Double.toString(l.getMBPerSec())));
    }
    section("simpleRateLimiter", toJson(list));

    List<Object> zero = new ArrayList<Object>();
    for (String v : new String[] {"0", "1e12", "Infinity", "NaN", "-5"}) {
      RateLimiter.SimpleRateLimiter l = new RateLimiter.SimpleRateLimiter(Double.parseDouble(v));
      zero.add(L(v, "" + l.pause(10)));
    }
    section("simpleRateLimiterPause", toJson(zero));

    List<Object> ds = new ArrayList<Object>();
    double[] special = {0.0, -0.0, 1, -1, 1.5, 0.001, 0.00099, 0.0009999999999999998, 1e7, 9999999.999999998, 1.0E-5, 123456789.0, 1e21, 1e22,
        Double.MAX_VALUE, Double.MIN_VALUE, Double.MIN_NORMAL, Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, 0.1, 100, 0.30000000000000004,
        9007199254740992.0, 5.0, 60.0, 4.9e-324, 1234567.0, 12345678.0, 0.5, 2.0E-3, 1.0E10, 123.456, 3.0E8, 1.0E23, 8.41E21, 2.2250738585072014E-308};
    for (double d : special) ds.add(L(Long.toHexString(Double.doubleToRawLongBits(d)), Double.toString(d)));
    for (int i = 0; i < 400; i++) {
      double d;
      switch (i % 4) {
        case 0: d = Double.longBitsToDouble(r.nextLong()); break;
        case 1: d = r.nextDouble() * Math.pow(10, r.nextInt(30) - 12); break;
        case 2: d = (r.nextInt(2000000) - 1000000) / (double) (1 + r.nextInt(1000)); break;
        default: d = Math.round(r.nextDouble() * 1e6) / 1000.0; break;
      }
      ds.add(L(Long.toHexString(Double.doubleToRawLongBits(d)), Double.toString(d)));
    }
    section("doubleToString", toJson(ds));
  }

  // ---------------------------------------------------------------- shared directory interpreter
  static final String[] NAMES = {"a.fdt", "b.fdx", "c.tim", "d.cfs", "e", "f.g.fdt", ".fdt", "x.FDT", "_0.fnm", "zz.tim"};

  static IOContext ctxOf(List<Object> c) {
    switch ((String) c.get(0)) {
      case "default": return IOContext.DEFAULT;
      case "flush": return new IOContext(new FlushInfo(10, (Integer) c.get(1)));
      case "merge": return new IOContext(new MergeInfo(10, (Integer) c.get(1), false, -1));
      default: throw new AssertionError(c.get(0));
    }
  }

  static String sorted(String[] l) { Arrays.sort(l); return Arrays.toString(l); }

  /** operations every Directory supports; returns null when op is not one of them */
  @SuppressWarnings("unchecked")
  static String common(Directory d, List<Object> op, Map<String, Lock> locks) {
    try {
      switch ((String) op.get(0)) {
        case "write": {
          IndexOutput o = d.createOutput((String) op.get(1), ctxOf((List<Object>) op.get(2)));
          GoldenStoreDir.applySteps(o, (List<Object>) op.get(3));
          String s = "fp=" + o.getFilePointer() + " crc=" + o.getChecksum();
          o.close();
          return s;
        }
        case "list": return sorted(d.listAll());
        case "length": return "" + d.fileLength((String) op.get(1));
        case "delete": d.deleteFile((String) op.get(1)); return "ok";
        case "rename": d.renameFile((String) op.get(1), (String) op.get(2)); return "ok";
        case "sync": d.sync((List<String>) (List<?>) op.get(1)); return "ok";
        case "read": {
          IndexInput in = d.openInput((String) op.get(1), IOContext.READ);
          String s = GoldenStoreDir.execRead(in, (List<Object>) op.get(2));
          in.close();
          return s;
        }
        case "close": d.close(); return "ok";
        case "lock": {
          Lock l = d.makeLock((String) op.get(1));
          boolean got = l.obtain();
          if (got) locks.put((String) op.get(1), l);
          return "" + got;
        }
        case "unlock": {
          Lock l = locks.remove((String) op.get(1));
          if (l == null) return "none";
          l.close();
          return "closed";
        }
        default: return null;
      }
    } catch (Throwable t) {
      return exs(t);
    }
  }

  static List<Object> genNameList() {
    List<Object> l = new ArrayList<Object>();
    int n = r.nextInt(5);
    for (int i = 0; i < n; i++) l.add(NAMES[r.nextInt(NAMES.length)]);
    return l;
  }

  static List<Object> genCtx() {
    switch (r.nextInt(3)) {
      case 0: return L("default");
      case 1: return L("flush", new int[] {0, 500, 1048, 1049, 2097, 3000, 100000}[r.nextInt(7)]);
      default: return L("merge", new int[] {0, 500, 1048, 1049, 2097, 3000, 100000}[r.nextInt(7)]);
    }
  }

  static List<Object> genCommonOp(String name, boolean withCtx) {
    int k = r.nextInt(14);
    if (k < 4) return L("write", name, withCtx ? genCtx() : L("default"), GoldenStoreDir.genSteps());
    if (k < 6) return L("list");
    if (k == 6) return L("length", name);
    if (k == 7) return L("delete", name);
    if (k == 8) return L("rename", name, NAMES[r.nextInt(NAMES.length)]);
    if (k == 9) return L("sync", genNameList());
    if (k == 10 || k == 11) {
      int n = 5;
      return L("read", name, GoldenStoreDir.genReadOps(n + r.nextInt(1200), 0));
    }
    if (k == 12) return L("lock", name);
    return L("unlock", name);
  }

  // ---------------------------------------------------------------- FileSwitchDirectory
  static void fileSwitch() throws IOException {
    Set<String> exts = new HashSet<String>(Arrays.asList("fdt", "fdx", "tim"));
    List<Object> scripts = new ArrayList<Object>();
    for (int sc = 0; sc < 8; sc++) {
      RAMDirectory p = new RAMDirectory();
      RAMDirectory s = new RAMDirectory();
      boolean doClose = sc % 2 == 0;
      FileSwitchDirectory fsd = new FileSwitchDirectory(exts, p, s, doClose);
      Map<String, Lock> locks = new HashMap<String, Lock>();
      List<Object> ops = new ArrayList<Object>();
      List<Object> results = new ArrayList<Object>();
      int n = 70;
      for (int i = 0; i < n + 6; i++) {
        String name = NAMES[r.nextInt(NAMES.length)];
        List<Object> op;
        if (i == n) op = L("close");
        else if (i == n + 1) op = L("primaryList");
        else if (i == n + 2) op = L("secondaryList");
        else if (i == n + 3) op = L("list");
        else if (i == n + 4) op = L("close");
        else if (i == n + 5) op = L("ext", name);
        else if (r.nextInt(12) == 0) op = L(r.nextBoolean() ? "primaryList" : "secondaryList");
        else if (r.nextInt(24) == 0) op = L("ext", name);
        else op = genCommonOp(name, false);
        String res;
        switch ((String) op.get(0)) {
          case "primaryList": try { res = sorted(p.listAll()); } catch (Throwable t) { res = exs(t); } break;
          case "secondaryList": try { res = sorted(s.listAll()); } catch (Throwable t) { res = exs(t); } break;
          case "ext": res = FileSwitchDirectory.getExtension((String) op.get(1)); break;
          default: res = common(fsd, op, locks);
        }
        ops.add(op);
        results.add(res);
      }
      scripts.add(L(doClose, ops, results));
    }
    section("fileSwitch", toJson(scripts));

    // listAll() with NoSuchFileException / IOException from one or both directories
    List<Object> cases = new ArrayList<Object>();
    for (int pk = 0; pk < 3; pk++) for (int sk = 0; sk < 3; sk++) for (int pf = 0; pf < 2; pf++) for (int sf = 0; sf < 2; sf++) {
      Directory pd = failingList(pk, "p", pf == 1);
      Directory sd = failingList(sk, "s", sf == 1);
      FileSwitchDirectory fsd = new FileSwitchDirectory(exts, pd, sd, false);
      String res;
      try { res = sorted(fsd.listAll()); } catch (Throwable t) { res = exs(t); }
      cases.add(L(pk, sk, pf, sf, res));
    }
    section("fileSwitchListAll", toJson(cases));
  }

  /** kind 0: lists normally; 1: throws NoSuchFileException("<tag>-nsf"); 2: throws IOException("<tag>-io") */
  static Directory failingList(final int kind, final String tag, boolean withFile) throws IOException {
    RAMDirectory base = new RAMDirectory();
    if (withFile) {
      IndexOutput o = base.createOutput(tag + "1.fdt", IOContext.DEFAULT);
      o.writeByte((byte) 1);
      o.close();
      o = base.createOutput(tag + "2.cfs", IOContext.DEFAULT);
      o.close();
    }
    return new FilterDirectory(base) {
      @Override public String[] listAll() throws IOException {
        if (kind == 1) throw new NoSuchFileException(tag + "-nsf");
        if (kind == 2) throw new IOException(tag + "-io");
        return in.listAll();
      }
    };
  }

  // ---------------------------------------------------------------- NRTCachingDirectory
  static void nrt() throws IOException {
    double[][] configs = {{0.001, 0.002}, {0.001, 0.01}, {5.0, 60.0}, {0.0, 0.0}, {0.0005, 0.5}, {2.5, 1.0}, {0.001, 0.0021}};
    List<Object> scripts = new ArrayList<Object>();
    for (int sc = 0; sc < 10; sc++) {
      double[] cfg = configs[sc % configs.length];
      RAMDirectory delegate = new RAMDirectory();
      NRTCachingDirectory nrt = new NRTCachingDirectory(delegate, cfg[0], cfg[1]);
      Map<String, Lock> locks = new HashMap<String, Lock>();
      List<Object> ops = new ArrayList<Object>();
      List<Object> results = new ArrayList<Object>();
      int n = 70;
      for (int i = 0; i < n + 6; i++) {
        String name = NAMES[r.nextInt(NAMES.length)];
        List<Object> op;
        if (i == 0) op = L("toString");
        else if (i == n) op = L("close");
        else if (i == n + 1) op = L("close");
        else if (i == n + 2) op = L("list");
        else if (i == n + 3) op = L("ram");
        else if (i == n + 4) op = L("write", name, L("default"), L());
        else if (i == n + 5) op = L("cached");
        else if (r.nextInt(12) == 0) op = L("cached");
        else if (r.nextInt(12) == 0) op = L("delegateList");
        else if (r.nextInt(10) == 0) op = L("ram");
        else if (r.nextInt(14) == 0) op = L("acct");
        else if (r.nextInt(14) == 0) op = L("toString");
        else op = genCommonOp(name, true);
        String res;
        try {
          switch ((String) op.get(0)) {
            case "cached": res = sorted(nrt.listCachedFiles()); break;
            case "delegateList": res = sorted(delegate.listAll()); break;
            case "ram": res = "" + nrt.ramBytesUsed(); break;
            case "acct": res = GoldenStoreDir.normalize(Accountables.toString(Accountables.namedAccountable("nrt", nrt.getChildResources(), nrt.ramBytesUsed()))); break;
            case "toString": res = GoldenStoreDir.normalize(nrt.toString()); break;
            default: res = common(nrt, op, locks);
          }
        } catch (Throwable t) { res = exs(t); }
        ops.add(op);
        results.add(res);
      }
      scripts.add(L(cfg[0] + "", cfg[1] + "", ops, results));
    }
    section("nrt", toJson(scripts));

    // the same file in the cache and in the delegate
    RAMDirectory delegate = new RAMDirectory();
    NRTCachingDirectory nrt = new NRTCachingDirectory(delegate, 5.0, 60.0);
    IndexOutput o = nrt.createOutput("dup", IOContext.DEFAULT);
    o.close();
    o = delegate.createOutput("dup", IOContext.DEFAULT);
    o.close();
    String res;
    try { res = sorted(nrt.listAll()); } catch (Throwable t) { res = GoldenStoreDir.normalize(exs(t)); }
    section("nrtDuplicate", toJson(L(res)));

    // doCacheWrite override: never cache
    NRTCachingDirectory never = new NRTCachingDirectory(new RAMDirectory(), 5.0, 60.0) {
      @Override protected boolean doCacheWrite(String name, IOContext context) { return false; }
    };
    IndexOutput o2 = never.createOutput("n", IOContext.DEFAULT);
    o2.writeByte((byte) 1);
    o2.close();
    section("nrtNever", toJson(L(sorted(never.listCachedFiles()), sorted(never.listAll()), "" + never.fileLength("n"))));
  }


  // ---------------------------------------------------------------- the JDK streams on their own
  static String execStream(java.io.OutputStream s, java.util.zip.CRC32 crc, Rec rec, List<Object> op) {
    String res;
    try {
      switch ((String) op.get(0)) {
        case "wb": s.write((Integer) op.get(1)); res = "ok"; break;
        case "wbs": s.write(GoldenStore.unhex((String) op.get(3)), (Integer) op.get(1), (Integer) op.get(2)); res = "ok"; break;
        case "flush": s.flush(); res = "ok"; break;
        case "close": s.close(); res = "ok"; break;
        case "crc": res = "" + crc.getValue(); break;
        default: throw new AssertionError(op.get(0));
      }
    } catch (Throwable t) {
      String c = t.getClass().getSimpleName();
      // the message of an AIOOBE from System.arraycopy differs between JDKs: only its class is compared
      res = c.equals("ArrayIndexOutOfBoundsException") ? "EX:" + c : exs(t) + " suppressed=" + GoldenStoreDir.suppressed(t);
    }
    return res + " log=[" + rec.drain() + "]";
  }

  static void javaStreams() {
    List<Object> scripts = new ArrayList<Object>();
    for (int sc = 0; sc < 30; sc++) {
      int kind = sc % 3; // 0: CheckedOutputStream, 1: FilterOutputStream, 2: BufferedOutputStream
      int cfg = (sc / 3) % 5;
      int bufSize = new int[] {1, 3, 8, 8192}[(sc / 15 + sc) % 4];
      Rec rec = new Rec(cfg == 1 ? 4 : 0, cfg == 2 || cfg == 4, cfg == 3 || cfg == 4);
      java.util.zip.CRC32 crc = new java.util.zip.CRC32();
      java.io.OutputStream s = kind == 0 ? new java.util.zip.CheckedOutputStream(rec, crc)
          : kind == 1 ? new java.io.FilterOutputStream(rec) : new java.io.BufferedOutputStream(rec, bufSize);
      List<Object> ops = new ArrayList<Object>();
      List<Object> results = new ArrayList<Object>();
      for (int i = 0; i < 34; i++) {
        List<Object> op;
        int k = r.nextInt(8);
        if (i == 32 || i == 33) op = L("close");
        else if (k < 3) op = L("wb", r.nextInt(900) - 300);
        else if (k < 6) {
          int len = r.nextInt(40);
          byte[] arr = new byte[len];
          r.nextBytes(arr);
          int off, n;
          if (kind == 1 && r.nextInt(3) == 0) { off = r.nextInt(len + 6) - 3; n = r.nextInt(len + 6) - 2; } // may be out of bounds
          else { off = len == 0 ? 0 : r.nextInt(len); n = r.nextInt(len - off + 1); }
          op = L("wbs", off, n, hex(arr));
        } else if (k == 6) op = L("flush");
        else op = kind == 0 ? L("crc") : L("flush");
        ops.add(op);
        results.add(execStream(s, crc, rec, op));
      }
      scripts.add(L(kind, cfg, bufSize, ops, results));
    }
    section("javaStreams", toJson(scripts));
  }

  // ---------------------------------------------------------------- what FileSwitch / NRT hand to their delegates
  static class Spy extends FilterDirectory {
    final StringBuilder log = new StringBuilder();
    Spy(Directory in) { super(in); }
    @Override public void sync(Collection<String> names) throws IOException { log.append("sync").append(names).append(' '); in.sync(names); }
    @Override public void close() throws IOException {
      String[] l = in.listAll();
      Arrays.sort(l);
      StringBuilder sb2 = new StringBuilder("atClose=[");
      for (String n : l) sb2.append(n).append(':').append(in.fileLength(n)).append(' ');
      log.append(sb2.toString().trim()).append("] ");
      in.close();
    }
    String drain() { String s = log.toString().trim(); log.setLength(0); return s; }
  }

  static void delegateCalls() throws IOException {
    Set<String> exts = new HashSet<String>(Arrays.asList("fdt", "fdx", "tim"));
    List<Object> sync = new ArrayList<Object>();
    for (int i = 0; i < 12; i++) {
      Spy p = new Spy(new RAMDirectory());
      Spy s = new Spy(new RAMDirectory());
      FileSwitchDirectory fsd = new FileSwitchDirectory(exts, p, s, false);
      List<Object> names = genNameList();
      fsd.sync((List<String>) (List<?>) names);
      sync.add(L(names, "p=" + p.drain() + " s=" + s.drain()));
    }
    section("fileSwitchSync", toJson(sync));

    List<Object> close = new ArrayList<Object>();
    for (int i = 0; i < 12; i++) {
      Spy spy = new Spy(new RAMDirectory());
      NRTCachingDirectory nrt = new NRTCachingDirectory(spy, 0.001, 0.01);
      List<Object> ops = new ArrayList<Object>();
      int n = 1 + r.nextInt(5);
      for (int j = 0; j < n; j++) {
        List<Object> op = L("write", NAMES[r.nextInt(NAMES.length)], genCtx(), GoldenStoreDir.genSteps());
        ops.add(op);
        common(nrt, op, new HashMap<String, Lock>());
      }
      String cached = sorted(nrt.listCachedFiles());
      spy.drain();
      nrt.close();
      close.add(L(ops, cached, spy.drain()));
    }
    section("nrtCloseSnapshot", toJson(close));
  }

  public static void main(String[] args) throws Exception {
    osio();
    rateLimited();
    simpleRateLimiter();
    fileSwitch();
    nrt();
    javaStreams();
    delegateCalls();
    System.out.println(sb.append("}").toString());
  }
}
