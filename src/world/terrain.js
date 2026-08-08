import * as THREE from 'three';
import { JOURNEY, biomeAt, roadElevation, mixColor, mixField, SNOW_FADE } from './biomes.js';
import { nearest, corridorWeight, CORRIDOR, ROAD_LENGTH } from './road.js';
import { VALLEY } from './valley.js';
import { makeNoise, clamp, lerp, smoothstep } from './rng.js';
import { loadSplatTextures, makeSplatMaterial } from './splat.js';

export const CHUNK = 256;

// Chebyshev ring radius -> grid resolution. Detail collapses fast with distance;
// fog does the rest. Tier overrides trim the outer rings on weak devices.
const LOD_HIGH = [
  { ring: 1, seg: 64 },
  { ring: 3, seg: 32 },
  { ring: 6, seg: 16 },
];
const LOD_LOW = [
  { ring: 1, seg: 48 },
  { ring: 2, seg: 24 },
  { ring: 4, seg: 12 },
];

const SKIRT = 6;                 // how far chunk edges hang down to hide LOD cracks
const RISE = 950;                // terrain climbs away from the road out to here
const WALL_IN = 980, WALL_OUT = 1520;   // cliffs the car cannot climb, in place of walls

const land = makeNoise(1);
const ridge = makeNoise(2);
const grain = makeNoise(5);

function fbm(noise, x, z, f, octaves) {
  let h = 0, amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    h += noise(x * f, z * f) * amp;
    norm += amp; amp *= 0.5; f *= 2.13;
  }
  return h / norm;
}

// Terrain away from the road: region-shaped noise, rising into valley walls, capped
// by cliffs the car cannot climb so the corridor needs no invisible barriers.
function wildElevation(x, z, roadDist) {
  const along = clamp(z, 0, JOURNEY);
  const { a, b, t } = biomeAt(along);
  const relief = lerp(a.relief, b.relief, t);
  const rough = lerp(a.rough, b.rough, t);
  const base = roadElevation(along);

  const f = rough / 1500;
  const rolling = fbm(land, x, z, f, 5);
  // 1 - |n| gives sharp crests instead of blobs. High-relief country leans on it.
  const sharp = 1 - Math.abs(fbm(ridge, x + 811, z - 407, f * 1.4, 4));
  const ridged = lerp(rolling, sharp * 2 - 1, clamp(relief / 300, 0, 0.8));

  const valley = smoothstep(0, RISE, roadDist);
  const wall = smoothstep(WALL_IN, WALL_OUT, roadDist);

  let h = base
    + ridged * relief
    + valley * relief * 0.55
    // Scaled to the region: a flat 420 m everywhere put a snowcapped rampart around
    // an open meadow. Gentle country gets hills, mountain country gets mountains.
    + wall * (170 + relief * 1.5)
    + fbm(grain, x, z, 0.02, 2) * 2.6;

  // The destination: past the end of the road the land is folded into a caldera
  // bowl. The bowl's own profile climbs from the floor back up to road height at
  // the rim — if it did not, the blend against outside terrain would manufacture
  // an undrivable 80% wall exactly across the arrival line.
  const vd = Math.hypot(x - VALLEY.x, z - VALLEY.z);
  if (vd < VALLEY.r) {
    const t = smoothstep(VALLEY.r, VALLEY.r * 0.55, vd);         // 1 inside the rim ring
    const shape = smoothstep(0.15, 1.0, vd / VALLEY.r);          // 0 centre, 1 at rim
    const bowl = lerp(VALLEY.floorY, VALLEY.endY + 6, shape)
      + fbm(grain, x * 1.7, z * 1.7, 0.02, 2) * 2.2;
    h = lerp(h, bowl, t);

    // The arrival lane: a graded ramp from the gate down to the floor, carved along
    // the axis the road delivers you on. The bowl's walls may be as steep as a
    // caldera pleases — this lane is the one guaranteed way in and out.
    const ax = x - VALLEY.endX, az = z - VALLEY.endZ;
    const s = ax * VALLEY.dirX + az * VALLEY.dirZ;               // metres past the gate
    if (s > -20) {
      const lat = Math.abs(ax * -VALLEY.dirZ + az * VALLEY.dirX);
      const lane = smoothstep(34, 12, lat);
      if (lane > 0) {
        const ramp = lerp(VALLEY.endY, VALLEY.floorY, smoothstep(30, 400, s));
        h = lerp(h, ramp, lane);
      }
    }
  }
  return h;
}

