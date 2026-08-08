import * as THREE from 'three';
import { asset } from '../asset.js';
import { JOURNEY, biomeAt, roadElevation } from './biomes.js';
import { makeNoise, clamp, lerp } from './rng.js';

export const HALF_WIDTH = 5.0;      // tarmac, centre to edge
export const SHOULDER = 2.6;        // graded dirt either side
export const CORRIDOR = 46;         // terrain is pulled toward road height inside this

const WP = 90;                      // spacing of the authored control points
const SAMPLE = 5;                   // spacing of the resampled lookup polyline
const CELL = 128;                   // spatial hash cell for nearest-point queries

const wobble = makeNoise(3);

// Side-to-side wander. Three frequencies so the road reads as designed rather than
// noisy: a long sweep, a medium bend, and a short kink. Scaled per region, so the
// mountain pass switchbacks and the marsh runs nearly straight.
function wander(d) {
  return (
    Math.sin(d * 0.00042) * 205 +
    Math.sin(d * 0.00131 + 1.7) * 92 +
    Math.sin(d * 0.00307 + 4.1) * 34 +
    wobble(d * 0.0011, 0) * 45
  );
}

// Rise and fall on top of the authored profile, so even flat country rolls.
// Capped: scaling this by the mountains' relief put 60 m ripples on the pass and
// turned an already-steep climb into a staircase.
function bump(d, relief) {
  const a = Math.min(relief, 85);
  return (
    Math.sin(d * 0.00091) * a * 0.20 +
    Math.sin(d * 0.00263 + 2.2) * a * 0.09 +
    wobble(0, d * 0.0016) * a * 0.07
  );
}

function centrelinePoint(d) {
  const { a, b, t } = biomeAt(d);
  const curvy = lerp(a.curvy, b.curvy, t);
  const relief = lerp(a.relief, b.relief, t);
  const y = roadElevation(d) + bump(d, relief);
  return new THREE.Vector3(wander(d) * curvy, y, d);
}

const control = [];
for (let d = -WP; d <= JOURNEY + WP; d += WP) {
  control.push(centrelinePoint(clamp(d, -WP, JOURNEY + WP)));
}
export const curve = new THREE.CatmullRomCurve3(control, false, 'catmullrom', 0.5);
// The default 200 divisions would put the arc-length table at 75 m resolution over a
// 15 km curve, which makes the resample lumpy. 4000 gives under 4 m.
curve.arcLengthDivisions = 4000;

// Resampled polyline. Everything downstream — nearest-point lookups, the road mesh,
// station placement — reads these instead of evaluating the spline.
export const samples = [];
{
  const total = curve.getLength();
  const n = Math.ceil(total / SAMPLE);
  for (let i = 0; i <= n; i++) {
    const p = curve.getPointAt(i / n);
    const tan = curve.getTangentAt(i / n);
    // Right-hand normal in the XZ plane; the road never banks, so Y is ignored here.
    const rx = tan.z, rz = -tan.x;
    const rl = Math.hypot(rx, rz) || 1;
    samples.push({ x: p.x, y: p.y, z: p.z, rx: rx / rl, rz: rz / rl, d: (i / n) * total });
  }
}
export const ROAD_LENGTH = samples[samples.length - 1].d;

const gridKey = (cx, cz) => (cx + 4096) * 8192 + (cz + 4096);
const grid = new Map();
for (let i = 0; i < samples.length; i++) {
  const s = samples[i];
  const k = gridKey(Math.floor(s.x / CELL), Math.floor(s.z / CELL));
  let bucket = grid.get(k);
  if (!bucket) grid.set(k, (bucket = []));
  bucket.push(i);
}

const MAX_RING = 20;

// Nearest point on the road to (x, z). Called once per terrain vertex, so it walks
// the spatial hash outward a ring at a time rather than the whole polyline.
//
// It must stay correct at ANY distance, not just near the road: terrain shape is a
// function of how far from the road you are, all the way out to the cliffs at 1.25 km.
// A fixed 3x3 search reported anything past one cell as infinitely far, which put a
// sheer 420 m step across arbitrary cell boundaries in open country.
export function nearest(x, z) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  let best = -1, bestD2 = Infinity;

  const consider = (bucket) => {
    for (let j = 0; j < bucket.length; j++) {
      const s = samples[bucket[j]];
      const dx = x - s.x, dz = z - s.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; best = bucket[j]; }
    }
  };

  for (let ring = 0; ring <= MAX_RING; ring++) {
    if (ring === 0) {
      const b = grid.get(gridKey(cx, cz));
      if (b) consider(b);
    } else {
      // Perimeter only — the interior was covered by earlier rings.
      for (let o = -ring; o <= ring; o++) {
        for (const [gx, gz] of [
          [cx + o, cz - ring], [cx + o, cz + ring],
          [cx - ring, cz + o], [cx + ring, cz + o],
        ]) {
          const b = grid.get(gridKey(gx, gz));
          if (b) consider(b);
        }
      }
    }
    // Every unscanned cell is at least ring*CELL away, so once the best candidate is
    // closer than that it cannot be beaten and the search is provably done.
    if (best >= 0 && bestD2 <= (ring * CELL) * (ring * CELL)) break;
  }

  // Only reachable past the ends of the road, where the closest point is an endpoint.
  if (best < 0) {
    const a = 0, b = samples.length - 1;
    const da = (x - samples[a].x) ** 2 + (z - samples[a].z) ** 2;
    const db = (x - samples[b].x) ** 2 + (z - samples[b].z) ** 2;
    best = da < db ? a : b;
  }

  // Refine onto the better of the two segments meeting at the nearest sample, so the
  // road edge is a straight line and not a scalloped chain of 5 m arcs.
  let bd = Infinity, by = 0, balong = 0, bside = 0;
  for (const [i0, i1] of [[best - 1, best], [best, best + 1]]) {
    if (i0 < 0 || i1 >= samples.length) continue;
    const a = samples[i0], b = samples[i1];
    const ex = b.x - a.x, ez = b.z - a.z;
    const len2 = ex * ex + ez * ez;
    const t = len2 ? clamp(((x - a.x) * ex + (z - a.z) * ez) / len2, 0, 1) : 0;
    const px = a.x + ex * t, pz = a.z + ez * t;
    const dx = x - px, dz = z - pz;
    const d = Math.hypot(dx, dz);
    if (d < bd) {
      bd = d;
      by = a.y + (b.y - a.y) * t;
      balong = a.d + (b.d - a.d) * t;
      bside = Math.sign(dx * (a.rx + b.rx) + dz * (a.rz + b.rz)) || 1;
    }
  }
  return { dist: bd, y: by, along: balong, index: best, side: bside };
}

