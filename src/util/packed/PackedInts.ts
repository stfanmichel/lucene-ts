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

// Port of org.apache.lucene.util.packed.PackedInts (Lucene 5.2.1).
//
// The nested types are in PackedIntsBase.ts (import cycles) and exposed here under the names
//   PackedInts.Format / Reader / ... as values only for Format; as types use PackedIntsFormat,
//   PackedIntsReader, PackedIntsMutable, PackedIntsWriter, PackedIntsDecoder, PackedIntsEncoder,
//   PackedIntsReaderIterator, PackedIntsFormatAndBits, PackedIntsNullReader.
// Deviations: long values are bigints; the factories that take a DataInput/IndexInput are synchronous;
// copy() uses BigInt64Array buffers; float arithmetic is rounded with Math.fround.

import { CodecUtil } from "../../codecs/CodecUtil.js";
import { AssertionError, IllegalArgumentException } from "../../errors.js";
import type { DataInput } from "../../store/DataInput.js";
import type { DataOutput } from "../../store/DataOutput.js";
import type { IndexInput } from "../../store/IndexInput.js";
import { lassert } from "../assertions.js";
import { IOException } from "../../errors.js";
import { IllegalStateException } from "../../errors.js";
import { bulkOperationOf } from "./BulkOperationFactory.js";
import { Direct16 } from "./Direct16.js";
import { Direct32 } from "./Direct32.js";
import { Direct64 } from "./Direct64.js";
import { Direct8 } from "./Direct8.js";
import { DirectPacked64SingleBlockReader } from "./DirectPacked64SingleBlockReader.js";
import { DirectPackedReader } from "./DirectPackedReader.js";
import { Packed16ThreeBlocks } from "./Packed16ThreeBlocks.js";
import { Packed64 } from "./Packed64.js";
import { Packed64SingleBlock } from "./Packed64SingleBlock.js";
import { Packed8ThreeBlocks } from "./Packed8ThreeBlocks.js";
import { PackedReaderIterator } from "./PackedReaderIterator.js";
import { PackedWriter } from "./PackedWriter.js";
import {
  PACKED_INTS_CODEC_NAME,
  PACKED_INTS_VERSION_BYTE_ALIGNED,
  PACKED_INTS_VERSION_CURRENT,
  PACKED_INTS_VERSION_MONOTONIC_WITHOUT_ZIGZAG,
  PACKED_INTS_VERSION_START,
  PackedIntsFormat,
  PackedIntsFormatAndBits,
  PackedIntsMutable,
  PackedIntsNullReader,
  PackedIntsReaderImpl,
  PackedIntsMutableImpl,
  PackedIntsReaderIteratorImpl,
  packedBitsRequired,
  packedMaxValue,
  packedUnsignedBitsRequired,
} from "./PackedIntsBase.js";
import type {
  PackedIntsDecoder,
  PackedIntsEncoder,
  PackedIntsReader,
  PackedIntsReaderIterator,
  PackedIntsWriter,
} from "./PackedIntsBase.js";

export {
  PackedIntsFormat,
  PackedIntsFormatAndBits,
  PackedIntsMutable,
  PackedIntsNullReader,
  PackedIntsReaderImpl,
  PackedIntsMutableImpl,
  PackedIntsReaderIteratorImpl,
};
export type { PackedIntsDecoder, PackedIntsEncoder, PackedIntsReader, PackedIntsReaderIterator, PackedIntsWriter };
export { PackedIntsReader as PackedIntsReaderClass, PackedIntsWriter as PackedIntsWriterClass } from "./PackedIntsBase.js";

/**
 * Simplistic compression for array of unsigned long values. Each value is <code>>= 0</code> and <code><=</code> a
 * specified maximum value. The values are stored as packed ints, with each value consuming a fixed number of bits.
 *
 * @lucene.internal
 */
export class PackedInts {
  private constructor() {}

  /** At most 700% memory overhead, always select a direct implementation. */
  static readonly FASTEST = 7;

  /** At most 50% memory overhead, always select a reasonably fast implementation. */
  static readonly FAST = 0.5;

  /** At most 25% memory overhead. */
  static readonly DEFAULT = 0.25;

  /** No memory overhead at all, but the returned implementation may be slow. */
  static readonly COMPACT = 0;

  /** Default amount of memory to use for bulk operations. */
  static readonly DEFAULT_BUFFER_SIZE = 1024; // 1K

