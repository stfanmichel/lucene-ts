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

import type { BytesRef } from "./BytesRef.js";

/** Port of org.apache.lucene.util.BytesRefIterator: A simple iterator interface for {@link BytesRef} iteration. */
export interface BytesRefIterator {
  /**
   * Increments the iteration to the next {@link BytesRef} in the iterator.
   * Returns the resulting {@link BytesRef} or <code>null</code> if the end of the iterator is reached.
   */
  next(): BytesRef | null;
}

export const BytesRefIterator = {
  /** Singleton BytesRefIterator that iterates over 0 BytesRefs. */
  EMPTY: {
    next(): BytesRef | null {
      return null;
    },
  } as BytesRefIterator,
} as const;
