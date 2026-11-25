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

// Port of org.apache.lucene.util.fst.FST (Lucene 5.2.1) -- READ PATH ONLY.
//
// Ported: the constructor that loads a saved FST from a DataInput (all of format versions VERSION_PACKED and
// VERSION_VINT_TARGET, packed or not), Arc, getFirstArc, readFirstTargetArc/readFirstRealTargetArc/readNextArc/
// readNextRealArc/readLastTargetArc/readNextArcLabel/findTargetArc (with the root arc cache), getBytesReader,
// ramBytesUsed/getChildResources/toString and the accessors.
// NOT ported yet (index writing): the building constructor, addNode, finish, save, setEmptyOutput, pack,
// countSingleChains (debug), GrowableWriter-backed nodeAddress/inCounts. An FST loaded from disk never has them
// (nodeAddress is always null there), so the nodeAddress == null branches are the only ones kept.
//
// Deviations: nested types are FSTArc (FST.Arc), FSTBytesReader (FST.BytesReader, in its own file to avoid an import
// cycle) and FSTInputType (FST.INPUT_TYPE), exposed as static aliases; the Java byte flags are numbers; node
// addresses, targets and positions are numbers; BASE_RAM_BYTES_USED and ARC_SHALLOW_RAM_BYTES_USED are the values
// RamUsageEstimator.shallowSizeOfInstance reports on a 64-bit HotSpot JVM with compressed oops.

import { IllegalArgumentException, IllegalStateException } from "../../errors.js";
import { CodecUtil } from "../../codecs/CodecUtil.js";
import type { DataInput } from "../../store/DataInput.js";
import type { Accountable } from "../Accountable.js";
import { Accountables } from "../Accountables.js";
import { lassert } from "../assertions.js";
import { Constants } from "../Constants.js";
import { Integer } from "../JavaNumbers.js";
import { PackedInts } from "../packed/PackedInts.js";
import type { PackedIntsReader } from "../packed/PackedInts.js";
import { RamUsageEstimator } from "../RamUsageEstimator.js";
import { BytesStore } from "./BytesStore.js";
import { FSTBytesReader } from "./FSTBytesReader.js";
import type { Outputs } from "./Outputs.js";

/** Specifies allowed range of each int input label for this FST. */
export enum FSTInputType {
  BYTE1 = "BYTE1",
  BYTE2 = "BYTE2",
  BYTE4 = "BYTE4",
}

/** Returns true if the node's flag has the given bit. */
function flagOf(flags: number, bit: number): boolean {
  return (flags & bit) !== 0;
}

function outputEquals(a: unknown, b: unknown): boolean {
  if (a !== null && typeof a === "object" && typeof (a as { equals?: unknown }).equals === "function") {
    return (a as { equals(o: unknown): boolean }).equals(b);
  }
  return a === b;
}

const BIT_FINAL_ARC = 1 << 0;
const BIT_LAST_ARC = 1 << 1;
const BIT_TARGET_NEXT = 1 << 2;

// TODO: we can free up a bit if we can nuke this:
const BIT_STOP_NODE = 1 << 3;

/** This flag is set if the arc has an output. */
const BIT_ARC_HAS_OUTPUT = 1 << 4;

const BIT_ARC_HAS_FINAL_OUTPUT = 1 << 5;

// Arcs are stored as fixed-size (per entry) array, so that we can find an arc by label using binary search.
// We do this when number of arcs is > NUM_ARCS_ARRAY:

// If set, the target node is delta coded vs current position:
const BIT_TARGET_DELTA = 1 << 6;

// We use this as a marker (because this one flag is illegal by itself ...):
const ARCS_AS_FIXED_ARRAY = BIT_ARC_HAS_FINAL_OUTPUT;

const FIXED_ARRAY_NUM_ARCS_SHALLOW = 5;

// Increment version to change it
const FILE_FORMAT_NAME = "FST";
const VERSION_START = 0;
void VERSION_START;
const VERSION_PACKED = 3;
const VERSION_VINT_TARGET = 4;

// Never serialized; just used to represent the virtual
// final node w/ no arcs:
const FINAL_END_NODE = -1;

// Never serialized; just used to represent the virtual
// non-final node w/ no arcs:
const NON_FINAL_END_NODE = 0;

