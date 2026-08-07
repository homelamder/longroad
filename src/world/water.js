import * as THREE from 'three';
import { elevation } from './terrain.js';
import { pointAt, nearest } from './road.js';
import { hash2, clamp } from './rng.js';

// Mirror Marsh's water: still pools that reflect the sky. Real planar reflection
// would double the render cost of the whole scene; a fresnel blend into the live
// sky-horizon colour reads as "mirror" at the grazing angles a driver actually sees
// the pools from, for the price of one flat disc each.

const MARSH = [11650, 12860];
const SITES = 30;

const VERT = `
varying vec3 vWorld;
varying vec3 vView;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  // Named mvPosition because three's fog_vertex chunk reads exactly that name.
  vec4 mvPosition = viewMatrix * wp;
  vView = -mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = `
uniform vec3 uDeep;
uniform vec3 uSky;
uniform float uTime;
varying vec3 vWorld;
varying vec3 vView;
#include <fog_pars_fragment>
void main() {
  // Gentle moving ripple bends the normal a touch, so the "mirror" shimmers.
  float r1 = sin(vWorld.x * 0.7 + uTime * 0.9) * sin(vWorld.z * 0.6 - uTime * 0.7);
  float r2 = sin(vWorld.x * 2.3 - uTime * 1.7) * 0.3;
  vec3 n = normalize(vec3((r1 + r2) * 0.04, 1.0, (r1 - r2) * 0.04));
  vec3 v = normalize(vView);
  float fresnel = pow(1.0 - max(dot(n, v), 0.0), 2.2);
  vec3 col = mix(uDeep, uSky, clamp(fresnel * 1.15, 0.0, 1.0));
  gl_FragColor = vec4(col, 0.92);
  #include <fog_fragment>
}`;

export class MarshWater {
  constructor(scene, sky) {
    // Deterministic pool sites: off-road spots where the ground is locally flat.
    // The pool sits slightly under its lowest sampled point so edges never float.
    const discs = [];
    for (let i = 0; i < SITES; i++) {
      const along = MARSH[0] + (i / SITES) * (MARSH[1] - MARSH[0]) + hash2(i, 5) * 60;
      const p = pointAt(along);
      const side = hash2(i, 17) < 0.5 ? -1 : 1;
      const dist = 26 + hash2(i, 29) * 130;
      const x = p.x + p.rx * side * dist, z = p.z + p.rz * side * dist;
      if (nearest(x, z).dist < 18) continue;

      const r = 12 + hash2(i, 41) * 22;
      // Nine samples INCLUDING the centre — ring-only sampling missed centre bumps
      // and buried every pool under its own middle. The median puts half the disc
      // underwater and lets tussocks break the surface, which is what a marsh is.
      const ys = [elevation(x, z)];
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        ys.push(elevation(x + Math.cos(a) * r * 0.8, z + Math.sin(a) * r * 0.8));
      }
      ys.sort((a, b) => a - b);
      if (ys[8] - ys[0] > 5) continue;               // genuinely broken ground only
      discs.push({ x, y: ys[4] + 0.22, z, r });
    }

    // One merged geometry: all pools, one draw call.
    const pos = [], idx = [];
    let base = 0;
    const SEG = 18;
    for (const d of discs) {
      pos.push(d.x, d.y, d.z);
      for (let k = 0; k < SEG; k++) {
        const a = (k / SEG) * Math.PI * 2;
        pos.push(d.x + Math.cos(a) * d.r, d.y, d.z + Math.sin(a) * d.r);
        idx.push(base, base + 1 + k, base + 1 + ((k + 1) % SEG));
      }
      base += SEG + 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();

    this.uniforms = {
      uDeep: { value: new THREE.Color().setHex(0x1e3230, 'srgb') },
      uSky: { value: sky.uniforms.uHorizon.value },   // live reference — follows dawn/dusk
      uTime: { value: 0 },
      // three's fog chunks read these names; wire them to the scene fog each frame.
      fogColor: { value: scene.fog.color },
      fogNear: { value: scene.fog.near },
      fogFar: { value: scene.fog.far },
    };
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, fog: true, depthWrite: false,
    }));
    this.mesh.renderOrder = 2;
    this.mesh.name = 'marsh-water';
    scene.add(this.mesh);
    this.scene = scene;
    this.count = discs.length;
  }

  update(dt) {
    this.uniforms.uTime.value += dt;
    this.uniforms.fogNear.value = this.scene.fog.near;
    this.uniforms.fogFar.value = this.scene.fog.far;
  }
}
