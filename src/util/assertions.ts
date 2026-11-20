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

import { AssertionError } from "../errors.js";

/**
 * Whether Lucene-style `assert` statements are evaluated.
 *
 * Java disables assertions by default and Lucene's test suite enables them.
 * During the port we keep them on by default so that mistakes surface early;
 * set `LUCENE_ASSERTIONS=0` to turn them off.
 */
export const ASSERTIONS_ENABLED: boolean = process.env["LUCENE_ASSERTIONS"] !== "0";

/**
 * Port of Java's `assert cond : message`. The condition is passed as a
 * function so that expensive checks cost nothing when assertions are off.
 */
export function lassert(check: () => boolean, message?: string): void {
  if (ASSERTIONS_ENABLED && !check()) {
    throw new AssertionError(message); // Java: no message for a bare `assert cond`
  }
}
