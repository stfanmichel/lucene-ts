import java.io.Closeable;
import java.io.IOException;
import java.util.*;
import org.apache.lucene.store.*;
import org.apache.lucene.util.*;

/**
 * Generates test/golden/store-dir.json from the original Lucene 5.2.1 classes Directory (copyFrom,
 * openChecksumInput), BaseDirectory, RAMDirectory, RAMFile, RAMInputStream, RAMOutputStream, FilterDirectory,
 * TrackingDirectoryWrapper, Lock (+Lock.With), SingleInstanceLockFactory, NoLockFactory, IOUtils, Accountables
 * and RamUsageEstimator.humanReadableUnits.
 *
 * Scripts of randomly generated operations are executed against the Java classes while they are generated;
 * the TypeScript test replays the same scripts and must obtain the same result for every operation.
 * Results are plain strings; an exception is "EX:SimpleClassName:message".
 */
public class GoldenStoreDir {
  static final Random r = new Random(20261120);
  static final StringBuilder sb = new StringBuilder("{");

  static String js(String s) { return GoldenStore.js(s); }
  static String hex(byte[] b) { return GoldenStore.hex(b); }

  static String exs(Throwable t) {
    String m = t.getMessage();
    return "EX:" + t.getClass().getSimpleName() + ":" + (m == null ? "" : m);
  }

  static String suppressed(Throwable t) {
    StringBuilder s = new StringBuilder("[");
    for (Throwable x : t.getSuppressed()) {
      if (s.length() > 1) s.append(", ");
      s.append(x.getClass().getSimpleName()).append(':').append(x.getMessage());
    }
    return s.append(']').toString();
  }

  static void section(String name, String json) {
    if (sb.length() > 1) sb.append(",\n");
    sb.append(js(name)).append(':').append(json);
  }

  @SuppressWarnings("unchecked")
  static String toJson(Object o) {
    if (o == null) return "null";
    if (o instanceof String) return js((String) o);
    if (o instanceof Integer) return o.toString();
    if (o instanceof Boolean) return o.toString();
    if (o instanceof List) {
      StringBuilder s = new StringBuilder("[");
      boolean first = true;
      for (Object e : (List<Object>) o) {
        if (!first) s.append(',');
        first = false;
        s.append(toJson(e));
      }
      return s.append(']').toString();
    }
    throw new AssertionError(o.getClass());
  }

  static List<Object> L(Object... a) { return new ArrayList<Object>(Arrays.asList(a)); }

  /** object identity hashes and package names are not comparable between JVM and JS */
  static String normalize(String s) {
    return s.replaceAll("(?:[\\w$]+[.$])*([\\w$]+)@[0-9a-f]+", "$1@H");
  }

  static final String[] NAMES = {"a", "b", "c.cfs", "seg_0.fnm", "zz"};
  static final int[] SIZES = {0, 1, 2, 100, 1023, 1024, 1025, 2047, 2048, 2049, 3000};

  static String randomString() {
    int n = r.nextInt(12);
    StringBuilder s = new StringBuilder();
    for (int i = 0; i < n; i++) {
      int k = r.nextInt(10);
      if (k < 7) s.append((char) ('a' + r.nextInt(26)));
      else if (k == 7) s.append((char) (0x80 + r.nextInt(0x700)));
      else if (k == 8) s.append((char) (0x800 + r.nextInt(0x1000)));
      else s.appendCodePoint(0x10000 + r.nextInt(0x1000));
    }
    return s.toString();
  }

  static byte[] randomBytes() {
    int len = r.nextBoolean() ? SIZES[r.nextInt(SIZES.length)] : r.nextInt(5000);
    byte[] b = new byte[len];
    r.nextBytes(b);
    return b;
  }

  /** a list of write steps: ["b",hex] ["B",n] ["vi",n] ["s",str] ["l","decimal"] */
  static List<Object> genSteps() {
    List<Object> steps = new ArrayList<Object>();
    int n = r.nextInt(6);
    for (int i = 0; i < n; i++) {
      switch (r.nextInt(5)) {
        case 0: steps.add(L("b", hex(randomBytes()))); break;
        case 1: steps.add(L("B", r.nextInt(256))); break;
        case 2: steps.add(L("vi", r.nextInt() >>> r.nextInt(32))); break;
        case 3: steps.add(L("s", randomString())); break;
        default: steps.add(L("l", Long.toString(r.nextLong() >> r.nextInt(64)))); break;
      }
    }
    return steps;
  }

