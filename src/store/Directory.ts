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

// Port of org.apache.lucene.store.Directory (Lucene 5.2.1).
//
// Deviations: Collection<String> parameters are Iterable<string>; long file lengths are numbers;
// the try-with-resources of copyFrom is spelled out (resources closed in reverse order, close exceptions
// suppressed behind a body exception).

import { addSuppressed } from "../errors.js";
import type { Closeable } from "../io/Closeable.js";
import { IOUtils } from "../util/IOUtils.js";
import { identityHashCode, toHexString } from "../util/JavaObjects.js";
import { BufferedChecksumIndexInput } from "./BufferedChecksumIndexInput.js";
import type { ChecksumIndexInput } from "./ChecksumIndexInput.js";
import type { IndexInput } from "./IndexInput.js";
import type { IndexOutput } from "./IndexOutput.js";
import type { IOContext } from "./IOContext.js";
import type { Lock } from "./Lock.js";

/**
 * A Directory is a flat list of files.  Files may be written once, when they
 * are created.  Once a file is created it may only be opened for read, or
 * deleted.  Random access is permitted both when reading and writing.
 *
 * <p> Java's I/O APIs not used directly, but rather all I/O is
 * through this API.  This permits things such as: <ul>
 * <li> implementation of RAM-based indices;
 * <li> implementation indices stored in a database, via JDBC;
 * <li> implementation of an index as a single file;
 * </ul>
 *
 * Directory locking is implemented by an instance of {@link LockFactory}, and
 * can be changed for each Directory instance using {@link setLockFactory}.
 */
export abstract class Directory implements Closeable {
  /**
   * Returns an array of strings, one for each file in the directory.
   *
   * @throws NoSuchFileException if the directory is not prepared for any
   *         write operations (such as {@link createOutput}).
   * @throws IOException in case of other IO errors
   */
  abstract listAll(): string[];

  /** Removes an existing file in the directory. */
  abstract deleteFile(name: string): void;

  /**
   * Returns the length of a file in the directory. This method follows the
   * following contract:
   * <ul>
   * <li>Throws {@link FileNotFoundException} or {@link NoSuchFileException}
   * if the file does not exist.
   * <li>Returns a value &ge;0 if the file exists, which specifies its length.
   * </ul>
   *
   * @param name the name of the file for which to return the length.
   * @throws IOException if there was an IO error while retrieving the file's
   *         length.
   */
  abstract fileLength(name: string): number;

  /** Creates a new, empty file in the directory with the given name. Returns a stream writing this file. */
  abstract createOutput(name: string, context: IOContext): IndexOutput;

  /**
   * Ensure that any writes to these files are moved to
   * stable storage.  Lucene uses this to properly commit
   * changes to the index, to prevent a machine/OS crash
   * from corrupting the index.<br>
   * <br>
   * NOTE: Clients may call this method for same files over
   * and over again, so some impls might optimize for that.
   * For other impls the operation can be a noop, for various
   * reasons.
   */
  abstract sync(names: Iterable<string>): void;

  /**
   * Renames {@code source} to {@code dest} as an atomic operation,
   * where {@code dest} does not yet exist in the directory.
   * <p>
   * Notes: This method is used by IndexWriter to publish commits.
   * It is ok if this operation is not truly atomic, for example
   * both {@code source} and {@code dest} can be visible temporarily.
   * It is just important that the contents of {@code dest} appear
   * atomically, or an exception is thrown.
   */
  abstract renameFile(source: string, dest: string): void;

  /**
   * Returns a stream reading an existing file.
   * <p>Throws {@link FileNotFoundException} or {@link NoSuchFileException}
   * if the file does not exist.
   */
  abstract openInput(name: string, context: IOContext): IndexInput;

  /**
   * Returns a stream reading an existing file, computing checksum as it reads
   */
  openChecksumInput(name: string, context: IOContext): ChecksumIndexInput {
    return new BufferedChecksumIndexInput(this.openInput(name, context));
  }

  /**
   * Construct a {@link Lock}.
   * @param name the name of the lock file
   */
  abstract makeLock(name: string): Lock;

  /** Closes the store. */
  abstract close(): void;

  toString(): string {
    return this.constructor.name + "@" + toHexString(identityHashCode(this));
  }

  /**
   * Copies the file <i>src</i> to {@link Directory} <i>to</i> under the new
   * file name <i>dest</i>.
   * <p>
   * If you want to copy the entire source directory to the destination one, you
   * can do so like this:
   *
   * <pre class="prettyprint">
   * Directory to; // the directory to copy to
   * for (String file : dir.listAll()) {
   *   to.copyFrom(dir, file, newFile, IOContext.DEFAULT); // newFile can be either file, or a new name
   * }
   * </pre>
   * <p>
   * <b>NOTE:</b> this method does not check whether <i>dest</i> exist and will
   * overwrite it if it does.
   */
  copyFrom(from: Directory, src: string, dest: string, context: IOContext): void {
    let success = false;
    let primary: unknown = null;
    let hasPrimary = false;
    let is: IndexInput | null = null;
    let os: IndexOutput | null = null;
    try {
      // try (IndexInput is = ...; IndexOutput os = ...)
      is = from.openInput(src, context);
      os = this.createOutput(dest, context);
      os.copyBytes(is, is.length());
      success = true;
    } catch (t) {
      primary = t;
      hasPrimary = true;
    }
    // resources are closed in reverse order of their declaration
    for (const resource of [os, is]) {
      if (resource === null) continue;
      try {
        resource.close();
      } catch (t) {
        if (hasPrimary) {
          addSuppressed(primary, t);
        } else {
          // NB: like Java, `success` stays true when only close() fails: the body did complete
          primary = t;
          hasPrimary = true;
        }
      }
    }
    if (!success) {
      IOUtils.deleteFilesIgnoringExceptions(this, dest);
    }
    if (hasPrimary) {
      throw primary;
    }
  }

  /**
   * @throws AlreadyClosedException if this Directory is closed
   */
  protected ensureOpen(): void {}
}

