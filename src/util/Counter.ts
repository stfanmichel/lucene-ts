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

/**
 * Port of org.apache.lucene.util.Counter: Simple counter class. Counts are bytes/sizes, so they are JS numbers
 * (exact up to 2^53) rather than bigint.
 */
export abstract class Counter {
  /** Adds the given delta to the counters current value */
  abstract addAndGet(delta: number): number;

  /** Returns the counters current value */
  abstract get(): number;

  /** Returns a new counter. The returned counter is not thread-safe. */
  static newCounter(threadSafe: boolean = false): Counter {
    // Single-threaded port: both variants behave the same.
    return threadSafe ? new AtomicCounter() : new SerialCounter();
  }
}

class SerialCounter extends Counter {
  private count = 0;

  addAndGet(delta: number): number {
    return (this.count += delta);
  }

  get(): number {
    return this.count;
  }
}

class AtomicCounter extends Counter {
  private count = 0;

  addAndGet(delta: number): number {
    return (this.count += delta);
  }

  get(): number {
    return this.count;
  }
}
