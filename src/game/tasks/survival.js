import * as THREE from 'three';
import { elevation } from '../../world/terrain.js';
import { pointAt } from '../../world/road.js';
import { WOOD, STONE, prop, ring, secs, buildFire, addLog, setFireLit } from './lib.js';

// The survival-and-stewardship tasks: the cave night, the ashfall shelter, the
// firefly lanterns, the canopy seeds, and the bridge repair.

// --- a night in the cave ----------------------------------------------------
// The centrepiece task from the original pitch: snow coming down, a cave in the
// rocks, a fire that must be kept alive until first light.
export const caveNight = {
  id: 'cave-night',
  name: 'Snowbound — shelter until first light',
  biomes: ['frostveil'],
  time: 'night',
  needsFoot: false,                     // begins in the car: drive to the cave

  NIGHT_LENGTH: 80,                     // seconds of fire-tending before dawn
  LOG_BURN: 22,                         // seconds a log lasts

  start(ctx) {
    const { cave } = ctx.landmarks.nearestCave(ctx.car.pos);
    this.cave = cave;
    this.phase = 'drive';
    ctx.weather.set('blizzard', true);
    ctx.marker.show(cave.x, cave.y + 2, cave.z);
    ctx.hud.setObjective('a cave — get to shelter');

    this.fire = buildFire();
    this.fire.position.copy(cave.hearth);
    this.fire.position.y = elevation(cave.hearth.x, cave.hearth.z) + 0.05;
    ctx.scene.add(this.fire);

    // Deadfall in the lee of the rocks outside.
    this.branches = ring(cave.x, cave.z, 4, 8, 20).map((pos) => {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 1.5, 6), WOOD);
      b.position.set(pos.x, pos.y + 0.12, pos.z);
      b.rotation.set(Math.PI / 2 * 0.94, 0, Math.random() * Math.PI);
      b.castShadow = true;
      ctx.scene.add(b);
      return { mesh: b, ...pos, taken: false };
    });

    this.carrying = 0;
    this.stacked = 0;
    this.lit = false;
    this.burn = 0;
    this.warm = 0;
    this.flameT = 0;
  },

  aim(ctx) {
    const next = this.branches.find((b) => !b.taken);
    if (this.carrying === 0 && next) {
      ctx.marker.show(next.x, next.y, next.z);
      ctx.interact.set({ ...next, radius: 2.6, label: 'gather deadfall' });
    } else {
      ctx.marker.show(this.fire.position.x, this.fire.position.y + 1, this.fire.position.z);
      ctx.interact.set({
        x: this.fire.position.x, z: this.fire.position.z, radius: 2.8,
        label: this.carrying ? 'feed the fire' : (this.lit ? 'wait out the night' : 'strike the fire'),
      });
    }
  },

  update(dt, ctx) {
    if (this.phase === 'drive') {
      const d = Math.hypot(ctx.car.pos.x - this.cave.x, ctx.car.pos.z - this.cave.z);
      if (d < 26 && Math.abs(ctx.car.speed) < 1.5) {
        this.phase = 'camp';
        ctx.mgr.exitCar();
        this.aim(ctx);
      }
      return 'running';
    }

    // Fire simulation: burning consumes the stack; warmth accrues only while lit.
    if (this.lit) {
      this.flameT += dt;
      this.burn -= dt;
      this.warm += dt;
      setFireLit(this.fire, true, this.flameT);
      if (this.burn <= 0) {
        this.lit = this.stacked > 0;
        if (this.lit) { this.stacked--; this.burn = this.LOG_BURN; }
        else {
          setFireLit(this.fire, false);
          ctx.hud.note('the fire gutters out — feed it', 3);
        }
      }
      if (this.warm >= this.NIGHT_LENGTH) {
        // First light. The blizzard breaks with the dawn.
        ctx.sky.setTime(0.27);
        ctx.weather.set('clear', true);
        ctx.hud.setObjective('dawn over the pass');
        return 'done';
      }
    }

    const pct = Math.round((this.warm / this.NIGHT_LENGTH) * 100);
    ctx.hud.setObjective(this.lit
      ? `keep it burning until first light · ${pct}% · ${this.stacked} logs in reserve`
      : `the cold is in the stone · gather wood, light the fire · ${pct}%`);

    if (!ctx.interact.update(ctx.foot)) return 'running';

    const next = this.branches.find((b) => !b.taken);
    if (this.carrying === 0 && next
      && Math.hypot(next.x - ctx.foot.pos.x, next.z - ctx.foot.pos.z) < 2.7) {
      next.taken = true;
      ctx.scene.remove(next.mesh);
      this.carrying = 1;
    } else if (this.carrying === 1) {
      this.carrying = 0;
      addLog(this.fire);
      this.stacked++;
    } else if (!this.lit && this.stacked > 0) {
      this.lit = true;
      this.stacked--;
      this.burn = this.LOG_BURN;
    }
    this.aim(ctx);
    return 'running';
  },

  cleanup(ctx) {
    // The morning after stays: cave, cold fire ring. Uncollected wood goes.
    for (const b of this.branches) if (!b.taken) ctx.scene.remove(b.mesh);
    setFireLit(this.fire, false);
    ctx.weather.hold = 40;
    ctx.interact.clear();
  },
};

