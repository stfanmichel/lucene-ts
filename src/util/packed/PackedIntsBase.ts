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

// The nested types of org.apache.lucene.util.packed.PackedInts (Lucene 5.2.1): Format, FormatAndBits, Decoder,
// Encoder, Reader, ReaderIterator, ReaderIteratorImpl, Mutable, ReaderImpl, MutableImpl, NullReader, Writer, and
// the version constants.
//
// They live in their own module (PackedInts.ts re-exports them under the names PackedInts.Format etc.) so that the
// concrete classes (Direct8, Packed64, ...) can extend them without an import cycle through PackedInts, which
// instantiates those classes.
//
// Deviations (see PORTING.md):
//  - Java long[] values/blocks are BigInt64Array, int[] are Int32Array, byte[] blocks are Uint8Array; the packed
//    values themselves are bigints.
//  - Overloads: Reader.get(index, arr, off, len) is getBulk, Mutable.set(index, arr, off, len) is setBulk,
//    ReaderIterator.next(count) is nextRef(count). Decoder.decode / Encoder.encode keep their name, the four
//    array-type overloads being told apart by the type of the arrays.
//  - Format is a class with two instances (PACKED, PACKED_SINGLE_BLOCK); Format.isSupported for
//    PACKED_SINGLE_BLOCK uses the same table as Packed64SingleBlock.isSupported.

import { IllegalArgumentException } from "../../errors.js";
import { CodecUtil } from "../../codecs/CodecUtil.js";
import { NumericDocValues } from "../../index/NumericDocValues.js";
import type { DataInput } from "../../store/DataInput.js";
import type { DataOutput } from "../../store/DataOutput.js";
import type { Accountable } from "../Accountable.js";
import { lassert } from "../assertions.js";
import { Long } from "../JavaNumbers.js";
import type { LongsRef } from "../LongsRef.js";
import { RamUsageEstimator } from "../RamUsageEstimator.js";

/** Codec name of the headers written by PackedInts */
export const PACKED_INTS_CODEC_NAME = "PackedInts";
/** PackedInts were long-aligned */
export const PACKED_INTS_VERSION_START = 0;
export const PACKED_INTS_VERSION_BYTE_ALIGNED = 1;
export const PACKED_INTS_VERSION_MONOTONIC_WITHOUT_ZIGZAG = 2;
export const PACKED_INTS_VERSION_CURRENT = PACKED_INTS_VERSION_MONOTONIC_WITHOUT_ZIGZAG;

/** The bits per value supported by the PACKED_SINGLE_BLOCK format (Packed64SingleBlock.SUPPORTED_BITS_PER_VALUE). */
export const SINGLE_BLOCK_SUPPORTED_BITS_PER_VALUE: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16, 21, 32];

/**
 * PackedInts.unsignedBitsRequired: how many bits are required to store <code>bits</code>, interpreted as an unsigned
 * value. NOTE: This method returns at least 1.
 */
export function packedUnsignedBitsRequired(bits: bigint): number {
  return Math.max(1, 64 - Long.numberOfLeadingZeros(bits));
}

/** PackedInts.bitsRequired: how many bits are required to hold values up to and including maxValue (at least 1). */
export function packedBitsRequired(maxValue: bigint): number {
  if (maxValue < 0n) {
    throw new IllegalArgumentException("maxValue must be non-negative (got: " + maxValue + ")");
  }
  return packedUnsignedBitsRequired(maxValue);
}

/** PackedInts.maxValue: the maximum unsigned long that can be expressed with the given number of bits. */
export function packedMaxValue(bitsPerValue: number): bigint {
  return bitsPerValue === 64 ? Long.MAX_VALUE : (1n << BigInt(bitsPerValue)) - 1n;
}

/**
 * A format to write packed ints.
 *
 * @lucene.internal
 */
