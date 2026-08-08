import * as THREE from 'three';
import { JOURNEY, biomeAt, mixField } from './biomes.js';
import { nearest } from './road.js';
import { elevation, CHUNK } from './terrain.js';
import { hash2, clamp, lerp } from './rng.js';

// Everything that grows out of the ground. Trees and rocks come from the realistic
// library in veg.js (generated ez-trees + PolyHaven photoscans); reeds and ferns
// stay procedural — they are grass-adjacent filler and read fine.
//
// One InstancedMesh per species (two for LOD'd trees). Placement is cached per
// chunk so crossing a boundary copies arrays instead of re-deriving ground heights.

// --- the two procedural leftovers -------------------------------------------
function flatLeafGeometry(builder) {
  const pos = [], nor = [], col = [], idx = [];
  let base = 0;
  const c = new THREE.Color();
  const add = (geo, m, tint) => {
    const g = geo.clone().applyMatrix4(m);
    c.setHex(tint, 'srgb');
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(0, 1, 0);
      col.push(c.r, c.g, c.b);
    }
    const index = g.getIndex();
    if (index) for (let i = 0; i < index.count; i++) idx.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
    base += p.count;
    g.dispose();
  };
  builder(add);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const LEAF = (w, h) => new THREE.PlaneGeometry(w, h);

function reedGeometry() {
  return flatLeafGeometry((add) => {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      add(LEAF(0.1, 1.9), new THREE.Matrix4().makeRotationZ((i % 2 ? 1 : -1) * 0.14)
        .premultiply(new THREE.Matrix4().makeRotationY(a))
        .premultiply(new THREE.Matrix4().makeTranslation(Math.cos(a) * 0.12, 0.95, Math.sin(a) * 0.12)),
      i % 2 ? 0x8b9558 : 0x77824a);
    }
  });
}

function fernGeometry() {
  return flatLeafGeometry((add) => {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI;
      add(LEAF(1.5, 0.5), new THREE.Matrix4().makeRotationX(-1.15)
        .premultiply(new THREE.Matrix4().makeRotationY(a))
        .premultiply(new THREE.Matrix4().makeTranslation(0, 0.32, 0)), 0x36703a);
    }
  });
}

// --- what grows where -------------------------------------------------------
// density in plants per square metre. Real trees are two orders sparser than the
// old primitives — each one is a real silhouette now, not a cone.
const FLORA = {
  verdant: [
    { s: 'oakA', density: 0.00012, scale: [0.7, 1.3], maxSlope: 0.7 },
    { s: 'ashA', density: 0.0001, scale: [0.7, 1.2], maxSlope: 0.7 },
    { s: 'bushA', density: 0.0004, scale: [0.6, 1.4], maxSlope: 0.9 },
    { s: 'boulder', density: 0.0003, scale: [0.5, 1.6], maxSlope: 2.5 },
  ],
  duskwood: [
    { s: 'pineA', density: 0.0008, scale: [0.75, 1.35], maxSlope: 0.95 },
    { s: 'pineB', density: 0.0005, scale: [0.7, 1.2], maxSlope: 0.95 },
    { s: 'stump', density: 0.0002, scale: [0.8, 1.4], maxSlope: 0.8 },
    { s: 'bushB', density: 0.00035, scale: [0.6, 1.2], maxSlope: 0.9 },
    { s: 'boulder', density: 0.0005, scale: [0.5, 1.7], maxSlope: 2.5 },
  ],
  emberfall: [
    { s: 'quiver', density: 0.00028, scale: [0.6, 1.3], maxSlope: 0.6 },
    { s: 'boulderB', density: 0.0009, scale: [0.5, 2.2], maxSlope: 2.5 },
    { s: 'boulder', density: 0.0006, scale: [0.4, 1.8], maxSlope: 2.5 },
    { s: 'deadTrunk', density: 0.00022, scale: [0.8, 1.4], maxSlope: 0.6 },
  ],
  whisper: [
    { s: 'oakA', density: 0.0005, scale: [0.9, 1.6], maxSlope: 0.95 },
    { s: 'ashA', density: 0.0003, scale: [0.9, 1.5], maxSlope: 0.9 },
    { s: 'fern', density: 0.014, scale: [0.7, 1.8], maxSlope: 1.0 },
    { s: 'bushA', density: 0.0005, scale: [0.7, 1.4], maxSlope: 0.9 },
    { s: 'boulder', density: 0.0004, scale: [0.5, 1.4], maxSlope: 2.5 },
  ],
  frostveil: [
    { s: 'pineB', density: 0.00055, scale: [0.55, 1.05], maxSlope: 0.85 },
    { s: 'boulder', density: 0.001, scale: [0.5, 2.4], maxSlope: 2.5 },
    { s: 'boulderB', density: 0.0005, scale: [0.6, 2.0], maxSlope: 2.5 },
  ],
  marsh: [
    { s: 'reed', density: 0.03, scale: [0.7, 1.6], maxSlope: 0.35 },
    { s: 'aspenA', density: 0.0003, scale: [0.7, 1.2], maxSlope: 0.6 },
    { s: 'deadTrunk', density: 0.0005, scale: [0.7, 1.3], maxSlope: 0.5 },
    { s: 'bushB', density: 0.0008, scale: [0.6, 1.1], maxSlope: 0.6 },
  ],
  ashen: [
    { s: 'boulderB', density: 0.001, scale: [0.5, 2.2], maxSlope: 2.5 },
    { s: 'boulder', density: 0.0007, scale: [0.4, 1.9], maxSlope: 2.5 },
    { s: 'deadTrunk', density: 0.0004, scale: [0.7, 1.3], maxSlope: 0.7 },
  ],
};

