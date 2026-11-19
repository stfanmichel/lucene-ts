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

import { IndexOutput } from "./IndexOutput.js";
import type { RateLimiter } from "./RateLimiter.js";

/**
 * A {@link RateLimiter rate limiting} {@link IndexOutput}
 *
 * @lucene.internal
 */
export class RateLimitedIndexOutput extends IndexOutput {
  private readonly delegate: IndexOutput;
  private readonly rateLimiter: RateLimiter;

  /** How many bytes we've written since we last called rateLimiter.pause. */
  private bytesSinceLastPause = 0;

  /** Cached here not not always have to call RateLimiter#getMinPauseCheckBytes()
   * which does volatile read. */
  private currentMinPauseCheckBytes: number;

  constructor(rateLimiter: RateLimiter, delegate: IndexOutput) {
    super("RateLimitedIndexOutput(" + delegate + ")");
    this.delegate = delegate;
    this.rateLimiter = rateLimiter;
    this.currentMinPauseCheckBytes = rateLimiter.getMinPauseCheckBytes();
  }

  close(): void {
    this.delegate.close();
  }

  getFilePointer(): number {
    return this.delegate.getFilePointer();
  }

  getChecksum(): bigint {
    return this.delegate.getChecksum();
  }

  writeByte(b: number): void {
    this.bytesSinceLastPause++;
    this.checkRate();
    this.delegate.writeByte(b);
  }

  writeBytes(b: Uint8Array, offset: number, length: number): void {
    this.bytesSinceLastPause += length;
    this.checkRate();
    this.delegate.writeBytes(b, offset, length);
  }

  private checkRate(): void {
    if (this.bytesSinceLastPause > this.currentMinPauseCheckBytes) {
      this.rateLimiter.pause(this.bytesSinceLastPause);
      this.bytesSinceLastPause = 0;
      this.currentMinPauseCheckBytes = this.rateLimiter.getMinPauseCheckBytes();
    }
  }
}
