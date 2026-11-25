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

// Port of org.apache.lucene.util.PagedBytes (Lucene 5.2.1).
//
// Deviations: the nested classes are top-level classes of this file (PagedBytesReader = PagedBytes.Reader,
// PagedBytesDataInput, PagedBytesDataOutput) that reach into the PagedBytes through @internal fields; the overloaded
// copy(IndexInput, long) / copy(BytesRef, BytesRef) is one method told apart by its first argument; positions and
// pointers are numbers; BASE_RAM_BYTES_USED are the values RamUsageEstimator.shallowSizeOfInstance reports on a 64-bit
// HotSpot JVM with compressed oops (see golden tests); an out-of-range block index is not an ArrayIndexOutOfBounds
// (plain arrays yield undefined).

import { IllegalArgumentException, IllegalStateException } from "../errors.js";
import { DataInput } from "../store/DataInput.js";
import { DataOutput } from "../store/DataOutput.js";
import type { IndexInput } from "../store/IndexInput.js";
import type { Accountable } from "./Accountable.js";
import { ArrayUtil } from "./ArrayUtil.js";
import { lassert } from "./assertions.js";
import { BytesRef } from "./BytesRef.js";
import { RamUsageEstimator } from "./RamUsageEstimator.js";

const EMPTY_BYTES = new Uint8Array(0);

/**
 * Provides methods to read BytesRefs from a frozen PagedBytes.
 *
 * @see PagedBytes#freeze
 */
export class PagedBytesReader implements Accountable {
  private static readonly BASE_RAM_BYTES_USED = 40;
  private readonly blocks: Uint8Array[];
  private readonly blockBits: number;
  private readonly blockMask: number;
  private readonly blockSize: number;
  private readonly bytesUsedPerBlock: number;

  /** @internal */
  constructor(pagedBytes: PagedBytes) {
    this.blocks = pagedBytes.blocks.slice(0, pagedBytes.numBlocks) as Uint8Array[];
    this.blockBits = pagedBytes.blockBits;
    this.blockMask = pagedBytes.blockMask;
    this.blockSize = pagedBytes.blockSize;
    this.bytesUsedPerBlock = pagedBytes.bytesUsedPerBlock;
  }

  /**
   * Gets a slice out of {@link PagedBytes} starting at <i>start</i> with a given length. Iff the slice spans across a
   * block border this method will allocate sufficient resources and copy the paged data.
   *
   * Slices spanning more than two blocks are not supported.
   * @lucene.internal
   */
  fillSlice(b: BytesRef, start: number, length: number): void {
    lassert(() => length >= 0, () => "length=" + length);
    lassert(() => length <= this.blockSize + 1, () => "length=" + length);
    b.length = length;
    if (length === 0) {
      return;
    }
    const index = Math.floor(start / this.blockSize);
    const offset = start % this.blockSize;
    if (this.blockSize - offset >= length) {
      // Within block
      b.bytes = this.blocks[index]!;
      b.offset = offset;
    } else {
      // Split
      b.bytes = new Uint8Array(length);
      b.offset = 0;
      b.bytes.set(this.blocks[index]!.subarray(offset, this.blockSize), 0);
      b.bytes.set(this.blocks[1 + index]!.subarray(0, length - (this.blockSize - offset)), this.blockSize - offset);
    }
  }

  /**
   * Reads length as 1 or 2 byte vInt prefix, starting at <i>start</i>.
   *
   * <b>Note:</b> this method does not support slices spanning across block borders.
   * @lucene.internal
   */
  fill(b: BytesRef, start: number): void {
    const index = Math.floor(start / this.blockSize);
    const offset = start % this.blockSize;
    const block = (b.bytes = this.blocks[index]!);
    if ((block[offset]! & 128) === 0) {
      b.length = block[offset]!;
      b.offset = offset + 1;
    } else {
      b.length = ((block[offset]! & 0x7f) << 8) | (block[1 + offset]! & 0xff);
      b.offset = offset + 2;
      lassert(() => b.length > 0);
    }
  }

