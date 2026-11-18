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

// Port of org.apache.lucene.store.RAMDirectory (Lucene 5.2.1).
//
// Deviations:
//  - The constructor RAMDirectory(FSDirectory dir, IOContext context) is not ported (FSDirectory is not).
//  - fileMap is a plain Map: listAll() returns names in insertion order, whereas the Java
//    ConcurrentHashMap order is unspecified (it differs between JDK versions).
//  - Single-threaded: no synchronization, sizeInBytes is an AtomicLong holding a number.

import { FileNotFoundException } from "../errors.js";
import type { Accountable } from "../util/Accountable.js";
import { Accountables } from "../util/Accountables.js";
import { AtomicLong } from "../util/AtomicLong.js";
import { BaseDirectory } from "./BaseDirectory.js";
import type { IndexInput } from "./IndexInput.js";
import type { IndexOutput } from "./IndexOutput.js";
import type { IOContext } from "./IOContext.js";
import type { LockFactory } from "./LockFactory.js";
import { RAMFile } from "./RAMFile.js";
import { RAMInputStream } from "./RAMInputStream.js";
import { RAMOutputStream } from "./RAMOutputStream.js";
import { SingleInstanceLockFactory } from "./SingleInstanceLockFactory.js";

/**
 * A memory-resident {@link Directory} implementation.  Locking
 * implementation is by default the {@link SingleInstanceLockFactory}.
 *
 * <p><b>Warning:</b> This class is not intended to work with huge
 * indexes. Everything beyond several hundred megabytes will waste
 * resources (GC cycles), because it uses an internal buffer size
 * of 1024 bytes, producing millions of {@code byte[1024]} arrays.
 * This class is optimized for small memory-resident indexes.
 * It also has bad concurrency on multithreaded environments.
 */
export class RAMDirectory extends BaseDirectory implements Accountable {
  protected readonly fileMap = new Map<string, RAMFile>();
  /** @internal (protected in Java; RAMFile adds to it) */
  readonly sizeInBytes = new AtomicLong();

  // *****
  // Lock acquisition sequence:  RAMDirectory, then RAMFile
  // *****

  /** Constructs an empty {@link Directory}. */
  constructor();
  /** Constructs an empty {@link Directory} with the given {@link LockFactory}. */
  constructor(lockFactory: LockFactory);
  constructor(lockFactory?: LockFactory) {
    super(lockFactory ?? new SingleInstanceLockFactory());
  }

  listAll(): string[] {
    this.ensureOpen();
    // NOTE: this returns a "weakly consistent view". Unless we change Dir API, RAMDir's list() is the best we can do.
    return [...this.fileMap.keys()];
  }

  /** Returns true iff the named file exists in this directory. */
  fileNameExists(name: string): boolean {
    this.ensureOpen();
    return this.fileMap.has(name);
  }

  /**
   * Returns the length in bytes of a file in the directory.
   * @throws IOException if the file does not exist
   */
  fileLength(name: string): number {
    this.ensureOpen();
    const file = this.fileMap.get(name);
    if (file === undefined) {
      throw new FileNotFoundException(name);
    }
    return file.getLength();
  }

  /**
   * Return total size in bytes of all files in this directory. This is
   * currently quantized to RAMOutputStream.BUFFER_SIZE.
   */
  ramBytesUsed(): number {
    this.ensureOpen();
    return this.sizeInBytes.get();
  }

  getChildResources(): readonly Accountable[] {
    return Accountables.namedAccountables("file", this.fileMap);
  }

  /**
   * Removes an existing file in the directory.
   * @throws IOException if the file does not exist
   */
  deleteFile(name: string): void {
    this.ensureOpen();
    const file = this.fileMap.get(name);
    if (file !== undefined) {
      this.fileMap.delete(name);
      file.directory = null;
      this.sizeInBytes.addAndGet(-file.sizeInBytes);
    } else {
      throw new FileNotFoundException(name);
    }
  }

  createOutput(name: string, _context: IOContext): IndexOutput {
    this.ensureOpen();
    const file = this.newRAMFile();
    const existing = this.fileMap.get(name);
    if (existing !== undefined) {
      this.fileMap.delete(name);
      this.sizeInBytes.addAndGet(-existing.sizeInBytes);
      existing.directory = null;
    }
    this.fileMap.set(name, file);
    return new RAMOutputStream(name, file, true);
  }

  /**
   * Returns a new {@link RAMFile} for storing data. This method can be
   * overridden to return different {@link RAMFile} impls, that e.g. override
   * {@link RAMFile.newBuffer}.
   */
  protected newRAMFile(): RAMFile {
    return new RAMFile(this);
  }

  sync(_names: Iterable<string>): void {}

  renameFile(source: string, dest: string): void {
    this.ensureOpen();
    const file = this.fileMap.get(source);
    if (file === undefined) {
      throw new FileNotFoundException(source);
    }
    this.fileMap.set(dest, file);
    this.fileMap.delete(source);
  }

  /**
   * Returns a stream reading an existing file.
   * @throws IOException if the file does not exist
   */
  openInput(name: string, _context: IOContext): IndexInput {
    this.ensureOpen();
    const file = this.fileMap.get(name);
    if (file === undefined) {
      throw new FileNotFoundException(name);
    }
    return new RAMInputStream(name, file);
  }

  /** Closes the store to future operations, releasing associated memory. */
  close(): void {
    this.isOpen = false;
    this.fileMap.clear();
  }
}
