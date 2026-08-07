import { createNoise2D } from 'simplex-noise';

// Everything placed in the world must land in the same spot every time a chunk is
// rebuilt, so no world code may ever call Math.random(). It all comes from here.
export const SEED = 20260808;

export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const makeRng = (stream) => mulberry32(SEED + stream * 7919);
export const makeNoise = (stream) => createNoise2D(makeRng(stream));

// A stable pseudo-random in [0,1) from a pair of integers — for "does a tree go
// here" style questions where keeping a generator around would be silly.
export function hash2(x, y) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const smoothstep = (e0, e1, x) => smooth(clamp((x - e0) / (e1 - e0), 0, 1));
