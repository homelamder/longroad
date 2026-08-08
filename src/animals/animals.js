import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneRig } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { asset } from '../asset.js';
import { JOURNEY, biomeAt, mixField } from '../world/biomes.js';
import { nearest, pointAt } from '../world/road.js';
import { elevation } from '../world/terrain.js';
import { hash2, clamp } from '../world/rng.js';

// Wildlife. Herds spawn at deterministic sites per region, live only while the
// player is near, and run three behaviours: graze, drift, flee. Approach slowly and
// they let you close; come in fast or loud and they scatter — which several tasks
// depend on. Instanced per species: a herd costs one draw call.

// Body plans are box-built like the car — original low-poly silhouettes.
function buildBody({ body, head, legs, horn, tail, colour, dark }) {
  const parts = [];
  const push = (geo, m, tint) => {
    const c = geo.clone().applyMatrix4(m);
    c.computeVertexNormals();
    parts.push([c, tint]);
  };
  const M = (x, y, z, sx = 1, sy = 1, sz = 1, rx = 0) => new THREE.Matrix4()
    .makeRotationX(rx).premultiply(new THREE.Matrix4().makeScale(sx, sy, sz))
    .premultiply(new THREE.Matrix4().makeTranslation(x, y, z));

  push(new THREE.BoxGeometry(body[0], body[1], body[2]), M(0, legs + body[1] / 2, 0), colour);
  push(new THREE.BoxGeometry(head[0], head[1], head[2]),
    M(0, legs + body[1] * 0.82, body[2] / 2 + head[2] * 0.35), colour);
  // Muzzle a shade darker.
  push(new THREE.BoxGeometry(head[0] * 0.6, head[1] * 0.45, head[2] * 0.4),
    M(0, legs + body[1] * 0.72, body[2] / 2 + head[2] * 0.72), dark);
  const legGeo = new THREE.BoxGeometry(0.09 * body[0] * 3, legs, 0.09 * body[0] * 3);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      push(legGeo, M(sx * body[0] * 0.32, legs / 2, sz * body[2] * 0.36), dark);
    }
  }
  if (horn) {
    for (const sx of [-1, 1]) {
      push(new THREE.ConeGeometry(0.045, horn, 5),
        M(sx * head[0] * 0.3, legs + body[1] * 1.1, body[2] / 2, 1, 1, 1, -0.5), 0xd8cfc0);
    }
  }
  if (tail) {
    push(new THREE.BoxGeometry(0.07, tail, 0.07), M(0, legs + body[1] * 0.6, -body[2] / 2 - 0.03), dark);
  }

  // Merge with baked colours.
  const pos = [], nor = [], col = [], idx = [];
  let base = 0;
  const c = new THREE.Color();
  for (const [geo, tint] of parts) {
    c.setHex(tint, 'srgb');
    const p = geo.getAttribute('position'), n = geo.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.r, c.g, c.b);
    }
    const index = geo.getIndex();
    for (let i = 0; i < index.count; i++) idx.push(base + index.getX(i));
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

export const SPECIES = {
  goat: {
    geo: () => buildBody({ body: [0.5, 0.5, 0.9], head: [0.26, 0.3, 0.34], legs: 0.5, horn: 0.22, tail: 0.14, colour: 0xd9d2c4, dark: 0x8a8072 }),
    speed: 4.2, flee: 12, calm: 5, herd: [4, 7], wander: 9,
  },
  sheep: {
    geo: () => buildBody({ body: [0.6, 0.55, 1.0], head: [0.24, 0.28, 0.3], legs: 0.42, tail: 0.1, colour: 0xe8e2d4, dark: 0x3d3830 }),
    speed: 3.4, flee: 11, calm: 5, herd: [5, 9], wander: 7,
  },
  deer: {
    geo: () => buildBody({ body: [0.5, 0.6, 1.15], head: [0.22, 0.3, 0.34], legs: 0.78, horn: 0.34, tail: 0.12, colour: 0xa5764d, dark: 0x6b4b30 }),
    speed: 8.5, flee: 26, calm: 10, herd: [3, 6], wander: 14,
  },
  elk: {
    geo: () => buildBody({ body: [0.7, 0.8, 1.5], head: [0.28, 0.38, 0.42], legs: 0.95, horn: 0.5, tail: 0.14, colour: 0x7a5a3c, dark: 0x51402c }),
    speed: 7.5, flee: 24, calm: 9, herd: [2, 4], wander: 12,
  },
  fox: {
    geo: () => buildBody({ body: [0.3, 0.3, 0.62], head: [0.2, 0.22, 0.26], legs: 0.3, tail: 0.3, colour: 0xc06a38, dark: 0x7c4020 }),
    speed: 9, flee: 20, calm: 8, herd: [1, 2], wander: 18,
  },
  monkey: {
    geo: () => buildBody({ body: [0.3, 0.42, 0.34], head: [0.24, 0.26, 0.24], legs: 0.34, tail: 0.36, colour: 0x6e5a44, dark: 0x46392b }),
    speed: 6, flee: 14, calm: 6, herd: [3, 6], wander: 10,
  },
  heron: {
    geo: () => buildBody({ body: [0.22, 0.3, 0.5], head: [0.12, 0.16, 0.3], legs: 0.6, colour: 0xb9c2c8, dark: 0x5a6268 }),
    speed: 5, flee: 16, calm: 7, herd: [2, 4], wander: 8,
  },
  tapir: {
    geo: () => buildBody({ body: [0.55, 0.55, 1.1], head: [0.3, 0.34, 0.4], legs: 0.45, colour: 0x4a4448, dark: 0x2e2a2d }),
    speed: 5, flee: 13, calm: 6, herd: [1, 3], wander: 6,
  },
};

