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

// Port of org.apache.lucene.store.ByteBufferIndexInput (Lucene 5.2.1), with its nested classes DefaultImpl,
// SingleBufferImpl, WithOffsetImpl (exported under those names) and BufferCleaner.
//
// Conventions: readByte/readShort/readInt/readLong exist twice in Java (relative, and absolute from
// RandomAccessInput); here one overloaded method dispatches the absolute form to readByteAt/readShortAt/
// readIntAt/readLongAt, which the subclasses override. A Java NullPointerException on the nulled-out
// buffers (closed input) becomes an explicit null test throwing AlreadyClosedException, in the same places.
// `long` arithmetic on positions uses `number` (exact below 2^53): `pos >> chunkSizePower` is
// Math.floor(pos / 2^chunkSizePower) and `pos & chunkSizeMask` is the non-negative remainder.
//
// Faithful to 5.2.1: SingleBufferImpl's absolute reads only catch IllegalArgumentException, so an out-of-range
// absolute read there throws the buffer's own IndexOutOfBoundsException, as in Java.

import {
  ArrayIndexOutOfBoundsException,
  AssertionError,
  BufferUnderflowException,
  EOFException,
  IllegalArgumentException,
  IndexOutOfBoundsException,
  IOException,
} from "../errors.js";
import type { ByteBuffer } from "../nio/ByteBuffer.js";
import { lassert } from "../util/assertions.js";
import { WeakIdentityMap } from "../util/WeakIdentityMap.js";
import { AlreadyClosedException } from "./AlreadyClosedException.js";
import { IndexInput } from "./IndexInput.js";
import { RANDOM_ACCESS_INPUT, type RandomAccessInput } from "./RandomAccessInput.js";

/** Cleans (unmaps) a buffer; null cleaner means nothing to do. */
export interface BufferCleaner {
  freeBuffer(parent: ByteBufferIndexInput, b: ByteBuffer): void;
}

type Clones = WeakIdentityMap<ByteBufferIndexInput, boolean>;

/**
 * Base IndexInput implementation that uses an array of ByteBuffers to represent a file.
 * <p>
 * Because Java's ByteBuffer uses an int to address the values, it's necessary to access a file
 * greater Integer.MAX_VALUE in size using multiple byte buffers.
 * <p>
 * For efficiency, this class requires that the buffers are a power-of-two (<code>chunkSizePower</code>).
 */
export abstract class ByteBufferIndexInput extends IndexInput implements RandomAccessInput {
  protected readonly cleaner: BufferCleaner | null;
  protected readonly _length: number;
  protected readonly chunkSizeMask: number;
  protected readonly chunkSizePower: number;
  private readonly chunkSize: number;

  protected buffers: ByteBuffer[] | null;

  protected curBufIndex = -1;
  protected curBuf: ByteBuffer | null = null; // redundant for speed: buffers[curBufIndex]

  protected isClone = false;

  protected readonly clones: Clones | null;

  get [RANDOM_ACCESS_INPUT](): true {
    return true;
  }

  static newInstance(
    resourceDescription: string,
    buffers: ByteBuffer[],
    length: number,
    chunkSizePower: number,
    cleaner: BufferCleaner | null,
    trackClones: boolean,
  ): ByteBufferIndexInput {
    const clones: Clones | null = trackClones ? WeakIdentityMap.newConcurrentHashMap<ByteBufferIndexInput, boolean>() : null;
    if (buffers.length === 1) {
      return new SingleBufferImpl(resourceDescription, buffers[0]!, length, chunkSizePower, cleaner, clones);
    } else {
      return new DefaultImpl(resourceDescription, buffers, length, chunkSizePower, cleaner, clones);
    }
  }