  static readonly CODEC_NAME = PACKED_INTS_CODEC_NAME;
  static readonly VERSION_START = PACKED_INTS_VERSION_START; // PackedInts were long-aligned
  static readonly VERSION_BYTE_ALIGNED = PACKED_INTS_VERSION_BYTE_ALIGNED;
  static readonly VERSION_MONOTONIC_WITHOUT_ZIGZAG = PACKED_INTS_VERSION_MONOTONIC_WITHOUT_ZIGZAG;
  static readonly VERSION_CURRENT = PACKED_INTS_VERSION_CURRENT;

  /** The Java nested enum PackedInts.Format */
  static readonly Format = PackedIntsFormat;

  /** Check the validity of a version number. */
  static checkVersion(version: number): void {
    if (version < PackedInts.VERSION_START) {
      throw new IllegalArgumentException("Version is too old, should be at least " + PackedInts.VERSION_START + " (got " + version + ")");
    } else if (version > PackedInts.VERSION_CURRENT) {
      throw new IllegalArgumentException("Version is too new, should be at most " + PackedInts.VERSION_CURRENT + " (got " + version + ")");
    }
  }

  /**
   * Try to find the {@link PackedIntsFormat} and number of bits per value that would restore from disk the fastest
   * reader whose overhead is less than <code>acceptableOverheadRatio</code>.
   *
   * If you don't know how many values you are going to write, use <code>valueCount = -1</code>.
   */
  static fastestFormatAndBits(valueCount: number, bitsPerValue: number, acceptableOverheadRatio: number): PackedIntsFormatAndBits {
    if (valueCount === -1) {
      valueCount = 2147483647;
    }

    acceptableOverheadRatio = Math.max(PackedInts.COMPACT, acceptableOverheadRatio);
    acceptableOverheadRatio = Math.min(PackedInts.FASTEST, acceptableOverheadRatio);
    const acceptableOverheadPerValue = Math.fround(acceptableOverheadRatio * bitsPerValue); // in bits

    const maxBitsPerValue = bitsPerValue + Math.trunc(acceptableOverheadPerValue);

    let actualBitsPerValue = -1;
    let format = PackedIntsFormat.PACKED;

    if (bitsPerValue <= 8 && maxBitsPerValue >= 8) {
      actualBitsPerValue = 8;
    } else if (bitsPerValue <= 16 && maxBitsPerValue >= 16) {
      actualBitsPerValue = 16;
    } else if (bitsPerValue <= 32 && maxBitsPerValue >= 32) {
      actualBitsPerValue = 32;
    } else if (bitsPerValue <= 64 && maxBitsPerValue >= 64) {
      actualBitsPerValue = 64;
    } else if (valueCount <= Packed8ThreeBlocks.MAX_SIZE && bitsPerValue <= 24 && maxBitsPerValue >= 24) {
      actualBitsPerValue = 24;
    } else if (valueCount <= Packed16ThreeBlocks.MAX_SIZE && bitsPerValue <= 48 && maxBitsPerValue >= 48) {
      actualBitsPerValue = 48;
    } else {
      for (let bpv = bitsPerValue; bpv <= maxBitsPerValue; ++bpv) {
        if (PackedIntsFormat.PACKED_SINGLE_BLOCK.isSupported(bpv)) {
          const overhead = PackedIntsFormat.PACKED_SINGLE_BLOCK.overheadPerValue(bpv);
          const acceptableOverhead = Math.fround(Math.fround(acceptableOverheadPerValue + bitsPerValue) - bpv);
          if (overhead <= acceptableOverhead) {
            actualBitsPerValue = bpv;
            format = PackedIntsFormat.PACKED_SINGLE_BLOCK;
            break;
          }
        }
      }
      if (actualBitsPerValue < 0) {
        actualBitsPerValue = bitsPerValue;
      }
    }

    return new PackedIntsFormatAndBits(format, actualBitsPerValue);
  }

  /**
   * Get a {@link PackedIntsDecoder}.
   *
   * @param format         the format used to store packed ints
   * @param version        the compatibility version
   * @param bitsPerValue   the number of bits per value
   */
  static getDecoder(format: PackedIntsFormat, version: number, bitsPerValue: number): PackedIntsDecoder {
    PackedInts.checkVersion(version);
    return bulkOperationOf(format, bitsPerValue);
  }

  /**
   * Get an {@link PackedIntsEncoder}.
   *
   * @param format         the format used to store packed ints
   * @param version        the compatibility version
   * @param bitsPerValue   the number of bits per value
   */
  static getEncoder(format: PackedIntsFormat, version: number, bitsPerValue: number): PackedIntsEncoder {
    PackedInts.checkVersion(version);
    return bulkOperationOf(format, bitsPerValue);
  }

