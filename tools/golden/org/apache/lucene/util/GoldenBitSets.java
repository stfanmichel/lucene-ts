package org.apache.lucene.util;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Random;
import java.util.TreeSet;
import java.util.zip.CRC32;

import org.apache.lucene.search.DocIdSet;
import org.apache.lucene.search.DocIdSetIterator;

/**
 * Generates test/golden/bitsets.json from the ORIGINAL Lucene 5.2.1 FixedBitSet, LongBitSet, SparseFixedBitSet, BitSet
 * (leap-frog and/andNot/or), BitSetIterator, BitDocIdSet(+Builder), DocIdSet.EMPTY and DocIdSetIterator.empty()/all().
 * Every section is a list of cases {"c": config, "ops": [...], "out": [...]}; the TypeScript test replays config and ops.
 * Assertions are enabled when running (like Lucene's tests): assertion failures are part of the recorded behaviour.
 */
public class GoldenBitSets {
  static final Random r = new Random(5216);
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

  static String words(long[] w) {
    StringBuilder o = new StringBuilder();
    for (long x : w) o.append(Long.toHexString(x)).append(' ');
    return dig(o.toString());
  }

  /** Iterator over a sorted array of docs, with an explicit cost. */
  static class IntIt extends DocIdSetIterator {
    final int[] docs;
    final long cost;
    int i = -1, doc = -1;
    IntIt(int[] docs, long cost) { this.docs = docs; this.cost = cost; }
    @Override public int docID() { return doc; }
    @Override public int nextDoc() { i++; return doc = i < docs.length ? docs[i] : NO_MORE_DOCS; }
    @Override public int advance(int target) { int d; do { d = nextDoc(); } while (d < target); return d; }
    @Override public long cost() { return cost; }
    public int slow(int target) throws java.io.IOException { return slowAdvance(target); }
  }

  static int[] sortedDocs(int count, int bound) {
    TreeSet<Integer> s = new TreeSet<>();
    for (int i = 0; i < count; i++) s.add(r.nextInt(Math.max(bound, 1)));
    int[] d = new int[s.size()];
    int k = 0;
    for (int x : s) d[k++] = x;
    return d;
  }

  static String spec(int[] docs, long cost, boolean positioned) {
    StringBuilder o = new StringBuilder();
    for (int d : docs) o.append(d).append(',');
    return o + ";" + cost + ";" + (positioned ? "p" : "u");
  }

  static IntIt mk(int[] docs, long cost, boolean positioned) {
    IntIt it = new IntIt(docs, cost);
    if (positioned) it.nextDoc();
    return it;
  }