export class PackedIntsFormat {
  /** Compact format, all bits are written contiguously. */
  static readonly PACKED: PackedIntsFormat = new (class extends PackedIntsFormat {
    override byteCount(packedIntsVersion: number, valueCount: number, bitsPerValue: number): number {
      if (packedIntsVersion < PACKED_INTS_VERSION_BYTE_ALIGNED) {
        return 8 * Math.ceil((valueCount * bitsPerValue) / 64);
      } else {
        return Math.ceil((valueCount * bitsPerValue) / 8);
      }
    }
  })("PACKED", 0);

  /**
   * A format that may insert padding bits to improve encoding and decoding speed. Since this format doesn't
   * support all possible bits per value, you should never use it directly, but rather use
   * {@link PackedInts.fastestFormatAndBits} to find the format that best suits your needs.
   */
  static readonly PACKED_SINGLE_BLOCK: PackedIntsFormat = new (class extends PackedIntsFormat {
    override longCount(packedIntsVersion: number, valueCount: number, bitsPerValue: number): number {
      const valuesPerBlock = Math.floor(64 / bitsPerValue);
      return Math.ceil(valueCount / valuesPerBlock);
    }

    override isSupported(bitsPerValue: number): boolean {
      return SINGLE_BLOCK_SUPPORTED_BITS_PER_VALUE.includes(bitsPerValue);
    }

    override overheadPerValue(bitsPerValue: number): number {
      lassert(() => this.isSupported(bitsPerValue));
      const valuesPerBlock = Math.floor(64 / bitsPerValue);
      const overhead = 64 % bitsPerValue;
      return Math.fround(overhead / valuesPerBlock);
    }
  })("PACKED_SINGLE_BLOCK", 1);

  /** Enum.values() */
  static values(): PackedIntsFormat[] {
    return [PackedIntsFormat.PACKED, PackedIntsFormat.PACKED_SINGLE_BLOCK];
  }

  /** Get a format according to its ID. */
  static byId(id: number): PackedIntsFormat {
    for (const format of PackedIntsFormat.values()) {
      if (format.getId() === id) {
        return format;
      }
    }
    throw new IllegalArgumentException("Unknown format id: " + id);
  }

  private readonly _name: string;
  /** The id of the format */
  readonly id: number;

  private constructor(name: string, id: number) {
    this._name = name;
    this.id = id;
  }

  /** Enum.name() */
  name(): string {
    return this._name;
  }

  toString(): string {
    return this._name;
  }

  /** Returns the ID of the format. */
  getId(): number {
    return this.id;
  }

  /** Computes how many byte blocks are needed to store <code>values</code> values of size <code>bitsPerValue</code>. */
  byteCount(packedIntsVersion: number, valueCount: number, bitsPerValue: number): number {
    lassert(() => bitsPerValue >= 0 && bitsPerValue <= 64, () => String(bitsPerValue));
    // assume long-aligned
    return 8 * this.longCount(packedIntsVersion, valueCount, bitsPerValue);
  }

  /** Computes how many long blocks are needed to store <code>values</code> values of size <code>bitsPerValue</code>. */
  longCount(packedIntsVersion: number, valueCount: number, bitsPerValue: number): number {
    lassert(() => bitsPerValue >= 0 && bitsPerValue <= 64, () => String(bitsPerValue));
    const byteCount = this.byteCount(packedIntsVersion, valueCount, bitsPerValue);
    lassert(() => byteCount < 8 * 2147483647);
    if (byteCount % 8 === 0) {
      return byteCount / 8;
    } else {
      return Math.floor(byteCount / 8) + 1;
    }
  }

  /** Tests whether the provided number of bits per value is supported by the format. */
  isSupported(bitsPerValue: number): boolean {
    return bitsPerValue >= 1 && bitsPerValue <= 64;
  }

  /** Returns the overhead per value, in bits. */
  overheadPerValue(bitsPerValue: number): number {
    lassert(() => this.isSupported(bitsPerValue));
    return 0;
  }

  /** Returns the overhead ratio (<code>overhead per value / bits per value</code>). */
  overheadRatio(bitsPerValue: number): number {
    lassert(() => this.isSupported(bitsPerValue));
    return Math.fround(this.overheadPerValue(bitsPerValue) / bitsPerValue);
  }
}

