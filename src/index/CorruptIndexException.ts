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

// Port of org.apache.lucene.index.CorruptIndexException (Lucene 5.2.1).
//
// Deviation: the Java constructors taking a DataInput or a DataOutput (Objects.toString(input)) and the one
// taking a resource description String are one constructor here: any non-string argument is rendered with String().

import { IOException } from "../errors.js";

/**
 * This exception is thrown when Lucene detects an inconsistency in the index.
 */
export class CorruptIndexException extends IOException {
  /** Create exception with a message only (resource: a DataInput/DataOutput or its description) */
  constructor(message: string | null, resource: unknown, cause?: unknown) {
    super(String(message) + " (resource=" + String(resource) + ")", cause === undefined || cause === null ? undefined : { cause });
    this.name = "CorruptIndexException";
  }
}