SPECIES.wolf = {
  geo: () => buildBody({ body: [0.42, 0.5, 1.05], head: [0.24, 0.26, 0.38], legs: 0.58, tail: 0.34, colour: 0x8c8a86, dark: 0x4a4642 }),
  speed: 8.5, flee: 0, calm: 4, herd: [2, 4], wander: 14,
  // The hunt: notice a walker at 55 m, close to 15, lunge inside 2.3, then the
  // pack stands down for a while. Drivers are never prey.
  predator: { notice: 55, charge: 15, strike: 2.3, cooldown: 14 },
};

// Which species live where, with herd-site density per km of road.
const FAUNA = {
  verdant: [['goat', 3], ['sheep', 3], ['deer', 1]],
  duskwood: [['elk', 2], ['deer', 2], ['fox', 1], ['wolf', 1]],
  emberfall: [['fox', 2]],
  whisper: [['monkey', 3], ['tapir', 1]],
  frostveil: [['goat', 2], ['wolf', 1]],
  marsh: [['heron', 3], ['deer', 1]],
  ashen: [],
};

// Rigged Quaternius animals (CC0) that replace the instanced blocks when they
// load: species id -> [glb name, real-world height in metres]. Goats, monkeys,
// tapirs and herons have no model in the packs and stay procedural.
const MODELS = {
  sheep: ['sheep', 1.05], deer: ['deer', 1.5], elk: ['stag', 1.95],
  wolf: ['wolf', 1.1], fox: ['fox', 0.65],
};

// Preference order per behaviour state; the sheep rig only ships Idle and Jump,
// so every want-list ends in Idle.
const CLIP_WANTS = {
  flee: ['Gallop', 'Jump', 'Idle'],
  walk: ['Walk', 'Idle'],
  graze: ['Eating', 'Idle_Headlow', 'Idle'],
  idle: ['Idle'],
  stalk: ['Walk', 'Idle'],
  charge: ['Gallop', 'Walk', 'Idle'],
  attack: ['Attack', 'Attack_Headbutt', 'Idle'],
};

const SITE_SPACING = 210;          // candidate herd sites every N metres of road
const ACTIVE_RANGE = 420;          // herds exist within this range of the player
const CAP = 96;                    // hard ceiling on live animals per species