/** Simple class that holds a format and a number of bits per value. */
export class PackedIntsFormatAndBits {
  readonly format: PackedIntsFormat;
  readonly bitsPerValue: number;
  constructor(format: PackedIntsFormat, bitsPerValue: number) {
    this.format = format;
    this.bitsPerValue = bitsPerValue;
  }

  toString(): string {
    return "FormatAndBits(format=" + this.format + " bitsPerValue=" + this.bitsPerValue + ")";
  }
}

/** A decoder for packed integers. */
export interface PackedIntsDecoder {
  /** The minimum number of long blocks to encode in a single iteration, when using long encoding. */
  longBlockCount(): number;

  /** The number of values that can be stored in {@link longBlockCount} long blocks. */
  longValueCount(): number;

  /** The minimum number of byte blocks to encode in a single iteration, when using byte encoding. */
  byteBlockCount(): number;

  /** The number of values that can be stored in {@link byteBlockCount} byte blocks. */
  byteValueCount(): number;

  /**
   * Read <code>iterations * blockCount()</code> blocks from <code>blocks</code> (long blocks: BigInt64Array; or
   * <code>8 * iterations * blockCount()</code> byte blocks: Uint8Array), decode them and write
   * <code>iterations * valueCount()</code> values into <code>values</code> (long[]: BigInt64Array, int[]: Int32Array).
   *
   * @param blocks       the blocks that hold packed integer values
   * @param blocksOffset the offset where to start reading blocks
   * @param values       the values buffer
   * @param valuesOffset the offset where to start writing values
   * @param iterations   controls how much data to decode
   */
  decode(
    blocks: BigInt64Array | Uint8Array,
    blocksOffset: number,
    values: BigInt64Array | Int32Array,
    valuesOffset: number,
    iterations: number,
  ): void;
}

/** An encoder for packed integers. */
export interface PackedIntsEncoder {
  /** The minimum number of long blocks to encode in a single iteration, when using long encoding. */
  longBlockCount(): number;

  /** The number of values that can be stored in {@link longBlockCount} long blocks. */
  longValueCount(): number;

  /** The minimum number of byte blocks to encode in a single iteration, when using byte encoding. */
  byteBlockCount(): number;

  /** The number of values that can be stored in {@link byteBlockCount} byte blocks. */
  byteValueCount(): number;

  /**
   * Read <code>iterations * valueCount()</code> values from <code>values</code>, encode them and write
   * <code>iterations * blockCount()</code> long blocks (BigInt64Array) or
   * <code>8 * iterations * blockCount()</code> byte blocks (Uint8Array) into <code>blocks</code>.
   *
   * @param values       the values buffer (long[]: BigInt64Array, int[]: Int32Array)
   * @param valuesOffset the offset where to start reading values
   * @param blocks       the blocks that hold packed integer values
   * @param blocksOffset the offset where to start writing blocks
   * @param iterations   controls how much data to encode
   */
  encode(
    values: BigInt64Array | Int32Array,
    valuesOffset: number,
    blocks: BigInt64Array | Uint8Array,
    blocksOffset: number,
    iterations: number,
  ): void;
}

/**
 * A read-only random access array of positive integers.
 * @lucene.internal
 */
export abstract class PackedIntsReader extends NumericDocValues implements Accountable {
  protected constructor() {
    super();
  }

  /**
   * Bulk get: read at least one and at most <code>len</code> longs starting from <code>index</code> into
   * <code>arr[off:off+len]</code> and return the actual number of values that have been read. (Java: get(int, long[], int, int))
   */
  getBulk(index: number, arr: BigInt64Array, off: number, len: number): number {
    lassert(() => len > 0, () => "len must be > 0 (got " + len + ")");
    lassert(() => index >= 0 && index < this.size());
    lassert(() => off + len <= arr.length);

    const gets = Math.min(this.size() - index, len);
    for (let i = index, o = off, end = index + gets; i < end; ++i, ++o) {
      arr[o] = this.get(i);
    }
    return gets;
  }