// Ground height given an already-computed nearest-road result. Split out only so the
// chunk mesher can reuse its own nearest() lookup instead of paying for a second one
// — the mesh and the physics must never disagree about where the ground is.
function heightFrom(r, x, z) {
  const w = corridorWeight(r.dist);
  if (w >= 1) return r.y;

  const wild = wildElevation(x, z, r.dist);
  // A valley floor. The graded corridor ends at 46 m, and without this the land
  // resumes its full relief immediately outside it — which made the mountain pass a
  // slot canyon with 280 m walls a car's length from the tarmac. Roads follow valleys;
  // the shelf is how wide that valley is, and it scales with how big the country is.
  const along = clamp(z, 0, JOURNEY);
  const { a, b, t } = biomeAt(along);
  let shelf = 90 + lerp(a.relief, b.relief, t) * 0.9;
  // The shelf flattens ground BESIDE tarmac. Past the road's terminus there is no
  // tarmac — held at full width there, it pinned the valley rim at road height and
  // squeezed the whole 74 m descent into a 60 m wall. Shrink it fast at the end.
  if (r.along > ROAD_LENGTH - 30) shelf = CORRIDOR + 40;
  const eased = lerp(r.y, wild, smoothstep(CORRIDOR, shelf, r.dist));

  return w <= 0 ? eased : lerp(eased, r.y, w);
}

// The authority on ground height. Car physics, foot movement, prop placement and the
// terrain mesh all read this, so nothing can ever disagree about where the ground is.
export function elevation(x, z) {
  return heightFrom(nearest(x, z), x, z);
}

const _n = new THREE.Vector3();
export function groundNormal(x, z, out = _n) {
  const e = 1.5;
  const hl = elevation(x - e, z), hr = elevation(x + e, z);
  const hd = elevation(x, z - e), hu = elevation(x, z + e);
  return out.set(hl - hr, 2 * e, hd - hu).normalize();
}

// --- chunk meshing ----------------------------------------------------------

const _c = new THREE.Color();
const _rock = new THREE.Color();
const _soil = new THREE.Color();

