import * as THREE from 'three';
import { elevation } from '../../world/terrain.js';
import { pointAt } from '../../world/road.js';
import { clamp } from '../../world/rng.js';

// Three tasks built around the newer systems: a chase that uses the car's own
// physics, a night walk that uses the orbit camera and the stars, and a river
// job that uses the Working animation. Each is a different verb from the first
// sixteen — pursue, behold, labour.

const wood = new THREE.MeshStandardMaterial({ color: 0x5d4327, roughness: 0.92 });

// --- the runaway -------------------------------------------------------------
// A sheep has bolted from the flock. Run it down gently: get close and stay slow
// and it calms; charge it and it panics further up the valley.
export const runaway = {
  id: 'runaway',
  name: 'The runaway — bring the sheep home',
  biomes: ['verdant', 'duskwood'],
  time: 'day',
  needsFoot: false,

  start(ctx) {
    this.calm = 0;
    this.panic = 0;
    const s = ctx.station;
    const p = pointAt(s.along + 90);
    const sx = p.x + p.rx * 55, sz = p.z + p.rz * 55;

    // A woolly runaway: rounded body, dark face and legs.
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.52, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.95 }),
    );
    body.scale.set(1.25, 1, 0.95);
    body.position.y = 0.62;
    body.castShadow = true;
    g.add(body);
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2620, roughness: 0.85 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), dark);
    head.position.set(0, 0.72, 0.58);
    g.add(head);
    for (const [lx, lz] of [[-0.22, 0.3], [0.22, 0.3], [-0.22, -0.3], [0.22, -0.3]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 5), dark);
      leg.position.set(lx, 0.21, lz);
      g.add(leg);
    }
    g.position.set(sx, elevation(sx, sz), sz);
    ctx.scene.add(g);
    this.sheep = g;
    this.vel = { x: 0, z: 0 };
    this.goal = { x: sx, z: sz };        // the drive-task contract: chase this
    ctx.hud.setObjective('the sheep bolted — approach gently, no charging');
    ctx.marker.show(sx, g.position.y + 2.2, sz);
  },

  update(dt, ctx) {
    const s = this.sheep;
    const car = ctx.car;
    const dx = s.position.x - car.pos.x, dz = s.position.z - car.pos.z;
    const dist = Math.hypot(dx, dz);
    const speed = Math.abs(car.speed);

    // Fear: near AND fast = bolt away from the car. Near and slow = calming.
    if (dist < 26 && speed > 9) {
      this.panic = Math.min(1, this.panic + dt * 1.4);
      this.calm = 0;
    } else {
      this.panic = Math.max(0, this.panic - dt * 0.5);
    }

    if (this.panic > 0.05 && dist < 60) {
      const flee = 7.5 * this.panic;
      this.vel.x = (dx / (dist || 1)) * flee;
      this.vel.z = (dz / (dist || 1)) * flee;
    } else {
      this.vel.x *= Math.exp(-2.2 * dt);
      this.vel.z *= Math.exp(-2.2 * dt);
    }
    s.position.x += this.vel.x * dt;
    s.position.z += this.vel.z * dt;
    s.position.y = elevation(s.position.x, s.position.z);
    if (this.vel.x || this.vel.z) s.rotation.y = Math.atan2(this.vel.x, this.vel.z);

    this.goal.x = s.position.x;
    this.goal.z = s.position.z;
    ctx.marker.show(s.position.x, s.position.y + 2.2, s.position.z);

    if (dist < 13 && speed < 5.5 && this.panic < 0.1) {
      this.calm += dt;
      ctx.hud.setObjective(`easy now… ${Math.ceil(3 - this.calm)}s`);
      if (this.calm >= 3) return 'done';
    } else {
      this.calm = 0;
      ctx.hud.setObjective(this.panic > 0.4
        ? 'it is panicking — back off and slow down'
        : 'approach gently — under 20 km/h when close');
    }
    return 'running';
  },

  cleanup(ctx) {
    ctx.scene.remove(this.sheep);
    ctx.hud.setObjective('');
  },
};