  /** @return the number of values. */
  abstract size(): number;

  abstract ramBytesUsed(): number;

  getChildResources(): readonly Accountable[] {
    return [];
  }
}

/** Run-once iterator interface, to decode previously saved PackedInts. */
export interface PackedIntsReaderIterator {
  /** Returns next value */
  next(): bigint;
  /**
   * Returns at least 1 and at most <code>count</code> next values, the returned ref MUST NOT be modified.
   * (Java: next(int))
   */
  nextRef(count: number): LongsRef;
  /** Returns number of bits per value */
  getBitsPerValue(): number;
  /** Returns number of values */
  size(): number;
  /** Returns the current position */
  ord(): number;
}

export abstract class PackedIntsReaderIteratorImpl implements PackedIntsReaderIterator {
  protected readonly in: DataInput;
  protected readonly bitsPerValue: number;
  protected readonly valueCount: number;

  protected constructor(valueCount: number, bitsPerValue: number, input: DataInput) {
    this.in = input;
    this.bitsPerValue = bitsPerValue;
    this.valueCount = valueCount;
  }

  abstract nextRef(count: number): LongsRef;
  abstract ord(): number;

  next(): bigint {
    const nextValues = this.nextRef(1);
    lassert(() => nextValues.length > 0);
    const result = nextValues.longs[nextValues.offset]!;
    ++nextValues.offset;
    --nextValues.length;
    return result;
  }

  getBitsPerValue(): number {
    return this.bitsPerValue;
  }

  size(): number {
    return this.valueCount;
  }
}

/**
 * A packed integer array that can be modified.
 * @lucene.internal
 */
export abstract class PackedIntsMutable extends PackedIntsReader {
  protected constructor() {
    super();
  }

  /**
   * @return the number of bits used to store any given value. Note: This does not imply that memory usage is
   *         <code>bitsPerValue * #values</code> as implementations are free to use non-space-optimal packing of bits.
   */
  abstract getBitsPerValue(): number;

  /**
   * Set the value at the given index in the array.
   * @param index where the value should be positioned.
   * @param value a value conforming to the constraints set by the array.
   */
  abstract set(index: number, value: bigint): void;

  /**
   * Bulk set: set at least one and at most <code>len</code> longs starting at <code>off</code> in <code>arr</code>
   * into this mutable, starting at <code>index</code>. Returns the actual number of values that have been set.
   * (Java: set(int, long[], int, int))
   */
  setBulk(index: number, arr: BigInt64Array, off: number, len: number): number {
    lassert(() => len > 0, () => "len must be > 0 (got " + len + ")");
    lassert(() => index >= 0 && index < this.size());
    len = Math.min(len, this.size() - index);
    lassert(() => off + len <= arr.length);

    for (let i = index, o = off, end = index + len; i < end; ++i, ++o) {
      this.set(i, arr[o]!);
    }
    return len;
  }

  /** Fill the mutable from <code>fromIndex</code> (inclusive) to <code>toIndex</code> (exclusive) with <code>val</code>. */
  fill(fromIndex: number, toIndex: number, val: bigint): void {
    lassert(() => val <= packedMaxValue(this.getBitsPerValue()));
    lassert(() => fromIndex <= toIndex);
    for (let i = fromIndex; i < toIndex; ++i) {
      this.set(i, val);
    }
  }

  /** Sets all values to 0. */
  clear(): void {
    this.fill(0, this.size(), 0n);
  }

  /**
   * Save this mutable into <code>out</code>. Instantiating a reader from the generated data will return a reader
   * with the same number of bits per value.
   */
  save(out: DataOutput): void {
    const writer = PackedIntsMutable.writerFactory!(out, this.getFormat(), this.size(), this.getBitsPerValue(), 1024);
    writer.writeHeader();
    for (let i = 0; i < this.size(); ++i) {
      writer.add(this.get(i));
    }
    writer.finish();
  }