  // =============================================================== FixedBitSet
  static void fixed() throws Exception {
    begin("fixedBitSet");
    for (int c = 0; c < 220; c++) {
      int n = new int[] {0, 1, 5, 63, 64, 65, 100, 127, 128, 129, 200, 300, 1000}[r.nextInt(13)];
      int m = r.nextInt(5) == 0 ? new int[] {0, 1, 64, 300, 1000}[r.nextInt(5)] : Math.min(n, r.nextInt(n + 1));
      String cfg = n + "," + m;
      List<String> ops = new ArrayList<>(), out = new ArrayList<>();
      FixedBitSet A, B;
      try { A = new FixedBitSet(n); B = new FixedBitSet(m); } catch (Throwable t) { ops.add("ctor"); out.add(ex(t)); cs(cfg, ops, out); continue; }
      int steps = 20 + r.nextInt(50);
      for (int k = 0; k < steps + 8; k++) {
        String op = "?", res = "ok";
        int x = n == 0 ? 0 : r.nextInt(n), y = n == 0 ? 0 : r.nextInt(n + 1);
        if (r.nextInt(12) == 0) { x = r.nextInt(n + 70) - 3; y = r.nextInt(n + 70) - 3; }
        if (y < x && r.nextInt(4) != 0) { int t = x; x = y; y = t; }
        try {
          int sel = k < 8 ? 0 : r.nextInt(34);
          switch (sel) {
            case 0: op = "setB " + (m == 0 ? 0 : r.nextInt(m)) + " " + (m == 0 ? 0 : r.nextInt(m + 1)); { String[] p = op.split(" "); int a = Integer.parseInt(p[1]), b = Integer.parseInt(p[2]); if (b < a) { b = a; op = "setB " + a + " " + b; } B.set(a, b); } break;
            case 1: op = "set " + x; A.set(x); break;
            case 2: op = "set " + x + " " + y; A.set(x, y); break;
            case 3: op = "clear " + x; A.clear(x); break;
            case 4: op = "clear " + x + " " + y; A.clear(x, y); break;
            case 5: op = "flip " + x; A.flip(x); break;
            case 6: op = "flip " + x + " " + y; A.flip(x, y); break;
            case 7: op = "get " + x; res = Boolean.toString(A.get(x)); break;
            case 8: op = "getAndSet " + x; res = Boolean.toString(A.getAndSet(x)); break;
            case 9: op = "getAndClear " + x; res = Boolean.toString(A.getAndClear(x)); break;
            case 10: op = "next " + x; res = Integer.toString(A.nextSetBit(x)); break;
            case 11: op = "prev " + x; res = Integer.toString(A.prevSetBit(x)); break;
            case 12: op = "card"; res = Integer.toString(A.cardinality()); break;
            case 13: op = "scanEmpty"; res = Boolean.toString(A.scanIsEmpty()); break;
            case 14: op = "intersects"; res = Boolean.toString(A.intersects(B)); break;
            case 15: op = "or"; A.or(B); break;
            case 16: op = "xor"; A.xor(B); break;
            case 17: op = "and"; A.and(B); break;
            case 18: op = "andNot"; A.andNot(B); break;
            case 19: op = "orBIt"; A.or(new BitSetIterator(B, 7)); break;
            case 20: op = "xorBIt"; A.xor(new BitSetIterator(B, 7)); break;
            case 21: op = "andBIt"; A.and(new BitSetIterator(B, 7)); break;
            case 22: op = "andNotBIt"; A.andNot(new BitSetIterator(B, 7)); break;
            case 23: { int[] d = sortedDocs(r.nextInt(12), n + (r.nextInt(4) == 0 ? 20 : 0)); boolean p = r.nextInt(8) == 0; op = "orIt " + spec(d, d.length, p); A.or(mk(d, d.length, p)); break; }
            case 24: { int[] d = sortedDocs(r.nextInt(12), n + (r.nextInt(4) == 0 ? 20 : 0)); boolean p = r.nextInt(8) == 0; op = "xorIt " + spec(d, d.length, p); A.xor(mk(d, d.length, p)); break; }
            case 25: { int[] d = sortedDocs(r.nextInt(40), n + (r.nextInt(4) == 0 ? 20 : 0)); boolean p = r.nextInt(8) == 0; op = "andIt " + spec(d, d.length, p); A.and(mk(d, d.length, p)); break; }
            case 26: { int[] d = sortedDocs(r.nextInt(40), n + (r.nextInt(4) == 0 ? 20 : 0)); boolean p = r.nextInt(8) == 0; op = "andNotIt " + spec(d, d.length, p); A.andNot(mk(d, d.length, p)); break; }
            case 27: op = "equalsB"; res = Boolean.toString(A.equals(B)); break;
            case 28: op = "cloneEq"; { FixedBitSet cl = A.clone(); res = A.equals(cl) + "/" + cl.hashCode() + "/" + (cl != A) + "/" + words(cl.getBits()); } break;
            case 29: op = "static"; res = FixedBitSet.intersectionCount(A, B) + "/" + FixedBitSet.unionCount(A, B) + "/" + FixedBitSet.andNotCount(A, B) + "/" + FixedBitSet.unionCount(B, A) + "/" + FixedBitSet.andNotCount(B, A); break;
            case 30: { int nn = r.nextInt(n + 200); op = "ensure " + nn; FixedBitSet e = FixedBitSet.ensureCapacity(A, nn); res = (e == A) + "/" + e.length() + "/" + e.getBits().length; A = e; break; }
            case 31: op = "ram"; res = A.ramBytesUsed() + "/" + B.ramBytesUsed(); break;
            case 32: op = "setB " + (m == 0 ? 0 : r.nextInt(m)); { int a = Integer.parseInt(op.split(" ")[1]); B.set(a); } break;
            default: op = "hash"; res = A.hashCode() + "/" + A.length() + "/" + B.hashCode(); break;
          }
        } catch (Throwable t) { res = ex(t); }
        ops.add(op); out.add(res);
        if (k % 9 == 8) { ops.add("dump"); out.add(A.length() + "/" + A.cardinality() + "/" + A.hashCode() + "/" + words(A.getBits()) + "/" + words(B.getBits())); }
      }
      ops.add("dump"); out.add(A.length() + "/" + A.cardinality() + "/" + A.hashCode() + "/" + words(A.getBits()) + "/" + words(B.getBits()));
      cs(cfg, ops, out);
    }
    // constructors on stored words
    {
      List<String> ops = new ArrayList<>(), out = new ArrayList<>();
      for (int[] t : new int[][] {{3, 100}, {2, 100}, {2, 128}, {2, 129}, {2, 0}, {0, 0}, {1, 64}, {1, 65}, {4, 1}, {2, -1}, {2, -64}, {2, -70}, {2, -200}}) {
        ops.add("ctor " + t[0] + " " + t[1]);
        try { long[] w = new long[t[0]]; FixedBitSet f = new FixedBitSet(w, t[1]); out.add(f.length() + "/" + f.cardinality() + "/" + (f.getBits() == w)); } catch (Throwable e) { out.add(ex(e)); }
      }
      // ghost bits set
      for (int[] t : new int[][] {{2, 100}, {2, 128}, {3, 128}, {1, 70}}) {
        ops.add("ghost " + t[0] + " " + t[1]);
        try { long[] w = new long[t[0]]; w[t[0] - 1] = -1L; FixedBitSet f = new FixedBitSet(w, t[1]); out.add(f.length() + "/" + f.cardinality()); } catch (Throwable e) { out.add(ex(e)); }
      }
      for (int n : new int[] {0, 1, 63, 64, 65, -1, -64, -65, -70, -200}) {
        ops.add("new " + n);
        try { FixedBitSet f = new FixedBitSet(n); out.add(f.length() + "/" + f.getBits().length + "/" + f.ramBytesUsed()); } catch (Throwable e) { out.add(ex(e)); }
      }
      for (int n : new int[] {-200, -65, -64, -1, 0, 1, 63, 64, 65, 127, 128, 129, Integer.MAX_VALUE}) { ops.add("b2w " + n); out.add(Integer.toString(FixedBitSet.bits2words(n))); }
      cs("ctors", ops, out);
    }
    end();
  }

