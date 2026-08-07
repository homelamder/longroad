import * as THREE from 'three';
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

// Which species live where, with herd-site density per km of road.
const FAUNA = {
  verdant: [['goat', 3], ['sheep', 3], ['deer', 1]],
  duskwood: [['elk', 2], ['deer', 2], ['fox', 1]],
  emberfall: [['fox', 2]],
  whisper: [['monkey', 3], ['tapir', 1]],
  frostveil: [['goat', 2]],
  marsh: [['heron', 3], ['deer', 1]],
  ashen: [],
};

const SITE_SPACING = 210;          // candidate herd sites every N metres of road
const ACTIVE_RANGE = 420;          // herds exist within this range of the player
const CAP = 96;                    // hard ceiling on live animals per species

export class Animals {
  constructor(scene) {
    this.meshes = {};
    this.herds = new Map();        // siteKey -> herd
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

  update(dt, playerPos, playerSpeed) {
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

    // Write instances.
    const counts = {};
    for (const id in this.meshes) counts[id] = 0;
    for (const herd of this.herds.values()) {
      if (!herd) continue;
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
    return { ...site, spec, animals, spooked: 0 };
  }

  behave(herd, dt, playerPos, playerSpeed) {
    const spec = herd.spec;
    for (const a of herd.animals) {
      a.t -= dt;
      a.phase += dt * 8;

      const dx = a.x - playerPos.x, dz = a.z - playerPos.z;
      const d2 = dx * dx + dz * dz;

      // Threat: proximity scaled by how fast the player is coming in. A slow, calm
      // approach can get inside `calm` metres — tasks rely on that.
      const speedFactor = clamp(playerSpeed / 8, 0.35, 2.2);
      const threat = spec.flee * speedFactor;

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

  step(a, speed, dt) {
    const f = Math.sin(a.yaw), g = Math.cos(a.yaw);
    const nx = a.x + f * speed * dt, nz = a.z + g * speed * dt;
    // Animals will not walk onto the tarmac — they are scenery and hazard-free by
    // design; a deer bolting under the wheels would demand a collision system.
    if (nearest(nx, nz).dist > 8.5) {
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