// Far-LOD substitutions past the near rings.
const FAR_OF = { pineA: 'pineFar', pineB: 'pineFar', oakA: 'oakFar', ashA: 'oakFar' };

const CAP = {
  pineA: 1100, pineB: 800, oakA: 900, ashA: 600, aspenA: 400, bushA: 1400, bushB: 1100,
  pineFar: 2600, oakFar: 2200,
  boulder: 3200, boulderB: 2000, stump: 450, deadTrunk: 750, quiver: 480,
  reed: 20000, fern: 12000,
};

// Trees thin far more aggressively than filler — the far LOD carries the horizon.
const FALLOFF = [1, 1, 0.55, 0.28];
const FALLOFF_HEAVY = [1, 0.5, 0.2, 0.08];
const HEAVY = new Set(['pineA', 'pineB', 'oakA', 'ashA', 'aspenA', 'quiver']);

const ROAD_CLEAR = 9.5;
const STRIDE = 7;

function speciesAt(z) {
  const { a, b, t } = biomeAt(clamp(z, 0, JOURNEY));
  return t > 0.001 ? { list: FLORA[a.id], other: FLORA[b.id], t } : { list: FLORA[a.id], other: null, t: 0 };
}

function placeChunk(cx, cz, density) {
  const ox = cx * CHUNK, oz = cz * CHUNK;
  const out = {};
  const ids = new Set();
  for (const list of Object.values(FLORA)) for (const f of list) ids.add(f.s);

  for (const id of ids) {
    const mid = speciesAt(oz + CHUNK / 2);
    const entry = mid.list.find((f) => f.s === id);
    const entryB = mid.other?.find((f) => f.s === id);
    let dens = (entry?.density || 0) * (1 - mid.t) + (entryB?.density || 0) * mid.t;
    if (dens <= 0) continue;
    dens *= density;

    const spec = entry || entryB;
    const spacing = Math.sqrt(1 / dens);
    const n = Math.max(1, Math.round(CHUNK / spacing));
    const cell = CHUNK / n;
    const rows = [];

    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        const gx = cx * 1000 + a, gz = cz * 1000 + b;
        const h1 = hash2(gx, gz), h2v = hash2(gx + 7919, gz - 104729);
        const x = ox + (a + h1) * cell;
        const z = oz + (b + h2v) * cell;

        const r = nearest(x, z);
        if (r.dist < ROAD_CLEAR) continue;

        const y = elevation(x, z);
        const e = 2.2;
        const gxx = (elevation(x + e, z) - elevation(x - e, z)) / (2 * e);
        const gzz = (elevation(x, z + e) - elevation(x, z - e)) / (2 * e);
        if (Math.hypot(gxx, gzz) > spec.maxSlope) continue;

        const line = mixField(clamp(z, 0, JOURNEY), 'snow');
        if (!id.startsWith('boulder') && y > line - 40) continue;

        const h3 = hash2(gx - 31337, gz + 65537);
        const h4 = hash2(gx + 512, gz + 512);
        rows.push(
          x, y, z,
          lerp(spec.scale[0], spec.scale[1], h3),
          h4 * Math.PI * 2,
          hash2(gx * 3 + 11, gz * 3 - 17),
          0.82 + h1 * 0.32,
        );
      }
    }
    if (rows.length) out[id] = new Float32Array(rows);
  }
  return out;
}

// Species that stop a car, as trunk/body circle radius per unit of scale.
// Bushes, reeds and ferns stay soft - driving through undergrowth is part of the
// fun; driving through an oak is not.
export const COLLIDERS = {
  pineA: 0.34, pineB: 0.3, oakA: 0.44, ashA: 0.36, aspenA: 0.3,
  pineFar: 0.34, oakFar: 0.44,
  boulder: 0.95, boulderB: 0.65, stump: 0.38, deadTrunk: 0.36, quiver: 0.32,
};

// The physics needs the live Scatter's placement cache without importing the
// instance, so the instance registers itself here.
export const activeScatter = { current: null };

