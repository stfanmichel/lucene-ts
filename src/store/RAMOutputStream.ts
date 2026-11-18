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

// Port of org.apache.lucene.store.RAMOutputStream (Lucene 5.2.1).
// Overloads: constructor () / (f, checksum) / (name, f, checksum); writeTo(DataOutput) / writeTo(bytes, offset).

import { IllegalStateException } from "../errors.js";
import { arraycopy } from "../util/JavaObjects.js";
import type { Accountable } from "../util/Accountable.js";
import { Accountables } from "../util/Accountables.js";
import type { Checksum } from "../zip/Checksum.js";
import { CRC32 } from "../zip/CRC32.js";
import { BufferedChecksum } from "./BufferedChecksum.js";
import type { DataOutput } from "./DataOutput.js";
import { IndexOutput } from "./IndexOutput.js";
import { RAMFile } from "./RAMFile.js";

/**
 * A memory-resident {@link IndexOutput} implementation.
 *
 * @lucene.internal
 */
export class RAMOutputStream extends IndexOutput implements Accountable {
  /** @internal */
  static readonly BUFFER_SIZE = 1024;

  private readonly file: RAMFile;

  private currentBuffer: Uint8Array | null;
  private currentBufferIndex: number;

  private bufferPosition = 0;
  private bufferStart = 0;
  private bufferLength = 0;

  private readonly crc: Checksum | null;

  /** Construct an empty output buffer. */
  constructor();
  constructor(f: RAMFile, checksum: boolean);
  constructor(name: string, f: RAMFile, checksum: boolean);
  constructor(a?: string | RAMFile, b?: RAMFile | boolean, c?: boolean) {
    const name = typeof a === "string" ? a : "noname";
    const f = typeof a === "string" ? (b as RAMFile) : a === undefined ? new RAMFile() : a;
    const checksum = typeof a === "string" ? (c as boolean) : a === undefined ? false : (b as boolean);
    super('RAMOutputStream(name="' + name + '")');
    this.file = f;

    // make sure that we switch to the
    // first needed buffer lazily
    this.currentBufferIndex = -1;
    this.currentBuffer = null;
    if (checksum) {
      this.crc = new BufferedChecksum(new CRC32());
    } else {
      this.crc = null;
    }
  }

  /** Copy the current contents of this buffer to the provided {@link DataOutput}. */
  writeTo(out: DataOutput): void;
  /** Copy the current contents of this buffer to the provided byte array */
  writeTo(bytes: Uint8Array, offset: number): void;
  writeTo(target: DataOutput | Uint8Array, offset?: number): void {
    this.flush();
    const end = this.file.length;
    let pos = 0;
    let buffer = 0;
    let bytesUpto = offset ?? 0;
    while (pos < end) {
      let length = RAMOutputStream.BUFFER_SIZE;
      const nextPos = pos + length;
      if (nextPos > end) {
        // at the last buffer
        length = end - pos;
      }
      if (target instanceof Uint8Array) {
        arraycopy(this.file.getBuffer(buffer++), 0, target, bytesUpto, length);
        bytesUpto += length;
      } else {
        target.writeBytes(this.file.getBuffer(buffer++), 0, length);
      }
      pos = nextPos;
    }
  }

  /** Resets this to an empty file. */
  reset(): void {
    this.currentBuffer = null;
    this.currentBufferIndex = -1;
    this.bufferPosition = 0;
    this.bufferStart = 0;
    this.bufferLength = 0;
    this.file.setLength(0);
    if (this.crc !== null) {
      this.crc.reset();
    }
  }

  close(): void {
    this.flush();
  }

  writeByte(b: number): void {
    if (this.bufferPosition === this.bufferLength) {
      this.currentBufferIndex++;
      this.switchCurrentBuffer();
    }
    if (this.crc !== null) {
      this.crc.update(b & 0xff);
    }
    this.currentBuffer![this.bufferPosition++] = b;
  }

  writeBytes(b: Uint8Array, offset: number, len: number): void {
    if (this.crc !== null) {
      this.crc.update(b, offset, len);
    }
    while (len > 0) {
      if (this.bufferPosition === this.bufferLength) {
        this.currentBufferIndex++;
        this.switchCurrentBuffer();
      }

      const remainInBuffer = this.currentBuffer!.length - this.bufferPosition;
      const bytesToCopy = len < remainInBuffer ? len : remainInBuffer;
      arraycopy(b, offset, this.currentBuffer!, this.bufferPosition, bytesToCopy);
      offset += bytesToCopy;
      len -= bytesToCopy;
      this.bufferPosition += bytesToCopy;
    }
  }

  private switchCurrentBuffer(): void {
    if (this.currentBufferIndex === this.file.numBuffers()) {
      this.currentBuffer = this.file.addBuffer(RAMOutputStream.BUFFER_SIZE);
    } else {
      this.currentBuffer = this.file.getBuffer(this.currentBufferIndex);
    }
    this.bufferPosition = 0;
    this.bufferStart = RAMOutputStream.BUFFER_SIZE * this.currentBufferIndex;
    this.bufferLength = this.currentBuffer.length;
  }

  private setFileLength(): void {
    const pointer = this.bufferStart + this.bufferPosition;
    if (pointer > this.file.length) {
      this.file.setLength(pointer);
    }
  }

  protected flush(): void {
    this.setFileLength();
  }

  getFilePointer(): number {
    return this.currentBufferIndex < 0 ? 0 : this.bufferStart + this.bufferPosition;
  }

  /** Returns byte usage of all buffers. */
  ramBytesUsed(): number {
    return this.file.numBuffers() * RAMOutputStream.BUFFER_SIZE;
  }

  getChildResources(): readonly Accountable[] {
    return [Accountables.namedAccountable("file", this.file)];
  }

  getChecksum(): bigint {
    if (this.crc === null) {
      throw new IllegalStateException("internal RAMOutputStream created with checksum disabled");
    } else {
      return this.crc.getValue();
    }
  }
}