  ramBytesUsed(): number {
    let size = PagedBytesReader.BASE_RAM_BYTES_USED + RamUsageEstimator.shallowSizeOf(this.blocks);
    if (this.blocks.length > 0) {
      size += (this.blocks.length - 1) * this.bytesUsedPerBlock;
      size += RamUsageEstimator.sizeOf(this.blocks[this.blocks.length - 1]!);
    }
    return size;
  }

  getChildResources(): readonly Accountable[] {
    return [];
  }

  toString(): string {
    return "PagedBytes(blocksize=" + this.blockSize + ")";
  }
}

/**
 * {@link DataInput} implementation for a frozen PagedBytes: reads across block borders.
 */
export class PagedBytesDataInput extends DataInput {
  private currentBlockIndex = 0;
  private currentBlockUpto = 0;
  private currentBlock: Uint8Array;
  private readonly owner: PagedBytes;

  /** @internal */
  constructor(owner: PagedBytes) {
    super();
    this.owner = owner;
    this.currentBlock = owner.blocks[0]!;
  }

  override clone(): this {
    const clone = this.owner.getDataInput();
    clone.setPosition(this.getPosition());
    return clone as this;
  }

  getPosition(): number {
    return this.currentBlockIndex * this.owner.blockSize + this.currentBlockUpto;
  }

  setPosition(pos: number): void {
    this.currentBlockIndex = Math.floor(pos / this.owner.blockSize);
    this.currentBlock = this.owner.blocks[this.currentBlockIndex]!;
    this.currentBlockUpto = pos % this.owner.blockSize;
  }

  readByte(): number {
    if (this.currentBlockUpto === this.owner.blockSize) {
      this.nextBlock();
    }
    return this.currentBlock[this.currentBlockUpto++]!;
  }

  readBytes(b: Uint8Array, offset: number, len: number): void {
    lassert(() => b.length >= offset + len);
    const offsetEnd = offset + len;
    for (;;) {
      const blockLeft = this.owner.blockSize - this.currentBlockUpto;
      const left = offsetEnd - offset;
      if (blockLeft < left) {
        b.set(this.currentBlock.subarray(this.currentBlockUpto, this.currentBlockUpto + blockLeft), offset);
        this.nextBlock();
        offset += blockLeft;
      } else {
        // Last block
        b.set(this.currentBlock.subarray(this.currentBlockUpto, this.currentBlockUpto + left), offset);
        this.currentBlockUpto += left;
        break;
      }
    }
  }

  private nextBlock(): void {
    this.currentBlockIndex++;
    this.currentBlockUpto = 0;
    this.currentBlock = this.owner.blocks[this.currentBlockIndex]!;
  }
}

/**
 * {@link DataOutput} implementation writing into a PagedBytes.
 */
export class PagedBytesDataOutput extends DataOutput {
  private readonly owner: PagedBytes;

  /** @internal */
  constructor(owner: PagedBytes) {
    super();
    this.owner = owner;
  }

  writeByte(b: number): void {
    const o = this.owner;
    if (o.upto === o.blockSize) {
      if (o.currentBlock !== null) {
        o.addBlock(o.currentBlock);
      }
      o.currentBlock = new Uint8Array(o.blockSize);
      o.upto = 0;
    }
    o.currentBlock![o.upto++] = b;
  }

  writeBytes(b: Uint8Array, offset: number, length: number): void {
    const o = this.owner;
    lassert(() => b.length >= offset + length);
    if (length === 0) {
      return;
    }

    if (o.upto === o.blockSize) {
      if (o.currentBlock !== null) {
        o.addBlock(o.currentBlock);
      }
      o.currentBlock = new Uint8Array(o.blockSize);
      o.upto = 0;
    }

    const offsetEnd = offset + length;
    for (;;) {
      const left = offsetEnd - offset;
      const blockLeft = o.blockSize - o.upto;
      if (blockLeft < left) {
        o.currentBlock!.set(b.subarray(offset, offset + blockLeft), o.upto);
        o.addBlock(o.currentBlock!);
        o.currentBlock = new Uint8Array(o.blockSize);
        o.upto = 0;
        offset += blockLeft;
      } else {
        // Last block
        o.currentBlock!.set(b.subarray(offset, offset + left), o.upto);
        o.upto += left;
        break;
      }
    }
  }

