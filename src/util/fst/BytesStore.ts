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

// Port of org.apache.lucene.util.fst.BytesStore (Lucene 5.2.1).
//
// Deviations: the Java overloads that cannot be told apart in TypeScript are renamed or merged: writeByte(dest, b) is
// writeByte(a, b?) (told apart by the argument count), writeInt(pos, value) likewise, writeBytes(dest, b, offset, len)
// is writeBytesAt, copyBytes(src, dest, len) is copyBytes(a, b, c?) (a DataInput or a source position); the anonymous
// BytesReader classes are the (internal) classes ForwardBlocksReader and ReverseBlocksReader; BASE_RAM_BYTES_USED is
// shallowSizeOfInstance(BytesStore.class) + shallowSizeOfInstance(ArrayList.class) of a 64-bit HotSpot JVM with
// compressed oops; positions are numbers.

import { IndexOutOfBoundsException } from "../../errors.js";
import type { DataInput } from "../../store/DataInput.js";
import { DataOutput } from "../../store/DataOutput.js";
import type { Accountable } from "../Accountable.js";
import { lassert } from "../assertions.js";
import { RamUsageEstimator } from "../RamUsageEstimator.js";
import { ForwardBytesReader } from "./ForwardBytesReader.js";
import { FSTBytesReader } from "./FSTBytesReader.js";
import { ReverseBytesReader } from "./ReverseBytesReader.js";

class ForwardBlocksReader extends FSTBytesReader {
  private current!: Uint8Array;
  private nextBuffer = 0;
  private nextRead: number;
  private readonly store: BytesStore;

  constructor(store: BytesStore) {
    super();
    this.store = store;
    this.nextRead = store.blockSize;
  }

  readByte(): number {
    if (this.nextRead === this.store.blockSize) {
      this.current = this.store.blockAt(this.nextBuffer++);
      this.nextRead = 0;
    }
    return this.current[this.nextRead++]!;
  }

  override skipBytes(count: number): void {
    this.setPosition(this.getPosition() + count);
  }

  readBytes(b: Uint8Array, offset: number, len: number): void {
    const blockSize = this.store.blockSize;
    while (len > 0) {
      const chunkLeft = blockSize - this.nextRead;
      if (len <= chunkLeft) {
        b.set(this.current.subarray(this.nextRead, this.nextRead + len), offset);
        this.nextRead += len;
        break;
      } else {
        if (chunkLeft > 0) {
          b.set(this.current.subarray(this.nextRead, this.nextRead + chunkLeft), offset);
          offset += chunkLeft;
          len -= chunkLeft;
        }
        this.current = this.store.blockAt(this.nextBuffer++);
        this.nextRead = 0;
      }
    }
  }

  getPosition(): number {
    return (this.nextBuffer - 1) * this.store.blockSize + this.nextRead;
  }

  setPosition(pos: number): void {
    const bufferIndex = Math.floor(pos / this.store.blockSize);
    this.nextBuffer = bufferIndex + 1;
    this.current = this.store.blockAt(bufferIndex);
    this.nextRead = pos % this.store.blockSize;
    lassert(() => this.getPosition() === pos);
  }

  reversed(): boolean {
    return false;
  }
}

class ReverseBlocksReader extends FSTBytesReader {
  private current: Uint8Array | undefined;
  private nextBuffer = -1;
  private nextRead = 0;
  private readonly store: BytesStore;

  constructor(store: BytesStore) {
    super();
    this.store = store;
    this.current = store.blocks.length === 0 ? undefined : store.blocks[0];
  }

  readByte(): number {
    if (this.nextRead === -1) {
      this.current = this.store.blockAt(this.nextBuffer--);
      this.nextRead = this.store.blockSize - 1;
    }
    return this.current![this.nextRead--]!;
  }

  override skipBytes(count: number): void {
    this.setPosition(this.getPosition() - count);
  }

  readBytes(b: Uint8Array, offset: number, len: number): void {
    for (let i = 0; i < len; i++) {
      b[offset + i] = this.readByte();
    }
  }

  getPosition(): number {
    return (this.nextBuffer + 1) * this.store.blockSize + this.nextRead;
  }

  setPosition(pos: number): void {
    // NOTE: a little weird because if you
    // setPosition(0), the next byte you read is
    // bytes[0] ... but I would expect bytes[-1] (ie,
    // EOF)...?
    const bufferIndex = Math.floor(pos / this.store.blockSize);
    this.nextBuffer = bufferIndex - 1;
    this.current = this.store.blockAt(bufferIndex);
    this.nextRead = pos % this.store.blockSize;
    lassert(() => this.getPosition() === pos, () => "pos=" + pos + " getPos()=" + this.getPosition());
  }

  reversed(): boolean {
    return true;
  }
}

// TODO: merge with PagedBytes, except PagedBytes doesn't
// let you read while writing which FST needs

/**
 * @internal
 */
export class BytesStore extends DataOutput implements Accountable {
  private static readonly BASE_RAM_BYTES_USED = 64;

  /** @internal */
  readonly blocks: Uint8Array[] = [];