  constructor(
    resourceDescription: string,
    buffers: ByteBuffer[],
    length: number,
    chunkSizePower: number,
    cleaner: BufferCleaner | null,
    clones: Clones | null,
  ) {
    super(resourceDescription);
    this.buffers = buffers;
    this._length = length;
    this.chunkSizePower = chunkSizePower;
    this.chunkSize = 2 ** chunkSizePower;
    this.chunkSizeMask = this.chunkSize - 1;
    this.clones = clones;
    this.cleaner = cleaner;
    lassert(() => chunkSizePower >= 0 && chunkSizePower <= 30);
    lassert(() => Math.floor(length / this.chunkSize) < 2147483647);
  }

  // pos >> chunkSizePower, as an int
  private bufIndex(pos: number): number {
    return Math.floor(pos / this.chunkSize) | 0;
  }

  // (int) (pos & chunkSizeMask)
  private bufOffset(pos: number): number {
    const m = pos % this.chunkSize;
    return m < 0 ? m + this.chunkSize : m;
  }

  private closedError(): AlreadyClosedException {
    return new AlreadyClosedException("Already closed: " + this.toString());
  }

  /** curBuf, or the NullPointerException → AlreadyClosedException of a closed input */
  protected cur(): ByteBuffer {
    if (this.curBuf === null) throw this.closedError();
    return this.curBuf;
  }

  /** buffers[bi]: AlreadyClosedException if closed, ArrayIndexOutOfBoundsException if out of range */
  private bufferAt(bi: number): ByteBuffer {
    if (this.buffers === null) throw this.closedError();
    const b = this.buffers[bi];
    if (b === undefined) throw new ArrayIndexOutOfBoundsException("Index " + bi + " out of bounds for length " + this.buffers.length);
    return b;
  }

  /** the relative form of readByte(), or the absolute readByte(pos) of RandomAccessInput */
  override readByte(): number;
  readByte(pos: number): number;
  override readByte(pos?: number): number {
    if (pos !== undefined) return this.readByteAt(pos);
    const cb = this.cur();
    try {
      return cb.get();
    } catch (e) {
      if (!(e instanceof BufferUnderflowException)) throw e;
      do {
        this.curBufIndex++;
        if (this.curBufIndex >= this.buffers!.length) {
          throw new EOFException("read past EOF: " + this.toString());
        }
        this.curBuf = this.buffers![this.curBufIndex]!;
        this.curBuf.position(0);
      } while (!this.curBuf.hasRemaining());
      return this.curBuf.get();
    }
  }

  override readBytes(b: Uint8Array, offset: number, len: number): void {
    const cb = this.cur();
    try {
      cb.get(b, offset, len);
    } catch (e) {
      if (!(e instanceof BufferUnderflowException)) throw e;
      let curAvail = cb.remaining();
      while (len > curAvail) {
        this.curBuf!.get(b, offset, curAvail);
        len -= curAvail;
        offset += curAvail;
        this.curBufIndex++;
        if (this.curBufIndex >= this.buffers!.length) {
          throw new EOFException("read past EOF: " + this.toString());
        }
        this.curBuf = this.buffers![this.curBufIndex]!;
        this.curBuf.position(0);
        curAvail = this.curBuf.remaining();
      }
      this.curBuf!.get(b, offset, len);
    }
  }

  override readShort(): number;
  override readShort(pos: number): number;
  override readShort(pos?: number): number {
    if (pos !== undefined) return this.readShortAt(pos);
    const cb = this.cur();
    try {
      return cb.getShort();
    } catch (e) {
      if (!(e instanceof BufferUnderflowException)) throw e;
      return super.readShort();
    }
  }

  override readInt(): number;
  override readInt(pos: number): number;
  override readInt(pos?: number): number {
    if (pos !== undefined) return this.readIntAt(pos);
    const cb = this.cur();
    try {
      return cb.getInt();
    } catch (e) {
      if (!(e instanceof BufferUnderflowException)) throw e;
      return super.readInt();
    }
  }

  override readLong(): bigint;
  override readLong(pos: number): bigint;
  override readLong(pos?: number): bigint {
    if (pos !== undefined) return this.readLongAt(pos);
    const cb = this.cur();
    try {
      return cb.getLong();
    } catch (e) {
      if (!(e instanceof BufferUnderflowException)) throw e;
      return super.readLong();
    }
  }

