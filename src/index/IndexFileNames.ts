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

// Port of org.apache.lucene.index.IndexFileNames (Lucene 5.2.1).

import { lassert } from "../util/assertions.js";
import { Long } from "../util/JavaNumbers.js";
import { javaSplitChar } from "../util/JavaStrings.js";

/**
 * This class contains useful constants representing filenames and extensions used by lucene, as well as convenience
 * methods for querying whether a file name matches an extension ({@link matchesExtension}), as well as generating file
 * names from a segment name, generation and extension ({@link fileNameFromGeneration}, {@link segmentFileName}).
 *
 * <b>NOTE</b>: extensions used by codecs are not listed here. You must interact with the {@link Codec} directly.
 *
 * @lucene.internal
 */
export class IndexFileNames {
  private constructor() {}

  /** Name of the index segment file */
  static readonly SEGMENTS = "segments";

  /** Extension of gen file */
  static readonly PENDING_SEGMENTS = "pending_segments";

  /** Name of pending index segment file */
  static readonly OLD_SEGMENTS_GEN = "segments.gen";

  /**
   * Computes the full file name from base, extension and generation. If the generation is -1, the file name is null.
   * If it's 0, the file name is &lt;base&gt;.&lt;ext&gt;. If it's &gt; 0, the file name is &lt;base&gt;_&lt;gen&gt;.&lt;ext&gt;.<br>
   * <b>NOTE:</b> .&lt;ext&gt; is added to the name only if <code>ext</code> is not an empty string.
   *
   * @param base main part of the file name
   * @param ext extension of the filename
   * @param gen generation
   */
  static fileNameFromGeneration(base: string, ext: string, gen: bigint | number): string | null {
    const g = BigInt(gen);
    if (g === -1n) {
      return null;
    } else if (g === 0n) {
      return IndexFileNames.segmentFileName(base, "", ext);
    } else {
      lassert(() => g > 0n);
      // The '6' part in the length is: 1 for '.', 1 for '_' and 4 as estimate to the gen
      let res = base + "_" + g.toString(36);
      if (ext.length > 0) {
        res += "." + ext;
      }
      return res;
    }
  }

  /**
   * Returns a file name that includes the given segment name, your own custom name and extension. The format of the
   * filename is: &lt;segmentName&gt;(_&lt;name&gt;)(.&lt;ext&gt;).
   *
   * <b>NOTE:</b> .&lt;ext&gt; is added to the result file name only if <code>ext</code> is not empty.
   *
   * <b>NOTE:</b> _&lt;segmentSuffix&gt; is added to the result file name only if it's not the empty string
   *
   * <b>NOTE:</b> all custom files should be named using this method, or otherwise some structures may fail to handle them properly (such as if they are added to compound files).
   */
  static segmentFileName(segmentName: string, segmentSuffix: string, ext: string): string {
    if (ext.length > 0 || segmentSuffix.length > 0) {
      lassert(() => !ext.startsWith("."));
      let sb = segmentName;
      if (segmentSuffix.length > 0) {
        sb += "_" + segmentSuffix;
      }
      if (ext.length > 0) {
        sb += "." + ext;
      }
      return sb;
    } else {
      return segmentName;
    }
  }

  /** Returns true if the given filename ends with the given extension. One should provide a <i>pure</i> extension, without '.'. */
  static matchesExtension(filename: string, ext: string): boolean {
    // It doesn't make a difference whether we allocate a StringBuilder ourself
    // or not, since there's only 1 '+' operator.
    return filename.endsWith("." + ext);
  }

  /** locates the boundary of the segment name, or -1 */
  private static indexOfSegmentName(filename: string): number {
    // If it is a .del file, there's an '_' after the first character
    let idx = filename.indexOf("_", 1);
    if (idx === -1) {
      // If it's not, strip everything that's before the '.'
      idx = filename.indexOf(".");
    }
    return idx;
  }

  /**
   * Strips the segment name out of the given file name. If you used {@link segmentFileName} or
   * {@link fileNameFromGeneration} to create your files, then this method simply removes whatever comes before the
   * first '.', or the second '_' (excluding both).
   *
   * @return the filename with the segment name removed, or the given filename if it does not contain a '.' and '_'.
   */
  static stripSegmentName(filename: string): string {
    // If it is a .del file, there's an '_' after the first character
    const idx = IndexFileNames.indexOfSegmentName(filename);
    if (idx !== -1) {
      filename = filename.substring(idx);
    }
    return filename;
  }

  /**
   * Parses the segment name out of the given file name.
   *
   * @return the segment name only, or filename if it does not contain a '.' and '_'.
   */
  static parseSegmentName(filename: string): string {
    const idx = IndexFileNames.indexOfSegmentName(filename);
    if (idx !== -1) {
      filename = filename.substring(0, idx);
    }
    return filename;
  }

  /** Removes the extension (anything after the first '.'), otherwise returns the original filename. */
  static stripExtension(filename: string): string {
    const idx = filename.indexOf(".");
    if (idx !== -1) {
      filename = filename.substring(0, idx);
    }
    return filename;
  }

  /** Return the extension (anything after the first '.'), or null if there is no '.' in the file name. */
  static getExtension(filename: string): string | null {
    const idx = filename.indexOf(".");
    if (idx === -1) {
      return null;
    } else {
      return filename.substring(idx + 1, filename.length);
    }
  }

  /**
   * Parses the generation off the file name. (Java returns a long; here a bigint, as the value is parsed in base 36.)
   */
  static parseGeneration(filename: string): bigint {
    lassert(() => filename.startsWith("_"));
    // 4 cases:
    // segment file: _[a-z0-9]+(_.*)?
    // per-commit file: _[a-z0-9]+_[a-z0-9]+(_.*)?
    const parts = javaSplitChar(IndexFileNames.stripExtension(filename).substring(1), "_");
    // 4 cases:
    // segment.ext
    // segment_gen.ext
    // segment_codec_suffix.ext
    // segment_gen_codec_suffix.ext
    if (parts.length === 2 || parts.length === 4) {
      return Long.parseLong(parts[1]!, 36);
    } else {
      return 0n;
    }
  }

  /**
   * All files created by codecs much match this pattern (checked in SegmentInfo). Java's Pattern.matches = a full match, hence the anchors; '.' excludes Java's line terminators.
   */
  static readonly CODEC_FILE_PATTERN: RegExp = /^_[a-z0-9]+(_[^\n\r\u0085\u2028\u2029]*)?\.[^\n\r\u0085\u2028\u2029]*$/;
}
