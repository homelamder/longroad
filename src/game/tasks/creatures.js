import * as THREE from 'three';
import { elevation } from '../../world/terrain.js';
import { pointAt } from '../../world/road.js';
import { WOOD, STONE, prop, ring } from './lib.js';

// The five tasks built on wildlife. All of them spawn their own task-owned herd via
// ctx.animals.spawnAt so they work at any station in their regions, and every one
// releases it in cleanup.

// --- feed the goats ---------------------------------------------------------
export const feedGoats = {
  id: 'feed-goats',
  name: 'Hungry herd — feed the goats',
  biomes: ['verdant', 'frostveil'],
  time: 'day',
  needsFoot: true,

  start(ctx) {
    const s = ctx.station;
    const p = pointAt(s.along);
    const fx = p.x - p.rx * 30, fz = p.z - p.rz * 30;
    this.herd = ctx.animals.spawnAt('goat', fx, fz, 6);
    this.herd.docile = true;

    // The trough, and a feed sack on the station platform.
    this.trough = prop(ctx.scene, new THREE.BoxGeometry(2.2, 0.5, 0.7), WOOD,
      fx, elevation(fx, fz) + 0.25, fz);
    this.sack = prop(ctx.scene, new THREE.CapsuleGeometry(0.3, 0.5, 3, 8),
      new THREE.MeshStandardMaterial({ color: 0xb99f6e, roughness: 0.9 }),
      s.x + 1.2, s.y + 0.4, s.z + 1.2);

    this.carrying = false;
    this.fed = 0;
    this.aim(ctx);
  },

  aim(ctx) {
    if (!this.carrying) {
      ctx.marker.show(this.sack.position.x, this.sack.position.y, this.sack.position.z);
      ctx.interact.set({ x: this.sack.position.x, z: this.sack.position.z, radius: 2.6, label: 'shoulder the feed sack' });
      ctx.hud.setObjective(`carry feed to the trough · ${this.fed}/2 sacks`);
    } else {
      ctx.marker.show(this.trough.position.x, this.trough.position.y + 1, this.trough.position.z);
      ctx.interact.set({ x: this.trough.position.x, z: this.trough.position.z, radius: 2.8, label: 'pour the feed' });
      ctx.hud.setObjective('pour it in the trough — move gently');
    }
  },

  update(dt, ctx) {
    // The herd drifts to the trough once food has arrived.
    if (this.fed > 0) this.herd.escort = { x: this.trough.position.x, z: this.trough.position.z, keep: 3.5 };

    if (this.grazeT !== undefined) {
      this.grazeT -= dt;
      ctx.hud.setObjective('the goats crowd in to eat');
      return this.grazeT <= 0 ? 'done' : 'running';
    }
    if (!ctx.interact.update(ctx.foot)) return 'running';

    if (!this.carrying) {
      this.carrying = true;
      this.sack.visible = false;
    } else {
      this.carrying = false;
      this.fed++;
      this.sack.visible = true;
      if (this.fed >= 2) {
        ctx.interact.clear();
        ctx.marker.hide();
        this.grazeT = 4;
        return 'running';
      }
    }
    this.aim(ctx);
    return 'running';
  },

  cleanup(ctx) {
    ctx.animals.release(this.herd);
    ctx.scene.remove(this.trough, this.sack);
    ctx.interact.clear();
    this.grazeT = undefined;
    this.carrying = false;
  },
};

// --- round up the strays ----------------------------------------------------
export const roundUp = {
  id: 'round-up',
  name: 'Scattered flock — round up the strays',
  biomes: ['verdant', 'marsh'],
  time: 'day',
  needsFoot: true,

  start(ctx) {
    const s = ctx.station;
    const p = pointAt(s.along);
    const hx = p.x - p.rx * 26, hz = p.z - p.rz * 26;
    this.home = { x: hx, z: hz };
    this.herd = ctx.animals.spawnAt('sheep', hx, hz, 3);
    this.herd.docile = true;

    // Three strays scattered far from home.
    this.strays = ring(hx, hz, 3, 45, 80).map((pos) =>
      ({ herd: ctx.animals.spawnAt('sheep', pos.x, pos.z, 1), returned: false }));
    for (const st of this.strays) st.herd.docile = true;
    this.aim(ctx);
  },

  aim(ctx) {
    const next = this.strays.find((st) => !st.returned);
    if (!next) return;
    const a = next.herd.animals[0];
    ctx.marker.show(a.x, a.y, a.z);
    ctx.interact.set({ x: a.x, z: a.z, radius: 4.5, label: 'shoo it homeward' });
    const done = this.strays.filter((st) => st.returned).length;
    ctx.hud.setObjective(`walk the strays home · ${done}/3`);
  },

  update(dt, ctx) {
    // Returned strays trot home; the marker tracks the current stray as it moves.
    for (const st of this.strays) {
      if (st.returned) st.herd.escort = { x: this.home.x, z: this.home.z, keep: 4 };
    }
    const next = this.strays.find((st) => !st.returned);
    if (!next) {
      // Done once every stray is actually back with the flock.
      const allHome = this.strays.every((st) => {
        const a = st.herd.animals[0];
        return Math.hypot(a.x - this.home.x, a.z - this.home.z) < 9;
      });
      ctx.hud.setObjective('the flock gathers');
      return allHome ? 'done' : 'running';
    }

    const a = next.herd.animals[0];
    ctx.interact.set({ x: a.x, z: a.z, radius: 4.5, label: 'shoo it homeward' });
    ctx.marker.show(a.x, a.y, a.z);
    if (ctx.interact.update(ctx.foot)) {
      next.returned = true;
      this.aim(ctx);
    }
    return 'running';
  },

  cleanup(ctx) {
    ctx.animals.release(this.herd);
    for (const st of this.strays) ctx.animals.release(st.herd);
    ctx.interact.clear();
  },
};

