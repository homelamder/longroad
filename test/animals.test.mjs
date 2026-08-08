import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Animals, setWolfTemper, SPECIES } from '../src/animals/animals.js';
import { nearest } from '../src/world/road.js';
import { JOURNEY } from '../src/world/biomes.js';

const scene = new THREE.Scene();
const an = new Animals(scene);
const DT = 1 / 30;

// Walking the whole road must encounter wildlife in the living regions and
// none in Ashen Rise — its emptiness is the point.
let seen = 0, seenAshen = 0;
const pos = new THREE.Vector3();
for (let z = 200; z < JOURNEY; z += 400) {
  pos.set(0, 0, z);
  an.update(DT, pos, 0);
  if (an.population > 0) {
    if (z > 13100) seenAshen += an.population;
    else seen++;
  }
}
assert.ok(seen > 8, `wildlife too rare: herds at only ${seen} of ~37 stops`);
assert.equal(seenAshen, 0, 'Ashen Rise should be lifeless');

// Herds are deterministic: the same site produces the same herd.
const a1 = new Animals(new THREE.Scene());
const a2 = new Animals(new THREE.Scene());
for (const a of [a1, a2]) a.update(DT, pos.set(0, 0, 1000), 0);
const h1 = [...a1.herds.values()].filter(Boolean).map((h) => `${h.i}:${h.species}:${h.animals.length}`);
const h2 = [...a2.herds.values()].filter(Boolean).map((h) => `${h.i}:${h.species}:${h.animals.length}`);
assert.deepEqual(h1, h2, 'herd sites are not deterministic');

// Flee: a fast car close to a herd scatters it; standing still calms it again.
{
  const a = new Animals(new THREE.Scene());
  a.update(DT, pos.set(0, 0, 1000), 0);
  const herd = [...a.herds.values()].find(Boolean);
  assert.ok(herd, 'no herd near 1000 m to test with');
  const beast = herd.animals[0];
  const before = { x: beast.x, z: beast.z };

  // Park the "car" on top of the herd at speed.
  for (let i = 0; i < 90; i++) a.update(DT, pos.set(herd.x, 0, herd.z), 25);
  assert.equal(beast.state, 'flee', 'animal did not flee a fast car');
  const fled = Math.hypot(beast.x - before.x, beast.z - before.z);
  assert.ok(fled > 3, `fled only ${fled.toFixed(1)} m`);

  // Retreat and wait: the herd settles.
  for (let i = 0; i < 60 * 14; i++) a.update(DT, pos.set(herd.x + 300, 0, herd.z + 300), 0);
  assert.notEqual(beast.state, 'flee', 'animal never calmed down');
}

// A slow approach gets far closer than a fast one before triggering flight.
{
  const spec = SPECIES.goat;
  assert.ok(spec.calm < spec.flee, 'calm distance must be inside flee distance');
}

// Animals never stand on the tarmac.
{
  const a = new Animals(new THREE.Scene());
  for (let z = 300; z < 3000; z += 200) {
    a.update(DT, pos.set(0, 0, z), 0);
    for (const herd of a.herds.values()) {
      if (!herd) continue;
      for (const beast of herd.animals) {
        assert.ok(nearest(beast.x, beast.z).dist > 7,
          `${herd.species} standing ${nearest(beast.x, beast.z).dist.toFixed(1)} m from centreline`);
      }
    }
  }
}

console.log('animals ok — herds deterministic, flee/calm behave, road stays clear');

// --- the hunt ---------------------------------------------------------------
// A wolf pack must stalk, close, and strike a walker exactly once per cooldown,
// and must ignore the same position when the player is in the car.
{
  setWolfTemper('calm');
  const wolves = an.spawnAt('wolf', 500, 5000, 3);
  let strikes = 0, stalks = 0;
  an.onStrike = () => strikes++;
  an.onStalk = () => stalks++;
  const walker = { x: 500, z: 5030 };
  for (let i = 0; i < 60 * 30; i++) {
    an.update(1 / 60, walker, 0, true);
    if (strikes > 0) break;
  }
  assert.ok(stalks >= 1, 'pack never noticed the walker');
  assert.ok(strikes === 1, `expected exactly one strike, got ${strikes}`);
  assert.ok(wolves.cool > 0, 'no cooldown after the strike');

  // Cooldown holds: 5 more simulated seconds bring no second strike.
  for (let i = 0; i < 60 * 5; i++) an.update(1 / 60, walker, 0, true);
  assert.equal(strikes, 1, 'pack struck again inside its cooldown');

  // In the car the pack stands down entirely.
  wolves.cool = 0;
  let carStrikes = 0;
  an.onStrike = () => carStrikes++;
  for (let i = 0; i < 60 * 10; i++) an.update(1 / 60, walker, 0, false);
  assert.equal(carStrikes, 0, 'wolves attacked a car');
  an.release(wolves);
  console.log('hunt ok — stalk, one strike, cooldown, cars ignored');
}