/** If arc has this label then that arc is final/accepted */
const END_LABEL = -1;

/** Represents a single arc. */
export class FSTArc<T> {
  label = 0;
  output: T = null as unknown as T;

  /** From node (ord or address); currently only used when building an FST w/ willPackFST=true: @internal */
  node = 0;

  /** To node (ord or address) */
  target = 0;

  /** @internal */
  flags = 0;
  nextFinalOutput: T = null as unknown as T;

  // address (into the byte[]), or ord/address if label == END_LABEL
  /** @internal */
  nextArc = 0;

  /** Where we are in the array; only valid if bytesPerArc != 0. */
  posArcsStart = 0;

  /** Non-zero if this arc is part of an array, which means all arcs for the node are encoded with a fixed number of bytes so that we binary search or direct lookup. */
  bytesPerArc = 0;

  /** Where we are in the array; only valid if bytesPerArc != 0. */
  arcIdx = 0;

  /** How many arcs in the array; only valid if bytesPerArc != 0. */
  numArcs = 0;

  /** Returns this */
  copyFrom(other: FSTArc<T>): FSTArc<T> {
    this.node = other.node;
    this.label = other.label;
    this.target = other.target;
    this.flags = other.flags;
    this.output = other.output;
    this.nextFinalOutput = other.nextFinalOutput;
    this.nextArc = other.nextArc;
    this.bytesPerArc = other.bytesPerArc;

    // Must explicitly copy these because we reuse a single
    // arc across a series of readNextArc calls:
    if (this.bytesPerArc !== 0) {
      this.posArcsStart = other.posArcsStart;
      this.arcIdx = other.arcIdx;
      this.numArcs = other.numArcs;
    }
    return this;
  }

  /** @internal */
  flag(flag: number): boolean {
    return flagOf(this.flags, flag);
  }

  isLast(): boolean {
    return this.flag(BIT_LAST_ARC);
  }

  isFinal(): boolean {
    return this.flag(BIT_FINAL_ARC);
  }

  toString(): string {
    let b = "";
    b += "node=" + this.node;
    b += " target=" + this.target;
    b += " label=0x" + Integer.toHexString(this.label);
    if (this.flag(BIT_FINAL_ARC)) {
      b += " final";
    }
    if (this.flag(BIT_LAST_ARC)) {
      b += " last";
    }
    if (this.flag(BIT_TARGET_NEXT)) {
      b += " targetNext";
    }
    if (this.flag(BIT_STOP_NODE)) {
      b += " stop";
    }
    if (this.flag(BIT_ARC_HAS_OUTPUT)) {
      b += " output=" + String(this.output);
    }
    if (this.flag(BIT_ARC_HAS_FINAL_OUTPUT)) {
      b += " nextFinalOutput=" + String(this.nextFinalOutput);
    }
    if (this.bytesPerArc !== 0) {
      b += " arcArray(idx=" + this.arcIdx + " of " + this.numArcs + ")";
    }
    return b;
  }
}

/**
 * Represents an finite state machine (FST), using a compact byte[] format.
 * <p> The format is similar to what's used by Morfologik (http://sourceforge.net/projects/morfologik).
 *
 * <p> See the {@link org.apache.lucene.util.fst package documentation} for some simple examples.
 *
 * @lucene.experimental
 */
export class FST<T> implements Accountable {
  static readonly Arc = FSTArc;
  static readonly BytesReader = FSTBytesReader;
  static readonly INPUT_TYPE = FSTInputType;

  private static readonly BASE_RAM_BYTES_USED = 104;
  private static readonly ARC_SHALLOW_RAM_BYTES_USED = 72;

  /** @internal */
  static readonly BIT_FINAL_ARC = BIT_FINAL_ARC;
  /** @internal */
  static readonly BIT_LAST_ARC = BIT_LAST_ARC;
  /** @internal */
  static readonly BIT_TARGET_NEXT = BIT_TARGET_NEXT;
  /** @internal */
  static readonly BIT_STOP_NODE = BIT_STOP_NODE;
  /** This flag is set if the arc has an output. */
  static readonly BIT_ARC_HAS_OUTPUT = BIT_ARC_HAS_OUTPUT;
  /** @internal */
  static readonly BIT_ARC_HAS_FINAL_OUTPUT = BIT_ARC_HAS_FINAL_OUTPUT;
  /** @internal */
  static readonly FIXED_ARRAY_SHALLOW_DISTANCE = 3; // 0 => only root node.
  /** @internal */
  static readonly FIXED_ARRAY_NUM_ARCS_SHALLOW = FIXED_ARRAY_NUM_ARCS_SHALLOW;
  /** @internal */
  static readonly FIXED_ARRAY_NUM_ARCS_DEEP = 10;

