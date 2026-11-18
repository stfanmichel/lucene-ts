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

import { Directory } from "./Directory.js";
import type { IndexInput } from "./IndexInput.js";
import type { IndexOutput } from "./IndexOutput.js";
import type { IOContext } from "./IOContext.js";
import type { Lock } from "./Lock.js";

/**
 * Port of org.apache.lucene.store.FilterDirectory: Directory implementation that delegates calls to another directory.
 * This class can be used to add limitations on top of an existing {@link Directory} implementation such as
 * {@link NRTCachingDirectory} or to add additional sanity checks for tests. However, if you plan to write
 * your own {@link Directory} implementation, you should consider extending directly {@link Directory}
 * or {@link BaseDirectory} rather than try to reuse functionality of existing {@link Directory}s by extending
 * this class.
 * @lucene.internal
 */
export class FilterDirectory extends Directory {
  /** Get the wrapped instance by {@code dir} as long as this reader is an instance of {@link FilterDirectory}. */
  static unwrap(dir: Directory): Directory {
    while (dir instanceof FilterDirectory) {
      dir = dir.in;
    }
    return dir;
  }

  protected readonly in: Directory;

  /** Sole constructor, typically called from sub-classes. */
  protected constructor(in_: Directory) {
    super();
    this.in = in_;
  }

  /** Return the wrapped {@link Directory}. */
  getDelegate(): Directory {
    return this.in;
  }

  listAll(): string[] {
    return this.in.listAll();
  }

  deleteFile(name: string): void {
    this.in.deleteFile(name);
  }

  fileLength(name: string): number {
    return this.in.fileLength(name);
  }

  createOutput(name: string, context: IOContext): IndexOutput {
    return this.in.createOutput(name, context);
  }

  sync(names: Iterable<string>): void {
    this.in.sync(names);
  }

  renameFile(source: string, dest: string): void {
    this.in.renameFile(source, dest);
  }

  openInput(name: string, context: IOContext): IndexInput {
    return this.in.openInput(name, context);
  }

  makeLock(name: string): Lock {
    return this.in.makeLock(name);
  }

  close(): void {
    this.in.close();
  }

  override toString(): string {
    return this.constructor.name + "(" + this.in.toString() + ")";
  }
}
