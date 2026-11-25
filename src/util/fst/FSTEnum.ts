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

// Port of org.apache.lucene.util.fst.FSTEnum (Lucene 5.2.1).
//
// Deviation: the Java arrays arcs/output grow with ArrayUtil.oversize; plain arrays here (same growth).

import { lassert } from "../assertions.js";
import { ArrayUtil } from "../ArrayUtil.js";
import { RamUsageEstimator } from "../RamUsageEstimator.js";
import { FST, FSTArc } from "./FST.js";
import type { FSTBytesReader } from "./FSTBytesReader.js";

/**
 * Can next() and advance() through the terms in an FST
 *
 * @lucene.experimental
 */
export abstract class FSTEnum<T> {
  protected readonly fst: FST<T>;

  protected arcs: (FSTArc<T> | undefined)[] = new Array<FSTArc<T> | undefined>(10);
  // outputs are cumulative
  protected output: T[] = new Array<T>(10);

  protected readonly NO_OUTPUT: T;
  protected readonly fstReader: FSTBytesReader;

  protected readonly scratchArc = new FSTArc<T>();

  protected upto = 0;
  protected targetLength = 0;

  /**
   * doFloor controls the behavior of advance: if it's true doFloor is true, advance positions to the biggest term
   * before target.
   */
  protected constructor(fst: FST<T>) {
    this.fst = fst;
    this.fstReader = fst.getBytesReader();
    this.NO_OUTPUT = fst.outputs.getNoOutput();
    fst.getFirstArc(this.getArc(0));
    this.output[0] = this.NO_OUTPUT;
  }

  protected abstract getTargetLabel(): number;
  protected abstract getCurrentLabel(): number;
  protected abstract setCurrentLabel(label: number): void;
  protected abstract grow(): void;

  /** Rewinds enum state to match the shared prefix between current term and target term */
  protected rewindPrefix(): void {
    if (this.upto === 0) {
      //System.out.println("  init");
      this.upto = 1;
      this.fst.readFirstTargetArc(this.getArc(0), this.getArc(1), this.fstReader);
      return;
    }
    //System.out.println("  rewind upto=" + upto + " vs targetLength=" + targetLength);

    const currentLimit = this.upto;
    this.upto = 1;
    while (this.upto < currentLimit && this.upto <= this.targetLength + 1) {
      const cmp = this.getCurrentLabel() - this.getTargetLabel();
      if (cmp < 0) {
        // seek forward
        //System.out.println("    seek fwd");
        break;
      } else if (cmp > 0) {
        // seek backwards -- reset this arc to the first arc
        const arc = this.getArc(this.upto);
        this.fst.readFirstTargetArc(this.getArc(this.upto - 1), arc, this.fstReader);
        //System.out.println("    seek first arc");
        break;
      }
      this.upto++;
    }
    //System.out.println("  fall through upto=" + upto);
  }

  protected doNext(): void {
    //System.out.println("FE: next upto=" + upto);
    if (this.upto === 0) {
      //System.out.println("  init");
      this.upto = 1;
      this.fst.readFirstTargetArc(this.getArc(0), this.getArc(1), this.fstReader);
    } else {
      // pop
      //System.out.println("  check pop curArc target=" + arcs[upto].target + " label=" + arcs[upto].label + " isLast?=" + arcs[upto].isLast());
      while (this.arcs[this.upto]!.isLast()) {
        this.upto--;
        if (this.upto === 0) {
          //System.out.println("  eof");
          return;
        }
      }
      this.fst.readNextArc(this.arcs[this.upto]!, this.fstReader);
    }

    this.pushFirst();
  }

  // TODO: should we return a status here (SEEK_FOUND / SEEK_NOT_FOUND /
  // SEEK_END)?  saves the eq check above?