  /** If arc has this label then that arc is final/accepted */
  static readonly END_LABEL = END_LABEL;

  /** Maximum number of bits per block (the default for the DataInput constructor). */
  static readonly DEFAULT_MAX_BLOCK_BITS = Constants.JRE_IS_64BIT ? 30 : 28;

  private reusedBytesPerArc: Int32Array = new Int32Array(0);

  readonly inputType: FSTInputType;

  // if non-null, this FST accepts the empty string and
  // produces this output
  /** @internal */
  emptyOutput: T | null;
  /** @internal */
  readonly bytes: BytesStore;

  private startNode = -1;

  readonly outputs: Outputs<T>;

  private readonly NO_OUTPUT: T;

  // Used for the BIT_TARGET_NEXT optimization (whereby
  // instead of storing the address of the target node for
  // a given arc, we mark a single bit noting that the next
  // node in the byte[] is the target node):
  nodeCount = 0;
  arcCount = 0;
  arcWithOutputCount = 0;

  private readonly packed: boolean;
  private nodeRefToAddress: PackedIntsReader | null;

  // Cache of the root arcs (indexed by label):
  private cachedRootArcs: (FSTArc<T> | null)[] | null = null;
  private cachedArcsBytesUsed = 0;

  private readonly version: number;

  /** Load a previously saved FST; maxBlockBits allows you to control the size of the byte[] pages used to hold the FST bytes. */
  constructor(input: DataInput, outputs: Outputs<T>, maxBlockBits: number = FST.DEFAULT_MAX_BLOCK_BITS) {
    this.outputs = outputs;

    if (maxBlockBits < 1 || maxBlockBits > 30) {
      throw new IllegalArgumentException("maxBlockBits should be 1 .. 30; got " + maxBlockBits);
    }

    // NOTE: only reads most recent format; we don't have
    // back-compat promise for FSTs (they are experimental):
    this.version = CodecUtil.checkHeader(input, FILE_FORMAT_NAME, VERSION_PACKED, VERSION_VINT_TARGET);
    this.packed = input.readByte() === 1;
    if (input.readByte() === 1) {
      // accepts empty string
      // 1 KB blocks:
      const emptyBytes = new BytesStore(10);
      const numBytes = input.readVInt();
      emptyBytes.copyBytes(input, numBytes);

      // De-serialize empty-string output:
      let reader: FSTBytesReader;
      if (this.packed) {
        reader = emptyBytes.getForwardReader();
      } else {
        reader = emptyBytes.getReverseReader();
        // NoOutputs uses 0 bytes when writing its output,
        // so we have to check here else BytesStore gets
        // angry:
        if (numBytes > 0) {
          reader.setPosition(numBytes - 1);
        }
      }
      this.emptyOutput = outputs.readFinalOutput(reader);
    } else {
      this.emptyOutput = null;
    }
    const t = input.readByte();
    switch (t) {
      case 0:
        this.inputType = FSTInputType.BYTE1;
        break;
      case 1:
        this.inputType = FSTInputType.BYTE2;
        break;
      case 2:
        this.inputType = FSTInputType.BYTE4;
        break;
      default:
        throw new IllegalStateException("invalid input type " + t);
    }
    if (this.packed) {
      this.nodeRefToAddress = PackedInts.getReader(input);
    } else {
      this.nodeRefToAddress = null;
    }
    this.startNode = Number(input.readVLong());
    this.nodeCount = Number(input.readVLong());
    this.arcCount = Number(input.readVLong());
    this.arcWithOutputCount = Number(input.readVLong());

    const numBytes = Number(input.readVLong());
    this.bytes = new BytesStore(input, numBytes, 1 << maxBlockBits);

    this.NO_OUTPUT = outputs.getNoOutput();

    this.cacheRootArcs();

    // NOTE: bogus because this is only used during
    // building; we need to break out mutable FST from
    // immutable
    // (allowArrayArcs = false)
  }