// --- weather the ashfall ----------------------------------------------------
export const ashShelter = {
  id: 'ash-shelter',
  name: 'The sky closes — shelter from the ashfall',
  biomes: ['ashen'],
  time: 'any',
  needsFoot: false,

  WAIT: 34,

  start(ctx) {
    const s = ctx.station;
    // A basalt overhang a short drive ahead, off the road.
    const p = pointAt(s.along + 150);
    this.spot = { x: p.x + p.rx * 18, z: p.z + p.rz * 18 };
    this.spotY = elevation(this.spot.x, this.spot.z);

    this.roof = new THREE.Group();
    const slab = new THREE.Mesh(new THREE.BoxGeometry(9, 1.2, 7),
      new THREE.MeshStandardMaterial({ color: 0x3c3f46, roughness: 1 }));
    slab.position.set(this.spot.x, this.spotY + 4.4, this.spot.z);
    slab.rotation.z = 0.08;
    slab.castShadow = true;
    this.roof.add(slab);
    for (const [dx, dz] of [[-3.8, -2.8], [3.8, -2.8], [3.8, 2.8]]) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 4.4, 7),
        new THREE.MeshStandardMaterial({ color: 0x35312f, roughness: 1 }));
      pillar.position.set(this.spot.x + dx, this.spotY + 2.2, this.spot.z + dz);
      pillar.castShadow = true;
      this.roof.add(pillar);
    }
    ctx.scene.add(this.roof);

    ctx.weather.set('ashfall', true);
    ctx.marker.show(this.spot.x, this.spotY, this.spot.z);
    ctx.hud.setObjective('the ash thickens — get under the stone');
    this.t = this.WAIT;
    this.under = false;
  },

  update(dt, ctx) {
    const car = ctx.car;
    const d = Math.hypot(car.pos.x - this.spot.x, car.pos.z - this.spot.z);
    this.under = d < 7.5 && Math.abs(car.speed) < 1;

    if (this.under) {
      this.t -= dt;
      ctx.marker.hide();
      ctx.hud.setObjective(`engine off, ash on the stone overhead · ${secs(this.t)}`);
      if (this.t <= 0) {
        ctx.weather.set('clear', true);
        ctx.hud.setObjective('the sky opens again');
        return 'done';
      }
    } else {
      // Leaving mid-fall does not fail — the wait just does not advance.
      ctx.marker.show(this.spot.x, this.spotY, this.spot.z);
      ctx.hud.setObjective('park under the overhang, kill the engine');
    }
    return 'running';
  },

  cleanup(ctx) {
    // The overhang is architecture now; it stays.
    ctx.weather.hold = 40;
    ctx.interact.clear();
  },
};

