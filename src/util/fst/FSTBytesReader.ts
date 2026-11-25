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

// Port of org.apache.lucene.util.fst.FST.BytesReader (Lucene 5.2.1). Lives in its own file (FST.BytesReader in Java)
// so that BytesStore and the concrete readers do not import FST (import cycle); FST.ts exposes it as FST.BytesReader.

import { DataInput } from "../../store/DataInput.js";

/** Reads bytes stored in an FST. */
export abstract class FSTBytesReader extends DataInput {
  /** Get current read position. */
  abstract getPosition(): number;

  /** Set current read position. */
  abstract setPosition(pos: number): void;

  /** Returns true if this reader uses reversed bytes under-the-hood. */
  abstract reversed(): boolean;
}