  getInputType(): FSTInputType {
    return this.inputType;
  }

  /** Returns bytes used to represent the FST */
  private ramBytesUsedArcs(arcs: (FSTArc<T> | null)[] | null): number {
    let size = 0;
    if (arcs !== null) {
      size += RamUsageEstimator.shallowSizeOf(arcs);
      for (const arc of arcs) {
        if (arc !== null) {
          size += FST.ARC_SHALLOW_RAM_BYTES_USED;
          if (arc.output !== null && arc.output !== this.outputs.getNoOutput()) {
            size += this.outputs.ramBytesUsed(arc.output);
          }
          if (arc.nextFinalOutput !== null && arc.nextFinalOutput !== this.outputs.getNoOutput()) {
            size += this.outputs.ramBytesUsed(arc.nextFinalOutput);
          }
        }
      }
    }
    return size;
  }

  ramBytesUsed(): number {
    let size = FST.BASE_RAM_BYTES_USED;
    size += this.bytes.ramBytesUsed();
    if (this.packed) {
      size += this.nodeRefToAddress!.ramBytesUsed();
    }
    size += this.cachedArcsBytesUsed;
    size += RamUsageEstimator.sizeOf(this.reusedBytesPerArc);
    return size;
  }

  getChildResources(): readonly Accountable[] {
    const resources: Accountable[] = [];
    if (this.packed) {
      resources.push(Accountables.namedAccountable("node ref to address", this.nodeRefToAddress!));
    }
    return resources;
  }

  toString(): string {
    return (
      "FST(input=" + this.inputType + ",output=" + String(this.outputs) + ",packed=" + this.packed + ",nodes=" + this.nodeCount + ",arcs=" + this.arcCount + ")"
    );
  }

  private getNodeAddress(node: number): number {
    // nodeAddress (willPackFST during building) is never present on a loaded FST
    return node;
  }

  // Caches first 128 labels
  private cacheRootArcs(): void {
    lassert(() => this.cachedArcsBytesUsed === 0);
    const arc = new FSTArc<T>();
    this.getFirstArc(arc);
    if (FST.targetHasArcs(arc)) {
      const input = this.getBytesReader();
      const arcs: (FSTArc<T> | null)[] = new Array<FSTArc<T> | null>(0x80).fill(null);
      this.readFirstRealTargetArc(arc.target, arc, input);
      let count = 0;
      for (;;) {
        lassert(() => arc.label !== END_LABEL);
        if (arc.label < arcs.length) {
          arcs[arc.label] = new FSTArc<T>().copyFrom(arc);
        } else {
          break;
        }
        if (arc.isLast()) {
          break;
        }
        this.readNextRealArc(arc, input);
        count++;
      }

      const cacheRAM = this.ramBytesUsedArcs(arcs) | 0;

      // Don't cache if there are only a few arcs or if the cache would use > 20% RAM of the FST itself:
      if (count >= FIXED_ARRAY_NUM_ARCS_SHALLOW && cacheRAM < Math.floor(this.ramBytesUsed() / 5)) {
        this.cachedRootArcs = arcs;
        this.cachedArcsBytesUsed = cacheRAM;
      }
    }
  }

  getEmptyOutput(): T | null {
    return this.emptyOutput;
  }

  /**
   * Reads one label (Java: readLabel(DataInput)): a byte, a short or a vInt depending on {@link inputType}.
   */
  readLabel(input: DataInput): number {
    let v: number;
    if (this.inputType === FSTInputType.BYTE1) {
      // Unsigned byte:
      v = input.readByte() & 0xff;
    } else if (this.inputType === FSTInputType.BYTE2) {
      // Unsigned short:
      v = input.readShort() & 0xffff;
    } else {
      v = input.readVInt();
    }
    return v;
  }

  /** returns true if the node at this address has any outgoing arcs */
  static targetHasArcs<T>(arc: FSTArc<T>): boolean {
    return arc.target > 0;
  }