  /** Seeks to smallest term that's &gt;= target. */
  protected doSeekCeil(): void {
    //System.out.println("    advance len=" + target.length + " curlen=" + current.length);

    // TODO: possibly caller could/should provide a
    // hint of how many bytes to match... the common prefix
    // from the last seek is not guaranteed to be the same as the prior seek

    this.rewindPrefix();
    //System.out.println("  after rewind upto=" + upto);

    let arc = this.getArc(this.upto);
    //System.out.println("  init targetLabel=" + targetLabel);

    // Now scan forward, matching the new suffix of the target
    let targetLabel = this.getTargetLabel();
    for (;;) {
      //System.out.println("  cycle upto=" + upto + " arc.label=" + arc.label + " (" + (char) arc.label + ") vs targetLabel=" + targetLabel);

      if (arc.bytesPerArc !== 0 && arc.label !== -1) {
        // Arcs are fixed array -- use binary search to find
        // the target.

        const input = this.fst.getBytesReader();
        let low = arc.arcIdx;
        let high = arc.numArcs - 1;
        let mid = 0;
        //System.out.println("do arc array low=" + low + " high=" + high + " targetLabel=" + targetLabel);
        let found = false;
        while (low <= high) {
          mid = (low + high) >>> 1;
          input.setPosition(arc.posArcsStart);
          input.skipBytes(arc.bytesPerArc * mid + 1);
          const midLabel = this.fst.readLabel(input);
          const cmp = midLabel - targetLabel;
          //System.out.println("  cycle low=" + low + " high=" + high + " mid=" + mid + " midLabel=" + midLabel + " cmp=" + cmp);
          if (cmp < 0) low = mid + 1;
          else if (cmp > 0) high = mid - 1;
          else {
            found = true;
            break;
          }
        }

        // NOTE: this code is dup'd w/ the code below (in
        // the outer else clause):
        if (found) {
          // Match
          arc.arcIdx = mid - 1;
          this.fst.readNextRealArc(arc, input);
          const m = mid;
          lassert(() => arc.arcIdx === m);
          lassert(
            () => arc.label === targetLabel,
            () => "arc.label=" + arc.label + " vs targetLabel=" + targetLabel + " mid=" + m,
          );
          this.output[this.upto] = this.fst.outputs.add(this.output[this.upto - 1], arc.output);
          if (targetLabel === FST.END_LABEL) {
            return;
          }
          this.setCurrentLabel(arc.label);
          this.incr();
          arc = this.fst.readFirstTargetArc(arc, this.getArc(this.upto), this.fstReader);
          targetLabel = this.getTargetLabel();
          continue;
        } else if (low === arc.numArcs) {
          // Dead end
          arc.arcIdx = arc.numArcs - 2;
          this.fst.readNextRealArc(arc, input);
          lassert(() => arc.isLast());
          // Dead end (target is after the last arc);
          // rollback to last fork then push
          this.upto--;
          for (;;) {
            if (this.upto === 0) {
              return;
            }
            const prevArc = this.getArc(this.upto);
            //System.out.println("  rollback upto=" + upto + " arc.label=" + prevArc.label + " isLast?=" + prevArc.isLast());
            if (!prevArc.isLast()) {
              this.fst.readNextArc(prevArc, this.fstReader);
              this.pushFirst();
              return;
            }
            this.upto--;
          }
        } else {
          arc.arcIdx = (low > high ? low : high) - 1;
          this.fst.readNextRealArc(arc, input);
          lassert(() => arc.label > targetLabel);
          this.pushFirst();
          return;
        }
      } else {
        // Arcs are not array'd -- must do linear scan:
        if (arc.label === targetLabel) {
          // recurse
          this.output[this.upto] = this.fst.outputs.add(this.output[this.upto - 1], arc.output);
          if (targetLabel === FST.END_LABEL) {
            return;
          }
          this.setCurrentLabel(arc.label);
          this.incr();
          arc = this.fst.readFirstTargetArc(arc, this.getArc(this.upto), this.fstReader);
          targetLabel = this.getTargetLabel();
        } else if (arc.label > targetLabel) {
          this.pushFirst();
          return;
        } else if (arc.isLast()) {
          // Dead end (target is after the last arc);
          // rollback to last fork then push
          this.upto--;
          for (;;) {
            if (this.upto === 0) {
              return;
            }
            const prevArc = this.getArc(this.upto);
            //System.out.println("  rollback upto=" + upto + " arc.label=" + prevArc.label + " isLast?=" + prevArc.isLast());
            if (!prevArc.isLast()) {
              this.fst.readNextArc(prevArc, this.fstReader);
              this.pushFirst();
              return;
            }
            this.upto--;
          }
        } else {
          // keep scanning
          //System.out.println("    next scan");
          this.fst.readNextArc(arc, this.fstReader);
        }
      }
    }
  }

