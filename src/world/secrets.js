import * as THREE from 'three';
import { pointAt } from './road.js';
import { elevation } from './terrain.js';
import { makeRng } from './rng.js';

// Hidden wonders. No markers, no map, no hints in the HUD — the reward for
// leaving the road is finding these. Each has a place, a condition, and a small
// scene built lazily when the player is near enough to possibly see it.
//
// Spoiler discipline: nothing in the UI ever lists them; discovery state is only
// a count ("2 of 6 wonders found") on the save.

const STORE = 'lr.secrets';

function spot(d, off, id) {
  const p = pointAt(d);
  const x = p.x + p.rx * off, z = p.z + p.rz * off;
  return { x, z, y: elevation(x, z), id };
}

export class Secrets {
  constructor(scene, { sky, weather, hud, audio }) {
    this.scene = scene;
    this.sky = sky;
    this.weather = weather;
    this.hud = hud;
    this.audio = audio;
    this.found = new Set(JSON.parse(localStorage.getItem(STORE) || '[]'));
    this.rng = makeRng(77);

    // Definitions stay data-light until built. Conditions read the live sky and
    // weather, so some wonders only exist at the right hour in the right air.
    this.defs = [
      {
        ...spot(1520, -330, 'bloomvale'), r: 40,
        name: 'a valley that wakes with the sun',
        cond: () => !this.sky.isNight && this.sky.time > 0.22 && this.sky.time < 0.34,
        build: (g) => this.buildBloomvale(g),
        tick: (g, dt) => this.tickBloomvale(g, dt),
      },
      {
        ...spot(3310, 190, 'fireflyhollow'), r: 34,
        name: 'a hollow full of drifting light',
        cond: () => this.sky.isNight,
        build: (g) => this.buildFireflies(g),
        tick: (g, dt) => this.tickFireflies(g, dt),
      },
      {
        ...spot(7460, -270, 'rainbowfalls'), r: 46,
        name: 'the falls wearing a rainbow',
        cond: () => !this.sky.isNight && this.rainMemory > 0 && this.sky.daylight > 0.5,
        build: (g) => this.buildRainbow(g),
        tick: () => {},
      },
      {
        ...spot(9930, 240, 'hotspring'), r: 30,
        name: 'warm water under cold stars',
        cond: () => true,
        build: (g) => this.buildHotspring(g),
        tick: (g, dt) => this.tickHotspring(g, dt),
      },
      {
        ...spot(10240, 0, 'aurora'), r: 320,
        name: 'the sky on fire',
        sky: true,
        cond: () => this.sky.isNight && this.weather.stateName === 'clear',
        build: (g) => this.buildAurora(g),
        tick: (g, dt) => this.tickAurora(g, dt),
      },
      {
        ...spot(13780, 170, 'stonecircle'), r: 26,
        name: 'stones older than the road',
        cond: () => true,
        build: (g) => this.buildStones(g),
        tick: () => {},
      },
    ];
    for (const d of this.defs) { d.group = null; d.visible = false; }
  }

  get count() { return this.found.size; }
  get total() { return this.defs.length; }

  discover(def) {
    if (this.found.has(def.id)) return;
    this.found.add(def.id);
    localStorage.setItem(STORE, JSON.stringify([...this.found]));
    this.hud.note(`you found ${def.name} — wonder ${this.found.size} of ${this.defs.length}`, 6);
    this.audio.chime('find');
  }

  update(dt, focus) {
    // Rainbows need the memory of rain: a window that opens as a shower ends.
    const wet = ['rain', 'storm'].includes(this.weather.stateName);
    if (wet) this.wasWet = true;
    else if (this.wasWet) { this.wasWet = false; this.rainMemory = 150; }
    this.rainMemory = Math.max(0, (this.rainMemory || 0) - dt);

    for (const def of this.defs) {
      const dx = focus.x - def.x, dz = focus.z - def.z;
      const d2 = dx * dx + dz * dz;
      const near = d2 < 700 * 700;

      // Build and tear down lazily; a wonder nobody is near costs nothing.
      if (near && !def.group) {
        def.group = new THREE.Group();
        def.group.position.set(def.x, def.y, def.z);
        def.build(def.group);
        this.scene.add(def.group);
      } else if (!near && def.group) {
        this.scene.remove(def.group);
        def.group = null;
        continue;
      }
      if (!def.group) continue;

      const on = def.cond();
      def.group.visible = on;
      if (!on) continue;
      def.tick(def.group, dt);
      if (d2 < def.r * def.r) this.discover(def);
    }
  }

  // --- builders --------------------------------------------------------------