  // =============================================================== LongBitSet
  static void longSet() throws Exception {
    begin("longBitSet");
    for (int c = 0; c < 160; c++) {
      int n = new int[] {0, 1, 5, 63, 64, 65, 100, 127, 128, 129, 200, 300, 1000}[r.nextInt(13)];
      int m = r.nextInt(5) == 0 ? new int[] {0, 1, 64, 300, 1000}[r.nextInt(5)] : Math.min(n, r.nextInt(n + 1));
      String cfg = n + "," + m;
      List<String> ops = new ArrayList<>(), out = new ArrayList<>();
      LongBitSet A = new LongBitSet(n), B = new LongBitSet(m);
      int steps = 20 + r.nextInt(50);
      for (int k = 0; k < steps + 8; k++) {
        String op = "?", res = "ok";
        int x = n == 0 ? 0 : r.nextInt(n), y = n == 0 ? 0 : r.nextInt(n + 1);
        if (r.nextInt(12) == 0) { x = r.nextInt(n + 70) - 3; y = r.nextInt(n + 70) - 3; }
        if (y < x && r.nextInt(4) != 0) { int t = x; x = y; y = t; }
        try {
          int sel = k < 8 ? 0 : r.nextInt(27);
          switch (sel) {
            case 0: { int a = m == 0 ? 0 : r.nextInt(m), b = m == 0 ? 0 : r.nextInt(m + 1); if (b < a) b = a; op = "setB " + a + " " + b; B.set(a, b); break; }
            case 1: op = "set " + x; A.set(x); break;
            case 2: op = "set " + x + " " + y; A.set(x, y); break;
            case 3: op = "clear " + x; A.clear(x); break;
            case 4: op = "clear " + x + " " + y; A.clear(x, y); break;
            case 5: op = "flip " + x; A.flip(x); break;
            case 6: op = "flip " + x + " " + y; A.flip(x, y); break;
            case 7: op = "get " + x; res = Boolean.toString(A.get(x)); break;
            case 8: op = "getAndSet " + x; res = Boolean.toString(A.getAndSet(x)); break;
            case 9: op = "getAndClear " + x; res = Boolean.toString(A.getAndClear(x)); break;
            case 10: op = "next " + x; res = Long.toString(A.nextSetBit(x)); break;
            case 11: op = "prev " + x; res = Long.toString(A.prevSetBit(x)); break;
            case 12: op = "card"; res = Long.toString(A.cardinality()); break;
            case 13: op = "scanEmpty"; res = Boolean.toString(A.scanIsEmpty()); break;
            case 14: op = "intersects"; res = Boolean.toString(A.intersects(B)); break;
            case 15: op = "or"; A.or(B); break;
            case 16: op = "xor"; A.xor(B); break;
            case 17: op = "and"; A.and(B); break;
            case 18: op = "andNot"; A.andNot(B); break;
            case 19: op = "equalsB"; res = Boolean.toString(A.equals(B)); break;
            case 20: op = "cloneEq"; { LongBitSet cl = A.clone(); res = A.equals(cl) + "/" + cl.hashCode() + "/" + words(cl.getBits()); } break;
            case 21: { int nn = r.nextInt(n + 200); op = "ensure " + nn; LongBitSet e = LongBitSet.ensureCapacity(A, nn); res = (e == A) + "/" + e.length() + "/" + e.getBits().length; A = e; break; }
            case 22: op = "setB1 " + (m == 0 ? 0 : r.nextInt(m)); B.set(Integer.parseInt(op.split(" ")[1])); break;
            default: op = "hash"; res = A.hashCode() + "/" + A.length() + "/" + B.hashCode(); break;
          }
        } catch (Throwable t) { res = ex(t); }
        ops.add(op); out.add(res);
        if (k % 9 == 8) { ops.add("dump"); out.add(A.length() + "/" + A.cardinality() + "/" + A.hashCode() + "/" + words(A.getBits()) + "/" + words(B.getBits())); }
      }
      ops.add("dump"); out.add(A.length() + "/" + A.cardinality() + "/" + A.hashCode() + "/" + words(A.getBits()) + "/" + words(B.getBits()));
      cs(cfg, ops, out);
    }
    {
      List<String> ops = new ArrayList<>(), out = new ArrayList<>();
      for (long[] t : new long[][] {{3, 100}, {2, 100}, {2, 128}, {2, 129}, {0, 0}, {1, 64}, {2, -1}, {2, -70}, {2, -200}}) {
        ops.add("ctor " + t[0] + " " + t[1]);
        try { long[] w = new long[(int) t[0]]; LongBitSet f = new LongBitSet(w, t[1]); out.add(f.length() + "/" + f.cardinality() + "/" + (f.getBits() == w)); } catch (Throwable e) { out.add(ex(e)); }
      }
      for (long n : new long[] {0, 1, 63, 64, 65, -1, -64, -65, -70, -200, 1L << 33, (1L << 33) + 1}) {
        ops.add("b2w " + n);
        try { out.add(Integer.toString(LongBitSet.bits2words(n))); } catch (Throwable e) { out.add(ex(e)); }
      }
      cs("ctors", ops, out);
    }
    end();
  }

