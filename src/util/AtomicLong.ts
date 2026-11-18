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
 * java.util.concurrent.atomic.AtomicLong, for the single-threaded port. Like every Java long that counts
 * bytes or items, the value is a `number` (exact up to 2^53) rather than a bigint.
 */
export class AtomicLong {
  private value: number;

  constructor(initialValue = 0) {
    this.value = initialValue;
  }
  get(): number {
    return this.value;
  }
  set(newValue: number): void {
    this.value = newValue;
  }
  getAndSet(newValue: number): number {
    const old = this.value;
    this.value = newValue;
    return old;
  }
  addAndGet(delta: number): number {
    this.value += delta;
    return this.value;
  }
  getAndAdd(delta: number): number {
    const old = this.value;
    this.value += delta;
    return old;
  }
  incrementAndGet(): number {
    return this.addAndGet(1);
  }
  decrementAndGet(): number {
    return this.addAndGet(-1);
  }
  getAndIncrement(): number {
    return this.getAndAdd(1);
  }
  getAndDecrement(): number {
    return this.getAndAdd(-1);
  }
  compareAndSet(expect: number, update: number): boolean {
    if (this.value === expect) {
      this.value = update;
      return true;
    }
    return false;
  }
  toString(): string {
    return String(this.value);
  }
}