  /**
   * Expert: Restore a {@link PackedIntsReader} from a stream without reading metadata at the beginning of the
   * stream. This method is useful to restore data from streams which have been created using
   * {@link getWriterNoHeader}.
   *
   * @param input        the stream to read data from, positioned at the beginning of the packed values
   * @param format       the format used to serialize
   * @param version      the version used to serialize the data
   * @param valueCount   how many values the stream holds
   * @param bitsPerValue the number of bits per value
   */
  static getReaderNoHeader(input: DataInput, format: PackedIntsFormat, version: number, valueCount: number, bitsPerValue: number): PackedIntsReader {
    PackedInts.checkVersion(version);
    switch (format) {
      case PackedIntsFormat.PACKED_SINGLE_BLOCK:
        return Packed64SingleBlock.create(input, valueCount, bitsPerValue);
      case PackedIntsFormat.PACKED:
        switch (bitsPerValue) {
          case 8:
            return new Direct8(version, input, valueCount);
          case 16:
            return new Direct16(version, input, valueCount);
          case 32:
            return new Direct32(version, input, valueCount);
          case 64:
            return new Direct64(version, input, valueCount);
          case 24:
            if (valueCount <= Packed8ThreeBlocks.MAX_SIZE) {
              return new Packed8ThreeBlocks(version, input, valueCount);
            }
            break;
          case 48:
            if (valueCount <= Packed16ThreeBlocks.MAX_SIZE) {
              return new Packed16ThreeBlocks(version, input, valueCount);
            }
            break;
        }
        return new Packed64(version, input, valueCount, bitsPerValue);
      default:
        throw new AssertionError("Unknown Writer format: " + format);
    }
  }

  /** Restore a {@link PackedIntsReader} from a stream. */
  static getReader(input: DataInput): PackedIntsReader {
    const version = CodecUtil.checkHeader(input, PackedInts.CODEC_NAME, PackedInts.VERSION_START, PackedInts.VERSION_CURRENT);
    const bitsPerValue = input.readVInt();
    lassert(() => bitsPerValue > 0 && bitsPerValue <= 64, () => "bitsPerValue=" + bitsPerValue);
    const valueCount = input.readVInt();
    const format = PackedIntsFormat.byId(input.readVInt());

    return PackedInts.getReaderNoHeader(input, format, version, valueCount, bitsPerValue);
  }

  /**
   * Expert: Restore a {@link PackedIntsReaderIterator} from a stream without reading metadata at the beginning of
   * the stream.
   *
   * @param mem          how much memory the iterator is allowed to use to read-ahead (likely to speed up iteration)
   */
  static getReaderIteratorNoHeader(
    input: DataInput,
    format: PackedIntsFormat,
    version: number,
    valueCount: number,
    bitsPerValue: number,
    mem: number,
  ): PackedIntsReaderIterator {
    PackedInts.checkVersion(version);
    return new PackedReaderIterator(format, version, valueCount, bitsPerValue, input, mem);
  }

  /**
   * Retrieve PackedInts as a {@link PackedIntsReaderIterator}
   * @param input positioned at the beginning of a stored packed int structure.
   * @param mem how much memory the iterator is allowed to use to read-ahead (likely to speed up iteration)
   */
  static getReaderIterator(input: DataInput, mem: number): PackedIntsReaderIterator {
    const version = CodecUtil.checkHeader(input, PackedInts.CODEC_NAME, PackedInts.VERSION_START, PackedInts.VERSION_CURRENT);
    const bitsPerValue = input.readVInt();
    lassert(() => bitsPerValue > 0 && bitsPerValue <= 64, () => "bitsPerValue=" + bitsPerValue);
    const valueCount = input.readVInt();
    const format = PackedIntsFormat.byId(input.readVInt());
    return PackedInts.getReaderIteratorNoHeader(input, format, version, valueCount, bitsPerValue, mem);
  }

