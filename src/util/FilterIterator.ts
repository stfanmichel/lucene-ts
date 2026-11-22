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

import { NoSuchElementException, UnsupportedOperationException } from "../errors.js";
import { lassert } from "./assertions.js";
import type { JavaIterator } from "./JavaIterator.js";

/**
 * Port of org.apache.lucene.util.FilterIterator: An {@link Iterator} implementation that filters elements with a
 * boolean predicate.
 */
export abstract class FilterIterator<T, InnerT extends T> implements JavaIterator<T> {
  private readonly iterator: JavaIterator<InnerT>;
  private nextValue: T | null = null;
  private nextIsSet = false;

  /** returns true, if this element should be returned by {@link #next()}. */
  protected abstract predicateFunction(object: InnerT): boolean;

  constructor(baseIterator: JavaIterator<InnerT>) {
    this.iterator = baseIterator;
  }

  hasNext(): boolean {
    return this.nextIsSet || this.setNext();
  }

  next(): T {
    if (!this.hasNext()) {
      throw new NoSuchElementException();
    }
    lassert(() => this.nextIsSet);
    try {
      return this.nextValue as T;
    } finally {
      this.nextIsSet = false;
      this.nextValue = null;
    }
  }

  remove(): void {
    throw new UnsupportedOperationException();
  }

  private setNext(): boolean {
    while (this.iterator.hasNext()) {
      const object = this.iterator.next();
      if (this.predicateFunction(object)) {
        this.nextValue = object;
        this.nextIsSet = true;
        return true;
      }
    }
    return false;
  }
}
