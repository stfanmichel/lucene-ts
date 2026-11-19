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

// Port of org.apache.lucene.util.Constants (Lucene 5.2.1), reduced to what makes sense off the JVM.
//
// Not ported: JVM_VENDOR, JVM_VERSION, JVM_NAME, JVM_SPEC_VERSION, JAVA_VERSION, JAVA_VENDOR (no JVM) and the
// deprecated LUCENE_MAIN_VERSION / LUCENE_VERSION (they need util.Version). The JRE_IS_* flags describe the
// Java platform the port stands for: a 64-bit Java 9+ runtime (the differential tests run on JDK 21).

import * as os from "node:os";

/** Java's os.name for the current platform */
function osName(): string {
  switch (process.platform) {
    case "linux":
      return "Linux";
    case "win32":
      return "Windows";
    case "darwin":
      return "Mac OS X";
    case "freebsd":
      return "FreeBSD";
    case "sunos":
      return "SunOS";
    default:
      return process.platform;
  }
}

export class Constants {
  private constructor() {} // can't construct

  /** The value of System.getProperty("os.name"). */
  static readonly OS_NAME: string = osName();
  /** True iff running on Linux. */
  static readonly LINUX: boolean = Constants.OS_NAME.startsWith("Linux");
  /** True iff running on Windows. */
  static readonly WINDOWS: boolean = Constants.OS_NAME.startsWith("Windows");
  /** True iff running on SunOS. */
  static readonly SUN_OS: boolean = Constants.OS_NAME.startsWith("SunOS");
  /** True iff running on Mac OS X */
  static readonly MAC_OS_X: boolean = Constants.OS_NAME.startsWith("Mac OS X");
  /** True iff running on FreeBSD */
  static readonly FREE_BSD: boolean = Constants.OS_NAME.startsWith("FreeBSD");

  static readonly OS_ARCH: string = os.arch();
  static readonly OS_VERSION: string = os.release();

  /** True iff the platform is 64 bit. */
  static readonly JRE_IS_64BIT: boolean = process.arch.includes("64");

  /** True iff running on a Java 8 or later runtime (always, for this port). */
  static readonly JRE_IS_MINIMUM_JAVA8: boolean = true;
  /** True iff running on a Java 9 or later runtime (always, for this port). */
  static readonly JRE_IS_MINIMUM_JAVA9: boolean = true;
}
