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

import { NoSuchElementException, UnsupportedOperationException } from "../errors.js";
import { lassert } from "./assertions.js";
import type { JavaIterator } from "./JavaIterator.js";
import { PriorityQueue } from "./PriorityQueue.js";

/** Java's Comparable<T>: the natural ordering, plus equals() for duplicates removal. */
export interface Comparable<T> {
  compareTo(other: T): number;
  equals(other: unknown): boolean;
}

/**
 * Port of org.apache.lucene.util.MergedIterator: Provides a merged sorted view from several sorted iterators.
 * <p>
 * If built with <code>removeDuplicates</code> set to true and an element appears in multiple iterators then it is
 * deduplicated, that is this iterator returns the sorted union of elements.
 * <p>
 * If built with <code>removeDuplicates</code> set to false then all elements in all iterators are returned.
 * <p>
 * Caveats:
 * <ul>
 *   <li>The behavior is undefined if the iterators are not actually sorted according to their natural ordering.
 *   <li>The behavior is undefined if the iterators do not implement the same type
 *   <li>Null elements are unsupported.
 *   <li>If removeDuplicates is set to true and if a single iterator contains duplicates then they will not be
 *       deduplicated.
 *   <li>When elements are deduplicated it is not defined which one of the equal elements is returned.
 * </ul>
 */
export class MergedIterator<T extends Comparable<T>> implements JavaIterator<T> {
  private current: T | null = null;
  private readonly queue: TermMergeQueue<T>;
  private readonly top: Array<SubIterator<T>>;
  private readonly removeDuplicates: boolean;
  private numTop = 0;

  /** Merges with duplicates removal (Java: MergedIterator(Iterator...)). */
  constructor(...iterators: Array<JavaIterator<T>>);
  /** (Java: MergedIterator(boolean removeDuplicates, Iterator...)) */
  constructor(removeDuplicates: boolean, ...iterators: Array<JavaIterator<T>>);
  constructor(first?: boolean | JavaIterator<T>, ...rest: Array<JavaIterator<T>>) {
    let removeDuplicates = true;
    let iterators: Array<JavaIterator<T>>;
    if (typeof first === "boolean") {
      removeDuplicates = first;
      iterators = rest;
    } else {
      iterators = first === undefined ? rest : [first, ...rest];
    }
    this.removeDuplicates = removeDuplicates;
    this.queue = new TermMergeQueue<T>(iterators.length);
    this.top = new Array<SubIterator<T>>(iterators.length);
    let index = 0;
    for (const iterator of iterators) {
      if (iterator.hasNext()) {
        const sub = new SubIterator<T>();
        sub.current = iterator.next();
        sub.iterator = iterator;
        sub.index = index++;
        this.queue.add(sub);
      }
    }
  }

  hasNext(): boolean {
    if (this.queue.size() > 0) {
      return true;
    }
    for (let i = 0; i < this.numTop; i++) {
      if (this.top[i]!.iterator!.hasNext()) {
        return true;
      }
    }
    return false;
  }

  next(): T {
    // restore queue
    this.pushTop();

    // gather equal top elements
    if (this.queue.size() > 0) {
      this.pullTop();
    } else {
      this.current = null;
    }
    if (this.current === null) {
      throw new NoSuchElementException();
    }
    return this.current;
  }

  remove(): void {
    throw new UnsupportedOperationException();
  }

  private pullTop(): void {
    lassert(() => this.numTop === 0);
    this.top[this.numTop++] = this.queue.pop()!;
    if (this.removeDuplicates) {
      // extract all subs from the queue that have the same top element
      while (this.queue.size() !== 0 && this.queue.top()!.current!.equals(this.top[0]!.current)) {
        this.top[this.numTop++] = this.queue.pop()!;
      }
    }
    this.current = this.top[0]!.current;
  }

  private pushTop(): void {
    // call next() on each top, and put back into queue
    for (let i = 0; i < this.numTop; i++) {
      if (this.top[i]!.iterator!.hasNext()) {
        this.top[i]!.current = this.top[i]!.iterator!.next();
        this.queue.add(this.top[i]!);
      } else {
        // no more elements
        this.top[i]!.current = null;
      }
    }
    this.numTop = 0;
  }
}

class SubIterator<I extends Comparable<I>> {
  iterator: JavaIterator<I> | null = null;
  current: I | null = null;
  index = 0;
}

class TermMergeQueue<C extends Comparable<C>> extends PriorityQueue<SubIterator<C>> {
  constructor(size: number) {
    super(size);
  }

  protected override lessThan(a: SubIterator<C>, b: SubIterator<C>): boolean {
    const cmp = a.current!.compareTo(b.current!);
    if (cmp !== 0) {
      return cmp < 0;
    } else {
      return a.index < b.index;
    }
  }
}
