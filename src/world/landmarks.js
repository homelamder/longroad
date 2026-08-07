import * as THREE from 'three';
import { elevation } from './terrain.js';
import { pointAt } from './road.js';
import { hash2 } from './rng.js';

// Hand-placed places: the Frostveil caves and the Ashen steam vents. These are the
// anchors tasks hang off — a cave is somewhere to spend the night, not a texture.

const rock = new THREE.MeshStandardMaterial({ color: 0x5d6068, roughness: 0.95 });
const rockDark = new THREE.MeshStandardMaterial({ color: 0x3c3f46, roughness: 1 });

// A dry rock shelter: two flank boulders, a slab roof, a back wall — open mouth
// facing the road. Big enough inside for the walker plus a fire.
function buildCave() {
  const g = new THREE.Group();
  const part = (geo, m, x, y, z, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(0, ry, rz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };

  part(new THREE.IcosahedronGeometry(2.6, 1), rock, -3.0, 1.4, 0);
  part(new THREE.IcosahedronGeometry(2.4, 1), rock, 3.1, 1.3, 0);
  part(new THREE.IcosahedronGeometry(2.9, 1), rockDark, 0, 1.2, -2.9);      // back wall
  const roof = part(new THREE.BoxGeometry(8.4, 1.1, 6.4), rock, 0, 3.6, -0.6, 0, 0.04);
  roof.rotation.x = -0.06;
  part(new THREE.IcosahedronGeometry(1.1, 0), rockDark, -2.2, 0.4, 2.2);    // threshold stones
  part(new THREE.IcosahedronGeometry(0.8, 0), rockDark, 2.5, 0.3, 2.5);
  return g;
}

// Cave sites: distances along the road in Frostveil, uphill side, near enough to
// see from the tarmac. Deterministic and exported — the night task teleports here.
export const CAVE_SITES = [9350, 10180, 10620];

// Ashen steam vents: a rough basalt cone with an emissive throat; the steam itself
// is particles from the shared wisp system below.
function buildVent() {
  const g = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(1.7, 1.6, 9), rockDark);
  cone.position.y = 0.8;
  cone.castShadow = true;
  cone.receiveShadow = true;
  const throat = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.7, 0.3, 9),
    new THREE.MeshStandardMaterial({
      color: 0x2a2424, emissive: 0xff5a1e, emissiveIntensity: 0.9, roughness: 0.8,
    }),
  );
  throat.position.y = 1.55;
  g.add(cone, throat);
  return g;
}

export const VENT_SITES = [13150, 13400, 13720, 14050, 14380, 14700];

// Slow white wisps rising from the vents — same recycled-Points pattern as tyre
// dust, tuned for buoyant smoke.
const MAX_WISPS = 160;

const WISP_VERT = `
attribute float aLife;
attribute float aSize;
varying float vLife;
void main() {
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (1.0 + (1.0 - aLife) * 3.2) * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const WISP_FRAG = `
varying float vLife;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d);
  if (r > 0.25) discard;
  float soft = 1.0 - smoothstep(0.04, 0.25, r);
  gl_FragColor = vec4(vec3(0.82, 0.8, 0.78), soft * vLife * 0.30);
}`;

export class Landmarks {
  constructor(scene) {
    this.caves = CAVE_SITES.map((along, i) => {
      const p = pointAt(along);
      const side = i % 2 ? 1 : -1;
      const dist = 26 + hash2(i, 3) * 14;
      const x = p.x + p.rx * side * dist, z = p.z + p.rz * side * dist;
      const y = elevation(x, z);
      const mesh = buildCave();
      mesh.position.set(x, y, z);
      // Mouth toward the road.
      mesh.rotation.y = Math.atan2(p.x - x, p.z - z);
      scene.add(mesh);
      // The spot inside where a fire can live, in world space.
      const mouth = new THREE.Vector3(0, 0, 0.6).applyEuler(mesh.rotation).add(mesh.position);
      return { along, x, y, z, mesh, hearth: mouth };
    });

    this.vents = VENT_SITES.map((along, i) => {
      const p = pointAt(along);
      const side = i % 2 ? -1 : 1;
      const dist = 18 + hash2(i, 9) * 30;
      const x = p.x + p.rx * side * dist, z = p.z + p.rz * side * dist;
      const y = elevation(x, z);
      const mesh = buildVent();
      mesh.position.set(x, y, z);
      scene.add(mesh);
      return { x, y, z, timer: hash2(i, 13) * 2 };
    });

    // Shared wisp pool.
    const pos = new Float32Array(MAX_WISPS * 3);
    const life = new Float32Array(MAX_WISPS);
    const size = new Float32Array(MAX_WISPS);
    this.vel = new Float32Array(MAX_WISPS * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      vertexShader: WISP_VERT, fragmentShader: WISP_FRAG,
      transparent: true, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    this.points.name = 'steam';
    scene.add(this.points);
    this.pos = pos; this.life = life; this.size = size;
    this.next = 0;
  }

  update(dt, playerPos) {
    // Vents puff only when the player is near enough to ever see it.
    for (const v of this.vents) {
      const dx = v.x - playerPos.x, dz = v.z - playerPos.z;
      if (dx * dx + dz * dz > 420 * 420) continue;
      v.timer -= dt;
      if (v.timer <= 0) {
        v.timer = 0.14 + Math.random() * 0.2;
        const i = this.next;
        this.next = (this.next + 1) % MAX_WISPS;
        this.pos[i * 3] = v.x + (Math.random() - 0.5) * 0.5;
        this.pos[i * 3 + 1] = v.y + 1.6;
        this.pos[i * 3 + 2] = v.z + (Math.random() - 0.5) * 0.5;
        this.vel[i * 3] = (Math.random() - 0.5) * 0.5;
        this.vel[i * 3 + 1] = 1.6 + Math.random() * 1.2;
        this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
        this.life[i] = 1;
        this.size[i] = 1.4 + Math.random() * 1.4;
      }
    }

    let any = false;
    for (let i = 0; i < MAX_WISPS; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt / 3.4;
      if (this.life[i] < 0) { this.life[i] = 0; continue; }
      this.vel[i * 3 + 1] *= 1 - 0.12 * dt;
      this.pos[i * 3] += (this.vel[i * 3] + Math.sin(this.life[i] * 9) * 0.3) * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.points.visible = any;
    if (any) {
      this.points.geometry.getAttribute('position').needsUpdate = true;
      this.points.geometry.getAttribute('aLife').needsUpdate = true;
      this.points.geometry.getAttribute('aSize').needsUpdate = true;
    }
  }

  nearestCave(pos) {
    let best = null, bd = Infinity;
    for (const c of this.caves) {
      const d = Math.hypot(c.x - pos.x, c.z - pos.z);
      if (d < bd) { bd = d; best = c; }
    }
    return { cave: best, dist: bd };
  }
}
