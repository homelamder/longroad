import * as THREE from 'three';
import { elevation } from '../../world/terrain.js';
import { pointAt } from '../../world/road.js';
import { STONE, prop, secs } from './lib.js';

// The three pure driving tasks. No fail states — blowing the timer resets the
// attempt with a line of text, never the run.

// --- dust-storm run ---------------------------------------------------------
export const dustRun = {
  id: 'dust-run',
  name: 'Wall of dust — outrun it',
  biomes: ['emberfall'],
  time: 'day',
  needsFoot: false,

  DIST: 450,
  TIME: 42,

  start(ctx) {
    const s = ctx.station;
    this.goalAlong = s.along + this.DIST;
    const g = pointAt(this.goalAlong);
    this.goal = { x: g.x, y: g.y, z: g.z };
    this.t = this.TIME;
    ctx.weather.set('dust', true);
    ctx.marker.show(g.x, g.y, g.z);
  },

  update(dt, ctx) {
    this.t -= dt;
    const car = ctx.car;
    const d = Math.hypot(car.pos.x - this.goal.x, car.pos.z - this.goal.z);
    ctx.hud.setObjective(`beat the storm to the waymarker · ${Math.round(d)} m · ${secs(this.t)}`);
    if (d < 16) return 'done';
    if (this.t <= 0) {
      // The storm "catches you": reset the clock, keep driving. Lost time is the cost.
      this.t = this.TIME;
      ctx.hud.note('the dust swallows the road — pushing on', 3);
    }
    return 'running';
  },

  cleanup(ctx) {
    ctx.weather.set('clear');
    ctx.weather.hold = 30;
    ctx.interact.clear();
  },
};

// --- ford the river ---------------------------------------------------------
export const fordRiver = {
  id: 'ford-river',
  name: 'The crossing — ford the stream',
  biomes: ['whisper', 'marsh'],
  time: 'any',
  needsFoot: false,

  start(ctx) {
    const s = ctx.station;
    // The ford spans the road ~120 m ahead: a shallow sheet of water between banks.
    this.entry = s.along + 120;
    this.exit = this.entry + 26;
    const p = pointAt(this.entry + 13);
    const y = elevation(p.x, p.z);

    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 26),
      new THREE.MeshStandardMaterial({
        color: 0x3f6f86, roughness: 0.15, metalness: 0.5,
        transparent: true, opacity: 0.82,
      }),
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.rotation.z = Math.atan2(p.rx, p.rz);
    this.water.position.set(p.x, y + 0.16, p.z);
    ctx.scene.add(this.water);

    for (const side of [-1, 1]) {
      prop(ctx.scene, new THREE.IcosahedronGeometry(0.7, 0), STONE,
        p.x + p.rx * side * 7, y + 0.3, p.z + p.rz * side * 7);
    }

    const e = pointAt(this.exit + 8);
    this.goal = { x: e.x, y: e.y, z: e.z };
    ctx.marker.show(e.x, e.y, e.z);
    ctx.hud.setObjective('cross at a walking pace — under 15 km/h');
    this.wasInside = false;
  },

  update(dt, ctx) {
    const car = ctx.car;
    const along = car.along;
    const inside = along > this.entry && along < this.exit;

    if (inside) {
      this.wasInside = true;
      if (car.kmh > 15) {
        // Too fast: the bow wave drowns the engine. Set back to the entry, no drama.
        car.placeOnRoad(this.entry - 18);
        ctx.hud.note('the bow wave floods the intake — eased back', 3);
      } else {
        ctx.hud.setObjective(`steady… ${Math.round(car.kmh)} km/h`);
      }
    }

    if (this.wasInside && along > this.exit + 4) return 'done';
    return 'running';
  },

  cleanup(ctx) {
    ctx.scene.remove(this.water);
    ctx.interact.clear();
  },
};

// --- avalanche escape -------------------------------------------------------
export const avalanche = {
  id: 'avalanche',
  name: 'The mountain moves — outrun the slide',
  biomes: ['frostveil'],
  time: 'any',
  needsFoot: false,

  DIST: 520,
  TIME: 46,

  start(ctx) {
    const s = ctx.station;
    this.goalAlong = s.along + this.DIST;
    const g = pointAt(this.goalAlong);
    this.goal = { x: g.x, y: g.y, z: g.z };
    this.t = this.TIME;
    this.rumble = 0;
    ctx.weather.set('blizzard', true);
    ctx.marker.show(g.x, g.y, g.z);

    // Boulders of snow bounding down alongside — theatre, not collision.
    this.balls = [];
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9 + (i % 3) * 0.4, 0),
        new THREE.MeshStandardMaterial({ color: 0xeef2f8, roughness: 0.9 }));
      b.castShadow = true;
      b.visible = false;
      ctx.scene.add(b);
      this.balls.push({ mesh: b, t: i * 1.3 });
    }
  },

  update(dt, ctx) {
    this.t -= dt;
    const car = ctx.car;

    // Snowballs overtake on the uphill side, tumbling past the car.
    this.rumble += dt;
    for (const b of this.balls) {
      b.t -= dt;
      if (b.t <= 0) {
        b.t = 4 + Math.random() * 3;
        const side = Math.random() < 0.5 ? -1 : 1;
        const r = pointAt(car.along + 30 + Math.random() * 40);
        b.mesh.position.set(r.x + r.rx * side * (9 + Math.random() * 6), r.y + 6, r.z + r.rz * side);
        b.vel = { y: 0, along: -(14 + Math.random() * 8) };
        b.mesh.visible = true;
      }
      if (b.mesh.visible) {
        b.mesh.position.y -= (b.vel.y += 9 * dt) * dt;
        const ground = elevation(b.mesh.position.x, b.mesh.position.z);
        if (b.mesh.position.y < ground + 0.6) { b.mesh.position.y = ground + 0.6; b.vel.y = -3.2; }
        b.mesh.position.z += b.vel.along * dt * 0.3;
        b.mesh.rotation.x -= dt * 4;
      }
    }

    const d = Math.hypot(car.pos.x - this.goal.x, car.pos.z - this.goal.z);
    ctx.hud.setObjective(`get clear of the slide · ${Math.round(d)} m · ${secs(this.t)}`);
    if (d < 16) return 'done';
    if (this.t <= 0) {
      this.t = this.TIME;
      ctx.hud.note('buried to the axles — dig out, drive on', 3);
      car.speed = 0;
    }
    return 'running';
  },

  cleanup(ctx) {
    for (const b of this.balls) ctx.scene.remove(b.mesh);
    ctx.weather.set('snow');
    ctx.weather.hold = 30;
    ctx.interact.clear();
  },
};

export const DRIVING_TASKS = [dustRun, fordRiver, avalanche];