  /**
   * Fills virtual 'start' arc, ie, an empty incoming arc to the FST's start node
   */
  getFirstArc(arc: FSTArc<T>): FSTArc<T> {
    if (this.emptyOutput !== null) {
      arc.flags = BIT_FINAL_ARC | BIT_LAST_ARC;
      arc.nextFinalOutput = this.emptyOutput;
      if (this.emptyOutput !== this.NO_OUTPUT) {
        arc.flags |= BIT_ARC_HAS_FINAL_OUTPUT;
      }
    } else {
      arc.flags = BIT_LAST_ARC;
      arc.nextFinalOutput = this.NO_OUTPUT;
    }
    arc.output = this.NO_OUTPUT;

    // If there are no nodes, ie, the FST only accepts the
    // empty string, then startNode is 0
    arc.target = this.startNode;
    return arc;
  }

  /**
   * Follows the <code>follow</code> arc and reads the last arc of its target; this changes the provided <code>arc</code>
   * (2nd arg) in-place and returns it.
   *
   * @return Returns the second argument (<code>arc</code>).
   */
  readLastTargetArc(follow: FSTArc<T>, arc: FSTArc<T>, input: FSTBytesReader): FSTArc<T> {
    //System.out.println("readLast");
    if (!FST.targetHasArcs(follow)) {
      //System.out.println("  end node");
      lassert(() => follow.isFinal());
      arc.label = END_LABEL;
      arc.target = FINAL_END_NODE;
      arc.output = follow.nextFinalOutput;
      arc.flags = BIT_LAST_ARC;
      return arc;
    } else {
      input.setPosition(this.getNodeAddress(follow.target));
      arc.node = follow.target;
      const b = input.readByte();
      if (b === ARCS_AS_FIXED_ARRAY) {
        // array: jump straight to end
        arc.numArcs = input.readVInt();
        if (this.packed || this.version >= VERSION_VINT_TARGET) {
          arc.bytesPerArc = input.readVInt();
        } else {
          arc.bytesPerArc = input.readInt();
        }
        arc.posArcsStart = input.getPosition();
        arc.arcIdx = arc.numArcs - 2;
      } else {
        arc.flags = b;
        // non-array: linear scan
        arc.bytesPerArc = 0;
        while (!arc.isLast()) {
          // skip this arc:
          this.readLabel(input);
          if (arc.flag(BIT_ARC_HAS_OUTPUT)) {
            this.outputs.skipOutput(input);
          }
          if (arc.flag(BIT_ARC_HAS_FINAL_OUTPUT)) {
            this.outputs.skipFinalOutput(input);
          }
          if (arc.flag(BIT_STOP_NODE)) {
            // nothing
          } else if (arc.flag(BIT_TARGET_NEXT)) {
            // nothing
          } else if (this.packed) {
            input.readVLong();
          } else {
            this.readUnpackedNodeTarget(input);
          }
          arc.flags = input.readByte();
        }
        // Undo the byte flags we read:
        input.skipBytes(-1);
        arc.nextArc = input.getPosition();
      }
      this.readNextRealArc(arc, input);
      lassert(() => arc.isLast());
      return arc;
    }
  }

  private readUnpackedNodeTarget(input: FSTBytesReader): number {
    let target: number;
    if (this.version < VERSION_VINT_TARGET) {
      target = input.readInt();
    } else {
      target = Number(input.readVLong());
    }
    return target;
  }

  /**
   * Follow the <code>follow</code> arc and read the first arc of its target; this changes the provided
   * <code>arc</code> (2nd arg) in-place and returns it.
   *
   * @return Returns the second argument (<code>arc</code>).
   */
  readFirstTargetArc(follow: FSTArc<T>, arc: FSTArc<T>, input: FSTBytesReader): FSTArc<T> {
    //int pos = address;
    //System.out.println("    readFirstTarget follow.target=" + follow.target + " isFinal=" + follow.isFinal());
    if (follow.isFinal()) {
      // Insert "fake" final first arc:
      arc.label = END_LABEL;
      arc.output = follow.nextFinalOutput;
      arc.flags = BIT_FINAL_ARC;
      if (follow.target <= 0) {
        arc.flags |= BIT_LAST_ARC;
      } else {
        arc.node = follow.target;
        // NOTE: nextArc is a node (not an address!) in this case:
        arc.nextArc = follow.target;
      }
      arc.target = FINAL_END_NODE;
      //System.out.println("    insert isFinal; nextArc=" + follow.target + " isLast=" + arc.isLast() + " output=" + outputs.outputToString(arc.output));
      return arc;
    } else {
      return this.readFirstRealTargetArc(follow.target, arc, input);
    }
  }