export class Animals {
  constructor(scene) {
    this.scene = scene;
    this.meshes = {};
    this.herds = new Map();        // siteKey -> herd
    this.tasked = [];              // herds owned by an active task
    this.models = {};              // species -> { template, clips }
    this.rigs = new Map();         // live animal -> its skinned clone
    this.frame = 0;

    // Browser only (import.meta.env is the vite tell): node tests keep the
    // instanced fallback, and so does any player whose fetch fails.
    if (import.meta.env) {
      const loader = new GLTFLoader();
      for (const [species, [file, height]] of Object.entries(MODELS)) {
        loader.load(asset(`/models/${file}.glb`), (gltf) => {
          const inner = gltf.scene;
          const box = new THREE.Box3().setFromObject(inner);
          const h = box.max.y - box.min.y || 1;
          inner.scale.setScalar(height / h);
          inner.rotation.y = Math.PI;                  // fbx2gltf authors facing -Z
          inner.traverse((o) => {
            if (o.isMesh) {
              o.castShadow = true;
              o.frustumCulled = false;                 // skinned bounds lag the pose
              const fix = (m) => new THREE.MeshStandardMaterial({
                color: m.color ? m.color.clone() : 0xffffff, roughness: 0.9, metalness: 0,
              });
              o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);
            }
          });
          this.models[species] = {
            template: inner,
            clips: gltf.animations.map((c) => { c.name = c.name.replace(/^.*\|/, ''); return c; }),
          };
          this.meshes[species].visible = false;        // clones render this species now
        }, undefined, () => { /* instanced fallback stands */ });
      }
    }
    for (const [id, spec] of Object.entries(SPECIES)) {
      const m = new THREE.InstancedMesh(spec.geo(), new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.9, metalness: 0,
      }), CAP);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      m.name = `animals-${id}`;
      scene.add(m);
      this.meshes[id] = m;
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._up = new THREE.Vector3(0, 1, 0);
  }

  // Deterministic herd sites: hash the site index, place off-road on livable ground.
  siteAt(i) {
    const along = i * SITE_SPACING;
    if (along < 150 || along > JOURNEY - 150) return null;
    const biome = biomeAt(along).a;
    const pool = FAUNA[biome.id];
    if (!pool || !pool.length) return null;

    let total = 0;
    for (const [, w] of pool) total += w;
    // Site exists only if its hash clears the density bar for the region.
    const h = hash2(i, 7717);
    if (h > total / 6) return null;

    let pick = h * total;
    let species = pool[0][0];
    for (const [name, w] of pool) { pick -= w; if (pick <= 0) { species = name; break; } }

    const side = hash2(i, 31) < 0.5 ? -1 : 1;
    const dist = 40 + hash2(i, 67) * 120;
    const p = pointAt(along);
    const x = p.x + p.rx * side * dist, z = p.z + p.rz * side * dist;
    const y = elevation(x, z);
    // No herds above the snowline or on steep ground.
    if (y > mixField(clamp(z, 0, JOURNEY), 'snow') - 25) return null;
    const e = 3;
    const gx = (elevation(x + e, z) - elevation(x - e, z)) / (2 * e);
    const gz = (elevation(x, z + e) - elevation(x, z - e)) / (2 * e);
    if (Math.hypot(gx, gz) > 0.5) return null;

    return { i, species, x, z, along };
  }

  // A herd owned by a task: placed exactly, exempt from range retirement, and
  // released by the task's cleanup. Rendering rides the same instanced meshes.
  spawnAt(species, x, z, n) {
    const site = { i: -1 - this.tasked.length, species, x, z, along: z };
    const herd = this.spawn(site);
    while (herd.animals.length > n) herd.animals.pop();
    while (herd.animals.length < n) herd.animals.push({ ...herd.animals[0] });
    this.tasked.push(herd);
    return herd;
  }

  release(herd) {
    const i = this.tasked.indexOf(herd);
    if (i >= 0) this.tasked.splice(i, 1);
  }

  update(dt, playerPos, playerSpeed, onFoot = false) {
    this.onFoot = onFoot;
    const centerI = Math.round(playerPos.z / SITE_SPACING);
    const span = Math.ceil(ACTIVE_RANGE / SITE_SPACING);

    // Spawn herds coming into range, retire those leaving it.
    const wanted = new Set();
    for (let di = -span; di <= span; di++) {
      const i = centerI + di;
      wanted.add(i);
      if (this.herds.has(i)) continue;
      const site = this.siteAt(i);
      this.herds.set(i, site ? this.spawn(site) : null);
    }
    for (const [k, herd] of this.herds) {
      if (!wanted.has(k)) this.herds.delete(k);
      void herd;
    }

    // Behave.
    for (const herd of this.herds.values()) {
      if (herd) this.behave(herd, dt, playerPos, playerSpeed);
    }
    for (const herd of this.tasked) this.behave(herd, dt, playerPos, playerSpeed);

    // Write instances — or pose rigged clones for species whose model arrived.
    this.frame++;
    const counts = {};
    for (const id in this.meshes) counts[id] = 0;
    for (const herd of [...this.herds.values(), ...this.tasked]) {
      if (!herd) continue;
      const model = this.models[herd.species];
      if (model) {
        for (const a of herd.animals) this.poseRig(model, a, dt);
        continue;
      }
      const mesh = this.meshes[herd.species];
      for (const a of herd.animals) {
        if (counts[herd.species] >= CAP) break;
        const n = counts[herd.species]++;
        this._q.setFromAxisAngle(this._up, a.yaw);
        const bob = a.moving ? Math.abs(Math.sin(a.phase)) * 0.06 : 0;
        this._m.compose(
          this._v.set(a.x, a.y + bob, a.z),
          this._q,
          this._s.set(a.scale, a.scale, a.scale),
        );
        mesh.setMatrixAt(n, this._m);
      }
    }
    for (const id in this.meshes) {
      this.meshes[id].count = counts[id];
      this.meshes[id].instanceMatrix.needsUpdate = true;
    }

    // Retire clones whose animal left the world this frame.
    for (const [a, rig] of this.rigs) {
      if (rig.used !== this.frame) {
        this.scene.remove(rig.root);
        this.rigs.delete(a);
      }
    }
  }

  // One skinned clone per live animal, driven by the same behaviour sim that
  // moves the instances. State picks the clip: grazing animals actually eat,
  // fleeing ones actually gallop.
  poseRig(model, a, dt) {
    let rig = this.rigs.get(a);
    if (!rig) {
      const root = new THREE.Group();
      const body = cloneRig(model.template);
      root.add(body);
      const mixer = new THREE.AnimationMixer(body);
      const actions = {};
      for (const clip of model.clips) actions[clip.name] = mixer.clipAction(clip);
      rig = { root, mixer, actions, current: null };
      this.scene.add(root);
      this.rigs.set(a, rig);
    }
    rig.used = this.frame;
    rig.root.position.set(a.x, a.y, a.z);
    rig.root.rotation.y = a.yaw;
    rig.root.scale.setScalar(a.scale);

    const state = a.attackT > 0 ? 'attack'
      : a.state === 'charge' ? 'charge'
      : a.state === 'stalk' ? 'stalk'
      : a.state === 'flee' ? 'flee'
      : a.moving ? 'walk'
      : a.state === 'graze' ? 'graze' : 'idle';
    const want = CLIP_WANTS[state].find((n) => rig.actions[n]);
    if (want && rig.current !== want) {
      const next = rig.actions[want];
      next.reset().fadeIn(0.16).play();
      // The sheep gallops on its Idle clip: double time sells the panic.
      next.timeScale = state === 'flee' && want === 'Idle' ? 2.2 : 1;
      if (rig.current) rig.actions[rig.current].fadeOut(0.16);
      rig.current = want;
    }
    rig.mixer.update(dt);
  }

  spawn(site) {
    const spec = SPECIES[site.species];
    const n = spec.herd[0] + Math.floor(hash2(site.i, 991) * (spec.herd[1] - spec.herd[0] + 1));
    const animals = [];
    for (let k = 0; k < n; k++) {
      const a = hash2(site.i * 13 + k, 55) * Math.PI * 2;
      const r = 2 + hash2(site.i * 13 + k, 77) * 9;
      const x = site.x + Math.cos(a) * r, z = site.z + Math.sin(a) * r;
      animals.push({
        x, z, y: elevation(x, z),
        yaw: hash2(site.i * 13 + k, 99) * Math.PI * 2,
        state: 'graze', t: hash2(site.i * 13 + k, 111) * 3,
        tx: x, tz: z, moving: false, phase: 0,
        scale: 0.85 + hash2(site.i * 13 + k, 131) * 0.3,
      });
    }
    return { ...site, spec, animals, spooked: 0, cool: 0, warned: false };
  }

  behave(herd, dt, playerPos, playerSpeed) {
    const spec = herd.spec;

    // Predators hunt a player on foot. In the car you are a machine - too big,
    // too loud, not prey - and the pack goes back to being scenery.
    if (spec.predator && herd.cool > 0) herd.cool -= dt;
    const hunting = spec.predator && this.onFoot && !(herd.cool > 0);
    if (hunting) {
      for (const a of herd.animals) {
        a.t -= dt;
        a.phase += dt * 8;
        if (a.attackT > 0) { a.attackT -= dt; a.moving = false; continue; }
        const dx = playerPos.x - a.x, dz = playerPos.z - a.z;
        const d = Math.hypot(dx, dz);
        const p = spec.predator;
        if (d > p.notice) { a.state = 'graze'; a.moving = false; continue; }
        if (!herd.warned) { herd.warned = true; this.onStalk?.(a); }
        a.yaw = Math.atan2(dx / (d || 1), dz / (d || 1));
        if (d > p.charge) {
          a.state = 'stalk';
          this.step(a, spec.speed * 0.45, dt, true);
        } else if (d > p.strike) {
          a.state = 'charge';
          this.step(a, spec.speed * 1.25, dt, true);
        } else {
          // The strike: one hit, then the whole pack is satisfied and stands off.
          a.state = 'attack';
          a.attackT = 1.0;
          herd.cool = p.cooldown;
          herd.warned = false;
          this.onStrike?.(a);
          break;              // one strike stands the whole pack down - same frame
        }
      }
      return;
    }
    if (spec.predator && !this.onFoot) herd.warned = false;

    for (const a of herd.animals) {
      a.t -= dt;
      a.phase += dt * 8;

      // Escort: a task points the herd somewhere (usually at the player's slow car)
      // and the animals walk to it, overriding wander but never overriding flee.
      if (herd.escort && a.state !== 'flee') {
        const ex = herd.escort.x - a.x, ez = herd.escort.z - a.z;
        const ed = Math.hypot(ex, ez);
        if (ed > (herd.escort.keep || 7)) {
          a.yaw = Math.atan2(ex / ed, ez / ed);
          // Escorted animals may cross the tarmac — a shepherd walks sheep over a
          // road. Without this, any stray on the far side deadlocks at the verge:
          // escort re-aims it at home every frame, road-avoidance veers it away.
          this.step(a, spec.speed * 0.55, dt, true);
          a.state = 'walk'; a.t = 1;
          continue;
        }
        a.moving = false;
        continue;
      }

      const dx = a.x - playerPos.x, dz = a.z - playerPos.z;
      const d2 = dx * dx + dz * dz;

      // Threat: proximity scaled by how fast the player is coming in. A slow, calm
      // approach can get inside `calm` metres — tasks rely on that.
      const speedFactor = clamp(playerSpeed / 8, 0.35, 2.2);
      const threat = herd.docile ? 2.5 : spec.flee * speedFactor;

      if (d2 < threat * threat && a.state !== 'flee') {
        if (Math.sqrt(d2) > spec.calm || playerSpeed > 3) {
          a.state = 'flee'; a.t = 2.5 + Math.random();
        }
      }

      if (a.state === 'flee') {
        const d = Math.sqrt(d2) || 1;
        a.yaw = Math.atan2(dx / d, dz / d);
        this.step(a, spec.speed, dt);
        if (a.t <= 0 && d2 > threat * threat * 2.2) { a.state = 'graze'; a.t = 1 + Math.random() * 3; }
      } else if (a.state === 'walk') {
        const wx = a.tx - a.x, wz = a.tz - a.z;
        const wd = Math.hypot(wx, wz);
        if (wd < 1.2 || a.t <= 0) { a.state = 'graze'; a.t = 2 + Math.random() * 4; a.moving = false; }
        else {
          a.yaw = Math.atan2(wx / wd, wz / wd);
          this.step(a, spec.speed * 0.35, dt);
        }
      } else if (a.t <= 0) {
        // Pick a new drift target near the herd site so they never wander home-less.
        a.state = 'walk';
        a.t = 4 + Math.random() * 4;
        const ang = Math.random() * Math.PI * 2;
        const r = Math.random() * spec.wander;
        a.tx = herd.x + Math.cos(ang) * r;
        a.tz = herd.z + Math.sin(ang) * r;
      } else {
        a.moving = false;
      }
    }
  }

  step(a, speed, dt, allowRoad = false) {
    const f = Math.sin(a.yaw), g = Math.cos(a.yaw);
    const nx = a.x + f * speed * dt, nz = a.z + g * speed * dt;
    // Animals will not walk onto the tarmac — they are scenery and hazard-free by
    // design; a deer bolting under the wheels would demand a collision system.
    // Escorted movement is exempt (see behave).
    if (allowRoad || nearest(nx, nz).dist > 8.5) {
      a.x = nx; a.z = nz;
      a.y = elevation(a.x, a.z);
    } else {
      a.yaw += Math.PI * 0.5 * dt * 4;   // veer along the verge instead
    }
    a.moving = true;
  }

  // How many animals are currently live — the phase test reads this.
  get population() {
    let n = 0;
    for (const id in this.meshes) n += this.meshes[id].count;
    return n;
  }
}
