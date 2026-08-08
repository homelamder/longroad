import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { clamp, lerp } from './rng.js';

// Grade, vignette and speed blur in one pass. Three cheap things that between them
// do most of the work of making a real-time render look photographed rather than
// computed — and one pass costs one full-screen read instead of three.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uLift: { value: new THREE.Color(0, 0, 0) },
    uSaturation: { value: 1.10 },
    uContrast: { value: 1.02 },
    uVignette: { value: 0.24 },
    uBlur: { value: 0.0 },
    uCentre: { value: new THREE.Vector2(0.5, 0.52) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec3 uTint;
    uniform vec3 uLift;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uVignette;
    uniform float uBlur;
    uniform vec2 uCentre;
    varying vec2 vUv;

    void main() {
      vec2 dir = vUv - uCentre;
      vec3 col;

      if (uBlur > 0.001) {
        // Radial smear away from the vanishing point. The world stays sharp where you
        // are looking and tears past at the edges — the trick every racing game uses
        // to sell speed, and it costs six taps.
        col = vec3(0.0);
        float total = 0.0;
        for (int i = 0; i < 6; i++) {
          float t = float(i) / 5.0;
          float w = 1.0 - t * 0.55;
          col += texture2D(tDiffuse, vUv - dir * t * uBlur).rgb * w;
          total += w;
        }
        col /= total;
      } else {
        col = texture2D(tDiffuse, vUv).rgb;
      }

      col = col * uTint + uLift;
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;

      float v = 1.0 - uVignette * dot(dir, dir) * 2.1;
      col *= clamp(v, 0.0, 1.0);

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.q = quality;
    this.enabled = quality.bloom || quality.smaa || true;   // the grade is always worth it

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(
      size.x, size.y,
      // Half float, or bloom clips every highlight to white before it can bloom.
      { type: THREE.HalfFloatType, samples: quality.smaa ? 0 : 0 },
    ));
    this.composer.addPass(new RenderPass(scene, camera));

    if (quality.bloom) {
      // Threshold sits ABOVE the Preetham sky's HDR range on purpose: bloom is for
      // the sun disc, headlights and fires — not for blooming the entire sky over
      // the frame, which reads as fog soup.
      this.bloom = new UnrealBloomPass(size, 0.22, 0.4, 1.55);
      this.composer.addPass(this.bloom);
    }

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    // OutputPass applies the renderer's tone mapping and colour space at the end of
    // the chain, which is the only place it can go once a composer is involved.
    this.composer.addPass(new OutputPass());

    if (quality.smaa) this.composer.addPass(new SMAAPass());

    this.blurTarget = 0;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.bloom?.setSize(w, h);
  }

  // tint/lift come from the region so each one has its own colour signature; blur
  // comes from speed. Both ease rather than snap.
  update(dt, { tint, lift, speed01 = 0, exposure = 1 } = {}) {
    const u = this.grade.uniforms;
    if (tint) u.uTint.value.lerp(tint, Math.min(1, dt * 2.5));
    if (lift) u.uLift.value.lerp(lift, Math.min(1, dt * 2.5));

    const want = this.q.motionBlur ? clamp((speed01 - 0.32) / 0.68, 0, 1) * 0.052 : 0;
    this.blurTarget = lerp(this.blurTarget, want, Math.min(1, dt * 3.2));
    u.uBlur.value = this.blurTarget;

    this.renderer.toneMappingExposure = exposure;
  }

  render() { this.composer.render(); }
}
