/**
 * Seeded PRNG with named streams (SIMULATION_DESIGN §2).
 * mulberry32; each stream's seed is derived from (rngSeed, streamName) so adding a stream never
 * shifts another. Stream state (one uint32 each) lives in CompanyState.rng.
 */
export const STREAMS = ['events', 'customers', 'suppliers', 'production', 'people'] as const;
export type StreamName = (typeof STREAMS)[number];

export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function streamSeed(rngSeed: number, name: string): number {
  return (Math.imul((rngSeed >>> 0) ^ fnv1a(name), 0x9e3779b1) >>> 0) || 1;
}

export function initRng(rngSeed: number): Record<StreamName, number> {
  const out = {} as Record<StreamName, number>;
  for (const s of STREAMS) out[s] = streamSeed(rngSeed, s);
  return out;
}

/** One mulberry32 step: returns a uint32 value and the next state. */
export function mulberry32(state: number): { value: number; state: number } {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: (t ^ (t >>> 14)) >>> 0, state: s };
}

const U32 = 4294967296;

/** integer in [0, n) from a uint32 */
export function intBelow(u32: number, n: number): number {
  return Math.floor((u32 / U32) * n);
}

/** true with probability bps/10000 */
export function chanceBps(u32: number, bps: number): boolean {
  return u32 < (bps / 10000) * U32;
}

/** true with probability p (0..1); p computed from integers by the caller */
export function chance(u32: number, p: number): boolean {
  return u32 < p * U32;
}

/** Stand-alone generator for scripts (seed generator); not used inside the tick. */
export function makeGenerator(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    const r = mulberry32(s);
    s = r.state;
    return r.value;
  };
}
