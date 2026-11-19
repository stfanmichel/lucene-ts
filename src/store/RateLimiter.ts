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

// Port of org.apache.lucene.store.RateLimiter (+ RateLimiter.SimpleRateLimiter, exported as SimpleRateLimiter).
// System.nanoTime() is process.hrtime (nanoseconds, kept as a bigint so that the 64-bit arithmetic wraps like
// Java's); Thread.sleep(ms, ns) blocks the thread.

import { doubleToLong } from "../util/JavaNumbers.js";
import { sleepSync } from "../util/JavaObjects.js";

const NANO_ORIGIN = process.hrtime.bigint() - 1_000_000_000_000n;
const nanoTime = (): bigint => process.hrtime.bigint() - NANO_ORIGIN;

/** Abstract base class to rate limit IO.  Typically implementations are shared across multiple IndexInputs or IndexOutputs (for example those involved all merging).  Those IndexInputs and IndexOutputs would call {@link pause} whenever they have read or written more than {@link getMinPauseCheckBytes} bytes. */
export abstract class RateLimiter {
  /** Sets an updated MB per second rate limit. */
  abstract setMBPerSec(mbPerSec: number): void;

  /** The current MB per second rate limit. */
  abstract getMBPerSec(): number;

  /**
   * Pauses, if necessary, to keep the instantaneous IO
   * rate at or below the target.
   * <p>
   * Note: the implementation is thread-safe
   * </p>
   * @return the pause time in nano seconds
   */
  abstract pause(bytes: number): number;

  /** How many bytes caller should add up itself before invoking {@link pause}. */
  abstract getMinPauseCheckBytes(): number;
}

/**
 * Simple class to rate limit IO.
 */
export class SimpleRateLimiter extends RateLimiter {
  private static readonly MIN_PAUSE_CHECK_MSEC = 5;

  private mbPerSec = 0;
  private minPauseCheckBytes = 0;

  private lastNS: bigint;

  // TODO: we could also allow eg a sub class to dynamically
  // determine the allowed rate, eg if an app wants to
  // change the allowed rate over time or something

  /** mbPerSec is the MB/sec max IO rate */
  constructor(mbPerSec: number) {
    super();
    this.setMBPerSec(mbPerSec);
    this.lastNS = nanoTime();
  }

  /**
   * Sets an updated mb per second rate limit.
   */
  setMBPerSec(mbPerSec: number): void {
    this.mbPerSec = mbPerSec;
    this.minPauseCheckBytes = Number(
      doubleToLong((SimpleRateLimiter.MIN_PAUSE_CHECK_MSEC / 1000.0) * mbPerSec * 1024 * 1024),
    );
  }

  getMinPauseCheckBytes(): number {
    return this.minPauseCheckBytes;
  }

  /**
   * The current mb per second rate limit.
   */
  getMBPerSec(): number {
    return this.mbPerSec;
  }

  /** Pauses, if necessary, to keep the instantaneous IO rate at or below the target. Be sure to only call
   *  this method when bytes &gt; {@link getMinPauseCheckBytes}, otherwise it will pause way too long!
   *
   *  @return the pause time in nano seconds */
  pause(bytes: number): number {
    const startNS = nanoTime();

    const secondsToPause = (bytes / 1024 / 1024) / this.mbPerSec;

    // Time we should sleep until; this is purely instantaneous
    // rate (just adds seconds onto the last time we had paused to);
    // maybe we should also offer decayed recent history one?
    const targetNS = BigInt.asIntN(64, this.lastNS + doubleToLong(1000000000 * secondsToPause));

    if (startNS >= targetNS) {
      // OK, current time is already beyond the target sleep time,
      // no pausing to do.

      // Set to startNS, not targetNS, to enforce the instant rate, not
      // the "averaged over all history" rate:
      this.lastNS = startNS;
      return 0;
    }

    this.lastNS = targetNS;

    let curNS = startNS;

    // While loop because Thread.sleep doesn't always sleep
    // enough:
    while (true) {
      const pauseNS = targetNS - curNS;
      if (pauseNS > 0n) {
        let sleepMS: number;
        let sleepNS: number;
        // Thread.sleep(ms, ns) takes an int ms: cap it as Java does
        if (pauseNS > 100000n * 2147483647n) {
          sleepMS = 2147483647;
          sleepNS = 0;
        } else {
          sleepMS = Number(pauseNS / 1000000n);
          sleepNS = Number(pauseNS % 1000000n);
        }
        sleepSync(sleepMS + sleepNS / 1e6);
        curNS = nanoTime();
        continue;
      }
      break;
    }

    return Number(curNS - startNS);
  }
}
