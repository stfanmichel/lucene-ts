package org.apache.lucene.codecs;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Random;

import org.apache.lucene.store.ByteArrayDataInput;
import org.apache.lucene.store.ByteArrayDataOutput;
import org.apache.lucene.store.ChecksumIndexInput;
import org.apache.lucene.store.IOContext;
import org.apache.lucene.store.IndexInput;
import org.apache.lucene.store.IndexOutput;
import org.apache.lucene.store.RAMDirectory;

/**
 * Generates test/golden/codecutil.json from the ORIGINAL Lucene 5.2.1 CodecUtil (+ CorruptIndexException,
 * IndexFormatTooOld/TooNewException). One list of cases {"c","ops","out"}; assertions on.
 */
public class GoldenCodecUtil {
  static final Random r = new Random(5218);

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

  static String hex(byte[] a) {
    StringBuilder s = new StringBuilder();
    for (byte b : a) s.append(String.format("%02x", b & 0xff));
    return s.toString();
  }

  static byte[] unhex(String s) {
    byte[] b = new byte[s.length() / 2];
    for (int i = 0; i < b.length; i++) b[i] = (byte) Integer.parseInt(s.substring(2 * i, 2 * i + 2), 16);
    return b;
  }

  static String norm(String s) {
    return s.replaceAll("\\(resource[= ][^)]*\\)", "(resource R)");
  }

  static String ex(Throwable t) {
    StringBuilder s = new StringBuilder("EX:" + t.getClass().getSimpleName() + ":" + norm(String.valueOf(t.getMessage())));
    for (Throwable x : t.getSuppressed()) s.append(" | SUP:").append(x.getClass().getSimpleName()).append(':').append(norm(String.valueOf(x.getMessage())));
    if (t.getCause() != null) s.append(" | CAUSE:").append(t.getCause().getClass().getSimpleName()).append(':').append(norm(String.valueOf(t.getCause().getMessage())));
    return s.toString();
  }

  static byte[] make(byte[] data) throws IOException {
    RAMDirectory d = new RAMDirectory();
    IndexOutput o = d.createOutput("f", IOContext.DEFAULT);
    o.writeBytes(data, 0, data.length);
    CodecUtil.writeFooter(o);
    o.close();
    IndexInput in = d.openInput("f", IOContext.DEFAULT);
    byte[] b = new byte[(int) in.length()];
    in.readBytes(b, 0, b.length);
    in.close();
    d.close();
    return b;
  }

  static RAMDirectory dirWith(byte[] file) throws IOException {
    RAMDirectory d = new RAMDirectory();
    IndexOutput o = d.createOutput("f", IOContext.DEFAULT);
    o.writeBytes(file, 0, file.length);
    o.close();
    return d;
  }

  static String run(String op) {
    String[] p = op.split(" ", -1);
    try {
      switch (p[0]) {
        case "wh": {
          byte[] b = new byte[400];
          ByteArrayDataOutput o = new ByteArrayDataOutput(b);
          CodecUtil.writeHeader(o, p[1], Integer.parseInt(p[2]));
          return hex(Arrays.copyOf(b, o.getPosition()));
        }
        case "wih": {
          byte[] b = new byte[800];
          ByteArrayDataOutput o = new ByteArrayDataOutput(b);
          CodecUtil.writeIndexHeader(o, p[1], Integer.parseInt(p[2]), unhex(p[3]), p[4]);
          return hex(Arrays.copyOf(b, o.getPosition()));
        }
        case "len":
          return CodecUtil.headerLength(p[1]) + " " + CodecUtil.indexHeaderLength(p[1], p[2]) + " " + CodecUtil.footerLength();
        case "ch": {
          ByteArrayDataInput in = new ByteArrayDataInput(unhex(p[1]));
          int v = CodecUtil.checkHeader(in, p[2], Integer.parseInt(p[3]), Integer.parseInt(p[4]));
          return v + " " + in.getPosition();
        }
        case "cih": {
          ByteArrayDataInput in = new ByteArrayDataInput(unhex(p[1]));
          int v = CodecUtil.checkIndexHeader(in, p[2], Integer.parseInt(p[3]), Integer.parseInt(p[4]), unhex(p[5]), p[6]);
          return v + " " + in.getPosition();
        }
        case "foot": { // foot dataHex -> file bytes
          return hex(make(unhex(p[1])));
        }
        case "cf": { // cf fileHex readN
          RAMDirectory d = dirWith(unhex(p[1]));
          ChecksumIndexInput in = d.openChecksumInput("f", IOContext.DEFAULT);
          in.skipBytes(Integer.parseInt(p[2]));
          long c = CodecUtil.checkFooter(in);
          return Long.toHexString(c) + " " + in.getFilePointer();
        }
        case "cfp": { // cfp fileHex readN message
          RAMDirectory d = dirWith(unhex(p[1]));
          ChecksumIndexInput in = d.openChecksumInput("f", IOContext.DEFAULT);
          in.skipBytes(Integer.parseInt(p[2]));
          try {
            CodecUtil.checkFooter(in, new IOException(p[3]));
            return "returned";
          } catch (Throwable t) {
            return ex(t) + " fp=" + in.getFilePointer();
          }
        }
        case "ret": {
          RAMDirectory d = dirWith(unhex(p[1]));
          IndexInput in = d.openInput("f", IOContext.DEFAULT);
          long c = CodecUtil.retrieveChecksum(in);
          return Long.toHexString(c);
        }
        case "eof": {
          RAMDirectory d = dirWith(unhex(p[1]));
          IndexInput in = d.openInput("f", IOContext.DEFAULT);
          in.seek(Integer.parseInt(p[2]));
          CodecUtil.checkEOF(in);
          return "ok";
        }
        case "ent": {
          RAMDirectory d = dirWith(unhex(p[1]));
          IndexInput in = d.openInput("f", IOContext.DEFAULT);
          return Long.toHexString(CodecUtil.checksumEntireFile(in));
        }
        default:
          throw new IllegalArgumentException(op);
      }
    } catch (Throwable t) {
      return ex(t);
    }
  }