  /** @internal */
  readonly blockSize: number;
  private readonly blockBits: number;
  private readonly blockMask: number;

  private current: Uint8Array | null = null;
  private nextWrite: number;

  constructor(blockBits: number);
  constructor(input: DataInput, numBytes: number, maxBlockSize: number);
  constructor(a: number | DataInput, numBytes?: number, maxBlockSize?: number) {
    super();
    if (typeof a === "number") {
      this.blockBits = a;
      this.blockSize = 1 << a;
      this.blockMask = this.blockSize - 1;
      this.nextWrite = this.blockSize;
    } else {
      const input = a;
      let blockSize = 2;
      let blockBits = 1;
      while (blockSize < numBytes! && blockSize < maxBlockSize!) {
        blockSize *= 2;
        blockBits++;
      }
      this.blockBits = blockBits;
      this.blockSize = blockSize;
      this.blockMask = blockSize - 1;

      let left = numBytes!;
      while (left > 0) {
        const chunk = Math.min(blockSize, left);
        const block = new Uint8Array(chunk);
        input.readBytes(block, 0, block.length);
        this.blocks.push(block);
        left -= chunk;
      }

      // So .getPosition still works
      this.nextWrite = this.blockAt(this.blocks.length - 1).length;
    }
  }

  /** Absolute write byte; you must ensure dest is < max position written so far, or writeByte(b) appends. */
  override writeByte(a: number, b?: number): void {
    if (b !== undefined) {
      const dest = a;
      const blockIndex = Math.floor(dest / this.blockSize);
      const block = this.blockAt(blockIndex);
      block[dest % this.blockSize] = b;
    } else {
      if (this.nextWrite === this.blockSize) {
        this.current = new Uint8Array(this.blockSize);
        this.blocks.push(this.current);
        this.nextWrite = 0;
      }
      this.current![this.nextWrite++] = a;
    }
  }

  writeBytes(b: Uint8Array, offset: number, len: number): void {
    while (len > 0) {
      const chunk = this.blockSize - this.nextWrite;
      if (len <= chunk) {
        lassert(() => b !== null);
        lassert(() => this.current !== null);
        this.current!.set(b.subarray(offset, offset + len), this.nextWrite);
        this.nextWrite += len;
        break;
      } else {
        if (chunk > 0) {
          this.current!.set(b.subarray(offset, offset + chunk), this.nextWrite);
          offset += chunk;
          len -= chunk;
        }
        this.current = new Uint8Array(this.blockSize);
        this.blocks.push(this.current);
        this.nextWrite = 0;
      }
    }
  }

  /** ArrayList.get(index) of the Java blocks list (throws IndexOutOfBoundsException like it). @internal */
  blockAt(index: number): Uint8Array {
    if (index < 0 || index >= this.blocks.length) {
      throw new IndexOutOfBoundsException("Index " + index + " out of bounds for length " + this.blocks.length);
    }
    return this.blocks[index]!;
  }

  getBlockBits(): number {
    return this.blockBits;
  }

  /**
   * Absolute writeBytes without changing the current position. Note: this cannot "grow" the bytes, so you must only
   * call it on already written parts. (Java: writeBytes(long dest, byte[] b, int offset, int len))
   */
  writeBytesAt(dest: number, b: Uint8Array, offset: number, len: number): void {
    lassert(() => dest + len <= this.getPosition(), () => "dest=" + dest + " pos=" + this.getPosition() + " len=" + len);

    // Note: weird: must go "backwards" because copyBytes
    // calls us with overlapping src/dest.  If we
    // go forwards then we overwrite bytes before we can
    // copy them:

    const end = dest + len;
    let blockIndex = Math.floor(end / this.blockSize);
    let downTo = end % this.blockSize;
    if (downTo === 0) {
      blockIndex--;
      downTo = this.blockSize;
    }
    let block = this.blockAt(blockIndex);

    while (len > 0) {
      if (len <= downTo) {
        block.set(b.subarray(offset, offset + len), downTo - len);
        break;
      } else {
        len -= downTo;
        block.set(b.subarray(offset + len, offset + len + downTo), 0);
        blockIndex--;
        block = this.blockAt(blockIndex);
        downTo = this.blockSize;
      }
    }
  }

  /**
   * Absolute copy bytes self to self, without changing the position (Java: copyBytes(long src, long dest, int len)),
   * or DataOutput.copyBytes(DataInput, long numBytes). Note: the former cannot "grow" the bytes, so must only be
   * called on already written parts.
   */
  override copyBytes(input: DataInput, numBytes: number): void;
  override copyBytes(src: number, dest: number, len: number): void;
  override copyBytes(a: DataInput | number, b: number, c?: number): void {
    if (typeof a !== "number") {
      super.copyBytes(a, b);
      return;
    }
    const src = a;
    const dest = b;
    let len = c!;
    lassert(() => src < dest);

    // Note: weird: must go "backwards" because copyBytes
    // calls us with overlapping src/dest.  If we
    // go forwards then we overwrite bytes before we can
    // copy them:

    const end = src + len;

    let blockIndex = Math.floor(end / this.blockSize);
    let downTo = end % this.blockSize;
    if (downTo === 0) {
      blockIndex--;
      downTo = this.blockSize;
    }
    let block = this.blockAt(blockIndex);

    while (len > 0) {
      if (len <= downTo) {
        this.writeBytesAt(dest, block, downTo - len, len);
        break;
      } else {
        len -= downTo;
        this.writeBytesAt(dest + len, block, 0, downTo);
        blockIndex--;
        block = this.blockAt(blockIndex);
        downTo = this.blockSize;
      }
    }
  }