// --- photograph the wildlife ------------------------------------------------
export const photograph = {
  id: 'photograph',
  name: 'Field notes — photograph the wildlife',
  biomes: ['verdant', 'duskwood', 'whisper', 'marsh'],
  time: 'day',
  needsFoot: true,

  SUBJECT: { verdant: 'deer', duskwood: 'elk', whisper: 'monkey', marsh: 'heron' },

  start(ctx) {
    const s = ctx.station;
    const p = pointAt(s.along);
    const biome = ctx.biomeAt(s.along).a.id;
    const species = this.SUBJECT[biome] || 'deer';
    const hx = p.x - p.rx * 60, hz = p.z - p.rz * 60;
    this.herd = ctx.animals.spawnAt(species, hx, hz, 3);
    this.shots = 0;
    this.cooldown = 0;
    ctx.hud.setObjective('approach slowly — two clear shots');
  },

  update(dt, ctx) {
    this.cooldown -= dt;
    const foot = ctx.foot;
    // Nearest live animal is the subject; the marker hovers over it.
    let best = null, bd = Infinity;
    for (const a of this.herd.animals) {
      const d = Math.hypot(a.x - foot.pos.x, a.z - foot.pos.z);
      if (d < bd) { bd = d; best = a; }
    }
    ctx.marker.show(best.x, best.y + 1.2, best.z);
    ctx.interact.set({ x: best.x, z: best.z, radius: 11, label: 'take the photograph' });

    // Rushing spooks the herd — the flee behaviour itself is the punishment; the
    // objective line just tells the player why their subject is now 40 m away.
    if (best.state === 'flee') {
      ctx.hud.setObjective('spooked — hold still, let them settle');
    } else {
      ctx.hud.setObjective(`move gently, get close · ${this.shots}/2 photographs`);
    }

    if (ctx.interact.update(foot) && this.cooldown <= 0) {
      if (best.state !== 'flee' && bd < 11 && Math.abs(foot.moving) < 0.35) {
        this.shots++;
        this.cooldown = 2.5;
        ctx.hud.note(`photograph ${this.shots}/2`, 2);
        if (this.shots >= 2) return 'done';
      } else {
        ctx.hud.note(best.state === 'flee' ? 'too spooked — wait' : 'hold still for the shot', 2);
      }
    }
    return 'running';
  },

  cleanup(ctx) {
    ctx.animals.release(this.herd);
    ctx.interact.clear();
  },
};