  /** Return the current byte position. */
  getPosition(): number {
    return this.owner.getPointer();
  }
}

/**
 * Represents a logical byte[] as a series of pages. You can write-once into the logical byte[] (append only), using
 * copy, and then retrieve slices (BytesRef) into it using fill.
 *
 * @lucene.internal
 */
export class PagedBytes implements Accountable {
  static readonly Reader = PagedBytesReader;
  private static readonly BASE_RAM_BYTES_USED = 56;

  /** @internal */
  blocks: (Uint8Array | null)[] = new Array<Uint8Array | null>(16).fill(null);
  /** @internal */
  numBlocks: number;
  // TODO: these are unused?
  /** @internal */
  readonly blockSize: number;
  /** @internal */
  readonly blockBits: number;
  /** @internal */
  readonly blockMask: number;
  private didSkipBytes = false;
  private frozen = false;
  /** @internal */
  upto: number;
  /** @internal */
  currentBlock: Uint8Array | null = null;
  /** @internal */
  readonly bytesUsedPerBlock: number;

  /** 1&lt;&lt;blockBits must be bigger than biggest single BytesRef slice that will be pulled */
  constructor(blockBits: number) {
    lassert(() => blockBits > 0 && blockBits <= 31, () => "" + blockBits);
    this.blockSize = 1 << blockBits;
    this.blockBits = blockBits;
    this.blockMask = this.blockSize - 1;
    this.upto = this.blockSize;
    this.bytesUsedPerBlock = RamUsageEstimator.alignObjectSize(this.blockSize + RamUsageEstimator.NUM_BYTES_ARRAY_HEADER);
    this.numBlocks = 0;
  }

  /** @internal */
  addBlock(block: Uint8Array): void {
    if (this.blocks.length === this.numBlocks) {
      const old = this.blocks;
      this.blocks = new Array<Uint8Array | null>(ArrayUtil.oversize(this.numBlocks, RamUsageEstimator.NUM_BYTES_OBJECT_REF)).fill(null);
      for (let i = 0; i < old.length; i++) this.blocks[i] = old[i]!;
    }
    this.blocks[this.numBlocks++] = block;
  }

  /** Read this many bytes from in, or copy this BytesRef into the paged bytes (and fill out to point at it). */
  copy(input: IndexInput, byteCount: number): void;
  copy(bytes: BytesRef, out: BytesRef): void;
  copy(a: IndexInput | BytesRef, b: number | BytesRef): void {
    if (a instanceof BytesRef) {
      this.copyBytesRef(a, b as BytesRef);
    } else {
      this.copyInput(a, b as number);
    }
  }

  private copyInput(input: IndexInput, byteCount: number): void {
    while (byteCount > 0) {
      let left = this.blockSize - this.upto;
      if (left === 0) {
        if (this.currentBlock !== null) {
          this.addBlock(this.currentBlock);
        }
        this.currentBlock = new Uint8Array(this.blockSize);
        this.upto = 0;
        left = this.blockSize;
      }
      if (left < byteCount) {
        input.readBytes(this.currentBlock!, this.upto, left, false);
        this.upto = this.blockSize;
        byteCount -= left;
      } else {
        input.readBytes(this.currentBlock!, this.upto, byteCount, false);
        this.upto += byteCount;
        break;
      }
    }
  }

