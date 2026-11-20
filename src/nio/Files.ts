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

// Synchronous emulation of the parts of java.nio.file (Files, Path as a plain string) that Lucene's
// FSDirectory family uses, on top of node:fs. Node errors (errno codes) are translated into the same
// java.nio.file exception types and messages that UnixException.translateToIOException produces.
//
// Deviations: a Path is a `string`; Path.resolve(String) is `resolvePath` (no normalisation beyond collapsing
// duplicate and trailing slashes, like Java's UnixPath); directory listings come back sorted by name
// (libuv's scandir sorts) whereas Java returns readdir order, which is unspecified.

import * as fs from "node:fs";
import * as nodePath from "node:path";
import {
  IndexOutOfBoundsException,
  AccessDeniedException,
  AtomicMoveNotSupportedException,
  ClosedChannelException,
  DirectoryNotEmptyException,
  FileAlreadyExistsException,
  FileSystemException,
  IOException,
  NoSuchFileException,
  NotDirectoryException,
} from "../errors.js";
import type { OutputStream } from "../io/OutputStream.js";

const STRERROR: Record<string, string> = {
  EPERM: "Operation not permitted",
  ENOENT: "No such file or directory",
  EIO: "Input/output error",
  EBADF: "Bad file descriptor",
  EACCES: "Permission denied",
  EEXIST: "File exists",
  EXDEV: "Invalid cross-device link",
  ENOTDIR: "Not a directory",
  EISDIR: "Is a directory",
  EINVAL: "Invalid argument",
  EMFILE: "Too many open files",
  ENOSPC: "No space left on device",
  EROFS: "Read-only file system",
  ENOTEMPTY: "Directory not empty",
  ELOOP: "Too many levels of symbolic links",
  ENAMETOOLONG: "File name too long",
  EBUSY: "Device or resource busy",
  ENODEV: "No such device",
};

/** The C strerror text for a Node error (what UnixException.errorString() gives). */
export function errorString(e: unknown): string {
  const code = (e as { code?: string }).code;
  return (code !== undefined && STRERROR[code]) || (e as Error).message;
}

/**
 * UnixException.translateToIOException(file, other): the java.nio.file exception for a failed system call.
 * `e` that is not a Node system error is returned unchanged (the caller rethrows it).
 */
export function translateToIOException(e: unknown, file: string | null, other: string | null = null): unknown {
  const code = (e as { code?: string } | null)?.code;
  if (typeof code !== "string" || !(code in STRERROR)) return e;
  if (code === "EACCES") return new AccessDeniedException(file, other, null);
  if (code === "ENOENT") return new NoSuchFileException(file, other, null);
  if (code === "EEXIST") return new FileAlreadyExistsException(file, other, null);
  if (code === "ELOOP") {
    return new FileSystemException(file, other, errorString(e) + " or unable to access attributes of symbolic link");
  }
  return new FileSystemException(file, other, errorString(e));
}

/** Path.resolve(String) for UNIX paths. */
export function resolvePath(base: string, other: string): string {
  const o = normalizePath(other);
  if (o.startsWith("/")) return o;
  if (o === "") return base;
  if (base === "") return o;
  return base === "/" ? "/" + o : base + "/" + o;
}

/** What UnixPath does to its input string: collapse repeated slashes and drop a trailing one. */
export function normalizePath(p: string): string {
  let r = p.replace(/\/{2,}/g, "/");
  if (r.length > 1 && r.endsWith("/")) r = r.slice(0, -1);
  return r;
}