// Solid obstacles within ~20 m of (x, z). Reuses `out` to stay allocation-free in
// the physics step. Returns [] before the world finishes booting.
export function obstaclesNear(x, z, out = []) {
  out.length = 0;
  const sc = activeScatter.current;
  if (!sc) return out;
  const ccx = Math.floor(x / CHUNK), ccz = Math.floor(z / CHUNK);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const data = sc.cache.get(sc.key(ccx + dx, ccz + dz));
      if (!data) continue;
      for (const id in data) {
        const cr = COLLIDERS[id];
        if (!cr) continue;
        const rows = data[id];
        for (let i = 0; i < rows.length; i += STRIDE) {
          const ox = rows[i], oz = rows[i + 2];
          const ddx = ox - x, ddz = oz - z;
          if (ddx * ddx + ddz * ddz < 400) {
            out.push({ x: ox, z: oz, r: cr * rows[i + 3] });
          }
        }
      }
    }
  }
  return out;
}

export class Scatter {
  constructor({ quality, veg }) {
    this.q = quality;
    this.group = new THREE.Group();
    this.group.name = 'scatter';
    this.cache = new Map();
    this.meshes = {};
    this.lastKeys = '';

    const leafMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
    });
    // Same back-face fix as the grass: flat filler foliage keeps its up normal.
    leafMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        normal = normalize( vNormal );`,
      );
    };
    leafMat.customProgramCacheKey = () => 'scatter-upnormal';

    const defs = {
      reed: { geo: reedGeometry(), mats: leafMat, shadow: false },
      fern: { geo: fernGeometry(), mats: leafMat, shadow: false },
    };
    for (const [id, v] of Object.entries(veg)) {
      defs[id] = { geo: v.geo, mats: v.mats.length === 1 ? v.mats[0] : v.mats, shadow: true };
    }

    for (const [id, def] of Object.entries(defs)) {
      const cap = Math.max(32, Math.round((CAP[id] || 300) * (quality.scatterDensity || 1)));
      const m = new THREE.InstancedMesh(def.geo, def.mats, cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = def.shadow && !!quality.shadows && !id.endsWith('Far');
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      m.name = `scatter-${id}`;
      this.meshes[id] = m;
      this.group.add(m);
    }

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    activeScatter.current = this;
  }

  key(cx, cz) { return (cx + 4096) * 8192 + (cz + 4096); }

  update(px, pz, budget = 1) {
    const radius = this.q.scatterRings;
    const ccx = Math.floor(px / CHUNK), ccz = Math.floor(pz / CHUNK);
    const want = [];
    let missing = 0;

    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const ring = Math.max(Math.abs(dx), Math.abs(dz));
        const cx = ccx + dx, cz = ccz + dz;
        const k = this.key(cx, cz);
        want.push({ k, cx, cz, ring, d: dx * dx + dz * dz });
        if (!this.cache.has(k)) missing++;
      }
    }

    if (missing) {
      want.sort((a, b) => a.d - b.d);
      let done = 0;
      for (const w of want) {
        if (done >= budget) break;
        if (this.cache.has(w.k)) continue;
        this.cache.set(w.k, placeChunk(w.cx, w.cz, this.q.scatterDensity));
        done++;
      }
      if (this.cache.size > 400) {
        const keep = new Set(want.map((w) => w.k));
        for (const k of this.cache.keys()) {
          if (this.cache.size <= 400) break;
          if (!keep.has(k)) this.cache.delete(k);
        }
      }
    }

    const sig = `${ccx},${ccz},${this.cache.size}`;
    if (sig === this.lastKeys) return;
    this.lastKeys = sig;
    this.rebuild(want);
  }

  rebuild(want) {
    const counts = {};
    for (const id in this.meshes) counts[id] = 0;

    for (const w of want) {
      const data = this.cache.get(w.k);
      if (!data) continue;

      for (const baseId in data) {
        // Past the near rings a LOD'd tree species draws its far variant instead.
        const far = w.ring >= 2 ? FAR_OF[baseId] : null;
        const id = far && this.meshes[far] ? far : baseId;
        const mesh = this.meshes[id];
        if (!mesh) continue;
        const falloff = (HEAVY.has(baseId) ? FALLOFF_HEAVY : FALLOFF)[Math.min(w.ring, 3)];
        const rows = data[baseId];
        let n = counts[id];
        const cap = mesh.instanceMatrix.count;

        for (let i = 0; i < rows.length; i += STRIDE) {
          if (n >= cap) break;
          if (rows[i + 5] > falloff) continue;
          const s = rows[i + 3];
          this._q.setFromAxisAngle(this._up, rows[i + 4]);
          this._m.compose(
            this._v.set(rows[i], rows[i + 1], rows[i + 2]),
            this._q,
            this._s.set(s, s, s),
          );
          mesh.setMatrixAt(n, this._m);
          n++;
        }
        counts[id] = n;
      }
    }

    for (const id in this.meshes) {
      this.meshes[id].count = counts[id];
      this.meshes[id].instanceMatrix.needsUpdate = true;
    }
  }

  get total() {
    let n = 0;
    for (const id in this.meshes) n += this.meshes[id].count;
    return n;
  }
}