  // =============================================================== SparseFixedBitSet
  static String listSparse(SparseFixedBitSet s) {
    StringBuilder o = new StringBuilder();
    int len = s.length();
    int i = s.nextSetBit(0);
    int count = 0;
    while (i != DocIdSetIterator.NO_MORE_DOCS && count++ < 100000) {
      o.append(i).append(' ');
      if (i + 1 >= len) break;
      i = s.nextSetBit(i + 1);
    }
    o.append('|');
    int p = s.prevSetBit(len - 1);
    count = 0;
    while (p >= 0 && count++ < 100000) {
      o.append(p).append(' ');
      if (p == 0) break;
      p = s.prevSetBit(p - 1);
    }
    return dig(o.toString());
  }

  static String dumpSparse(SparseFixedBitSet s) {
    String approx;
    try { approx = Integer.toString(s.approximateCardinality()); } catch (Throwable t) { approx = ex(t); }
    return s.length() + "/" + s.cardinality() + "/" + approx + "/" + s.ramBytesUsed() + "/" + s.nonZeroLongCount + "/" + listSparse(s);
  }

  static void sparse() throws Exception {
    begin("sparseFixedBitSet");
    for (int c = 0; c < 200; c++) {
      int n = new int[] {1, 2, 63, 64, 65, 100, 4095, 4096, 4097, 8192, 10000, 20000, 100000}[r.nextInt(13)];
      int m = new int[] {1, 64, 4096, 10000, 100000}[r.nextInt(5)];
      String cfg = n + "," + m;
      List<String> ops = new ArrayList<>(), out = new ArrayList<>();
      SparseFixedBitSet A = new SparseFixedBitSet(n), B = new SparseFixedBitSet(m);
      int density = new int[] {3, 30, 300, 3000}[r.nextInt(4)];
      int steps = 25 + r.nextInt(50);
      for (int k = 0; k < steps; k++) {
        String op = "?", res = "ok";
        int x = r.nextInt(n), y = Math.min(n, x + r.nextInt(density * 3 + 1) + (r.nextInt(6) == 0 ? r.nextInt(n) : 0));
        if (r.nextInt(14) == 0) { x = r.nextInt(n + 70) - 3; y = r.nextInt(n + 70) - 3; }
        try {
          int sel = k < 6 ? 0 : r.nextInt(22);
          switch (sel) {
            case 0: case 1: case 2: { int cnt = 1 + r.nextInt(density); StringBuilder o = new StringBuilder(); for (int q = 0; q < cnt; q++) { int v = r.nextInt(n); o.append(v).append(','); A.set(v); } op = "setMany " + o; break; }
            case 3: op = "set " + x; A.set(x); break;
            case 4: op = "clear " + x; A.clear(x); break;
            case 5: op = "clear " + x + " " + y; A.clear(x, y); break;
            case 6: op = "get " + x; res = Boolean.toString(A.get(x)); break;
            case 7: { int v = r.nextInt(n); op = "next " + v; res = Integer.toString(A.nextSetBit(v)); break; }
            case 8: { int v = r.nextInt(n); op = "prev " + v; res = Integer.toString(A.prevSetBit(v)); break; }
            case 9: op = "next " + n; res = Integer.toString(A.nextSetBit(n)); break;
            case 10: op = "card"; res = A.cardinality() + "/" + A.approximateCardinality(); break;
            case 11: { int cnt = 1 + r.nextInt(density); StringBuilder o = new StringBuilder(); for (int q = 0; q < cnt; q++) { int v = r.nextInt(m); o.append(v).append(','); B.set(v); } op = "setManyB " + o; break; }
            case 12: { int[] d = sortedDocs(r.nextInt(density + 1), n); long cost = r.nextBoolean() ? d.length : r.nextInt(50); boolean p = r.nextInt(10) == 0; op = "orIt " + spec(d, cost, p); A.or(mk(d, cost, p)); break; }
            case 13: { int[] d = sortedDocs(r.nextInt(density + 1), n + (r.nextInt(3) == 0 ? 30 : 0)); boolean p = r.nextInt(10) == 0; op = "andIt " + spec(d, d.length, p); A.and(mk(d, d.length, p)); break; }
            case 14: { int[] d = sortedDocs(r.nextInt(density + 1), n + (r.nextInt(3) == 0 ? 30 : 0)); boolean p = r.nextInt(10) == 0; op = "andNotIt " + spec(d, d.length, p); A.andNot(mk(d, d.length, p)); break; }
            case 15: op = "orB"; A.or(new BitSetIterator(B, 1)); break;
            case 16: op = "andB"; A.and(new BitSetIterator(B, 1)); break;
            case 17: op = "andNotB"; A.andNot(new BitSetIterator(B, 1)); break;
            case 18: op = "ram"; res = A.ramBytesUsed() + "/" + B.ramBytesUsed(); break;
            case 19: op = "str"; res = A.toString(); break;
            case 20: { FixedBitSet f = new FixedBitSet(Math.min(n, 50000)); int[] d = sortedDocs(r.nextInt(density + 1), f.length()); for (int v : d) f.set(v); op = "orFixed " + spec(d, 0, false); A.or(new BitSetIterator(f, d.length)); break; }
            default: op = "dump"; res = dumpSparse(A); break;
          }
        } catch (Throwable t) { res = ex(t); }
        ops.add(op); out.add(res);
      }
      ops.add("dump"); out.add(dumpSparse(A));
      ops.add("dumpB"); out.add(dumpSparse(B));
      cs(cfg, ops, out);
    }
    {
      List<String> ops = new ArrayList<>(), out = new ArrayList<>();
      for (int n : new int[] {1, 2, 4095, 4096, 4097, 1 << 20, 0, -1}) {
        ops.add("new " + n);
        try { SparseFixedBitSet s = new SparseFixedBitSet(n); out.add(s.length() + "/" + s.ramBytesUsed() + "/" + s.cardinality() + "/" + s.approximateCardinality()); } catch (Throwable e) { out.add(ex(e)); }
      }
      cs("ctors", ops, out);
    }
    end();
  }