  @SuppressWarnings("unchecked")
  static void applySteps(DataOutput o, List<Object> steps) throws IOException {
    for (Object so : steps) {
      List<Object> st = (List<Object>) so;
      switch ((String) st.get(0)) {
        case "b": { byte[] b = GoldenStore.unhex((String) st.get(1)); o.writeBytes(b, 0, b.length); break; }
        case "B": o.writeByte((byte) ((Integer) st.get(1)).intValue()); break;
        case "vi": o.writeVInt((Integer) st.get(1)); break;
        case "s": o.writeString((String) st.get(1)); break;
        case "l": o.writeLong(Long.parseLong((String) st.get(1))); break;
        default: throw new AssertionError(st.get(0));
      }
    }
  }

  static List<Object> genReadOps(int n, int depth) {
    List<Object> ops = new ArrayList<Object>();
    int count = 1 + r.nextInt(8);
    for (int i = 0; i < count; i++) {
      int k = r.nextInt(depth >= 2 ? 9 : 11);
      switch (k) {
        case 0: ops.add(L("seek", r.nextInt(n + 3))); break;
        case 1: ops.add(L("byte")); break;
        case 2: ops.add(L("int")); break;
        case 3: ops.add(L("vint")); break;
        case 4: ops.add(L("bytes", r.nextInt(Math.min(n, 2100) + 1))); break;
        case 5: ops.add(L("fp")); break;
        case 6: ops.add(L("len")); break;
        case 7: ops.add(L("skip", r.nextInt(Math.min(n, 2100) + 1))); break;
        case 8:
          // negative seeks are only specified for slices (IllegalArgumentException)
          if (depth > 0 && r.nextInt(3) == 0) ops.add(L("seek", -1 - r.nextInt(5)));
          else ops.add(L("seek", r.nextInt(n + 1)));
          break;
        case 9: {
          int off = r.nextInt(n + 1);
          int len = r.nextInt(n - off + 1);
          if (r.nextInt(8) == 0) len += 1 + r.nextInt(3); // out of bounds
          int effLen = Math.min(len, n - off);
          ops.add(L("slice", off, len, genReadOps(effLen, depth + 1)));
          break;
        }
        default: ops.add(L("clone", genReadOps(n, depth + 1))); break;
      }
    }
    return ops;
  }

  @SuppressWarnings("unchecked")
  static String execRead(IndexInput in, List<Object> ops) {
    StringBuilder out = new StringBuilder();
    for (Object oo : ops) {
      List<Object> op = (List<Object>) oo;
      String res;
      try {
        switch ((String) op.get(0)) {
          case "seek": in.seek((Integer) op.get(1)); res = "ok"; break;
          case "byte": res = "" + (in.readByte() & 0xff); break;
          case "int": res = "" + in.readInt(); break;
          case "vint": res = "" + in.readVInt(); break;
          case "bytes": { byte[] b = new byte[(Integer) op.get(1)]; in.readBytes(b, 0, b.length); res = hex(b); break; }
          case "fp": res = "" + in.getFilePointer(); break;
          case "len": res = "" + in.length(); break;
          case "skip": in.skipBytes((Integer) op.get(1)); res = "ok"; break;
          case "slice": {
            IndexInput s = in.slice("sl", (Integer) op.get(1), (Integer) op.get(2));
            res = "[" + execRead(s, (List<Object>) op.get(3)) + "]";
            break;
          }
          case "clone": res = "[" + execRead(in.clone(), (List<Object>) op.get(1)) + "]"; break;
          default: throw new AssertionError(op.get(0));
        }
      } catch (Throwable t) {
        res = exs(t);
      }
      if (out.length() > 0) out.append('|');
      out.append(res).append('@').append(in.getFilePointer());
    }
    return out.toString();
  }

  // ---- the RAMDirectory interpreter (the TypeScript test has the same one) ----
  @SuppressWarnings("unchecked")
  static String execDir(RAMDirectory d, List<Object> op) {
    try {
      switch ((String) op.get(0)) {
        case "write": {
          IndexOutput o = d.createOutput((String) op.get(1), IOContext.DEFAULT);
          applySteps(o, (List<Object>) op.get(2));
          String s = "fp=" + o.getFilePointer() + " crc=" + o.getChecksum();
          o.close();
          return s;
        }
        case "list": { String[] l = d.listAll(); Arrays.sort(l); return Arrays.toString(l); }
        case "length": return "" + d.fileLength((String) op.get(1));
        case "exists": return "" + d.fileNameExists((String) op.get(1));
        case "delete": d.deleteFile((String) op.get(1)); return "ok";
        case "rename": d.renameFile((String) op.get(1), (String) op.get(2)); return "ok";
        case "copy": d.copyFrom(d, (String) op.get(1), (String) op.get(2), IOContext.DEFAULT); return "ok";
        case "ram": return "" + d.ramBytesUsed();
        case "acct":
          return Accountables.toString(Accountables.namedAccountable("dir", d.getChildResources(), d.ramBytesUsed()));
        case "checksum": {
          ChecksumIndexInput ci = d.openChecksumInput((String) op.get(1), IOContext.READ);
          long len = ci.length();
          byte[] b = new byte[(int) len];
          ci.readBytes(b, 0, b.length);
          String s = "len=" + len + " crc=" + ci.getChecksum() + " fp=" + ci.getFilePointer() + " data=" + hex(b);
          ci.close();
          return s;
        }
        case "read": {
          IndexInput in = d.openInput((String) op.get(1), IOContext.READ);
          String s = execRead(in, (List<Object>) op.get(2));
          in.close();
          return s;
        }
        case "close": d.close(); return "ok";
        default: throw new AssertionError(op.get(0));
      }
    } catch (Throwable t) {
      return exs(t);
    }
  }

