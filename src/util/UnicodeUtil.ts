/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * Some of this code came from the excellent Unicode
 * conversion examples from:
 *
 *   http://www.unicode.org/Public/PROGRAMS/CVTUTF
 *
 * Full Copyright for that code follows (it is reproduced from the Java
 * original, org.apache.lucene.util.UnicodeUtil):
 *
 * Copyright 2001-2004 Unicode, Inc.
 *
 * Disclaimer
 *
 * This source code is provided as is by Unicode, Inc. No claims are
 * made as to fitness for any particular purpose. No warranties of any
 * kind are expressed or implied. The recipient agrees to determine
 * applicability of information provided. If this file has been
 * purchased on magnetic or optical media from Unicode, Inc., the
 * sole remedy for any claim will be exchange of defective media
 * within 90 days of receipt.
 *
 * Limitations on Rights to Redistribute This Code
 *
 * Unicode, Inc. hereby grants the right to freely use the information
 * supplied in this file in the creation of products supporting the
 * Unicode Standard, and to make copies of this file in any form
 * for internal or external distribution as long as this notice
 * remains attached.
 */

// Port of org.apache.lucene.util.UnicodeUtil (Lucene 5.2.1).
//
// Java `char[]` is modelled as `Uint16Array`, Java `byte[]` as `Uint8Array`
// (so `b & 0xff` is only needed where the Java code did it for sign reasons),
// and `CharSequence` as `string` (whose `length` is also in UTF-16 code units).

import { ArrayIndexOutOfBoundsException, IllegalArgumentException } from "../errors.js";
import { lassert } from "./assertions.js";
import { BytesRef } from "./BytesRef.js";
import { Integer } from "./JavaNumbers.js";

const UNI_SUR_HIGH_START = 0xd800;
const UNI_SUR_HIGH_END = 0xdbff;
const UNI_SUR_LOW_START = 0xdc00;
const UNI_SUR_LOW_END = 0xdfff;
const UNI_REPLACEMENT_CHAR = 0xfffd;

const UNI_MAX_BMP = 0x0000ffff;

const HALF_SHIFT = 10;
const HALF_MASK = 0x3ff;

const MIN_SUPPLEMENTARY_CODE_POINT = 0x10000;
const SURROGATE_OFFSET = MIN_SUPPLEMENTARY_CODE_POINT - (UNI_SUR_HIGH_START << HALF_SHIFT) - UNI_SUR_LOW_START;

// Borrowed from Python's 3.1.2 sources,
// Objects/unicodeobject.c, and modified (see commented
// out section, and the -1s) to disallow the reserved for
// future (RFC 3629) 5/6 byte sequence characters, and
// invalid 0xFE and 0xFF bytes.

/* Map UTF-8 encoded prefix byte to sequence length.  Integer.MIN_VALUE
 * means illegal prefix.  see RFC 2279 for details */
const utf8CodeLength: Int32Array = (() => {
  const v = Integer.MIN_VALUE;
  // Like the Java table, this has 248 entries: bytes 0xf8..0xff are out of range
  // and make UTF8toUTF32 throw an ArrayIndexOutOfBoundsException.
  const t = new Int32Array(248);
  for (let i = 0; i < 248; i++) {
    if (i < 0x80) t[i] = 1;
    else if (i < 0xc0) t[i] = v;
    else if (i < 0xe0) t[i] = 2;
    else if (i < 0xf0) t[i] = 3;
    else t[i] = 4;
  }
  return t;
})();

/** Shift value for lead surrogate to form a supplementary character. */
const LEAD_SURROGATE_SHIFT_ = 10;
/** Mask to retrieve the significant value from a trail surrogate. */
const TRAIL_SURROGATE_MASK_ = 0x3ff;
/** Trail surrogate minimum value */
const TRAIL_SURROGATE_MIN_VALUE = 0xdc00;
/** Lead surrogate minimum value */
const LEAD_SURROGATE_MIN_VALUE = 0xd800;
/** The minimum value for Supplementary code points */
const SUPPLEMENTARY_MIN_VALUE = 0x10000;
/** Value that all lead surrogate starts with */
const LEAD_SURROGATE_OFFSET_ = LEAD_SURROGATE_MIN_VALUE - (SUPPLEMENTARY_MIN_VALUE >> LEAD_SURROGATE_SHIFT_);

let bigTerm: BytesRef | undefined;

