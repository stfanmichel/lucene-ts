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
 * The few java.lang.StringBuilder methods the port needs. Numbers are appended like Java's append(int)
 * (decimal), bigint like append(long), booleans as "true"/"false", `null` as "null".
 */
export class StringBuilder {
  private s: string;

  constructor(init: string = "") {
    this.s = init;
  }

  append(x: string | number | bigint | boolean | null): this {
    this.s += x === null ? "null" : String(x);
    return this;
  }

  /** StringBuilder.length(): UTF-16 code units */
  length(): number {
    return this.s.length;
  }

  /** StringBuilder.setLength(n): truncates, or pads with NUL characters */
  setLength(n: number): void {
    this.s = n <= this.s.length ? this.s.slice(0, n) : this.s + "\0".repeat(n - this.s.length);
  }

  toString(): string {
    return this.s;
  }
}
