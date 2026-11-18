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

// Port of org.apache.lucene.store.IndexInput (Lucene 5.2.1).
// File positions and lengths are `number`s (see PORTING.md).

import { IllegalArgumentException } from "../errors.js";
import type { Closeable } from "../io/Closeable.js";
import { DataInput } from "./DataInput.js";
import { RANDOM_ACCESS_INPUT, type RandomAccessInput, isRandomAccessInput } from "./RandomAccessInput.js";

/**
 * Abstract base class for input from a file in a {@link Directory}.  A
 * random-access input stream.  Used for all Lucene index input operations.
 *
 * <p>{@code IndexInput} may only be used from one thread, because it is not
 * thread safe (it keeps internal state like file position). To allow
 * multithreaded use, every {@code IndexInput} instance must be cloned before
 * used in another thread. Subclasses must therefore implement {@link clone},
 * returning a new {@code IndexInput} which operates on the same underlying
 * resource, but positioned independently. Lucene never closes cloned
 * {@code IndexInput}s, it will only do this on the original one.
 * The original instance must take care that cloned instances throw
 * {@link AlreadyClosedException} when the original one is closed.
 * @see Directory
 */
export abstract class IndexInput extends DataInput implements Closeable {
  private readonly resourceDescription: string;

  /** resourceDescription should be a non-null, opaque string
   *  describing this resource; it's returned from
   *  {@link toString}. */
  protected constructor(resourceDescription: string) {
    super();
    if (resourceDescription === null || resourceDescription === undefined) {
      throw new IllegalArgumentException("resourceDescription must not be null");
    }
    this.resourceDescription = resourceDescription;
  }

  /** Closes the stream to further operations. */
  abstract close(): void;

  /** Returns the current position in this file, where the next read will
   * occur.
   * @see seek
   */
  abstract getFilePointer(): number;

  /** Sets current position in this file, where the next read will occur.
   * @see getFilePointer
   */
  abstract seek(pos: number): void;

  /** The number of bytes in the file. */
  abstract length(): number;

  override toString(): string {
    return this.resourceDescription;
  }

  /** {@inheritDoc}
   * <p><b>Warning:</b> Lucene never closes cloned
   * {@code IndexInput}s, it will only do this on the original one.
   * The original instance must take care that cloned instances throw
   * {@link AlreadyClosedException} when the original one is closed.
   */
  override clone(): this {
    return super.clone();
  }

  /**
   * Creates a slice of this index input, with the given description, offset, and length.
   * The slice is seeked to the beginning.
   */
  abstract slice(sliceDescription: string | null, offset: number, length: number): IndexInput;

  /** Subclasses call this to get the String for resourceDescription of a slice of this {@code IndexInput}. */
  protected getFullSliceDescription(sliceDescription: string | null): string {
    if (sliceDescription === null) {
      return this.toString();
    } else {
      return this.toString() + " [slice=" + sliceDescription + "]";
    }
  }

  /**
   * Creates a random-access slice of this index input, with the given offset and length.
   * <p>
   * The default implementation calls {@link slice}, and it doesn't support random access,
   * it implements absolute reads as seek+read.
   */
  randomAccessSlice(offset: number, length: number): RandomAccessInput {
    const slice = this.slice("randomaccess", offset, length);
    if (isRandomAccessInput(slice)) {
      return slice;
    } else {
      return {
        get [RANDOM_ACCESS_INPUT](): true {
          return true;
        },
        readByte(pos: number): number {
          slice.seek(pos);
          return slice.readByte();
        },
        readShort(pos: number): number {
          slice.seek(pos);
          return slice.readShort();
        },
        readInt(pos: number): number {
          slice.seek(pos);
          return slice.readInt();
        },
        readLong(pos: number): bigint {
          slice.seek(pos);
          return slice.readLong();
        },
      };
    }
  }
}