  /** @internal */
  readFirstRealTargetArc(node: number, arc: FSTArc<T>, input: FSTBytesReader): FSTArc<T> {
    const address = this.getNodeAddress(node);
    input.setPosition(address);
    //System.out.println("  readFirstRealTargtArc address=" + address);
    //System.out.println("   flags=" + arc.flags);
    arc.node = node;

    if (input.readByte() === ARCS_AS_FIXED_ARRAY) {
      //System.out.println("  fixedArray");
      // this is first arc in a fixed-array
      arc.numArcs = input.readVInt();
      if (this.packed || this.version >= VERSION_VINT_TARGET) {
        arc.bytesPerArc = input.readVInt();
      } else {
        arc.bytesPerArc = input.readInt();
      }
      arc.arcIdx = -1;
      arc.nextArc = arc.posArcsStart = input.getPosition();
      //System.out.println("  bytesPer=" + arc.bytesPerArc + " numArcs=" + arc.numArcs + " arcsStart=" + pos);
    } else {
      //arc.flags = b;
      arc.nextArc = address;
      arc.bytesPerArc = 0;
    }

    return this.readNextRealArc(arc, input);
  }

  /**
   * Returns whether the given target node is an expanded (fixed array) node.
   * @internal
   */
  isExpandedTarget(follow: FSTArc<T>, input: FSTBytesReader): boolean {
    if (!FST.targetHasArcs(follow)) {
      return false;
    } else {
      input.setPosition(this.getNodeAddress(follow.target));
      return input.readByte() === ARCS_AS_FIXED_ARRAY;
    }
  }

  /** In-place read; returns the arc. */
  readNextArc(arc: FSTArc<T>, input: FSTBytesReader): FSTArc<T> {
    if (arc.label === END_LABEL) {
      // This was a fake inserted "final" arc
      if (arc.nextArc <= 0) {
        throw new IllegalArgumentException("cannot readNextArc when arc.isLast()=true");
      }
      return this.readFirstRealTargetArc(arc.nextArc, arc, input);
    } else {
      return this.readNextRealArc(arc, input);
    }
  }

  /** Peeks at next arc's label; does not alter arc.  Do not call this if arc.isLast()! */
  readNextArcLabel(arc: FSTArc<T>, input: FSTBytesReader): number {
    lassert(() => !arc.isLast());

    if (arc.label === END_LABEL) {
      //System.out.println("    nextArc fake " + arc.nextArc);
      // Next arc is the first arc of a node.
      // Position to read the first arc label.

      const pos = this.getNodeAddress(arc.nextArc);
      input.setPosition(pos);

      const b = input.readByte();
      if (b === ARCS_AS_FIXED_ARRAY) {
        //System.out.println("    nextArc fixed array");
        input.readVInt();

        // Skip bytesPerArc:
        if (this.packed || this.version >= VERSION_VINT_TARGET) {
          input.readVInt();
        } else {
          input.readInt();
        }
      } else {
        input.setPosition(pos);
      }
      // skip flags
      input.readByte();
    } else {
      if (arc.bytesPerArc !== 0) {
        //System.out.println("    nextArc real array");
        // arcs are at fixed entries
        input.setPosition(arc.posArcsStart);
        input.skipBytes((1 + arc.arcIdx) * arc.bytesPerArc);
      } else {
        // arcs are packed
        //System.out.println("    nextArc real packed");
        // -1 to skip over flags
        input.setPosition(arc.nextArc);
      }
      // skip flags (the Java code reads the byte below for both branches)
      input.readByte();
    }
    return this.readLabel(input);
  }

