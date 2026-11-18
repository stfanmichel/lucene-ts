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

// Decoder with the exact error handling of Java's `new String(bytes, off, len, StandardCharsets.UTF_8)`.
//
// JS's TextDecoder (WHATWG) is NOT equivalent on malformed input: for instance the three bytes ED A0 80
// (a UTF-8 encoded surrogate) give one U+FFFD in Java and three in TextDecoder. DataInput.readString must
// behave like Java, so it uses this port of the JDK's String.decodeUTF8_UTF16 (checked against JDK 21 by an
// exhaustive differential test, see test/golden-store.test.ts).

const REPL = 0xfffd;

const notContinuation = (b: number): boolean => (b & 0xc0) !== 0x80;

function isMalformed3(b1: number, b2: number, b3: number): boolean {
  return (b1 === 0xe0 && (b2 & 0xe0) === 0x80) || notContinuation(b2) || notContinuation(b3);
}

function isMalformed3_2(b1: number, b2: number): boolean {
  return (b1 === 0xe0 && (b2 & 0xe0) === 0x80) || notContinuation(b2);
}

function isMalformed4(b2: number, b3: number, b4: number): boolean {
  return notContinuation(b2) || notContinuation(b3) || notContinuation(b4);
}

function isMalformed4_2(b1: number, b2: number): boolean {
  return (b1 === 0xf0 && (b2 < 0x90 || b2 > 0xbf)) || (b1 === 0xf4 && (b2 & 0xf0) !== 0x80) || notContinuation(b2);
}

function isMalformed4_3(b3: number): boolean {
  return notContinuation(b3);
}

/** Number of bytes (1 or 2) a malformed 3-byte sequence starting at `sp` consumes. */
function malformed3(src: Uint8Array, sp: number): number {
  const b1 = src[sp++];
  const b2 = src[sp];
  return (b1 === 0xe0 && (b2 & 0xe0) === 0x80) || notContinuation(b2) ? 1 : 2;
}

/** Number of bytes (1, 2 or 3) a malformed 4-byte sequence starting at `sp` consumes. */
function malformed4(src: Uint8Array, sp: number): number {
  const b1 = src[sp++];
  const b2 = src[sp++];
  if (b1 > 0xf4 || (b1 === 0xf0 && (b2 < 0x90 || b2 > 0xbf)) || (b1 === 0xf4 && (b2 & 0xf0) !== 0x80) || notContinuation(b2)) {
    return 1;
  }
  if (notContinuation(src[sp])) return 2;
  return 3;
}

/**
 * Decodes `len` bytes of `src` from `off` as UTF-8, replacing malformed input by U+FFFD exactly like the JDK.
 */
export function decodeUtf8Java(src: Uint8Array, off: number, len: number): string {
  const sl = off + len;
  let sp = off;
  const out: number[] = [];
  let result = "";
  const flush = (): void => {
    result += String.fromCharCode(...out);
    out.length = 0;
  };
  outer: while (sp < sl) {
    if (out.length >= 8192) flush();
    let b1 = src[sp++];
    if (b1 < 0x80) {
      out.push(b1);
    } else if (b1 >> 5 === 0x06 && (b1 & 0x1e) !== 0) {
      // 2 bytes, 11 bits: 110xxxxx 10xxxxxx (C0 and C1 are overlong)
      if (sp < sl) {
        const b2 = src[sp++];
        if (notContinuation(b2)) {
          out.push(REPL);
          sp--;
        } else {
          // (Java XORs sign-extended bytes with magic constants; the bytes are unsigned here, so mask instead)
          out.push(((b1 & 0x1f) << 6) | (b2 & 0x3f));
        }
        continue;
      }
      out.push(REPL);
      break outer;
    } else if (b1 >> 4 === 0x0e) {
      // 3 bytes, 16 bits: 1110xxxx 10xxxxxx 10xxxxxx
      if (sp + 1 < sl) {
        const b2 = src[sp++];
        const b3 = src[sp++];
        if (isMalformed3(b1, b2, b3)) {
          out.push(REPL);
          sp -= 3;
          sp += malformed3(src, sp);
        } else {
          const c = ((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
          // an encoded surrogate is malformed too, and gives a single U+FFFD
          out.push(c >= 0xd800 && c <= 0xdfff ? REPL : c);
        }
        continue;
      }
      if (sp < sl && isMalformed3_2(b1, src[sp])) {
        out.push(REPL);
        continue;
      }
      out.push(REPL);
      break outer;
    } else if (b1 >> 3 === 0x1e) {
      // 4 bytes, 21 bits: 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx
      if (sp + 2 < sl) {
        const b2 = src[sp++];
        const b3 = src[sp++];
        const b4 = src[sp++];
        const uc = ((b1 & 0x07) << 18) | ((b2 & 0x3f) << 12) | ((b3 & 0x3f) << 6) | (b4 & 0x3f);
        if (isMalformed4(b2, b3, b4) || uc < 0x10000 || uc > 0x10ffff) {
          out.push(REPL);
          sp -= 4;
          sp += malformed4(src, sp);
        } else {
          out.push(0xd800 + ((uc - 0x10000) >> 10), 0xdc00 + ((uc - 0x10000) & 0x3ff));
        }
        continue;
      }
      b1 &= 0xff;
      if (b1 > 0xf4 || (sp < sl && isMalformed4_2(b1, src[sp]))) {
        out.push(REPL);
        continue;
      }
      sp++;
      if (sp < sl && isMalformed4_3(src[sp])) {
        out.push(REPL);
        continue;
      }
      out.push(REPL);
      break outer;
    } else {
      out.push(REPL);
    }
  }
  flush();
  return result;
}