// --- firefly lanterns -------------------------------------------------------
export const lanterns = {
  id: 'lanterns',
  name: 'Lights on the water — hang the lanterns',
  biomes: ['marsh'],
  time: 'night',
  needsFoot: true,

  start(ctx) {
    const s = ctx.station;
    const p = pointAt(s.along);

    // Three glow-reed clumps to gather, three way-posts to light.
    this.glows = ring(p.x - p.rx * 40, p.z - p.rz * 40, 3, 8, 34).map((pos) => {
      const clump = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 0),
        new THREE.MeshStandardMaterial({
          color: 0x2f4a2a, emissive: 0x9fdc6a, emissiveIntensity: 1.8,
        }));
      clump.position.set(pos.x, pos.y + 0.4, pos.z);
      ctx.scene.add(clump);
      return { mesh: clump, ...pos, taken: false };
    });

    this.posts = [0, 40, 80].map((d) => {
      const q = pointAt(s.along + 30 + d);
      const x = q.x + q.rx * 8, z = q.z + q.rz * 8;
      const y = elevation(x, z);
      const post = prop(ctx.scene, new THREE.BoxGeometry(0.18, 2.6, 0.18), WOOD, x, y + 1.3, z);
      return { post, x, y, z, lit: false, lamp: null };
    });

    this.carrying = 0;
    this.aim(ctx);
  },

  aim(ctx) {
    if (this.carrying === 0) {
      const next = this.glows.find((g) => !g.taken);
      if (next) {
        ctx.marker.show(next.x, next.y, next.z);
        ctx.interact.set({ x: next.x, z: next.z, radius: 2.6, label: 'gather the glowing reeds' });
      }
    } else {
      const next = this.posts.find((p) => !p.lit);
      ctx.marker.show(next.x, next.y, next.z);
      ctx.interact.set({ x: next.x, z: next.z, radius: 2.6, label: 'hang the lantern' });
    }
    const lit = this.posts.filter((p) => p.lit).length;
    ctx.hud.setObjective(`light the way through the marsh · ${lit}/3 lanterns`);
  },

  update(dt, ctx) {
    if (this.doneT !== undefined) {
      this.doneT -= dt;
      return this.doneT <= 0 ? 'done' : 'running';
    }
    if (!ctx.interact.update(ctx.foot)) return 'running';

    if (this.carrying === 0) {
      const g = this.glows.find((x) => !x.taken);
      g.taken = true;
      ctx.scene.remove(g.mesh);
      this.carrying = 1;
    } else {
      this.carrying = 0;
      const p = this.posts.find((x) => !x.lit);
      p.lit = true;
      p.lamp = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 0),
        new THREE.MeshStandardMaterial({ color: 0x2f4a2a, emissive: 0x9fdc6a, emissiveIntensity: 2.6 }));
      p.lamp.position.set(p.x, p.y + 2.35, p.z);
      ctx.scene.add(p.lamp);
      const glow = new THREE.PointLight(0xaee87c, 8, 16, 1.8);
      glow.position.copy(p.lamp.position);
      p.lamp.userData.light = glow;
      ctx.scene.add(glow);
      if (this.posts.every((x) => x.lit)) {
        ctx.interact.clear();
        ctx.marker.hide();
        ctx.hud.setObjective('the marsh road glows');
        this.doneT = 3;
        return 'running';
      }
    }
    this.aim(ctx);
    return 'running';
  },

  cleanup(ctx) {
    // The lanterns stay lit behind you. Ungathered reeds keep glowing where they grew.
    ctx.interact.clear();
    this.doneT = undefined;
  },
};

// --- seed the canopy --------------------------------------------------------
export const seedCanopy = {
  id: 'seed-canopy',
  name: 'The forest asks — plant the clearings',
  biomes: ['whisper', 'duskwood'],
  time: 'day',
  needsFoot: true,

  start(ctx) {
    const s = ctx.station;
    const p = pointAt(s.along);

    this.pods = ring(p.x - p.rx * 35, p.z - p.rz * 35, 3, 6, 26).map((pos) => {
      const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.26, 3, 7),
        new THREE.MeshStandardMaterial({ color: 0x7c5a2e, roughness: 0.8 }));
      pod.position.set(pos.x, pos.y + 0.2, pos.z);
      ctx.scene.add(pod);
      return { mesh: pod, ...pos, taken: false };
    });

    this.beds = ring(p.x - p.rx * 70, p.z - p.rz * 70, 3, 4, 22).map((pos) => {
      const patch = new THREE.Mesh(new THREE.CircleGeometry(0.9, 10),
        new THREE.MeshStandardMaterial({ color: 0x3d3226, roughness: 1 }));
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(pos.x, pos.y + 0.04, pos.z);
      ctx.scene.add(patch);
      return { patch, ...pos, planted: false };
    });

    this.carrying = 0;
    this.aim(ctx);
  },

  aim(ctx) {
    if (this.carrying === 0) {
      const next = this.pods.find((p) => !p.taken);
      if (next) {
        ctx.marker.show(next.x, next.y, next.z);
        ctx.interact.set({ x: next.x, z: next.z, radius: 2.4, label: 'take the seed pod' });
      }
    } else {
      const next = this.beds.find((b) => !b.planted);
      ctx.marker.show(next.x, next.y, next.z);
      ctx.interact.set({ x: next.x, z: next.z, radius: 2.4, label: 'plant it deep' });
    }
    const planted = this.beds.filter((b) => b.planted).length;
    ctx.hud.setObjective(`replant the clearings · ${planted}/3 saplings`);
  },

  update(dt, ctx) {
    if (this.doneT !== undefined) {
      this.doneT -= dt;
      return this.doneT <= 0 ? 'done' : 'running';
    }
    if (!ctx.interact.update(ctx.foot)) return 'running';

    if (this.carrying === 0) {
      const pod = this.pods.find((x) => !x.taken);
      pod.taken = true;
      ctx.scene.remove(pod.mesh);
      this.carrying = 1;
    } else {
      this.carrying = 0;
      const bed = this.beds.find((x) => !x.planted);
      bed.planted = true;
      const sapling = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.1, 6),
        new THREE.MeshStandardMaterial({ color: 0x3f7d3c, roughness: 0.9 }));
      sapling.position.set(bed.x, bed.y + 0.55, bed.z);
      sapling.castShadow = true;
      ctx.scene.add(sapling);
      if (this.beds.every((x) => x.planted)) {
        ctx.interact.clear();
        ctx.marker.hide();
        ctx.hud.setObjective('three more trees than yesterday');
        this.doneT = 2.5;
        return 'running';
      }
    }
    this.aim(ctx);
    return 'running';
  },

  cleanup(ctx) {
    // Saplings and beds stay — you planted them. Unused pods return to the litter.
    for (const p of this.pods) if (!p.taken) ctx.scene.remove(p.mesh);
    ctx.interact.clear();
    this.doneT = undefined;
  },
};

