package org.apache.lucene.util;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Random;

/**
 * Generates test/golden/util-sorters.json from the ORIGINAL Lucene 5.2.1 IntroSorter, InPlaceMergeSorter,
 * TimSorter, Sorter, ArrayUtil.introSort/timSort and CollectionUtil.
 *
 * This class lives in package org.apache.lucene.util on purpose: most of Sorter's building blocks
 * (insertionSort, mergeInPlace, lower, upper, rotate, ...) are package-private.
 *
 * Every sorter works on a pair of parallel arrays (key, id) and counts each primitive call, so the
 * TypeScript port is checked not only on the final order (ids reveal instability and tie-breaking) but
 * on the EXACT sequence of compare/swap/copy/save/restore calls it makes.
 */
public class GoldenSorters {
  static final StringBuilder sb = new StringBuilder();
  static final Random r = new Random(5210);

  static final class Data {
    final int[] key, id, tk, ti;
    int pivotKey;
    long nCompare, nSwap, nCopy, nSave, nRestore, nCompareSaved, nSetPivot, nComparePivot;

    Data(int[] k, int slots) {
      key = k.clone();
      id = new int[k.length];
      for (int i = 0; i < id.length; i++) id[i] = i;
      tk = new int[Math.max(slots, 0)];
      ti = new int[Math.max(slots, 0)];
    }

    int compare(int i, int j) { nCompare++; return Integer.compare(key[i], key[j]); }
    void swap(int i, int j) {
      nSwap++;
      int t = key[i]; key[i] = key[j]; key[j] = t;
      t = id[i]; id[i] = id[j]; id[j] = t;
    }
    void copy(int s, int d) { nCopy++; key[d] = key[s]; id[d] = id[s]; }
    void save(int i, int len) {
      nSave++;
      System.arraycopy(key, i, tk, 0, len);
      System.arraycopy(id, i, ti, 0, len);
    }
    void restore(int s, int d) { nRestore++; key[d] = tk[s]; id[d] = ti[s]; }
    int compareSaved(int i, int j) { nCompareSaved++; return Integer.compare(tk[i], key[j]); }
    void setPivot(int i) { nSetPivot++; pivotKey = key[i]; }
    int comparePivot(int j) { nComparePivot++; return Integer.compare(pivotKey, key[j]); }

    String counts() {
      return "{\"compare\":" + nCompare + ",\"swap\":" + nSwap + ",\"copy\":" + nCopy + ",\"save\":" + nSave
          + ",\"restore\":" + nRestore + ",\"compareSaved\":" + nCompareSaved + ",\"setPivot\":" + nSetPivot
          + ",\"comparePivot\":" + nComparePivot + "}";
    }
  }

  static final class SIntro extends IntroSorter {
    final Data d;
    boolean heapUsed;
    SIntro(Data d) { this.d = d; }
    @Override protected int compare(int i, int j) { return d.compare(i, j); }
    @Override protected void swap(int i, int j) { d.swap(i, j); }
    @Override protected void setPivot(int i) { d.setPivot(i); }
    @Override protected int comparePivot(int j) { return d.comparePivot(j); }
    @Override void heapSort(int from, int to) { heapUsed = true; super.heapSort(from, to); }
  }

  static final class SMerge extends InPlaceMergeSorter {
    final Data d;
    SMerge(Data d) { this.d = d; }
    @Override protected int compare(int i, int j) { return d.compare(i, j); }
    @Override protected void swap(int i, int j) { d.swap(i, j); }
  }

  static final class STim extends TimSorter {
    final Data d;
    STim(Data d, int slots) { super(slots); this.d = d; }
    @Override protected int compare(int i, int j) { return d.compare(i, j); }
    @Override protected void swap(int i, int j) { d.swap(i, j); }
    @Override protected void copy(int s, int dd) { d.copy(s, dd); }
    @Override protected void save(int i, int len) { d.save(i, len); }
    @Override protected void restore(int s, int dd) { d.restore(s, dd); }
    @Override protected int compareSaved(int i, int j) { return d.compareSaved(i, j); }
  }