  override getFilePointer(): number {
    return this.curBufIndex * this.chunkSize + this.cur().position();
  }

  override seek(pos: number): void {
    // we use >> here to preserve negative, so we will catch AIOOBE,
    // in case pos + offset overflows.
    const bi = this.bufIndex(pos);
    try {
      if (bi === this.curBufIndex) {
        this.cur().position(this.bufOffset(pos));
      } else {
        const b = this.bufferAt(bi);
        b.position(this.bufOffset(pos));
        this.curBufIndex = bi;
        this.curBuf = b;
      }
    } catch (e) {
      if (e instanceof ArrayIndexOutOfBoundsException || e instanceof IllegalArgumentException) {
        throw new EOFException("seek past EOF: " + this.toString());
      }
      throw e;
    }
  }

  /** absolute readByte(pos) */
  readByteAt(pos: number): number {
    try {
      const bi = this.bufIndex(pos);
      return this.bufferAt(bi).get(this.bufOffset(pos));
    } catch (e) {
      if (e instanceof IndexOutOfBoundsException) {
        throw new EOFException("seek past EOF: " + this.toString());
      }
      throw e;
    }
  }

  // used only by random access methods to handle reads across boundaries
  private setPos(pos: number, bi: number): void {
    try {
      const b = this.bufferAt(bi);
      b.position(this.bufOffset(pos));
      this.curBufIndex = bi;
      this.curBuf = b;
    } catch (e) {
      if (e instanceof ArrayIndexOutOfBoundsException || e instanceof IllegalArgumentException) {
        throw new EOFException("seek past EOF: " + this.toString());
      }
      throw e;
    }
  }

  /** absolute readShort(pos) */
  readShortAt(pos: number): number {
    const bi = this.bufIndex(pos);
    try {
      return this.bufferAt(bi).getShort(this.bufOffset(pos));
    } catch (e) {
      if (!(e instanceof IndexOutOfBoundsException)) throw e;
      // either it's a boundary, or read past EOF, fall back:
      this.setPos(pos, bi);
      return this.readShort();
    }
  }

  /** absolute readInt(pos) */
  readIntAt(pos: number): number {
    const bi = this.bufIndex(pos);
    try {
      return this.bufferAt(bi).getInt(this.bufOffset(pos));
    } catch (e) {
      if (!(e instanceof IndexOutOfBoundsException)) throw e;
      // either it's a boundary, or read past EOF, fall back:
      this.setPos(pos, bi);
      return this.readInt();
    }
  }

  /** absolute readLong(pos) */
  readLongAt(pos: number): bigint {
    const bi = this.bufIndex(pos);
    try {
      return this.bufferAt(bi).getLong(this.bufOffset(pos));
    } catch (e) {
      if (!(e instanceof IndexOutOfBoundsException)) throw e;
      // either it's a boundary, or read past EOF, fall back:
      this.setPos(pos, bi);
      return this.readLong();
    }
  }

  // Java: final
  override length(): number {
    return this._length;
  }

  // Java: final
  override clone(): this {
    const clone = this.buildSlice(null, 0, this._length) as this;
    try {
      clone.seek(this.getFilePointer());
    } catch (ioe) {
      if (ioe instanceof IOException) throw new AssertionError(String(ioe));
      throw ioe;
    }
    return clone;
  }

  /**
   * Creates a slice of this index input, with the given description, offset, and length. The slice is seeked to the beginning.
   */
  // Java: final
  override slice(sliceDescription: string | null, offset: number, length: number): ByteBufferIndexInput {
    if (offset < 0 || length < 0 || offset + length > this._length) {
      throw new IllegalArgumentException(
        "slice() " + sliceDescription + " out of bounds: offset=" + offset + ",length=" + length + ",fileLength=" + this._length + ": " + this.toString());
    }
    return this.buildSlice(sliceDescription, offset, length);
  }

