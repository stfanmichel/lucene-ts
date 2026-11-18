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

// Port of org.apache.lucene.store.ChecksumIndexInput (Lucene 5.2.1).
//
// Deviation: Java's message embeds getClass() ("class org.apache.lucene.store.Foo"); TypeScript only knows the
// simple class name, so the message reads "class Foo cannot seek backwards".

import { IllegalStateException } from "../errors.js";
import { IndexInput } from "./IndexInput.js";

/**
 * Extension of IndexInput, computing checksum as it goes.
 * Callers can retrieve the checksum via {@link getChecksum}.
 */
export abstract class ChecksumIndexInput extends IndexInput {
  /** resourceDescription should be a non-null, opaque string
   *  describing this resource; it's returned from
   *  {@link toString}. */
  protected constructor(resourceDescription: string) {
    super(resourceDescription);
  }

  /** Returns the current checksum value (a Java long: a bigint) */
  abstract getChecksum(): bigint;

  /**
   * {@inheritDoc}
   *
   * {@link ChecksumIndexInput} can only seek forward and seeks are expensive
   * since they imply to read bytes in-between the current position and the
   * target position in order to update the checksum.
   */
  seek(pos: number): void {
    const skip = pos - this.getFilePointer();
    if (skip < 0) {
      throw new IllegalStateException("class " + this.constructor.name + " cannot seek backwards");
    }
    this.skipBytes(skip);
  }
}
