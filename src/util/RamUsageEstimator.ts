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

// Partial port of org.apache.lucene.util.RamUsageEstimator (Lucene 5.2.1).
//
// Only the size constants are ported (they drive ArrayUtil.oversize). The Java
// class measures them from the running JVM; here they are fixed to what a
// 64-bit HotSpot JVM with compressed object references reports, which is also
// what the golden tests are generated with (java -XX:+UseCompressedOops).
// sizeOf(), shallowSizeOf() and friends are not ported yet.

export const RamUsageEstimator = {
  NUM_BYTES_BOOLEAN: 1,
  NUM_BYTES_BYTE: 1,
  NUM_BYTES_CHAR: 2,
  NUM_BYTES_SHORT: 2,
  NUM_BYTES_INT: 4,
  NUM_BYTES_FLOAT: 4,
  NUM_BYTES_LONG: 8,
  NUM_BYTES_DOUBLE: 8,

  COMPRESSED_REFS_ENABLED: true,
  NUM_BYTES_OBJECT_REF: 4,
  NUM_BYTES_OBJECT_HEADER: 12,
  /** object header + int length, aligned to the object alignment (8) */
  NUM_BYTES_ARRAY_HEADER: 16,
  NUM_BYTES_OBJECT_ALIGNMENT: 8,
} as const;