/**
 * Class to encode UTF16 into UTF8 byte arrays without always allocating a
 * new array, as `Buffer.from(s, "utf8")` does.
 *
 * @lucene.internal
 */
export class UnicodeUtil {
  private constructor() {} // no instance

  /**
   * A binary term consisting of a number of 0xff bytes, likely to be bigger than other terms
   * (e.g. collation keys) one would normally encounter, and definitely bigger than any UTF-8 terms.
   *
   * WARNING: This is not a valid UTF8 Term
   *
   * (Created lazily: BytesRef and UnicodeUtil import each other.)
   */
  static get BIG_TERM(): BytesRef {
    if (bigTerm === undefined) {
      bigTerm = new BytesRef(new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255, 255, 255]));
    }
    return bigTerm;
  }

  static readonly UNI_SUR_HIGH_START = UNI_SUR_HIGH_START;
  static readonly UNI_SUR_HIGH_END = UNI_SUR_HIGH_END;
  static readonly UNI_SUR_LOW_START = UNI_SUR_LOW_START;
  static readonly UNI_SUR_LOW_END = UNI_SUR_LOW_END;
  static readonly UNI_REPLACEMENT_CHAR = UNI_REPLACEMENT_CHAR;

  /** Maximum number of UTF8 bytes per UTF16 character. */
  static readonly MAX_UTF8_BYTES_PER_CHAR = 3;

  /**
   * Encode characters from a char[] (Uint16Array) or a string source,
   * starting at offset for length chars. It is the responsibility of the
   * caller to make sure that the destination array is large enough.
   *
   * NOTE: unlike Java, writing past the end of a typed array is silently
   * ignored, so an undersized `out` truncates the result instead of throwing.
   */
  // TODO: broken if incoming result.offset != 0
  static UTF16toUTF8(source: Uint16Array | string, offset: number, length: number, out: Uint8Array): number {
    const isString = typeof source === "string";
    const at = (i: number): number => (isString ? source.charCodeAt(i) : source[i]!);
    const end = offset + length;

    let upto = 0;
    for (let i = offset; i < end; i++) {
      const code = at(i);

      if (code < 0x80) {
        out[upto++] = code;
      } else if (code < 0x800) {
        out[upto++] = 0xc0 | (code >> 6);
        out[upto++] = 0x80 | (code & 0x3f);
      } else if (code < 0xd800 || code > 0xdfff) {
        out[upto++] = 0xe0 | (code >> 12);
        out[upto++] = 0x80 | ((code >> 6) & 0x3f);
        out[upto++] = 0x80 | (code & 0x3f);
      } else {
        // surrogate pair
        // confirm valid high surrogate
        if (code < 0xdc00 && i < end - 1) {
          let utf32 = at(i + 1);
          // confirm valid low surrogate and write pair
          if (utf32 >= 0xdc00 && utf32 <= 0xdfff) {
            utf32 = (code << 10) + utf32 + SURROGATE_OFFSET;
            i++;
            out[upto++] = 0xf0 | (utf32 >> 18);
            out[upto++] = 0x80 | ((utf32 >> 12) & 0x3f);
            out[upto++] = 0x80 | ((utf32 >> 6) & 0x3f);
            out[upto++] = 0x80 | (utf32 & 0x3f);
            continue;
          }
        }
        // replace unpaired surrogate or out-of-order low surrogate
        // with substitution character
        out[upto++] = 0xef;
        out[upto++] = 0xbf;
        out[upto++] = 0xbd;
      }
    }
    return upto;
  }

  /** Returns true if the string (or the first `size` chars of a Uint16Array) has no unpaired surrogates. */
  static validUTF16String(s: string | Uint16Array, size?: number): boolean {
    const isString = typeof s === "string";
    const n = size ?? s.length;
    for (let i = 0; i < n; i++) {
      const ch = isString ? s.charCodeAt(i) : s[i]!;
      if (ch >= UNI_SUR_HIGH_START && ch <= UNI_SUR_HIGH_END) {
        if (i < n - 1) {
          i++;
          const nextCH = isString ? s.charCodeAt(i) : s[i]!;
          if (nextCH >= UNI_SUR_LOW_START && nextCH <= UNI_SUR_LOW_END) {
            // Valid surrogate pair
          } else {
            // Unmatched high surrogate
            return false;
          }
        } else {
          // Unmatched high surrogate
          return false;
        }
      } else if (ch >= UNI_SUR_LOW_START && ch <= UNI_SUR_LOW_END) {
        // Unmatched low surrogate
        return false;
      }
    }
    return true;
  }

  /**
   * Returns the number of code points in this UTF8 sequence.
   *
   * This method assumes valid UTF8 input. This method does not perform full
   * UTF8 validation, it will check only the first byte of each codepoint (for
   * multi-byte sequences any bytes after the head are skipped).
   *
   * @throws IllegalArgumentException If invalid codepoint header byte occurs or the
   *    content is prematurely truncated.
   */
  static codePointCount(utf8: BytesRef): number {
    let pos = utf8.offset;
    const limit = pos + utf8.length;
    const bytes = utf8.bytes;

    let codePointCount = 0;
    for (; pos < limit; codePointCount++) {
      const v = bytes[pos]!;
      if (v < /* 0xxx xxxx */ 0x80) {
        pos += 1;
        continue;
      }
      if (v >= /* 110x xxxx */ 0xc0) {
        if (v < /* 111x xxxx */ 0xe0) {
          pos += 2;
          continue;
        }
        if (v < /* 1111 xxxx */ 0xf0) {
          pos += 3;
          continue;
        }
        if (v < /* 1111 1xxx */ 0xf8) {
          pos += 4;
          continue;
        }
        // fallthrough, consider 5 and 6 byte sequences invalid.
      }

      // Anything not covered above is invalid UTF8.
      throw new IllegalArgumentException();
    }

    // Check if we didn't go over the limit on the last character.
    if (pos > limit) throw new IllegalArgumentException();

    return codePointCount;
  }

  /**
   * This method assumes valid UTF8 input. This method does not perform full
   * UTF8 validation, it will check only the first byte of each codepoint (for
   * multi-byte sequences any bytes after the head are skipped). It is the
   * responsibility of the caller to make sure that the destination array is
   * large enough.
   *
   * @throws IllegalArgumentException If invalid codepoint header byte occurs or the
   *    content is prematurely truncated.
   */
  static UTF8toUTF32(utf8: BytesRef, ints: Int32Array): number {
    let utf32Count = 0;
    let utf8Upto = utf8.offset;
    const bytes = utf8.bytes;
    const utf8Limit = utf8.offset + utf8.length;
    while (utf8Upto < utf8Limit) {
      const lead = bytes[utf8Upto]!;
      if (lead >= utf8CodeLength.length) {
        throw new ArrayIndexOutOfBoundsException(`Index ${lead} out of bounds for length ${utf8CodeLength.length}`);
      }
      const numBytes = utf8CodeLength[lead]!;
      let v = 0;
      switch (numBytes) {
        case 1:
          ints[utf32Count++] = bytes[utf8Upto++]!;
          continue;
        case 2:
          // 5 useful bits
          v = bytes[utf8Upto++]! & 31;
          break;
        case 3:
          // 4 useful bits
          v = bytes[utf8Upto++]! & 15;
          break;
        case 4:
          // 3 useful bits
          v = bytes[utf8Upto++]! & 7;
          break;
        default:
          throw new IllegalArgumentException("invalid utf8");
      }

      // TODO: this may read past utf8's limit.
      const limit = utf8Upto + numBytes - 1;
      while (utf8Upto < limit) {
        v = (v << 6) | (bytes[utf8Upto++]! & 63);
      }
      ints[utf32Count++] = v;
    }

    return utf32Count;
  }

  /**
   * Cover JDK 1.5 API. Create a String from an array of codePoints.
   *
   * @param codePoints The code array
   * @param offset The start of the text in the code point array
   * @param count The number of code points
   * @return a String representing the code points between offset and count
   * @throws IllegalArgumentException If an invalid code point is encountered
   * @throws IndexOutOfBoundsException If the offset or count are out of bounds.
   */
  static newString(codePoints: Int32Array | number[], offset: number, count: number): string {
    if (count < 0) {
      throw new IllegalArgumentException();
    }
    const chars = new Uint16Array(count * 2);
    let w = 0;
    for (let r = offset, e = offset + count; r < e; ++r) {
      if (r < 0 || r >= codePoints.length) {
        throw new ArrayIndexOutOfBoundsException(`Index ${r} out of bounds for length ${codePoints.length}`);
      }
      const cp = codePoints[r]!;
      if (cp < 0 || cp > 0x10ffff) {
        throw new IllegalArgumentException();
      }
      if (cp < 0x010000) {
        chars[w] = cp;
        w++;
      } else {
        chars[w] = LEAD_SURROGATE_OFFSET_ + (cp >> LEAD_SURROGATE_SHIFT_);
        chars[w + 1] = TRAIL_SURROGATE_MIN_VALUE + (cp & TRAIL_SURROGATE_MASK_);
        w += 2;
      }
    }
    return charsToString(chars, 0, w);
  }

  /** for debugging */
  static toHexString(s: string): string {
    let sb = "";
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      if (i > 0) {
        sb += " ";
      }
      if (ch < 128) {
        sb += String.fromCharCode(ch);
      } else {
        if (ch >= UNI_SUR_HIGH_START && ch <= UNI_SUR_HIGH_END) {
          sb += "H:";
        } else if (ch >= UNI_SUR_LOW_START && ch <= UNI_SUR_LOW_END) {
          sb += "L:";
        } else if (ch > UNI_SUR_LOW_END) {
          if (ch === 0xffff) {
            sb += "F:";
          } else {
            sb += "E:";
          }
        }

        sb += "0x" + Integer.toHexString(ch);
      }
    }
    return sb;
  }

  /**
   * Interprets the given byte array as UTF-8 and converts to UTF-16. It is the
   * responsibility of the caller to make sure that the destination array is large enough.
   *
   * NOTE: Full characters are read, even if this reads past the length passed (and
   * can result in an ArrayIndexOutOfBoundsException if invalid UTF-8 is passed).
   * Explicit checks for valid UTF-8 are not performed.
   */
  // TODO: broken if chars.offset != 0
  static UTF8toUTF16(utf8: Uint8Array, offset: number, length: number, out: Uint16Array): number;
  /** Utility method for {@link UnicodeUtil.UTF8toUTF16}. */
  static UTF8toUTF16(bytesRef: BytesRef, chars: Uint16Array): number;
  static UTF8toUTF16(
    a: Uint8Array | BytesRef,
    b: number | Uint16Array,
    c?: number,
    d?: Uint16Array,
  ): number {
    if (a instanceof BytesRef) {
      return UnicodeUtil.UTF8toUTF16(a.bytes, a.offset, a.length, b as Uint16Array);
    }
    const utf8 = a;
    let offset = b as number;
    const length = c as number;
    const out = d as Uint16Array;

    // Java throws ArrayIndexOutOfBoundsException when a truncated sequence
    // makes it read past the end of the array; typed arrays would give undefined.
    const byteAt = (i: number): number => {
      if (i >= utf8.length) {
        throw new ArrayIndexOutOfBoundsException(`Index ${i} out of bounds for length ${utf8.length}`);
      }
      return utf8[i]!;
    };

    let out_offset = 0;
    const limit = offset + length;
    while (offset < limit) {
      const b0 = utf8[offset++]!;
      if (b0 < 0xc0) {
        lassert(() => b0 < 0x80);
        out[out_offset++] = b0;
      } else if (b0 < 0xe0) {
        out[out_offset++] = ((b0 & 0x1f) << 6) + (byteAt(offset++) & 0x3f);
      } else if (b0 < 0xf0) {
        out[out_offset++] = ((b0 & 0xf) << 12) + ((byteAt(offset) & 0x3f) << 6) + (byteAt(offset + 1) & 0x3f);
        offset += 2;
      } else {
        lassert(() => b0 < 0xf8, "b = 0x" + Integer.toHexString(b0));
        const ch =
          ((b0 & 0x7) << 18) +
          ((byteAt(offset) & 0x3f) << 12) +
          ((byteAt(offset + 1) & 0x3f) << 6) +
          (byteAt(offset + 2) & 0x3f);
        offset += 3;
        if (ch < UNI_MAX_BMP) {
          out[out_offset++] = ch;
        } else {
          const chHalf = ch - 0x0010000;
          out[out_offset++] = (chHalf >> 10) + 0xd800;
          out[out_offset++] = (chHalf & HALF_MASK) + 0xdc00;
        }
      }
    }
    return out_offset;
  }
}

/**
 * Equivalent of Java's `new String(char[], offset, count)`: builds a string from
 * UTF-16 code units (unpaired surrogates are preserved), in chunks to stay
 * clear of argument-count limits.
 */
export function charsToString(chars: Uint16Array, offset: number, count: number): string {
  const CHUNK = 8192;
  let s = "";
  for (let i = offset, end = offset + count; i < end; i += CHUNK) {
    s += String.fromCharCode(...chars.subarray(i, Math.min(i + CHUNK, end)));
  }
  return s;
}