  /** Never returns null, but you should never call this if arc.isLast() is true. */
  readNextRealArc(arc: FSTArc<T>, input: FSTBytesReader): FSTArc<T> {
    // TODO: can't assert this because we call from readFirstArc
    // assert !flag(arc.flags, BIT_LAST_ARC);

    // this is a continuing arc in a fixed array
    if (arc.bytesPerArc !== 0) {
      // arcs are at fixed entries
      arc.arcIdx++;
      lassert(() => arc.arcIdx < arc.numArcs);
      input.setPosition(arc.posArcsStart);
      input.skipBytes(arc.arcIdx * arc.bytesPerArc);
    } else {
      // arcs are packed
      input.setPosition(arc.nextArc);
    }
    arc.flags = input.readByte();
    arc.label = this.readLabel(input);

    if (arc.flag(BIT_ARC_HAS_OUTPUT)) {
      arc.output = this.outputs.read(input);
    } else {
      arc.output = this.outputs.getNoOutput();
    }

    if (arc.flag(BIT_ARC_HAS_FINAL_OUTPUT)) {
      arc.nextFinalOutput = this.outputs.readFinalOutput(input);
    } else {
      arc.nextFinalOutput = this.outputs.getNoOutput();
    }

    if (arc.flag(BIT_STOP_NODE)) {
      if (arc.flag(BIT_FINAL_ARC)) {
        arc.target = FINAL_END_NODE;
      } else {
        arc.target = NON_FINAL_END_NODE;
      }
      arc.nextArc = input.getPosition();
    } else if (arc.flag(BIT_TARGET_NEXT)) {
      arc.nextArc = input.getPosition();
      // TODO: would be nice to make this lazy -- maybe
      // caller doesn't need the target and is scanning arcs...
      // (nodeAddress == null on a loaded FST)
      if (!arc.flag(BIT_LAST_ARC)) {
        if (arc.bytesPerArc === 0) {
          // must scan
          this.seekToNextNode(input);
        } else {
          input.setPosition(arc.posArcsStart);
          input.skipBytes(arc.bytesPerArc * arc.numArcs);
        }
      }
      arc.target = input.getPosition();
    } else {
      if (this.packed) {
        const pos = input.getPosition();
        const code = Number(input.readVLong());
        if (arc.flag(BIT_TARGET_DELTA)) {
          // Address is delta-coded from current address:
          arc.target = pos + code;
          //System.out.println("    delta pos=" + pos + " delta=" + code + " target=" + arc.target);
        } else if (code < this.nodeRefToAddress!.size()) {
          // Deref
          arc.target = Number(this.nodeRefToAddress!.get(code));
          //System.out.println("    deref code=" + code + " target=" + arc.target);
        } else {
          // Absolute
          arc.target = code;
          //System.out.println("    abs code=" + code);
        }
      } else {
        arc.target = this.readUnpackedNodeTarget(input);
      }
      arc.nextArc = input.getPosition();
    }
    return arc;
  }

  // Used only by assert
  private assertRootCachedArc(label: number, cachedArc: FSTArc<T> | null): boolean {
    const arc = new FSTArc<T>();
    this.getFirstArc(arc);
    const input = this.getBytesReader();
    const result = this.findTargetArc(label, arc, arc, input, false);
    if (result === null) {
      lassert(() => cachedArc === null);
    } else {
      lassert(() => cachedArc !== null);
      lassert(() => cachedArc!.arcIdx === result.arcIdx);
      lassert(() => cachedArc!.bytesPerArc === result.bytesPerArc);
      lassert(() => cachedArc!.flags === result.flags);
      lassert(() => cachedArc!.label === result.label);
      lassert(() => cachedArc!.nextArc === result.nextArc);
      lassert(() => outputEquals(cachedArc!.nextFinalOutput, result.nextFinalOutput));
      lassert(() => cachedArc!.node === result.node);
      lassert(() => cachedArc!.numArcs === result.numArcs);
      lassert(() => outputEquals(cachedArc!.output, result.output));
      lassert(() => cachedArc!.posArcsStart === result.posArcsStart);
      lassert(() => cachedArc!.target === result.target);
    }

    return true;
  }