  // TODO: should we return a status here (SEEK_FOUND / SEEK_NOT_FOUND /
  // SEEK_END)?  saves the eq check above?
  /** Seeks to largest term that's &lt;= target. */
  protected doSeekFloor(): void {
    // TODO: possibly caller could/should provide a
    // hint of how many bytes to match... the common prefix
    // from the last seek is not guaranteed to be the same as the prior seek

    //System.out.println("    advance len=" + target.length + " curlen=" + current.length);

    // TODO: possibly caller could/should provide a
    // hint of how many bytes to match... the common prefix
    // from the last seek is not guaranteed to be the same as the prior seek

    this.rewindPrefix();

    //System.out.println("  after rewind upto=" + upto);

    let arc = this.getArc(this.upto);
    //System.out.println("  init targetLabel=" + targetLabel);

    // Now scan forward, matching the new suffix of the target
    let targetLabel = this.getTargetLabel();
    for (;;) {
      //System.out.println("  cycle upto=" + upto + " arc.label=" + arc.label + " (" + (char) arc.label + ") targetLabel=" + targetLabel + " isLast?=" + arc.isLast() + " bba=" + arc.bytesPerArc);

      if (arc.bytesPerArc !== 0 && arc.label !== FST.END_LABEL) {
        // Arcs are fixed array -- use binary search to find the target.

        const input = this.fst.getBytesReader();
        let low = arc.arcIdx;
        let high = arc.numArcs - 1;
        let mid = 0;
        //System.out.println("do arc array low=" + low + " high=" + high + " targetLabel=" + targetLabel);
        let found = false;
        while (low <= high) {
          mid = (low + high) >>> 1;
          input.setPosition(arc.posArcsStart);
          input.skipBytes(arc.bytesPerArc * mid + 1);
          const midLabel = this.fst.readLabel(input);
          const cmp = midLabel - targetLabel;
          //System.out.println("  cycle low=" + low + " high=" + high + " mid=" + mid + " midLabel=" + midLabel + " cmp=" + cmp);
          if (cmp < 0) {
            low = mid + 1;
          } else if (cmp > 0) {
            high = mid - 1;
          } else {
            found = true;
            break;
          }
        }

        // NOTE: this code is dup'd w/ the code below (in
        // the outer else clause):
        if (found) {
          // Match -- recurse
          //System.out.println("  match!  arcIdx=" + mid);
          arc.arcIdx = mid - 1;
          this.fst.readNextRealArc(arc, input);
          const m = mid;
          lassert(() => arc.arcIdx === m);
          lassert(
            () => arc.label === targetLabel,
            () => "arc.label=" + arc.label + " vs targetLabel=" + targetLabel + " mid=" + m,
          );
          this.output[this.upto] = this.fst.outputs.add(this.output[this.upto - 1], arc.output);
          if (targetLabel === FST.END_LABEL) {
            return;
          }
          this.setCurrentLabel(arc.label);
          this.incr();
          arc = this.fst.readFirstTargetArc(arc, this.getArc(this.upto), this.fstReader);
          targetLabel = this.getTargetLabel();
          continue;
        } else if (high === -1) {
          //System.out.println("  before first");
          // Very first arc is after our target
          // TODO: if each arc could somehow read the arc just
          // before, we can save this re-scan.  The ceil case
          // doesn't need this because it reads the next arc
          // instead:
          for (;;) {
            // First, walk backwards until we find a first arc
            // that's before our target label:
            this.fst.readFirstTargetArc(this.getArc(this.upto - 1), arc, this.fstReader);
            if (arc.label < targetLabel) {
              // Then, scan forwards to the arc just before
              // the targetLabel:
              while (!arc.isLast() && this.fst.readNextArcLabel(arc, input) < targetLabel) {
                this.fst.readNextArc(arc, this.fstReader);
              }
              this.pushLast();
              return;
            }
            this.upto--;
            if (this.upto === 0) {
              return;
            }
            targetLabel = this.getTargetLabel();
            arc = this.getArc(this.upto);
          }
        } else {
          // There is a floor arc:
          arc.arcIdx = (low > high ? high : low) - 1;
          //System.out.println(" hasFloor arcIdx=" + (arc.arcIdx+1));
          this.fst.readNextRealArc(arc, input);
          lassert(() => arc.isLast() || this.fst.readNextArcLabel(arc, input) > targetLabel);
          lassert(() => arc.label < targetLabel, () => "arc.label=" + arc.label + " vs targetLabel=" + targetLabel);
          this.pushLast();
          return;
        }
      } else {
        if (arc.label === targetLabel) {
          // Match -- recurse
          this.output[this.upto] = this.fst.outputs.add(this.output[this.upto - 1], arc.output);
          if (targetLabel === FST.END_LABEL) {
            return;
          }
          this.setCurrentLabel(arc.label);
          this.incr();
          arc = this.fst.readFirstTargetArc(arc, this.getArc(this.upto), this.fstReader);
          targetLabel = this.getTargetLabel();
        } else if (arc.label > targetLabel) {
          // TODO: if each arc could somehow read the arc just
          // before, we can save this re-scan.  The ceil case
          // doesn't need this because it reads the next arc
          // instead:
          for (;;) {
            // First, walk backwards until we find a first arc
            // that's before our target label:
            this.fst.readFirstTargetArc(this.getArc(this.upto - 1), arc, this.fstReader);
            if (arc.label < targetLabel) {
              // Then, scan forwards to the arc just before
              // the targetLabel:
              while (!arc.isLast() && this.fst.readNextArcLabel(arc, this.fstReader) < targetLabel) {
                this.fst.readNextArc(arc, this.fstReader);
              }
              this.pushLast();
              return;
            }
            this.upto--;
            if (this.upto === 0) {
              return;
            }
            targetLabel = this.getTargetLabel();
            arc = this.getArc(this.upto);
          }
        } else if (!arc.isLast()) {
          //System.out.println("  check next label=" + fst.readNextArcLabel(arc) + " (" + (char) fst.readNextArcLabel(arc) + ")");
          if (this.fst.readNextArcLabel(arc, this.fstReader) > targetLabel) {
            this.pushLast();
            return;
          } else {
            // keep scanning
            this.fst.readNextArc(arc, this.fstReader);
          }
        } else {
          this.pushLast();
          return;
        }
      }
    }
  }