  // ---- helpers ------------------------------------------------------------------
  static String ints(int[] a) {
    StringBuilder s = new StringBuilder("[");
    for (int i = 0; i < a.length; i++) { if (i > 0) s.append(','); s.append(a[i]); }
    return s.append(']').toString();
  }

  static int hash(int[] a) {
    int h = 0;
    for (int x : a) h = h * 31 + x;
    return h;
  }

  /** ids are listed in full for small arrays, as a 31-polynomial hash for big ones. */
  static String idsField(int[] id) {
    return id.length <= 300 ? "\"ids\":" + ints(id) : "\"idsHash\":" + hash(id);
  }

  static String ex(Throwable t) {
    return "\"EX:" + t.getClass().getSimpleName() + ":" + t.getMessage().replace("\"", "\\\"") + "\"";
  }

  static boolean first = true;
  static void emit(String json) {
    if (!first) sb.append(",\n");
    first = false;
    sb.append(json);
  }

  static int[] genKeys(int n, int pat) {
    int[] k = new int[n];
    switch (pat) {
      case 0: for (int i = 0; i < n; i++) k[i] = r.nextInt(6); break;
      case 1: for (int i = 0; i < n; i++) k[i] = r.nextInt(); break;
      case 2: for (int i = 0; i < n; i++) k[i] = i; break;
      case 3: for (int i = 0; i < n; i++) k[i] = n - i; break;
      case 4: Arrays.fill(k, 7); break;
      case 5: for (int i = 0; i < n; i++) k[i] = Math.min(i, n - 1 - i); break;
      case 6: { // ascending runs of random length
        int i = 0;
        while (i < n) {
          int len = 1 + r.nextInt(Math.max(1, n / 4 + 1)), base = r.nextInt(1000);
          for (int j = 0; j < len && i < n; j++) k[i++] = base + j;
        }
        break;
      }
      case 7: { // ascending and descending runs
        int i = 0;
        while (i < n) {
          int len = 1 + r.nextInt(Math.max(1, n / 5 + 1)), base = r.nextInt(1000);
          boolean up = r.nextBoolean();
          for (int j = 0; j < len && i < n; j++) k[i++] = up ? base + j : base - j;
        }
        break;
      }
      case 8: { // sorted with a few swaps
        for (int i = 0; i < n; i++) k[i] = i;
        for (int s = 0; s < n / 20 + 1 && n > 1; s++) { int a = r.nextInt(n), b = r.nextInt(n); int t = k[a]; k[a] = k[b]; k[b] = t; }
        break;
      }
      case 9: for (int i = 0; i < n; i++) k[i] = r.nextInt(n / 3 + 1); break;
      default: for (int i = 0; i < n; i++) k[i] = i % 17; break;
    }
    return k;
  }

  static int[] sortedKeys(int n, int range) {
    int[] k = new int[n];
    for (int i = 0; i < n; i++) k[i] = r.nextInt(range);
    Arrays.sort(k);
    return k;
  }

  /** Number of comparisons made through Item.compareTo / the Item comparator (the ArrayUtil/CollectionUtil cases). */
  static long calls;

  static final class Item implements Comparable<Item> {
    final int key, id;
    Item(int key, int id) { this.key = key; this.id = id; }
    @Override public int compareTo(Item o) { calls++; return Integer.compare(key, o.key); }
  }