// --- free the trapped animal ------------------------------------------------
export const freeAnimal = {
  id: 'free-animal',
  name: 'Caught in the thicket — free the deer',
  biomes: ['verdant', 'duskwood', 'whisper'],
  time: 'any',
  needsFoot: true,

  start(ctx) {
    const s = ctx.station;
    const p = pointAt(s.along);
    const tx = p.x - p.rx * 42, tz = p.z - p.rz * 42;
    this.herd = ctx.animals.spawnAt('deer', tx, tz, 1);
    this.deer = this.herd.animals[0];
    this.deer.x = tx; this.deer.z = tz; this.deer.y = elevation(tx, tz);
    this.trapped = true;
    this.panic = 0;

    // The thicket it is tangled in.
    this.bramble = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5 + (i % 2) * 0.3, 0),
        new THREE.MeshStandardMaterial({ color: 0x4a4226, roughness: 1 }));
      b.position.set(tx + Math.cos(i * 2.2) * 1.1, elevation(tx, tz) + 0.4, tz + Math.sin(i * 2.2) * 1.1);
      this.bramble.add(b);
    }
    ctx.scene.add(this.bramble);

    ctx.marker.show(tx, elevation(tx, tz) + 1.5, tz);
    ctx.interact.set({ x: tx, z: tz, radius: 3.2, label: 'work the branches loose' });
    ctx.hud.setObjective('approach slowly — three careful pulls');
    this.pulls = 0;
  },

  update(dt, ctx) {
    if (!this.trapped) {
      // Freed: the deer bolts, task ends once it has its distance.
      this.freedT -= dt;
      return this.freedT <= 0 ? 'done' : 'running';
    }

    // A trapped animal cannot run, so panic replaces flight: rush it and you must
    // back off and let it settle before it will let you near again.
    const d = Math.hypot(this.deer.x - ctx.foot.pos.x, this.deer.z - ctx.foot.pos.z);
    if (d < 9 && Math.abs(ctx.foot.moving) > 0.6) {
      this.panic = Math.min(1, this.panic + dt * 0.8);
    } else {
      this.panic = Math.max(0, this.panic - dt * 0.25);
    }

    if (this.panic > 0.5) {
      ctx.hud.setObjective('it is thrashing — stand back, let it calm');
      ctx.interact.update(ctx.foot);       // keep the prompt logic alive, ignore fires
      return 'running';
    }
    ctx.hud.setObjective(`ease it out of the thicket · ${this.pulls}/3`);

    if (ctx.interact.update(ctx.foot)) {
      if (this.panic > 0.2) {
        ctx.hud.note('still trembling — slower', 2);
      } else {
        this.pulls++;
        this.bramble.children[this.pulls]?.scale.setScalar(0.01);
        if (this.pulls >= 3) {
          this.trapped = false;
          this.freedT = 2.5;
          this.deer.state = 'flee';
          this.deer.t = 3;
          ctx.interact.clear();
          ctx.marker.hide();
          ctx.hud.setObjective('it springs away — watch it go');
        }
      }
    }
    return 'running';
  },

  cleanup(ctx) {
    ctx.animals.release(this.herd);
    ctx.scene.remove(this.bramble);
    ctx.interact.clear();
  },
};

// --- guide the lost herd by headlight ---------------------------------------
export const guideHerd = {
  id: 'guide-herd',
  name: 'Lost in the dark — guide the herd home',
  biomes: ['verdant', 'duskwood'],
  time: 'night',
  needsFoot: false,                      // driven entirely from the car

  start(ctx) {
    const s = ctx.station;
    const p = pointAt(s.along);
    this.herd = ctx.animals.spawnAt('sheep', p.x - p.rx * 18, p.z - p.rz * 18, 5);
    this.herd.docile = true;

    // The fold: a fence corner 260 m up the road, off the verge.
    const q = pointAt(s.along + 260);
    this.fold = { x: q.x + q.rx * 22, z: q.z + q.rz * 22 };
    this.foldY = elevation(this.fold.x, this.fold.z);
    this.fence = new THREE.Group();
    for (const [dx, dz, ry] of [[-3, 0, 0], [3, 0, 0], [0, -3, Math.PI / 2], [0, 3, Math.PI / 2]]) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry(5.6, 1.1, 0.14), WOOD);
      seg.position.set(this.fold.x + dx, this.foldY + 0.55, this.fold.z + dz);
      seg.rotation.y = ry;
      seg.castShadow = true;
      this.fence.add(seg);
    }
    ctx.scene.add(this.fence);

    ctx.marker.show(this.fold.x, this.foldY, this.fold.z);
    ctx.hud.setObjective('drive slow — they follow your lights');
  },

  update(dt, ctx) {
    const car = ctx.car;
    let cx = 0, cz = 0;
    for (const a of this.herd.animals) { cx += a.x; cz += a.z; }
    cx /= this.herd.animals.length; cz /= this.herd.animals.length;

    const herdToCar = Math.hypot(car.pos.x - cx, car.pos.z - cz);
    const slow = Math.abs(car.speed) < 6.5;

    // They follow a slow car within lantern range; gun it and they stand lost.
    if (slow && herdToCar < 42) {
      this.herd.escort = { x: car.pos.x, z: car.pos.z, keep: 8 };
      ctx.hud.setObjective('drive slow — they follow your lights');
    } else {
      this.herd.escort = null;
      ctx.hud.setObjective(herdToCar >= 42 ? 'too far ahead — go back for them' : 'too fast — they scatter from the noise');
    }

    const herdToFold = Math.hypot(this.fold.x - cx, this.fold.z - cz);
    if (herdToFold < 14) {
      this.herd.escort = { x: this.fold.x, z: this.fold.z, keep: 3 };
      ctx.hud.setObjective('into the fold');
      if (herdToFold < 7) return 'done';
    }
    return 'running';
  },

  cleanup(ctx) {
    ctx.animals.release(this.herd);
    ctx.scene.remove(this.fence);
    ctx.interact.clear();
  },
};

export const CREATURE_TASKS = [feedGoats, roundUp, photograph, freeAnimal, guideHerd];
