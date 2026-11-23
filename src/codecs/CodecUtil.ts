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

// Port of org.apache.lucene.codecs.CodecUtil (Lucene 5.2.1).
//
// Deviations: checkFooter(in) and checkFooter(in, priorException) are one method (the second always throws when
// priorException is not null); checksums and the footer's long are bigints; ids are Uint8Array.

import { AssertionError, IllegalArgumentException, IOException } from "../errors.js";
import { addSuppressed } from "../errors.js";
import { CorruptIndexException } from "../index/CorruptIndexException.js";
import { IndexFormatTooNewException } from "../index/IndexFormatTooNewException.js";
import { IndexFormatTooOldException } from "../index/IndexFormatTooOldException.js";
import { BufferedChecksumIndexInput } from "../store/BufferedChecksumIndexInput.js";
import type { ChecksumIndexInput } from "../store/ChecksumIndexInput.js";
import type { DataInput } from "../store/DataInput.js";
import type { DataOutput } from "../store/DataOutput.js";
import type { IndexInput } from "../store/IndexInput.js";
import type { IndexOutput } from "../store/IndexOutput.js";
import { lassert } from "../util/assertions.js";
import { BytesRef } from "../util/BytesRef.js";
import { IOUtils } from "../util/IOUtils.js";
import { decodeUtf8Java } from "../util/JavaUtf8Decoder.js";
import { StringHelper } from "../util/StringHelper.js";

/**
 * Utility class for reading and writing versioned headers.
 *
 * Writing codec headers is useful to ensure that a file is in the format you think it is.
 */
export class CodecUtil {
  private constructor() {} // no instance

  /** Constant to identify the start of a codec header. */
  static readonly CODEC_MAGIC = 0x3fd76c17;
  /** Constant to identify the start of a codec footer. */
  static readonly FOOTER_MAGIC = ~0x3fd76c17;

  /** Writes a codec header, which records both a string to identify the file and a version number. */
  static writeHeader(out: DataOutput, codec: string, version: number): void {
    const bytes = new BytesRef(codec);
    if (bytes.length !== codec.length || bytes.length >= 128) {
      throw new IllegalArgumentException("codec must be simple ASCII, less than 128 characters in length [got " + codec + "]");
    }
    out.writeInt(CodecUtil.CODEC_MAGIC);
    out.writeString(codec);
    out.writeInt(version);
  }

  /** Writes a codec header for an index file, which records both a string to identify the format of the file, a version number, and data to identify the file instance (ID and auxiliary suffix such as generation). */
  static writeIndexHeader(out: DataOutput, codec: string, version: number, id: Uint8Array, suffix: string): void {
    if (id.length !== StringHelper.ID_LENGTH) {
      throw new IllegalArgumentException("Invalid id: " + StringHelper.idToString(id));
    }
    CodecUtil.writeHeader(out, codec, version);
    out.writeBytes(id, 0, id.length);
    const suffixBytes = new BytesRef(suffix);
    if (suffixBytes.length !== suffix.length || suffixBytes.length >= 256) {
      throw new IllegalArgumentException("codec must be simple ASCII, less than 256 characters in length [got " + suffix + "]");
    }
    out.writeByte(suffixBytes.length);
    out.writeBytes(suffixBytes.bytes, suffixBytes.offset, suffixBytes.length);
  }

  /** Computes the length of a codec header. */
  static headerLength(codec: string): number {
    return 9 + codec.length;
  }

  /** Computes the length of an index header. */
  static indexHeaderLength(codec: string, suffix: string): number {
    return CodecUtil.headerLength(codec) + StringHelper.ID_LENGTH + 1 + suffix.length;
  }

  /** Reads and validates a header previously written with {@link writeHeader}. */
  static checkHeader(input: DataInput, codec: string, minVersion: number, maxVersion: number): number {
    // Safety to guard against reading a bogus string:
    const actualHeader = input.readInt();
    if (actualHeader !== CodecUtil.CODEC_MAGIC) {
      throw new CorruptIndexException(
        "codec header mismatch: actual header=" + actualHeader + " vs expected header=" + CodecUtil.CODEC_MAGIC,
        input,
      );
    }
    return CodecUtil.checkHeaderNoMagic(input, codec, minVersion, maxVersion);
  }

  /** Like {@link checkHeader} except this version assumes the first int has already been read. */
  static checkHeaderNoMagic(input: DataInput, codec: string, minVersion: number, maxVersion: number): number {
    const actualCodec = input.readString();
    if (actualCodec !== codec) {
      throw new CorruptIndexException("codec mismatch: actual codec=" + actualCodec + " vs expected codec=" + codec, input);
    }
    const actualVersion = input.readInt();
    if (actualVersion < minVersion) {
      throw new IndexFormatTooOldException(input, actualVersion, minVersion, maxVersion);
    }
    if (actualVersion > maxVersion) {
      throw new IndexFormatTooNewException(input, actualVersion, minVersion, maxVersion);
    }
    return actualVersion;
  }

  /** Reads and validates a header previously written with {@link writeIndexHeader}. */
  static checkIndexHeader(
    input: DataInput,
    codec: string,
    minVersion: number,
    maxVersion: number,
    expectedID: Uint8Array,
    expectedSuffix: string,
  ): number {
    const version = CodecUtil.checkHeader(input, codec, minVersion, maxVersion);
    CodecUtil.checkIndexHeaderID(input, expectedID);
    CodecUtil.checkIndexHeaderSuffix(input, expectedSuffix);
    return version;
  }