  static byte[] rnd(int n) {
    byte[] b = new byte[n];
    r.nextBytes(b);
    return b;
  }

  public static void main(String[] args) throws Exception {
    List<String> ops = new ArrayList<>();
    String[] codecs = {"Lucene50", "a", "PackedInts", "xéy", "", new String(new char[127]).replace('\0', 'z'), new String(new char[128]).replace('\0', 'z'), "Lucene50StoredFieldsFastData"};
    for (String c : codecs) {
      for (int v : new int[] {0, 1, 7, -1, Integer.MAX_VALUE}) ops.add("wh " + c + " " + v);
      ops.add("len " + c + " sfx");
    }
    byte[] id = rnd(16);
    byte[] shortId = rnd(15);
    for (String c : new String[] {"Lucene50", "A"}) {
      for (String sfx : new String[] {"", "Lucene50_0", "xé", new String(new char[255]).replace('\0', 's'), new String(new char[256]).replace('\0', 's')}) {
        ops.add("wih " + c + " 3 " + hex(id) + " " + sfx);
      }
      ops.add("wih " + c + " 3 " + hex(shortId) + " s");
    }
    // header checks, with random corruption
    List<String> goods = new ArrayList<>();
    for (int i = 0; i < 6; i++) {
      byte[] b = new byte[800];
      ByteArrayDataOutput o = new ByteArrayDataOutput(b);
      String codec = new String[] {"Lucene50", "PackedInts", "BlockTreeTermsDict", "x"}[r.nextInt(4)];
      String suffix = new String[] {"", "Lucene50_0", "abc"}[r.nextInt(3)];
      CodecUtil.writeIndexHeader(o, codec, 2 + r.nextInt(3), id, suffix);
      byte[] h = Arrays.copyOf(b, o.getPosition());
      for (int k = 0; k < 60; k++) {
        byte[] bad = h.clone();
        if (k > 0) {
          int pos = r.nextInt(bad.length);
          bad[pos] ^= (byte) (1 + r.nextInt(255));
        }
        ops.add("cih " + hex(bad) + " " + codec + " 2 4 " + hex(id) + " " + suffix);
        ops.add("ch " + hex(bad) + " " + codec + " 2 4");
        ops.add("ch " + hex(bad) + " " + codec + " 3 3");
        ops.add("cih " + hex(bad) + " " + codec + " 2 4 " + hex(rnd(16)) + " " + suffix);
        ops.add("cih " + hex(bad) + " " + codec + " 2 4 " + hex(id) + " other");
      }
      // truncated
      for (int cut = 0; cut < h.length; cut += 3) ops.add("ch " + hex(Arrays.copyOf(h, cut)) + " " + codec + " 2 4");
    }
    // footers
    for (int i = 0; i < 12; i++) {
      byte[] data = rnd(r.nextInt(300));
      byte[] file = make(data);
      ops.add("foot " + hex(data));
      ops.add("cf " + hex(file) + " " + data.length);
      ops.add("cfp " + hex(file) + " " + data.length + " boom");
      ops.add("cfp " + hex(file) + " " + r.nextInt(data.length + 1) + " boom");
      ops.add("ret " + hex(file));
      ops.add("ent " + hex(file));
      ops.add("eof " + hex(file) + " " + file.length);
      ops.add("eof " + hex(file) + " " + (file.length - 1));
      ops.add("cf " + hex(file) + " " + Math.max(0, data.length - 1));
      ops.add("cfp " + hex(file) + " " + Math.max(0, data.length - 1) + " boom");
      ops.add("cfp " + hex(file) + " " + (data.length + 5) + " boom");
      for (int k = 0; k < 25; k++) {
        byte[] bad = file.clone();
        int pos = k < 16 ? data.length + k : r.nextInt(bad.length);
        bad[pos] ^= (byte) (1 + r.nextInt(255));
        ops.add("cf " + hex(bad) + " " + data.length);
        ops.add("cfp " + hex(bad) + " " + data.length + " boom");
        ops.add("ret " + hex(bad));
        ops.add("ent " + hex(bad));
      }
      for (int cut : new int[] {0, 5, 15, 16, 17}) {
        if (cut <= file.length) {
          byte[] t = Arrays.copyOf(file, Math.max(0, file.length - cut));
          ops.add("cf " + hex(t) + " " + Math.min(data.length, t.length));
          ops.add("cfp " + hex(t) + " " + Math.min(data.length, t.length) + " boom");
          ops.add("ret " + hex(t));
          ops.add("ent " + hex(t));
        }
      }
      byte[] ext = Arrays.copyOf(file, file.length + 3);
      ops.add("cf " + hex(ext) + " " + data.length);
      ops.add("ret " + hex(ext));
      ops.add("ent " + hex(ext));
    }
    StringBuilder sb = new StringBuilder("{\"ops\":[");
    StringBuilder out = new StringBuilder("\"out\":[");
    for (int i = 0; i < ops.size(); i++) {
      if (i > 0) {
        sb.append(",\n");
        out.append(",\n");
      }
      sb.append(js(ops.get(i)));
      out.append(js(run(ops.get(i))));
    }
    System.out.print(sb.append("],\n").append(out).append("]}\n"));
  }
}
