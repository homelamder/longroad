import * as THREE from 'three';
import { elevation, groundNormal } from '../../world/terrain.js';
import { pointAt } from '../../world/road.js';
import { clamp, lerp } from '../../world/rng.js';

// The first three tasks. Between them they exercise everything the framework has:
// collect-N (firewood), interact-with-the-world (boulders), go-and-return (water).
// The later thirteen are variations on these three verbs.

const wood = new THREE.MeshStandardMaterial({ color: 0x6b4f30, roughness: 0.9 });
const stone = new THREE.MeshStandardMaterial({ color: 0x76716a, roughness: 0.95 });

// Scatter helper: N positions in a ring around a centre, pushed onto real ground.
function ring(cx, cz, n, rMin, rMax, rng = Math.random) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 1.1;
    const r = rMin + rng() * (rMax - rMin);
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    out.push({ x, y: elevation(x, z), z });
  }
  return out;
}

// --- firewatch --------------------------------------------------------------
// Gather three deadfall branches, stack the fire, light it. The heart of what later
// becomes the night-in-the-cave task.
export const firewatch = {
  id: 'firewatch',
  name: 'Firewatch — build the evening fire',
  biomes: 'any',
  time: 'any',
  needsFoot: true,

  start(ctx) {
    const s = ctx.station;
    // Tasks are registry singletons — the same object runs at many stations. Every
    // transient MUST reset here or a later run inherits the earlier run's endgame
    // (a stale flame made the second firewatch complete on its first frame).
    this.carrying = 0;
    this.stacked = 0;
    this.lit = false;
    this.flame = null;
    this.light = null;
    this.flameT = 0;

    // The fire ring sits across the road from the station canopy.
    const p = pointAt(s.along);
    const fx = p.x - p.rx * 14, fz = p.z - p.rz * 14;
    this.fire = new THREE.Group();
    this.fire.position.set(fx, elevation(fx, fz), fz);
    const ringGeo = new THREE.TorusGeometry(0.9, 0.14, 6, 14);
    ringGeo.rotateX(Math.PI / 2);
    this.fire.add(new THREE.Mesh(ringGeo, stone));
    ctx.scene.add(this.fire);
    this.firePos = { x: fx, z: fz };

    this.branches = ring(fx, fz, 3, 14, 30).map((pos) => {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 1.5, 6), wood);
      b.position.set(pos.x, pos.y + 0.12, pos.z);
      b.rotation.set(Math.PI / 2 * 0.94, 0, Math.random() * Math.PI);
      b.castShadow = true;
      ctx.scene.add(b);
      return { mesh: b, ...pos, taken: false };
    });

    this.aim(ctx);
  },

  aim(ctx) {
    const next = this.branches.find((b) => !b.taken);
    if (next && this.carrying === 0) {
      ctx.marker.show(next.x, next.y, next.z);
      ctx.interact.set({ ...next, radius: 2.6, label: 'take the branch' });
      ctx.hud.setObjective(`gather deadfall · ${this.stacked}/3 stacked`);
    } else {
      ctx.marker.show(this.firePos.x, this.fire.position.y, this.firePos.z);
      ctx.interact.set({
        x: this.firePos.x, z: this.firePos.z, radius: 2.8,
        label: this.stacked < 3 ? 'stack the wood' : 'light the fire',
      });
      ctx.hud.setObjective(this.stacked < 3
        ? `carry it to the fire ring · ${this.stacked}/3`
        : 'light the fire');
    }
  },

  update(dt, ctx) {
    if (this.flame) {
      this.flameT += dt;
      this.flame.scale.setScalar(1 + Math.sin(this.flameT * 11) * 0.12);
      this.light.intensity = 15 + Math.sin(this.flameT * 9) * 3.5;
      return this.flameT > 3.2 ? 'done' : 'running';
    }

    if (!ctx.interact.update(ctx.foot)) return 'running';

    if (this.carrying === 0 && this.stacked < 3) {
      const b = this.branches.find((x) => !x.taken);
      b.taken = true;
      ctx.scene.remove(b.mesh);
      this.carrying = 1;
    } else if (this.carrying === 1) {
      this.carrying = 0;
      this.stacked++;
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 1.3, 6), wood);
      log.rotation.set(Math.PI / 2, 0, this.stacked * 1.1);
      log.position.y = 0.14 + this.stacked * 0.07;
      this.fire.add(log);
    } else if (this.stacked >= 3) {
      this.lit = true;
      this.flameT = 0;
      this.flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.5, 1.3, 7),
        new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.85 }),
      );
      this.flame.position.y = 0.8;
      this.light = new THREE.PointLight(0xff9040, 15, 30, 1.6);
      this.light.position.y = 1.4;
      this.fire.add(this.flame, this.light);
      ctx.interact.clear();
      ctx.marker.hide();
      ctx.hud.setObjective('the fire takes hold');
    }
    this.aim(ctx);
    return 'running';
  },

  cleanup(ctx) {
    // The lit fire STAYS — driving off from a burning campfire you built is the
    // whole reward. Only unclaimed branches are tidied away.
    for (const b of this.branches) if (!b.taken) ctx.scene.remove(b.mesh);
    ctx.interact.clear();
    if (!this.lit) ctx.scene.remove(this.fire);
  },
};

