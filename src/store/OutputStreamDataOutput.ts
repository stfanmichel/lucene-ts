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

// Port of org.apache.lucene.store.OutputStreamDataOutput (Lucene 5.2.1).

import type { Closeable } from "../io/Closeable.js";
import type { OutputStream } from "../io/OutputStream.js";
import { DataOutput } from "./DataOutput.js";

/**
 * A {@link DataOutput} wrapping a plain {@link OutputStream}.
 */
export class OutputStreamDataOutput extends DataOutput implements Closeable {
  private readonly os: OutputStream;

  constructor(os: OutputStream) {
    super();
    this.os = os;
  }

  writeByte(b: number): void {
    this.os.write(b);
  }

  writeBytes(b: Uint8Array, offset: number, length: number): void {
    this.os.write(b, offset, length);
  }

  close(): void {
    this.os.close();
  }
}
