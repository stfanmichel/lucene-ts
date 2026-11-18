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

import { NullPointerException } from "../errors.js";
import { AlreadyClosedException } from "./AlreadyClosedException.js";
import { Directory } from "./Directory.js";
import type { Lock } from "./Lock.js";
import type { LockFactory } from "./LockFactory.js";

/**
 * Port of org.apache.lucene.store.BaseDirectory: Base implementation for a concrete {@link Directory}
 * that uses a {@link LockFactory} for locking.
 * @lucene.experimental
 */
export abstract class BaseDirectory extends Directory {
  protected isOpen = true;

  /** Holds the LockFactory instance (implements locking for this Directory instance). */
  protected readonly lockFactory: LockFactory;

  /**
   * Sole constructor.
   * @throws NullPointerException if lockFactory is null (as in Java)
   */
  protected constructor(lockFactory: LockFactory) {
    super();
    if (lockFactory === null || lockFactory === undefined) {
      throw new NullPointerException("LockFactory cannot be null, use an explicit instance!");
    }
    this.lockFactory = lockFactory;
  }

  // Java: final
  makeLock(name: string): Lock {
    return this.lockFactory.makeLock(this, name);
  }

  // Java: final
  protected override ensureOpen(): void {
    if (!this.isOpen) throw new AlreadyClosedException("this Directory is closed");
  }

  override toString(): string {
    return super.toString() + " lockFactory=" + this.lockFactory.toString();
  }
}
