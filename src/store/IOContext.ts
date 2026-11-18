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

// Port of org.apache.lucene.store.IOContext (Lucene 5.2.1).
//
// Deviation: Java's enum hashCode() is the identity hash (different on every run); IOContext.hashCode() uses the
// enum ordinal instead so that it is deterministic.

import { lassert } from "../util/assertions.js";
import { FlushInfo } from "./FlushInfo.js";
import { MergeInfo } from "./MergeInfo.js";

/**
 * Context is a enumerator which specifies the context in which the Directory
 * is being used for.
 */
export enum Context {
  MERGE = "MERGE",
  READ = "READ",
  FLUSH = "FLUSH",
  DEFAULT = "DEFAULT",
}

const ORDINAL: Record<Context, number> = {
  [Context.MERGE]: 0,
  [Context.READ]: 1,
  [Context.FLUSH]: 2,
  [Context.DEFAULT]: 3,
};

// Java's private IOContext(boolean readOnce) constructor: TypeScript constructors cannot be private overloads.
const READ_ONCE_CTOR = Symbol("IOContext(boolean)");

/**
 * IOContext holds additional details on the merge/search context. A IOContext
 * object can never be initialized as null as passed as a parameter to either
 * {@link Directory.openInput} or {@link Directory.createOutput}
 */
export class IOContext {
  /**
   * An object of a enumerator Context type
   */
  readonly context: Context;
  readonly mergeInfo: MergeInfo | null;
  readonly flushInfo: FlushInfo | null;
  readonly readOnce: boolean;

  static readonly DEFAULT: IOContext = new IOContext(Context.DEFAULT);
  static readonly READONCE: IOContext = IOContext.readOnceContext(true);
  static readonly READ: IOContext = IOContext.readOnceContext(false);

  /** Java: IOContext() = this(false) */
  constructor();
  constructor(flushInfo: FlushInfo);
  constructor(context: Context);
  constructor(mergeInfo: MergeInfo);
  /** Copies `ctxt`, using a new value for readOnce. */
  constructor(ctxt: IOContext, readOnce: boolean);
  constructor(arg?: FlushInfo | Context | MergeInfo | IOContext | typeof READ_ONCE_CTOR, readOnce?: boolean) {
    if (arg === undefined) {
      arg = READ_ONCE_CTOR;
      readOnce = false;
    }
    if (arg === READ_ONCE_CTOR) {
      // private IOContext(boolean readOnce)
      this.context = Context.READ;
      this.mergeInfo = null;
      this.readOnce = readOnce!;
      this.flushInfo = null;
    } else if (arg instanceof FlushInfo) {
      lassert(() => arg !== null);
      this.context = Context.FLUSH;
      this.mergeInfo = null;
      this.readOnce = false;
      this.flushInfo = arg;
    } else if (arg instanceof MergeInfo) {
      // this(Context.MERGE, mergeInfo)
      this.context = Context.MERGE;
      this.readOnce = false;
      this.mergeInfo = arg;
      this.flushInfo = null;
    } else if (arg instanceof IOContext) {
      this.context = arg.context;
      this.mergeInfo = arg.mergeInfo;
      this.flushInfo = arg.flushInfo;
      this.readOnce = readOnce!;
    } else {
      // this(context, null): private IOContext(Context context, MergeInfo mergeInfo)
      const context: Context = arg;
      lassert(() => context !== Context.MERGE, "MergeInfo must not be null if context is MERGE");
      lassert(() => context !== Context.FLUSH, "Use IOContext(FlushInfo) to create a FLUSH IOContext");
      this.context = context;
      this.readOnce = false;
      this.mergeInfo = null;
      this.flushInfo = null;
    }
  }

  private static readOnceContext(readOnce: boolean): IOContext {
    return new (IOContext as unknown as new (marker: symbol, readOnce: boolean) => IOContext)(READ_ONCE_CTOR, readOnce);
  }

  hashCode(): number {
    const prime = 31;
    let result = 1;
    result = (Math.imul(prime, result) + ORDINAL[this.context]) | 0;
    result = (Math.imul(prime, result) + (this.flushInfo === null ? 0 : this.flushInfo.hashCode())) | 0;
    result = (Math.imul(prime, result) + (this.mergeInfo === null ? 0 : this.mergeInfo.hashCode())) | 0;
    result = (Math.imul(prime, result) + (this.readOnce ? 1231 : 1237)) | 0;
    return result;
  }

  equals(obj: unknown): boolean {
    if (this === obj) return true;
    if (obj === null || obj === undefined) return false;
    if (Object.getPrototypeOf(obj) !== Object.getPrototypeOf(this)) return false;
    const other = obj as IOContext;
    if (this.context !== other.context) return false;
    if (this.flushInfo === null) {
      if (other.flushInfo !== null) return false;
    } else if (!this.flushInfo.equals(other.flushInfo)) return false;
    if (this.mergeInfo === null) {
      if (other.mergeInfo !== null) return false;
    } else if (!this.mergeInfo.equals(other.mergeInfo)) return false;
    if (this.readOnce !== other.readOnce) return false;
    return true;
  }

  toString(): string {
    return (
      "IOContext [context=" + this.context + ", mergeInfo=" + this.mergeInfo + ", flushInfo=" + this.flushInfo +
      ", readOnce=" + this.readOnce + "]"
    );
  }
}