function buildChunk(cx, cz, seg) {
  const N = seg + 1;
  const step = CHUNK / seg;
  const ox = cx * CHUNK, oz = cz * CHUNK;

  // Heights first, in one pass. Slope then comes from neighbours in this array for
  // free, instead of three extra elevation() calls per vertex.
  const h = new Float32Array(N * N);
  const dist = new Float32Array(N * N);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const x = ox + c * step, z = oz + r * step;
      const nr = nearest(x, z);
      const i = r * N + c;
      dist[i] = nr.dist;
      h[i] = heightFrom(nr, x, z);
    }
  }

  const skirtCount = 4 * N;
  const total = N * N + skirtCount;
  const pos = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const splat = new Float32Array(total * 4);     // grass, rock, snow, soil weights
  const arid = new Float32Array(total);          // 0 grassland, 1 sand desert

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      const x = ox + c * step, z = oz + r * step, y = h[i];
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;

      const l = h[r * N + Math.max(0, c - 1)], rr = h[r * N + Math.min(N - 1, c + 1)];
      const d = h[Math.max(0, r - 1) * N + c], u = h[Math.min(N - 1, r + 1) * N + c];
      // Gradient, NOT clamped to 1. Clamping capped slope at 45°, above which every
      // test below saturated — so mountainsides came out uniformly rock and the snow
      // never landed anywhere it mattered.
      const gx = (rr - l) / (2 * step), gz = (u - d) / (2 * step);
      const slope = Math.hypot(gx, gz);

      const along = clamp(z, 0, JOURNEY);

      // The same ground logic as ever, expressed as texture weights now: patchiness
      // moves soil into grassland, slope brings rock, verges wear to soil, altitude
      // lays snow that slides off near-vertical faces.
      const patch = fbm(grain, x, z, 0.006, 2) * 0.5 + 0.5;
      const rockW = smoothstep(0.45, 1.25, slope);
      const vergeW = (1 - smoothstep(7, 26, dist[i])) * 0.75;
      const line = mixField(along, 'snow');
      const snowW = smoothstep(line, line + SNOW_FADE, y) * (1 - smoothstep(1.15, 2.1, slope));

      let g = 1, so = 0;
      so += patch * 0.32;                          // broken ground within grassland
      g -= so;
      const open = Math.max(0, 1 - rockW) * Math.max(0, 1 - snowW);
      let wG = g * open * (1 - vergeW);
      let wSo = (so * open) * (1 - vergeW) + vergeW * (1 - snowW);
      let wR = rockW * (1 - snowW);
      const wS = snowW;
      const i4 = i * 4;
      splat[i4] = wG; splat[i4 + 1] = wR; splat[i4 + 2] = wS; splat[i4 + 3] = wSo;

      // How desert this ground is: Emberfall fully, Ashen partly (dark tint does
      // the volcanic reading), everywhere else grassy.
      const { a: bA, b: bB, t: bT } = biomeAt(along);
      const aridOf = (bi) => (bi.id === 'emberfall' ? 1 : bi.id === 'ashen' ? 0.85 : 0);
      arid[i] = lerp(aridOf(bA), aridOf(bB), bT);

      // Vertex colour becomes a hue tint over the photographic maps — strong enough
      // that Duskwood stays darker and Ashen stays charcoal, weak enough that the
      // texture provides the actual albedo detail.
      mixColor(along, 'grass', _c);
      mixColor(along, 'rock', _rock);
      mixColor(along, 'soil', _soil);
      const domRock = wR + wS > wG + wSo;
      const base = domRock ? _rock : (wSo > wG ? _soil : _c);
      const lum = 0.2126 * base.r + 0.7152 * base.g + 0.0722 * base.b;
      // Normalize away brightness (the texture owns that), keep the hue.
      const tintR = lum > 0.01 ? base.r / (lum * 2.2) : 1;
      const tintG = lum > 0.01 ? base.g / (lum * 2.2) : 1;
      const tintB = lum > 0.01 ? base.b / (lum * 2.2) : 1;
      col[i * 3] = clamp(lerp(1, tintR, 0.8), 0, 1.7);
      col[i * 3 + 1] = clamp(lerp(1, tintG, 0.8), 0, 1.7);
      col[i * 3 + 2] = clamp(lerp(1, tintB, 0.8), 0, 1.7);
    }
  }

  // Skirts: a duplicate of each border vertex dropped straight down, so a coarse
  // neighbour chunk can never show a gap of sky through the seam.
  const edges = [];
  for (let c = 0; c < N; c++) edges.push(c);                       // near
  for (let c = 0; c < N; c++) edges.push((N - 1) * N + c);         // far
  for (let r = 0; r < N; r++) edges.push(r * N);                   // left
  for (let r = 0; r < N; r++) edges.push(r * N + (N - 1));         // right
  for (let k = 0; k < edges.length; k++) {
    const src = edges[k], dst = N * N + k;
    pos[dst * 3] = pos[src * 3];
    pos[dst * 3 + 1] = pos[src * 3 + 1] - SKIRT;
    pos[dst * 3 + 2] = pos[src * 3 + 2];
    col[dst * 3] = col[src * 3]; col[dst * 3 + 1] = col[src * 3 + 1]; col[dst * 3 + 2] = col[src * 3 + 2];
    for (let q = 0; q < 4; q++) splat[dst * 4 + q] = splat[src * 4 + q];
    arid[dst] = arid[src];
  }

  const quads = seg * seg + 4 * seg;
  const idx = new Uint32Array(quads * 6);
  let w = 0;
  for (let r = 0; r < seg; r++) {
    for (let c = 0; c < seg; c++) {
      const a = r * N + c, b = a + 1, d = a + N, e = d + 1;
      idx[w++] = a; idx[w++] = d; idx[w++] = b;
      idx[w++] = b; idx[w++] = d; idx[w++] = e;
    }
  }
  // Winding per edge so every skirt faces outward.
  const stitch = (base, flip) => {
    for (let k = 0; k < seg; k++) {
      const a = edges[base + k], b = edges[base + k + 1];
      const sa = N * N + base + k, sb = sa + 1;
      if (flip) { idx[w++] = a; idx[w++] = sa; idx[w++] = b; idx[w++] = b; idx[w++] = sa; idx[w++] = sb; }
      else { idx[w++] = a; idx[w++] = b; idx[w++] = sa; idx[w++] = b; idx[w++] = sb; idx[w++] = sa; }
    }
  };
  stitch(0, true); stitch(N, false); stitch(2 * N, false); stitch(3 * N, true);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSplat', new THREE.BufferAttribute(splat, 4));
  geo.setAttribute('aArid', new THREE.BufferAttribute(arid, 1));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

