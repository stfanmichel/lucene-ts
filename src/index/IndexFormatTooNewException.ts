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

// Port of org.apache.lucene.index.IndexFormatTooNewException (Lucene 5.2.1).
//
// Deviation: the two Java constructors (resource String / DataInput) are one; resource is rendered with String().

import { IOException } from "../errors.js";

/**
 * This exception is thrown when Lucene detects an index that is newer than this Lucene version.
 */
export class IndexFormatTooNewException extends IOException {
  constructor(resource: unknown, version: number, minVersion: number, maxVersion: number) {
    super(
      "Format version is not supported (resource " + String(resource) + "): " + version +
        " (needs to be between " + minVersion + " and " + maxVersion + ")",
    );
    this.name = "IndexFormatTooNewException";
  }
}
