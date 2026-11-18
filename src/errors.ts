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
 * Equivalents of the java.lang exceptions that Lucene throws or relies on.
 * The Java names are kept so that code ported from Lucene stays recognizable.
 */

export class IllegalArgumentException extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "IllegalArgumentException";
  }
}

export class IllegalStateException extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "IllegalStateException";
  }
}

export class IndexOutOfBoundsException extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "IndexOutOfBoundsException";
  }
}

export class ArrayIndexOutOfBoundsException extends IndexOutOfBoundsException {
  constructor(message?: string) {
    super(message);
    this.name = "ArrayIndexOutOfBoundsException";
  }
}

export class UnsupportedOperationException extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "UnsupportedOperationException";
  }
}

/** Thrown when a Lucene `assert` fails (see {@link lassert}). */
export class AssertionError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "AssertionError";
  }
}

/** java.lang.NumberFormatException (an IllegalArgumentException in Java too). */
export class NumberFormatException extends IllegalArgumentException {
  constructor(message?: string) {
    super(message);
    this.name = "NumberFormatException";
  }
}

/** java.lang.RuntimeException */
export class RuntimeException extends Error {
  constructor(message?: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RuntimeException";
  }
}

/** java.lang.NegativeArraySizeException (message: the offending size, as in Java) */
export class NegativeArraySizeException extends RuntimeException {
  constructor(message?: string) {
    super(message);
    this.name = "NegativeArraySizeException";
  }
}

/** java.io.IOException */
export class IOException extends Error {
  constructor(message?: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "IOException";
  }
}

/** java.io.EOFException */
export class EOFException extends IOException {
  constructor(message?: string) {
    super(message);
    this.name = "EOFException";
  }
}
