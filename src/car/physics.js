import * as THREE from 'three';
import { elevation } from '../world/terrain.js';
import { nearest, corridorWeight, pointAt } from '../world/road.js';
import { obstaclesNear } from '../world/scatter.js';
import { bigAnimalsNear } from '../animals/animals.js';
import { clamp, lerp } from '../world/rng.js';

// Arcade, not simulation. The car goes where it points; how much it refuses to is
// the single `grip` number. A real physics engine would be heavier AND worse here —
// the feel comes from breaking the rules on purpose.

const GRAVITY = 22;              // exaggerated, so landings settle instead of floating
const AIR_THRESHOLD = 0.28;

export const DEFAULT_CAR = {
  id: 'trailhand', name: 'Trailhand 4x4', class: 'pickup',
  power: 7.5,           // m/s^2 of thrust at a standstill
  topSpeed: 46,         // m/s the engine curve gives up at; drag lands it near 120 km/h
  brake: 13,
  reverseTop: 11,
  grip: 5.2,            // how fast sideways velocity is scrubbed off, 1/s
  steerRate: 2.15,      // rad/s at full lock, at walking pace
  drag: 0.0008,
  roll: 0.035,          // rolling resistance. Anything near 0.4 is driving in sand.
  rideHeight: 0.62,
  wheelBase: 3.05,
  track: 1.86,
  wheelR: 0.42,
};

export class Car {
  constructor(spec = DEFAULT_CAR) {
    this.spec = { ...DEFAULT_CAR, ...spec };
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.airborne = false;
    this.speed = 0;              // signed, along forward
    this.stopped = 0;            // seconds held at a standstill, gates reverse
    this.lateral = 0;            // signed, sideways — the drift readout
    this.steerAngle = 0;         // visual front-wheel angle
    this.wheelSpin = 0;
    this.onRoad = true;
    this.surface = 1;            // 1 tarmac, 0 open country
    this.weatherGrip = 1;        // rain/snow write this from outside
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.pitch = 0;
    this.roll = 0;
    this._f = new THREE.Vector3();
    this._r = new THREE.Vector3();
  }

  // The road wanders a long way off the Z axis, so a position has to come from the
  // centreline itself — x = 0 is nowhere near the tarmac for most of the journey.
  placeOnRoad(along) {
    const p = pointAt(along);
    const ahead = pointAt(along + 6);
    this.pos.set(p.x, this.sampleGround(p.x, p.z) + this.spec.rideHeight, p.z);
    this.yaw = Math.atan2(ahead.x - p.x, ahead.z - p.z);
    this.vel.set(0, 0, 0);
    this.speed = 0;
    this.lateral = 0;
    this.airborne = false;
  }

  sampleGround(x, z) { return elevation(x, z); }

  forward(out = this._f) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  right(out = this._r) { return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }

  // Four ground samples at the wheel corners give both the ride height and the body
  // attitude, which is all the suspension a game at this altitude needs.
  probeWheels() {
    const { wheelBase, track } = this.spec;
    const f = this.forward(), r = this.right();
    const hb = wheelBase * 0.5, ht = track * 0.5;
    let sum = 0, max = -Infinity;
    const hs = this._h || (this._h = new Float32Array(4));
    let k = 0;
    for (const fs of [1, -1]) {
      for (const rs of [1, -1]) {
        const x = this.pos.x + f.x * hb * fs + r.x * ht * rs;
        const z = this.pos.z + f.z * hb * fs + r.z * ht * rs;
        const h = this.sampleGround(x, z);
        hs[k++] = h; sum += h; if (h > max) max = h;
      }
    }
    // Front-left, front-right, rear-left, rear-right in hs.
    const frontAvg = (hs[0] + hs[1]) * 0.5, rearAvg = (hs[2] + hs[3]) * 0.5;
    const leftAvg = (hs[0] + hs[2]) * 0.5, rightAvg = (hs[1] + hs[3]) * 0.5;
    this.pitch = Math.atan2(frontAvg - rearAvg, wheelBase);
    this.roll = Math.atan2(leftAvg - rightAvg, track);
    // Bias toward the highest wheel so the chassis rides over crests instead of
    // sinking its nose through them.
    return lerp(sum / 4, max, 0.35);
  }