  /**
   * Expert: Construct a direct {@link PackedIntsReader} from a stream without reading metadata at the beginning of
   * the stream. The returned reader will have very little memory overhead, but every call to get(int) is likely
   * to perform a disk seek.
   */
  static getDirectReaderNoHeader(input: IndexInput, format: PackedIntsFormat, version: number, valueCount: number, bitsPerValue: number): PackedIntsReader {
    PackedInts.checkVersion(version);
    switch (format) {
      case PackedIntsFormat.PACKED: {
        const byteCount = format.byteCount(version, valueCount, bitsPerValue);
        if (byteCount !== format.byteCount(PackedInts.VERSION_CURRENT, valueCount, bitsPerValue)) {
          lassert(() => version === PackedInts.VERSION_START);
          const endPointer = input.getFilePointer() + byteCount;
          // Some consumers of direct readers assume that reading the last value
          // will make the underlying IndexInput go to the end of the packed
          // stream, but this is not true because packed ints storage used to be
          // long-aligned and is now byte-aligned, hence this additional
          // condition when reading the last value
          return new (class extends DirectPackedReader {
            override get(index: number): bigint {
              const result = super.get(index);
              if (index === this.valueCount - 1) {
                try {
                  this.in.seek(endPointer);
                } catch (e) {
                  if (e instanceof IOException) {
                    const ise = new IllegalStateException("failed");
                    (ise as { cause?: unknown }).cause = e;
                    throw ise;
                  }
                  throw e;
                }
              }
              return result;
            }
          })(bitsPerValue, valueCount, input);
        } else {
          return new DirectPackedReader(bitsPerValue, valueCount, input);
        }
      }
      case PackedIntsFormat.PACKED_SINGLE_BLOCK:
        return new DirectPacked64SingleBlockReader(bitsPerValue, valueCount, input);
      default:
        throw new AssertionError("Unknwown format: " + format);
    }
  }

  /**
   * Construct a direct {@link PackedIntsReader} from an {@link IndexInput}. This method is useful to restore data
   * from streams which have been created using {@link getWriter}.
   */
  static getDirectReader(input: IndexInput): PackedIntsReader {
    const version = CodecUtil.checkHeader(input, PackedInts.CODEC_NAME, PackedInts.VERSION_START, PackedInts.VERSION_CURRENT);
    const bitsPerValue = input.readVInt();
    lassert(() => bitsPerValue > 0 && bitsPerValue <= 64, () => "bitsPerValue=" + bitsPerValue);
    const valueCount = input.readVInt();
    const format = PackedIntsFormat.byId(input.readVInt());
    return PackedInts.getDirectReaderNoHeader(input, format, version, valueCount, bitsPerValue);
  }

  /**
   * Create a packed integer array with the given amount of values initialized to 0. the valueCount and the
   * bitsPerValue cannot be changed after creation. All Mutables known by this factory are kept fully in RAM.
   * (Java: getMutable(int, int, float) and getMutable(int, int, Format), told apart by the type of the 3rd argument)
   */
  static getMutable(valueCount: number, bitsPerValue: number, acceptableOverheadRatioOrFormat: number | PackedIntsFormat): PackedIntsMutable {
    if (typeof acceptableOverheadRatioOrFormat === "number") {
      const formatAndBits = PackedInts.fastestFormatAndBits(valueCount, bitsPerValue, acceptableOverheadRatioOrFormat);
      return PackedInts.getMutable(valueCount, formatAndBits.bitsPerValue, formatAndBits.format);
    }
    const format = acceptableOverheadRatioOrFormat;
    lassert(() => valueCount >= 0);
    switch (format) {
      case PackedIntsFormat.PACKED_SINGLE_BLOCK:
        return Packed64SingleBlock.create(valueCount, bitsPerValue);
      case PackedIntsFormat.PACKED:
        switch (bitsPerValue) {
          case 8:
            return new Direct8(valueCount);
          case 16:
            return new Direct16(valueCount);
          case 32:
            return new Direct32(valueCount);
          case 64:
            return new Direct64(valueCount);
          case 24:
            if (valueCount <= Packed8ThreeBlocks.MAX_SIZE) {
              return new Packed8ThreeBlocks(valueCount);
            }
            break;
          case 48:
            if (valueCount <= Packed16ThreeBlocks.MAX_SIZE) {
              return new Packed16ThreeBlocks(valueCount);
            }
            break;
        }
        return new Packed64(valueCount, bitsPerValue);
      default:
        throw new AssertionError();
    }
  }

  /**
   * Expert: Create a packed integer array writer for the given output, format, value count, and number of bits per
   * value. This method does not write any metadata to the stream.
   *
   * @param mem          how much memory (in bytes) can be used to speed up serialization
   */
  static getWriterNoHeader(out: DataOutput, format: PackedIntsFormat, valueCount: number, bitsPerValue: number, mem: number): PackedIntsWriter {
    return new PackedWriter(format, out, valueCount, bitsPerValue, mem);
  }

  /**
   * Create a packed integer array writer for the given output, format, value count, and number of bits per value.
   * This method writes metadata to the stream, so that the resulting stream is sufficient to restore a Reader from it.
   */
  static getWriter(out: DataOutput, valueCount: number, bitsPerValue: number, acceptableOverheadRatio: number): PackedIntsWriter {
    lassert(() => valueCount >= 0);

    const formatAndBits = PackedInts.fastestFormatAndBits(valueCount, bitsPerValue, acceptableOverheadRatio);
    const writer = PackedInts.getWriterNoHeader(out, formatAndBits.format, valueCount, formatAndBits.bitsPerValue, PackedInts.DEFAULT_BUFFER_SIZE);
    writer.writeHeader();
    return writer;
  }

