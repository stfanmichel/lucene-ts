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

// Port of org.apache.lucene.store.RAMFile (Lucene 5.2.1). The Java members that are package-private or
// protected and used by RAMInputStream/RAMOutputStream/RAMDirectory are public + @internal here.
// `synchronized` is dropped (single thread).

import { IndexOutOfBoundsException } from "../errors.js";
import type { Accountable } from "../util/Accountable.js";
import { arraysEquals, arraysHashCode } from "../util/JavaObjects.js";
import type { RAMDirectory } from "./RAMDirectory.js";

/**
 * Represents a file in RAM as a list of byte buffers.
 * @lucene.internal
 */
export class RAMFile implements Accountable {
  protected readonly buffers: Uint8Array[] = [];
  /** @internal */
  length = 0;
  /** @internal */
  directory: RAMDirectory | null = null;
  // Only valid if directory != null (Java: protected long sizeInBytes)
  /** @internal */
  sizeInBytes = 0;

  // File used as buffer, in no RAMDirectory
  constructor();
  /** @internal */
  constructor(directory: RAMDirectory);
  constructor(directory?: RAMDirectory) {
    this.directory = directory ?? null;
  }

  // For non-stream access from thread that might be concurrent with writing
  getLength(): number {
    return this.length;
  }

  /** @internal */
  setLength(length: number): void {
    this.length = length;
  }

  /** @internal */
  addBuffer(size: number): Uint8Array {
    const buffer = this.newBuffer(size);
    this.buffers.push(buffer);
    this.sizeInBytes += size;
    if (this.directory !== null) {
      this.directory.sizeInBytes.getAndAdd(size);
    }
    return buffer;
  }

  /** @internal ArrayList.get: throws IndexOutOfBoundsException when out of range. */
  getBuffer(index: number): Uint8Array {
    if (index < 0 || index >= this.buffers.length) {
      throw new IndexOutOfBoundsException("Index " + index + " out of bounds for length " + this.buffers.length);
    }
    return this.buffers[index]!;
  }

  /** @internal */
  numBuffers(): number {
    return this.buffers.length;
  }

  /**
   * Expert: allocate a new buffer.
   * Subclasses can allocate differently.
   * @param size size of allocated buffer.
   * @return allocated buffer.
   */
  protected newBuffer(size: number): Uint8Array {
    return new Uint8Array(size);
  }

  ramBytesUsed(): number {
    return this.sizeInBytes;
  }

  getChildResources(): readonly Accountable[] {
    return [];
  }

  toString(): string {
    return this.constructor.name + "(length=" + this.length + ")";
  }

  hashCode(): number {
    let h = Number(BigInt.asIntN(32, BigInt(this.length) ^ (BigInt(this.length) >> 32n)));
    for (const block of this.buffers) {
      h = (Math.imul(31, h) + arraysHashCode(block)) | 0;
    }
    return h;
  }

  equals(obj: unknown): boolean {
    if (this === obj) return true;
    if (obj === null || obj === undefined) return false;
    if (this.constructor !== (obj as object).constructor) return false;
    const other = obj as RAMFile;
    if (this.length !== other.length) return false;
    if (this.buffers.length !== other.buffers.length) {
      return false;
    }
    for (let i = 0; i < this.buffers.length; i++) {
      if (!arraysEquals(this.buffers[i]!, other.buffers[i]!)) {
        return false;
      }
    }
    return true;
  }
}