  /** @internal set by PackedInts.ts: PackedInts.getWriterNoHeader (breaks the import cycle) */
  static writerFactory:
    | ((out: DataOutput, format: PackedIntsFormat, valueCount: number, bitsPerValue: number, mem: number) => PackedIntsWriter)
    | null = null;

  /** The underlying format. @internal */
  getFormat(): PackedIntsFormat {
    return PackedIntsFormat.PACKED;
  }
}

/**
 * A simple base for Readers that keeps track of valueCount and bitsPerValue.
 * @lucene.internal
 */
export abstract class PackedIntsReaderImpl extends PackedIntsReader {
  protected readonly valueCount: number;

  protected constructor(valueCount: number) {
    super();
    this.valueCount = valueCount;
  }

  abstract override get(index: number): bigint;

  size(): number {
    return this.valueCount;
  }
}

export abstract class PackedIntsMutableImpl extends PackedIntsMutable {
  protected readonly valueCount: number;
  protected readonly bitsPerValue: number;

  protected constructor(valueCount: number, bitsPerValue: number) {
    super();
    this.valueCount = valueCount;
    lassert(() => bitsPerValue > 0 && bitsPerValue <= 64, () => "bitsPerValue=" + bitsPerValue);
    this.bitsPerValue = bitsPerValue;
  }

  getBitsPerValue(): number {
    return this.bitsPerValue;
  }

  size(): number {
    return this.valueCount;
  }

  override toString(): string {
    return this.constructor.name + "(valueCount=" + this.valueCount + ",bitsPerValue=" + this.bitsPerValue + ")";
  }
}

/** A {@link PackedIntsReader} which has all its values equal to 0 (bitsPerValue = 0). */
export class PackedIntsNullReader extends PackedIntsReader {
  private readonly valueCount: number;

  /** Sole constructor. */
  constructor(valueCount: number) {
    super();
    this.valueCount = valueCount;
  }

  get(_index: number): bigint {
    return 0n;
  }

  override getBulk(index: number, arr: BigInt64Array, off: number, len: number): number {
    lassert(() => len > 0, () => "len must be > 0 (got " + len + ")");
    lassert(() => index >= 0 && index < this.valueCount);
    len = Math.min(len, this.valueCount - index);
    arr.fill(0n, off, off + len);
    return len;
  }

  size(): number {
    return this.valueCount;
  }

  ramBytesUsed(): number {
    return RamUsageEstimator.alignObjectSize(RamUsageEstimator.NUM_BYTES_OBJECT_HEADER + RamUsageEstimator.NUM_BYTES_INT);
  }
}

/**
 * A write-once Writer.
 * @lucene.internal
 */
export abstract class PackedIntsWriter {
  protected readonly out: DataOutput;
  protected readonly valueCount: number;
  protected readonly _bitsPerValue: number;

  protected constructor(out: DataOutput, valueCount: number, bitsPerValue: number) {
    lassert(() => bitsPerValue <= 64);
    lassert(() => valueCount >= 0 || valueCount === -1);
    this.out = out;
    this.valueCount = valueCount;
    this._bitsPerValue = bitsPerValue;
  }

  /** @internal (package-private in Java) */
  writeHeader(): void {
    lassert(() => this.valueCount !== -1);
    CodecUtil.writeHeader(this.out, PACKED_INTS_CODEC_NAME, PACKED_INTS_VERSION_CURRENT);
    this.out.writeVInt(this._bitsPerValue);
    this.out.writeVInt(this.valueCount);
    this.out.writeVInt(this.getFormat().getId());
  }

  /** The format used to serialize values. */
  protected abstract getFormat(): PackedIntsFormat;

  /** Add a value to the stream. */
  abstract add(v: bigint): void;

  /** The number of bits per value. */
  bitsPerValue(): number {
    return this._bitsPerValue;
  }

  /** Perform end-of-stream operations. */
  abstract finish(): void;

  /** Returns the current ord in the stream (number of values that have been written so far minus one). */
  abstract ord(): number;
}

