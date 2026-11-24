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

// Port of org.apache.lucene.util.Version (Lucene 5.2.1).
//
// Deviations: ParseException is errors.ParseException (checked exception in Java); the Java constructors are private;
// toUpperCase() is not Locale.ROOT-specific but JS has no locale-dependent case mapping without an argument.

import { IllegalArgumentException, ParseException } from "../errors.js";
import { lassert } from "./assertions.js";
import { Integer } from "./JavaNumbers.js";
import { StrictStringTokenizer } from "./StrictStringTokenizer.js";

/**
 * Use by certain classes to match version compatibility across releases of Lucene.
 *
 * <b>WARNING</b>: When changing the version parameter that you supply to components in Lucene, do not simply change
 * the version at search-time, but instead also adjust your indexing code to match, and re-index.
 */
export class Version {
  /** Match settings and bugs in Lucene's 4.0.0.ALPHA release. @deprecated */
  static readonly LUCENE_4_0_0_ALPHA: Version = new Version(4, 0, 0, 0);

  /** Match settings and bugs in Lucene's 4.0.0.BETA release. @deprecated */
  static readonly LUCENE_4_0_0_BETA: Version = new Version(4, 0, 0, 1);

  /** Match settings and bugs in Lucene's 4.0.0 release. @deprecated */
  static readonly LUCENE_4_0_0: Version = new Version(4, 0, 0, 2);

  /** Match settings and bugs in Lucene's 4.1.0 release. @deprecated */
  static readonly LUCENE_4_1_0: Version = new Version(4, 1, 0);

  /** Match settings and bugs in Lucene's 4.2.0 release. @deprecated */
  static readonly LUCENE_4_2_0: Version = new Version(4, 2, 0);

  /** Match settings and bugs in Lucene's 4.2.1 release. @deprecated */
  static readonly LUCENE_4_2_1: Version = new Version(4, 2, 1);

  /** Match settings and bugs in Lucene's 4.3.0 release. @deprecated */
  static readonly LUCENE_4_3_0: Version = new Version(4, 3, 0);

  /** Match settings and bugs in Lucene's 4.3.1 release. @deprecated */
  static readonly LUCENE_4_3_1: Version = new Version(4, 3, 1);

  /** Match settings and bugs in Lucene's 4.4.0 release. @deprecated */
  static readonly LUCENE_4_4_0: Version = new Version(4, 4, 0);

  /** Match settings and bugs in Lucene's 4.5.0 release. @deprecated */
  static readonly LUCENE_4_5_0: Version = new Version(4, 5, 0);

  /** Match settings and bugs in Lucene's 4.5.1 release. @deprecated */
  static readonly LUCENE_4_5_1: Version = new Version(4, 5, 1);

  /** Match settings and bugs in Lucene's 4.6.0 release. @deprecated */
  static readonly LUCENE_4_6_0: Version = new Version(4, 6, 0);

  /** Match settings and bugs in Lucene's 4.6.1 release. @deprecated */
  static readonly LUCENE_4_6_1: Version = new Version(4, 6, 1);

  /** Match settings and bugs in Lucene's 4.7.0 release. @deprecated */
  static readonly LUCENE_4_7_0: Version = new Version(4, 7, 0);

  /** Match settings and bugs in Lucene's 4.7.1 release. @deprecated */
  static readonly LUCENE_4_7_1: Version = new Version(4, 7, 1);

  /** Match settings and bugs in Lucene's 4.7.2 release. @deprecated */
  static readonly LUCENE_4_7_2: Version = new Version(4, 7, 2);

  /** Match settings and bugs in Lucene's 4.8.0 release. @deprecated */
  static readonly LUCENE_4_8_0: Version = new Version(4, 8, 0);

  /** Match settings and bugs in Lucene's 4.8.1 release. @deprecated */
  static readonly LUCENE_4_8_1: Version = new Version(4, 8, 1);

  /** Match settings and bugs in Lucene's 4.9.0 release. @deprecated */
  static readonly LUCENE_4_9_0: Version = new Version(4, 9, 0);

  /** Match settings and bugs in Lucene's 4.9.1 release. @deprecated */
  static readonly LUCENE_4_9_1: Version = new Version(4, 9, 1);

  /** Match settings and bugs in Lucene's 4.10.0 release. @deprecated */
  static readonly LUCENE_4_10_0: Version = new Version(4, 10, 0);

  /** Match settings and bugs in Lucene's 4.10.1 release. @deprecated */
  static readonly LUCENE_4_10_1: Version = new Version(4, 10, 1);

