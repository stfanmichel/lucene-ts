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

// Partial port of org.apache.lucene.util.IOUtils (Lucene 5.2.1): the Closeable and Directory helpers.
// Not ported (they need java.nio.file or JVM internals): getDecodingReader, deleteFilesIgnoringExceptions(Path...),
// deleteFilesIfExist, rm, fsync, spins. Varargs and Iterable overloads are merged: pass either the
// objects themselves or a single iterable of them.

import { addSuppressed, IOException, RuntimeException } from "../errors.js";
import type { Closeable } from "../io/Closeable.js";
import type { Directory } from "../store/Directory.js";

type MaybeCloseable = Closeable | null | undefined;

function flatten(objects: Array<MaybeCloseable | Iterable<MaybeCloseable>>): MaybeCloseable[] {
  if (objects.length === 1) {
    const only = objects[0];
    if (only !== null && only !== undefined && typeof (only as Iterable<MaybeCloseable>)[Symbol.iterator] === "function") {
      return [...(only as Iterable<MaybeCloseable>)];
    }
  }
  return objects as MaybeCloseable[];
}

/** This utility class provides utility methods for IO operations. */
export class IOUtils {
  private constructor() {}

  /**
   * Closes all given <tt>Closeable</tt>s. Some of the <tt>Closeable</tt>s may be null; they are ignored.
   * After everything is closed, the method either throws the first exception it hit while closing
   * (the others being added as suppressed exceptions), or completes normally if there were no exceptions.
   */
  static close(...objects: Array<MaybeCloseable | Iterable<MaybeCloseable>>): void {
    let th: unknown = null;
    for (const object of flatten(objects)) {
      try {
        if (object !== null && object !== undefined) {
          object.close();
        }
      } catch (t) {
        addSuppressed(th, t);
        if (th === null) {
          th = t;
        }
      }
    }
    IOUtils.reThrow(th);
  }

  /**
   * Closes all given <tt>Closeable</tt>s, suppressing all thrown exceptions. Some of the
   * <tt>Closeable</tt>s may be null; they are ignored.
   */
  static closeWhileHandlingException(...objects: Array<MaybeCloseable | Iterable<MaybeCloseable>>): void {
    for (const object of flatten(objects)) {
      try {
        if (object !== null && object !== undefined) {
          object.close();
        }
      } catch {
        // ignore
      }
    }
  }

  /** Deletes all given files, suppressing all thrown IOExceptions (and every other error). */
  static deleteFilesIgnoringExceptions(dir: Directory, ...files: string[]): void {
    for (const name of files) {
      try {
        dir.deleteFile(name);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Simple utility method that takes a previously caught throwable and rethrows either
   * IOException if it is one, or an unchecked exception (or error) otherwise. Does nothing if null.
   */
  static reThrow(th: unknown): void {
    if (th !== null && th !== undefined) {
      if (th instanceof IOException) {
        throw th;
      }
      IOUtils.reThrowUnchecked(th);
    }
  }

  /**
   * Simple utility method that takes a previously caught throwable and rethrows it as an unchecked exception:
   * RuntimeExceptions and Errors are rethrown as is, IOException (a checked exception in Java) and anything
   * else are wrapped in a RuntimeException.
   */
  static reThrowUnchecked(th: unknown): void {
    if (th !== null && th !== undefined) {
      if (th instanceof Error && !(th instanceof IOException)) {
        throw th;
      }
      throw new RuntimeException(String(th), { cause: th });
    }
  }
}
