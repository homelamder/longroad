import * as THREE from 'three';
import { biomeAt, JOURNEY } from './biomes.js';
import { clamp, lerp } from './rng.js';

// Weather. Each region has tendencies — Whisper Falls rains, Emberfall blows dust,
// Frostveil blizzards — and the active state changes on a slow timer. Weather is not
// decoration: it moves grip and sight lines, which is where the driving difficulty
// of the later regions comes from.
//
//   grip: multiplier on tyre hold      vis: multiplier on fog distances
//   wind: grass sway + particle drift  fall/drift: particle velocity
export const STATES = {
  clear: { grip: 1.0, vis: 1.0, wind: 0.14, count: 0 },
  mist: { grip: 0.96, vis: 0.34, wind: 0.10, count: 0 },
  rain: { grip: 0.78, vis: 0.55, wind: 0.26, count: 1100, fall: 34, drift: 3, size: 3.2, tint: 0xa8c4d8, alpha: 0.55, streak: true },
  storm: { grip: 0.66, vis: 0.38, wind: 0.42, count: 1500, fall: 46, drift: 8, size: 3.6, tint: 0x93b0c6, alpha: 0.65, streak: true },
  dust: { grip: 0.9, vis: 0.42, wind: 0.5, count: 900, fall: 1.5, drift: 26, size: 4.2, tint: 0xd8b07c, alpha: 0.34 },
  snow: { grip: 0.72, vis: 0.5, wind: 0.2, count: 800, fall: 3.2, drift: 4, size: 2.4, tint: 0xf4f7fc, alpha: 0.75 },
  blizzard: { grip: 0.58, vis: 0.24, wind: 0.5, count: 1500, fall: 7, drift: 18, size: 2.6, tint: 0xeef3fa, alpha: 0.8 },
  ashfall: { grip: 0.92, vis: 0.5, wind: 0.16, count: 550, fall: 1.6, drift: 5, size: 2.2, tint: 0x8f8a86, alpha: 0.5 },
};

// What each region's sky tends to do: [state, weight] pairs.
const TENDENCY = {
  verdant: [['clear', 5], ['rain', 1]],
  duskwood: [['clear', 3], ['mist', 3], ['rain', 1]],
  emberfall: [['clear', 4], ['dust', 3]],
  whisper: [['rain', 3], ['clear', 2], ['storm', 2], ['mist', 1]],
  frostveil: [['snow', 3], ['clear', 2], ['blizzard', 2]],
  marsh: [['mist', 4], ['clear', 2], ['rain', 1]],
  ashen: [['ashfall', 4], ['clear', 2]],
};

const HOLD = [45, 100];              // seconds a state lasts before rerolling

const VERT = `
attribute float aSeed;
uniform float uTime;
uniform float uFall;
uniform float uDrift;
uniform float uSize;
uniform vec3 uCentre;
uniform float uRange;
varying float vFade;
void main() {
  // Particles live on an infinite wrapping grid around the camera; each one falls
  // and drifts by time + seed, then wraps into the box. No per-frame CPU work.
  vec3 p = position;
  float t = uTime + aSeed * 97.0;
  p.y -= t * uFall * (0.8 + aSeed * 0.4);
  p.x += t * uDrift * (0.7 + aSeed * 0.6) + sin(t * 1.3 + aSeed * 40.0) * 1.5;
  p.z += sin(t * 0.9 + aSeed * 23.0) * uDrift * 0.2;
  p = mod(p - uCentre + uRange * 0.5, uRange) - uRange * 0.5 + uCentre;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  vFade = (1.0 - smoothstep(uRange * 0.32, uRange * 0.5, d)) * smoothstep(1.5, 6.0, d);
  gl_PointSize = uSize * (140.0 / d);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = `
