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

// BulkOperation.of(format, bitsPerValue) of org.apache.lucene.util.packed.BulkOperation (Lucene 5.2.1), see
// BulkOperation.ts. All the operations are created lazily and cached (Java builds the whole table at class load).

import { AssertionError } from "../../errors.js";
import { lassert } from "../assertions.js";
import type { BulkOperation } from "./BulkOperation.js";
import { BulkOperationPacked } from "./BulkOperationPacked.js";
import { BulkOperationPackedSingleBlock } from "./BulkOperationPackedSingleBlock.js";
import { PackedIntsFormat, SINGLE_BLOCK_SUPPORTED_BITS_PER_VALUE } from "./PackedIntsBase.js";

const packedBulkOps: (BulkOperation | undefined)[] = new Array(64).fill(undefined);
// NOTE: this is sparse (some entries are undefined, as Java's are null):
const packedSingleBlockBulkOps: (BulkOperation | undefined)[] = new Array(32).fill(undefined);

/** BulkOperation.of */
export function bulkOperationOf(format: PackedIntsFormat, bitsPerValue: number): BulkOperation {
  switch (format) {
    case PackedIntsFormat.PACKED:
      lassert(() => bitsPerValue >= 1 && bitsPerValue <= 64);
      return (packedBulkOps[bitsPerValue - 1] ??= new BulkOperationPacked(bitsPerValue));
    case PackedIntsFormat.PACKED_SINGLE_BLOCK:
      lassert(() => SINGLE_BLOCK_SUPPORTED_BITS_PER_VALUE.includes(bitsPerValue));
      return (packedSingleBlockBulkOps[bitsPerValue - 1] ??= new BulkOperationPackedSingleBlock(bitsPerValue));
    default:
      throw new AssertionError();
  }
}
