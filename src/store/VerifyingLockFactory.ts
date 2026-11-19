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

// Port of org.apache.lucene.store.VerifyingLockFactory (Lucene 5.2.1).

import { IllegalStateException, IOException } from "../errors.js";
import { lassert } from "../util/assertions.js";
import type { InputStream } from "../io/InputStream.js";
import type { OutputStream } from "../io/OutputStream.js";
import type { Directory } from "./Directory.js";
import { Lock } from "./Lock.js";
import { LockFactory } from "./LockFactory.js";

/**
 * A {@link LockFactory} that wraps another {@link LockFactory} and verifies that each lock obtain/release
 * is "correct" (never results in two processes holding the lock at the same time).  It does this by
 * contacting an external server ({@link LockVerifyServer}) to assert that at most one process holds the
 * lock at a time.  To use this, you should also run {@link LockVerifyServer} on the host &amp; port
 * matching what you pass to the constructor.
 *
 * (LockVerifyServer and LockStressTest, the socket-based command line tools, are not ported.)
 *
 * @see LockVerifyServer
 * @see LockStressTest
 */
export class VerifyingLockFactory extends LockFactory {
  readonly lf: LockFactory;
  readonly in: InputStream;
  readonly out: OutputStream;

  /**
   * @param lf the LockFactory that we are testing
   * @param in the stream to read the lock server's answers from
   * @param out the stream to write the lock events to
   */
  constructor(lf: LockFactory, input: InputStream, out: OutputStream) {
    super();
    this.lf = lf;
    this.in = input;
    this.out = out;
  }

  override makeLock(dir: Directory, lockName: string): Lock {
    return new CheckedLock(this, this.lf.makeLock(dir, lockName));
  }
}

class CheckedLock extends Lock {
  private readonly lock: Lock;
  private obtained = false;
  private readonly factory: VerifyingLockFactory;

  constructor(factory: VerifyingLockFactory, lock: Lock) {
    super();
    this.factory = factory;
    this.lock = lock;
  }

  private verify(message: number): void {
    this.factory.out.write(message);
    this.factory.out.flush();
    const ret = this.factory.in.read();
    if (ret < 0) {
      throw new IllegalStateException("Lock server died because of locking error.");
    }
    if (ret !== message) {
      throw new IOException("Protocol violation.");
    }
  }

  override obtain(): boolean {
    this.obtained = this.lock.obtain();
    if (this.obtained) {
      this.verify(1);
    }
    return this.obtained;
  }

  override isLocked(): boolean {
    return this.lock.isLocked();
  }

  override close(): void {
    if (this.obtained) {
      lassert(() => this.isLocked());
      this.verify(0);
    }
    this.lock.close();
  }
}
