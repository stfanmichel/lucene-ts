/** Small deterministic PRNG so that randomized tests are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform signed 32-bit integer. */
export function randomInt32(rnd: () => number): number {
  return (Math.floor(rnd() * 4294967296) | 0);
}

/** Uniform signed 64-bit integer. */
export function randomInt64(rnd: () => number): bigint {
  const hi = BigInt(randomInt32(rnd) >>> 0);
  const lo = BigInt(randomInt32(rnd) >>> 0);
  return BigInt.asIntN(64, (hi << 32n) | lo);
}

/** Random integer in [0, n). */
export function randomBelow(rnd: () => number, n: number): number {
  return Math.floor(rnd() * n);
}

export function hexToBytes(hex: string): Uint8Array {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < b.length; i++) {
    b[i] = parseInt(hex.substring(2 * i, 2 * i + 2), 16);
  }
  return b;
}

export function toHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

export function randomBytes(rnd: () => number, len: number): Uint8Array {
  const b = new Uint8Array(len);
  for (let i = 0; i < len; i++) b[i] = randomBelow(rnd, 256);
  return b;
}
