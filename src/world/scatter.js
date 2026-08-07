import * as THREE from 'three';
import { JOURNEY, biomeAt, mixField } from './biomes.js';
import { nearest } from './road.js';
import { elevation, CHUNK } from './terrain.js';
import { hash2, clamp, lerp } from './rng.js';

// Everything that grows out of the ground.
//
// One InstancedMesh per species for the WHOLE visible world, not per chunk — with
// ~7000 plants on screen, per-chunk meshes would be 300+ draw calls before the
// terrain gets a look in. Placement is cached per chunk so crossing a chunk boundary
// copies arrays instead of re-deriving thousands of ground heights.

// --- geometry ---------------------------------------------------------------
// Small builder so each species is one merged geometry with baked-in part colours.
class Parts {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.idx = []; this.n = 0; }

  // flat: force the normals straight up. Single-plane foliage — fronds, ferns, reeds
  // — lit by its own surface normal goes pure black on whichever side faces away
  // from the sun. Real leaves scatter light; pointing the normal at the sky is the
  // cheapest convincing stand-in and is what most foliage shaders end up doing.
  add(geo, m, hex, flat = false) {
    const g = geo.clone().applyMatrix4(m);
    g.computeVertexNormals();
    if (flat) {
      const n = g.getAttribute('normal');
      for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
    }
    const p = g.getAttribute('position'), nr = g.getAttribute('normal');
    // setHex(v, 'srgb') converts exactly once. `new Color(hex)` already does that
    // conversion under three's colour management — calling convertSRGBToLinear on
    // top of it squares the value and every plant renders as a black silhouette.
    const c = new THREE.Color().setHex(hex, 'srgb');
    const index = g.getIndex();
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(nr.getX(i), nr.getY(i), nr.getZ(i));
      this.col.push(c.r, c.g, c.b);
    }
    if (index) for (let i = 0; i < index.count; i++) this.idx.push(this.n + index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(this.n + i);
    this.n += p.count;
    g.dispose();
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const M = (x, y, z, sx = 1, sy = 1, sz = 1, rz = 0) => new THREE.Matrix4()
  .makeRotationZ(rz).premultiply(new THREE.Matrix4().makeScale(sx, sy, sz))
  .premultiply(new THREE.Matrix4().makeTranslation(x, y, z));

// Deliberately coarse. At 6000 instances every extra triangle per plant is 6000
// triangles on screen, and none of it survives 40 m of distance anyway.
const CYL = (r1, r2, h, s = 5) => new THREE.CylinderGeometry(r1, r2, h, s, 1, false);
const CONE = (r, h, s = 6) => new THREE.ConeGeometry(r, h, s, 1);
const BALL = (r, d = 0) => new THREE.IcosahedronGeometry(r, d);
const LEAF = (w, h) => new THREE.PlaneGeometry(w, h);

const SPECIES = {
  pine: () => new Parts()
    .add(CYL(0.16, 0.24, 2.2), M(0, 1.1, 0), 0x4a3826)
    .add(CONE(1.5, 3.0), M(0, 3.0, 0), 0x335c37)
    .add(CONE(1.15, 2.6), M(0, 4.5, 0), 0x3b6a3f)
    .add(CONE(0.75, 2.0), M(0, 5.9, 0), 0x457648)
    .build(),

  broadleaf: () => new Parts()
    .add(CYL(0.2, 0.3, 3.0), M(0, 1.5, 0), 0x5a4530)
    .add(BALL(1.9), M(0, 4.2, 0, 1, 0.8, 1), 0x4d7a35)
    .add(BALL(1.4), M(1.2, 3.6, 0.5, 1, 0.85, 1), 0x568437)
    .add(BALL(1.2), M(-1.0, 3.9, -0.6), 0x44702f)
    .build(),

  palm: () => {
    const p = new Parts().add(CYL(0.17, 0.26, 6.0), M(0.5, 3.0, 0, 1, 1, 1, -0.16), 0x6b5537);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      // Each frond is pushed out along its own length first, then laid down toward
      // horizontal and swung round the crown. Rotating an upright plane instead —
      // the obvious version — leaves seven blades standing on end like a fan.
      const m = new THREE.Matrix4().makeTranslation(0, 1.7, 0)
        .premultiply(new THREE.Matrix4().makeRotationX(-(Math.PI / 2 - 0.42)))
        .premultiply(new THREE.Matrix4().makeRotationY(a))
        .premultiply(new THREE.Matrix4().makeTranslation(0.62, 5.9, 0));
      p.add(LEAF(0.8, 3.4), m, i % 2 ? 0x3f8447 : 0x4c9450, true);
    }
    return p.build();
  },

  cactus: () => new Parts()
    .add(CYL(0.42, 0.5, 3.4, 7), M(0, 1.7, 0), 0x4f7040)
    .add(CYL(0.22, 0.24, 1.4, 6), M(0.62, 2.2, 0, 1, 1, 1, 1.1), 0x557645)
    .add(CYL(0.2, 0.2, 1.1, 6), M(-0.55, 2.6, 0.2, 1, 1, 1, -1.2), 0x4a6a3c)
    .build(),

  rock: () => new Parts()
    .add(BALL(1.0), M(0, 0.42, 0, 1.35, 0.72, 1.1), 0x6e6a63)
    .add(BALL(0.55), M(0.9, 0.3, 0.4, 1.1, 0.8, 1), 0x7a756c)
    .build(),

  bush: () => new Parts()
    .add(BALL(0.72), M(0, 0.5, 0, 1.2, 0.85, 1.1), 0x50763d)
    .add(BALL(0.5), M(0.55, 0.42, 0.3), 0x5c8446)
    .build(),

  deadwood: () => new Parts()
    .add(CYL(0.1, 0.22, 4.2, 4), M(0, 2.1, 0), 0x6b5f52)
    .add(CYL(0.06, 0.1, 1.6, 4), M(0.5, 3.2, 0, 1, 1, 1, 0.9), 0x6b5f52)
    .add(CYL(0.05, 0.09, 1.3, 4), M(-0.45, 2.6, 0.2, 1, 1, 1, -1.0), 0x635749)
    .build(),

  reed: () => {
    const p = new Parts();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      p.add(LEAF(0.1, 1.9), new THREE.Matrix4().makeRotationZ((i % 2 ? 1 : -1) * 0.14)
        .premultiply(new THREE.Matrix4().makeRotationY(a))
        .premultiply(new THREE.Matrix4().makeTranslation(Math.cos(a) * 0.12, 0.95, Math.sin(a) * 0.12)),
        i % 2 ? 0x8b9558 : 0x77824a, true);
    }
    return p.build();
  },

  fern: () => {
    const p = new Parts();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI;
      p.add(LEAF(1.5, 0.5), new THREE.Matrix4().makeRotationX(-1.15)
        .premultiply(new THREE.Matrix4().makeRotationY(a))
        .premultiply(new THREE.Matrix4().makeTranslation(0, 0.32, 0)), 0x36703a, true);
    }
    return p.build();
  },
};