  /**
   * Returns how many bits are required to hold values up to and including maxValue. NOTE: This method returns at
   * least 1.
   */
  static bitsRequired(maxValue: bigint): number {
    return packedBitsRequired(maxValue);
  }

  /**
   * Returns how many bits are required to store <code>bits</code>, interpreted as an unsigned value. NOTE: This
   * method returns at least 1.
   */
  static unsignedBitsRequired(bits: bigint): number {
    return packedUnsignedBitsRequired(bits);
  }

  /** Calculates the maximum unsigned long that can be expressed with the given number of bits. */
  static maxValue(bitsPerValue: number): bigint {
    return packedMaxValue(bitsPerValue);
  }

  /** Copy <code>src[srcPos:srcPos+len]</code> into <code>dest[destPos:destPos+len]</code> using at most <code>mem</code> bytes. */
  static copy(src: PackedIntsReader, srcPos: number, dest: PackedIntsMutable, destPos: number, len: number, mem: number): void;
  /** Same as the other copy but using a pre-allocated buffer. */
  static copy(src: PackedIntsReader, srcPos: number, dest: PackedIntsMutable, destPos: number, len: number, buf: BigInt64Array): void;
  static copy(src: PackedIntsReader, srcPos: number, dest: PackedIntsMutable, destPos: number, len: number, memOrBuf: number | BigInt64Array): void {
    if (typeof memOrBuf !== "number") {
      PackedInts.copyWithBuffer(src, srcPos, dest, destPos, len, memOrBuf);
      return;
    }
    lassert(() => srcPos + len <= src.size());
    lassert(() => destPos + len <= dest.size());
    const capacity = memOrBuf >>> 3;
    if (capacity === 0) {
      for (let i = 0; i < len; ++i) {
        dest.set(destPos++, src.get(srcPos++));
      }
    } else if (len > 0) {
      // use bulk operations
      const buf = new BigInt64Array(Math.min(capacity, len));
      PackedInts.copyWithBuffer(src, srcPos, dest, destPos, len, buf);
    }
  }

  private static copyWithBuffer(src: PackedIntsReader, srcPos: number, dest: PackedIntsMutable, destPos: number, len: number, buf: BigInt64Array): void {
    lassert(() => buf.length > 0);
    let remaining = 0;
    while (len > 0) {
      const read = src.getBulk(srcPos, buf, remaining, Math.min(len, buf.length - remaining));
      lassert(() => read > 0);
      srcPos += read;
      len -= read;
      remaining += read;
      const written = dest.setBulk(destPos, buf, 0, remaining);
      lassert(() => written > 0);
      destPos += written;
      if (written < remaining) {
        buf.copyWithin(0, written, remaining);
      }
      remaining -= written;
    }
    while (remaining > 0) {
      const written = dest.setBulk(destPos, buf, 0, remaining);
      destPos += written;
      remaining -= written;
      buf.copyWithin(0, written, written + remaining);
    }
  }

  /** Check that the block size is a power of 2, in the right bounds, and return its log in base 2. @internal */
  static checkBlockSize(blockSize: number, minBlockSize: number, maxBlockSize: number): number {
    if (blockSize < minBlockSize || blockSize > maxBlockSize) {
      throw new IllegalArgumentException("blockSize must be >= " + minBlockSize + " and <= " + maxBlockSize + ", got " + blockSize);
    }
    if ((blockSize & (blockSize - 1)) !== 0) {
      throw new IllegalArgumentException("blockSize must be a power of two, got " + blockSize);
    }
    return 31 - Math.clz32(blockSize & -blockSize); // Integer.numberOfTrailingZeros
  }

  /** Return the number of blocks required to store <code>size</code> values on <code>blockSize</code>. @internal */
  static numBlocks(size: number, blockSize: number): number {
    const numBlocks = (Math.trunc(size / blockSize) | 0) + (size % blockSize === 0 ? 0 : 1);
    if (numBlocks * blockSize < size) {
      throw new IllegalArgumentException("size is too large for this block size");
    }
    return numBlocks;
  }
}

// Mutable.save needs PackedInts.getWriterNoHeader (the Java code reaches it through the enclosing class).
PackedIntsMutable.writerFactory = PackedInts.getWriterNoHeader;