  static void ramScripts() {
    List<Object> scripts = new ArrayList<Object>();
    for (int sc = 0; sc < 14; sc++) {
      RAMDirectory d = new RAMDirectory();
      List<Object> ops = new ArrayList<Object>();
      List<Object> results = new ArrayList<Object>();
      int nops = 60 + r.nextInt(40);
      for (int i = 0; i < nops + 8; i++) {
        String name = NAMES[r.nextInt(NAMES.length)];
        List<Object> op;
        if (i == nops) op = L("close");
        else if (i > nops) op = new ArrayList<Object>(Arrays.asList(new Object[][] {
          {"list"}, {"length", "a"}, {"exists", "a"}, {"ram"}, {"delete", "a"}, {"write", "a", L()}, {"read", "a", L()}}[i - nops - 1]));
        else {
          int k = r.nextInt(16);
          if (k < 4) op = L("write", name, genSteps());
          else if (k < 6) op = L("list");
          else if (k == 6) op = L("length", name);
          else if (k == 7) op = L("exists", name);
          else if (k == 8) op = L("delete", name);
          else if (k == 9) op = L("rename", name, NAMES[r.nextInt(NAMES.length)]);
          else if (k == 10) op = L("copy", name, NAMES[r.nextInt(NAMES.length)]);
          else if (k == 11) op = L("ram");
          else if (k == 12) op = L("acct");
          else if (k == 13) op = L("checksum", name);
          else {
            int n;
            try { n = (int) d.fileLength(name); } catch (IOException e) { n = 5; }
            op = L("read", name, genReadOps(n, 0));
          }
        }
        ops.add(op);
        results.add(execDir(d, op));
      }
      scripts.add(L(ops, results));
    }
    section("ramScripts", toJson(scripts));
  }

  // ---- RAMOutputStream on its own ----
  @SuppressWarnings("unchecked")
  static String execOut(RAMOutputStream o, List<Object> op) {
    try {
      switch ((String) op.get(0)) {
        case "write": applySteps(o, (List<Object>) op.get(1)); return "fp=" + o.getFilePointer();
        case "fp": return "" + o.getFilePointer();
        case "crc": return "" + o.getChecksum();
        case "ram": return "" + o.ramBytesUsed();
        case "writeToOut": {
          java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
          OutputStreamDataOutput out = new OutputStreamDataOutput(bos);
          o.writeTo(out);
          return hex(bos.toByteArray());
        }
        case "writeToBytes": {
          int offset = (Integer) op.get(1);
          // the file length is only known after flush; size the array generously
          byte[] arr = new byte[offset + 6000];
          Arrays.fill(arr, (byte) 0x55);
          o.writeTo(arr, offset);
          int end = arr.length;
          while (end > 0 && arr[end - 1] == 0x55) end--; // trim the untouched marker tail
          return hex(Arrays.copyOf(arr, end));
        }
        case "reset": o.reset(); return "ok";
        case "toString": return o.toString();
        case "close": o.close(); return "ok";
        default: throw new AssertionError(op.get(0));
      }
    } catch (Throwable t) {
      return exs(t);
    }
  }

