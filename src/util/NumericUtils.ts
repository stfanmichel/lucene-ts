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

// Port of org.apache.lucene.util.NumericUtils (Lucene 5.2.1).
//
// Deviations: long -> bigint, int/float -> number; Java bytes are signed, the Uint8Array holds them unsigned (the
// signed value is rebuilt where Java compares or subtracts them); the overloaded addRange of the two range builders
// is split: addRange(min, max, shift) keeps its name, the BytesRef variant is addRangeBytes(min, max).
// The Terms based methods (filterPrefixCodedLongs/Ints, getMinInt/MaxInt/MinLong/MaxLong, which need the index
// package) are ported with the index layer.

import { ArrayIndexOutOfBoundsException, IllegalArgumentException, NumberFormatException, UnsupportedOperationException } from "../errors.js";
import type { BytesRef } from "./BytesRef.js";
import { BytesRefBuilder } from "./BytesRefBuilder.js";
import { Double, Float, Integer, Long } from "./JavaNumbers.js";

/** Java's signed byte at index i of a (unsigned) Uint8Array, with the JDK's bounds exception. */
function signedByteAt(bytes: Uint8Array, i: number): number {
  if (i < 0 || i >= bytes.length) {
    throw new ArrayIndexOutOfBoundsException("Index " + i + " out of bounds for length " + bytes.length);
  }
  return (bytes[i]! << 24) >> 24;
}

/** Java's long shift: the count is taken modulo 64, the result wraps. */
function shl64(x: bigint, n: number): bigint {
  return BigInt.asIntN(64, x << BigInt(n & 63));
}

/**
 * Callback for {@link NumericUtils#splitLongRange}.
 * You need to overwrite only one of the methods.
 */
export abstract class LongRangeBuilder {
  /**
   * Overwrite this method, if you like to receive the already prefix encoded range bounds.
   * You can directly build classical (inclusive) range queries from them.
   */
  addRangeBytes(_minPrefixCoded: BytesRef, _maxPrefixCoded: BytesRef): void {
    throw new UnsupportedOperationException();
  }

  /**
   * Overwrite this method, if you like to receive the raw long range bounds.
   * You can use this for e.g. debugging purposes (print out range bounds).
   */
  addRange(min: bigint, max: bigint, shift: number): void {
    const minBytes = new BytesRefBuilder();
    const maxBytes = new BytesRefBuilder();
    NumericUtils.longToPrefixCodedBytes(min, shift, minBytes);
    NumericUtils.longToPrefixCodedBytes(max, shift, maxBytes);
    this.addRangeBytes(minBytes.get(), maxBytes.get());
  }
}

/**
 * Callback for {@link NumericUtils#splitIntRange}.
 * You need to overwrite only one of the methods.
 */
export abstract class IntRangeBuilder {
  /**
   * Overwrite this method, if you like to receive the already prefix encoded range bounds.
   * You can directly build classical range (inclusive) queries from them.
   */
  addRangeBytes(_minPrefixCoded: BytesRef, _maxPrefixCoded: BytesRef): void {
    throw new UnsupportedOperationException();
  }

  /**
   * Overwrite this method, if you like to receive the raw int range bounds.
   * You can use this for e.g. debugging purposes (print out range bounds).
   */
  addRange(min: number, max: number, shift: number): void {
    const minBytes = new BytesRefBuilder();
    const maxBytes = new BytesRefBuilder();
    NumericUtils.intToPrefixCodedBytes(min, shift, minBytes);
    NumericUtils.intToPrefixCodedBytes(max, shift, maxBytes);
    this.addRangeBytes(minBytes.get(), maxBytes.get());
  }
}

/**
 * This is a helper class to generate prefix-encoded representations for numerical values
 * and supplies converters to represent float/double values as sortable integers/longs.
 */
export class NumericUtils {
  /** The default precision step used by LongField, DoubleField, NumericTokenStream, NumericRangeQuery. */
  static readonly PRECISION_STEP_DEFAULT = 16;

  /** The default precision step used by IntField and FloatField. */
  static readonly PRECISION_STEP_DEFAULT_32 = 8;