// --- repair the bridge ------------------------------------------------------
export const bridge = {
  id: 'bridge',
  name: 'Broken planks — mend the crossing',
  biomes: ['duskwood', 'whisper'],
  time: 'any',
  needsFoot: true,

  start(ctx) {
    const s = ctx.station;
    const p = pointAt(s.along);
    const bx = p.x - p.rx * 32, bz = p.z - p.rz * 32;
    const by = elevation(bx, bz);

    // A foot bridge over a gully beside the road, three planks missing.
    this.frame = new THREE.Group();
    for (const side of [-1.1, 1.1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 7), WOOD);
      rail.position.set(bx + side, by + 0.9, bz);
      this.frame.add(rail);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 7), WOOD);
      beam.position.set(bx + side, by + 0.1, bz);
      this.frame.add(beam);
    }
    for (let i = 0; i < 3; i++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.5), WOOD);
      plank.position.set(bx, by + 0.16, bz - 2.6 + i * 0.8);
      this.frame.add(plank);
    }
    for (const m of this.frame.children) { m.castShadow = true; m.receiveShadow = true; }
    ctx.scene.add(this.frame);
    this.site = { x: bx, y: by, z: bz };

    this.planks = ring(bx, bz, 3, 10, 26).map((pos) => {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.09, 0.45), WOOD);
      plank.position.set(pos.x, pos.y + 0.1, pos.z);
      plank.rotation.y = Math.random() * Math.PI;
      plank.castShadow = true;
      ctx.scene.add(plank);
      return { mesh: plank, ...pos, taken: false };
    });

    this.carrying = 0;
    this.fixed = 0;
    this.aim(ctx);
  },

  aim(ctx) {
    if (this.carrying === 0) {
      const next = this.planks.find((p) => !p.taken);
      if (next) {
        ctx.marker.show(next.x, next.y, next.z);
        ctx.interact.set({ x: next.x, z: next.z, radius: 2.5, label: 'take up the plank' });
      }
    } else {
      ctx.marker.show(this.site.x, this.site.y + 1, this.site.z);
      ctx.interact.set({ x: this.site.x, z: this.site.z, radius: 3, label: 'set it in place' });
    }
    ctx.hud.setObjective(`mend the crossing · ${this.fixed}/3 planks`);
  },

  update(dt, ctx) {
    if (!ctx.interact.update(ctx.foot)) return 'running';

    if (this.carrying === 0) {
      const p = this.planks.find((x) => !x.taken);
      p.taken = true;
      ctx.scene.remove(p.mesh);
      this.carrying = 1;
    } else {
      this.carrying = 0;
      const plank = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.5), WOOD);
      plank.position.set(this.site.x, this.site.y + 0.16, this.site.z + 0.3 + this.fixed * 0.8);
      plank.castShadow = true;
      this.frame.add(plank);
      this.fixed++;
      if (this.fixed >= 3) return 'done';
    }
    this.aim(ctx);
    return 'running';
  },

  cleanup(ctx) {
    // The mended bridge is the point; it stays.
    ctx.interact.clear();
  },
};

export const SURVIVAL_TASKS = [caveNight, ashShelter, lanterns, seedCanopy, bridge];
