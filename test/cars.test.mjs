import assert from 'node:assert/strict';
import { ROSTER, specFor } from '../src/car/cars.js';
import { Car } from '../src/car/physics.js';
import { nearest, pointAt } from '../src/world/road.js';
import { elevation } from '../src/world/terrain.js';

const DT = 1 / 60;

// Autopilot from the physics suite, reduced.
function follow(car, seconds) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const r = nearest(car.pos.x, car.pos.z);
    const t = pointAt(r.along + 26);
    const want = Math.atan2(t.x - car.pos.x, t.z - car.pos.z);
    const err = ((want - car.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    car.update(DT, { throttle: 1, brake: 0, handbrake: false,
      steer: Math.max(-1, Math.min(1, err * 2.4)) });
  }
  return car;
}

// Every roster entry resolves and drives: reaches a sane top speed on the flat
// without NaN, and the classes genuinely differ.
const tops = {};
for (const entry of ROSTER) {
  const spec = specFor(entry);
  assert.ok(spec.wheelBase > 2 && spec.power > 5, `${entry.id} spec nonsense`);
  const car = new Car(spec);
  car.placeOnRoad(400);
  follow(car, 40);
  assert.ok(Number.isFinite(car.speed + car.pos.x), `${entry.id} produced NaN`);
  assert.ok(car.kmh > 60 && car.kmh < 260, `${entry.id} tops out at ${car.kmh.toFixed(0)} km/h`);
  tops[entry.id] = car.kmh;
}

// The supercar outruns the van by a wide margin, or classes are cosmetic.
assert.ok(tops.cinder > tops.drover * 1.3,
  `cinder ${tops.cinder.toFixed(0)} vs drover ${tops.drover.toFixed(0)} — classes too similar`);

// Hidden cars must sit ON drivable ground (not up a cliff), reachable off-road.
for (const e of ROSTER) {
  if (!e.where?.hidden) continue;
  const p = pointAt(e.where.hidden);
  const x = p.x + p.rx * e.where.side * e.where.dist;
  const z = p.z + p.rz * e.where.side * e.where.dist;
  const eps = 3;
  const gx = (elevation(x + eps, z) - elevation(x - eps, z)) / (2 * eps);
  const gz = (elevation(x, z + eps) - elevation(x, z - eps)) / (2 * eps);
  assert.ok(Math.hypot(gx, gz) < 0.6, `${e.id} parked on a ${Math.hypot(gx, gz).toFixed(2)} slope`);
}

console.log(`cars ok — ${ROSTER.length} cars drive, classes differ `
  + `(cinder ${tops.cinder.toFixed(0)} km/h vs drover ${tops.drover.toFixed(0)} km/h)`);
