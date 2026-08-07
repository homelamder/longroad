import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VALLEY } from '../src/world/valley.js';
import { Finale } from '../src/world/finale.js';
import { Animals } from '../src/animals/animals.js';
import { elevation } from '../src/world/terrain.js';
import { samples, nearest } from '../src/world/road.js';

// The caldera is genuinely carved: floor well below the rim, rim near road height.
const centreY = elevation(VALLEY.x, VALLEY.z);
assert.ok(Math.abs(centreY - VALLEY.floorY) < 8, `floor at ${centreY.toFixed(0)}, wanted ~${VALLEY.floorY.toFixed(0)}`);
const rimY = elevation(VALLEY.x - VALLEY.dirX * VALLEY.r, VALLEY.z - VALLEY.dirZ * VALLEY.r);
assert.ok(rimY - centreY > 28, `bowl too shallow: rim ${rimY.toFixed(0)} vs floor ${centreY.toFixed(0)}`);

// The descent from the gate into the bowl must be drivable, not a cliff dive.
{
  let worst = 0;
  for (let t = 0; t <= 1; t += 0.02) {
    const x1 = VALLEY.endX + (VALLEY.x - VALLEY.endX) * t;
    const z1 = VALLEY.endZ + (VALLEY.z - VALLEY.endZ) * t;
    const x2 = VALLEY.endX + (VALLEY.x - VALLEY.endX) * (t + 0.02);
    const z2 = VALLEY.endZ + (VALLEY.z - VALLEY.endZ) * (t + 0.02);
    const run = Math.hypot(x2 - x1, z2 - z1);
    worst = Math.max(worst, Math.abs(elevation(x2, z2) - elevation(x1, z1)) / run);
  }
  assert.ok(worst < 0.42, `descent into the valley hits ${(worst * 100).toFixed(0)}% grade`);
}

// The bowl must not swallow the road itself.
{
  const end = samples[samples.length - 1];
  assert.ok(Math.abs(elevation(end.x, end.z) - end.y) < 0.5, 'the carve moved the road end');
}

// Finale content builds: herds of every roadworthy species, props, fireflies.
{
  const scene = new THREE.Scene();
  const animals = new Animals(scene);
  const f = new Finale(scene, animals);
  const pos = new THREE.Vector3(VALLEY.endX, 0, VALLEY.endZ);
  f.update(1 / 30, pos);
  assert.ok(f.built, 'finale did not build on approach');
  assert.ok(f.herds.length >= 6, `only ${f.herds.length} species gathered`);
  animals.update(1 / 30, pos, 0);
  assert.ok(animals.population >= f.herds.length * 3, 'gathered animals not live');
  // Far away it must NOT build (lazy).
  const g2 = new Finale(new THREE.Scene(), new Animals(new THREE.Scene()));
  g2.update(1 / 30, new THREE.Vector3(0, 0, 400));
  assert.ok(!g2.built, 'finale built 15 km early');
}

console.log(`finale ok — bowl ${Math.round(rimY - centreY)} m deep, drivable descent, `
  + `life gathered at the end`);
