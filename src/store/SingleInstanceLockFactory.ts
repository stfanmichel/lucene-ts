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

import { LockObtainFailedException } from "./LockObtainFailedException.js";
import type { Directory } from "./Directory.js";
import { Lock } from "./Lock.js";
import { LockFactory } from "./LockFactory.js";

class SingleInstanceLock extends Lock {
  private readonly lockName: string;
  private readonly locks: Set<string>;
  private obtained = false;

  constructor(locks: Set<string>, lockName: string) {
    super();
    this.locks = locks;
    this.lockName = lockName;
  }

  obtain(): boolean {
    if (this.obtained) {
      // this is not forbidden as per the Lock contract
      throw new LockObtainFailedException("this lock instance was already obtained");
    }
    this.obtained = !this.locks.has(this.lockName);
    if (this.obtained) this.locks.add(this.lockName); // HashSet.add returns false if already present
    return this.obtained;
  }

  close(): void {
    if (this.obtained) {
      this.locks.delete(this.lockName);
      this.obtained = false;
    }
  }

  isLocked(): boolean {
    return this.locks.has(this.lockName);
  }

  override toString(): string {
    return super.toString() + ": " + this.lockName;
  }
}

/**
 * Port of org.apache.lucene.store.SingleInstanceLockFactory: Implements {@link LockFactory} for a single
 * in-process instance, meaning all locking will take place through this one instance.
 * Only use this {@link LockFactory} when you are certain all
 * IndexWriters for a given index are running against a single shared in-process
 * Directory instance.  This is currently the default locking for RAMDirectory.
 *
 * @see LockFactory
 */
export class SingleInstanceLockFactory extends LockFactory {
  private readonly locks = new Set<string>();

  makeLock(_dir: Directory, lockName: string): Lock {
    return new SingleInstanceLock(this.locks, lockName);
  }
}
