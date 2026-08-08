import * as THREE from 'three';
import { JOURNEY, biomeAt, mixColor, mixField } from './biomes.js';
import { nearest } from './road.js';
import { elevation } from './terrain.js';
import { hash2, clamp, lerp } from './rng.js';

// The near-field grass. Separate from scatter.js because it obeys different rules:
// far denser, far shorter-lived, and it only ever exists in a bubble around the car.
//
// Placement is cached per 16 m cell as ready-made matrix elements, so crossing a cell
// boundary is a typed-array copy rather than twenty thousand ground samples.

const CELL = 16;
const STRIDE = 16 + 3;         // 16 matrix elements + rgb

// Tufts per square metre, and how tall they stand. Both matter together: tall and
// sparse reads as a field of individual bushes, short and dense reads as grass.
// Bare rock and ash get none.
const DENSITY = {
  verdant: 1.9, duskwood: 0.9, emberfall: 0.12,
  whisper: 1.2, frostveil: 0.15, marsh: 1.5, ashen: 0,
};
const HEIGHT = {
  verdant: 0.38, duskwood: 0.3, emberfall: 0.26,
  whisper: 0.45, frostveil: 0.22, marsh: 0.6, ashen: 0.2,
};

// Two crossed tapered quads. A single quad is half the triangles but goes invisible
// edge-on, and with the camera swinging behind a car that reads as grass flickering.
// A painted cluster of curved blades: dark rooted, light tipped. On alphaTest
// cards this reads as real grass at a fraction of the cost of geometry blades.
export function bladeTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let b = 0; b < 11; b++) {
    const rootX = 12 + rnd() * 104;
    const lean = (rnd() - 0.5) * 60;
    const h = 150 + rnd() * 100;
    const w = 5 + rnd() * 7;
    const grad = g.createLinearGradient(0, 256, 0, 256 - h);
    grad.addColorStop(0, '#2a3d14');
    grad.addColorStop(0.55, '#4a6420');
    grad.addColorStop(1, '#8aa348');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(rootX - w / 2, 256);
    g.quadraticCurveTo(rootX - w / 2 + lean * 0.4, 256 - h * 0.6, rootX + lean, 256 - h);
    g.quadraticCurveTo(rootX + w / 2 + lean * 0.4, 256 - h * 0.6, rootX + w / 2, 256);
    g.closePath();
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function tuftGeometry() {
  const pos = [], nor = [], uv = [], idx = [];
  const quad = (ax) => {
    const base = pos.length / 3;
    const hw = 0.26, tw = 0.22, h = 1;
    const cx = Math.cos(ax), sx = Math.sin(ax);
    const p = (x, y) => pos.push(x * cx, y, x * sx);
    p(-hw, 0); p(hw, 0); p(tw, h); p(-tw, h);
    for (let i = 0; i < 4; i++) nor.push(0, 1, 0);       // lit as ground, not as a wall
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  quad(0); quad(Math.PI / 2);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export class Grass {
  constructor({ quality }) {
    this.q = quality;
    this.radius = quality.grassRadius;
    this.cap = quality.grassBlades;
    this.cells = new Map();
    this.lastCell = '';
    this.time = 0;

    const mat = new THREE.MeshStandardMaterial({
      // NOT vertexColors. The tuft geometry carries no colour attribute, and asking
      // for one that does not exist leaves the shader reading an unbound attribute —
      // which is zero, so every blade renders pure black. instanceColor alone drives
      // the colour here, and three applies it whether or not vertex colours are on.
      // The painted blade cluster does the realism; alphaTest keeps it unsorted.
      map: bladeTexture(),
      alphaTest: 0.42,
      roughness: 0.94, metalness: 0,
      side: THREE.DoubleSide,
    });
    this.uniforms = { uTime: { value: 0 }, uWind: { value: 0.14 }, uFade: { value: this.radius } };
    // Patching the standard material rather than writing one keeps shadows, fog and
    // tone mapping for free — all this needs to add is the sway.
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.uniforms.uWind = this.uniforms.uWind;
      shader.uniforms.uFade = this.uniforms.uFade;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime;
          uniform float uWind;
          uniform float uFade;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          // Sway scales with height up the blade, so the root stays planted.
          float lean = transformed.y;
          vec3 wpos = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
          float gust = sin(uTime * 1.15 + wpos.x * 0.045 + wpos.z * 0.032);
          float flick = sin(uTime * 3.4 + wpos.x * 0.31 - wpos.z * 0.19) * 0.32;
          transformed.x += (gust + flick) * lean * uWind;
          transformed.z += (gust * 0.55 - flick * 0.3) * lean * uWind;
          // Sink into the ground toward the edge of the bubble, so the grass has no
          // visible boundary — without this it ends in a hard ring around the car.
          transformed.y *= 1.0 - smoothstep(uFade * 0.68, uFade, distance(cameraPosition, wpos));`);
    };
    // Undo three's back-face normal flip. The tuft bakes an up normal so blades
    // light like the ground they grow from — but with DoubleSide, back faces get
    // the normal negated to point DOWN, and half of every crossed tuft goes black.
    mat.onBeforeCompile = ((prev) => (shader) => {
      prev(shader);
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        normal = normalize( vNormal );`,
      );
    })(mat.onBeforeCompile);
    mat.customProgramCacheKey = () => 'grass-sway';

    const mesh = new THREE.InstancedMesh(tuftGeometry(), mat, this.cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
    mesh.castShadow = false;       // 20k shadow-casting tufts for no visible gain
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.name = 'grass';
    this.mesh = mesh;

    this._c = new THREE.Color();
  }

  cellData(cx, cz) {
    const ox = cx * CELL, oz = cz * CELL;
    const { a, b, t } = biomeAt(clamp(oz + CELL / 2, 0, JOURNEY));
    const dens = lerp(DENSITY[a.id], DENSITY[b.id], t);
    if (dens <= 0.001) return new Float32Array(0);

    const n = Math.max(1, Math.round(CELL * Math.sqrt(dens)));
    const step = CELL / n;
    const rows = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const height = lerp(HEIGHT[a.id], HEIGHT[b.id], t);

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const gx = cx * 4096 + i, gz = cz * 4096 + j;
        const h1 = hash2(gx, gz), h2v = hash2(gx + 977, gz - 383);
        const x = ox + (i + h1) * step, z = oz + (j + h2v) * step;

        const r = nearest(x, z);
        if (r.dist < 7.5) continue;                    // not on the tarmac

        const y = elevation(x, z);
        if (y > mixField(clamp(z, 0, JOURNEY), 'snow') - 20) continue;

        // Grass will not grow on a steep face.
        const e = 1.6;
        const gxx = (elevation(x + e, z) - elevation(x - e, z)) / (2 * e);
        const gzz = (elevation(x, z + e) - elevation(x, z - e)) / (2 * e);
        if (Math.hypot(gxx, gzz) > 0.85) continue;

        const h3 = hash2(gx - 5501, gz + 7717), h4 = hash2(gx + 61, gz + 61);
        const tall = height * lerp(0.6, 1.5, h3);
        q.setFromAxisAngle(up, h4 * Math.PI * 2);
        m.compose(v.set(x, y, z), q, s.set(lerp(0.7, 1.3, h1), tall, lerp(0.7, 1.3, h2v)));
        for (let k = 0; k < 16; k++) rows.push(m.elements[k]);

        mixColor(clamp(z, 0, JOURNEY), 'grass', this._c);
        const shade = 0.78 + h3 * 0.3;   // painted cards carry their own depth now   // darker: blades sit IN the sward, not on it
        rows.push(this._c.r * shade, this._c.g * shade, this._c.b * shade);
      }
    }
    return new Float32Array(rows);
  }

  update(dt, px, pz, budget = 6) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;

    const ccx = Math.floor(px / CELL), ccz = Math.floor(pz / CELL);
    const span = Math.ceil(this.radius / CELL);
    const want = [];
    let missing = 0;
    for (let dz = -span; dz <= span; dz++) {
      for (let dx = -span; dx <= span; dx++) {
        if (dx * dx + dz * dz > span * span) continue;     // circular, not square
        const cx = ccx + dx, cz = ccz + dz;
        const k = (cx + 65536) * 200000 + (cz + 65536);
        want.push({ k, cx, cz, d: dx * dx + dz * dz });
        if (!this.cells.has(k)) missing++;
      }
    }

    if (missing) {
      want.sort((a, b) => a.d - b.d);
      let done = 0;
      for (const w of want) {
        if (done >= budget) break;
        if (this.cells.has(w.k)) continue;
        this.cells.set(w.k, this.cellData(w.cx, w.cz));
        done++;
      }
      if (this.cells.size > span * span * 12) {
        const keep = new Set(want.map((w) => w.k));
        for (const k of this.cells.keys()) {
          if (!keep.has(k)) this.cells.delete(k);
          if (this.cells.size <= span * span * 6) break;
        }
      }
    }

    const sig = `${ccx},${ccz},${missing}`;
    if (sig === this.lastCell) return;
    this.lastCell = sig;

    const mat = this.mesh.instanceMatrix.array;
    const col = this.mesh.instanceColor.array;
    let n = 0;
    for (const w of want) {
      const data = this.cells.get(w.k);
      if (!data) continue;
      for (let i = 0; i + STRIDE <= data.length; i += STRIDE) {
        if (n >= this.cap) break;
        for (let k = 0; k < 16; k++) mat[n * 16 + k] = data[i + k];
        col[n * 3] = data[i + 16]; col[n * 3 + 1] = data[i + 17]; col[n * 3 + 2] = data[i + 18];
        n++;
      }
      if (n >= this.cap) break;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }

  setWind(v) { this.uniforms.uWind.value = v; }
}
