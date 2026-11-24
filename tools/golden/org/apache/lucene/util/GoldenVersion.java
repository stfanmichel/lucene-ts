package org.apache.lucene.util;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/** Generates test/golden/version.json from the ORIGINAL Lucene 5.2.1 Version (parse, parseLeniently, constants, onOrAfter). */
public class GoldenVersion {
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

  static String desc(Version v) {
    return v + "|" + v.major + "," + v.minor + "," + v.bugfix + "," + v.prerelease + "|" + v.hashCode();
  }

  static String ex(Throwable t) {
    String s = "EX:" + t.getClass().getSimpleName() + ":" + t.getMessage();
    if (t.getCause() != null) s += " <- " + t.getCause().getClass().getSimpleName() + ":" + t.getCause().getMessage();
    if (t instanceof java.text.ParseException) s += " @" + ((java.text.ParseException) t).getErrorOffset();
    return s;
  }

  public static void main(String[] args) throws Exception {
    List<String> ops = new ArrayList<>(), out = new ArrayList<>();
    // constants
    List<Version> all = new ArrayList<>();
    for (Field f : Version.class.getFields()) {
      if (Modifier.isStatic(f.getModifiers()) && f.getType() == Version.class) {
        Version v = (Version) f.get(null);
        ops.add("C:" + f.getName());
        out.add(desc(v));
        all.add(v);
      }
    }
    String[] strs = {"5.2.1", "5.2", "5", "", "5.", ".5", "5..1", "4.0.0.0", "4.0.0.1", "4.0.0.2", "4.0.0.3", "4.1.0.1", "4.0.0.0.0",
        "4.0.0.1.1", "a.b.c", "4.x", "4.1.x", "4.0.0.x", "256.0.0", "0.256.0", "0.0.256", "-1.0.0", "1.-1.0", "1.0.-1", "+5.2.1",
        "٥.٢.١", "99999999999.0.0", "5.2.1 ", " 5.2.1", "5.2.1.", "4.10.4", "4.0.0.0000", "007.01.02", "2147483648.1", "1.1.1.1"};
    for (String s : strs) {
      ops.add("P:" + s);
      try {
        out.add(desc(Version.parse(s)));
      } catch (Throwable t) {
        out.add(ex(t));
      }
    }
    String[] lenient = {"LATEST", "latest", "LUCENE_CURRENT", "lucene_current", "LUCENE_4_0_0", "lucene_4_0_0_alpha", "LUCENE_4_0_0_BETA",
        "LUCENE_4_0_0_GAMMA", "LUCENE_4_9", "LUCENE_49", "LUCENE_5_2_1", "LUCENE_5_2", "LUCENE_5_2_1_1", "LUCENE_5", "LUCENE_4_10_4",
        "4.9", "5.2.1", "4.0.0.1", "LUCENE_", "LUCENE_4_x", "LUCENE_44", "LUCENE_123", "x", "", "LUCENE_4_10", "lucene_5_0_0"};
    for (String s : lenient) {
      ops.add("L:" + s);
      try {
        out.add(desc(Version.parseLeniently(s)));
      } catch (Throwable t) {
        out.add(ex(t));
      }
    }
    int[][] bits = {{5, 2, 1}, {0, 0, 0}, {255, 255, 255}, {256, 0, 0}, {0, 256, 0}, {0, 0, 256}, {-1, 0, 0}, {4, 10, 4}, {3, 0, 0}};
    for (int[] b : bits) {
      ops.add("B:" + b[0] + "," + b[1] + "," + b[2]);
      try {
        out.add(desc(Version.fromBits(b[0], b[1], b[2])));
      } catch (Throwable t) {
        out.add(ex(t));
      }
    }
    // pairwise onOrAfter / equals across constants and some parsed
    all.add(Version.parse("5.3.0"));
    all.add(Version.parse("3.6.2"));
    all.add(Version.parse("4.0.0.2"));
    all.add(Version.fromBits(4, 0, 0));
    for (int i = 0; i < all.size(); i++) {
      StringBuilder sb = new StringBuilder();
      for (int j = 0; j < all.size(); j++) {
        sb.append(all.get(i).onOrAfter(all.get(j)) ? '1' : '0').append(all.get(i).equals(all.get(j)) ? '1' : '0');
      }
      ops.add("O:" + all.get(i) + "#" + i);
      out.add(sb.toString());
    }
    StringBuilder sb = new StringBuilder("{\"ops\":[");
    for (int i = 0; i < ops.size(); i++) sb.append(i > 0 ? "," : "").append(js(ops.get(i)));
    sb.append("],\"out\":[");
    for (int i = 0; i < out.size(); i++) sb.append(i > 0 ? "," : "").append(js(out.get(i)));
    sb.append("]}");
    System.out.println(sb);
  }
}
