import * as THREE from 'three';
import { mixColor, JOURNEY } from '../world/biomes.js';
import { clamp } from '../world/rng.js';

// Whatever the tyres throw up. A fixed ring of particles recycled oldest-first —
// no allocation while driving, and the count is the hard ceiling on the cost.

const MAX = 260;
const LIFE = 1.25;

const VERT = `
attribute float aLife;
attribute float aSize;
attribute vec3 aTint;
varying float vLife;
varying vec3 vTint;
void main() {
  vLife = aLife;
  vTint = aTint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // Grows as it drifts, the way a real puff of dust expands behind a wheel.
  gl_PointSize = aSize * (1.0 + (1.0 - aLife) * 2.4) * (260.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = `
varying float vLife;
varying vec3 vTint;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d);
  if (r > 0.25) discard;
  float soft = 1.0 - smoothstep(0.06, 0.25, r);
  gl_FragColor = vec4(vTint, soft * vLife * 0.5);
}`;

export class Dust {
  constructor(scene) {
    const pos = new Float32Array(MAX * 3);
    const life = new Float32Array(MAX);
    const size = new Float32Array(MAX);
    const tint = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aLife', new THREE.BufferAttribute(life, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
    g.setDrawRange(0, MAX);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false,
      // fog: false deliberately. A raw ShaderMaterial that claims fog must also
      // declare three's fog uniforms and chunks, and dust never gets more than a few
      // metres from the car, so there is nothing for fog to do here anyway.
      fog: false,
      blending: THREE.NormalBlending,
    }));
    this.points.frustumCulled = false;
    this.points.name = 'dust';
    scene.add(this.points);

    this.geo = g;
    this.pos = pos; this.life = life; this.size = size; this.tint = tint;
    this.next = 0;
    this.budget = 0;
    this._c = new THREE.Color();
  }

  spawn(x, y, z, speed, colour, spray) {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y + 0.1;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = (Math.random() - 0.5) * 1.6;
    this.vel[i * 3 + 1] = 0.5 + Math.random() * (spray ? 2.2 : 1.1);
    this.vel[i * 3 + 2] = (Math.random() - 0.5) * 1.6;
    this.life[i] = 1;
    this.size[i] = (spray ? 0.5 : 0.85) + Math.random() * 0.9 + speed * 0.02;
    this.tint[i * 3] = colour.r;
    this.tint[i * 3 + 1] = colour.g;
    this.tint[i * 3 + 2] = colour.b;
  }

  update(dt, car) {
    const speed = Math.abs(car.speed);

    // Tarmac barely raises anything; loose ground raises a lot. Sliding sideways
    // raises more than either, which is what makes a drift read.
    const loose = 1 - car.surface;
    const slide = clamp(Math.abs(car.lateral) / 7, 0, 1);
    const rate = speed > 2.5 ? (loose * 34 + slide * 26) * clamp(speed / 18, 0, 1) : 0;

    this.budget += rate * dt;
    if (this.budget >= 1) {
      mixColor(clamp(car.pos.z, 0, JOURNEY), 'soil', this._c);
      this._c.lerp({ r: 1, g: 1, b: 1 }, 0.28);       // dust is paler than the soil
      const f = car.forward(), r = car.right();
      const hb = car.spec.wheelBase * 0.5, ht = car.spec.track * 0.5;
      while (this.budget >= 1) {
        this.budget -= 1;
        const side = Math.random() < 0.5 ? -1 : 1;
        this.spawn(
          car.pos.x - f.x * hb + r.x * ht * side,
          car.pos.y - car.spec.rideHeight,
          car.pos.z - f.z * hb + r.z * ht * side,
          speed, this._c, slide > 0.3,
        );
      }
    }

    let any = false;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt / LIFE;
      if (this.life[i] < 0) { this.life[i] = 0; continue; }
      this.vel[i * 3 + 1] -= 1.4 * dt;                 // settles back down
      this.vel[i * 3] *= 1 - 1.6 * dt;
      this.vel[i * 3 + 2] *= 1 - 1.6 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }

    this.points.visible = any;
    if (!any) return;
    this.geo.getAttribute('position').needsUpdate = true;
    this.geo.getAttribute('aLife').needsUpdate = true;
    this.geo.getAttribute('aSize').needsUpdate = true;
    this.geo.getAttribute('aTint').needsUpdate = true;
  }
}
