import * as THREE from 'three';
import { elevation } from './terrain.js';
import { VALLEY } from './valley.js';
import { hash2 } from './rng.js';

// The destination. Past the last metre of tarmac the land falls into a caldera
// valley the ash never reached — the answer to the journey's question. Everything
// here is built once, on demand, when the player is near the end of the road.

const GLOW_LEAF = 0x8fe07a;
const GLOW_BLUE = 0x6ac8e0;

export class Finale {
  constructor(scene, animals) {
    this.scene = scene;
    this.animals = animals;
    this.built = false;
    this.group = null;
    this.time = 0;
  }

  // Build lazily — nobody pays for the ending until they have nearly earned it.
  build() {
    if (this.built) return;
    this.built = true;
    const g = new THREE.Group();
    g.name = 'finale';
    const V = VALLEY;

    // The gate: two basalt pillars framing the last metres of road.
    for (const side of [-1, 1]) {
      const px = V.endX - V.dirZ * side * -8, pz = V.endZ + V.dirX * side * -8;
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(1.4, 2.2, 16, 7),
        new THREE.MeshStandardMaterial({ color: 0x2c2a2e, roughness: 0.95 }),
      );
      pillar.position.set(px, elevation(px, pz) + 7, pz);
      pillar.rotation.z = side * 0.05;
      pillar.castShadow = true;
      g.add(pillar);
    }

    // The lake at the valley floor.
    const lake = new THREE.Mesh(
      new THREE.CircleGeometry(150, 40),
      new THREE.MeshStandardMaterial({
        color: 0x14343c, roughness: 0.05, metalness: 0.65,
        transparent: true, opacity: 0.94,
      }),
    );
    lake.rotation.x = -Math.PI / 2;
    lake.position.set(V.x, V.floorY + 0.4, V.z);
    g.add(lake);
    this.lake = lake;

    // The stone circle on the overlook where the journey formally ends.
    const overlook = {
      x: V.x - V.dirX * 260, z: V.z - V.dirZ * 260,
    };
    overlook.y = elevation(overlook.x, overlook.z);
    this.overlook = overlook;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const st = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 2.2 + hash2(i, 3) * 0.8, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x4a4a52, roughness: 0.9 }),
      );
      const sx = overlook.x + Math.cos(a) * 7, sz = overlook.z + Math.sin(a) * 7;
      st.position.set(sx, elevation(sx, sz) + 1.0, sz);
      st.rotation.y = -a;
      st.castShadow = true;
      g.add(st);
    }

    // Glowing flora: instanced luminous reeds and moss-lamps around the basin.
    const glowMat = new THREE.MeshStandardMaterial({
      color: 0x2a4a2e, emissive: GLOW_LEAF, emissiveIntensity: 1.4, roughness: 0.8,
    });
    const blueMat = new THREE.MeshStandardMaterial({
      color: 0x24404c, emissive: GLOW_BLUE, emissiveIntensity: 1.2, roughness: 0.8,
    });
    const reed = new THREE.ConeGeometry(0.14, 1.7, 5);
    const lampG = new THREE.IcosahedronGeometry(0.32, 0);
    const reeds = new THREE.InstancedMesh(reed, glowMat, 420);
    const lamps = new THREE.InstancedMesh(lampG, blueMat, 200);
    const m = new THREE.Matrix4();
    let ri = 0, li = 0;
    for (let i = 0; i < 900 && (ri < 420 || li < 200); i++) {
      const a = hash2(i, 11) * Math.PI * 2;
      const r = 130 + hash2(i, 13) * (V.r * 0.72 - 130);
      const x = V.x + Math.cos(a) * r, z = V.z + Math.sin(a) * r;
      const y = elevation(x, z);
      if (y < V.floorY + 0.5) continue;              // not in the lake
      const s = 0.7 + hash2(i, 17) * 0.9;
      m.makeScale(s, s, s).setPosition(x, y + 0.7 * s, z);
      if (hash2(i, 19) < 0.68) { if (ri < 420) reeds.setMatrixAt(ri++, m); }
      else if (li < 200) { m.setPosition(x, y + 0.3 * s, z); lamps.setMatrixAt(li++, m); }
    }
    reeds.count = ri; lamps.count = li;
    reeds.instanceMatrix.needsUpdate = lamps.instanceMatrix.needsUpdate = true;
    g.add(reeds, lamps);

    // Fireflies over the water: one Points cloud orbiting slow.
    const N = 240;
    const fPos = new Float32Array(N * 3);
    const fSeed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      fSeed[i] = Math.random();
      fPos[i * 3] = V.x; fPos[i * 3 + 1] = V.floorY + 2; fPos[i * 3 + 2] = V.z;
    }
    const fGeo = new THREE.BufferGeometry();
    fGeo.setAttribute('position', new THREE.BufferAttribute(fPos, 3));
    fGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(V.x, V.floorY, V.z), 600);
    this.flies = new THREE.Points(fGeo, new THREE.PointsMaterial({
      color: 0xd8f0a0, size: 0.5, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    this.flySeed = fSeed;
    g.add(this.flies);

    // Every animal of the road, gathered and unafraid.
    this.herds = [];
    const species = ['goat', 'sheep', 'deer', 'elk', 'fox', 'monkey', 'heron', 'tapir'];
    species.forEach((sp, i) => {
      const a = (i / species.length) * Math.PI * 2;
      const hx = V.x + Math.cos(a) * 190, hz = V.z + Math.sin(a) * 190;
      if (elevation(hx, hz) < V.floorY + 0.5) return;
      const herd = this.animals.spawnAt(sp, hx, hz, 3);
      herd.docile = true;
      this.herds.push(herd);
    });

    this.scene.add(g);
    this.group = g;
  }

  update(dt, playerPos) {
    const V = VALLEY;
    const near = Math.hypot(playerPos.x - V.x, playerPos.z - V.z) < V.r * 2.6;
    if (near && !this.built) this.build();
    if (!this.built || !near) return;

    this.time += dt;
    // Fireflies wander on seeded lissajous paths over the lake.
    const p = this.flies.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const s = this.flySeed[i];
      const t = this.time * (0.12 + s * 0.2) + s * 40;
      p.setXYZ(i,
        V.x + Math.sin(t) * (40 + s * 95),
        V.floorY + 1.4 + Math.sin(t * 2.7 + s * 9) * (1.2 + s * 2.4),
        V.z + Math.cos(t * 0.8 + s * 5) * (40 + s * 95));
    }
    p.needsUpdate = true;
  }

  release() {
    for (const h of this.herds || []) this.animals.release(h);
  }
}