  static void ramOutScripts() throws IOException {
    List<Object> scripts = new ArrayList<Object>();
    for (int sc = 0; sc < 12; sc++) {
      int variant = sc % 3; // 0: (), 1: (file, checksum), 2: (name, file, checksum)
      boolean checksum = variant == 0 ? false : (sc % 2 == 0);
      RAMFile file = new RAMFile();
      RAMOutputStream o = variant == 0 ? new RAMOutputStream()
          : variant == 1 ? new RAMOutputStream(file, checksum) : new RAMOutputStream("nm", file, checksum);
      List<Object> ops = new ArrayList<Object>();
      List<Object> results = new ArrayList<Object>();
      for (int i = 0; i < 27; i++) {
        List<Object> op;
        int k = r.nextInt(9);
        if (i == 25) op = L("toString");
        else if (i == 26) op = L("close");
        else if (k < 3) op = L("write", genSteps());
        else if (k == 3) op = L("fp");
        else if (k == 4) op = L("crc");
        else if (k == 5) op = L("ram");
        else if (k == 6) op = L("writeToOut");
        else if (k == 7) op = L("writeToBytes", r.nextInt(4));
        else op = L("reset");
        ops.add(op);
        results.add(execOut(o, op));
      }
      ops.add(L("lengthAfterClose")); results.add("" + file.getLength());
      scripts.add(L(variant, checksum, ops, results));
    }
    section("ramOutScripts", toJson(scripts));
  }

  // ---- RAMFile hashCode / equals / toString ----
  static void ramFiles() throws IOException {
    byte[][] pool = new byte[4][];
    for (int i = 0; i < pool.length; i++) pool[i] = randomBytes();
    pool[3] = pool[0].clone();
    pool[2] = new byte[] {'a', 'b', 'c'};
    List<RAMFile> files = new ArrayList<RAMFile>();
    List<Object> contents = new ArrayList<Object>();
    for (int i = 0; i < 12; i++) {
      // files 10 and 11: same buffer contents ("abc" + zeros), different lengths
      byte[] data = i < 8 ? pool[i % 4] : i == 10 ? new byte[] {'a', 'b', 'c', 0, 0} : i == 11 ? new byte[] {'a', 'b', 'c'} : randomBytes();
      RAMFile f = new RAMFile();
      RAMOutputStream o = new RAMOutputStream(f, false);
      // different chunkings of the same bytes must give the same file
      int step = i % 2 == 0 ? Math.max(1, data.length) : 97;
      for (int p = 0; p < data.length; p += step) o.writeBytes(data, p, Math.min(step, data.length - p));
      o.close();
      files.add(f);
      contents.add(hex(data));
    }
    List<Object> hashes = new ArrayList<Object>();
    List<Object> strings = new ArrayList<Object>();
    List<Object> equal = new ArrayList<Object>();
    for (RAMFile f : files) {
      hashes.add(f.hashCode());
      strings.add(f.toString());
      StringBuilder row = new StringBuilder();
      for (RAMFile g : files) row.append(f.equals(g) ? '1' : '0');
      equal.add(row.toString());
    }
    equal.add("" + files.get(0).equals(null) + files.get(0).equals("x") + files.get(0).equals(files.get(0)));
    section("ramFiles", toJson(L(contents, hashes, strings, equal)));
  }

  // ---- locks ----
  static String execLock(SingleInstanceLockFactory f, Directory dir, Lock[] locks, List<Object> op) {
    try {
      int id = (Integer) op.get(1);
      switch ((String) op.get(0)) {
        case "make": locks[id] = f.makeLock(dir, (String) op.get(2)); return "ok";
        case "obtain": return "" + locks[id].obtain();
        case "close": locks[id].close(); return "ok";
        case "isLocked": return "" + locks[id].isLocked();
        case "toString": return normalize(locks[id].toString());
        default: throw new AssertionError(op.get(0));
      }
    } catch (Throwable t) {
      return exs(t);
    }
  }

  static void singleInstanceLocks() throws IOException {
    RAMDirectory dir = new RAMDirectory();
    List<Object> scripts = new ArrayList<Object>();
    for (int sc = 0; sc < 6; sc++) {
      SingleInstanceLockFactory f = new SingleInstanceLockFactory();
      Lock[] locks = new Lock[4];
      List<Object> ops = new ArrayList<Object>();
      List<Object> results = new ArrayList<Object>();
      for (int i = 0; i < 60; i++) {
        int id = r.nextInt(4);
        int k = r.nextInt(8);
        List<Object> op;
        if (locks[id] == null || k == 0) op = L("make", id, r.nextBoolean() ? "w" : "x");
        else if (k < 4) op = L("obtain", id);
        else if (k == 4) op = L("close", id);
        else if (k == 5) op = L("isLocked", id);
        else op = L("toString", id);
        ops.add(op);
        results.add(execLock(f, dir, locks, op));
      }
      scripts.add(L(ops, results));
    }
    section("singleInstanceLocks", toJson(scripts));

    // NoLockFactory
    Lock a = NoLockFactory.INSTANCE.makeLock(dir, "a");
    Lock b = NoLockFactory.INSTANCE.makeLock(dir, "b");
    section("noLock", toJson(L("" + a.obtain(), "" + a.isLocked(), a.toString(), "" + (a == b), "" + a.obtain(1000))));
  }