  public static void main(String[] args) {
    sb.append("[\n");
    int[] sizes = {0, 1, 2, 3, 5, 19, 20, 21, 40, 63, 64, 65, 100, 128, 200, 300};
    int[] bigSizes = {1500, 4000};

    // ---- full sorts: intro / merge / tim --------------------------------------------
    for (String algo : new String[] {"intro", "merge", "tim"}) {
      List<int[]> cfgs = new ArrayList<>(); // {n, pat, slots}
      for (int n : sizes) {
        for (int pat = 0; pat <= 10; pat++) {
          if (algo.equals("tim")) {
            for (int slots : new int[] {0, 2, 16, n / 2}) cfgs.add(new int[] {n, pat, slots});
          } else {
            cfgs.add(new int[] {n, pat, 0});
          }
        }
      }
      for (int n : bigSizes) {
        for (int pat : new int[] {0, 1, 6, 7, 8, 9}) {
          if (algo.equals("tim")) {
            for (int slots : new int[] {0, 5, n / 64, n / 2}) cfgs.add(new int[] {n, pat, slots});
          } else {
            cfgs.add(new int[] {n, pat, 0});
          }
        }
      }
      for (int[] c : cfgs) {
        int n = c[0], pat = c[1], slots = c[2];
        int[] keys = genKeys(n, pat);
        int from = 0, to = n;
        if (n >= 8 && r.nextBoolean()) { from = r.nextInt(n / 4 + 1); to = n - r.nextInt(n / 4 + 1); }
        Data d = new Data(keys, slots);
        Sorter s = algo.equals("intro") ? new SIntro(d) : algo.equals("merge") ? new SMerge(d) : new STim(d, slots);
        s.sort(from, to);
        emit("{\"t\":\"sort\",\"algo\":\"" + algo + "\",\"slots\":" + slots + ",\"from\":" + from + ",\"to\":" + to
            + ",\"key\":" + ints(keys) + "," + idsField(d.id) + ",\"n\":" + d.counts() + "}");
      }
    }

    // ---- IntroSorter with a forced recursion depth (heapsort fallback) ----------------
    for (int n : new int[] {25, 64, 200, 300}) {
      for (int pat : new int[] {0, 1, 9, 8}) {
        for (int depth : new int[] {0, 1, 2, 3}) {
          int[] keys = genKeys(n, pat);
          Data d = new Data(keys, 0);
          SIntro s = new SIntro(d);
          s.quicksort(0, n, depth);
          emit("{\"t\":\"introDepth\",\"depth\":" + depth + ",\"key\":" + ints(keys) + "," + idsField(d.id)
              + ",\"heap\":" + s.heapUsed + ",\"n\":" + d.counts() + "}");
        }
      }
    }

    // ---- invalid range ---------------------------------------------------------------------
    for (String algo : new String[] {"intro", "merge", "tim"}) {
      Data d = new Data(new int[10], 4);
      Sorter s = algo.equals("intro") ? new SIntro(d) : algo.equals("merge") ? new SMerge(d) : new STim(d, 4);
      String res;
      try { s.sort(5, 3); res = "null"; } catch (RuntimeException e) { res = ex(e); }
      emit("{\"t\":\"badRange\",\"algo\":\"" + algo + "\",\"result\":" + res + "}");
    }

    // ---- components of Sorter ---------------------------------------------------------------
    for (int i = 0; i < 120; i++) { // insertionSort / binarySort / heapSort / reverse
      int n = 1 + r.nextInt(60);
      int[] keys = genKeys(n, new int[] {0, 1, 8, 3}[r.nextInt(4)]);
      int from = r.nextInt(n), to = from + r.nextInt(n - from + 1);
      for (String op : new String[] {"insertionSort", "binarySort", "heapSort", "reverse"}) {
        Data d = new Data(keys, 0);
        SMerge s = new SMerge(d);
        switch (op) {
          case "insertionSort": s.insertionSort(from, to); break;
          case "binarySort": s.binarySort(from, to); break;
          case "heapSort": s.heapSort(from, to); break;
          default: s.reverse(from, to); break;
        }
        emit("{\"t\":\"op\",\"op\":\"" + op + "\",\"key\":" + ints(keys) + ",\"args\":[" + from + "," + to + "],"
            + idsField(d.id) + ",\"n\":" + d.counts() + "}");
      }
    }

    for (int i = 0; i < 120; i++) { // binarySort(from, to, i) with a sorted prefix
      int n = 2 + r.nextInt(60);
      int[] keys = genKeys(n, new int[] {0, 1, 9}[r.nextInt(3)]);
      int from = r.nextInt(n / 2 + 1), idx = from + r.nextInt(n - from);
      Arrays.sort(keys, from, idx);
      Data d = new Data(keys, 0);
      new SMerge(d).binarySort(from, n, idx);
      emit("{\"t\":\"op\",\"op\":\"binarySort3\",\"key\":" + ints(keys) + ",\"args\":[" + from + "," + n + "," + idx + "],"
          + idsField(d.id) + ",\"n\":" + d.counts() + "}");
    }

    for (int i = 0; i < 160; i++) { // rotate, with the default and TimSorter's doRotate
      int n = 2 + r.nextInt(50);
      int[] keys = genKeys(n, 1);
      int lo = r.nextInt(n), mid = lo + r.nextInt(n - lo + 1), hi = mid + r.nextInt(n - mid + 1);
      int slots = new int[] {0, 1, 3, 8, 50}[r.nextInt(5)];
      for (String sorter : new String[] {"merge", "tim"}) {
        Data d = new Data(keys, slots);
        Sorter s = sorter.equals("merge") ? new SMerge(d) : new STim(d, slots);
        s.rotate(lo, mid, hi);
        emit("{\"t\":\"op\",\"op\":\"rotate\",\"sorter\":\"" + sorter + "\",\"slots\":" + slots + ",\"key\":" + ints(keys)
            + ",\"args\":[" + lo + "," + mid + "," + hi + "]," + idsField(d.id) + ",\"n\":" + d.counts() + "}");
      }
    }

    for (int i = 0; i < 160; i++) { // mergeInPlace of two sorted halves
      int n = 2 + r.nextInt(120);
      int mid = 1 + r.nextInt(n - 1);
      int range = new int[] {3, 10, 1000}[r.nextInt(3)];
      int[] keys = new int[n];
      int[] left = sortedKeys(mid, range), right = sortedKeys(n - mid, range);
      System.arraycopy(left, 0, keys, 0, mid);
      System.arraycopy(right, 0, keys, mid, n - mid);
      Data d = new Data(keys, 0);
      new SMerge(d).mergeInPlace(0, mid, n);
      emit("{\"t\":\"op\",\"op\":\"mergeInPlace\",\"key\":" + ints(keys) + ",\"args\":[0," + mid + "," + n + "],"
          + idsField(d.id) + ",\"n\":" + d.counts() + "}");
    }

    for (int i = 0; i < 400; i++) { // lower / upper / lower2 / upper2 on a sorted segment
      int n = 1 + r.nextInt(80);
      int[] keys = new int[n];
      int range = new int[] {3, 12, 1000}[r.nextInt(3)];
      int[] sorted = sortedKeys(n, range);
      System.arraycopy(sorted, 0, keys, 0, n);
      int from = r.nextInt(n), to = from + r.nextInt(n - from + 1);
      int val = r.nextInt(n); // any slot: may lie inside or outside [from, to)
      for (String op : new String[] {"lower", "upper", "lower2", "upper2"}) {
        Data d = new Data(keys, 0);
        SMerge s = new SMerge(d);
        int res = op.equals("lower") ? s.lower(from, to, val) : op.equals("upper") ? s.upper(from, to, val)
            : op.equals("lower2") ? s.lower2(from, to, val) : s.upper2(from, to, val);
        emit("{\"t\":\"op\",\"op\":\"" + op + "\",\"key\":" + ints(keys) + ",\"args\":[" + from + "," + to + "," + val
            + "],\"result\":" + res + ",\"n\":" + d.counts() + "}");
      }
    }

    // ---- TimSorter internals -----------------------------------------------------------------
    for (int i = 0; i < 300; i++) { // merge(lo, mid, hi) of two sorted runs (mergeLo / mergeHi / in place)
      int n = 2 + r.nextInt(i < 250 ? 100 : 600);
      int mid = 1 + r.nextInt(n - 1);
      int range = new int[] {5, 50, 100000}[r.nextInt(3)];
      int[] keys = new int[n];
      int[] left, right;
      if (r.nextInt(3) == 0) { // blocks: forces galloping
        left = sortedKeys(mid, range);
        right = sortedKeys(n - mid, range);
        for (int j = 0; j < left.length; j++) left[j] = left[j] / 7 * 7;
        for (int j = 0; j < right.length; j++) right[j] = right[j] / 7 * 7 + (j < right.length / 2 ? 0 : 3);
        Arrays.sort(left);
        Arrays.sort(right);
      } else {
        left = sortedKeys(mid, range);
        right = sortedKeys(n - mid, range);
      }
      System.arraycopy(left, 0, keys, 0, mid);
      System.arraycopy(right, 0, keys, mid, n - mid);
      int slots = new int[] {0, 1, 4, 16, 64, 700}[r.nextInt(6)];
      Data d = new Data(keys, slots);
      new STim(d, slots).merge(0, mid, n);
      emit("{\"t\":\"op\",\"op\":\"timMerge\",\"slots\":" + slots + ",\"key\":" + ints(keys) + ",\"args\":[0," + mid + "," + n
          + "]," + idsField(d.id) + ",\"n\":" + d.counts() + "}");
    }

    for (int i = 0; i < 400; i++) { // lowerSaved / upperSaved / lowerSaved3 / upperSaved3
      int n = 4 + r.nextInt(80);
      int[] keys = sortedKeys(n, new int[] {4, 15, 1000}[r.nextInt(3)]);
      int slots = 1 + r.nextInt(8);
      int sv = r.nextInt(n - slots + 1 > 0 ? n - slots + 1 : 1), len = Math.min(slots, n - sv);
      int from = r.nextInt(n), to = from + r.nextInt(n - from + 1);
      int val = r.nextInt(len);
      for (String op : new String[] {"lowerSaved", "upperSaved", "lowerSaved3", "upperSaved3"}) {
        Data d = new Data(keys, slots);
        STim s = new STim(d, slots);
        s.save(sv, len);
        d.nSave = 0;
        int res = op.equals("lowerSaved") ? s.lowerSaved(from, to, val) : op.equals("upperSaved") ? s.upperSaved(from, to, val)
            : op.equals("lowerSaved3") ? s.lowerSaved3(from, to, val) : s.upperSaved3(from, to, val);
        emit("{\"t\":\"op\",\"op\":\"" + op + "\",\"slots\":" + slots + ",\"key\":" + ints(keys) + ",\"save\":[" + sv + "," + len
            + "],\"args\":[" + from + "," + to + "," + val + "],\"result\":" + res + ",\"n\":" + d.counts() + "}");
      }
    }

    // ---- static helpers ----------------------------------------------------------------------------
    {
      StringBuilder a = new StringBuilder("[");
      boolean f = true;
      for (int len = 32; len <= 5000; len += (len < 300 ? 1 : 97)) {
        if (!f) a.append(',');
        f = false;
        a.append("[").append(len).append(",").append(TimSorter.minRun(len)).append("]");
      }
      emit("{\"t\":\"minRun\",\"values\":" + a.append("]") + "}");
      StringBuilder c = new StringBuilder("[");
      for (int n = 1; n <= 300; n++) { if (n > 1) c.append(','); c.append("[").append(n).append(",").append(IntroSorter.ceilLog2(n)).append("]"); }
      for (int n : new int[] {1 << 20, (1 << 20) + 1, 1 << 30, (1 << 30) + 1, Integer.MAX_VALUE}) c.append(",[").append(n).append(",").append(IntroSorter.ceilLog2(n)).append("]");
      emit("{\"t\":\"ceilLog2\",\"values\":" + c.append("]") + "}");
      StringBuilder h = new StringBuilder("[");
      for (int i = 0; i < 100; i++) {
        int from = r.nextInt(50), idx = from + r.nextInt(300);
        if (i > 0) h.append(',');
        h.append("[").append(from).append(",").append(idx).append(",").append(Sorter.heapParent(from, idx + 1)).append(",").append(Sorter.heapChild(from, idx)).append("]");
      }
      emit("{\"t\":\"heapIdx\",\"values\":" + h.append("]") + "}");
    }

    // ---- public APIs: ArrayUtil.introSort/timSort, CollectionUtil -------------------------------------
    Comparator<Item> cmp = new Comparator<Item>() {
      @Override public int compare(Item x, Item y) { calls++; return Integer.compare(x.key, y.key); }
    };
    for (int i = 0; i < 360; i++) {
      int n = new int[] {0, 1, 2, 7, 21, 64, 65, 130, 300, 600}[r.nextInt(10)];
      int[] keys = genKeys(n, r.nextInt(11));
      int variant = i % 12;
      int from = 0, to = n;
      if ((variant % 4 == 1 || variant % 4 == 3) && variant < 8) { from = n > 0 ? r.nextInt(n) : 0; to = from + (n > 0 ? r.nextInt(n - from + 1) : 0); }
      if (i % 17 == 0) { from = 5; to = 3; } // reversed range: silently ignored by ArrayUtil
      Item[] a = new Item[n];
      for (int j = 0; j < n; j++) a[j] = new Item(keys[j], j);
      List<Item> list = new ArrayList<>(Arrays.asList(a));
      String name;
      calls = 0;
      switch (variant) {
        case 0: ArrayUtil.introSort(a, cmp); name = "introSort(a,cmp)"; break;
        case 1: ArrayUtil.introSort(a, from, to, cmp); name = "introSort(a,from,to,cmp)"; break;
        case 2: ArrayUtil.introSort(a); name = "introSort(a)"; break;
        case 3: ArrayUtil.introSort(a, from, to); name = "introSort(a,from,to)"; break;
        case 4: ArrayUtil.timSort(a, cmp); name = "timSort(a,cmp)"; break;
        case 5: ArrayUtil.timSort(a, from, to, cmp); name = "timSort(a,from,to,cmp)"; break;
        case 6: ArrayUtil.timSort(a); name = "timSort(a)"; break;
        case 7: ArrayUtil.timSort(a, from, to); name = "timSort(a,from,to)"; break;
        case 8: CollectionUtil.introSort(list, cmp); name = "CollectionUtil.introSort(list,cmp)"; break;
        case 9: CollectionUtil.introSort(list); name = "CollectionUtil.introSort(list)"; break;
        case 10: CollectionUtil.timSort(list, cmp); name = "CollectionUtil.timSort(list,cmp)"; break;
        default: CollectionUtil.timSort(list); name = "CollectionUtil.timSort(list)"; break;
      }
      int[] ids = new int[n];
      for (int j = 0; j < n; j++) ids[j] = variant >= 8 ? list.get(j).id : a[j].id;
      emit("{\"t\":\"api\",\"name\":\"" + name + "\",\"key\":" + ints(keys) + ",\"from\":" + from + ",\"to\":" + to + ","
          + idsField(ids) + ",\"calls\":" + calls + "}");
    }

    // A small slice of a BIG array: ArrayUtil.timSort derives maxTempSlots from the WHOLE array (a.length / 64),
    // so the fast (temporary memory) merges are only reachable when the array is large and the slice nearly sorted.
    for (int i = 0; i < 16; i++) {
      int n = 6000;
      int[] keys = genKeys(n, new int[] {8, 6, 8, 7}[i % 4]);
      int from = 50 + r.nextInt(200), to = from + 300 + r.nextInt(1200);
      Item[] a = new Item[n];
      for (int j = 0; j < n; j++) a[j] = new Item(keys[j], j);
      calls = 0;
      String name;
      if ((i / 4) % 2 == 0) { ArrayUtil.timSort(a, from, to, cmp); name = "timSort(a,from,to,cmp)"; }
      else { ArrayUtil.timSort(a, from, to); name = "timSort(a,from,to)"; }
      int[] ids = new int[n];
      for (int j = 0; j < n; j++) ids[j] = a[j].id;
      emit("{\"t\":\"api\",\"name\":\"" + name + "\",\"key\":" + ints(keys) + ",\"from\":" + from + ",\"to\":" + to + ","
          + idsField(ids) + ",\"calls\":" + calls + "}");
    }

    sb.append("\n]\n");
    System.out.print(sb);
  }
}
