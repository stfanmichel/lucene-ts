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

import type { Accountable } from "../util/Accountable.js";
import type { Bits } from "../util/Bits.js";
import { DocIdSetIterator } from "./DocIdSetIterator.js";

/**
 * Port of org.apache.lucene.search.DocIdSet: A DocIdSet contains a set of doc ids. Implementing classes must
 * only implement {@link #iterator} to provide access to the set.
 */
export abstract class DocIdSet implements Accountable {
  /** An empty {@code DocIdSet} instance */
  static readonly EMPTY: DocIdSet = new (class extends DocIdSet {
    iterator(): DocIdSetIterator {
      return DocIdSetIterator.empty();
    }

    override isCacheable(): boolean {
      return true;
    }

    // we explicitly provide no random access, as this filter is 100% sparse and iterator exits faster
    override bits(): Bits | null {
      return null;
    }

    ramBytesUsed(): number {
      return 0;
    }
  })();

  /**
   * Provides a {@link DocIdSetIterator} to access the set. This implementation can return <code>null</code> if
   * there are no docs that match.
   */
  abstract iterator(): DocIdSetIterator | null;

  // TODO: somehow this class should express the cost of iteration vs the cost of random access Bits

  /**
   * Optionally provides a {@link Bits} interface for random access to matching documents.
   * @return {@code null}, if this {@code DocIdSet} does not support random access. In contrast to {@link #iterator()},
   * a return value of {@code null} <b>does not</b> imply that no documents match the filter!
   */
  bits(): Bits | null {
    return null;
  }

  /**
   * This method is a hint for {@link CachingWrapperFilter}, if this <code>DocIdSet</code> should be cached without
   * copying it. The default is to return <code>false</code>.
   */
  isCacheable(): boolean {
    return false;
  }

  abstract ramBytesUsed(): number;

  getChildResources(): readonly Accountable[] {
    return [];
  }
}