// --- what grows where -------------------------------------------------------
// density is plants per square metre at full quality. maxSlope is the gradient a
// plant will hold on to; rocks do not care, trees very much do.
const FLORA = {
  verdant: [
    { s: 'broadleaf', density: 0.0016, scale: [0.8, 1.5], maxSlope: 0.7 },
    { s: 'bush', density: 0.005, scale: [0.6, 1.4], maxSlope: 0.9 },
    { s: 'rock', density: 0.0016, scale: [0.4, 1.2], maxSlope: 2.5 },
  ],
  duskwood: [
    { s: 'pine', density: 0.0062, scale: [0.95, 1.9], maxSlope: 0.95 },
    { s: 'deadwood', density: 0.0012, scale: [0.7, 1.2], maxSlope: 0.8 },
    { s: 'bush', density: 0.0028, scale: [0.7, 1.3], maxSlope: 0.9 },
    { s: 'rock', density: 0.0022, scale: [0.4, 1.4], maxSlope: 2.5 },
  ],
  emberfall: [
    { s: 'cactus', density: 0.0022, scale: [0.6, 1.5], maxSlope: 0.6 },
    { s: 'rock', density: 0.008, scale: [0.3, 2.4], maxSlope: 2.5 },
    { s: 'deadwood', density: 0.0008, scale: [0.5, 0.9], maxSlope: 0.6 },
  ],
  whisper: [
    { s: 'broadleaf', density: 0.009, scale: [1.0, 2.1], maxSlope: 0.95 },
    { s: 'palm', density: 0.004, scale: [0.7, 1.5], maxSlope: 0.7 },
    { s: 'fern', density: 0.014, scale: [0.7, 1.8], maxSlope: 1.0 },
    { s: 'rock', density: 0.002, scale: [0.4, 1.3], maxSlope: 2.5 },
  ],
  frostveil: [
    { s: 'pine', density: 0.0035, scale: [0.5, 1.1], maxSlope: 0.85 },
    { s: 'rock', density: 0.007, scale: [0.4, 2.6], maxSlope: 2.5 },
    { s: 'deadwood', density: 0.0009, scale: [0.4, 0.8], maxSlope: 0.7 },
  ],
  marsh: [
    { s: 'reed', density: 0.03, scale: [0.7, 1.6], maxSlope: 0.35 },
    { s: 'deadwood', density: 0.0022, scale: [0.6, 1.1], maxSlope: 0.5 },
    { s: 'bush', density: 0.003, scale: [0.5, 1.0], maxSlope: 0.6 },
  ],
  ashen: [
    { s: 'rock', density: 0.009, scale: [0.4, 2.2], maxSlope: 2.5 },
    { s: 'deadwood', density: 0.0011, scale: [0.4, 0.9], maxSlope: 0.7 },
  ],
};

// Total instances a species may ever show. Sized from the densest region it appears
// in; overflow is dropped silently rather than reallocating mid-drive.
const CAP = {
  pine: 7000, broadleaf: 6000, palm: 2600, cactus: 1800,
  rock: 7000, bush: 4000, deadwood: 1800, reed: 14000, fern: 8000,
};

