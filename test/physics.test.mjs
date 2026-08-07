import assert from 'node:assert/strict';
import { Car, DEFAULT_CAR } from '../src/car/physics.js';
import { elevation } from '../src/world/terrain.js';
import { nearest, pointAt } from '../src/world/road.js';

const DT = 1 / 60;
const NONE = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const GO = { ...NONE, throttle: 1 };

function sim(car, input, seconds) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) car.update(DT, input);
  return car;
}

// Steer toward a point up the road. Enough of an autopilot to measure what the car
// does on tarmac — driving in a straight line just aims it at the nearest hillside.
function steerToRoad(car, lookahead = 26) {
  const r = nearest(car.pos.x, car.pos.z);
  if (r.dist > 1e8) return 0;
  const t = pointAt(r.along + lookahead);
  const want = Math.atan2(t.x - car.pos.x, t.z - car.pos.z);
  const err = ((want - car.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return Math.max(-1, Math.min(1, err * 2.4));
}

function follow(car, seconds, input = GO) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) car.update(DT, { ...input, steer: steerToRoad(car) });
  return car;
}

function fresh(along = 300) {
  const c = new Car(DEFAULT_CAR);
  c.placeOnRoad(along);
  return c;
}

// Starting position must be on the tarmac, not at x = 0 where the road is not.
{
  const c = fresh(5200);
  assert.ok(nearest(c.pos.x, c.pos.z).dist < 1.5, 'car does not start on the road');
  assert.ok(Math.abs(c.pos.y - (elevation(c.pos.x, c.pos.z) + c.spec.rideHeight)) < 0.3,
    'car does not start on the ground');
}

// Accelerates, and settles at a plausible top speed rather than running away.
{
  const c = fresh();
  follow(c, 8);
  assert.ok(c.speed > 12, `too slow off the line: ${c.speed.toFixed(1)} m/s after 8 s`);
  follow(c, 90);
  assert.ok(c.kmh > 95 && c.kmh < 165, `implausible top speed ${c.kmh.toFixed(0)} km/h`);
  assert.ok(nearest(c.pos.x, c.pos.z).dist < 7,
    'autopilot cannot hold the road — the road bends harder than the car can steer');
}

// Brakes to a stop from speed in a distance a player would accept.
{
  const c = fresh();
  follow(c, 30);
  assert.ok(c.speed > 20, 'setup failed to reach speed');
  const from = c.pos.clone(), v0 = c.speed;
  let t = 0;
  while (c.speed > 0.4 && t < 12) { c.update(DT, { ...NONE, brake: 1 }); t += DT; }
  assert.ok(t < 12, `never stopped: still ${c.speed.toFixed(2)} m/s`);
  const stopDist = c.pos.distanceTo(from);
  assert.ok(stopDist < 95,
    `stopping distance ${stopDist.toFixed(0)} m from ${(v0 * 3.6).toFixed(0)} km/h is too long`);
}

// The brake must not throw the car into reverse the instant it stops.
{
  const c = fresh();
  follow(c, 20);
  while (c.speed > 0.4) c.update(DT, { ...NONE, brake: 1 });
  sim(c, { ...NONE, brake: 1 }, 0.3);
  assert.ok(c.speed >= -0.05, `reverse engaged too eagerly: ${c.speed.toFixed(3)} m/s`);
}

// Held brake from a standstill reverses — one pedal does both, Dr.Driving style.
{
  const c = fresh();
  sim(c, { ...NONE, brake: 1 }, 5);
  assert.ok(c.speed < -2, `no reverse: ${c.speed.toFixed(2)} m/s`);
  sim(c, { ...NONE, brake: 1 }, 25);
  assert.ok(Math.abs(c.speed) <= DEFAULT_CAR.reverseTop + 1,
    `reverse exceeds its cap: ${c.speed.toFixed(2)}`);
}

