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

// Port of org.apache.lucene.store.FileSwitchDirectory. listAll() returns the names in java.util.HashSet
// iteration order (see javaHashOrder).

import { AtomicMoveNotSupportedException, NoSuchFileException } from "../errors.js";
import { IOUtils } from "../util/IOUtils.js";
import { javaHashOrder } from "../util/JavaCollections.js";
import { Directory } from "./Directory.js";
import type { IndexInput } from "./IndexInput.js";
import type { IndexOutput } from "./IndexOutput.js";
import type { IOContext } from "./IOContext.js";
import type { Lock } from "./Lock.js";

/**
 * Expert: A Directory instance that switches files between
 * two other Directory instances.
 *
 * <p>Files with the specified extensions are placed in the
 * primary directory; others are placed in the secondary
 * directory.  The provided Set must not change once passed
 * to this class, and must allow multiple threads to call
 * contains at once.</p>
 *
 * @lucene.experimental
 */
export class FileSwitchDirectory extends Directory {
  private readonly secondaryDir: Directory;
  private readonly primaryDir: Directory;
  private readonly primaryExtensions: ReadonlySet<string>;
  private doClose: boolean;

  constructor(primaryExtensions: ReadonlySet<string>, primaryDir: Directory, secondaryDir: Directory, doClose: boolean) {
    super();
    this.primaryExtensions = primaryExtensions;
    this.primaryDir = primaryDir;
    this.secondaryDir = secondaryDir;
    this.doClose = doClose;
  }

  /** Return the primary directory */
  getPrimaryDir(): Directory {
    return this.primaryDir;
  }

  /** Return the secondary directory */
  getSecondaryDir(): Directory {
    return this.secondaryDir;
  }

  makeLock(name: string): Lock {
    return this.getDirectory(name).makeLock(name);
  }

  close(): void {
    if (this.doClose) {
      IOUtils.close(this.primaryDir, this.secondaryDir);
      this.doClose = false;
    }
  }

  listAll(): string[] {
    const files: string[] = [];
    const seen = new Set<string>();
    const add = (f: string): void => {
      if (!seen.has(f)) {
        seen.add(f);
        files.push(f);
      }
    };
    let exc: NoSuchFileException | null = null;
    try {
      for (const f of this.primaryDir.listAll()) {
        add(f);
      }
    } catch (e) {
      if (!(e instanceof NoSuchFileException)) throw e;
      // we got NoSuchFileException from primaryDir:
      // in this case, the secondary dir will hopefully return us
      // a correct listing, else we'll throw the exception back
      // to caller.
      exc = e;
    }
    try {
      for (const f of this.secondaryDir.listAll()) {
        add(f);
      }
    } catch (e) {
      if (!(e instanceof NoSuchFileException)) throw e;
      // we got NoSuchFileException from secondaryDir:
      // in this case, if primaryDir already listed files, fine.
      // otherwise, we got NoSuchFileException from both dirs: throw it
      if (exc !== null) {
        throw exc;
      }
      if (files.length === 0) {
        throw e;
      }
    }
    // we got NoSuchFileException from primaryDir, and empty list from secondaryDir:
    // in this case, throw the exception back to caller
    if (exc !== null && files.length === 0) {
      throw exc;
    }
    return javaHashOrder(files);
  }

  /** Utility method to return a file's extension. */
  static getExtension(name: string): string {
    const i = name.lastIndexOf(".");
    if (i === -1) {
      return "";
    }
    return name.substring(i + 1, name.length);
  }

  private getDirectory(name: string): Directory {
    const ext = FileSwitchDirectory.getExtension(name);
    if (this.primaryExtensions.has(ext)) {
      return this.primaryDir;
    } else {
      return this.secondaryDir;
    }
  }

  deleteFile(name: string): void {
    this.getDirectory(name).deleteFile(name);
  }

  fileLength(name: string): number {
    return this.getDirectory(name).fileLength(name);
  }

  createOutput(name: string, context: IOContext): IndexOutput {
    return this.getDirectory(name).createOutput(name, context);
  }

  sync(names: Iterable<string>): void {
    const primaryNames: string[] = [];
    const secondaryNames: string[] = [];

    for (const name of names)
      if (this.primaryExtensions.has(FileSwitchDirectory.getExtension(name))) primaryNames.push(name);
      else secondaryNames.push(name);

    this.primaryDir.sync(primaryNames);
    this.secondaryDir.sync(secondaryNames);
  }

  renameFile(source: string, dest: string): void {
    const sourceDir = this.getDirectory(source);
    // won't happen with standard lucene index files since pending and commit will
    // always have the same extension ("")
    if (sourceDir !== this.getDirectory(dest)) {
      throw new AtomicMoveNotSupportedException(source, dest, "source and dest are in different directories");
    }
    sourceDir.renameFile(source, dest);
  }

  openInput(name: string, context: IOContext): IndexInput {
    return this.getDirectory(name).openInput(name, context);
  }
}
