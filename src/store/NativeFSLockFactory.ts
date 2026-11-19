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

// Port of org.apache.lucene.store.NativeFSLockFactory (Lucene 5.2.1).
//
// Deviation: Node has no OS-level file locks, so the "native" lock only excludes other lock instances of the
// same process: the static LOCK_HELD set (as in Java) plus FileChannel.tryLock's in-process table. Another
// process holding the same lock file is NOT detected (see src/nio/FileChannel.ts).

import { IOException, OverlappingFileLockException } from "../errors.js";
import { FileChannel, type FileLock } from "../nio/FileChannel.js";
import { Files, resolvePath } from "../nio/Files.js";
import { lassert } from "../util/assertions.js";
import { IOUtils } from "../util/IOUtils.js";
import type { FSDirectory } from "./FSDirectory.js";
import { FSLockFactory } from "./FSLockFactory.js";
import { Lock } from "./Lock.js";
import { LockObtainFailedException } from "./LockObtainFailedException.js";

/**
 * <p>Implements {@link LockFactory} using native OS file
 * locks (here: in-process only, see the file header).
 * (Java documentation continues.)
 *
 * @see LockFactory
 */
export class NativeFSLockFactory extends FSLockFactory {
  /** Singleton instance */
  static readonly INSTANCE: NativeFSLockFactory = new NativeFSLockFactory();

  private constructor() {
    super();
  }

  protected override makeFSLock(dir: FSDirectory, lockName: string): Lock {
    return new NativeFSLock(dir.getDirectory(), lockName);
  }
}
FSLockFactory._default = NativeFSLockFactory.INSTANCE;

/** @internal */
export class NativeFSLock extends Lock {
  private readonly path: string;
  private readonly lockDir: string;
  private static readonly LOCK_HELD = new Set<string>();

  private channel: FileChannel | null = null; // set when we have the lock
  private lockHandle: FileLock | null = null;
  private realPath: string | null = null; // unconditionally set in obtain(), for use in close()

  constructor(lockDir: string, lockFileName: string) {
    super();
    this.lockDir = lockDir;
    this.path = resolvePath(lockDir, lockFileName);
  }

  override obtain(): boolean {
    if (this.channel !== null) {
      // Our instance is already locked:
      lassert(() => this.channel!.isOpen());
      lassert(() => this.realPath !== null);
      throw new LockObtainFailedException("this lock instance was already obtained");
    }

    // Ensure that lockDir exists and is a directory.
    Files.createDirectories(this.lockDir);
    try {
      Files.createFile(this.path);
    } catch (ignore) {
      // we must create the file to have a truly canonical path.
      // if it's already created, we don't care. if it cant be created, it will fail below.
      if (!(ignore instanceof IOException)) throw ignore;
    }
    // fails if the lock file does not exist
    const realPath = Files.toRealPath(this.path);
    this.realPath = realPath;

    // used as a best-effort check, to see if the underlying file has changed
    let obtained = false;
    if (NativeFSLock.addToLockHeld(realPath)) {
      let ch: FileChannel | null = null;
      try {
        ch = FileChannel.open(realPath, "CREATE", "WRITE");
        try {
          const lock = ch.tryLock();
          if (lock !== null) {
            this.channel = ch;
            this.lockHandle = lock;
            obtained = true;
          }
        } catch (e) {
          if (!(e instanceof IOException) && !(e instanceof OverlappingFileLockException)) throw e;
          // free the channel; failureReason shows why it was not obtained
          this.failureReason = e;
        }
      } finally {
        if (!obtained) {
          // not successful - clear up and move out
          IOUtils.closeWhileHandlingException(ch);
          NativeFSLock.clearLockHeld(realPath); // clear LOCK_HELD last
        }
      }
    }
    return obtained;
  }

  /** Set.add of Java: true if the path was not yet in LOCK_HELD */
  private static addToLockHeld(path: string): boolean {
    if (NativeFSLock.LOCK_HELD.has(path)) return false;
    NativeFSLock.LOCK_HELD.add(path);
    return true;
  }

  override close(): void {
    if (this.channel !== null) {
      try {
        IOUtils.close(this.channel);
      } finally {
        this.channel = null;
        this.lockHandle = null;
        NativeFSLock.clearLockHeld(this.realPath!); // clear LOCK_HELD last
      }
    }
  }

  private static clearLockHeld(path: string): void {
    const remove = NativeFSLock.LOCK_HELD.delete(path);
    lassert(() => remove, "Lock was cleared but never marked as held");
  }

  override isLocked(): boolean {
    // The test for is isLocked is not directly possible with native file locks:

    // First a shortcut, if a lock reference in this instance is available
    if (this.channel !== null) return true;

    // Look if lock file is definitely not present; if not, there can definitely be no lock!
    if (Files.notExists(this.path)) return false;

    // Try to obtain and release (if was locked) the lock
    try {
      const obtained = this.obtain();
      if (obtained) this.close();
      return !obtained;
    } catch (ioe) {
      if (!(ioe instanceof IOException)) throw ioe;
      return false;
    }
  }

  override toString(): string {
    return "NativeFSLock@" + this.path;
  }
}