  /** Seeks to exactly target term. */
  protected doSeekExact(): boolean {
    // TODO: possibly caller could/should provide a
    // hint of how many bytes to match... the common prefix
    // from the last seek is not guaranteed to be the same as the prior seek

    //System.out.println("FE: seek exact upto=" + upto);

    // Save time by starting at the end of the shared prefix
    // b/w our current term & the target:
    this.rewindPrefix();

    //System.out.println("FE: after rewind upto=" + upto);
    let arc = this.getArc(this.upto - 1);
    let targetLabel = this.getTargetLabel();

    const fstReader = this.fst.getBytesReader();

    for (;;) {
      //System.out.println("  cycle target=" + (targetLabel == -1 ? "-1" : (char) targetLabel));
      const nextArc = this.fst.findTargetArc(targetLabel, arc, this.getArc(this.upto), fstReader);
      if (nextArc === null) {
        // short circuit
        //upto--;
        //upto = 0;
        this.fst.readFirstTargetArc(arc, this.getArc(this.upto), fstReader);
        //System.out.println("  no match upto=" + upto);
        return false;
      }
      // Match -- recurse:
      this.output[this.upto] = this.fst.outputs.add(this.output[this.upto - 1], nextArc.output);
      if (targetLabel === FST.END_LABEL) {
        //System.out.println("  return found; upto=" + upto + " output=" + output[upto] + " nextArc=" + nextArc.isLast());
        return true;
      }
      this.setCurrentLabel(targetLabel);
      this.incr();
      targetLabel = this.getTargetLabel();
      arc = nextArc;
    }
  }

  private incr(): void {
    this.upto++;
    this.grow();
    if (this.arcs.length <= this.upto) {
      const newArcs = new Array<FSTArc<T> | undefined>(ArrayUtil.oversize(1 + this.upto, RamUsageEstimator.NUM_BYTES_OBJECT_REF));
      for (let i = 0; i < this.arcs.length; i++) newArcs[i] = this.arcs[i];
      this.arcs = newArcs;
    }
    if (this.output.length <= this.upto) {
      const newOutput = new Array<T>(ArrayUtil.oversize(1 + this.upto, RamUsageEstimator.NUM_BYTES_OBJECT_REF));
      for (let i = 0; i < this.output.length; i++) newOutput[i] = this.output[i]!;
      this.output = newOutput;
    }
  }

  // Appends current arc, and then recurses from its target,
  // appending first arc all the way to the final node
  private pushFirst(): void {
    let arc = this.arcs[this.upto]!;
    lassert(() => arc !== null && arc !== undefined);

    //System.out.println("  pushFirst");
    for (;;) {
      this.output[this.upto] = this.fst.outputs.add(this.output[this.upto - 1], arc.output);
      if (arc.label === FST.END_LABEL) {
        // Final node
        break;
      }
      //System.out.println("  pushFirst label=" + (char) arc.label + " upto=" + upto + " output=" + fst.outputs.outputToString(output[upto]));
      this.setCurrentLabel(arc.label);
      this.incr();

      const nextArc = this.getArc(this.upto);
      this.fst.readFirstTargetArc(arc, nextArc, this.fstReader);
      arc = nextArc;
    }
  }

  // Recurses from current arc, appending last arc all the
  // way to the first final node
  private pushLast(): void {
    let arc = this.arcs[this.upto]!;
    lassert(() => arc !== null && arc !== undefined);

    for (;;) {
      this.setCurrentLabel(arc.label);
      this.output[this.upto] = this.fst.outputs.add(this.output[this.upto - 1], arc.output);
      if (arc.label === FST.END_LABEL) {
        // Final node
        break;
      }
      this.incr();

      arc = this.fst.readLastTargetArc(arc, this.getArc(this.upto), this.fstReader);
    }
  }

  private getArc(idx: number): FSTArc<T> {
    if (this.arcs[idx] === undefined) {
      this.arcs[idx] = new FSTArc<T>();
    }
    return this.arcs[idx]!;
  }
}