  static class ScriptedLock extends Lock {
    final boolean[] outcomes;
    final String reason;
    int calls = 0;
    int closes = 0;
    boolean reasonOnlyFirst = false;
    ScriptedLock(boolean[] outcomes, String reason) { this.outcomes = outcomes; this.reason = reason; }
    @Override public boolean obtain() throws IOException {
      boolean ok = calls < outcomes.length && outcomes[calls];
      calls++;
      if (!ok && reason != null && (!reasonOnlyFirst || calls == 1)) failureReason = new IOException(reason);
      return ok;
    }
    @Override public void close() { closes++; }
    @Override public boolean isLocked() { return false; }
    @Override public String toString() { return "ScriptedLock"; }
  }

  static String lockResult(Throwable t) {
    Throwable c = t.getCause();
    return exs(t) + " cause=" + (c == null ? "null" : c.getClass().getSimpleName() + ":" + c.getMessage());
  }

  static void lockWait() {
    boolean[][] outcomes = {{}, {true}, {false, true}, {false, false, true}, {false, false, false, false, true}};
    long[] timeouts = {0, 1, 2, 3, 5, -1, -2, -5};
    String[] reasons = {null, "boom"};
    List<Object> cases = new ArrayList<Object>();
    for (boolean[] oc : outcomes) {
      for (long to : timeouts) {
        if (to == -1 && !Arrays.toString(oc).contains("true")) continue;
        for (String reason : reasons) {
          ScriptedLock l = new ScriptedLock(oc, reason);
          String res;
          try { res = "" + l.obtain(to); } catch (Throwable t) { res = lockResult(t); }
          StringBuilder oc2 = new StringBuilder();
          for (boolean b : oc) oc2.append(b ? '1' : '0');
          cases.add(L(oc2.toString(), "" + to, reason, res + " calls=" + l.calls));
        }
      }
    }
    section("lockWait", toJson(cases));

    // the same Lock object used for several obtain(timeout) calls: failureReason must be reset by each call
    List<Object> reuse = new ArrayList<Object>();
    ScriptedLock rl = new ScriptedLock(new boolean[] {false, false, false, false, true}, "stale");
    rl.reasonOnlyFirst = true;
    for (long to : new long[] {0, 0, 1, 5}) {
      String res;
      try { res = "" + rl.obtain(to); } catch (Throwable t) { res = lockResult(t); }
      reuse.add(res + " calls=" + rl.calls);
    }
    section("lockWaitReuse", toJson(reuse));

    List<Object> with = new ArrayList<Object>();
    // outcomes, timeout, body kind: "ok" | "throw"
    Object[][] wc = {{new boolean[]{true}, 0L, "ok"}, {new boolean[]{false, true}, 5L, "ok"},
        {new boolean[]{false, false}, 1L, "ok"}, {new boolean[]{true}, 0L, "throw"}, {new boolean[]{}, -3L, "ok"}};
    for (Object[] c : wc) {
      final ScriptedLock l = new ScriptedLock((boolean[]) c[0], null);
      final String kind = (String) c[2];
      final int[] bodyRuns = {0};
      String res;
      try {
        Object v = new Lock.With(l, (Long) c[1]) {
          @Override protected Object doBody() {
            bodyRuns[0]++;
            if (kind.equals("throw")) throw new RuntimeException("body failed");
            return "body-result";
          }
        }.run();
        res = "" + v;
      } catch (Throwable t) { res = exs(t); }
      StringBuilder oc2 = new StringBuilder();
      for (boolean b : (boolean[]) c[0]) oc2.append(b ? '1' : '0');
      with.add(L(oc2.toString(), "" + c[1], kind, res + " body=" + bodyRuns[0] + " closes=" + l.closes + " calls=" + l.calls));
    }
    section("lockWith", toJson(with));
  }

  // ---- Directory.copyFrom with failures ----
  static class FIn extends IndexInput {
    final IndexInput in; final boolean failRead, failClose;
    FIn(IndexInput in, boolean failRead, boolean failClose) { super("FIn"); this.in = in; this.failRead = failRead; this.failClose = failClose; }
    @Override public void close() throws IOException { in.close(); if (failClose) throw new IOException("is close failed"); }
    @Override public long getFilePointer() { return in.getFilePointer(); }
    @Override public void seek(long pos) throws IOException { in.seek(pos); }
    @Override public long length() { return in.length(); }
    @Override public IndexInput slice(String d, long o, long l) throws IOException { return in.slice(d, o, l); }
    @Override public byte readByte() throws IOException { return in.readByte(); }
    @Override public void readBytes(byte[] b, int o, int l) throws IOException {
      if (failRead) throw new IOException("read failed");
      in.readBytes(b, o, l);
    }
  }