// --- clear the road ---------------------------------------------------------
export const clearRoad = {
  id: 'clear-road',
  name: 'Rockfall — clear the road',
  biomes: ['duskwood', 'emberfall', 'frostveil', 'ashen', 'whisper'],
  time: 'any',
  needsFoot: true,

  start(ctx) {
    const s = ctx.station;
    this.rocks = [];
    for (let i = 0; i < 3; i++) {
      const p = pointAt(s.along + 26 + i * 9);
      const off = (i - 1) * 2.6;
      const x = p.x + p.rx * off, z = p.z + p.rz * off;
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85 + (i % 2) * 0.3, 0), stone);
      rock.position.set(x, elevation(x, z) + 0.5, z);
      rock.rotation.set(i * 1.7, i * 0.9, 0);
      rock.castShadow = true;
      ctx.scene.add(rock);
      // Rolls away to the downhill side of the road when shoved.
      this.rocks.push({ mesh: rock, x, z, cleared: false, dir: { x: p.rx, z: p.rz }, anim: 0 });
    }
    this.aim(ctx);
  },

  aim(ctx) {
    const next = this.rocks.find((r) => !r.cleared);
    if (!next) return;
    ctx.marker.show(next.x, next.mesh.position.y, next.z);
    ctx.interact.set({ x: next.x, z: next.z, radius: 2.6, label: 'shove the boulder' });
    const done = this.rocks.filter((r) => r.cleared).length;
    ctx.hud.setObjective(`roll the rockfall off the road · ${done}/3`);
  },

  update(dt, ctx) {
    // Shoved rocks tumble off the shoulder.
    let animating = false;
    for (const r of this.rocks) {
      if (!r.cleared || r.anim >= 1) continue;
      animating = true;
      r.anim = Math.min(1, r.anim + dt * 0.9);
      const d = r.anim * 9;
      const nx = r.x + r.dir.x * d, nz = r.z + r.dir.z * d;
      r.mesh.position.set(nx, elevation(nx, nz) + 0.5 + Math.sin(r.anim * Math.PI) * 0.4, nz);
      r.mesh.rotation.x += dt * 5;
    }

    if (this.rocks.every((r) => r.cleared)) {
      if (!animating) return 'done';
      return 'running';
    }

    if (ctx.interact.update(ctx.foot)) {
      this.rocks.find((r) => !r.cleared).cleared = true;
      this.aim(ctx);
    }
    return 'running';
  },

  cleanup(ctx) {
    // Cleared rocks stay on the verge — evidence of work done. They are far from
    // the tarmac so they never obstruct anything.
    ctx.interact.clear();
  },
};

// --- find water -------------------------------------------------------------
export const findWater = {
  id: 'find-water',
  name: 'Dry radiator — find water',
  biomes: 'any',
  time: 'any',
  needsFoot: true,

  start(ctx) {
    const s = ctx.station;
    // The spring: a cairn off-road, uphill side, 50-80 m out.
    const p = pointAt(s.along);
    const side = 1;                          // stations sit at +12; spring opposite
    const dist = 55 + Math.random() * 25;
    const sx = p.x - p.rx * dist * side, sz = p.z - p.rz * dist * side;
    const sy = elevation(sx, sz);

    this.spring = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const st = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34 - i * 0.055, 0), stone);
      st.position.y = i * 0.34;
      st.rotation.set(i, i * 2.1, 0);
      st.castShadow = true;
      this.spring.add(st);
    }
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(1.3, 14),
      new THREE.MeshStandardMaterial({ color: 0x3f6f86, roughness: 0.15, metalness: 0.4 }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.03;
    this.spring.add(pool);
    this.spring.position.set(sx, sy, sz);
    ctx.scene.add(this.spring);

    this.filled = false;
    this.springPos = { x: sx, y: sy, z: sz };
    ctx.marker.show(sx, sy, sz);
    ctx.interact.set({ x: sx, z: sz, radius: 2.8, label: 'fill the canteen' });
    ctx.hud.setObjective('find the spring — follow the light');
  },

  update(dt, ctx) {
    if (ctx.interact.update(ctx.foot)) {
      if (!this.filled) {
        this.filled = true;
        const s = ctx.station;
        ctx.marker.show(s.x, s.y, s.z);
        ctx.interact.set({ x: s.x, z: s.z, radius: 4.2, label: 'top up the radiator' });
        ctx.hud.setObjective('carry the water back');
      } else {
        return 'done';
      }
    }
    return 'running';
  },

  cleanup(ctx) {
    // The cairn is a real place now; leave it. Springs do not evaporate because an
    // errand finished.
    ctx.interact.clear();
  },
};

export const FIRST_TASKS = [firewatch, clearRoad, findWater];
