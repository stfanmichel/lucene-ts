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

// Port of org.apache.lucene.store.AlreadyClosedException (Lucene 5.2.1).

import { IllegalStateException } from "../errors.js";

/**
 * This exception is thrown when there is an attempt to
 * access something that has already been closed.
 */
export class AlreadyClosedException extends IllegalStateException {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "AlreadyClosedException";
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}
