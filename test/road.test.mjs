import assert from 'node:assert/strict';
import {
  samples, nearest, corridorWeight, pointAt, ROAD_LENGTH,
  HALF_WIDTH, SHOULDER, CORRIDOR,
} from '../src/world/road.js';
import { JOURNEY } from '../src/world/biomes.js';

// The road must reach the end of the journey, or the destination is unreachable.
assert.ok(ROAD_LENGTH >= JOURNEY, `road ${ROAD_LENGTH} shorter than journey ${JOURNEY}`);
assert.ok(samples.length > 2000, 'too few samples for a 15 km road');

// Distance along must never go backwards.
for (let i = 1; i < samples.length; i++) {
  assert.ok(samples[i].d > samples[i - 1].d, `d not monotonic at ${i}`);
}

// Right-hand normals are unit length and horizontal.
for (let i = 0; i < samples.length; i += 137) {
  const s = samples[i];
  assert.ok(Math.abs(Math.hypot(s.rx, s.rz) - 1) < 1e-6, 'normal not unit');
  assert.ok(Number.isFinite(s.x + s.y + s.z), 'NaN in samples');
}

// A point taken from the centreline must report as being on the centreline.
for (let d = 100; d < JOURNEY; d += 613) {
  const p = pointAt(d);
  const n = nearest(p.x, p.z);
  assert.ok(n.dist < 2.6, `centreline point at ${d} reported ${n.dist.toFixed(2)} m off road`);
  assert.ok(Math.abs(n.y - p.y) < 1.2, `height mismatch at ${d}`);
}

// Stepping sideways off the centreline must measure that step back.
for (let d = 500; d < JOURNEY; d += 1471) {
  const p = pointAt(d);
  for (const off of [12, 30, 80]) {
    const n = nearest(p.x + p.rx * off, p.z + p.rz * off);
    assert.ok(Math.abs(n.dist - off) < 3.5,
      `offset ${off} at ${d} measured ${n.dist.toFixed(2)}`);
  }
}

// Points far from the road report as far, not as a wrong nearby match.
assert.ok(nearest(0, -9000).dist > 500, 'behind the start should be far from the road');

// The corridor weight is 1 across the tarmac, 0 outside, and never leaves [0,1].
assert.equal(corridorWeight(0), 1);
assert.equal(corridorWeight(HALF_WIDTH + SHOULDER), 1);
assert.equal(corridorWeight(CORRIDOR), 0);
assert.equal(corridorWeight(CORRIDOR + 500), 0);
let prev = 1;
for (let d = 0; d <= CORRIDOR + 5; d += 0.5) {
  const w = corridorWeight(d);
  assert.ok(w >= 0 && w <= 1, `weight out of range at ${d}`);
  assert.ok(w <= prev + 1e-9, `weight not monotonic at ${d}`);
  prev = w;
}

// The road has to actually bend, or the drive is a straight line for 15 km.
let maxLateral = 0;
for (const s of samples) maxLateral = Math.max(maxLateral, Math.abs(s.x));
assert.ok(maxLateral > 150, `road barely wanders (max |x| = ${maxLateral.toFixed(0)} m)`);

// And it has to climb — the pass is the hardest driving in the game.
const ys = samples.map((s) => s.y);
assert.ok(Math.max(...ys) - Math.min(...ys) > 400, 'road never climbs');

console.log(`road ok — ${(ROAD_LENGTH / 1000).toFixed(2)} km, ${samples.length} samples, `
  + `${(Math.max(...ys) - Math.min(...ys)).toFixed(0)} m of climb`);
