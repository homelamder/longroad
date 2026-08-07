import * as THREE from 'three';
import { pointAt } from '../world/road.js';
import { elevation } from '../world/terrain.js';
import { BIOMES } from '../world/biomes.js';

// Fuel stops. No buildings in this world, so a station is a roadside waypoint: a
// carved-log canopy on poles, a hand pump, a lantern — something a ranger service
// might leave in wild country.

// One at the start of each region's leg plus one midway through it. The first
// station sits a short drive in so the loop teaches itself before fuel matters.
export const STATION_POSITIONS = (() => {
  const out = [450];
  let start = 0;
  for (const b of BIOMES) {
    const mid = (start + b.end) / 2;
    if (mid > 600) out.push(Math.round(mid));
    if (b.end < 14800) out.push(Math.round(b.end - 120));
    start = b.end;
  }
  return [...new Set(out)].sort((a, b) => a - b);
})();

export const STATION_RADIUS = 14;        // how close the car must stop

const wood = new THREE.MeshStandardMaterial({ color: 0x6d5638, roughness: 0.85 });
const woodDark = new THREE.MeshStandardMaterial({ color: 0x4e3d28, roughness: 0.9 });
const metal = new THREE.MeshStandardMaterial({ color: 0x8d2f26, roughness: 0.5, metalness: 0.5 });
const lampMat = new THREE.MeshStandardMaterial({
  color: 0xfff2c8, emissive: 0xffdf90, emissiveIntensity: 0.4,
});

function stationMesh() {
  const g = new THREE.Group();
  const box = (geo, m, x, y, z, ry = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };

  // Canopy on four poles over a plank platform.
  const pole = new THREE.CylinderGeometry(0.14, 0.17, 4.2, 7);
  for (const [x, z] of [[-2.6, -2.2], [2.6, -2.2], [-2.6, 2.2], [2.6, 2.2]]) {
    box(pole, wood, x, 2.1, z);
  }
  box(new THREE.BoxGeometry(6.6, 0.22, 5.6), woodDark, 0, 4.25, 0).rotation.z = 0.045;
  box(new THREE.BoxGeometry(6.2, 0.12, 5.0), wood, 0, 0.06, 0);

  // The pump: a barrel with a crank and a hose arch.
  box(new THREE.CylinderGeometry(0.5, 0.55, 1.5, 10), metal, 1.6, 0.75, 0);
  box(new THREE.CylinderGeometry(0.07, 0.07, 1.1, 6), woodDark, 1.6, 1.7, 0).rotation.z = 1.2;
  const lamp = box(new THREE.SphereGeometry(0.16, 8, 6), lampMat, -2.6, 4.0, -2.2);
  lamp.castShadow = false;

  // A carved waymarker so the stop is visible from a distance.
  box(new THREE.BoxGeometry(0.3, 3.4, 0.3), wood, -3.4, 1.7, 2.6);
  box(new THREE.BoxGeometry(1.5, 0.5, 0.12), woodDark, -2.9, 2.9, 2.6, 0.1);

  g.userData.lamp = lampMat;
  return g;
}

export class Stations {
  constructor(scene) {
    this.list = STATION_POSITIONS.map((along, i) => {
      const p = pointAt(along);
      // Off the shoulder on the right-hand side, sitting on real ground.
      const x = p.x + p.rx * 12, z = p.z + p.rz * 12;
      const y = elevation(x, z);
      const mesh = stationMesh();
      mesh.position.set(x, y, z);
      mesh.rotation.y = Math.atan2(p.rx, p.rz) + Math.PI / 2;
      scene.add(mesh);
      return { index: i, along, x, y, z, mesh, used: false };
    });
    this._lampLit = null;
  }

  // The station you are close enough to use, if any.
  near(pos) {
    for (const s of this.list) {
      const dx = pos.x - s.x, dz = pos.z - s.z;
      if (dx * dx + dz * dz < STATION_RADIUS * STATION_RADIUS) return s;
    }
    return null;
  }

  next(along) {
    for (const s of this.list) if (s.along > along + 40) return s;
    return null;
  }

  setNight(night) {
    if (night === this._lampLit) return;
    this._lampLit = night;
    for (const s of this.list) s.mesh.userData.lamp.emissiveIntensity = night ? 2.2 : 0.4;
  }
}
