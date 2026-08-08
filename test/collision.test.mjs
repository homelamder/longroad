import assert from 'node:assert/strict';
import { activeScatter } from '../src/world/scatter.js';
import { Car, DEFAULT_CAR } from '../src/car/physics.js';
import { pointAt } from '../src/world/road.js';

// A fabricated scatter cache with one oak dead ahead on the road. STRIDE layout:
// x, y, z, scale, rot, rank.
const p = pointAt(1000), q = pointAt(1012);
const key = (cx, cz) => (cx + 4096) * 8192 + (cz + 4096);
const cache = new Map();
const cx = Math.floor(q.x / 256), cz = Math.floor(q.z / 256);
cache.set(key(cx, cz), { oakA: new Float32Array([q.x, q.y, q.z, 2.0, 0, 0]) });
activeScatter.current = { cache, key };

const car = new Car(DEFAULT_CAR);
car.placeOnRoad(1000);
for (let i = 0; i < 60 * 6; i++) car.update(1 / 60, { throttle: 1, steer: 0, brake: 0 });

// The car must be stopped short of the trunk, not through it.
const dx = car.pos.x - q.x, dz = car.pos.z - q.z;
const dist = Math.hypot(dx, dz);
assert.ok(dist > 1.5, `car ended inside the oak (${dist.toFixed(2)} m from trunk)`);
assert.ok(Math.abs(car.speed) < 2, `car still moving at ${car.speed.toFixed(1)} m/s after the hit`);
assert.ok(car.impact > 3, `impact never registered (${(car.impact || 0).toFixed(1)})`);

// A walker-sized offset should slip past the same trunk.
const car2 = new Car(DEFAULT_CAR);
car2.placeOnRoad(1000);
car2.pos.x += 6;
const before = car2.pos.z;
for (let i = 0; i < 60 * 3; i++) car2.update(1 / 60, { throttle: 1, steer: 0, brake: 0 });
// 6 m off the centreline is dirt: slower, but it must still make real progress
// and never register a hit.
assert.ok(car2.pos.z - before > 18, `clear lane blocked (${(car2.pos.z - before).toFixed(1)} m)`);
assert.ok(!car2.impact || car2.impact < 1, 'phantom impact in the clear lane');

activeScatter.current = null;
console.log(`collision ok — stopped ${dist.toFixed(2)} m from the trunk, clear lane unaffected`);