  /**
   * Finds an arc leaving the incoming arc, replacing the arc in place. This returns null if the arc was not found,
   * else the incoming arc.
   * (The private Java overload with useRootArcCache is this method's fifth, optional parameter.)
   */
  findTargetArc(labelToMatch: number, follow: FSTArc<T>, arc: FSTArc<T>, input: FSTBytesReader, useRootArcCache = true): FSTArc<T> | null {
    if (labelToMatch === END_LABEL) {
      if (follow.isFinal()) {
        if (follow.target <= 0) {
          arc.flags = BIT_LAST_ARC;
        } else {
          arc.flags = 0;
          // NOTE: nextArc is a node (not an address!) in this case:
          arc.nextArc = follow.target;
          arc.node = follow.target;
        }
        arc.output = follow.nextFinalOutput;
        arc.label = END_LABEL;
        return arc;
      } else {
        return null;
      }
    }

    // Short-circuit if this arc is in the root arc cache:
    if (useRootArcCache && this.cachedRootArcs !== null && follow.target === this.startNode && labelToMatch < this.cachedRootArcs.length) {
      const result = this.cachedRootArcs[labelToMatch]!;

      // LUCENE-5152: detect tricky cases where caller
      // modified previously returned cached root-arcs:
      lassert(() => this.assertRootCachedArc(labelToMatch, result));
      if (result === null) {
        return null;
      } else {
        arc.copyFrom(result);
        return arc;
      }
    }

    if (!FST.targetHasArcs(follow)) {
      return null;
    }

    input.setPosition(this.getNodeAddress(follow.target));

    arc.node = follow.target;

    // System.out.println("fta label=" + (char) labelToMatch);

    if (input.readByte() === ARCS_AS_FIXED_ARRAY) {
      // Arcs are full array; do binary search:
      arc.numArcs = input.readVInt();
      if (this.packed || this.version >= VERSION_VINT_TARGET) {
        arc.bytesPerArc = input.readVInt();
      } else {
        arc.bytesPerArc = input.readInt();
      }
      arc.posArcsStart = input.getPosition();
      let low = 0;
      let high = arc.numArcs - 1;
      while (low <= high) {
        //System.out.println("    cycle");
        const mid = (low + high) >>> 1;
        // +1 to skip over flags
        input.setPosition(arc.posArcsStart);
        input.skipBytes(arc.bytesPerArc * mid + 1);
        const midLabel = this.readLabel(input);
        const cmp = midLabel - labelToMatch;
        if (cmp < 0) {
          low = mid + 1;
        } else if (cmp > 0) {
          high = mid - 1;
        } else {
          arc.arcIdx = mid - 1;
          //System.out.println("    found!");
          return this.readNextRealArc(arc, input);
        }
      }

      return null;
    }

    // Linear scan
    this.readFirstRealTargetArc(follow.target, arc, input);

    for (;;) {
      //System.out.println("  non-bs cycle");
      // TODO: we should fix this code to not have to create
      // object for the output of every arc we scan... only
      // for the matching arc, if found
      if (arc.label === labelToMatch) {
        //System.out.println("    found!");
        return arc;
      } else if (arc.label > labelToMatch) {
        return null;
      } else if (arc.isLast()) {
        return null;
      } else {
        this.readNextRealArc(arc, input);
      }
    }
  }

  private seekToNextNode(input: FSTBytesReader): void {
    for (;;) {
      const flags = input.readByte();
      this.readLabel(input);

      if (flagOf(flags, BIT_ARC_HAS_OUTPUT)) {
        this.outputs.skipOutput(input);
      }

      if (flagOf(flags, BIT_ARC_HAS_FINAL_OUTPUT)) {
        this.outputs.skipFinalOutput(input);
      }

      if (!flagOf(flags, BIT_STOP_NODE) && !flagOf(flags, BIT_TARGET_NEXT)) {
        if (this.packed) {
          input.readVLong();
        } else {
          this.readUnpackedNodeTarget(input);
        }
      }

      if (flagOf(flags, BIT_LAST_ARC)) {
        return;
      }
    }
  }

  /** Returns the number of nodes (including the virtual final end node). */
  getNodeCount(): number {
    // 1+ in order to count the -1 implicit final node
    return 1 + this.nodeCount;
  }

  getArcCount(): number {
    return this.arcCount;
  }

  getArcWithOutputCount(): number {
    return this.arcWithOutputCount;
  }

  /**
   * Nodes will be expanded if their depth (distance from the root node) is &lt;= this value and their number of arcs
   * is &gt;= {@link FIXED_ARRAY_NUM_ARCS_SHALLOW}. (Building-time setting kept for the format description.)
   */

  /**
   * Returns a {@link FSTBytesReader} for this FST, positioned at position 0.
   */
  getBytesReader(): FSTBytesReader {
    let input: FSTBytesReader;
    if (this.packed) {
      input = this.bytes.getForwardReader();
    } else {
      input = this.bytes.getReverseReader();
    }
    return input;
  }
}
