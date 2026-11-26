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

// Port of org.apache.lucene.index.IndexOptions (Lucene 5.2.1). A numeric enum so that the Java ordinal comparisons
// (compareTo) are plain comparisons; use IndexOptions[x] for the Java name().

/** Controls how much information is stored in the postings lists. */
export enum IndexOptions {
  /** Not indexed */
  NONE,

  /** Only documents are indexed: term frequencies and positions are omitted. */
  DOCS,

  /** Only documents and term frequencies are indexed: positions are omitted. */
  DOCS_AND_FREQS,

  /** Indexes documents, frequencies and positions. */
  DOCS_AND_FREQS_AND_POSITIONS,

  /** Indexes documents, frequencies, positions and offsets. */
  DOCS_AND_FREQS_AND_POSITIONS_AND_OFFSETS,
}
