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

// Port of org.apache.lucene.util.WeakIdentityMap (Lucene 5.2.1) on WeakRef/WeakMap.
//
// Deviations: JavaScript has no ReferenceQueue, so reap() scans the entries for collected keys instead of
// polling a queue (put() only scans when the map has doubled since the last scan, to stay amortised O(1));
// the two factory methods (HashMap / ConcurrentHashMap backed) are the same here; iteration is in insertion
// order. Keys must be objects (WeakRef requirement) or null.

import type { JavaIterator } from "./JavaIterator.js";
import { NoSuchElementException, UnsupportedOperationException } from "../errors.js";

/** The (private) NULL key marker of the Java class. */
const NULL_KEY: object = {};

export type { JavaIterator };

interface Entry<V> {
  readonly ref: WeakRef<object>;
  value: V;
}

/**
 * Implements a combination of {@link java.util.WeakHashMap} and {@link java.util.IdentityHashMap}.
 * Useful for caches that need to key off of a <a href="http://en.wikipedia.org/wiki/Identity_%28object-oriented_programming%29">==</a>
 * comparison instead of a {@link Object#equals}.
 *
 * @lucene.internal
 */
export class WeakIdentityMap<K extends object, V> {
  private readonly ids = new WeakMap<object, number>();
  private readonly backingStore = new Map<number, Entry<V>>();
  private nextId = 1;
  private reapThreshold = 16;
  private readonly reapOnRead: boolean;

  /** Creates a new {@code WeakIdentityMap} based on a non-synchronized {@link HashMap}. The map <i>reaps</i> before each read. */
  static newHashMap<K extends object, V>(reapOnRead: boolean = true): WeakIdentityMap<K, V> {
    return new WeakIdentityMap<K, V>(reapOnRead);
  }

  /** Creates a new {@code WeakIdentityMap} based on a {@link ConcurrentHashMap}. */
  static newConcurrentHashMap<K extends object, V>(reapOnRead: boolean = true): WeakIdentityMap<K, V> {
    return new WeakIdentityMap<K, V>(reapOnRead);
  }

  private constructor(reapOnRead: boolean) {
    this.reapOnRead = reapOnRead;
  }

  private static keyObject(key: object | null): object {
    return key === null ? NULL_KEY : key;
  }

  private idOf(key: object | null): number | undefined {
    return this.ids.get(WeakIdentityMap.keyObject(key));
  }

  /** Removes all of the mappings from this map. */
  clear(): void {
    this.backingStore.clear();
    this.reap();
  }

  /** Returns {@code true} if this map contains a mapping for the specified key. */
  containsKey(key: object | null): boolean {
    if (this.reapOnRead) this.reap();
    const id = this.idOf(key);
    return id !== undefined && this.backingStore.has(id);
  }

  /** Returns the value to which the specified key is mapped, or null. */
  get(key: object | null): V | null {
    if (this.reapOnRead) this.reap();
    const id = this.idOf(key);
    const e = id === undefined ? undefined : this.backingStore.get(id);
    return e === undefined ? null : e.value;
  }

  /** Associates the specified value with the specified key in this map; returns the previous value or null. */
  put(key: K | null, value: V): V | null {
    if (this.backingStore.size >= this.reapThreshold) {
      this.reap();
      this.reapThreshold = Math.max(16, this.backingStore.size * 2);
    }
    const obj = WeakIdentityMap.keyObject(key);
    let id = this.ids.get(obj);
    if (id !== undefined) {
      const old = this.backingStore.get(id);
      if (old !== undefined) {
        const prev = old.value;
        old.value = value;
        return prev;
      }
    } else {
      id = this.nextId++;
      this.ids.set(obj, id);
    }
    this.backingStore.set(id, { ref: new WeakRef(obj), value });
    return null;
  }

  /** Returns {@code true} if this map contains no key-value mappings. */
  isEmpty(): boolean {
    return this.size() === 0;
  }

  /** Removes the mapping for a key from this weak hash map if it is present; returns the previous value or null. */
  remove(key: object | null): V | null {
    this.reap();
    const id = this.idOf(key);
    const e = id === undefined ? undefined : this.backingStore.get(id);
    if (e === undefined) return null;
    this.backingStore.delete(id!);
    return e.value;
  }

  /** Returns the number of key-value mappings in this map. This result is a snapshot, and may not reflect unprocessed entries that will be removed before next attempted access because they are no longer referenced. */
  size(): number {
    if (this.backingStore.size === 0) return 0;
    if (this.reapOnRead) this.reap();
    return this.backingStore.size;
  }

  /** Returns an iterator over all weak keys of this map. Keys already garbage collected will not be returned. */
  keyIterator(): JavaIterator<K | null> {
    this.reap();
    const iterator = this.backingStore.entries()[Symbol.iterator]();
    const store = this.backingStore;
    let next: object | null = null;
    let nextIsSet = false;
    const setNext = (): boolean => {
      for (;;) {
        const r = iterator.next();
        if (r.done) return false;
        const [id, entry] = r.value;
        const obj = entry.ref.deref();
        if (obj === undefined) {
          store.delete(id);
        } else {
          next = obj === NULL_KEY ? null : obj;
          nextIsSet = true;
          return true;
        }
      }
    };
    return {
      hasNext: () => nextIsSet || setNext(),
      next: () => {
        if (!(nextIsSet || setNext())) throw new NoSuchElementException();
        const result = next as K | null;
        nextIsSet = false;
        next = null;
        return result;
      },
      remove: () => {
        throw new UnsupportedOperationException();
      },
    };
  }

  /** Returns an iterator over all values of this map. */
  valueIterator(): JavaIterator<V> {
    if (this.reapOnRead) this.reap();
    const iterator = this.backingStore.values()[Symbol.iterator]();
    let peeked: IteratorResult<Entry<V>> | null = null;
    return {
      hasNext: () => {
        if (peeked === null) peeked = iterator.next();
        return !peeked.done;
      },
      next: () => {
        const r = peeked ?? iterator.next();
        peeked = null;
        if (r.done) throw new NoSuchElementException();
        return r.value.value;
      },
      remove: () => {
        throw new UnsupportedOperationException();
      },
    };
  }

  /** This method manually cleans up the reference queue; here: drops the entries whose key was collected. */
  reap(): void {
    for (const [id, entry] of this.backingStore) {
      if (entry.ref.deref() === undefined) this.backingStore.delete(id);
    }
  }
}
