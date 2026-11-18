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

// Port of org.apache.lucene.store.IndexOutput (Lucene 5.2.1).

import { IllegalArgumentException } from "../errors.js";
import type { Closeable } from "../io/Closeable.js";
import { DataOutput } from "./DataOutput.js";

/**
 * Abstract base class for output to a file in a Directory.  A random-access
 * output stream.  Used for all Lucene index output operations.
 *
 * <p>{@code IndexOutput} may only be used from one thread, because it is not
 * thread safe (it keeps internal state like file position).
 *
 * @see Directory
 * @see IndexInput
 */
export abstract class IndexOutput extends DataOutput implements Closeable {
  private readonly resourceDescription: string;

  /** Sole constructor.  resourceDescription should be non-null, opaque string
   *  describing this resource; it's returned from {@link toString}. */
  protected constructor(resourceDescription: string) {
    super();
    if (resourceDescription === null || resourceDescription === undefined) {
      throw new IllegalArgumentException("resourceDescription must not be null");
    }
    this.resourceDescription = resourceDescription;
  }

  /** Closes this stream to further operations. */
  abstract close(): void;

  /** Returns the current position in this file, where the next write will
   * occur.
   */
  abstract getFilePointer(): number;

  /** Returns the current checksum of bytes written so far (a Java long: a bigint) */
  abstract getChecksum(): bigint;

  override toString(): string {
    return this.resourceDescription;
  }
}