  /**
   * Longs are stored at lower precision by shifting off lower bits. The shift count is
   * stored as <code>SHIFT_START_LONG+shift</code> in the first byte
   */
  static readonly SHIFT_START_LONG = 0x20;

  /** The maximum term length (used for <code>byte[]</code> buffer size) for encoding <code>long</code> values. */
  static readonly BUF_SIZE_LONG = Math.trunc(63 / 7) + 2;

  /**
   * Integers are stored at lower precision by shifting off lower bits. The shift count is
   * stored as <code>SHIFT_START_INT+shift</code> in the first byte
   */
  static readonly SHIFT_START_INT = 0x60;

  /** The maximum term length (used for <code>byte[]</code> buffer size) for encoding <code>int</code> values. */
  static readonly BUF_SIZE_INT = Math.trunc(31 / 7) + 2;

  /** Returns prefix coded bits after reducing the precision by <code>shift</code> bits. After encoding, {@code bytes.offset} will always be 0. */
  static longToPrefixCoded(val: bigint, shift: number, bytes: BytesRefBuilder): void {
    NumericUtils.longToPrefixCodedBytes(val, shift, bytes);
  }

  /** Returns prefix coded bits after reducing the precision by <code>shift</code> bits. After encoding, {@code bytes.offset} will always be 0. */
  static intToPrefixCoded(val: number, shift: number, bytes: BytesRefBuilder): void {
    NumericUtils.intToPrefixCodedBytes(val, shift, bytes);
  }

  /** Returns prefix coded bits after reducing the precision by <code>shift</code> bits. After encoding, {@code bytes.offset} will always be 0. */
  static longToPrefixCodedBytes(val: bigint, shift: number, bytes: BytesRefBuilder): void {
    // ensure shift is 0..63
    if ((shift & ~0x3f) !== 0) {
      throw new IllegalArgumentException("Illegal shift value, must be 0..63; got shift=" + shift);
    }
    let nChars = (((63 - shift) * 37) >> 8) + 1; // i/7 is the same as (i*37)>>8 for i in 0..63
    bytes.setLength(nChars + 1); // one extra for the byte that contains the shift info
    bytes.grow(NumericUtils.BUF_SIZE_LONG);
    bytes.setByteAt(0, NumericUtils.SHIFT_START_LONG + shift);
    let sortableBits = BigInt.asIntN(64, val ^ Long.MIN_VALUE);
    sortableBits = Long.ushr(sortableBits, shift);
    while (nChars > 0) {
      // Store 7 bits per byte for compatibility
      // with UTF-8 encoding of terms
      bytes.setByteAt(nChars--, Number(sortableBits & 0x7fn));
      sortableBits = Long.ushr(sortableBits, 7);
    }
  }

  /** Returns prefix coded bits after reducing the precision by <code>shift</code> bits. After encoding, {@code bytes.offset} will always be 0. */
  static intToPrefixCodedBytes(val: number, shift: number, bytes: BytesRefBuilder): void {
    // ensure shift is 0..31
    if ((shift & ~0x1f) !== 0) {
      throw new IllegalArgumentException("Illegal shift value, must be 0..31; got shift=" + shift);
    }
    let nChars = (((31 - shift) * 37) >> 8) + 1; // i/7 is the same as (i*37)>>8 for i in 0..63
    bytes.setLength(nChars + 1); // one extra for the byte that contains the shift info
    bytes.grow(NumericUtils.BUF_SIZE_LONG); // use the max
    bytes.setByteAt(0, NumericUtils.SHIFT_START_INT + shift);
    let sortableBits = val ^ 0x80000000;
    sortableBits >>>= shift;
    while (nChars > 0) {
      // Store 7 bits per byte for compatibility
      // with UTF-8 encoding of terms
      bytes.setByteAt(nChars--, sortableBits & 0x7f);
      sortableBits >>>= 7;
    }
  }