// --- stargazer ---------------------------------------------------------------
// Three sighting stones stand away from the road light. Visit each in the dark;
// at every stone a constellation kindles overhead.
export const stargazer = {
  id: 'stargazer',
  name: 'Stargazer — read the night sky',
  biomes: 'any',
  time: 'night',
  needsFoot: true,

  start(ctx) {
    this.visited = 0;
    this.lines = [];
    const s = ctx.station;
    const p = pointAt(s.along);
    this.stones = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.6;
      const x = p.x - p.rx * (26 + i * 14) + Math.cos(a) * 12;
      const z = p.z - p.rz * (26 + i * 14) + Math.sin(a) * 12;
      const y = elevation(x, z);
      const stone = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.45, 1.5, 6),
        new THREE.MeshStandardMaterial({ color: 0x6a6860, roughness: 0.95 }),
      );
      stone.position.set(x, y + 0.7, z);
      stone.castShadow = true;
      ctx.scene.add(stone);
      this.stones.push({ mesh: stone, x, y, z, seen: false });
    }
    this.aim(ctx);
  },

  aim(ctx) {
    const next = this.stones.find((st) => !st.seen);
    if (!next) return;
    ctx.marker.show(next.x, next.y + 2.4, next.z);
    ctx.interact.set({ x: next.x, z: next.z, radius: 2.8, label: 'read the stars' });
    ctx.hud.setObjective(`sighting stones · ${this.visited}/3`);
  },

  kindle(ctx, stone) {
    // A constellation blooms above the stone: bright points joined by faint lines.
    const n = 5 + this.visited * 2;
    const pts = [];
    for (let i = 0; i < n; i++) {
      pts.push(new THREE.Vector3(
        stone.x + (Math.random() - 0.5) * 30,
        stone.y + 55 + Math.random() * 25,
        stone.z + (Math.random() - 0.5) * 30,
      ));
    }
    const starGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0xcfe2ff, size: 1.4, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const lines = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({
      color: 0x8fb0d8, transparent: true, opacity: 0.35, fog: false,
    }));
    ctx.scene.add(stars);
    ctx.scene.add(lines);
    this.lines.push(stars, lines);
  },

  update(dt, ctx) {
    const next = this.stones.find((st) => !st.seen);
    if (!next) return 'done';
    if (ctx.interact.update(ctx.foot)) {
      next.seen = true;
      this.visited++;
      this.kindle(ctx, next);
      ctx.foot.playOnce?.('Working');
      if (this.visited >= 3) {
        ctx.hud.setObjective('the sky is read');
        return 'done';
      }
      this.aim(ctx);
    }
    return 'running';
  },

  cleanup(ctx) {
    for (const st of this.stones) ctx.scene.remove(st.mesh);
    for (const l of this.lines) ctx.scene.remove(l);
    ctx.hud.setObjective('');
    ctx.interact.clear();
  },
};

// --- the log jam -------------------------------------------------------------
// Storm-fallen trunks have dammed the creek. Haul three clear and the pool
// drains back to a stream. Pure labour, and the Working animation earns its name.
export const logjam = {
  id: 'log-jam',
  name: 'The log jam — free the creek',
  biomes: ['whisper', 'marsh', 'duskwood'],
  time: 'day',
  needsFoot: true,

  start(ctx) {
    this.cleared = 0;
    const s = ctx.station;
    const p = pointAt(s.along);
    const cx = p.x - p.rx * 22, cz = p.z - p.rz * 22;
    const cy = elevation(cx, cz);

    // The trapped pool, sitting slightly proud; it sinks as logs come clear.
    this.pool = new THREE.Mesh(
      new THREE.CircleGeometry(7.5, 24),
      new THREE.MeshStandardMaterial({
        color: 0x39544e, roughness: 0.15, transparent: true, opacity: 0.85,
      }),
    );
    this.pool.rotation.x = -Math.PI / 2;
    this.pool.position.set(cx, cy + 0.3, cz);
    ctx.scene.add(this.pool);

    this.logs = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.9;
      const x = cx + Math.cos(a) * 5.4, z = cz + Math.sin(a) * 5.4;
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 3.6, 7), wood);
      log.position.set(x, elevation(x, z) + 0.28, z);
      log.rotation.set(Math.PI / 2, 0, a + 0.7);
      log.castShadow = true;
      ctx.scene.add(log);
      this.logs.push({ mesh: log, x, z, cleared: false });
    }
    this.aim(ctx);
  },

  aim(ctx) {
    const next = this.logs.find((l) => !l.cleared);
    if (!next) return;
    ctx.marker.show(next.x, next.mesh.position.y + 1.8, next.z);
    ctx.interact.set({ x: next.x, z: next.z, radius: 2.6, label: 'haul the trunk clear' });
    ctx.hud.setObjective(`free the creek · ${this.cleared}/3 trunks`);
  },

  update(dt, ctx) {
    if (ctx.interact.update(ctx.foot)) {
      const next = this.logs.find((l) => !l.cleared);
      if (next) {
        next.cleared = true;
        this.cleared++;
        ctx.foot.playOnce?.('Working');
        // The trunk swings aside onto the bank.
        next.mesh.position.x += (next.x - this.pool.position.x) * 1.6;
        next.mesh.position.z += (next.z - this.pool.position.z) * 1.6;
        next.mesh.position.y = elevation(next.mesh.position.x, next.mesh.position.z) + 0.28;
        // The pool drops with every log freed.
        this.pool.position.y -= 0.09;
        this.pool.scale.setScalar(1 - this.cleared * 0.18);
        if (this.cleared >= 3) {
          ctx.hud.setObjective('the creek runs clear');
          return 'done';
        }
        this.aim(ctx);
      }
    }
    return 'running';
  },

  cleanup(ctx) {
    ctx.scene.remove(this.pool);
    for (const l of this.logs) ctx.scene.remove(l.mesh);
    ctx.hud.setObjective('');
    ctx.interact.clear();
  },
};

export const WONDER_TASKS = [runaway, stargazer, logjam];