  static class FOut extends IndexOutput {
    final IndexOutput o; final boolean failWrite, failClose;
    FOut(IndexOutput o, boolean failWrite, boolean failClose) { super("FOut"); this.o = o; this.failWrite = failWrite; this.failClose = failClose; }
    @Override public void close() throws IOException { o.close(); if (failClose) throw new IOException("os close failed"); }
    @Override public long getFilePointer() { return o.getFilePointer(); }
    @Override public long getChecksum() throws IOException { return o.getChecksum(); }
    @Override public void writeByte(byte b) throws IOException { o.writeByte(b); }
    @Override public void writeBytes(byte[] b, int off, int len) throws IOException {
      if (failWrite) throw new IOException("write failed");
      o.writeBytes(b, off, len);
    }
  }

  static class FDir extends FilterDirectory {
    final boolean failRead, failIsClose, failOsClose, failWrite;
    FDir(Directory in, boolean a, boolean b, boolean c, boolean d) { super(in); failRead = a; failIsClose = b; failOsClose = c; failWrite = d; }
    @Override public IndexInput openInput(String n, IOContext c) throws IOException { return new FIn(in.openInput(n, c), failRead, failIsClose); }
    @Override public IndexOutput createOutput(String n, IOContext c) throws IOException { return new FOut(in.createOutput(n, c), failWrite, failOsClose); }
  }

  static void copyFromCases() throws IOException {
    byte[] data = new byte[3000];
    r.nextBytes(data);
    List<Object> cases = new ArrayList<Object>();
    for (int mask = 0; mask < 64; mask++) {
      boolean fr = (mask & 1) != 0, fic = (mask & 2) != 0, foc = (mask & 4) != 0, fw = (mask & 8) != 0;
      boolean missing = (mask & 16) != 0, destExists = (mask & 32) != 0;
      RAMDirectory base = new RAMDirectory();
      if (!missing) {
        IndexOutput o = base.createOutput("src", IOContext.DEFAULT);
        o.writeBytes(data, 0, data.length);
        o.close();
      }
      if (destExists) {
        IndexOutput o = base.createOutput("dest", IOContext.DEFAULT);
        o.writeByte((byte) 7);
        o.close();
      }
      FDir fd = new FDir(base, fr, fic, foc, fw);
      String res;
      try {
        fd.copyFrom(fd, "src", "dest", IOContext.DEFAULT);
        res = "ok";
      } catch (Throwable t) {
        res = exs(t) + " suppressed=" + suppressed(t);
      }
      String[] files = base.listAll();
      Arrays.sort(files);
      String destLen = base.fileNameExists("dest") ? "" + base.fileLength("dest") : "none";
      cases.add(L(mask, res + " files=" + Arrays.toString(files) + " destLen=" + destLen));
    }
    section("copyFrom", toJson(cases));
  }

  // ---- TrackingDirectoryWrapper / FilterDirectory ----
  static String execTrack(TrackingDirectoryWrapper t, RAMDirectory from, List<Object> op) {
    try {
      switch ((String) op.get(0)) {
        case "create": { IndexOutput o = t.createOutput((String) op.get(1), IOContext.DEFAULT); o.writeByte((byte) 1); o.close(); return "ok"; }
        case "delete": t.deleteFile((String) op.get(1)); return "ok";
        case "rename": t.renameFile((String) op.get(1), (String) op.get(2)); return "ok";
        case "copy": t.copyFrom(from, (String) op.get(1), (String) op.get(2), IOContext.DEFAULT); return "ok";
        case "created": return "ok";
        default: throw new AssertionError(op.get(0));
      }
    } catch (Throwable e) {
      return exs(e);
    }
  }