/** Path.getFileName().toString() */
export function fileName(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

function wrap<T>(file: string, other: string | null, body: () => T): T {
  try {
    return body();
  } catch (e) {
    throw translateToIOException(e, file, other);
  }
}

/**
 * UnixFileAttributes.get(file, false): null when the file does not exist (ENOENT), the translated java.nio.file
 * exception for any other failure (ENOTDIR, EACCES...), as Files.delete / deleteIfExists propagate it.
 */
function lstatOrNull(p: string): fs.Stats | null {
  try {
    return fs.lstatSync(p);
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT") return null;
    throw translateToIOException(e, p);
  }
}

/** Files.createAndCheckIsDirectory: createDirectory; EEXIST is fine for a directory, a symbolic link to a directory included (JDK 21, checked against the golden) */
function createAndCheckIsDirectory(dir: string): void {
  try {
    fs.mkdirSync(dir);
  } catch (e) {
    const t = translateToIOException(e, dir);
    if (t instanceof FileAlreadyExistsException) {
      let isDir = false;
      try {
        isDir = fs.statSync(dir).isDirectory();
      } catch {
        isDir = false;
      }
      if (!isDir) throw t;
      return;
    }
    throw t;
  }
}

/** The channel-backed OutputStream returned by Files.newOutputStream. */
class ChannelOutputStream implements OutputStream {
  private fd: number | null;
  constructor(fd: number) {
    this.fd = fd;
  }
  write(b: number): void;
  write(b: Uint8Array, off: number, len: number): void;
  write(b: number | Uint8Array, off?: number, len?: number): void {
    if (typeof b !== "number") {
      // Objects.checkFromIndexSize(off, len, b.length), then len == 0 returns before the channel is touched
      const o = off!, n = len!;
      if (o < 0 || n < 0 || o + n > b.length) {
        throw new IndexOutOfBoundsException("Range [" + o + ", " + o + " + " + n + ") out of bounds for length " + b.length);
      }
      if (n === 0) return;
    }
    if (this.fd === null) throw new ClosedChannelException();
    const arr = typeof b === "number" ? Uint8Array.of(b & 0xff) : b;
    let o = typeof b === "number" ? 0 : off!;
    let n = typeof b === "number" ? 1 : len!;
    while (n > 0) {
      let w: number;
      try {
        w = fs.writeSync(this.fd, arr, o, n);
      } catch (e) {
        throw new IOException(errorString(e));
      }
      o += w;
      n -= w;
    }
  }
  flush(): void {}
  close(): void {
    if (this.fd !== null) {
      const fd = this.fd;
      this.fd = null;
      fs.closeSync(fd);
    }
  }
}

export class Files {
  private constructor() {}

  /**
   * Files.createDirectories: create the directory and any missing parents; like the JDK, find the deepest existing
   * ancestor first (a non-NoSuchFile failure of that probe, e.g. ENOTDIR, is reported for the ANCESTOR), then create
   * the missing components one by one. An existing symbolic link (even to a directory) is a
   * FileAlreadyExistsException.
   */
  static createDirectories(dir: string): void {
    try {
      createAndCheckIsDirectory(dir);
      return;
    } catch (e) {
      if (e instanceof FileAlreadyExistsException) throw e;
      // parent may not exist or other reason
    }
    const abs = nodePath.resolve(dir);
    let parent: string | null = nodePath.dirname(abs);
    if (parent === abs) parent = null;
    while (parent !== null) {
      try {
        fs.accessSync(parent);
        break;
      } catch (e) {
        if ((e as { code?: string }).code !== "ENOENT") throw translateToIOException(e, parent);
      }
      const up: string = nodePath.dirname(parent);
      parent = up === parent ? null : up;
    }
    if (parent === null) throw new FileSystemException(abs, null, "Unable to determine if root directory exists");
    let child = parent;
    for (const name of nodePath.relative(parent, abs).split("/")) {
      child = nodePath.join(child, name);
      createAndCheckIsDirectory(child);
    }
  }

  /** Files.createFile: fails with FileAlreadyExistsException when the file exists */
  static createFile(p: string): void {
    wrap(p, null, () => fs.closeSync(fs.openSync(p, "wx")));
  }

  /** Files.deleteIfExists: true if the file was deleted */
  static deleteIfExists(p: string): boolean {
    const st = lstatOrNull(p);
    if (st === null) return false;
    Files.delete(p);
    return true;
  }

  /** Files.delete */
  static delete(p: string): void {
    const st = lstatOrNull(p);
    if (st === null) throw new NoSuchFileException(p);
    try {
      if (st.isDirectory()) fs.rmdirSync(p);
      else fs.unlinkSync(p);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "EEXIST" || code === "ENOTEMPTY") throw new DirectoryNotEmptyException(p);
      throw translateToIOException(e, p);
    }
  }

  /** Files.size */
  static size(p: string): number {
    return wrap(p, null, () => fs.statSync(p).size);
  }

  static exists(p: string): boolean {
    return fs.existsSync(p);
  }

  /** Files.notExists */
  static notExists(p: string): boolean {
    // true only for NoSuchFileException (ENOENT); other failures (ELOOP, ENOTDIR...) mean "unknown" → false
    try {
      fs.statSync(p);
      return false;
    } catch (e) {
      return (e as { code?: string }).code === "ENOENT";
    }
  }

  /** Files.isDirectory */
  static isDirectory(p: string): boolean {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false; // any IOException (missing, ELOOP, ENOTDIR...) is false
    }
  }

  /** Files.move(source, target, ATOMIC_MOVE) */
  static atomicMove(source: string, target: string): void {
    try {
      fs.renameSync(source, target);
    } catch (e) {
      if ((e as { code?: string }).code === "EXDEV") {
        throw new AtomicMoveNotSupportedException(source, target, errorString(e));
      }
      throw translateToIOException(e, source, target);
    }
  }

  /** The names in a directory (Files.newDirectoryStream, then getFileName()), sorted by name. */
  static listNames(dir: string): string[] {
    try {
      return fs.readdirSync(dir);
    } catch (e) {
      if ((e as { code?: string }).code === "ENOTDIR") throw new NotDirectoryException(dir);
      throw translateToIOException(e, dir);
    }
  }

  /** Path.toRealPath() */
  static toRealPath(p: string): string {
    return wrap(p, null, () => fs.realpathSync(p));
  }

  /** Files.newOutputStream(path): CREATE, TRUNCATE_EXISTING, WRITE */
  static newOutputStream(p: string): OutputStream {
    return new ChannelOutputStream(wrap(p, null, () => fs.openSync(p, "w")));
  }
}