  /**
   * Returns the shift value from a prefix encoded {@code long}.
   * @throws NumberFormatException if the supplied {@link BytesRef} is not correctly prefix encoded.
   */
  static getPrefixCodedLongShift(val: BytesRef): number {
    const shift = signedByteAt(val.bytes, val.offset) - NumericUtils.SHIFT_START_LONG;
    if (shift > 63 || shift < 0) {
      throw new NumberFormatException("Invalid shift value (" + shift + ") in prefixCoded bytes (is encoded value really an INT?)");
    }
    return shift;
  }

  /**
   * Returns the shift value from a prefix encoded {@code int}.
   * @throws NumberFormatException if the supplied {@link BytesRef} is not correctly prefix encoded.
   */
  static getPrefixCodedIntShift(val: BytesRef): number {
    const shift = signedByteAt(val.bytes, val.offset) - NumericUtils.SHIFT_START_INT;
    if (shift > 31 || shift < 0) {
      throw new NumberFormatException("Invalid shift value in prefixCoded bytes (is encoded value really an INT?)");
    }
    return shift;
  }

  /**
   * Returns a long from prefixCoded bytes.
   * Rightmost bits will be zero for lower precision codes.
   * This method can be used to decode a term's value.
   * @throws NumberFormatException if the supplied {@link BytesRef} is not correctly prefix encoded.
   */
  static prefixCodedToLong(val: BytesRef): bigint {
    let sortableBits = 0n;
    for (let i = val.offset + 1, limit = val.offset + val.length; i < limit; i++) {
      sortableBits = BigInt.asIntN(64, sortableBits << 7n);
      const b = signedByteAt(val.bytes, i);
      if (b < 0) {
        throw new NumberFormatException(
          "Invalid prefixCoded numerical value representation (byte " +
            Integer.toHexString(b & 0xff) +
            " at position " +
            (i - val.offset) +
            " is invalid)"
        );
      }
      sortableBits |= BigInt(b);
    }
    return BigInt.asIntN(64, shl64(sortableBits, NumericUtils.getPrefixCodedLongShift(val)) ^ Long.MIN_VALUE);
  }

  /**
   * Returns an int from prefixCoded bytes.
   * Rightmost bits will be zero for lower precision codes.
   * This method can be used to decode a term's value.
   * @throws NumberFormatException if the supplied {@link BytesRef} is not correctly prefix encoded.
   */
  static prefixCodedToInt(val: BytesRef): number {
    let sortableBits = 0;
    for (let i = val.offset + 1, limit = val.offset + val.length; i < limit; i++) {
      sortableBits <<= 7;
      const b = signedByteAt(val.bytes, i);
      if (b < 0) {
        throw new NumberFormatException(
          "Invalid prefixCoded numerical value representation (byte " +
            Integer.toHexString(b & 0xff) +
            " at position " +
            (i - val.offset) +
            " is invalid)"
        );
      }
      sortableBits |= b;
    }
    return (sortableBits << NumericUtils.getPrefixCodedIntShift(val)) ^ 0x80000000;
  }

  /**
   * Converts a <code>double</code> value to a sortable signed <code>long</code>.
   * The sort order (including NaN) is defined by Double.compareTo; NaN is greater than positive infinity.
   */
  static doubleToSortableLong(val: number): bigint {
    return NumericUtils.sortableDoubleBits(Double.doubleToLongBits(val));
  }

  /** Converts a sortable <code>long</code> back to a <code>double</code>. */
  static sortableLongToDouble(val: bigint): number {
    return Double.longBitsToDouble(NumericUtils.sortableDoubleBits(val));
  }

  /**
   * Converts a <code>float</code> value to a sortable signed <code>int</code>.
   * The sort order (including NaN) is defined by Float.compareTo; NaN is greater than positive infinity.
   */
  static floatToSortableInt(val: number): number {
    return NumericUtils.sortableFloatBits(Float.floatToIntBits(val));
  }

  /** Converts a sortable <code>int</code> back to a <code>float</code>. */
  static sortableIntToFloat(val: number): number {
    return Float.intBitsToFloat(NumericUtils.sortableFloatBits(val));
  }