  /** Match settings and bugs in Lucene's 4.10.2 release. @deprecated */
  static readonly LUCENE_4_10_2: Version = new Version(4, 10, 2);

  /** Match settings and bugs in Lucene's 4.10.3 release. @deprecated */
  static readonly LUCENE_4_10_3: Version = new Version(4, 10, 3);

  /** Match settings and bugs in Lucene's 4.10.4 release. @deprecated */
  static readonly LUCENE_4_10_4: Version = new Version(4, 10, 4);

  /** Match settings and bugs in Lucene's 5.0.0 release. @deprecated */
  static readonly LUCENE_5_0_0: Version = new Version(5, 0, 0);

  /** Match settings and bugs in Lucene's 5.1.0 release. @deprecated */
  static readonly LUCENE_5_1_0: Version = new Version(5, 1, 0);

  /** Match settings and bugs in Lucene's 5.2.0 release. @deprecated */
  static readonly LUCENE_5_2_0: Version = new Version(5, 2, 0);

  /** Match settings and bugs in Lucene's 5.2.1 release. */
  static readonly LUCENE_5_2_1: Version = new Version(5, 2, 1);

  /** Match settings and bugs in the latest Lucene release. */
  static readonly LATEST: Version = Version.LUCENE_5_2_1;

  /** @deprecated Use latest */
  static readonly LUCENE_CURRENT: Version = Version.LATEST;

  /** @deprecated (5.0) Use latest */
  static readonly LUCENE_4_0: Version = Version.LUCENE_4_0_0_ALPHA;

  /** @deprecated (5.0) Use latest */
  static readonly LUCENE_4_1: Version = Version.LUCENE_4_1_0;

  /** @deprecated (5.0) Use latest */
  static readonly LUCENE_4_2: Version = Version.LUCENE_4_2_0;

  /** @deprecated (5.0) Use latest */
  static readonly LUCENE_4_3: Version = Version.LUCENE_4_3_0;

  /** @deprecated (5.0) Use latest */
  static readonly LUCENE_4_4: Version = Version.LUCENE_4_4_0;

  /** @deprecated (5.0) Use latest */
  static readonly LUCENE_4_5: Version = Version.LUCENE_4_5_0;

  /** @deprecated (5.0) Use latest */
  static readonly LUCENE_4_6: Version = Version.LUCENE_4_6_0;

  /** @deprecated (5.0) Use latest */
  static readonly LUCENE_4_7: Version = Version.LUCENE_4_7_0;

  /** @deprecated (5.0) Use latest */
  static readonly LUCENE_4_8: Version = Version.LUCENE_4_8_0;

  /** @deprecated (5.0) Use latest */
  static readonly LUCENE_4_9: Version = Version.LUCENE_4_9_0;

  /**
   * Parse a version number of the form <code>"major.minor.bugfix.prerelease"</code>.
   *
   * Part <code>".bugfix"</code> and part <code>".prerelease"</code> are optional. Note that this is forwards compatible:
   * the parsed version does not have to exist as a constant.
   * @throws ParseException if the version string is not in the right form
   */
  static parse(version: string): Version {
    const tokens = new StrictStringTokenizer(version, ".");
    if (tokens.hasMoreTokens() === false) {
      throw new ParseException("Version is not in form major.minor.bugfix(.prerelease) (got: " + version + ")", 0);
    }

    const parseToken = (what: string, token: string): number => {
      try {
        return Integer.parseInt(token);
      } catch (nfe) {
        throw new ParseException('Failed to parse ' + what + ' version from "' + token + '" (got: ' + version + ")", 0).initCause(nfe);
      }
    };

    const major = parseToken("major", tokens.nextToken());

    if (tokens.hasMoreTokens() === false) {
      throw new ParseException("Version is not in form major.minor.bugfix(.prerelease) (got: " + version + ")", 0);
    }

    const minor = parseToken("minor", tokens.nextToken());

    let bugfix = 0;
    let prerelease = 0;
    if (tokens.hasMoreTokens()) {
      bugfix = parseToken("bugfix", tokens.nextToken());
      if (tokens.hasMoreTokens()) {
        prerelease = parseToken("prerelease", tokens.nextToken());
        if (prerelease === 0) {
          throw new ParseException("Invalid value " + prerelease + " for prerelease; should be 1 or 2 (got: " + version + ")", 0);
        }

        if (tokens.hasMoreTokens()) {
          // Too many tokens!
          throw new ParseException("Version is not in form major.minor.bugfix(.prerelease) (got: " + version + ")", 0);
        }
      }
    }

    try {
      return new Version(major, minor, bugfix, prerelease);
    } catch (iae) {
      if (iae instanceof IllegalArgumentException) {
        throw new ParseException('failed to parse version string "' + version + '": ' + iae.message, 0).initCause(iae);
      }
      throw iae;
    }
  }