  /** Expert: just reads and verifies the object ID of an index header */
  static checkIndexHeaderID(input: DataInput, expectedID: Uint8Array): Uint8Array {
    const id = new Uint8Array(StringHelper.ID_LENGTH);
    input.readBytes(id, 0, id.length);
    if (!CodecUtil.bytesEqual(id, expectedID)) {
      throw new CorruptIndexException(
        "file mismatch, expected id=" + StringHelper.idToString(expectedID) + ", got=" + StringHelper.idToString(id),
        input,
      );
    }
    return id;
  }

  private static bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  /** Expert: just reads and verifies the suffix of an index header */
  static checkIndexHeaderSuffix(input: DataInput, expectedSuffix: string): string {
    const suffixLength = input.readByte() & 0xff;
    const suffixBytes = new Uint8Array(suffixLength);
    input.readBytes(suffixBytes, 0, suffixBytes.length);
    const suffix = decodeUtf8Java(suffixBytes, 0, suffixBytes.length);
    if (suffix !== expectedSuffix) {
      throw new CorruptIndexException("file mismatch, expected suffix=" + expectedSuffix + ", got=" + suffix, input);
    }
    return suffix;
  }

  /** Writes a codec footer, which records both a checksum algorithm ID and a checksum. */
  static writeFooter(out: IndexOutput): void {
    out.writeInt(CodecUtil.FOOTER_MAGIC);
    out.writeInt(0);
    out.writeLong(out.getChecksum());
  }

  /** Computes the length of a codec footer. */
  static footerLength(): number {
    return 16;
  }

  /**
   * Validates the codec footer previously written by {@link writeFooter}; returns the checksum. When
   * priorException is not null/undefined (Java's second overload) the footer is checked only to enrich that
   * exception, which is then rethrown: the method never returns.
   */
  static checkFooter(input: ChecksumIndexInput, priorException?: unknown): bigint {
    if (priorException === undefined || priorException === null) {
      CodecUtil.validateFooter(input);
      const actualChecksum = input.getChecksum();
      const expectedChecksum = input.readLong();
      if (expectedChecksum !== actualChecksum) {
        throw new CorruptIndexException(
          "checksum failed (hardware problem?) : expected=" + BigInt.asUintN(64, expectedChecksum).toString(16) +
            " actual=" + BigInt.asUintN(64, actualChecksum).toString(16),
          input,
        );
      }
      return actualChecksum;
    }
    try {
      const remaining = input.length() - input.getFilePointer();
      if (remaining < CodecUtil.footerLength()) {
        // corruption caused us to read into the checksum footer already: we can't proceed
        addSuppressed(
          priorException,
          new CorruptIndexException(
            "checksum status indeterminate: remaining=" + remaining + ", please run checkindex for more details",
            input,
          ),
        );
      } else {
        // otherwise, skip any unread bytes.
        input.skipBytes(remaining - CodecUtil.footerLength());

        // now check the footer
        try {
          const checksum = CodecUtil.checkFooter(input);
          addSuppressed(
            priorException,
            new CorruptIndexException(
              "checksum passed (" + BigInt.asUintN(64, checksum).toString(16) +
                "). possibly transient resource issue, or a Lucene or JVM bug",
              input,
            ),
          );
        } catch (t) {
          if (t instanceof CorruptIndexException) {
            addSuppressed(priorException, t);
          } else {
            throw t;
          }
        }
      }
    } catch (t) {
      // catch-all for things that shouldn't go wrong (e.g. OOM during readInt) but could...
      addSuppressed(priorException, new CorruptIndexException("checksum status indeterminate: unexpected exception", input, t));
    }
    IOUtils.reThrow(priorException);
    throw new AssertionError("unreachable");
  }

  /** Returns (but does not validate) the checksum previously written by {@link checkFooter}. */
  static retrieveChecksum(input: IndexInput): bigint {
    input.seek(input.length() - CodecUtil.footerLength());
    CodecUtil.validateFooter(input);
    return input.readLong();
  }

  private static validateFooter(input: IndexInput): void {
    const remaining = input.length() - input.getFilePointer();
    const expected = CodecUtil.footerLength();
    if (remaining < expected) {
      throw new CorruptIndexException(
        "misplaced codec footer (file truncated?): remaining=" + remaining + ", expected=" + expected,
        input,
      );
    } else if (remaining > expected) {
      throw new CorruptIndexException(
        "misplaced codec footer (file extended?): remaining=" + remaining + ", expected=" + expected,
        input,
      );
    }

    const magic = input.readInt();
    if (magic !== CodecUtil.FOOTER_MAGIC) {
      throw new CorruptIndexException(
        "codec footer mismatch (file truncated?): actual footer=" + magic + " vs expected footer=" + CodecUtil.FOOTER_MAGIC,
        input,
      );
    }

    const algorithmID = input.readInt();
    if (algorithmID !== 0) {
      throw new CorruptIndexException("codec footer mismatch: unknown algorithmID: " + algorithmID, input);
    }
  }

  /**
   * Checks that the stream is positioned at the end, and throws exception if it is not.
   * @deprecated Use {@link checkFooter} instead, this should only used for files without checksums
   */
  static checkEOF(input: IndexInput): void {
    if (input.getFilePointer() !== input.length()) {
      throw new CorruptIndexException(
        "did not read all bytes from file: read " + input.getFilePointer() + " vs size " + input.length(),
        input,
      );
    }
  }

  /** Clones the provided input, reads all bytes from the file, and calls {@link checkFooter} */
  static checksumEntireFile(input: IndexInput): bigint {
    const clone = input.clone();
    clone.seek(0);
    const inp = new BufferedChecksumIndexInput(clone);
    lassert(() => inp.getFilePointer() === 0);
    inp.seek(inp.length() - CodecUtil.footerLength());
    return CodecUtil.checkFooter(inp);
  }
}
