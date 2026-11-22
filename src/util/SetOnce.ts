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

import { IllegalStateException } from "../errors.js";

/**
 * Port of org.apache.lucene.util.SetOnce: A convenient class which offers a semi-immutable object wrapper
 * implementation which allows one to set the value of an object exactly once, and retrieve it many times.
 * Thread-safety is not needed here (single-threaded port).
 */
export class SetOnce<T> {
  /** Thrown when {@link SetOnce#set(Object)} is called more than once. */
  static readonly AlreadySetException = class AlreadySetException extends IllegalStateException {
    constructor() {
      super("The object cannot be set twice!");
      this.name = "AlreadySetException";
    }
  };

  private obj: T | null = null;
  private isSet: boolean;

  /** A default constructor which does not set the internal object, and allows setting it by calling {@link #set(Object)}. */
  constructor();
  /** Creates a new instance with the internal object set to the given object (even `null`). */
  constructor(obj: T | null);
  constructor(obj?: T | null) {
    if (arguments.length === 0) {
      this.isSet = false;
    } else {
      this.obj = obj as T | null;
      this.isSet = true;
    }
  }

  /** Sets the given object. If the object has already been set, an exception is thrown. */
  set(obj: T | null): void {
    if (!this.isSet) {
      this.isSet = true;
      this.obj = obj;
    } else {
      throw new SetOnce.AlreadySetException();
    }
  }

  /** Returns the object set by {@link #set(Object)}. */
  get(): T | null {
    return this.obj;
  }
}