  private copyBytesRef(bytes: BytesRef, out: BytesRef): void {
    let left = this.blockSize - this.upto;
    if (bytes.length > left || this.currentBlock === null) {
      // TODO: if bytes.length > blockSize we could skip all of the
      // current block and just treat it as a very large
      // slice
      if (this.currentBlock !== null) {
        this.addBlock(this.currentBlock);
        this.didSkipBytes = true;
      }
      this.currentBlock = new Uint8Array(this.blockSize);
      this.upto = 0;
      left = this.blockSize;
      lassert(() => bytes.length <= this.blockSize);
      // TODO: we could also support variable block sizes
    }

    out.bytes = this.currentBlock;
    out.offset = this.upto;
    out.length = bytes.length;

    this.currentBlock.set(bytes.bytes.subarray(bytes.offset, bytes.offset + bytes.length), this.upto);
    this.upto += bytes.length;
  }

  /** Commits final byte[], trimming it if necessary and if trim=true */
  freeze(trim: boolean): PagedBytesReader {
    if (this.frozen) {
      throw new IllegalStateException("already frozen");
    }
    if (this.didSkipBytes) {
      throw new IllegalStateException("cannot freeze when copy(BytesRef, BytesRef) was used");
    }
    if (trim && this.upto < this.blockSize) {
      const newBlock = new Uint8Array(this.upto);
      newBlock.set(this.currentBlock!.subarray(0, this.upto), 0);
      this.currentBlock = newBlock;
    }
    if (this.currentBlock === null) {
      this.currentBlock = EMPTY_BYTES;
    }
    this.addBlock(this.currentBlock);
    this.frozen = true;
    this.currentBlock = null;
    return new PagedBytesReader(this);
  }

  getPointer(): number {
    if (this.currentBlock === null) {
      return 0;
    } else {
      return this.numBlocks * this.blockSize + this.upto;
    }
  }

  ramBytesUsed(): number {
    let size = PagedBytes.BASE_RAM_BYTES_USED + RamUsageEstimator.shallowSizeOf(this.blocks);
    if (this.numBlocks > 0) {
      size += (this.numBlocks - 1) * this.bytesUsedPerBlock;
      size += RamUsageEstimator.sizeOf(this.blocks[this.numBlocks - 1]!);
    }
    if (this.currentBlock !== null) {
      size += RamUsageEstimator.sizeOf(this.currentBlock);
    }
    return size;
  }

  getChildResources(): readonly Accountable[] {
    return [];
  }

  /**
   * Copy bytes in, writing the length as a 1 or 2 byte vInt prefix.
   */
  // TODO: this really needs to be refactored into fieldcacheimpl
  copyUsingLengthPrefix(bytes: BytesRef): number {
    if (bytes.length >= 32768) {
      throw new IllegalArgumentException("max length is 32767 (got " + bytes.length + ")");
    }

    if (this.upto + bytes.length + 2 > this.blockSize) {
      if (bytes.length + 2 > this.blockSize) {
        throw new IllegalArgumentException("block size " + this.blockSize + " is too small to store length " + bytes.length + " bytes");
      }
      if (this.currentBlock !== null) {
        this.addBlock(this.currentBlock);
      }
      this.currentBlock = new Uint8Array(this.blockSize);
      this.upto = 0;
    }

    const pointer = this.getPointer();

    if (bytes.length < 128) {
      this.currentBlock![this.upto++] = bytes.length;
    } else {
      this.currentBlock![this.upto++] = 0x80 | (bytes.length >> 8);
      this.currentBlock![this.upto++] = bytes.length & 0xff;
    }
    this.currentBlock!.set(bytes.bytes.subarray(bytes.offset, bytes.offset + bytes.length), this.upto);
    this.upto += bytes.length;

    return pointer;
  }

  /** Returns a DataInput to read values from this PagedBytes instance. */
  getDataInput(): PagedBytesDataInput {
    if (!this.frozen) {
      throw new IllegalStateException("must call freeze() before getDataInput");
    }
    return new PagedBytesDataInput(this);
  }

  /** Returns a DataOutput that you may use to write into this PagedBytes instance. */
  getDataOutput(): PagedBytesDataOutput {
    if (this.frozen) {
      throw new IllegalStateException("cannot get DataOutput after freeze()");
    }
    return new PagedBytesDataOutput(this);
  }
}
