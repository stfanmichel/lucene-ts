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

// Port of org.apache.lucene.util.Accountables (Lucene 5.2.1). System.lineSeparator() is "\n" here.

import type { Accountable } from "./Accountable.js";
import { compareJavaStrings } from "./JavaCollections.js";
import { RamUsageEstimator } from "./RamUsageEstimator.js";

/** Helper methods for working with {@link Accountable}s. */
export class Accountables {
  private constructor() {}

  /** Return a tree representation of the provided resource (its toString() is shown for every node). */
  static toString(a: Accountable): string {
    return Accountables.toStringImpl([], a, 0).join("");
  }

  private static toStringImpl(dest: string[], a: Accountable, depth: number): string[] {
    for (let i = 1; i < depth; i++) {
      dest.push("    ");
    }
    if (depth > 0) {
      dest.push("|-- ");
    }
    dest.push(a.toString());
    dest.push(": ");
    dest.push(RamUsageEstimator.humanReadableUnits(a.ramBytesUsed()));
    dest.push("\n");
    for (const child of a.getChildResources()) {
      Accountables.toStringImpl(dest, child, depth + 1);
    }
    return dest;
  }

  /** Augments an existing accountable with the provided description: [description [in]] with the children and size of in. */
  static namedAccountable(description: string, in_: Accountable): Accountable;
  /** Returns an accountable with the provided description and bytes. */
  static namedAccountable(description: string, bytes: number): Accountable;
  /** Returns an accountable with the provided description, children and bytes. */
  static namedAccountable(description: string, children: readonly Accountable[], bytes: number): Accountable;
  static namedAccountable(
    description: string,
    arg: Accountable | number | readonly Accountable[],
    bytes?: number,
  ): Accountable {
    if (typeof arg === "number") {
      return Accountables.namedAccountable(description, [], arg);
    } else if (Array.isArray(arg)) {
      const children = arg as readonly Accountable[];
      const named: Accountable & { toString(): string } = {
        ramBytesUsed: () => bytes!,
        getChildResources: () => children,
        toString: () => description,
      };
      return named;
    } else {
      const in_ = arg as Accountable;
      return Accountables.namedAccountable(description + " [" + in_.toString() + "]", in_.getChildResources(), in_.ramBytesUsed());
    }
  }

  /**
   * Returns an accountable with the provided description and children, one per entry of the map,
   * sorted by their description (so the result does not depend on the map's iteration order).
   */
  static namedAccountables(prefix: string, in_: ReadonlyMap<unknown, Accountable>): readonly Accountable[] {
    const resources: Accountable[] = [];
    for (const [key, value] of in_) {
      resources.push(Accountables.namedAccountable(prefix + " '" + String(key) + "'", value));
    }
    resources.sort((o1, o2) => compareJavaStrings(o1.toString(), o2.toString()));
    return Object.freeze(resources);
  }
}
