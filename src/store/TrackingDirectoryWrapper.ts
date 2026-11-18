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
import { FilterDirectory } from "./FilterDirectory.js";
import type { IndexOutput } from "./IndexOutput.js";
import type { IOContext } from "./IOContext.js";

/**
 * Port of org.apache.lucene.store.TrackingDirectoryWrapper: A delegating Directory that records which files
 * were written to and deleted.
 */
export class TrackingDirectoryWrapper extends FilterDirectory {
  private readonly createdFileNames = new Set<string>();

  constructor(in_: Directory) {
    super(in_);
  }

  override deleteFile(name: string): void {
    this.in.deleteFile(name);
    this.createdFileNames.delete(name);
  }

  override createOutput(name: string, context: IOContext): IndexOutput {
    const output = this.in.createOutput(name, context);
    this.createdFileNames.add(name);
    return output;
  }

  override copyFrom(from: Directory, src: string, dest: string, context: IOContext): void {
    this.in.copyFrom(from, src, dest, context);
    this.createdFileNames.add(dest);
  }

  override renameFile(source: string, dest: string): void {
    this.in.renameFile(source, dest);
    this.createdFileNames.add(dest);
    this.createdFileNames.delete(source);
  }

  /** Returns the live set of files created through this wrapper (not a copy, as in Java). */
  getCreatedFiles(): Set<string> {
    return this.createdFileNames;
  }
}