export class Terrain {
  constructor({ quality = 'high', textured = false } = {}) {
    this.lods = quality === 'low' ? LOD_LOW : LOD_HIGH;
    this.radius = this.lods[this.lods.length - 1].ring;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    // textured only in the browser: TextureLoader needs a DOM, and the node tests
    // construct Terrain for streaming logic alone.
    this.material = textured
      ? makeSplatMaterial(loadSplatTextures())
      : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0.0 });
    this.chunks = new Map();
    this.queue = [];
  }

  lodFor(ring) {
    for (const l of this.lods) if (ring <= l.ring) return l.seg;
    return 0;
  }

  key(cx, cz) { return (cx + 4096) * 8192 + (cz + 4096); }

  // Called every frame. Queues what is missing, drops what is behind, and builds a
  // couple of chunks per frame so streaming never stalls the loop.
  update(px, pz, budget = 2) {
    const ccx = Math.floor(px / CHUNK), ccz = Math.floor(pz / CHUNK);
    const wanted = new Set();

    for (let dz = -this.radius; dz <= this.radius; dz++) {
      for (let dx = -this.radius; dx <= this.radius; dx++) {
        const ring = Math.max(Math.abs(dx), Math.abs(dz));
        const seg = this.lodFor(ring);
        if (!seg) continue;
        const cx = ccx + dx, cz = ccz + dz;
        const k = this.key(cx, cz);
        wanted.add(k);
        const have = this.chunks.get(k);
        if (!have) {
          // Chunk geometry carries absolute world coordinates, so the mesh itself
          // sits at the origin — cx/cz are the only record of where a chunk is.
          this.chunks.set(k, { pending: true, seg, cx, cz });
          this.queue.push({ k, cx, cz, seg, d: dx * dx + dz * dz });
        } else if (have.seg !== seg && !have.pending) {
          have.pending = true; have.seg = seg;
          this.queue.push({ k, cx, cz, seg, d: dx * dx + dz * dz });
        }
      }
    }

    for (const [k, entry] of this.chunks) {
      if (wanted.has(k)) continue;
      if (entry.mesh) { this.group.remove(entry.mesh); entry.mesh.geometry.dispose(); }
      this.chunks.delete(k);
    }

    if (this.queue.length) {
      this.queue.sort((a, b) => a.d - b.d);
      for (let i = 0; i < budget && this.queue.length; i++) {
        const job = this.queue.shift();
        const entry = this.chunks.get(job.k);
        if (!entry || entry.seg !== job.seg) continue;
        const geo = buildChunk(job.cx, job.cz, job.seg);
        if (entry.mesh) { this.group.remove(entry.mesh); entry.mesh.geometry.dispose(); }
        const mesh = new THREE.Mesh(geo, this.material);
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        entry.mesh = mesh;
        entry.pending = false;
        this.group.add(mesh);
      }
    }
  }

  // Build everything in range right now — used at startup and by the screenshot
  // harness, where a half-streamed world is not a useful picture.
  settle(px, pz, maxPasses = 400) {
    for (let i = 0; i < maxPasses; i++) {
      this.update(px, pz, 8);
      if (!this.queue.length) break;
    }
  }
}
