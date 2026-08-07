import * as THREE from 'three';
import { elevation } from '../../world/terrain.js';

// Shared bits for task authors: materials, prop helpers, a scatter ring, and a
// countdown formatter. Tasks stay readable; this stays tiny.

export const WOOD = new THREE.MeshStandardMaterial({ color: 0x6b4f30, roughness: 0.9 });
export const STONE = new THREE.MeshStandardMaterial({ color: 0x76716a, roughness: 0.95 });

export function ring(cx, cz, n, rMin, rMax) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 1.1;
    const r = rMin + Math.random() * (rMax - rMin);
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    out.push({ x, y: elevation(x, z), z });
  }
  return out;
}

export function prop(scene, geo, mat, x, y, z, ry = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

export const secs = (t) => `${Math.max(0, Math.ceil(t))}s`;

// A small campfire the cave task and firewatch share: ring, logs, flame, light.
export function buildFire() {
  const g = new THREE.Group();
  const ringGeo = new THREE.TorusGeometry(0.9, 0.14, 6, 14);
  ringGeo.rotateX(Math.PI / 2);
  g.add(new THREE.Mesh(ringGeo, STONE));
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.5, 1.3, 7),
    new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.85 }),
  );
  flame.position.y = 0.8;
  flame.visible = false;
  const light = new THREE.PointLight(0xff9040, 0, 30, 1.6);
  light.position.y = 1.4;
  g.add(flame, light);
  g.userData = { flame, light, logs: 0 };
  return g;
}

export function addLog(fire) {
  const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 1.3, 6), WOOD);
  log.rotation.set(Math.PI / 2, 0, ++fire.userData.logs * 1.1);
  log.position.y = 0.14 + fire.userData.logs * 0.07;
  fire.add(log);
}

export function setFireLit(fire, lit, t = 0) {
  const { flame, light } = fire.userData;
  flame.visible = lit;
  if (lit) {
    flame.scale.setScalar(1 + Math.sin(t * 11) * 0.12);
    light.intensity = 15 + Math.sin(t * 9) * 3.5;
  } else {
    light.intensity = 0;
  }
}