  static void tracking() throws IOException {
    List<Object> scripts = new ArrayList<Object>();
    for (int sc = 0; sc < 6; sc++) {
      RAMDirectory inner = new RAMDirectory();
      RAMDirectory from = new RAMDirectory();
      for (String n : new String[] {"f1", "f2"}) {
        IndexOutput o = from.createOutput(n, IOContext.DEFAULT);
        o.writeString(n);
        o.close();
      }
      TrackingDirectoryWrapper t = new TrackingDirectoryWrapper(inner);
      List<Object> ops = new ArrayList<Object>();
      List<Object> results = new ArrayList<Object>();
      for (int i = 0; i < 40; i++) {
        String name = NAMES[r.nextInt(NAMES.length)];
        List<Object> op;
        int k = r.nextInt(6);
        if (k == 0 || k == 1) op = L("create", name);
        else if (k == 2) op = L("delete", name);
        else if (k == 3) op = L("rename", name, NAMES[r.nextInt(NAMES.length)]);
        else if (k == 4) op = L("copy", r.nextBoolean() ? "f1" : "f2", name);
        else op = L("created");
        String res = execTrack(t, from, op);
        List<String> created = new ArrayList<String>(t.getCreatedFiles());
        Collections.sort(created);
        String[] l = inner.listAll();
        Arrays.sort(l);
        ops.add(op);
        results.add(res + " created=" + created + " inner=" + Arrays.toString(l));
      }
      scripts.add(L(ops, results));
    }
    section("tracking", toJson(scripts));

    RAMDirectory base = new RAMDirectory();
    TrackingDirectoryWrapper t1 = new TrackingDirectoryWrapper(base);
    TrackingDirectoryWrapper t2 = new TrackingDirectoryWrapper(t1);
    section("filterDirectory", toJson(L(
        normalize(base.toString()),
        normalize(t1.toString()),
        normalize(t2.toString()),
        normalize(new RAMDirectory(NoLockFactory.INSTANCE).toString()),
        "" + (FilterDirectory.unwrap(t2) == base),
        "" + (FilterDirectory.unwrap(base) == base),
        "" + (t2.getDelegate() == t1),
        normalize(t1.makeLock("x").toString()),
        npe())));
  }

  static String npe() {
    try { new RAMDirectory((LockFactory) null); return "no exception"; } catch (Throwable t) { return exs(t); }
  }

  // ---- IOUtils ----
  static class TestCloseable implements Closeable {
    final String kind; final String msg; boolean closed;
    TestCloseable(String kind, String msg) { this.kind = kind; this.msg = msg; }
    @Override public void close() throws IOException {
      closed = true;
      if (kind.equals("io")) throw new IOException(msg);
      if (kind.equals("rt")) throw new IllegalStateException(msg);
      if (kind.equals("err")) throw new AssertionError(msg);
    }
  }

  static String outcome(Throwable t) {
    if (t == null) return "ok";
    return exs(t) + " suppressed=" + suppressed(t);
  }

  static void ioUtils() {
    List<Object> cases = new ArrayList<Object>();
    String[] kinds = {"ok", "ok", "null", "io", "rt", "err"};
    for (int i = 0; i < 80; i++) {
      int n = r.nextInt(6);
      List<Object> specs = new ArrayList<Object>();
      TestCloseable[] cl1 = new TestCloseable[n];
      TestCloseable[] cl2 = new TestCloseable[n];
      for (int j = 0; j < n; j++) {
        String kind = kinds[r.nextInt(kinds.length)];
        String msg = "m" + j;
        specs.add(L(kind, msg));
        if (!kind.equals("null")) { cl1[j] = new TestCloseable(kind, msg); cl2[j] = new TestCloseable(kind, msg); }
      }
      Throwable t1 = null, t2 = null;
      try { IOUtils.close(cl1); } catch (Throwable t) { t1 = t; }
      IOUtils.closeWhileHandlingException(cl2);
      StringBuilder closed = new StringBuilder();
      for (int j = 0; j < n; j++) closed.append(cl1[j] == null ? '-' : cl1[j].closed ? '1' : '0').append(cl2[j] == null ? '-' : cl2[j].closed ? '1' : '0').append(' ');
      cases.add(L(specs, outcome(t1) + " closed=" + closed.toString().trim()));
    }
    section("ioutilsClose", toJson(cases));

    List<Object> rethrow = new ArrayList<Object>();
    Throwable[] ts = {null, new IOException("io"), new IllegalStateException("rt"), new AssertionError("err"), new Exception("checked")};
    for (Throwable t : ts) {
      String a, b;
      try { IOUtils.reThrow(t); a = "ok"; } catch (Throwable x) { a = x.getClass().getSimpleName() + (x == t ? "=same" : " cause=" + (x.getCause() == null ? "null" : x.getCause().getClass().getSimpleName() + ":" + x.getCause().getMessage())); }
      try { IOUtils.reThrowUnchecked(t); b = "ok"; } catch (Throwable x) { b = x.getClass().getSimpleName() + (x == t ? "=same" : " cause=" + (x.getCause() == null ? "null" : x.getCause().getClass().getSimpleName() + ":" + x.getCause().getMessage())); }
      rethrow.add(L(t == null ? "null" : t.getClass().getSimpleName() + ":" + t.getMessage(), a, b));
    }
    section("ioutilsRethrow", toJson(rethrow));

    // deleteFilesIgnoringExceptions
    RAMDirectory d = new RAMDirectory();
    try {
      IndexOutput o = d.createOutput("x", IOContext.DEFAULT); o.close();
      o = d.createOutput("y", IOContext.DEFAULT); o.close();
    } catch (IOException e) { throw new AssertionError(e); }
    IOUtils.deleteFilesIgnoringExceptions(d, "x", "missing", "y");
    section("ioutilsDelete", toJson(L(Arrays.toString(d.listAll()))));
  }

