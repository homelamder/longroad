import * as THREE from 'three';
import { mixColor, mixField, JOURNEY } from './biomes.js';
import { clamp, lerp, smoothstep } from './rng.js';

// Sky, sun and the passage of the day.
//
// time is 0..1 over one full cycle: 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset.
// Everything else — light colour, light strength, fog, how many stars — is derived
// from where the sun is, so there is exactly one thing to move and no chance of the
// lighting disagreeing with the sky behind it.

export const DAY_LENGTH = 20 * 60;      // seconds of real time per in-game day

const VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunTint;
uniform vec3 uSunDir;
uniform float uDay;        // 1 full daylight, 0 full night
uniform float uStars;
varying vec3 vDir;

// Cheap stable hash for the star field. Real points would be thousands of draw
// calls for something the player sees through fog for two minutes a cycle.
float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
  vec3 d = normalize(vDir);
  float band = pow(clamp(d.y + 0.06, 0.0, 1.0), 0.42);
  vec3 col = mix(uHorizon, uTop, band);

  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  // Tight disc, wide glow, and a band along the whole horizon at low sun — that
  // last term is what makes a sunrise read as a sunrise rather than a lamp.
  col += uSunTint * pow(sd, 340.0) * 7.0;
  col += uSunTint * pow(sd, 7.0) * 0.34;
  col += uSunTint * pow(1.0 - abs(d.y), 11.0) * 0.20 * (1.0 - uDay);

  if (uStars > 0.01 && d.y > -0.05) {
    vec3 cell = floor(d * 190.0);
    float h = hash(cell);
    float star = smoothstep(0.9965, 0.9995, h);
    // Slight twinkle from a second hash, not from time — no per-frame work.
    star *= 0.55 + hash(cell + 3.7) * 0.75;
    col += vec3(0.85, 0.89, 1.0) * star * uStars * smoothstep(-0.05, 0.25, d.y);
  }

  gl_FragColor = vec4(col, 1.0);
}`;

// Palettes the sky moves between. Region colour tints the result rather than
// replacing it, so a rainforest dusk still looks like dusk.
const NOON = { top: 0x2f6fb8, hor: 0xc2dcef, sun: 0xfff4e0 };
const GOLD = { top: 0x39628f, hor: 0xe8a765, sun: 0xffa758 };
const NIGHT = { top: 0x05080f, hor: 0x141c2e, sun: 0x2a3a5c };

const _a = new THREE.Color(), _b = new THREE.Color();
const hex = (h, out) => out.setHex(h, 'srgb');

export class Sky {
  constructor(scene, quality) {
    this.scene = scene;
    this.q = quality;
    this.time = 0.32;                 // opens mid-morning, in good light
    this.flow = true;                 // whether the clock advances
    this.sunDir = new THREE.Vector3(0, 1, 0);

    this.uniforms = {
      uTop: { value: new THREE.Color(0x2f6fb8) },
      uHorizon: { value: new THREE.Color(0xc2dcef) },
      uSunTint: { value: new THREE.Color(0xfff4e0) },
      uSunDir: { value: this.sunDir },
      uDay: { value: 1 },
      uStars: { value: 0 },
    };

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1, 40, 24),
      new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
        side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      }),
    );
    dome.scale.setScalar(3000);       // must stay inside camera.far
    dome.frustumCulled = false;
    dome.renderOrder = -1000;
    scene.add(dome);
    this.dome = dome;

    this.sun = new THREE.DirectionalLight(0xfff0d2, 2.6);
    if (quality.shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(quality.shadows, quality.shadows);
      const c = this.sun.shadow.camera;
      const r = quality.shadowRange;
      c.left = -r; c.right = r; c.top = r; c.bottom = -r;
      c.near = 1; c.far = 900;
      // Required. three builds the shadow projection at construction and never
      // rebuilds it, so without this the frustum stays at its default ±5 m and no
      // shadow ever lands anywhere in the world.
      c.updateProjectionMatrix();
      this.sun.shadow.bias = -0.0007;
      this.sun.shadow.normalBias = 0.28;
    }
    scene.add(this.sun);
    scene.add(this.sun.target);

    // Never goes fully black. Night has to be atmospheric AND drivable; a player who
    // cannot see the road has a bug, not a mood.
    this.bounce = new THREE.HemisphereLight(0xbcd8f0, 0x4a4436, 1.0);
    scene.add(this.bounce);

    scene.fog = new THREE.Fog(0xb9d3e8, 260, 1500);
    this.fogTint = new THREE.Color();
    this.gradeTint = new THREE.Color(1, 1, 1);
    this.gradeLift = new THREE.Color(0, 0, 0);
  }

  setTime(t) { this.time = ((t % 1) + 1) % 1; }

  // 1 in full day, 0 in full night. Everything that needs to know "is it dark"
  // asks this rather than testing the clock.
  get daylight() {
    return clamp(Math.sin((this.time - 0.25) * Math.PI * 2) * 1.7 + 0.2, 0, 1);
  }

  get isNight() { return this.daylight < 0.12; }

  update(dt, pos, camPos = pos) {
    if (this.flow) this.time = (this.time + dt / DAY_LENGTH) % 1;

    const a = (this.time - 0.25) * Math.PI * 2;
    const sunY = Math.sin(a);
    this.sunDir.set(Math.cos(a) * 0.88, sunY, -0.40).normalize();

    const day = this.daylight;
    // Peaks when the sun sits on the horizon and falls away fast either side.
    const golden = Math.max(0, 1 - Math.abs(sunY) * 3.4) * (sunY > -0.35 ? 1 : 0);
    const night = 1 - day;

    // Sky: night -> golden -> noon, by however high the sun is.
    hex(NIGHT.top, _a); hex(GOLD.top, _b);
    _a.lerp(_b, clamp(day * 2.4, 0, 1));
    hex(NOON.top, _b);
    _a.lerp(_b, smoothstep(0.35, 1, day) * (1 - golden * 0.55));
    this.uniforms.uTop.value.copy(_a);

    hex(NIGHT.hor, _a); hex(GOLD.hor, _b);
    _a.lerp(_b, clamp(day * 2.4, 0, 1));
    hex(NOON.hor, _b);
    _a.lerp(_b, smoothstep(0.3, 1, day) * (1 - golden * 0.75));
    // Region colour tints the horizon rather than replacing it — Emberfall's haze
    // still reads as Emberfall at every hour.
    const along = clamp(pos.z, 0, JOURNEY);
    mixColor(along, 'fog', _b);
    _a.lerp(_b, 0.42 * day);
    this.uniforms.uHorizon.value.copy(_a);
    this.fogTint.copy(_a);

    hex(NIGHT.sun, _a); hex(GOLD.sun, _b);
    _a.lerp(_b, clamp(day * 2.0, 0, 1));
    hex(NOON.sun, _b);
    _a.lerp(_b, smoothstep(0.3, 1, day) * (1 - golden));
    this.uniforms.uSunTint.value.copy(_a);

    this.uniforms.uDay.value = day;
    this.uniforms.uStars.value = smoothstep(0.35, 0.02, day);

    // Fog takes the sky's colour, so the horizon never shows a seam between the
    // land fading out and the sky behind it.
    this.scene.fog.color.copy(this.fogTint);
    const range = day * 0.55 + 0.45;
    this.scene.fog.near = mixField(along, 'fogNear') * range;
    this.scene.fog.far = mixField(along, 'fogFar') * range;

    // Sunlight: colour from the palette, strength from the sun's height. Below the
    // horizon it is off entirely and the hemisphere light carries the scene.
    this.sun.color.copy(_a).lerp(new THREE.Color(1, 1, 1), 0.25 * day);
    // Rises fast off the horizon so mid-morning is bright rather than merely lit —
    // at 3.4x the whole world sat two stops under.
    this.sun.intensity = clamp(sunY * 6.2, 0, 4.3);
    this.sun.visible = this.sun.intensity > 0.01;

    hex(0xbcd8f0, _a);
    hex(0x2a3a58, _b);
    this.bounce.color.copy(_b).lerp(_a, day);
    hex(0x4a4436, _a); hex(0x14161f, _b);
    this.bounce.groundColor.copy(_b).lerp(_a, day);
    // Key-to-fill matters more than either number alone: at 1.35 the sky filled the
    // shadows so completely that nothing on the ground cast a visible one.
    this.bounce.intensity = lerp(0.44, 0.82, day);      // the second term is the night floor

    this.dome.position.copy(camPos);
    this.sun.target.position.copy(pos);
    this.sun.position.copy(pos).addScaledVector(this.sunDir, 380);
    this.sun.target.updateMatrixWorld();

    // What the colour grade should aim for: warm and lifted at golden hour, cool and
    // crushed at night, neutral at noon.
    this.gradeTint.setRGB(
      1 + golden * 0.10 - night * 0.10,
      1 + golden * 0.01 - night * 0.05,
      1 - golden * 0.09 + night * 0.10,
    );
    this.gradeLift.setRGB(night * 0.012, night * 0.014, night * 0.030);
    this.exposure = lerp(1.16, 1.02, day) - golden * 0.05;
  }
}
