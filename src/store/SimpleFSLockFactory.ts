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

// Port of org.apache.lucene.store.SimpleFSLockFactory (Lucene 5.2.1).
//
// Deviation: the Java class of the lock is the nested SimpleFSLock; `Files.createDirectories`/`createFile`
// come from src/nio/Files.ts. `synchronized` has no meaning on one thread.

import { IOException } from "../errors.js";
import { Files, resolvePath } from "../nio/Files.js";
import type { FSDirectory } from "./FSDirectory.js";
import { FSLockFactory } from "./FSLockFactory.js";
import { Lock } from "./Lock.js";
import { LockObtainFailedException } from "./LockObtainFailedException.js";
import { LockReleaseFailedException } from "./LockReleaseFailedException.js";

/**
 * <p>Implements {@link LockFactory} using {@link Files#createFile}.</p>
 *
 * <p>The main downside with using this API for locking is
 * that the Lock file may stick around when the JVM
 * exits abnormally.</p>
 * (see the Java documentation for the full discussion)
 *
 * @see LockFactory
 */
export class SimpleFSLockFactory extends FSLockFactory {
  /** Singleton instance */
  static readonly INSTANCE: SimpleFSLockFactory = new SimpleFSLockFactory();

  private constructor() {
    super();
  }

  protected override makeFSLock(dir: FSDirectory, lockName: string): Lock {
    return new SimpleFSLock(dir.getDirectory(), lockName);
  }
}

/** @internal */
export class SimpleFSLock extends Lock {
  lockFile: string;
  lockDir: string;
  obtained = false;

  constructor(lockDir: string, lockFileName: string) {
    super();
    this.lockDir = lockDir;
    this.lockFile = resolvePath(lockDir, lockFileName);
  }

  override obtain(): boolean {
    if (this.obtained) {
      // our instance is already locked
      throw new LockObtainFailedException("this lock instance was already obtained");
    }
    try {
      Files.createDirectories(this.lockDir);
      Files.createFile(this.lockFile);
      this.obtained = true;
    } catch (ioe) {
      // On Windows, on concurrent createNewFile, can get "Access Denied" IOException
      // Fall through to failureReason; but rethrow what isn't an IOException (Java only catches IOException)
      if (!(ioe instanceof IOException)) throw ioe;
      this.failureReason = ioe;
    }
    return this.obtained;
  }

  override close(): void {
    // release the lock if it was obtained; never touch a file we did not create
    if (this.obtained) {
      try {
        Files.deleteIfExists(this.lockFile);
      } catch (cause) {
        throw new LockReleaseFailedException("failed to delete " + this.lockFile, cause);
      } finally {
        this.obtained = false;
      }
    }
  }

  override isLocked(): boolean {
    return Files.exists(this.lockFile);
  }

  override toString(): string {
    return "SimpleFSLock@" + this.lockFile;
  }
}