// Steering turns the car, and the car goes roughly where it is pointing.
{
  const c = fresh();
  follow(c, 6);
  const yaw0 = c.yaw;
  sim(c, { ...GO, steer: 1 }, 3);
  assert.ok(c.yaw > yaw0 + 0.4, `steering right barely turned: ${(c.yaw - yaw0).toFixed(3)} rad`);

  const c2 = fresh();
  follow(c2, 6);
  const yaw2 = c2.yaw;
  sim(c2, { ...GO, steer: -1 }, 3);
  assert.ok(c2.yaw < yaw2 - 0.4, 'steering left did not turn the car');

  // Heading and travel direction must broadly agree, or the car is on ice.
  const travel = Math.atan2(c.vel.x, c.vel.z);
  let diff = Math.abs(((travel - c.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  assert.ok(diff < 0.6, `car slides too much: ${diff.toFixed(2)} rad between heading and travel`);
}

// Steering a genuinely stationary car must not turn it on the spot. One step only:
// left alone for longer it rolls off down the hill, and a rolling car does steer.
{
  const c = fresh();
  c.speed = 0;
  const yaw0 = c.yaw;
  c.update(DT, { ...NONE, steer: 1 });
  assert.ok(Math.abs(c.yaw - yaw0) < 1e-9, 'car pirouettes at a standstill');
}

// A car left in neutral on a grade rolls down it.
{
  const c = fresh(9600);           // mid-climb to the pass
  sim(c, NONE, 5);
  assert.ok(c.speed < -1, `parked on a climb but did not roll back: ${c.speed.toFixed(2)} m/s`);
}

// The handbrake makes it slide more than the same corner taken normally.
{
  const a = fresh(); follow(a, 12); sim(a, { ...GO, steer: 1 }, 1.5);
  const b = fresh(); follow(b, 12); sim(b, { ...GO, steer: 1, handbrake: true }, 1.5);
  assert.ok(Math.abs(b.lateral) > Math.abs(a.lateral) * 1.4,
    `handbrake adds no slide (${a.lateral.toFixed(2)} vs ${b.lateral.toFixed(2)})`);
}

// Over a long drive the car must stay welded to the ground and free of NaN.
{
  const c = fresh(1000);
  let worstGap = 0;
  for (let i = 0; i < 60 * 60; i++) {
    c.update(DT, { ...GO, steer: Math.sin(i / 90) * 0.6 });
    assert.ok(Number.isFinite(c.pos.x + c.pos.y + c.pos.z + c.speed + c.yaw),
      `NaN in car state at step ${i}`);
    if (!c.airborne) {
      worstGap = Math.max(worstGap, Math.abs(c.pos.y - (elevation(c.pos.x, c.pos.z) + c.spec.rideHeight)));
    }
  }
  assert.ok(worstGap < 2.2, `car floats or sinks: worst gap ${worstGap.toFixed(2)} m`);
}

// It has to be able to climb the steepest part of the journey from a standing start.
{
  const c = fresh(13800);          // the 20% grade up into Ashen Rise
  const z0 = c.pos.z;
  follow(c, 14);
  assert.ok(c.pos.z - z0 > 90, `cannot climb the steepest grade (made ${(c.pos.z - z0).toFixed(0)} m)`);
  assert.ok(c.kmh > 30, `crawls up the steepest grade at ${c.kmh.toFixed(0)} km/h`);
}

// Recovery always puts the car back on the tarmac, whatever mess it was in.
{
  const c = fresh(4000);
  c.pos.x += 900; c.pos.y += 60; c.speed = 30; c.lateral = 12;
  c.recover();
  assert.ok(nearest(c.pos.x, c.pos.z).dist < 2, 'recover did not return to the road');
  assert.equal(c.speed, 0, 'recover left the car moving');
  assert.ok(Math.abs(c.pos.y - (elevation(c.pos.x, c.pos.z) + c.spec.rideHeight)) < 0.3,
    'recover left the car off the ground');
}

// Driving off the road must be slower than driving on it — dirt is dirt.
{
  const on = fresh(1200); follow(on, 25);
  const off = fresh(1200);
  off.pos.x += 120; off.pos.y = elevation(off.pos.x, off.pos.z) + off.spec.rideHeight;
  sim(off, GO, 25);
  assert.ok(off.kmh < on.kmh * 0.95,
    `off-road is not slower (${off.kmh.toFixed(0)} vs ${on.kmh.toFixed(0)} km/h)`);
}

console.log('physics ok — accelerates, brakes, reverses, steers, climbs, recovers');