  // =============================================================== BitSetIterator, DocIdSetIterator, DocIdSet
  static void iterators() throws Exception {
    begin("iterators");
    for (int c = 0; c < 120; c++) {
      int n = new int[] {1, 10, 64, 100, 5000, 10000}[r.nextInt(6)];
      boolean sparse = r.nextBoolean();
      int cnt = r.nextInt(Math.min(n, 60) + 1);
      int[] d = sortedDocs(cnt, n);
      BitSet bs;
      if (sparse) { SparseFixedBitSet s = new SparseFixedBitSet(n); for (int v : d) s.set(v); bs = s; }
      else { FixedBitSet f = new FixedBitSet(n); for (int v : d) f.set(v); bs = f; }
      long cost = r.nextInt(100);
      BitSetIterator it = new BitSetIterator(bs, cost);
      String cfg = n + "," + sparse + "," + cost + "," + spec(d, 0, false);
      List<String> ops = new ArrayList<>(), out = new ArrayList<>();
      ops.add("fixedOrNull"); out.add(Boolean.toString(BitSetIterator.getFixedBitSetOrNull(it) != null) + "/" + (BitSetIterator.getSparseFixedBitSetOrNull(it) != null) + "/" + (BitSetIterator.getFixedBitSetOrNull(DocIdSetIterator.empty()) != null) + "/" + (BitSetIterator.getSparseFixedBitSetOrNull(new IntIt(new int[0], 0)) != null));
      for (int k = 0; k < 25; k++) {
        String op = "?", res;
        try {
          switch (r.nextInt(5)) {
            case 0: op = "doc"; res = Integer.toString(it.docID()); break;
            case 1: op = "cost"; res = Long.toString(it.cost()); break;
            case 2: { int t = r.nextInt(n + 5) + (it.docID() < 0 ? 0 : it.docID()); op = "adv " + t; res = Integer.toString(it.advance(t)); break; }
            default: op = "next"; res = Integer.toString(it.nextDoc()); break;
          }
        } catch (Throwable t) { res = ex(t); }
        ops.add(op); out.add(res);
      }
      cs(cfg, ops, out);
    }
    // empty() and all()
    for (int c = 0; c < 40; c++) {
      boolean all = r.nextBoolean();
      int maxDoc = r.nextInt(12);
      DocIdSetIterator it = all ? DocIdSetIterator.all(maxDoc) : (r.nextBoolean() ? DocIdSetIterator.empty() : DocIdSet.EMPTY.iterator());
      List<String> ops = new ArrayList<>(), out = new ArrayList<>();
      for (int k = 0; k < 12; k++) {
        String op = "?", res;
        try {
          switch (r.nextInt(4)) {
            case 0: op = "doc"; res = Integer.toString(it.docID()); break;
            case 1: op = "cost"; res = Long.toString(it.cost()); break;
            case 2: { int t = r.nextInt(maxDoc + 4) - (r.nextInt(8) == 0 ? 2 : 0); op = "adv " + t; res = Integer.toString(it.advance(t)); break; }
            default: op = "next"; res = Integer.toString(it.nextDoc()); break;
          }
        } catch (Throwable t) { res = ex(t); }
        ops.add(op); out.add(res);
      }
      cs((all ? "all " : "empty ") + maxDoc, ops, out);
    }
    // slowAdvance
    for (int c = 0; c < 40; c++) {
      int[] d = sortedDocs(r.nextInt(15), 50);
      IntIt it = new IntIt(d, d.length);
      List<String> ops = new ArrayList<>(), out = new ArrayList<>();
      for (int k = 0; k < 8; k++) {
        int t = r.nextInt(60) - 2;
        ops.add("slow " + t);
        try { out.add(Integer.toString(it.slow(t))); } catch (Throwable e) { out.add(ex(e)); }
      }
      cs("slow " + spec(d, d.length, false), ops, out);
    }
    // DocIdSet.EMPTY
    {
      List<String> ops = new ArrayList<>(), out = new ArrayList<>();
      ops.add("cacheable"); out.add(Boolean.toString(DocIdSet.EMPTY.isCacheable()));
      ops.add("bits"); try { out.add(String.valueOf(DocIdSet.EMPTY.bits())); } catch (Throwable e) { out.add(ex(e)); }
      ops.add("ram"); out.add(Long.toString(DocIdSet.EMPTY.ramBytesUsed()));
      ops.add("children"); out.add(Integer.toString(DocIdSet.EMPTY.getChildResources().size()));
      ops.add("sameInstance"); out.add(Boolean.toString(DocIdSet.EMPTY == DocIdSet.EMPTY));
      cs("empty", ops, out);
    }
    end();
  }

