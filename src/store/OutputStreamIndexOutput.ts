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

import { BufferedOutputStream } from "../io/BufferedOutputStream.js";
import type { OutputStream } from "../io/OutputStream.js";
import { tryWithResource } from "../util/JavaObjects.js";
import { CheckedOutputStream } from "../zip/CheckedOutputStream.js";
import { CRC32 } from "../zip/CRC32.js";
import { IndexOutput } from "./IndexOutput.js";

/**
 * Implementation class for buffered {@link IndexOutput} that writes to an {@link OutputStream}.
 */
export class OutputStreamIndexOutput extends IndexOutput {
  private readonly crc = new CRC32();
  private readonly os: BufferedOutputStream;

  private bytesWritten = 0;
  private flushedOnClose = false;

  /**
   * Creates a new {@link OutputStreamIndexOutput} with the given buffer size.
   * @param bufferSize the buffer size in bytes used to buffer writes internally.
   * @throws IllegalArgumentException if the given buffer size is less or equal to <tt>0</tt>
   */
  constructor(resourceDescription: string, out: OutputStream, bufferSize: number) {
    super(resourceDescription);
    this.os = new BufferedOutputStream(new CheckedOutputStream(out, this.crc), bufferSize);
  }

  // Java: final
  writeByte(b: number): void {
    this.os.write(b);
    this.bytesWritten++;
  }

  // Java: final
  writeBytes(b: Uint8Array, offset: number, length: number): void {
    this.os.write(b, offset, length);
    this.bytesWritten += length;
  }

  close(): void {
    tryWithResource(this.os, () => {
      if (!this.flushedOnClose) {
        this.flushedOnClose = true; // set this BEFORE calling flush!
        this.os.flush();
      }
    });
  }

  // Java: final
  getFilePointer(): number {
    return this.bytesWritten;
  }

  // Java: final
  getChecksum(): bigint {
    this.os.flush();
    return this.crc.getValue();
  }
}