  update(dt, input) {
    const s = this.spec;
    const steerIn = clamp(input.steer || 0, -1, 1);
    const throttle = clamp(input.throttle || 0, 0, 1);
    const brake = clamp(input.brake || 0, 0, 1);
    const handbrake = !!input.handbrake;

    this.throttleIn = throttle;
    const ground = this.probeWheels();
    const rest = ground + s.rideHeight;

    if (this.pos.y > rest + AIR_THRESHOLD) {
      this.airborne = true;
      this.vel.y -= GRAVITY * dt;
    } else {
      if (this.airborne && this.vel.y < -6) this.speed *= 0.86;   // hard landing scrubs speed
      this.airborne = false;
      this.vel.y = 0;
      // Critically damped-ish settle rather than a hard snap, so bumps are felt.
      this.pos.y += (rest - this.pos.y) * Math.min(1, dt * 16);
    }

    const road = nearest(this.pos.x, this.pos.z);
    this.onRoad = road.dist <= 6.2;
    this.surface = corridorWeight(road.dist);         // 1 tarmac, 0 open country

    // Leaving the tarmac costs three different things, and they are not the same
    // thing. Losing engine power off-road would be wrong — what you actually lose is
    // traction, and what really slows you is the ground dragging at the wheels.
    const pull = 0.72 + 0.28 * this.surface;
    const hold = (0.5 + 0.5 * this.surface) * this.weatherGrip;
    const rollNow = s.roll * (1 + 4 * (1 - this.surface));

    if (!this.airborne) {
      const speedAbs = Math.abs(this.speed);

      if (throttle > 0) {
        const curve = Math.max(0, 1 - Math.max(0, this.speed) / s.topSpeed);
        this.speed += s.power * throttle * curve * pull * dt;
      }
      // The brake doubles as reverse once stopped — one pedal, Dr. Driving style —
      // but only after a beat. Without the dwell a panic stop rolls you backwards
      // before you can lift your thumb.
      this.stopped = this.speed > 0.4 ? 0 : this.stopped + dt;
      if (brake > 0) {
        if (this.speed > 0.4) {
          this.speed -= s.brake * brake * hold * dt;
          if (this.speed < 0) this.speed = 0;
        } else if (this.stopped > 0.35) {
          const curve = Math.max(0, 1 + Math.min(0, this.speed) / s.reverseTop);
          this.speed -= s.power * 0.62 * brake * curve * dt;
        }
      }

      this.speed -= this.speed * rollNow * dt;
      this.speed -= this.speed * speedAbs * s.drag * dt;

      // Slope: gravity pulls you down hills and bleeds speed going up.
      const f = this.forward();
      const gx = this.sampleGround(this.pos.x + f.x * 2, this.pos.z + f.z * 2);
      const gb = this.sampleGround(this.pos.x - f.x * 2, this.pos.z - f.z * 2);
      const grade = clamp((gb - gx) / 4, -1, 1);
      this.speed += grade * GRAVITY * 0.42 * dt;

      // Steering authority falls off with speed, or the car would spin on its axis
      // at 120 km/h. It also does nothing at a standstill.
      const auth = clamp(1 / (1 + speedAbs * 0.045), 0.2, 1)
        * clamp(speedAbs / 2.2, 0, 1)
        * Math.sign(this.speed || 1);
      this.steerAngle = lerp(this.steerAngle, steerIn * 0.52, Math.min(1, dt * 9));
      this.yaw += steerIn * s.steerRate * auth * dt;

      // Sideways velocity is scrubbed off at `grip` per second. Break the limit — or
      // pull the handbrake — and it scrubs far more slowly: that is the drift.
      const slipping = Math.abs(this.lateral) > 4.2;
      const g = (handbrake ? s.grip * 0.16 : slipping ? s.grip * 0.5 : s.grip) * hold;
      this.lateral *= Math.exp(-g * dt);
      // Turning throws weight sideways; that is what feeds the slide in the first place.
      this.lateral += -steerIn * auth * speedAbs * 0.38 * dt * (handbrake ? 3.2 : 1);

      const r = this.right();
      this.vel.set(
        f.x * this.speed + r.x * this.lateral,
        this.vel.y,
        f.z * this.speed + r.z * this.lateral,
      );
    } else {
      // In the air the wheels do nothing; only gravity and whatever you left with.
      const f = this.forward(), r = this.right();
      this.vel.x = f.x * this.speed + r.x * this.lateral;
      this.vel.z = f.z * this.speed + r.z * this.lateral;
      this.steerAngle = lerp(this.steerAngle, steerIn * 0.52, Math.min(1, dt * 4));
    }

    this.pos.addScaledVector(this.vel, dt);

    // Trees and boulders are solid. Circle-vs-circle in the ground plane: push out,
    // and the head-on component of the hit becomes lost speed. A glancing blow
    // scrubs a little and shoves the nose aside; a square hit is a wall.
    if (!this.airborne) {
      const obs = obstaclesNear(this.pos.x, this.pos.z, this._obs || (this._obs = []));
      // Megafauna join the solid world as moving obstacles.
      const big = bigAnimalsNear(this.pos.x, this.pos.z, this._big || (this._big = []));
      for (const b of big) obs.push(b);
      if (obs.length) {
        const R = 1.05;
        const f = this.forward();
        for (const o of obs) {
          const dx = this.pos.x - o.x, dz = this.pos.z - o.z;
          const rr = o.r + R;
          const d2 = dx * dx + dz * dz;
          if (d2 >= rr * rr) continue;
          const d = Math.sqrt(d2) || 0.001;
          const push = rr - d;
          this.pos.x += (dx / d) * push;
          this.pos.z += (dz / d) * push;
          const head = Math.max(0, -((dx * f.x + dz * f.z) / d));
          this.impact = Math.max(this.impact || 0, head * Math.abs(this.speed));
          this.speed *= 1 - head * 0.88;
          this.lateral *= 0.55;
        }
      }
    }

    this.wheelSpin += (this.speed / s.wheelR) * dt;

    this.groundNormal.set(
      -Math.sin(this.roll) * Math.cos(this.yaw) - Math.sin(this.pitch) * Math.sin(this.yaw),
      1,
      Math.sin(this.roll) * Math.sin(this.yaw) - Math.sin(this.pitch) * Math.cos(this.yaw),
    ).normalize();
  }

  get kmh() { return Math.abs(this.speed) * 3.6; }
  get along() { return nearest(this.pos.x, this.pos.z).along; }

  // Forgiving recovery: put the car back on the tarmac facing forward, keeping the
  // journey position. Never a fail state, only lost time.
  recover() {
    const r = nearest(this.pos.x, this.pos.z);
    const along = r.dist < 1e8 ? r.along : this.pos.z;
    this.placeOnRoad(along);
  }
}
