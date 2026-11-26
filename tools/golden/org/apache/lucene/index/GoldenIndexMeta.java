package org.apache.lucene.index;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

/** Generates test/golden/indexmeta.json from the ORIGINAL Lucene 5.2.1 IndexFileNames, FieldInfo, FieldInfos (assertions on). */
public class GoldenIndexMeta {
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
    if (t instanceof ArrayIndexOutOfBoundsException) return "EX:" + t.getClass().getSimpleName();
    return "EX:" + t.getClass().getSimpleName() + ":" + t.getMessage();
  }

  interface Op {
    String run() throws Exception;
  }

  static List<String> ops = new ArrayList<>(), out = new ArrayList<>();

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

  static String state(FieldInfo f) {
    return f.name + "#" + f.number + " tv=" + f.hasVectors() + " on=" + f.omitsNorms() + " hn=" + f.hasNorms() + " sp=" + f.hasPayloads() + " io="
        + f.getIndexOptions() + " dv=" + f.getDocValuesType() + " gen=" + f.getDocValuesGen() + " attrs=" + new java.util.TreeMap<>(f.attributes());
  }

  static IndexOptions[] IO = IndexOptions.values();
  static DocValuesType[] DV = DocValuesType.values();

  static FieldInfo make(String[] p) {
    return new FieldInfo(p[0].equals("<null>") ? null : p[0], Integer.parseInt(p[1]), p[2].equals("1"), p[3].equals("1"), p[4].equals("1"),
        p[5].equals("<null>") ? null : IO[Integer.parseInt(p[5])], p[6].equals("<null>") ? null : DV[Integer.parseInt(p[6])], Long.parseLong(p[7]),
        new HashMap<String, String>());
  }

  public static void main(String[] args) throws Exception {
    Random r = new Random(77);
    // ---- IndexFileNames
    String[] names = {"_0.cfs", "_a_1.del", "_1_Lucene50_0.doc", "segments_5", "segments.gen", "_.x", "", "x", "_", "_zz_1a_foo.bar.baz", "_0_a_b_c",
        "_0.fnm", "_abc_def.pos", "_a.b_c.d", "_1_2_3_4.tim", "pending_segments_2", "_0_1_2.x", "_0\n.x", "_0_a\n.x", "_0_.y", "_0__1.z", "_9z_zz_Lucene50_0.tim",
        "_1_2_3.x", "_00_0.x", "..", ".x", "a.b.c", "_0_ZZ.x", "_z_1٥.dvd"};
    for (String n : names) {
      final String fn = n;
      run("STRIP:" + n, () -> IndexFileNames.stripSegmentName(fn));
      run("PSEG:" + n, () -> IndexFileNames.parseSegmentName(fn));
      run("SEXT:" + n, () -> IndexFileNames.stripExtension(fn));
      run("GEXT:" + n, () -> "" + IndexFileNames.getExtension(fn));
      run("PAT:" + n, () -> "" + IndexFileNames.CODEC_FILE_PATTERN.matcher(fn).matches());
      run("PGEN:" + n, () -> "" + IndexFileNames.parseGeneration(fn));
      run("MEXT:" + n + "\tcfs", () -> "" + IndexFileNames.matchesExtension(fn, "cfs"));
      run("MEXT:" + n + "\tx", () -> "" + IndexFileNames.matchesExtension(fn, "x"));
    }
    String[] gens = {"_a_zzzzzzzzzzzzzz.x", "_a_-5.x", "_a_+5.x", "_a_.x", "_a_ 1.x", "_a_1_2_3.x", "_a_Z.x", "_a_1000000000000.x", "_a_1y2gosa7pa2gw.x", "_a_1y2gosa7pa2gx.x",
        "_a_3w5e11264sgsf.x", "_a_3w5e11264sgsg.x", "_a_-1y2p0ij32e8e7.x", "_a_-1y2p0ij32e8e8.x"};
    for (String n : gens) {
      final String fn = n;
      run("PGEN:" + n, () -> "" + IndexFileNames.parseGeneration(fn));
    }
    String[] bases = {"_0", "segments", "_a", "", "x_y"};
    String[] exts = {"", "cfs", "del", "si"};
    long[] gs = {-1, 0, 1, 10, 35, 36, 1295, 1296, 123456789012345L, Long.MAX_VALUE};
    for (String b : bases)
      for (String e : exts)
        for (long g : gs) {
          final String fb = b, fe = e;
          final long fg = g;
          run("FNG:" + b + "\t" + e + "\t" + g, () -> "" + IndexFileNames.fileNameFromGeneration(fb, fe, fg));
        }
    run("FNG:x\ty\t-2", () -> "" + IndexFileNames.fileNameFromGeneration("x", "y", -2));
    String[] sufs = {"", "Lucene50_0", "a"};
    for (String b : bases)
      for (String s : sufs)
        for (String e : exts) {
          final String fb = b, fs = s, fe = e;
          run("SFN:" + b + "\t" + s + "\t" + e, () -> IndexFileNames.segmentFileName(fb, fs, fe));
        }
    run("SFN:_0\t\t.cfs", () -> IndexFileNames.segmentFileName("_0", "", ".cfs"));
    run("CONST", () -> IndexFileNames.SEGMENTS + "|" + IndexFileNames.PENDING_SEGMENTS + "|" + IndexFileNames.OLD_SEGMENTS_GEN);
    StringBuilder sb = new StringBuilder("{\"names\":{\"ops\":[");
    for (int i = 0; i < ops.size(); i++) sb.append(i > 0 ? "," : "").append(js(ops.get(i)));
    sb.append("],\"out\":[");
    for (int i = 0; i < out.size(); i++) sb.append(i > 0 ? "," : "").append(js(out.get(i)));
    sb.append("]}");

    // ---- FieldInfo
    ops = new ArrayList<>();
    out = new ArrayList<>();
    String[] fnames = {"a", "title", "<null>", ""};
    for (int i = 0; i < 400; i++) {
      final String[] p = new String[8];
      p[0] = r.nextInt(30) == 0 ? "<null>" : "f" + r.nextInt(5);
      p[1] = "" + (r.nextInt(10) == 0 ? -1 : r.nextInt(8));
      p[2] = r.nextBoolean() ? "1" : "0";
      p[3] = r.nextBoolean() ? "1" : "0";
      p[4] = r.nextBoolean() ? "1" : "0";
      p[5] = r.nextInt(30) == 0 ? "<null>" : "" + r.nextInt(IO.length);
      p[6] = r.nextInt(30) == 0 ? "<null>" : "" + r.nextInt(DV.length);
      p[7] = "" + (r.nextBoolean() ? -1 : r.nextInt(5));
      StringBuilder op = new StringBuilder("FI:" + String.join("|", p));
      final List<String> muts = new ArrayList<>();
      int nm = r.nextInt(5);
      for (int k = 0; k < nm; k++) {
        switch (r.nextInt(8)) {
          case 0: muts.add("update," + r.nextInt(2) + "," + r.nextInt(2) + "," + r.nextInt(2) + "," + (r.nextInt(25) == 0 ? "<null>" : "" + r.nextInt(IO.length))); break;
          case 1: muts.add("setDV," + (r.nextInt(25) == 0 ? "<null>" : "" + r.nextInt(DV.length))); break;
          case 2: muts.add("setIO," + r.nextInt(IO.length)); break;
          case 3: muts.add("setP"); break;
          case 4: muts.add("setTV"); break;
          case 5: muts.add("setOmit"); break;
          case 6: muts.add("put," + "k" + r.nextInt(3) + ",v" + r.nextInt(3)); break;
          default: muts.add("setGen," + (r.nextBoolean() ? -1 : r.nextInt(5))); break;
        }
      }
      op.append("|").append(String.join(";", muts));
      run(op.toString(), () -> {
        FieldInfo f = make(p);
        StringBuilder s = new StringBuilder(state(f));
        for (String m : muts) {
          s.append(" ## ").append(m).append(": ");
          String[] a = m.split(",");
          try {
            switch (a[0]) {
              case "update": f.update(a[1].equals("1"), a[2].equals("1"), a[3].equals("1"), a[4].equals("<null>") ? null : IO[Integer.parseInt(a[4])]); break;
              case "setDV": f.setDocValuesType(a[1].equals("<null>") ? null : DV[Integer.parseInt(a[1])]); break;
              case "setIO": f.setIndexOptions(IO[Integer.parseInt(a[1])]); break;
              case "setP": f.setStorePayloads(); break;
              case "setTV": f.setStoreTermVectors(); break;
              case "setOmit": f.setOmitsNorms(); break;
              case "put": s.append("prev=").append(f.putAttribute(a[1], a[2])).append(' ').append(f.getAttribute(a[1])).append(' ').append(f.getAttribute("zz")).append(' '); break;
              default: f.setDocValuesGen(Long.parseLong(a[1])); break;
            }
            s.append(state(f));
          } catch (Throwable t) {
            s.append(ex(t));
          }
        }
        return s.toString();
      });
    }
    sb.append(",\"fieldinfo\":{\"ops\":[");
    for (int i = 0; i < ops.size(); i++) sb.append(i > 0 ? "," : "").append(js(ops.get(i)));
    sb.append("],\"out\":[");
    for (int i = 0; i < out.size(); i++) sb.append(i > 0 ? "," : "").append(js(out.get(i)));
    sb.append("]}");

    // ---- FieldInfos
    ops = new ArrayList<>();
    out = new ArrayList<>();
    for (int i = 0; i < 150; i++) {
      int n = r.nextInt(6);
      final List<String[]> ps = new ArrayList<>();
      StringBuilder op = new StringBuilder("FIS:");
      for (int k = 0; k < n; k++) {
        String[] p = new String[8];
        p[0] = "f" + (r.nextInt(12) == 0 ? r.nextInt(3) : k);
        p[1] = "" + (r.nextInt(15) == 0 ? (r.nextBoolean() ? -1 : 0) : (r.nextInt(8) == 0 ? 3 : 10 - k * 2));
        p[2] = r.nextBoolean() ? "1" : "0";
        p[3] = r.nextBoolean() ? "1" : "0";
        p[4] = r.nextBoolean() ? "1" : "0";
        p[5] = "" + r.nextInt(IO.length);
        p[6] = "" + r.nextInt(DV.length);
        p[7] = "-1";
        if (p[6].equals("0")) p[7] = "-1";
        ps.add(p);
        op.append(k > 0 ? "/" : "").append(String.join("|", p));
      }
      run(op.toString(), () -> {
        FieldInfo[] infos = new FieldInfo[ps.size()];
        for (int k = 0; k < infos.length; k++) infos[k] = make(ps.get(k));
        FieldInfos fis = new FieldInfos(infos);
        StringBuilder s = new StringBuilder();
        s.append("freq=").append(fis.hasFreq()).append(" prox=").append(fis.hasProx()).append(" pay=").append(fis.hasPayloads()).append(" off=")
            .append(fis.hasOffsets()).append(" vec=").append(fis.hasVectors()).append(" norms=").append(fis.hasNorms()).append(" dv=")
            .append(fis.hasDocValues()).append(" size=").append(fis.size()).append(" it=");
        for (FieldInfo f : fis) s.append(f.name).append('#').append(f.number).append(';');
        s.append(" byName=");
        for (String nm : new String[] {"f0", "f1", "f2", "f3", "nope"}) s.append(fis.fieldInfo(nm) == null ? "null" : fis.fieldInfo(nm).number).append(',');
        s.append(" byNum=");
        for (int num : new int[] {0, 1, 2, 3, 4, 6, 8, 10, 99}) s.append(fis.fieldInfo(num) == null ? "null" : fis.fieldInfo(num).name).append(',');
        try {
          fis.fieldInfo(-1);
        } catch (Throwable t) {
          s.append(' ').append(ex(t));
        }
        return s.toString();
      });
    }
    sb.append(",\"fieldinfos\":{\"ops\":[");
    for (int i = 0; i < ops.size(); i++) sb.append(i > 0 ? "," : "").append(js(ops.get(i)));
    sb.append("],\"out\":[");
    for (int i = 0; i < out.size(); i++) sb.append(i > 0 ? "," : "").append(js(out.get(i)));
    sb.append("]}}");
    System.out.println(sb);
  }
}