  /** Writes an int at the absolute position without changing the current pointer, or appends it (DataOutput.writeInt). */
  override writeInt(a: number, value?: number): void {
    if (value === undefined) {
      super.writeInt(a);
      return;
    }
    const pos = a;
    let blockIndex = Math.floor(pos / this.blockSize);
    let upto = pos % this.blockSize;
    let block = this.blockAt(blockIndex);
    let shift = 24;
    for (let i = 0; i < 4; i++) {
      block[upto++] = (value >> shift) & 0xff;
      shift -= 8;
      if (upto === this.blockSize) {
        upto = 0;
        blockIndex++;
        block = this.blockAt(blockIndex);
      }
    }
  }

  /** Reverse from srcPos, inclusive, to destPos, inclusive. */
  reverse(srcPos: number, destPos: number): void {
    lassert(() => srcPos < destPos);
    lassert(() => destPos < this.getPosition());

    let srcBlockIndex = Math.floor(srcPos / this.blockSize);
    let src = srcPos % this.blockSize;
    let srcBlock = this.blockAt(srcBlockIndex);

    let destBlockIndex = Math.floor(destPos / this.blockSize);
    let dest = destPos % this.blockSize;
    let destBlock = this.blockAt(destBlockIndex);

    const limit = Math.floor((destPos - srcPos + 1) / 2);
    for (let i = 0; i < limit; i++) {
      const b = srcBlock[src]!;
      srcBlock[src] = destBlock[dest]!;
      destBlock[dest] = b;
      src++;
      if (src === this.blockSize) {
        srcBlockIndex++;
        srcBlock = this.blockAt(srcBlockIndex);
        src = 0;
      }

      dest--;
      if (dest === -1) {
        destBlockIndex--;
        destBlock = this.blockAt(destBlockIndex);
        dest = this.blockSize - 1;
      }
    }
  }

  skipBytes(len: number): void {
    while (len > 0) {
      const chunk = this.blockSize - this.nextWrite;
      if (len <= chunk) {
        this.nextWrite += len;
        break;
      } else {
        len -= chunk;
        this.current = new Uint8Array(this.blockSize);
        this.blocks.push(this.current);
        this.nextWrite = 0;
      }
    }
  }

  getPosition(): number {
    return (this.blocks.length - 1) * this.blockSize + this.nextWrite;
  }

  /** Pos must be less than the max position written so far!  Ie, you cannot "grow" the file with this! */
  truncate(newLen: number): void {
    lassert(() => newLen <= this.getPosition());
    lassert(() => newLen >= 0);
    let blockIndex = Math.floor(newLen / this.blockSize);
    this.nextWrite = newLen % this.blockSize;
    if (this.nextWrite === 0) {
      blockIndex--;
      this.nextWrite = this.blockSize;
    }
    this.blocks.length = Math.max(0, blockIndex + 1);
    if (newLen === 0) {
      this.current = null;
    } else {
      this.current = this.blockAt(blockIndex);
    }
    lassert(() => newLen === this.getPosition());
  }

  finish(): void {
    if (this.current !== null) {
      const lastBuffer = new Uint8Array(this.nextWrite);
      lastBuffer.set(this.current.subarray(0, this.nextWrite), 0);
      this.blocks[this.blocks.length - 1] = lastBuffer;
      this.current = null;
    }
  }

  /** Writes all of our bytes to the target {@link DataOutput}. */
  writeTo(out: DataOutput): void {
    for (const block of this.blocks) {
      out.writeBytes(block, 0, block.length);
    }
  }

  getForwardReader(): FSTBytesReader {
    if (this.blocks.length === 1) {
      return new ForwardBytesReader(this.blockAt(0));
    }
    return new ForwardBlocksReader(this);
  }

  getReverseReader(allowSingle = true): FSTBytesReader {
    if (allowSingle && this.blocks.length === 1) {
      return new ReverseBytesReader(this.blockAt(0));
    }
    return new ReverseBlocksReader(this);
  }

  ramBytesUsed(): number {
    // TODO: this is called per-doc-per-field in the Lucene50 BlockTree writer; the ArrayList's capacity is not tracked
    let size = BytesStore.BASE_RAM_BYTES_USED;
    for (const block of this.blocks) {
      size += RamUsageEstimator.sizeOf(block);
    }
    return size;
  }

  getChildResources(): readonly Accountable[] {
    return [];
  }

  override toString(): string {
    return this.constructor.name + "(numBlocks=" + this.blocks.length + ")";
  }
}
