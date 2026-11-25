package org.apache.lucene.util.fst;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Random;
import java.util.TreeMap;
import java.util.zip.CRC32;

import org.apache.lucene.store.ByteArrayDataInput;
import org.apache.lucene.store.OutputStreamDataOutput;
import org.apache.lucene.util.ArrayUtil;
import org.apache.lucene.util.BytesRef;
import org.apache.lucene.util.IntsRef;
import org.apache.lucene.util.IntsRefBuilder;
import org.apache.lucene.util.RamUsageEstimator;
import org.apache.lucene.util.packed.PackedInts;

/**
 * Generates test/golden/fst.json from the ORIGINAL Lucene 5.2.1 FST classes: BytesStore, FST (built with Builder, saved,
 * packed or not, with and without array arcs, and then reloaded with various page sizes), ByteSequenceOutputs,
 * BytesRefFSTEnum. Assertions are enabled when running.
 */
public class GoldenFST {
  static final Random r = new Random(4242);

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
    return s.toString();
  }

  static byte[] unhex(String s) {
    byte[] b = new byte[s.length() / 2];
    for (int i = 0; i < b.length; i++) b[i] = (byte) Integer.parseInt(s.substring(2 * i, 2 * i + 2), 16);
    return b;
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

  static final List<String> cases = new ArrayList<>();

  static void finish(String cfg) {
    StringBuilder sb = new StringBuilder("{\"c\":" + js(cfg) + ",\"ops\":[");
    for (int i = 0; i < ops.size(); i++) sb.append(i > 0 ? "," : "").append(js(ops.get(i)));
    sb.append("],\"out\":[");
    for (int i = 0; i < out.size(); i++) sb.append(i > 0 ? "," : "").append(js(out.get(i)));
    sb.append("]}");
    cases.add(sb.toString());
  }

  // -------------------------------------------------------------------------------------------------------------
  static BytesStore bs;
  static byte[] mirror; // what we expect: not used for comparison, just to pick valid positions
  static FST.BytesReader rdr;

  static void bytesStoreCase(int bits, long seed) {
    Random rr = new Random(seed);
    ops = new ArrayList<>();
    out = new ArrayList<>();
    bs = new BytesStore(bits);
    final int bsz = 1 << bits;
    final long[] pos = {0};
    int n = 5 + rr.nextInt(25);
    run("pos", () -> "" + bs.getPosition());
    run("ram", () -> "" + bs.ramBytesUsed());
    for (int i = 0; i < n; i++) {
      int kind = rr.nextInt(9);
      if (kind <= 1) {
        final int v = rr.nextInt(256);
        run("w1:" + v, () -> {
          bs.writeByte((byte) v);
          pos[0]++;
          return "pos=" + bs.getPosition();
        });
      } else if (kind == 2) {
        final int len = rr.nextInt(4) == 0 ? 0 : rr.nextInt(3 * bsz + 2);
        final int sd = rr.nextInt(1000);
        run("wN:" + len + ":" + sd, () -> {
          bs.writeBytes(gen(sd, len + 3), 2, len);
          pos[0] += len;
          return "pos=" + bs.getPosition();
        });
      } else if (kind == 3 && pos[0] >= 4) {
        final long p = (long) (rr.nextDouble() * (pos[0] - 3));
        final int v = rr.nextInt();
        run("wi:" + p + ":" + v, () -> {
          bs.writeInt(p, v);
          return "pos=" + bs.getPosition();
        });
      } else if (kind == 4 && pos[0] >= 2) {
        final int len = 1 + rr.nextInt((int) Math.min(pos[0], 3 * bsz));
        final long dest = (long) (rr.nextDouble() * (pos[0] - len + 1));
        final int sd = rr.nextInt(1000);
        run("wb:" + dest + ":" + len + ":" + sd, () -> {
          bs.writeBytes(dest, gen(sd, len + 2), 1, len);
          return "pos=" + bs.getPosition();
        });
      } else if (kind == 5 && pos[0] >= 3) {
        final int len = 1 + rr.nextInt((int) Math.min(pos[0] - 1, 3 * bsz));
        final long dest = 1 + (long) (rr.nextDouble() * (pos[0] - len));
        final long src = (long) (rr.nextDouble() * dest);
        run("cp:" + src + ":" + dest + ":" + len, () -> {
          bs.copyBytes(src, dest, len);
          return "pos=" + bs.getPosition();
        });
      } else if (kind == 6 && pos[0] >= 3) {
        final long dest = 1 + (long) (rr.nextDouble() * (pos[0] - 1));
        final long src = (long) (rr.nextDouble() * dest);
        run("rev:" + src + ":" + dest, () -> {
          bs.reverse(src, dest);
          return "pos=" + bs.getPosition();
        });
      } else if (kind == 7) {
        final int sk = rr.nextInt(2 * bsz + 2);
        run("skip:" + sk, () -> {
          bs.skipBytes(sk);
          pos[0] += sk;
          return "pos=" + bs.getPosition();
        });
      } else if (kind == 8 && pos[0] >= 1) {
        final long nl = (long) (rr.nextDouble() * (pos[0] + 1));
        run("trunc:" + nl, () -> {
          bs.truncate(nl);
          pos[0] = nl;
          return "pos=" + bs.getPosition();
        });
      } else {
        run("ram", () -> "" + bs.ramBytesUsed());
      }
    }
    final long total = pos[0];
    run("tot", () -> "" + bs.getPosition());
    // readers over the whole content (unfinished)
    for (int rep = 0; rep < 2; rep++) {
      final boolean fwd = rep == 0;
      if (total > 0) {
        for (int k = 0; k < 6; k++) {
          final long p = (long) (rr.nextDouble() * total);
          final int len = (int) Math.min(fwd ? total - p : p + 1, rr.nextInt(2 * bsz + 3));
          final boolean viaBytes = rr.nextBoolean();
          run("rd:" + (fwd ? "f" : "r") + ":" + p + ":" + len + ":" + (viaBytes ? 1 : 0), () -> {
            FST.BytesReader rd = fwd ? bs.getForwardReader() : bs.getReverseReader();
            rd.setPosition(p);
            StringBuilder s = new StringBuilder();
            if (viaBytes) {
              byte[] b = new byte[len];
              rd.readBytes(b, 0, len);
              s.append(hex(b, 0, len));
            } else {
              for (int i = 0; i < len; i++) s.append(String.format("%02x", rd.readByte() & 0xff));
            }
            return dig(s.toString()) + " pos=" + rd.getPosition() + " rev=" + rd.reversed();
          });
          run("rs:" + (fwd ? "f" : "r") + ":" + p, () -> {
            FST.BytesReader rd = fwd ? bs.getForwardReader() : bs.getReverseReader();
            rd.setPosition(p);
            rd.skipBytes(fwd ? Math.min(3, total - p - 1) : Math.min(3, p));
            return "pos=" + rd.getPosition() + " " + String.format("%02x", rd.readByte() & 0xff);
          });
        }
      }
    }
    run("rr", () -> {
      FST.BytesReader rd = bs.getReverseReader(false);
      return rd.reversed() + " " + rd.getPosition();
    });
    run("wto", () -> {
      ByteArrayOutputStream bo = new ByteArrayOutputStream();
      bs.writeTo(new OutputStreamDataOutput(bo));
      byte[] b = bo.toByteArray();
      return "len=" + b.length + " " + dig(hex(b, 0, b.length));
    });
    run("fin", () -> {
      bs.finish();
      return "pos=" + bs.getPosition() + " " + bs;
    });
    run("wto", () -> {
      ByteArrayOutputStream bo = new ByteArrayOutputStream();
      bs.writeTo(new OutputStreamDataOutput(bo));
      byte[] b = bo.toByteArray();
      return "len=" + b.length + " " + dig(hex(b, 0, b.length));
    });
    run("ram", () -> "" + bs.ramBytesUsed());
    run("fwdr", () -> {
      FST.BytesReader rd = bs.getForwardReader();
      return rd.reversed() + " " + rd.getPosition();
    });
    run("revr", () -> {
      FST.BytesReader rd = bs.getReverseReader();
      return rd.reversed() + " " + rd.getPosition();
    });
    finish("bytesstore," + bits);
  }

  // -------------------------------------------------------------------------------------------------------------
  static final ByteSequenceOutputs OUT = ByteSequenceOutputs.getSingleton();

  static String bytesRefStr(BytesRef b) {
    return b == null ? "null" : b.toString();
  }

  static String arcStr(FST.Arc<BytesRef> a) {
    return a.toString();
  }

  static FST<BytesRef> fst;

  static void walkNodes(FST<BytesRef> f, FST.Arc<BytesRef> follow, int depth, StringBuilder s, int[] budget) throws Exception {
    if (budget[0]-- <= 0) return;
    FST.BytesReader in = f.getBytesReader();
    if (!FST.targetHasArcs(follow)) return;
    FST.Arc<BytesRef> arc = new FST.Arc<>();
    f.readFirstTargetArc(follow, arc, in);
    List<FST.Arc<BytesRef>> kids = new ArrayList<>();
    while (true) {
      s.append(depth).append(':').append(arcStr(arc)).append(';');
      if (arc.label != FST.END_LABEL) kids.add(new FST.Arc<BytesRef>().copyFrom(arc));
      if (arc.isLast()) break;
      s.append('n').append(f.readNextArcLabel(arc, in)).append(';');
      f.readNextArc(arc, in);
    }
    FST.Arc<BytesRef> last = new FST.Arc<>();
    f.readLastTargetArc(follow, last, in);
    s.append("L:").append(arcStr(last)).append(";x=").append(f.isExpandedTarget(follow, in)).append(';');
    if (depth < 6) {
      for (FST.Arc<BytesRef> k : kids) walkNodes(f, k, depth + 1, s, budget);
    }
  }

  static String get(FST<BytesRef> f, byte[] key) throws Exception {
    FST.Arc<BytesRef> arc = f.getFirstArc(new FST.Arc<BytesRef>());
    FST.BytesReader in = f.getBytesReader();
    BytesRef output = f.outputs.getNoOutput();
    for (int i = 0; i < key.length; i++) {
      if (f.findTargetArc(key[i] & 0xff, arc, arc, in) == null) {
        return "null";
      }
      output = f.outputs.add(output, arc.output);
    }
    if (arc.isFinal()) {
      return f.outputs.add(output, arc.nextFinalOutput).toString();
    } else {
      return "null";
    }
  }

  static String enumRes(BytesRefFSTEnum.InputOutput<BytesRef> io) {
    return io == null ? "null" : io.input.toString() + "=" + io.output;
  }

  static void fstCase(int inputType, boolean packed, boolean allowArray, int n, int alphabet, int maxLen, boolean withEmpty, int outMode) throws Exception {
    // build terms
    TreeMap<IntsRef, BytesRef> terms = new TreeMap<>();
    int maxLabel = inputType == 0 ? 255 : (inputType == 1 ? 65535 : (1 << 30));
    for (int i = 0; i < n; i++) {
      int len = 1 + r.nextInt(maxLen);
      int[] ints = new int[len];
      for (int j = 0; j < len; j++) {
        if (inputType == 0) ints[j] = alphabet >= 256 ? r.nextInt(256) : 'a' + r.nextInt(alphabet);
        else if (inputType == 1) ints[j] = r.nextInt(4) == 0 ? r.nextInt(65536) : 200 + r.nextInt(alphabet);
        else ints[j] = r.nextInt(4) == 0 ? r.nextInt(maxLabel) : 100000 + r.nextInt(alphabet);
      }
      byte[] o = outMode == 0 ? new byte[0] : gen(r.nextInt(1000), outMode == 1 ? r.nextInt(3) : r.nextInt(8));
      terms.put(new IntsRef(ints, 0, len), new BytesRef(o));
    }
    if (withEmpty) terms.put(new IntsRef(new int[0], 0, 0), new BytesRef(outMode == 0 ? new byte[0] : gen(7, 3)));
    if (terms.isEmpty()) return;
    FST.INPUT_TYPE it = inputType == 0 ? FST.INPUT_TYPE.BYTE1 : (inputType == 1 ? FST.INPUT_TYPE.BYTE2 : FST.INPUT_TYPE.BYTE4);
    Builder<BytesRef> b = new Builder<>(it, 0, 0, true, true, Integer.MAX_VALUE, OUT, packed, PackedInts.COMPACT, allowArray, 15);
    List<byte[]> keys = new ArrayList<>();
    for (java.util.Map.Entry<IntsRef, BytesRef> e : terms.entrySet()) {
      b.add(e.getKey(), e.getValue());
      if (inputType == 0) {
        byte[] k = new byte[e.getKey().length];
        for (int i = 0; i < k.length; i++) k[i] = (byte) e.getKey().ints[e.getKey().offset + i];
        keys.add(k);
      }
    }
    FST<BytesRef> built = b.finish();
    if (built == null) return;
    ByteArrayOutputStream bo = new ByteArrayOutputStream();
    built.save(new OutputStreamDataOutput(bo));
    byte[] saved = bo.toByteArray();
    String cfg = "fst," + inputType + "," + packed + "," + allowArray + "," + hex(saved, 0, saved.length);
    ops = new ArrayList<>();
    out = new ArrayList<>();
    // probes (BYTE1 only)
    List<byte[]> probes = new ArrayList<>();
    if (inputType == 0) {
      for (int i = 0; i < 12; i++) {
        byte[] p;
        int kind = r.nextInt(4);
        if (kind == 0 && !keys.isEmpty()) p = keys.get(r.nextInt(keys.size()));
        else if (kind == 1 && !keys.isEmpty()) {
          byte[] k = keys.get(r.nextInt(keys.size()));
          p = Arrays.copyOf(k, r.nextInt(k.length + 1));
        } else if (kind == 2 && !keys.isEmpty()) {
          byte[] k = keys.get(r.nextInt(keys.size()));
          p = Arrays.copyOf(k, k.length + 1 + r.nextInt(2));
          for (int j = k.length; j < p.length; j++) p[j] = (byte) ('a' + r.nextInt(Math.max(2, Math.min(alphabet, 26))));
        } else {
          p = new byte[r.nextInt(maxLen + 2)];
          for (int j = 0; j < p.length; j++) p[j] = (byte) (alphabet >= 256 ? r.nextInt(256) : 'a' + r.nextInt(alphabet + 1));
        }
        probes.add(p);
      }
      probes.add(new byte[0]);
      probes.add(new byte[] {(byte) 0xff, (byte) 0xff});
      probes.add(new byte[] {0});
    }
    for (int mb : new int[] {30, 3, 1}) {
      final int fmb = mb;
      run("L:" + mb, () -> {
        fst = new FST<>(new ByteArrayDataInput(saved), OUT, fmb);
        return fst + " empty=" + bytesRefStr(fst.getEmptyOutput()) + " nodes=" + fst.getNodeCount() + " arcs=" + fst.getArcCount() + " awo="
            + fst.getArcWithOutputCount() + " in=" + fst.getInputType() + " ram=" + fst.ramBytesUsed() + " ch=" + fst.getChildResources().size();
      });
      run("ARCS", () -> {
        StringBuilder s = new StringBuilder();
        FST.Arc<BytesRef> root = fst.getFirstArc(new FST.Arc<BytesRef>());
        s.append(arcStr(root)).append('|');
        walkNodes(fst, root, 0, s, new int[] {3000});
        return dig(s.toString());
      });
      run("ARC1", () -> {
        FST.Arc<BytesRef> root = fst.getFirstArc(new FST.Arc<BytesRef>());
        FST.Arc<BytesRef> a = fst.readFirstTargetArc(root, new FST.Arc<BytesRef>(), fst.getBytesReader());
        return arcStr(a);
      });
      run("ENDARC", () -> {
        FST.BytesReader in = fst.getBytesReader();
        FST.Arc<BytesRef> root = fst.getFirstArc(new FST.Arc<BytesRef>());
        FST.Arc<BytesRef> a = fst.findTargetArc(FST.END_LABEL, root, new FST.Arc<BytesRef>(), in);
        return a == null ? "null" : arcStr(a);
      });
      if (inputType == 0) {
        run("ENUM", () -> {
          BytesRefFSTEnum<BytesRef> e = new BytesRefFSTEnum<>(fst);
          StringBuilder s = new StringBuilder();
          int count = 0;
          BytesRefFSTEnum.InputOutput<BytesRef> io;
          while ((io = e.next()) != null) {
            s.append(enumRes(io)).append(';');
            count++;
          }
          return count + " " + dig(s.toString());
        });
        for (byte[] p : probes) {
          final String h = hex(p, 0, p.length);
          run("GET:" + h, () -> get(fst, p));
          run("SC:" + h, () -> {
            BytesRefFSTEnum<BytesRef> e = new BytesRefFSTEnum<>(fst);
            String a = enumRes(e.seekCeil(new BytesRef(p)));
            String c = enumRes(e.current().input == null ? null : e.current());
            String nx = enumRes(e.next());
            return a + " cur=" + c + " next=" + nx;
          });
          run("SF:" + h, () -> {
            BytesRefFSTEnum<BytesRef> e = new BytesRefFSTEnum<>(fst);
            String a = enumRes(e.seekFloor(new BytesRef(p)));
            String nx = enumRes(e.next());
            return a + " next=" + nx;
          });
          run("SE:" + h, () -> {
            BytesRefFSTEnum<BytesRef> e = new BytesRefFSTEnum<>(fst);
            String a = enumRes(e.seekExact(new BytesRef(p)));
            String nx = enumRes(e.next());
            return a + " next=" + nx;
          });
        }
        // a single enum reused over several seeks (exercises rewindPrefix)
        run("SEQ", () -> {
          BytesRefFSTEnum<BytesRef> e = new BytesRefFSTEnum<>(fst);
          StringBuilder s = new StringBuilder();
          for (int i = 0; i < probes.size(); i++) {
            byte[] p = probes.get(i);
            switch (i % 3) {
              case 0: s.append(enumRes(e.seekCeil(new BytesRef(p)))); break;
              case 1: s.append(enumRes(e.seekFloor(new BytesRef(p)))); break;
              default: s.append(enumRes(e.seekExact(new BytesRef(p)))); break;
            }
            s.append(';');
            if (i % 4 == 0) s.append(enumRes(e.next())).append(';');
          }
          return dig(s.toString());
        });
      }
    }
    finish(cfg);
  }

  public static void main(String[] args) throws Exception {
    // base sizes
    ops = new ArrayList<>();
    out = new ArrayList<>();
    run("base:FST", () -> "" + RamUsageEstimator.shallowSizeOfInstance(FST.class));
    run("base:Arc", () -> "" + RamUsageEstimator.shallowSizeOfInstance(FST.Arc.class));
    run("base:BytesStore", () -> "" + (RamUsageEstimator.shallowSizeOfInstance(BytesStore.class) + RamUsageEstimator.shallowSizeOfInstance(ArrayList.class)));
    run("base:BytesRef", () -> "" + RamUsageEstimator.shallowSizeOf(new BytesRef()));
    finish("base");

    long seed = 1000;
    for (int bits = 1; bits <= 5; bits++) {
      for (int rep = 0; rep < 8; rep++) bytesStoreCase(bits, seed++);
    }

    int[] ns = {1, 2, 5, 30, 200, 1500};
    for (int inputType = 0; inputType < 3; inputType++) {
      for (int pk = 0; pk < 2; pk++) {
        for (int aa = 0; aa < 2; aa++) {
          for (int n : ns) {
            if (inputType > 0 && n > 200) continue;
            int alphabet = inputType == 0 ? (n >= 200 ? 26 : (n > 5 ? 12 : 4)) : 20;
            fstCase(inputType, pk == 1, aa == 1, n, alphabet, n >= 200 ? 8 : 5, n % 2 == 0, (n + pk + aa) % 3);
          }
        }
      }
    }
    // wide alphabet: root with many arcs (array arcs deep and shallow)
    fstCase(0, false, true, 1500, 256, 4, false, 1);
    fstCase(0, true, true, 1500, 256, 4, true, 2);
    fstCase(0, false, false, 1500, 256, 4, false, 2);
    fstCase(0, false, true, 400, 256, 2, false, 0);
    // only the empty string
    ops = new ArrayList<>();
    out = new ArrayList<>();
    StringBuilder sb = new StringBuilder("[\n");
    for (int i = 0; i < cases.size(); i++) sb.append(i > 0 ? ",\n" : "").append(cases.get(i));
    sb.append("\n]");
    System.out.println(sb);
  }
}
