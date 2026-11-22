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

import { ArrayIndexOutOfBoundsException, IllegalArgumentException } from "../errors.js";
import { ArrayUtil } from "./ArrayUtil.js";

/**
 * Port of org.apache.lucene.util.PriorityQueue: A PriorityQueue maintains a partial ordering of its elements such
 * that the least element can always be found in constant time. Put()'s and pop()'s require log(size) time.
 *
 * <b>NOTE</b>: This class will pre-allocate a full array of length <code>maxSize+1</code> if instantiated via the
 * {@link #PriorityQueue(int,boolean)} constructor with <code>prepopulate</code> set to <code>true</code>.
 * That maximum size can grow as we insert elements over the time.
 */
export abstract class PriorityQueue<T> {
  private _size = 0;
  private readonly maxSize: number;
  private readonly heap: Array<T | null>;

  constructor(maxSize: number, prepopulate: boolean = true) {
    let heapSize: number;
    if (0 === maxSize) {
      // We allocate 1 extra to avoid if statement in top()
      heapSize = 2;
    } else {
      // NOTE: we add +1 because all access to heap is 1-based not 0-based. heap[0] is unused.
      heapSize = maxSize + 1;
      if (heapSize > ArrayUtil.MAX_ARRAY_LENGTH) {
        // Throw exception to prevent confusing OOME:
        throw new IllegalArgumentException("maxSize must be <= " + (ArrayUtil.MAX_ARRAY_LENGTH - 1) + "; got: " + maxSize);
      }
    }
    this.heap = new Array<T | null>(heapSize).fill(null);
    this.maxSize = maxSize;

    if (prepopulate) {
      // prepopulate heap
      const sentinel = this.getSentinelObject();
      if (sentinel !== null) {
        this.heap[1] = sentinel;
        for (let i = 2; i < this.heap.length; i++) {
          this.heap[i] = this.getSentinelObject();
        }
        this._size = maxSize;
      }
    }
  }

  /** Determines the ordering of objects in this priority queue. Subclasses must define this one method. */
  protected abstract lessThan(a: T, b: T): boolean;

  /**
   * This method can be overridden by extending classes to return a sentinel object which will be used by the
   * {@link PriorityQueue#PriorityQueue(int,boolean)} constructor to fill the queue, so that the code which uses
   * that queue can always assume it's full and only change the top without attempting to insert any new object.
   */
  protected getSentinelObject(): T | null {
    return null;
  }

  /**
   * Adds an Object to a PriorityQueue in log(size) time. If one tries to add more objects than maxSize from
   * initialize and it is not possible to resize the heap, an {@link ArrayIndexOutOfBoundsException} is thrown.
   * @return the new 'top' element in the queue.
   */
  add(element: T): T | null {
    this._size++;
    this.setHeap(this._size, element);
    this.upHeap(this._size);
    return this.heap[1]!;
  }

  /**
   * Adds an Object to a PriorityQueue in log(size) time. It returns the object (if any) that was dropped off the
   * heap because it was full. This can be the given parameter (in case it is smaller than the full heap's minimum,
   * and couldn't be added), or another object that was previously the smallest value in the heap and now has been
   * replaced by a larger one, or null if the queue wasn't yet full with maxSize elements.
   */
  insertWithOverflow(element: T): T | null {
    if (this._size < this.maxSize) {
      this.add(element);
      return null;
    } else if (this._size > 0 && !this.lessThan(element, this.heap[1]!)) {
      const ret = this.heap[1]!;
      this.heap[1] = element;
      this.updateTop();
      return ret;
    } else {
      return element;
    }
  }

  /** Returns the least element of the PriorityQueue in constant time. */
  top(): T | null {
    // We don't need to check size here: if maxSize is 0, then heap is length 2 array with both entries null.
    // If size is 0 then heap[1] is already null.
    return this.heap[1]!;
  }

  /** Removes and returns the least element of the PriorityQueue in log(size) time. */
  pop(): T | null {
    if (this._size > 0) {
      const result = this.heap[1]!; // save first value
      this.heap[1] = this.heap[this._size]!; // move last to first
      this.heap[this._size] = null; // permit GC of objects
      this._size--;
      this.downHeap(1); // adjust heap
      return result;
    } else {
      return null;
    }
  }

  /**
   * Should be called when the Object at top changes values. Still log(n) worst case, but it's at least twice as
   * fast to
   * <pre class="prettyprint">
   * pq.top().change();
   * pq.updateTop();
   * </pre>
   * instead of
   * <pre class="prettyprint">
   * o = pq.pop();
   * o.change();
   * pq.push(o);
   * </pre>
   * @return the new 'top' element.
   */
  updateTop(): T | null;
  /** Replaces the top of the queue by newTop and re-heapifies. @return the new 'top' element. */
  updateTop(newTop: T): T | null;
  updateTop(newTop?: T): T | null {
    if (arguments.length === 1) this.heap[1] = newTop!;
    this.downHeap(1);
    return this.heap[1]!;
  }

  /** Returns the number of elements currently stored in the PriorityQueue. */
  size(): number {
    return this._size;
  }

  /** Removes all entries from the PriorityQueue. */
  clear(): void {
    for (let i = 0; i <= this._size; i++) {
      this.heap[i] = null;
    }
    this._size = 0;
  }

  /**
   * Removes an existing element currently stored in the PriorityQueue. Cost is linear with the size of the queue.
   * (A specialization of PriorityQueue which tracks element positions would provide a constant remove time but the
   * trade-off would be extra cost to all additions/insertions.)
   */
  remove(element: T): boolean {
    for (let i = 1; i <= this._size; i++) {
      if (this.heap[i] === element) {
        this.heap[i] = this.heap[this._size]!;
        this.heap[this._size] = null; // permit GC of objects
        this._size--;
        if (i <= this._size) {
          if (!this.upHeap(i)) {
            this.downHeap(i);
          }
        }
        return true;
      }
    }
    return false;
  }

  // heap[i] = x, with Java's ArrayIndexOutOfBoundsException when the queue is over-filled
  private setHeap(i: number, x: T): void {
    if (i >= this.heap.length) {
      throw new ArrayIndexOutOfBoundsException("Index " + i + " out of bounds for length " + this.heap.length);
    }
    this.heap[i] = x;
  }

  private upHeap(origPos: number): boolean {
    let i = origPos;
    const node = this.heap[i]!; // save bottom node
    let j = i >>> 1;
    while (j > 0 && this.lessThan(node, this.heap[j]!)) {
      this.heap[i] = this.heap[j]!; // shift parents down
      i = j;
      j = j >>> 1;
    }
    this.heap[i] = node; // install saved node
    return i !== origPos;
  }

  private downHeap(i: number): void {
    const node = this.heap[i]!; // save top node
    let j = i << 1; // find smaller child
    let k = j + 1;
    if (k <= this._size && this.lessThan(this.heap[k]!, this.heap[j]!)) {
      j = k;
    }
    while (j <= this._size && this.lessThan(this.heap[j]!, node)) {
      this.heap[i] = this.heap[j]!; // shift up child
      i = j;
      j = i << 1;
      k = j + 1;
      if (k <= this._size && this.lessThan(this.heap[k]!, this.heap[j]!)) {
        j = k;
      }
    }
    this.heap[i] = node; // install saved node
  }

  /**
   * This method returns the internal heap array as Object[].
   * @internal protected in Java
   */
  getHeapArray(): Array<T | null> {
    return this.heap;
  }
}