const RING_FALLOFF = [1, 1, 0.55, 0.28];

// Nothing grows on the tarmac or its shoulders.
const ROAD_CLEAR = 9.5;

function speciesAt(z) {
  const { a, b, t } = biomeAt(clamp(z, 0, JOURNEY));
  return t > 0.001 ? { list: FLORA[a.id], other: FLORA[b.id], t } : { list: FLORA[a.id], other: null, t: 0 };
}

// Placements for one chunk, cached forever after. Returns
// { [species]: Float32Array of [x, y, z, scale, rotY, pick, shade] per plant }.
function placeChunk(cx, cz, density) {
  const ox = cx * CHUNK, oz = cz * CHUNK;
  const out = {};

  // One pass per species over a jittered grid sized to that species' density.
  const seen = new Set();
  for (const id of Object.keys(SPECIES)) seen.add(id);

  for (const id of seen) {
    const rows = [];
    // Sample the region at the chunk's centre; a chunk is 256 m and regions blend
    // over 420 m, so per-chunk resolution is finer than the blend it is reading.
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

    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        const gx = cx * 1000 + a, gz = cz * 1000 + b;
        const h1 = hash2(gx, gz), h2v = hash2(gx + 7919, gz - 104729);
        const x = ox + (a + h1) * cell;
        const z = oz + (b + h2v) * cell;

        const r = nearest(x, z);
        if (r.dist < ROAD_CLEAR) continue;

        const y = elevation(x, z);
        // Slope from the real height field — a pine standing on a cliff face is the
        // single most obvious tell that vegetation was scattered without looking.
        const e = 2.2;
        const gxx = (elevation(x + e, z) - elevation(x - e, z)) / (2 * e);
        const gzz = (elevation(x, z + e) - elevation(x, z - e)) / (2 * e);
        if (Math.hypot(gxx, gzz) > spec.maxSlope) continue;

        // Nothing leafy above the snowline.
        const line = mixField(clamp(z, 0, JOURNEY), 'snow');
        if (id !== 'rock' && y > line - 40) continue;

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

const STRIDE = 7;

export class Scatter {
  constructor({ quality }) {
    this.q = quality;
    this.group = new THREE.Group();
    this.group.name = 'scatter';
    this.cache = new Map();
    this.queue = [];
    this.meshes = {};
    this.lastKeys = '';

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.86, metalness: 0,
      side: THREE.DoubleSide,          // fronds and ferns are single planes
    });
    // Same fix as the grass: DoubleSide negates the normal on back faces, which
    // turns every flat-foliage plane (reeds, fronds, ferns) black from one side.
    // Keep the authored normal both sides.
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        normal = normalize( vNormal );`,
      );
    };
    mat.customProgramCacheKey = () => 'scatter-upnormal';
    this.material = mat;

    for (const [id, make] of Object.entries(SPECIES)) {
      const cap = Math.max(64, Math.round(CAP[id] * (quality.scatterDensity || 1)));
      const m = new THREE.InstancedMesh(make(), mat, cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      m.castShadow = !!quality.shadows;
      m.receiveShadow = true;
      m.frustumCulled = false;         // instances span the whole visible world
      m.count = 0;
      m.name = `scatter-${id}`;
      this.meshes[id] = m;
      this.group.add(m);
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
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

    // Build a chunk's placements at most a couple per frame — each one costs a few
    // thousand ground samples and would show as a hitch if done all at once.
    if (missing) {
      want.sort((a, b) => a.d - b.d);
      let done = 0;
      for (const w of want) {
        if (done >= budget) break;
        if (this.cache.has(w.k)) continue;
        this.cache.set(w.k, placeChunk(w.cx, w.cz, this.q.scatterDensity));
        done++;
      }
      // Old placements are cheap to keep and expensive to redo; drop only the
      // stalest once the map gets large.
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
      const keepFrac = RING_FALLOFF[Math.min(w.ring, RING_FALLOFF.length - 1)];

      for (const id in data) {
        const mesh = this.meshes[id];
        const rows = data[id];
        let n = counts[id];
        const cap = mesh.instanceMatrix.count;

        for (let i = 0; i < rows.length; i += STRIDE) {
          if (n >= cap) break;
          // A stable per-plant number decides whether it survives thinning, so
          // distant chunks show a uniform subset instead of a truncated corner.
          if (rows[i + 5] > keepFrac) continue;

          const s = rows[i + 3];
          this._q.setFromAxisAngle({ x: 0, y: 1, z: 0 }, rows[i + 4]);
          this._m.compose(
            this._v.set(rows[i], rows[i + 1], rows[i + 2]),
            this._q,
            this._s.set(s, s, s),
          );
          mesh.setMatrixAt(n, this._m);
          const shade = rows[i + 6];
          mesh.instanceColor.setXYZ(n, shade, shade, shade);
          n++;
        }
        counts[id] = n;
      }
    }

    for (const id in this.meshes) {
      const m = this.meshes[id];
      m.count = counts[id];
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
    }
  }

  get total() {
    let n = 0;
    for (const id in this.meshes) n += this.meshes[id].count;
    return n;
  }
}
