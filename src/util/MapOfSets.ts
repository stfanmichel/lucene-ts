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

/**
 * Port of org.apache.lucene.util.MapOfSets: Helper class for keeping Lists of Objects associated with keys.
 * <b>WARNING: THIS CLASS IS NOT THREAD SAFE</b>
 * The sets are JS Sets (insertion order); Java's HashSet iteration order is not reproduced.
 */
export class MapOfSets<K, V> {
  private readonly theMap: Map<K, Set<V>>;

  /** @param m the backing store for this object */
  constructor(m: Map<K, Set<V>>) {
    this.theMap = m;
  }

  /** @return direct access to the map backing this object. */
  getMap(): Map<K, Set<V>> {
    return this.theMap;
  }

  /**
   * Adds val to the Set associated with key in the Map. If key is not already in the map, a new Set will first be
   * created.
   * @return the size of the Set associated with key once val is added to it.
   */
  put(key: K, val: V): number {
    let theSet: Set<V>;
    if (this.theMap.has(key)) {
      theSet = this.theMap.get(key)!;
    } else {
      theSet = new Set<V>();
      this.theMap.set(key, theSet);
    }
    theSet.add(val);
    return theSet.size;
  }

  /**
   * Adds multiple vals to the Set associated with key in the Map. If key is not already in the map, a new Set will
   * first be created.
   * @return the size of the Set associated with key once val is added to it.
   */
  putAll(key: K, vals: Iterable<V>): number {
    let theSet: Set<V>;
    if (this.theMap.has(key)) {
      theSet = this.theMap.get(key)!;
    } else {
      theSet = new Set<V>();
      this.theMap.set(key, theSet);
    }
    for (const v of vals) theSet.add(v);
    return theSet.size;
  }
}