  /** Builds the actual sliced IndexInput (may apply extra offset in subclasses). */
  protected buildSlice(sliceDescription: string | null, offset: number, length: number): ByteBufferIndexInput {
    if (this.buffers === null) {
      throw new AlreadyClosedException("Already closed: " + this.toString());
    }

    const newBuffers = this.buildSliceBuffers(this.buffers, offset, length);
    const ofs = this.bufOffset(offset);

    const clone = this.newCloneInstance(this.getFullSliceDescription(sliceDescription), newBuffers, ofs, length);
    clone.isClone = true;

    if (this.clones !== null) {
      this.clones.put(clone, true);
    }

    return clone;
  }

  /** Factory method that creates a suitable implementation of this class for the given ByteBuffers. */
  protected newCloneInstance(newResourceDescription: string, newBuffers: ByteBuffer[], offset: number, length: number): ByteBufferIndexInput {
    if (newBuffers.length === 1) {
      newBuffers[0]!.position(offset);
      return new SingleBufferImpl(newResourceDescription, newBuffers[0]!.slice(), length, this.chunkSizePower, this.cleaner, this.clones);
    } else {
      return offset === 0
        ? new DefaultImpl(newResourceDescription, newBuffers, length, this.chunkSizePower, this.cleaner, this.clones)
        : new WithOffsetImpl(newResourceDescription, newBuffers, offset, length, this.chunkSizePower, this.cleaner, this.clones);
    }
  }

  private buildSliceBuffers(buffers: ByteBuffer[], offset: number, length: number): ByteBuffer[] {
    const sliceEnd = offset + length;

    const startIndex = Math.floor(offset / this.chunkSize) | 0;
    const endIndex = Math.floor(sliceEnd / this.chunkSize) | 0;

    // we always allocate one more slice, the last one may be a 0 byte one
    const slices: ByteBuffer[] = new Array(endIndex - startIndex + 1);

    for (let i = 0; i < slices.length; i++) {
      const b = buffers[startIndex + i];
      if (b === undefined) {
        throw new ArrayIndexOutOfBoundsException("Index " + (startIndex + i) + " out of bounds for length " + buffers.length);
      }
      slices[i] = b.duplicate();
    }

    // set the last buffer's limit for the sliced view.
    slices[slices.length - 1]!.limit(this.bufOffset(sliceEnd));

    return slices;
  }

  override close(): void {
    try {
      if (this.buffers === null) return;

      // make local copy, then un-set early
      const bufs = this.buffers;
      this.unsetBuffers();
      if (this.clones !== null) {
        this.clones.remove(this);
      }

      if (this.isClone) return;

      // for extra safety unset also all clones' buffers:
      if (this.clones !== null) {
        for (const it = this.clones.keyIterator(); it.hasNext(); ) {
          const clone = it.next()!;
          lassert(() => clone.isClone);
          clone.unsetBuffers();
        }
        this.clones.clear();
      }

      for (const b of bufs) {
        this.freeBuffer(b);
      }
    } finally {
      this.unsetBuffers();
    }
  }

  /** Called to remove all references to byte buffers, so we can throw AlreadyClosed on NPE. */
  private unsetBuffers(): void {
    this.buffers = null;
    this.curBuf = null;
    this.curBufIndex = 0;
  }

  private freeBuffer(b: ByteBuffer): void {
    if (this.cleaner !== null) {
      this.cleaner.freeBuffer(this, b);
    }
  }
}

/** Default implementation of ByteBufferIndexInput, supporting multiple buffers and base offset. */
export class DefaultImpl extends ByteBufferIndexInput {
  constructor(
    resourceDescription: string,
    buffers: ByteBuffer[],
    length: number,
    chunkSizePower: number,
    cleaner: BufferCleaner | null,
    clones: Clones | null,
  ) {
    super(resourceDescription, buffers, length, chunkSizePower, cleaner, clones);
    try {
      this.seek(0);
    } catch (ioe) {
      if (ioe instanceof IOException) throw new AssertionError(String(ioe));
      throw ioe;
    }
  }
}

