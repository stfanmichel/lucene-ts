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

import type { Directory } from "./Directory.js";
import { Lock } from "./Lock.js";
import { LockFactory } from "./LockFactory.js";

class NoLock extends Lock {
  obtain(): boolean {
    return true;
  }

  close(): void {}

  isLocked(): boolean {
    return false;
  }

  override toString(): string {
    return "NoLock";
  }
}

/**
 * Port of org.apache.lucene.store.NoLockFactory: Use this {@link LockFactory} to disable locking entirely.
 * This is a singleton, you have to use {@link NoLockFactory.INSTANCE}.
 *
 * @see LockFactory
 */
export class NoLockFactory extends LockFactory {
  /** The singleton */
  static readonly INSTANCE: NoLockFactory = new NoLockFactory();

  /** @internal */
  static readonly SINGLETON_LOCK: Lock = new NoLock();

  private constructor() {
    super();
  }

  makeLock(_dir: Directory, _lockName: string): Lock {
    return NoLockFactory.SINGLETON_LOCK;
  }
}
