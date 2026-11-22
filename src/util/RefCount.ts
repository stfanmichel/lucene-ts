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

import { IllegalStateException } from "../errors.js";

/**
 * Port of org.apache.lucene.util.RefCount: Manages reference counting for a given object. Extensions can
 * override {@link #release()} to do custom logic when reference counting hits 0.
 */
export class RefCount<T> {
  private refCount = 1;

  /** @internal protected in Java */
  readonly object: T;

  constructor(object: T) {
    this.object = object;
  }

  /** Called when reference counting hits 0. By default this method does nothing, but extensions can override to e.g. release resources attached to object that is managed by this class. */
  protected release(): void {}

  /** Decrements the reference counting of this object. When reference counting hits 0, calls {@link #release()}. */
  decRef(): void {
    const rc = --this.refCount;
    if (rc === 0) {
      let success = false;
      try {
        this.release();
        success = true;
      } finally {
        if (!success) {
          // Put reference back on failure
          this.refCount++;
        }
      }
    } else if (rc < 0) {
      throw new IllegalStateException("too many decRef calls: refCount is " + rc + " after decrement");
    }
  }

  /** Returns the managed object */
  get(): T {
    return this.object;
  }

  /** Returns the current reference count. */
  getRefCount(): number {
    return this.refCount;
  }

  /** Increments the reference count. Calls to this method must be matched with calls to {@link #decRef()}. */
  incRef(): void {
    this.refCount++;
  }
}