  // =============================================================== BitDocIdSet and its Builder
  static String listIt(DocIdSetIterator it) throws java.io.IOException {
    StringBuilder o = new StringBuilder();
    int d, cnt = 0;
    while ((d = it.nextDoc()) != DocIdSetIterator.NO_MORE_DOCS && cnt++ < 100000) o.append(d).append(' ');
    return dig(o.toString());
  }

  static void builder() throws Exception {
    begin("bitDocIdSetBuilder");
    for (int c = 0; c < 200; c++) {
      int maxDoc = new int[] {1, 10, 1000, 5000, 20000, 100000}[r.nextInt(6)];
      boolean full = r.nextInt(8) == 0;
      String cfg = maxDoc + "," + full;
      List<String> ops = new ArrayList<>(), out = new ArrayList<>();
      BitDocIdSet.Builder b = new BitDocIdSet.Builder(maxDoc, full);
      int steps = 5 + r.nextInt(15);
      for (int k = 0; k < steps; k++) {
        String op = "?", res = "ok";
        try {
          switch (r.nextInt(9)) {
            case 0: case 1: case 2: { int[] d = sortedDocs(r.nextInt(30), maxDoc); long cost = r.nextBoolean() ? d.length : r.nextInt(300); op = "or " + spec(d, cost, false); b.or(mk(d, cost, false)); break; }
            case 3: { int[] d = sortedDocs(r.nextInt(30), maxDoc); boolean sp = r.nextBoolean(); op = "orSet " + sp + " " + spec(d, 0, false);
              BitSet bs; if (sp) { SparseFixedBitSet s = new SparseFixedBitSet(maxDoc); for (int v : d) s.set(v); bs = s; } else { FixedBitSet f = new FixedBitSet(maxDoc); for (int v : d) f.set(v); bs = f; }
              b.or(new BitSetIterator(bs, d.length)); break; }
            case 4: { int[] d = sortedDocs(r.nextInt(40), maxDoc + (r.nextInt(3) == 0 ? 20 : 0)); op = "and " + spec(d, d.length, false); b.and(mk(d, d.length, false)); break; }
            case 5: { int[] d = sortedDocs(r.nextInt(40), maxDoc + (r.nextInt(3) == 0 ? 20 : 0)); op = "andNot " + spec(d, d.length, false); b.andNot(mk(d, d.length, false)); break; }
            case 6: op = "state"; res = b.dense() + "/" + b.isDefinitelyEmpty(); break;
            default: {
              op = "build";
              BitDocIdSet s = b.build();
              if (s == null) res = "null";
              else {
                DocIdSetIterator it = s.iterator();
                res = s.bits().length() + "/" + (s.bits() instanceof SparseFixedBitSet) + "/" + it.cost() + "/" + s.ramBytesUsed() + "/" + s.isCacheable() + "/" + listIt(it)
                    + "/" + (s.bits() instanceof SparseFixedBitSet ? s.toString() : "dense") + "/" + b.isDefinitelyEmpty();
              }
              break;
            }
          }
        } catch (Throwable t) { res = ex(t); }
        ops.add(op); out.add(res);
      }
      cs(cfg, ops, out);
    }
    // direct constructors
    {
      List<String> ops = new ArrayList<>(), out = new ArrayList<>();
      for (int i = 0; i < 20; i++) {
        int n = new int[] {1, 64, 1000, 10000}[r.nextInt(4)];
        boolean sp = r.nextBoolean();
        int[] d = sortedDocs(r.nextInt(50), n);
        BitSet bs; if (sp) { SparseFixedBitSet s = new SparseFixedBitSet(n); for (int v : d) s.set(v); bs = s; } else { FixedBitSet f = new FixedBitSet(n); for (int v : d) f.set(v); bs = f; }
        boolean explicit = r.nextBoolean();
        long cost = r.nextInt(100);
        ops.add("new " + n + " " + sp + " " + explicit + " " + cost + " " + spec(d, 0, false));
        BitDocIdSet s = explicit ? new BitDocIdSet(bs, cost) : new BitDocIdSet(bs);
        DocIdSetIterator it = s.iterator();
        out.add(it.cost() + "/" + s.ramBytesUsed() + "/" + listIt(it) + "/" + s.bits().length() + "/" + (sp ? s.toString() : "dense") + "/" + s.getChildResources().size());
      }
      cs("direct", ops, out);
    }
    end();
  }

  public static void main(String[] args) throws Exception {
    sb.append("{\n");
    fixed();
    longSet();
    sparse();
    iterators();
    builder();
    sb.append("\n}\n");
    System.out.print(sb);
  }
}