uniform vec3 uTint;
uniform float uAlpha;
uniform float uStreak;
varying float vFade;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float soft;
  if (uStreak > 0.5) {
    // Rain is not a dot: mask the sprite to a thin vertical bar and let the fall
    // speed do the rest. A moving streak reads as rain at any framerate.
    if (abs(c.x) > 0.09) discard;
    soft = (1.0 - smoothstep(0.06, 0.5, abs(c.y))) * (1.0 - smoothstep(0.03, 0.09, abs(c.x)));
  } else {
    float r = dot(c, c);
    if (r > 0.25) discard;
    soft = 1.0 - smoothstep(0.02, 0.25, r);
  }
  gl_FragColor = vec4(uTint, soft * uAlpha * vFade);
}`;

const MAX = 1500;
const RANGE = 70;

export class Weather {
  constructor(scene) {
    this.state = STATES.clear;
    this.stateName = 'clear';
    this.pending = null;
    this.blend = 1;                    // 0..1 into the pending state
    this.hold = 20;
    // Live, blended outputs the rest of the game reads.
    this.grip = 1;
    this.vis = 1;
    this.wind = 0.14;

    const pos = new Float32Array(MAX * 3);
    const seed = new Float32Array(MAX);
    for (let i = 0; i < MAX; i++) {
      pos[i * 3] = (Math.random() - 0.5) * RANGE;
      pos[i * 3 + 1] = (Math.random() - 0.5) * RANGE;
      pos[i * 3 + 2] = (Math.random() - 0.5) * RANGE;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.uniforms = {
      uTime: { value: 0 },
      uFall: { value: 0 },
      uDrift: { value: 0 },
      uSize: { value: 2 },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uAlpha: { value: 0 },
      uStreak: { value: 0 },
      uCentre: { value: new THREE.Vector3() },
      uRange: { value: RANGE },
    };
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.name = 'weather';
    scene.add(this.points);
  }

  roll(along) {
    const here = biomeAt(clamp(along, 0, JOURNEY)).a.id;
    const pool = TENDENCY[here];
    let total = 0;
    for (const [, w] of pool) total += w;
    let pick = Math.random() * total;
    for (const [name, w] of pool) {
      pick -= w;
      if (pick <= 0) return name;
    }
    return 'clear';
  }

  set(name, instant = false) {
    if (name === this.stateName && !this.pending) return;
    this.pending = name;
    if (instant) {
      this.finish();
      this.blend = 1;
      // Snap the blended outputs too — an "instant" storm that keeps clear-air fog
      // for the next four seconds is not instant, and screenshots depend on this.
      this.grip = this.state.grip;
      this.vis = this.state.vis;
      this.wind = this.state.wind;
    } else this.blend = 0;
  }

  finish() {
    this.stateName = this.pending;
    this.state = STATES[this.pending];
    this.pending = null;
  }

  update(dt, camPos, along) {
    this.hold -= dt;
    if (this.hold <= 0 && !this.pending) {
      this.hold = HOLD[0] + Math.random() * (HOLD[1] - HOLD[0]);
      const next = this.roll(along);
      if (next !== this.stateName) this.set(next);
    }

    // Crossfade toward the pending state; outputs blend, particles swap at midpoint.
    let target = this.state;
    if (this.pending) {
      this.blend = Math.min(1, this.blend + dt / 4.5);
      target = STATES[this.pending];
      if (this.blend >= 0.5 && this.state !== target) this.finish();
      if (this.blend >= 1) this.pending = null;
    }
    const k = Math.min(1, dt * 1.2);
    this.grip = lerp(this.grip, target.grip, k);
    this.vis = lerp(this.vis, target.vis, k);
    this.wind = lerp(this.wind, target.wind, k);

    const s = this.state;
    const active = s.count > 0;
    this.points.visible = active;
    if (active) {
      const u = this.uniforms;
      u.uTime.value += dt;
      u.uFall.value = s.fall;
      u.uDrift.value = s.drift;
      u.uSize.value = s.size;
      u.uStreak.value = s.streak ? 1 : 0;
      u.uTint.value.setHex(s.tint, 'srgb');
      // Fade density in/out with the crossfade so weather arrives, not appears.
      const fadeIn = this.pending ? this.blend : 1;
      u.uAlpha.value = s.alpha * fadeIn;
      u.uCentre.value.copy(camPos);
      this.points.geometry.setDrawRange(0, Math.min(MAX, s.count));
    }
  }
}
