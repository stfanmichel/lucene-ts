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

// Partial port of org.apache.lucene.util.IOUtils (Lucene 5.2.1): the Closeable, Directory and file helpers.
// Not ported (they need JVM internals): getDecodingReader, spins. Varargs and Iterable overloads are merged:
// pass either the objects themselves or a single iterable of them. A java.nio.file.Path is a string, so the
// Path overloads are told apart from the Directory ones by the type of the first argument
// (deleteFilesIgnoringExceptions) or have their own name (deleteFilesIfExist, rm).

import * as nodefs from "node:fs";
import * as nodepath from "node:path";
import { addSuppressed, IOException, RuntimeException } from "../errors.js";
import { FileChannel } from "../nio/FileChannel.js";
import { Files, resolvePath } from "../nio/Files.js";
import { Constants } from "./Constants.js";
import { lassert } from "./assertions.js";
import { sleepSync, tryWithResource } from "./JavaObjects.js";
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

  /**
   * Deletes all given files, suppressing all thrown IOExceptions (and every other error).
   * Either (dir, ...names) for Directory.deleteFile, or (...paths) for Files.delete (Path... overload).
   */
  static deleteFilesIgnoringExceptions(dir: Directory, ...files: string[]): void;
  static deleteFilesIgnoringExceptions(...paths: Array<string | null | undefined>): void;
  static deleteFilesIgnoringExceptions(first: Directory | string | null | undefined, ...rest: Array<string | null | undefined>): void {
    if (typeof first === "string" || first === null || first === undefined) {
      for (const file of [first, ...rest]) {
        try {
          if (file !== null && file !== undefined) {
            Files.delete(file);
          }
        } catch {
          // ignore
        }
      }
      return;
    }
    for (const name of rest) {
      try {
        first.deleteFile(name as string);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Deletes all given paths, if they exist. Some of them may be null; they are ignored. After everything is
   * deleted, the method either throws the first exception it hit while deleting, or completes normally if there
   * were no exceptions. (Java: deleteFilesIfExist(Path...) and deleteFilesIfExist(Collection))
   */
  static deleteFilesIfExist(...files: Array<string | null | undefined | Iterable<string | null | undefined>>): void {
    let list: Array<string | null | undefined>;
    if (files.length === 1 && files[0] !== null && files[0] !== undefined && typeof files[0] !== "string") {
      list = [...(files[0] as Iterable<string | null | undefined>)];
    } else {
      list = files as Array<string | null | undefined>;
    }
    let th: unknown = null;
    for (const file of list) {
      try {
        if (file !== null && file !== undefined) {
          Files.deleteIfExists(file);
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
   * Deletes one or more files or directories (and everything underneath it).
   *
   * @throws IOException if any of the given files (or their subhierarchy files in case of directories)
   * cannot be removed.
   */
  static rm(...locations: Array<string | null | undefined>): void {
    const unremoved = new Map<string, unknown>(); // LinkedHashMap
    IOUtils.rmInto(unremoved, locations);
    if (unremoved.size > 0) {
      let b = "Could not remove the following files (in the order of attempts):\n";
      for (const [k, v] of unremoved) {
        b += "   " + nodepath.resolve(k) + ": " + String(v) + "\n";
      }
      throw new IOException(b);
    }
  }

  private static rmInto(unremoved: Map<string, unknown>, locations: Array<string | null | undefined>): void {
    for (const location of locations) {
      // TODO: remove this leniency!
      if (location !== null && location !== undefined && Files.exists(location)) {
        IOUtils.walkDelete(location, unremoved);
      }
    }
  }

  // Files.walkFileTree with the visitor of rm(): files and (post-order) directories are deleted, failures
  // recorded; symbolic links are not followed.
  private static walkDelete(path: string, unremoved: Map<string, unknown>): void {
    let isDir = false;
    try {
      isDir = nodefs.lstatSync(path).isDirectory();
    } catch (e) {
      unremoved.set(path, e); // visitFileFailed
      return;
    }
    if (isDir) {
      let names: string[] = [];
      try {
        names = Files.listNames(path);
      } catch (e) {
        unremoved.set(path, e); // visitFileFailed for the directory
        return;
      }
      for (const name of names) {
        IOUtils.walkDelete(resolvePath(path, name), unremoved);
      }
    }
    try {
      Files.delete(path); // visitFile / postVisitDirectory
    } catch (e) {
      if (!(e instanceof IOException)) throw e;
      unremoved.set(path, e);
    }
  }

  /**
   * Ensure that any writes to the given file is written to the storage device that contains it.
   * @param fileToSync the file to fsync
   * @param isDir if true, the given file is a directory (we open for read and ignore IOExceptions,
   *  because not all file systems and operating systems allow to fsync on a directory)
   */
  static fsync(fileToSync: string, isDir: boolean): void {
    let exc: unknown = null;

    // If the file is a directory we have to open read-only, for regular files we must open r/w for the fsync to have an effect.
    // See http://blog.httrack.com/blog/2013/11/15/everything-you-always-wanted-to-know-about-fsync/
    try {
      const file = FileChannel.open(fileToSync, isDir ? "READ" : "WRITE");
      const done = tryWithResource(file, () => {
        for (let retry = 0; retry < 5; retry++) {
          try {
            file.force(true);
            return true;
          } catch (ioe) {
            if (!(ioe instanceof IOException)) throw ioe;
            if (exc === null) {
              exc = ioe;
            }
            // Pause 5 msec
            sleepSync(5);
          }
        }
        return false;
      });
      if (done) return;
    } catch (ioe) {
      if (!(ioe instanceof IOException)) throw ioe;
      if (exc === null) {
        exc = ioe;
      }
    }

    if (isDir) {
      // TODO: LUCENE-6169 - Fix this assert once Java 9 problems are solved!
      lassert(
        () => (Constants.LINUX || Constants.MAC_OS_X) === false || Constants.JRE_IS_MINIMUM_JAVA9,
        "On Linux and MacOSX fsyncing a directory should not throw IOException, " +
          "we just don't want to rely on that in production (undocumented). Got: " + String(exc));
      // Ignore exception if it is a directory
      return;
    }

    // Throw original exception
    throw exc;
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