  /**
   * Parse the given version number as a constant or dot based version.
   *
   * This method allows to use <code>"LUCENE_X_Y"</code> constant names, or version numbers in the form
   * <code>"x.y.z"</code>.
   * @throws ParseException if the version string is not in the right form
   */
  static parseLeniently(version: string): Version {
    const versionOrig = version;
    version = version.toUpperCase();
    switch (version) {
      case "LATEST":
      case "LUCENE_CURRENT":
        return Version.LATEST;
      case "LUCENE_4_0_0":
        return Version.LUCENE_4_0_0;
      case "LUCENE_4_0_0_ALPHA":
        return Version.LUCENE_4_0_0_ALPHA;
      case "LUCENE_4_0_0_BETA":
        return Version.LUCENE_4_0_0_BETA;
      default:
        version = version
          .replace(/^LUCENE_(\d+)_(\d+)_(\d+)$/, "$1.$2.$3")
          .replace(/^LUCENE_(\d+)_(\d+)$/, "$1.$2.0")
          .replace(/^LUCENE_(\d)(\d)$/, "$1.$2.0");
        try {
          return Version.parse(version);
        } catch (pe) {
          throw new ParseException(
            'failed to parse lenient version string "' + versionOrig + '": ' + (pe as Error).message,
            0,
          ).initCause(pe);
        }
    }
  }

  /**
   * Returns a new version based on raw numbers
   * @internal
   */
  static fromBits(major: number, minor: number, bugfix: number): Version {
    return new Version(major, minor, bugfix);
  }

  /** Major version, the difference between stable and trunk */
  readonly major: number;
  /** Minor version, incremented within the stable branch */
  readonly minor: number;
  /** Bugfix number, incremented on release branches */
  readonly bugfix: number;
  /** Prerelease version, currently 0 (alpha), 1 (beta), or 2 (final) */
  readonly prerelease: number;

  // stores the version pieces, with most significant pieces in high bits
  // ensures compare/onOrAfter work correctly
  private readonly encodedValue: number;

  private constructor(major: number, minor: number, bugfix: number, prerelease = 0) {
    this.major = major;
    this.minor = minor;
    this.bugfix = bugfix;
    this.prerelease = prerelease;
    // NOTE: do not enforce major version so we remain future proof, except to make sure it fits in the 8 bits we encode
    if (major > 255 || major < 0) {
      throw new IllegalArgumentException("Illegal major version: " + major);
    }
    if (minor > 255 || minor < 0) {
      throw new IllegalArgumentException("Illegal minor version: " + minor);
    }
    if (bugfix > 255 || bugfix < 0) {
      throw new IllegalArgumentException("Illegal bugfix version: " + bugfix);
    }
    if (prerelease > 2 || prerelease < 0) {
      throw new IllegalArgumentException("Illegal prerelease version: " + prerelease);
    }
    if (prerelease !== 0 && (minor !== 0 || bugfix !== 0)) {
      throw new IllegalArgumentException(
        "Prerelease version only supported with major release (got prerelease: " + prerelease + ", minor: " + minor + ", bugfix: " + bugfix + ")",
      );
    }

    this.encodedValue = (major << 18) | (minor << 10) | (bugfix << 2) | prerelease;

    lassert(() => this.encodedIsValid());
  }

  /** Returns true if this version is the same or after the version from the argument. */
  onOrAfter(other: Version): boolean {
    return this.encodedValue >= other.encodedValue;
  }

  toString(): string {
    if (this.prerelease === 0) {
      return "" + this.major + "." + this.minor + "." + this.bugfix;
    }
    return "" + this.major + "." + this.minor + "." + this.bugfix + "." + this.prerelease;
  }

  equals(o: unknown): boolean {
    return o !== null && o !== undefined && o instanceof Version && o.encodedValue === this.encodedValue;
  }

  // Used only by assert:
  private encodedIsValid(): boolean {
    lassert(() => this.major === ((this.encodedValue >>> 18) & 0xff));
    lassert(() => this.minor === ((this.encodedValue >>> 10) & 0xff));
    lassert(() => this.bugfix === ((this.encodedValue >>> 2) & 0xff));
    lassert(() => this.prerelease === (this.encodedValue & 0x03));
    return true;
  }

  hashCode(): number {
    return this.encodedValue;
  }
}
