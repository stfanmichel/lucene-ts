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

// Port of org.apache.lucene.store.FSLockFactory (Lucene 5.2.1).
//
// Deviation (ES module cycles): getDefault() returns the instance that NativeFSLockFactory registers when its
// module is loaded (src/index.ts, SimpleFSDirectory, NIOFSDirectory and MMapDirectory all load it). `dir instanceof
// FSDirectory` is a real instanceof; the FSDirectory ↔ FSLockFactory import cycle is harmless since neither
// module uses the other at load time.

import { UnsupportedOperationException } from "../errors.js";
import { IllegalStateException } from "../errors.js";
import { FSDirectory } from "./FSDirectory.js";
import type { Directory } from "./Directory.js";
import { Lock } from "./Lock.js";
import { LockFactory } from "./LockFactory.js";

/**
 * Base class for file system based locking implementation.
 * This class is explicitly checking that the passed {@link Directory}
 * is an {@link FSDirectory}.
 */
export abstract class FSLockFactory extends LockFactory {
  /** @internal set by NativeFSLockFactory when it is loaded */
  static _default: FSLockFactory | null = null;

  /**
   * Returns the default locking implementation for this platform.
   * This method currently returns always {@link NativeFSLockFactory}.
   */
  static getDefault(): FSLockFactory {
    if (FSLockFactory._default === null) {
      throw new IllegalStateException("NativeFSLockFactory is not loaded: import it (or src/index.ts) first");
    }
    return FSLockFactory._default;
  }

  // Java: final
  override makeLock(dir: Directory, lockName: string): Lock {
    if (!(dir instanceof FSDirectory)) {
      throw new UnsupportedOperationException(this.constructor.name + " can only be used with FSDirectory subclasses, got: " + dir);
    }
    return this.makeFSLock(dir, lockName);
  }

  /** Implement this method to create a lock for a FSDirectory instance. */
  protected abstract makeFSLock(dir: FSDirectory, lockName: string): Lock;
}