  // ---- Accountables / humanReadableUnits ----
  static class Node implements Accountable {
    final String desc; final long bytes; final List<Accountable> kids = new ArrayList<Accountable>();
    Node(String desc, long bytes, Accountable... k) { this.desc = desc; this.bytes = bytes; kids.addAll(Arrays.asList(k)); }
    @Override public long ramBytesUsed() { return bytes; }
    @Override public Collection<Accountable> getChildResources() { return kids; }
    @Override public String toString() { return desc; }
  }

  static void accountables() {
    Node tree = new Node("root", 5L * 1024 * 1024 + 300000,
        new Node("a", 1500, new Node("a1", 10), new Node("a2", 2048, new Node("deep", 1))),
        new Node("b", 3L * 1024 * 1024 * 1024 + 1234567));
    Accountable named = Accountables.namedAccountable("named", tree);
    Accountable plain = Accountables.namedAccountable("plain", 12345L);
    Map<Object, Accountable> m = new HashMap<Object, Accountable>();
    for (String k : new String[] {"b", "a", "B", "10", "9", "aa", "é", "Z"}) m.put(k, new Node("n-" + k, k.length() * 100L));
    StringBuilder kids = new StringBuilder();
    for (Accountable a : Accountables.namedAccountables("file", m)) kids.append(a.toString()).append(':').append(a.ramBytesUsed()).append(';');
    section("accountables", toJson(L(
        Accountables.toString(tree),
        Accountables.toString(named),
        Accountables.toString(plain),
        named.toString() + "|" + named.ramBytesUsed() + "|" + named.getChildResources().size(),
        kids.toString())));

    long[] values = {0, 1, 1023, 1024, 1025, 1280, 1536, 1792, 2560, 1048575, 1048576, 1048577, 1310720, 1572864, 1835008,
        5L * 1048576 + 52429, 1073741823L, 1073741824L, 1073741825L, 1610612736L, 5368709120L, 1099511627776L,
        4503599627370496L, Long.MAX_VALUE, -1, -1024, -1048576, -5};
    List<Object> units = new ArrayList<Object>();
    for (long v : values) units.add(L("" + v, RamUsageEstimator.humanReadableUnits(v)));
    Random rr = new Random(7);
    for (int i = 0; i < 400; i++) {
      long v = rr.nextLong() >>> (1 + rr.nextInt(63));
      units.add(L("" + v, RamUsageEstimator.humanReadableUnits(v)));
    }
    // exact ties on the first decimal (HALF_EVEN): n + 0.05 and n + 0.15 KB, etc. are not representable, so use .25/.75
    for (int i = 0; i < 40; i++) {
      long v = (long) (i * 1024 + 256 * (1 + 2 * (i % 2)) + (i % 4 == 0 ? 0 : 0)) * 1;
      units.add(L("" + v, RamUsageEstimator.humanReadableUnits(v)));
      long w = v * 1024;
      units.add(L("" + w, RamUsageEstimator.humanReadableUnits(w)));
      long x = w * 1024;
      units.add(L("" + x, RamUsageEstimator.humanReadableUnits(x)));
    }
    section("humanReadableUnits", toJson(units));
  }

  static void toStrings() throws IOException {
    RAMDirectory d = new RAMDirectory();
    IndexOutput o = d.createOutput("a", IOContext.DEFAULT);
    o.writeByte((byte) 1);
    o.close();
    IndexInput in = d.openInput("a", IOContext.READ);
    IndexInput sl = in.slice("part", 0, 1);
    IndexInput sl2 = sl.slice(null, 0, 1);
    section("toStrings", toJson(L(in.toString(), sl.toString(), sl2.toString(), new RAMFile().toString(),
        new RAMOutputStream().toString(), new RAMOutputStream("zz", new RAMFile(), true).toString())));
  }

  public static void main(String[] args) throws Exception {
    Lock.LOCK_POLL_INTERVAL = 1;
    ramScripts();
    ramOutScripts();
    ramFiles();
    singleInstanceLocks();
    lockWait();
    copyFromCases();
    tracking();
    ioUtils();
    accountables();
    toStrings();
    System.out.println(sb.append("}").toString());
  }
}