  buildBloomvale(g) {
    // Two hundred flowers that only stand open in the first light.
    const geo = new THREE.ConeGeometry(0.16, 0.3, 6);
    geo.translate(0, 1.0, 0);
    const stemGeo = new THREE.CylinderGeometry(0.02, 0.03, 1.0, 4);
    stemGeo.translate(0, 0.5, 0);
    const petals = new THREE.InstancedMesh(geo,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }), 200);
    const stems = new THREE.InstancedMesh(stemGeo,
      new THREE.MeshStandardMaterial({ color: 0x3d5c26, roughness: 0.9 }), 200);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const palette = [0xe86aa0, 0xf2b544, 0xba6ae8, 0xe8e26a, 0xffffff];
    for (let i = 0; i < 200; i++) {
      const a = this.rng() * Math.PI * 2, r = Math.sqrt(this.rng()) * 34;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = elevation(this.defs[0].x + x, this.defs[0].z + z) - this.defs[0].y;
      m.makeTranslation(x, y, z);
      petals.setMatrixAt(i, m);
      stems.setMatrixAt(i, m);
      petals.setColorAt(i, c.setHex(palette[(this.rng() * palette.length) | 0]));
    }
    petals.instanceColor.needsUpdate = true;
    g.add(petals); g.add(stems);
    g.userData.petals = petals;
  }

  tickBloomvale() { /* stillness is the point */ }

  buildFireflies(g) {
    const n = 240;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (this.rng() - 0.5) * 52;
      pos[i * 3 + 1] = 0.4 + this.rng() * 3.4;
      pos[i * 3 + 2] = (this.rng() - 0.5) * 52;
      seed[i] = this.rng() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xd8f27a, size: 0.16, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    const pts = new THREE.Points(geo, mat);
    g.add(pts);
    g.userData = { pts, seed, t: 0 };
  }

  tickFireflies(g, dt) {
    const u = g.userData;
    u.t += dt;
    const pos = u.pts.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const s = u.seed[i];
      pos.setX(i, pos.getX(i) + Math.sin(u.t * 0.7 + s) * dt * 0.5);
      pos.setY(i, pos.getY(i) + Math.cos(u.t * 0.9 + s * 1.3) * dt * 0.3);
      pos.setZ(i, pos.getZ(i) + Math.sin(u.t * 0.5 + s * 2.1) * dt * 0.5);
    }
    pos.needsUpdate = true;
    u.pts.material.opacity = 0.55 + Math.sin(u.t * 2.2) * 0.35;
  }

  buildRainbow(g) {
    // A half-arc of vertex-painted bands, additive so light reads as light.
    const bands = [0xff4040, 0xff9c40, 0xf2e04a, 0x58c85a, 0x4a86e8, 0x7a5ae8];
    bands.forEach((hex, i) => {
      const torus = new THREE.TorusGeometry(46 - i * 1.6, 0.7, 6, 48, Math.PI);
      const mat = new THREE.MeshBasicMaterial({
        color: hex, transparent: true, opacity: 0.22,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      const arc = new THREE.Mesh(torus, mat);
      arc.position.y = 2;
      g.add(arc);
    });
    g.rotation.y = 0.6;
  }

  buildHotspring(g) {
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(9, 28),
      new THREE.MeshStandardMaterial({
        color: 0x4fd6c8, roughness: 0.12, metalness: 0.1,
        transparent: true, opacity: 0.86, emissive: 0x1a5a52, emissiveIntensity: 0.35,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.25;
    g.add(water);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(9.2, 0.9, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0x8d8b84, roughness: 0.95 }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.3;
    g.add(rim);

    // Steam: a column of soft sprites rising and fading.
    const n = 40;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (this.rng() - 0.5) * 12;
      pos[i * 3 + 1] = this.rng() * 5;
      pos[i * 3 + 2] = (this.rng() - 0.5) * 12;
      seed[i] = this.rng() * 10;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const steam = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xe8f0f2, size: 2.6, transparent: true, opacity: 0.16, depthWrite: false,
    }));
    g.add(steam);
    g.userData = { steam, seed };
  }

  tickHotspring(g, dt) {
    const pos = g.userData.steam.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + dt * (0.6 + (g.userData.seed[i] % 1) * 0.6);
      if (y > 6) y = 0.3;
      pos.setY(i, y);
      pos.setX(i, pos.getX(i) + Math.sin(y + g.userData.seed[i]) * dt * 0.3);
    }
    pos.needsUpdate = true;
  }

  buildAurora(g) {
    // Curtains of light high over the pass: long triangles with a vertical
    // gradient, additive, swaying slowly. Cheap and enormous.
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec2 vUv; uniform float uTime;
        void main() {
          vUv = uv;
          vec3 p = position;
          p.x += sin(uTime * 0.22 + position.y * 0.012 + position.x * 0.004) * 24.0 * uv.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        varying vec2 vUv; uniform float uTime;
        void main() {
          float band = sin(vUv.x * 14.0 + uTime * 0.35) * 0.5 + 0.5;
          vec3 col = mix(vec3(0.1, 0.9, 0.45), vec3(0.35, 0.3, 0.9), band);
          float a = (1.0 - vUv.y) * vUv.y * 4.0 * (0.35 + band * 0.3);
          gl_FragColor = vec4(col * a * 0.8, a * 0.55);
        }`,
    });
    for (const [ox, oz, w] of [[-160, -80, 520], [120, 60, 640], [-40, 180, 480]]) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, 210, 24, 1), mat);
      plane.position.set(ox, 420, oz);
      plane.rotation.y = ox * 0.004;
      g.add(plane);
    }
    g.userData.mat = mat;
  }

  tickAurora(g, dt) { g.userData.mat.uniforms.uTime.value += dt; }

  buildStones(g) {
    const rock = new THREE.MeshStandardMaterial({ color: 0x5c5a52, roughness: 0.98 });
    const moss = new THREE.MeshStandardMaterial({ color: 0x4a5c34, roughness: 0.95 });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const h = 2.2 + this.rng() * 1.4;
      const stone = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5 + this.rng() * 0.2, 0.75 + this.rng() * 0.25, h, 7),
        this.rng() > 0.4 ? rock : moss,
      );
      const x = Math.cos(a) * 8, z = Math.sin(a) * 8;
      stone.position.set(x, elevation(this.defs[5].x + x, this.defs[5].z + z) - this.defs[5].y + h / 2 - 0.4, z);
      stone.rotation.y = this.rng() * Math.PI;
      stone.rotation.z = (this.rng() - 0.5) * 0.14;
      stone.castShadow = true;
      g.add(stone);
    }
  }
}