// 1 on the tarmac, easing to 0 at the edge of the corridor. This is the weight that
// decides how far terrain is pulled toward the road — the reason a road can climb a
// mountain without the noise function fighting it.
export function corridorWeight(dist) {
  if (dist <= HALF_WIDTH + SHOULDER) return 1;
  if (dist >= CORRIDOR) return 0;
  const t = (dist - HALF_WIDTH - SHOULDER) / (CORRIDOR - HALF_WIDTH - SHOULDER);
  return 1 - t * t * (3 - 2 * t);
}

export function pointAt(along) {
  const i = clamp(Math.round(along / SAMPLE), 0, samples.length - 1);
  return samples[i];
}

// --- mesh -------------------------------------------------------------------
// Split out from the maths above so this module stays importable in plain node.

// Photographic asphalt (PolyHaven asphalt_02, CC0) with the lane markings painted
// onto the diffuse in a canvas once the photo arrives. Until then the canvas shows
// plain dark asphalt, so there is no pop from untextured to textured.
function asphaltTexture(res) {
  const W = 1024, H = 1024;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#2e2d2b';
  g.fillRect(0, 0, W, H);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;

  const img = new Image();
  img.onload = () => {
    g.drawImage(img, 0, 0, W, H);
    // Worn paint: edge lines and centre dashes at low opacity over the photo.
    g.globalAlpha = 0.8;
    g.strokeStyle = '#cfc9b4';
    g.lineWidth = 14;
    g.beginPath(); g.moveTo(52, 0); g.lineTo(52, H); g.stroke();
    g.beginPath(); g.moveTo(W - 52, 0); g.lineTo(W - 52, H); g.stroke();
    g.setLineDash([110, 96]);
    g.strokeStyle = '#d8d2bc';
    g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.stroke();
    g.globalAlpha = 1;
    tex.needsUpdate = true;
  };
  img.src = asset(`/tex/asphalt_02_diffuse_${res}.jpg`);
  return tex;
}

// The ribbon is four vertices per cross-section: shoulder, tarmac, tarmac, shoulder.
// Shoulders sit slightly lower so the road reads as laid on the ground, not floating.
export function buildRoadMesh(res = '1k') {
  const n = samples.length;
  const pos = new Float32Array(n * 4 * 3);
  const uv = new Float32Array(n * 4 * 2);
  const col = new Float32Array(n * 4 * 3);
  const idx = new Uint32Array((n - 1) * 3 * 6);
  const shoulderCol = new THREE.Color();

  const OUT = HALF_WIDTH + SHOULDER;
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const v = s.d / 14;
    const offs = [-OUT, -HALF_WIDTH, HALF_WIDTH, OUT];
    const drop = [-0.22, 0, 0, -0.22];
    const us = [0, 0.02, 0.98, 1];
    shoulderCol.setHex(0x6b6154, 'srgb');
    for (let k = 0; k < 4; k++) {
      const o = (i * 4 + k);
      pos[o * 3] = s.x + s.rx * offs[k];
      pos[o * 3 + 1] = s.y + drop[k] + 0.06;
      pos[o * 3 + 2] = s.z + s.rz * offs[k];
      uv[o * 2] = us[k];
      uv[o * 2 + 1] = v;
      const shoulder = k === 0 || k === 3;
      col[o * 3] = shoulder ? shoulderCol.r : 1;
      col[o * 3 + 1] = shoulder ? shoulderCol.g : 1;
      col[o * 3 + 2] = shoulder ? shoulderCol.b : 1;
    }
  }
  let w = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < 3; k++) {
      const a = i * 4 + k, b = a + 1, c = a + 4, d = a + 5;
      idx[w++] = a; idx[w++] = c; idx[w++] = b;
      idx[w++] = b; idx[w++] = c; idx[w++] = d;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();

  const loader = new THREE.TextureLoader();
  const rep = (t) => {
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  };
  const mat = new THREE.MeshStandardMaterial({
    map: asphaltTexture(res),
    normalMap: rep(loader.load(asset(`/tex/asphalt_02_nor_gl_${res}.jpg`))),
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughnessMap: rep(loader.load(asset(`/tex/asphalt_02_rough_${res}.jpg`))),
    vertexColors: true,
    roughness: 1.0,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = 'road';
  return mesh;
}
