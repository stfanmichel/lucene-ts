package org.apache.lucene.store;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import org.apache.lucene.util.IOUtils;

/**
 * Generates test/golden/store-fs.json from the original Lucene 5.2.1 file-system classes: FSDirectory,
 * SimpleFSDirectory, NIOFSDirectory, MMapDirectory (+ ByteBufferIndexInput, which is package-private, hence the
 * package), SimpleFSLockFactory, NativeFSLockFactory, FSLockFactory, VerifyingLockFactory and IOUtils.fsync/rm,
 * and from the JDK's java.nio.ByteBuffer that the TypeScript port emulates.
 *
 * Usage: java org.apache.lucene.store.GoldenStoreFS BASEDIR   (BASEDIR must exist and be empty-ish; scripts use
 * sub-directories of it, named s0, s1, ...). The base directory is replaced by "<D>" in every recorded string.
 *
 * Scripts of random operations are generated AND executed here; each recorded entry is [op..., result] and the
 * TypeScript test replays the ops and compares every result string ("EX:SimpleClassName:message" for exceptions).
 */
public class GoldenStoreFS {
  static final Random r = new Random(20261120);
  static final StringBuilder sb = new StringBuilder("{");
  static Path base;
  static String baseStr;

  static String js(String s) { return js0(s); }
  static String js0(String s) {
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

  /** the base directory, package names and identity hashes are not comparable between runs / JVM and JS */
  static String norm(String s) {
    s = s.replace(baseStr, "<D>");
    s = s.replaceAll("\\b(?:java|javax)\\.(?:[a-z]+\\.)+", "");
    return s.replaceAll("(?:[\\w$]+[.$])*([\\w$]+)@[0-9a-f]+", "$1@H");
  }

  static String exs(Throwable t) {
    String m = t.getMessage();
    return norm("EX:" + t.getClass().getSimpleName() + ":" + (m == null ? "" : m));
  }

  static List<Object> L(Object... a) { return new ArrayList<Object>(Arrays.asList(a)); }

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

  static void section(String name, String json) {
    if (sb.length() > 1) sb.append(",\n");
    sb.append(js(name)).append(':').append(json);
  }

  interface Thrower { String run() throws Exception; }
  static String res(Thrower f) {
    try {
      return norm(f.run());
    } catch (Throwable t) {
      return exs(t);
    }
  }

  static int ri(int n) { return r.nextInt(n); }
  static <T> T pick(T[] a) { return a[r.nextInt(a.length)]; }
  static int pick(int[] a) { return a[r.nextInt(a.length)]; }

  static byte[] randomBytes(int n) {
    byte[] b = new byte[n];
    r.nextBytes(b);
    return b;
  }

  static IOContext ctx(int k) {
    switch (k) {
      case 0: return IOContext.DEFAULT;
      case 1: return IOContext.READONCE;
      case 2: return IOContext.READ;
      default: return new IOContext(new MergeInfo(10, 1000, false, 1));
    }
  }

  // ---------------------------------------------------------------- java.nio.ByteBuffer
  static void byteBuffer() {
    List<Object> scripts = new ArrayList<Object>();
    for (int s = 0; s < 120; s++) {
      List<Object> ops = new ArrayList<Object>();
      ArrayList<ByteBuffer> stack = new ArrayList<ByteBuffer>();
      int n0 = ri(20);
      byte[] arr = new byte[n0];
      for (int i = 0; i < n0; i++) arr[i] = (byte) (i * 37 + 5 + s);
      stack.add(ByteBuffer.wrap(arr));
      ops.add(L(L("new", n0, s), "cap=" + n0));
      for (int k = 0; k < 40; k++) {
        ByteBuffer b = stack.get(stack.size() - 1);
        int cap = b.capacity();
        int pp = ri(cap + 4) - 2;
        List<Object> op = null;
        String res;
        try {
          switch (ri(21)) {
            case 0: op = L("clear"); b.clear(); res = "ok"; break;
            case 1: op = L("pos", pp); b.position(pp); res = "ok"; break;
            case 2: op = L("lim", pp); b.limit(pp); res = "ok"; break;
            case 3: op = L("getPos"); res = "" + b.position(); break;
            case 4: op = L("getLim"); res = "" + b.limit(); break;
            case 5: op = L("rem"); res = b.remaining() + "/" + b.hasRemaining(); break;
            case 6: op = L("get"); res = "" + (b.get() & 0xff); break;
            case 7: op = L("getAt", pp); res = "" + (b.get(pp) & 0xff); break;
            case 8: {
              int dl = ri(12), off = ri(dl + 3) - 1, len = ri(8) - (ri(8) == 0 ? 1 : 0);
              op = L("bulk", dl, off, len);
              byte[] dst = new byte[dl];
              Arrays.fill(dst, (byte) 0x77);
              try {
                b.get(dst, off, len);
                res = "ok:" + hex(dst);
              } catch (Throwable t) {
                res = exs(t) + "|" + hex(dst);
              }
              break;
            }
            case 9: op = L("short"); res = "" + b.getShort(); break;
            case 10: op = L("int"); res = "" + b.getInt(); break;
            case 11: op = L("long"); res = "" + b.getLong(); break;
            case 12: op = L("shortAt", pp); res = "" + b.getShort(pp); break;
            case 13: op = L("intAt", pp); res = "" + b.getInt(pp); break;
            case 14: op = L("longAt", pp); res = "" + b.getLong(pp); break;
            case 15: op = L("dup"); stack.add(b.duplicate()); res = "ok"; break;
            case 16: op = L("slice"); stack.add(b.slice()); res = "ok"; break;
            case 17: op = L("pop"); if (stack.size() > 1) { stack.remove(stack.size() - 1); res = "ok"; } else res = "none"; break;
            case 18: op = L("cap"); res = "" + cap; break;
            case 19: {
              int len = ri(cap + 3), off = ri(cap + 3);
              op = L("wrap", n0, off, len);
              ByteBuffer w = ByteBuffer.wrap(arr, off, len);
              stack.add(w);
              res = w.position() + "/" + w.limit() + "/" + w.capacity();
              break;
            }
            default: { int l = ri(cap + 3); op = L("posLim", pp, l); b.limit(l); b.position(pp); res = "ok"; } break;
          }
        } catch (Throwable t) {
          res = exs(t);
        }
        ops.add(L(op, norm(res)));
      }
      scripts.add(ops);
    }
    section("byteBuffer", toJson(scripts));
  }

  // ---------------------------------------------------------------- scripted reads on an IndexInput
  /** a stack of inputs (root, slices, clones); ops apply to the top one */
  static class Session {
    final ArrayList<IndexInput> stack = new ArrayList<IndexInput>();
    final IndexInput root;
    final boolean random;
    final StringBuilder log = new StringBuilder();
    Session(IndexInput root) {
      this.root = root;
      stack.add(root);
      random = root instanceof RandomAccessInput;
    }
    IndexInput top() { return stack.get(stack.size() - 1); }

    /** Generate one op from the current state, run it, return [op, result]. */
    List<Object> next() {
      IndexInput in = top();
      long len = in.length();
      int l = (int) Math.min(len, 100000);
      int k = ri(100);
      List<Object> op;
      if (k < 14) op = L("rb");
      else if (k < 26) op = L("rbs", ri(Math.min(l + 4, 24)) + (ri(10) == 0 ? l : 0), ri(5), 0);
      else if (k < 30) op = L("rbs", ri(Math.min(l + 4, 40)), ri(5), 1 + ri(2));
      else if (k < 34) op = L("rs");
      else if (k < 38) op = L("ri");
      else if (k < 42) op = L("rl");
      else if (k < 45) op = L("rvi");
      else if (k < 48) op = L("rvl");
      else if (k < 60) {
        int[] c = {0, l, l + 1, ri(l + 1), ri(l + 1), ri(l + 1), -1, ri(l + 3)};
        op = L("seek", pick(c));
      }
      else if (k < 63) op = L("fp");
      else if (k < 65) op = L("len");
      else if (k < 77) {
        int p = ri(l + 12) - 2;
        op = L("at", pick(new String[] {"b", "s", "i", "l"}), p);
      }
      else if (k < 84) {
        int off = ri(l + 1), n = ri(l - off + 1);
        if (ri(8) == 0) { off = ri(l + 5) - 1; n = ri(l + 5) - 1; }
        op = L("slice", off, n);
      }
      else if (k < 89) op = L("clone");
      else if (k < 93) op = L("pop");
      else if (k < 96) op = L("str");
      else if (k < 98) op = L("close");
      else op = L("rbs", 0, 0, 0);
      return L(op, run(op));
    }

    String run(List<Object> op) {
      final IndexInput in = top();
      final String o = (String) op.get(0);
      return res(() -> {
        switch (o) {
          case "rb": return "" + (in.readByte() & 0xff);
          case "rbs": {
            int n = (Integer) op.get(1), off = (Integer) op.get(2), mode = (Integer) op.get(3);
            byte[] arr = new byte[off + n + 2];
            Arrays.fill(arr, (byte) 0x77);
            String res;
            try {
              if (mode == 0) in.readBytes(arr, off, n);
              else in.readBytes(arr, off, n, mode == 2);
              res = "ok";
            } catch (Throwable t) {
              res = exs(t);
            }
            return res + "|" + hex(arr);
          }
          case "rs": return "" + in.readShort();
          case "ri": return "" + in.readInt();
          case "rl": return "" + in.readLong();
          case "rvi": return "" + in.readVInt();
          case "rvl": return "" + in.readVLong();
          case "seek": in.seek((Integer) op.get(1)); return "ok";
          case "fp": return "" + in.getFilePointer();
          case "len": return "" + in.length();
          case "at": {
            if (!random) return "NA";
            RandomAccessInput ra = (RandomAccessInput) in;
            int p = (Integer) op.get(2);
            switch ((String) op.get(1)) {
              case "b": return "" + (ra.readByte(p) & 0xff);
              case "s": return "" + ra.readShort(p);
              case "i": return "" + ra.readInt(p);
              default: return "" + ra.readLong(p);
            }
          }
          case "slice": stack.add(in.slice("sl" + stack.size(), (Integer) op.get(1), (Integer) op.get(2))); return "ok";
          case "clone": stack.add(in.clone()); return "ok";
          case "pop": if (stack.size() > 1) { stack.remove(stack.size() - 1); return "ok"; } return "none";
          case "str": return in.toString();
          case "close": in.close(); return "ok";
          case "closeRoot": root.close(); return "ok";
          case "clog": { String l = log.toString().trim(); log.setLength(0); return l; }
          default: throw new AssertionError(o);
        }
      });
    }
  }

  static List<Object> readScript(IndexInput root, int n) {
    Session s = new Session(root);
    List<Object> out = new ArrayList<Object>();
    for (int i = 0; i < n; i++) out.add(s.next());
    return out;
  }

  // ---------------------------------------------------------------- directories
  static final int[] CHUNKS = {1, 2, 3, 4, 5, 7, 8, 16, 33, 64, 1000, 1 << 30};
  static final String[] FILES = {"a", "b", "c.cfs", "seg_0.fnm", "zz"};
  static final String[] DIRS = {"d1", "d2"};
  static final int[] SIZES = {0, 1, 2, 3, 7, 8, 9, 100, 255, 300, 1023, 1024, 1025, 8191, 8192, 8193, 20000};

  static FSDirectory make(int kind, Path p, int chunk) throws IOException {
    switch (kind) {
      case 0: return new SimpleFSDirectory(p);
      case 1: return new NIOFSDirectory(p);
      default: {
        MMapDirectory m = new MMapDirectory(p, chunk);
        m.setUseUnmap(false);
        return m;
      }
    }
  }

  static String pickName() {
    int k = ri(12);
    if (k == 0) return pick(DIRS);
    if (k == 1) return "missing";
    if (k == 2) return pick(DIRS) + "/f";
    if (k == 3) return "nodir/f";
    return pick(FILES);
  }
  static String pickFile() { return ri(10) == 0 ? "missing" : pick(FILES); }

  static List<Object> dirScript(int kind, int chunk, int id, int nops) throws Exception {
    Path p = base.resolve("s" + id);
    FSDirectory d = make(kind, p, chunk);
    List<Object> ops = new ArrayList<Object>();
    List<IndexOutput> open = new ArrayList<IndexOutput>();
    ops.add(L(L("ctor", kind, chunk, id), norm("ok " + d.toString() + " " + d.getDirectory())));
    for (int i = 0; i < nops; i++) {
      int k = ri(100);
      List<Object> op;
      String result;
      if (k < 25) {
        String name = pickName();
        int size = (kind == 2 && chunk < 64 && ri(3) > 0) ? pick(new int[] {0, 1, 2, 3, 7, 8, 9, 100, 255, 300}) : pick(SIZES);
        if (ri(4) == 0) size = ri(40);
        if (size > 1100 && ri(4) > 0) size = ri(200);
        byte[] data = randomBytes(size);
        int piece = pick(new int[] {0, 1, 2, 7, 100, 8192, 100000});
        boolean close = ri(5) > 0;
        int c = ri(4);
        op = L("create", name, hex(data), piece, close, c);
        result = res(() -> {
          IndexOutput o = d.createOutput(name, ctx(c));
          if (!close) open.add(o);
          if (piece == 0) {
            for (byte b : data) o.writeByte(b);
          } else {
            for (int off = 0; off < data.length; off += piece) {
              int n = Math.min(piece, data.length - off);
              byte[] arr = new byte[n + 3];
              System.arraycopy(data, off, arr, 1, n);
              o.writeBytes(arr, 1, n);
            }
          }
          String s = "fp=" + o.getFilePointer() + " crc=" + o.getChecksum() + " len=" + d.fileLength(name);
          if (close) {
            o.close();
            s += " closed len=" + d.fileLength(name);
          }
          return s;
        });
      } else if (k < 50) {
        String name = pickName();
        int c = ri(4);
        final String nm = kind == 2 && Arrays.asList(DIRS).contains(name) ? "a" : name;
        op = L("read", nm, c);
        result = "";
        IndexInput in = null;
        try {
          in = d.openInput(nm, ctx(c));
        } catch (Throwable t) {
          result = exs(t);
        }
        if (in != null) {
          List<Object> sub = readScript(in, 6 + ri(25));
          IndexInput fin = in;
          // close the root unless the script closed it already (double close is allowed)
          op = L("read", nm, c, sub, res(() -> { fin.close(); return "closed"; }));
          result = "opened";
        }
      } else if (k < 55) {
        String name = pickFile();
        op = L("len", name);
        result = res(() -> "" + d.fileLength(name));
      } else if (k < 62) {
        String name = pickName();
        op = L("delete", name);
        result = res(() -> { d.deleteFile(name); return "ok"; });
      } else if (k < 69) {
        String a = pickName(), b = pickName();
        op = L("rename", a, b);
        result = res(() -> { d.renameFile(a, b); return "ok"; });
      } else if (k < 73) {
        List<Object> names = new ArrayList<Object>();
        for (int j = ri(4); j > 0; j--) names.add(pickName());
        op = L("sync", names);
        result = res(() -> {
          List<String> l = new ArrayList<String>();
          for (Object x : names) l.add((String) x);
          d.sync(l);
          return "ok";
        });
      } else if (k < 80) {
        op = L("list");
        result = res(() -> { String[] l = d.listAll(); Arrays.sort(l); return Arrays.toString(l); });
      } else if (k < 84) {
        String name = pick(DIRS);
        op = L("mkdir", name);
        result = res(() -> { Files.createDirectories(d.getDirectory().resolve(name)); return "ok"; });
      } else if (k < 86) {
        String name = pick(DIRS);
        op = L("mkdirNonEmpty", name);
        result = res(() -> { Path q = d.getDirectory().resolve(name); Files.createDirectories(q); Files.write(q.resolve("x"), new byte[] {1}); return "ok"; });
      } else if (k < 88) {
        op = L("str");
        result = res(() -> d.toString());
      } else if (k < 90) {
        op = L("getDir");
        result = res(() -> d.getDirectory().toString());
      } else if (k < 92) {
        int w = ri(3);
        final String fname = w == 2 ? pick(FILES) : "";
        op = L("listStatic", w, fname);
        result = res(() -> {
          Path q = w == 0 ? p : w == 1 ? base.resolve("nonexistent") : p.resolve(fname);
          String[] l = FSDirectory.listAll(q);
          Arrays.sort(l);
          return Arrays.toString(l);
        });
      } else if (k < 95) {
        String name = pickName();
        op = L("readDir", name);
        if (kind == 2) { op = L("str"); result = res(() -> d.toString()); }
        else result = res(() -> {
          IndexInput in = d.openInput(name, IOContext.DEFAULT);
          try { return "" + in.readByte(); } finally { in.close(); }
        });
      } else if (k < 97) {
        op = L("closeOuts");
        result = res(() -> { for (IndexOutput o : open) o.close(); open.clear(); return "ok"; });
      } else {
        op = L("lockStr");
        result = res(() -> d.makeLock("write.lock").toString());
      }
      ops.add(L(op, norm(result)));
    }
    if (ri(3) == 0) {
      // the directory is closed: every operation fails with AlreadyClosedException (or works if it does not check)
      ops.add(L(L("closeDir"), res(() -> { d.close(); return "ok"; })));
      for (int i = 0; i < 12; i++) {
        String name = pickFile();
        List<Object> op2 = pick(new List[] {L("len", name), L("list"), L("delete", name), L("rename", name, "b"), L("sync", L(name)), L("str"), L("getDir"), L("lockStr"), L("read", name, 0), L("create", name, "0102", 0, true, 0)});
        ops.add(L(op2, norm(dirOp(d, p, op2))));
      }
    }
    for (IndexOutput o : open) { try { o.close(); } catch (Throwable t) { } }
    try { d.close(); } catch (Throwable t) { }
    IOUtils.rm(p);
    return ops;
  }

  @SuppressWarnings("unchecked")
  static String dirOp(FSDirectory d, Path p, List<Object> op) {
    final String o = (String) op.get(0);
    return res(() -> {
      switch (o) {
        case "len": return "" + d.fileLength((String) op.get(1));
        case "list": return Arrays.toString(d.listAll());
        case "delete": d.deleteFile((String) op.get(1)); return "ok";
        case "rename": d.renameFile((String) op.get(1), (String) op.get(2)); return "ok";
        case "sync": d.sync((List<String>) (List<?>) op.get(1)); return "ok";
        case "str": return d.toString();
        case "getDir": return d.getDirectory().toString();
        case "lockStr": return d.makeLock("write.lock").toString();
        case "read": return "" + d.openInput((String) op.get(1), IOContext.DEFAULT);
        case "create": { IndexOutput out = d.createOutput((String) op.get(1), IOContext.DEFAULT); out.close(); return "ok"; }
        default: throw new AssertionError(o);
      }
    });
  }

  static void dirs() throws Exception {
    List<Object> scripts = new ArrayList<Object>();
    int id = 0;
    for (int kind = 0; kind < 3; kind++) {
      int n = kind == 2 ? 70 : 40;
      for (int s = 0; s < n; s++) {
        int chunk = kind == 2 ? pick(CHUNKS) : 0;
        scripts.add(dirScript(kind, chunk, id++, 30));
      }
    }
    section("dirs", toJson(scripts));
  }

  // ---------------------------------------------------------------- ByteBufferIndexInput on its own (clone tracking, cleaner)
  static class Cleaner implements ByteBufferIndexInput.BufferCleaner {
    final int failAt;
    final StringBuilder log;
    int n = 0;
    Cleaner(int failAt, StringBuilder log) { this.failAt = failAt; this.log = log; }
    @Override public void freeBuffer(ByteBufferIndexInput parent, ByteBuffer b) throws IOException {
      n++;
      log.append("free(").append(parent).append(',').append(b.capacity()).append(',').append(b.position()).append(',').append(b.limit()).append(") ");
      if (n == failAt) throw new IOException("clean failed");
    }
  }

  static void bbii() {
    List<Object> scripts = new ArrayList<Object>();
    for (int s = 0; s < 160; s++) {
      int power = ri(5);
      int chunk = 1 << power;
      int length = ri(5) == 0 ? ri(200) : ri(60);
      byte[] data = randomBytes(length);
      int nr = (length >>> power) + 1;
      ByteBuffer[] bufs = new ByteBuffer[nr];
      for (int i = 0; i < nr; i++) {
        int start = i * chunk;
        int size = Math.max(0, Math.min(chunk, length - start));
        bufs[i] = ByteBuffer.wrap(Arrays.copyOfRange(data, start, start + size));
      }
      boolean track = ri(2) == 0;
      boolean withCleaner = ri(4) > 0;
      int failAt = ri(4) == 0 ? 1 + ri(3) : -1;
      Session sess;
      StringBuilder log = new StringBuilder();
      ByteBufferIndexInput in = ByteBufferIndexInput.newInstance("bb" + s, bufs, length, power, withCleaner ? new Cleaner(failAt, log) : null, track);
      sess = new Session(in);
      List<Object> ops = new ArrayList<Object>();
      ops.add(L(L("new", power, length, hex(data), track, withCleaner, failAt), in.getClass().getSimpleName() + " " + in.length()));
      int n1 = 5 + ri(25);
      for (int i = 0; i < n1; i++) {
        // the cleaner log lives in this script's StringBuilder; Session.log is unused here
        ops.add(sess.next());
      }
      for (String o : new String[] {"closeRoot", "clog", "closeRoot", "clog"}) {
        List<Object> op = L(o);
        String r2 = o.equals("clog") ? norm(log.toString().trim()) : sess.run(op);
        if (o.equals("clog")) log.setLength(0);
        ops.add(L(op, r2));
      }
      int n2 = 3 + ri(10);
      for (int i = 0; i < n2; i++) ops.add(sess.next());
      scripts.add(ops);
    }
    section("bbii", toJson(scripts));
  }

  // ---------------------------------------------------------------- lock factories
  static final String[] LOCKNAMES = {"write.lock", "x.lock", "sub/y.lock"};

  static void locks() throws Exception {
    Lock.LOCK_POLL_INTERVAL = 1;
    List<Object> scripts = new ArrayList<Object>();
    int id = 1000;
    for (int kind = 0; kind < 2; kind++) {
      for (int s = 0; s < 40; s++) {
        Path p = base.resolve("s" + id++);
        LockFactory lf = kind == 0 ? SimpleFSLockFactory.INSTANCE : NativeFSLockFactory.INSTANCE;
        final boolean nio = ri(2) == 0;
        FSDirectory d = nio ? new NIOFSDirectory(p, lf) : new SimpleFSDirectory(p, lf);
        Lock[] locks = new Lock[3];
        List<Object> ops = new ArrayList<Object>();
        ops.add(L(L("ctor", kind, id - 1, nio ? 1 : 0), norm(d.toString())));
        for (int i = 0; i < 30; i++) {
          int k = ri(100);
          int li = ri(3);
          List<Object> op;
          String result;
          if (k < 14) {
            String name = pick(LOCKNAMES);
            op = L("make", li, name);
            result = res(() -> { locks[li] = d.makeLock(name); return locks[li].toString(); });
          } else if (locks[li] == null) {
            op = L("make", li, "write.lock");
            result = res(() -> { locks[li] = d.makeLock("write.lock"); return locks[li].toString(); });
          } else if (k < 38) {
            op = L("obtain", li);
            result = res(() -> "" + locks[li].obtain());
          } else if (k < 52) {
            int ms = pick(new int[] {0, 0, 3, 5, -5});
            op = L("obtainWait", li, ms);
            result = res(() -> "" + locks[li].obtain(ms));
          } else if (k < 64) {
            op = L("isLocked", li);
            result = res(() -> "" + locks[li].isLocked());
          } else if (k < 78) {
            op = L("close", li);
            result = res(() -> { locks[li].close(); return "ok"; });
          } else if (k < 82) {
            op = L("str", li);
            result = res(() -> locks[li].toString());
          } else if (k < 88) {
            String name = pick(LOCKNAMES);
            op = L("touch", name);
            result = res(() -> { Files.createFile(p.resolve(name)); return "ok"; });
          } else if (k < 93) {
            String name = pick(LOCKNAMES);
            op = L("rmfile", name);
            result = res(() -> "" + Files.deleteIfExists(p.resolve(name)));
          } else if (k < 97) {
            op = L("list");
            result = res(() -> { String[] l = FSDirectory.listAll(p); Arrays.sort(l); return Arrays.toString(l); });
          } else {
            op = L("ramLock");
            result = res(() -> { RAMDirectory ram = new RAMDirectory(); return "" + lf.makeLock(ram, "x").toString(); });
          }
          ops.add(L(op, norm(result)));
        }
        for (Lock l : locks) { if (l != null) { try { l.close(); } catch (Throwable t) { } } }
        d.close();
        IOUtils.rm(p);
        scripts.add(ops);
      }
    }
    section("locks", toJson(scripts));
  }

  static void verifying() throws Exception {
    List<Object> scripts = new ArrayList<Object>();
    for (int s = 0; s < 60; s++) {
      byte[] answers = new byte[ri(8)];
      for (int i = 0; i < answers.length; i++) answers[i] = (byte) pick(new int[] {1, 0, 1, 0, 1, 0, 2, 255});
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      RAMDirectory dir = new RAMDirectory();
      VerifyingLockFactory vf = new VerifyingLockFactory(new SingleInstanceLockFactory(), new ByteArrayInputStream(answers), out);
      Lock[] locks = new Lock[2];
      List<Object> ops = new ArrayList<Object>();
      ops.add(L(L("new", hex(answers)), "ok"));
      for (int i = 0; i < 14; i++) {
        int li = ri(2);
        int k = ri(100);
        List<Object> op;
        String result;
        if (locks[li] == null || k < 10) {
          op = L("make", li);
          result = res(() -> { locks[li] = vf.makeLock(dir, "l" + li); return "ok"; });
        } else if (k < 50) {
          op = L("obtain", li);
          result = res(() -> "" + locks[li].obtain());
        } else if (k < 75) {
          op = L("close", li);
          result = res(() -> { locks[li].close(); return "ok"; });
        } else {
          op = L("isLocked", li);
          result = res(() -> "" + locks[li].isLocked());
        }
        ops.add(L(op, norm(result) + " out=" + hex(out.toByteArray())));
      }
      scripts.add(ops);
    }
    section("verifying", toJson(scripts));
  }

  // ---------------------------------------------------------------- IOUtils.fsync / rm / deleteFiles*
  static final String[] UPATHS = {"f1", "f2", "t", "t/a", "t/b", "t/b/c", "t/b/d", "missing", "u/v/w"};

  static void fsutil() throws Exception {
    List<Object> scripts = new ArrayList<Object>();
    for (int s = 0; s < 60; s++) {
      Path p = base.resolve("u" + s);
      Files.createDirectories(p);
      List<Object> ops = new ArrayList<Object>();
      for (int i = 0; i < 25; i++) {
        int k = ri(100);
        List<Object> op;
        String result;
        if (k < 20) {
          String name = pick(UPATHS);
          op = L("file", name, ri(100));
          result = res(() -> { Path q = p.resolve(name); Files.createDirectories(q.getParent()); Files.write(q, new byte[(Integer) op.get(2)]); return "ok"; });
        } else if (k < 30) {
          String name = pick(UPATHS);
          op = L("dir", name);
          result = res(() -> { Files.createDirectories(p.resolve(name)); return "ok"; });
        } else if (k < 50) {
          String name = pick(UPATHS);
          boolean isDir = ri(2) == 0;
          op = L("fsync", name, isDir);
          result = res(() -> { IOUtils.fsync(p.resolve(name), isDir); return "ok"; });
        } else if (k < 62) {
          List<Object> names = new ArrayList<Object>();
          for (int j = 1 + ri(3); j > 0; j--) names.add(ri(8) == 0 ? null : pick(UPATHS));
          op = L("rm", names);
          result = res(() -> { IOUtils.rm(paths(p, names)); return "ok"; });
        } else if (k < 74) {
          List<Object> names = new ArrayList<Object>();
          for (int j = 1 + ri(3); j > 0; j--) names.add(ri(8) == 0 ? null : pick(UPATHS));
          op = L("deleteFilesIfExist", names);
          result = res(() -> { IOUtils.deleteFilesIfExist(paths(p, names)); return "ok"; });
        } else if (k < 82) {
          List<Object> names = new ArrayList<Object>();
          for (int j = 1 + ri(3); j > 0; j--) names.add(ri(8) == 0 ? null : pick(UPATHS));
          op = L("deleteFilesIfExistColl", names);
          result = res(() -> { IOUtils.deleteFilesIfExist(Arrays.asList(paths(p, names))); return "ok"; });
        } else if (k < 90) {
          List<Object> names = new ArrayList<Object>();
          for (int j = 1 + ri(3); j > 0; j--) names.add(ri(8) == 0 ? null : pick(UPATHS));
          op = L("deleteFilesIgnoringExceptions", names);
          result = res(() -> { IOUtils.deleteFilesIgnoringExceptions(paths(p, names)); return "ok"; });
        } else {
          op = L("tree");
          result = res(() -> { List<String> l = new ArrayList<String>(); tree(p, p, l); Collections.sort(l); return l.toString(); });
        }
        ops.add(L(op, norm(result)));
      }
      IOUtils.rm(p);
      scripts.add(ops);
    }
    section("fsutil", toJson(scripts));
  }

  static Path[] paths(Path p, List<Object> names) {
    Path[] r = new Path[names.size()];
    for (int i = 0; i < r.length; i++) r[i] = names.get(i) == null ? null : p.resolve((String) names.get(i));
    return r;
  }

  static void tree(Path root, Path q, List<String> out) throws IOException {
    for (String n : FSDirectory.listAll(q)) {
      Path c = q.resolve(n);
      boolean dir = Files.isDirectory(c);
      out.add(root.relativize(c) + (dir ? "/" : ":" + Files.size(c)));
      if (dir) tree(root, c, out);
    }
  }

  public static void main(String[] args) throws Exception {
    base = java.nio.file.Paths.get(args[0]).toRealPath();
    baseStr = base.toString();
    byteBuffer();
    dirs();
    bbii();
    locks();
    verifying();
    fsutil();
    System.out.println(sb.append("}").toString());
  }
}