  /** Converts IEEE 754 representation of a double to sortable order (or back to the original) */
  static sortableDoubleBits(bits: bigint): bigint {
    return BigInt.asIntN(64, bits ^ ((bits >> 63n) & 0x7fffffffffffffffn));
  }

  /** Converts IEEE 754 representation of a float to sortable order (or back to the original) */
  static sortableFloatBits(bits: number): number {
    return bits ^ ((bits >> 31) & 0x7fffffff);
  }

  /**
   * Splits a long range recursively.
   * You may implement a builder that adds clauses to a BooleanQuery for each call to its addRangeBytes method.
   * <p>This method is used by NumericRangeQuery.
   */
  static splitLongRange(builder: LongRangeBuilder, precisionStep: number, minBound: bigint, maxBound: bigint): void {
    NumericUtils.splitRange(builder, 64, precisionStep, minBound, maxBound);
  }

  /**
   * Splits an int range recursively.
   * <p>This method is used by NumericRangeQuery.
   */
  static splitIntRange(builder: IntRangeBuilder, precisionStep: number, minBound: number, maxBound: number): void {
    NumericUtils.splitRange(builder, 32, precisionStep, BigInt(minBound), BigInt(maxBound));
  }

  /** This helper does the splitting for both 32 and 64 bit. */
  private static splitRange(
    builder: LongRangeBuilder | IntRangeBuilder,
    valSize: number,
    precisionStep: number,
    minBound: bigint,
    maxBound: bigint
  ): void {
    if (precisionStep < 1) throw new IllegalArgumentException("precisionStep must be >=1");
    if (minBound > maxBound) return;
    for (let shift = 0; ; shift = (shift + precisionStep) | 0) {
      // calculate new bounds for inner precision
      const diff = shl64(1n, (shift + precisionStep) | 0);
      const mask = shl64(BigInt.asIntN(64, shl64(1n, precisionStep) - 1n), shift);
      const hasLower = (minBound & mask) !== 0n;
      const hasUpper = (maxBound & mask) !== mask;
      const nextMinBound = BigInt.asIntN(64, hasLower ? minBound + diff : minBound) & ~mask;
      const nextMaxBound = BigInt.asIntN(64, hasUpper ? maxBound - diff : maxBound) & ~mask;
      const lowerWrapped = nextMinBound < minBound;
      const upperWrapped = nextMaxBound > maxBound;

      if (((shift + precisionStep) | 0) >= valSize || nextMinBound > nextMaxBound || lowerWrapped || upperWrapped) {
        // We are in the lowest precision or the next precision is not available.
        NumericUtils.addRange(builder, valSize, minBound, maxBound, shift);
        // exit the split recursion loop
        break;
      }

      if (hasLower) NumericUtils.addRange(builder, valSize, minBound, minBound | mask, shift);
      if (hasUpper) NumericUtils.addRange(builder, valSize, maxBound & ~mask, maxBound, shift);

      // recurse to next precision
      minBound = nextMinBound;
      maxBound = nextMaxBound;
    }
  }

  /** Helper that delegates to correct range builder */
  private static addRange(
    builder: LongRangeBuilder | IntRangeBuilder,
    valSize: number,
    minBound: bigint,
    maxBound: bigint,
    shift: number
  ): void {
    // for the max bound set all lower bits (that were shifted away):
    // this is important for testing or other usages of the splitted range
    // (e.g. to reconstruct the full range). The prefixEncoding will remove
    // the bits anyway, so they do not hurt!
    maxBound = BigInt.asIntN(64, maxBound | BigInt.asIntN(64, shl64(1n, shift) - 1n));
    // delegate to correct range builder
    switch (valSize) {
      case 64:
        (builder as LongRangeBuilder).addRange(minBound, maxBound, shift);
        break;
      case 32:
        (builder as IntRangeBuilder).addRange(Number(BigInt.asIntN(32, minBound)), Number(BigInt.asIntN(32, maxBound)), shift);
        break;
      default:
        // Should not happen!
        throw new IllegalArgumentException("valSize must be 32 or 64.");
    }
  }
}