/** Optimization of ByteBufferIndexInput for when there is only one buffer */
export class SingleBufferImpl extends ByteBufferIndexInput {
  constructor(
    resourceDescription: string,
    buffer: ByteBuffer,
    length: number,
    chunkSizePower: number,
    cleaner: BufferCleaner | null,
    clones: Clones | null,
  ) {
    super(resourceDescription, [buffer], length, chunkSizePower, cleaner, clones);
    this.curBufIndex = 0;
    this.curBuf = buffer;
    buffer.position(0);
  }

  // Java: the (int) casts of long positions
  private static toInt(pos: number): number {
    return pos | 0;
  }

  /** IllegalArgumentException from the buffer: negative → IAE, past the limit → EOF */
  private rethrow(e: unknown, pos: number): never {
    if (e instanceof IllegalArgumentException) {
      if (pos < 0) {
        throw new IllegalArgumentException("Seeking to negative position: " + this.toString());
      } else {
        throw new EOFException("seek past EOF: " + this.toString());
      }
    }
    throw e;
  }

  override seek(pos: number): void {
    const cb = this.cur();
    try {
      cb.position(SingleBufferImpl.toInt(pos));
    } catch (e) {
      this.rethrow(e, pos);
    }
  }

  override getFilePointer(): number {
    return this.cur().position();
  }

  override readByteAt(pos: number): number {
    const cb = this.cur();
    try {
      return cb.get(SingleBufferImpl.toInt(pos));
    } catch (e) {
      this.rethrow(e, pos);
    }
  }

  override readShortAt(pos: number): number {
    const cb = this.cur();
    try {
      return cb.getShort(SingleBufferImpl.toInt(pos));
    } catch (e) {
      this.rethrow(e, pos);
    }
  }

  override readIntAt(pos: number): number {
    const cb = this.cur();
    try {
      return cb.getInt(SingleBufferImpl.toInt(pos));
    } catch (e) {
      this.rethrow(e, pos);
    }
  }

  override readLongAt(pos: number): bigint {
    const cb = this.cur();
    try {
      return cb.getLong(SingleBufferImpl.toInt(pos));
    } catch (e) {
      this.rethrow(e, pos);
    }
  }
}

/** This class adds offset support to ByteBufferIndexInput, which is needed for slices. */
export class WithOffsetImpl extends ByteBufferIndexInput {
  private readonly offset: number;

  constructor(
    resourceDescription: string,
    buffers: ByteBuffer[],
    offset: number,
    length: number,
    chunkSizePower: number,
    cleaner: BufferCleaner | null,
    clones: Clones | null,
  ) {
    super(resourceDescription, buffers, length, chunkSizePower, cleaner, clones);
    this.offset = offset;
    try {
      this.seek(0);
    } catch (ioe) {
      if (ioe instanceof IOException) throw new AssertionError(String(ioe));
      throw ioe;
    }
  }

  override seek(pos: number): void {
    if (pos < 0) {
      throw new IllegalArgumentException("Seeking to negative position: " + this.toString());
    }
    super.seek(pos + this.offset);
  }

  override getFilePointer(): number {
    return super.getFilePointer() - this.offset;
  }

  override readByteAt(pos: number): number {
    return super.readByteAt(pos + this.offset);
  }

  override readShortAt(pos: number): number {
    return super.readShortAt(pos + this.offset);
  }

  override readIntAt(pos: number): number {
    return super.readIntAt(pos + this.offset);
  }

  override readLongAt(pos: number): bigint {
    return super.readLongAt(pos + this.offset);
  }

  protected override buildSlice(sliceDescription: string | null, ofs: number, length: number): ByteBufferIndexInput {
    return super.buildSlice(sliceDescription, this.offset + ofs, length);
  }
}
