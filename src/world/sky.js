import * as THREE from 'three';
import { Sky as PreethamSky } from 'three/examples/jsm/objects/Sky.js';
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

// Stars only — the day sky is a physical Preetham model (three's Sky) now, so
// this dome's single job is night: an additive star field fading in with dark.
const FRAG = `
uniform float uStars;
varying vec3 vDir;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
  vec3 d = normalize(vDir);
  float glow = 0.0;
  if (uStars > 0.01 && d.y > -0.05) {
    vec3 cell = floor(d * 190.0);
    float h = hash(cell);
    float star = smoothstep(0.9965, 0.9995, h);
    star *= 0.55 + hash(cell + 3.7) * 0.75;
    glow = star * uStars * smoothstep(-0.05, 0.25, d.y);
  }
  gl_FragColor = vec4(vec3(0.85, 0.89, 1.0) * glow, glow);
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
      uHorizon: { value: new THREE.Color(0xc2dcef) },   // fog + water still read this
      uStars: { value: 0 },
    };

    // The atmosphere: three's Preetham scattering model. Haze, horizon warmth and
    // sunset colour fall out of the physics instead of hand-picked gradients.
    this.atmo = new PreethamSky();
    this.atmo.scale.setScalar(3000);
    const au = this.atmo.material.uniforms;
    au.turbidity.value = 7;
    au.rayleigh.value = 2.2;
    au.mieCoefficient.value = 0.005;
    au.mieDirectionalG.value = 0.8;
    this.atmo.material.depthWrite = false;
    this.atmo.material.depthTest = false;
    this.atmo.renderOrder = -1001;
    this.atmo.frustumCulled = false;
    scene.add(this.atmo);

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1, 40, 24),
      new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
        side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
        transparent: true, blending: THREE.AdditiveBlending,
      }),
    );
    dome.scale.setScalar(2900);       // just inside the atmosphere shell
    dome.frustumCulled = false;
    dome.renderOrder = -999;
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
    this.visibility = 1;              // weather writes this; 1 = clear air
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

    // The physical sky follows the sun by itself; haze thickens toward dusk.
    this.atmo.material.uniforms.sunPosition.value.copy(this.sunDir);
    this.atmo.material.uniforms.turbidity.value = 7 + golden * 6;

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
    // Fog colour is applied in linear space and ignores exposure, so it must be
    // pre-dimmed to the same stop as the Preetham exposure or it reads as white soup.
    this.fogTint.copy(_a).multiplyScalar(0.42);

    hex(NIGHT.sun, _a); hex(GOLD.sun, _b);
    _a.lerp(_b, clamp(day * 2.0, 0, 1));
    hex(NOON.sun, _b);
    _a.lerp(_b, smoothstep(0.3, 1, day) * (1 - golden));

    this.uniforms.uStars.value = smoothstep(0.35, 0.02, day);

    // Fog takes the sky's colour, so the horizon never shows a seam between the
    // land fading out and the sky behind it.
    this.scene.fog.color.copy(this.fogTint);
    const range = (day * 0.55 + 0.45) * this.visibility;
    this.scene.fog.near = mixField(along, 'fogNear') * range;
    this.scene.fog.far = mixField(along, 'fogFar') * range;

    // Sunlight: colour from the palette, strength from the sun's height. Below the
    // horizon it is off entirely and the hemisphere light carries the scene.
    this.sun.color.copy(_a).lerp(new THREE.Color(1, 1, 1), 0.25 * day);
    // Rises fast off the horizon so mid-morning is bright rather than merely lit —
    // at 3.4x the whole world sat two stops under.
    this.sun.intensity = clamp(sunY * 4.6, 0, 3.2);
    this.sun.visible = this.sun.intensity > 0.01;

    hex(0xbcd8f0, _a);
    hex(0x2a3a58, _b);
    this.bounce.color.copy(_b).lerp(_a, day);
    hex(0x4a4436, _a); hex(0x14161f, _b);
    this.bounce.groundColor.copy(_b).lerp(_a, day);
    // Key-to-fill matters more than either number alone: at 1.35 the sky filled the
    // shadows so completely that nothing on the ground cast a visible one.
    // Scene ambient now mostly comes from the HDRI environment; the hemisphere
    // only lifts what PMREM misses. Big values here re-blow the exposure.
    this.bounce.intensity = lerp(0.3, 0.42, day);

    this.dome.position.copy(camPos);
    this.atmo.position.copy(camPos);
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
    // Preetham radiance is HDR-scaled: the reference exposure is ~0.5, not ~1.
    this.exposure = lerp(0.6, 0.5, day) - golden * 0.03;
  }
}
