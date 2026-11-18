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

// Port of org.apache.lucene.store.Lock (Lucene 5.2.1).
//
// Deviations: the Java overloads obtain() / obtain(long lockWaitTimeout) cannot share a name in
// TypeScript (subclasses implement the first), so the timed one is called obtainWait(lockWaitTimeout).
// The nested class Lock.With is also exported as LockWith; doBody() is generic instead of returning Object.
// Thread.sleep blocks the thread (Atomics.wait).

import { IllegalArgumentException } from "../errors.js";
import type { Closeable } from "../io/Closeable.js";
import { sleepSync, objectToString } from "../util/JavaObjects.js";
import { LockObtainFailedException } from "./LockObtainFailedException.js";

/**
 * Utility class for executing code with exclusive access.
 */
export abstract class LockWith<T> {
  private readonly lock: Lock;
  private readonly lockWaitTimeout: number;

  /** Constructs an executor that will grab the named lock. */
  constructor(lock: Lock, lockWaitTimeout: number) {
    this.lock = lock;
    this.lockWaitTimeout = lockWaitTimeout;
  }

  /**
   * Code to execute with exclusive access.
   */
  protected abstract doBody(): T;

  /**
   * Calls {@link doBody} while <i>lock</i> is obtained.  Blocks if lock
   * cannot be obtained immediately.  Retries to obtain lock once per second
   * until it is obtained, or until it has tried ten times. Lock is released when
   * {@link doBody} exits.
   * @throws LockObtainFailedException if lock could not be obtained
   * @throws IOException if {@link Lock.obtain} throws IOException
   */
  run(): T {
    let locked = false;
    try {
      locked = this.lock.obtainWait(this.lockWaitTimeout);
      return this.doBody();
    } finally {
      if (locked) {
        this.lock.close();
      }
    }
  }
}

/**
 * An interprocess mutex lock.
 * <p>Typical use might look like:<pre class="prettyprint">
 *   new Lock.With(directory.makeLock("my.lock")) {
 *     public Object doBody() {
 *       <i>... code to execute while locked ...</i>
 *     }
 *   }.run();
 * </pre>
 *
 * @see Directory.makeLock
 */
export abstract class Lock implements Closeable {
  /** How long {@link obtainWait} waits, in milliseconds, in between attempts to acquire the lock. */
  static LOCK_POLL_INTERVAL = 1000;

  /**
   * Pass this value to {@link obtainWait} to try
   * forever to obtain the lock.
   */
  static readonly LOCK_OBTAIN_WAIT_FOREVER = -1;

  /** Java: Lock.With */
  static readonly With = LockWith;

  /**
   * Attempts to obtain exclusive access and immediately return
   * upon success or failure.  Use {@link close} to
   * release the lock.
   * @return true iff exclusive access is obtained
   */
  abstract obtain(): boolean;

  /**
   * If a lock obtain called, this failureReason may be set
   * with the "root cause" Exception as to why the lock was
   * not obtained.
   */
  protected failureReason: unknown = null;

  /**
   * Attempts to obtain an exclusive lock within amount of
   * time given. Polls once per {@link LOCK_POLL_INTERVAL}
   * (currently 1000) milliseconds until lockWaitTimeout is
   * passed.
   * (Java: Lock.obtain(long lockWaitTimeout))
   * @param lockWaitTimeout length of time to wait in
   *        milliseconds or {@link LOCK_OBTAIN_WAIT_FOREVER}
   *        to retry forever
   * @return true if lock was obtained
   * @throws LockObtainFailedException if lock wait times out
   * @throws IllegalArgumentException if lockWaitTimeout is
   *         out of bounds
   * @throws IOException if obtain() throws IOException
   */
  obtainWait(lockWaitTimeout: number): boolean {
    this.failureReason = null;
    let locked = this.obtain();
    if (lockWaitTimeout < 0 && lockWaitTimeout !== Lock.LOCK_OBTAIN_WAIT_FOREVER)
      throw new IllegalArgumentException(
        "lockWaitTimeout should be LOCK_OBTAIN_WAIT_FOREVER or a non-negative number (got " + lockWaitTimeout + ")");

    const maxSleepCount = Math.trunc(lockWaitTimeout / Lock.LOCK_POLL_INTERVAL);
    let sleepCount = 0;
    while (!locked) {
      if (lockWaitTimeout !== Lock.LOCK_OBTAIN_WAIT_FOREVER && sleepCount++ >= maxSleepCount) {
        let reason = "Lock obtain timed out: " + this.toString();
        if (this.failureReason !== null) {
          reason += ": " + String(this.failureReason);
        }
        throw new LockObtainFailedException(reason, this.failureReason);
      }
      sleepSync(Lock.LOCK_POLL_INTERVAL);
      locked = this.obtain();
    }
    return locked;
  }

  /**
   * Releases exclusive access. Note that exceptions thrown
   * from close may require human intervention, as it may mean the
   * lock was no longer valid, or that fs permissions prevent
   * removal of the lock file, or other reasons.
   *
   * @throws LockReleaseFailedException (optional specific exception) if
   *         the lock could not be properly released.
   */
  abstract close(): void;

  /**
   * Returns true if the resource is currently locked.  Note that one must
   * still call {@link obtain} before using the resource.
   */
  abstract isLocked(): boolean;

  toString(): string {
    return objectToString(this);
  }
}
