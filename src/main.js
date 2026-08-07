import * as THREE from 'three';
import { QUALITY, QualityMeter, setQuality, TIER_NAMES } from './quality.js';
import { Terrain, elevation } from './world/terrain.js';
import { buildRoadMesh, pointAt, nearest, ROAD_LENGTH } from './world/road.js';
import { Scatter } from './world/scatter.js';
import { Grass } from './world/grass.js';
import { Sky, DAY_LENGTH } from './world/sky.js';
import { Post } from './world/post.js';
import { JOURNEY, biomeAt } from './world/biomes.js';
import { Car, DEFAULT_CAR } from './car/physics.js';
import { buildCarMesh, poseCar, addHeadlights } from './car/body.js';
import { ChaseCamera } from './car/camera.js';
import { Dust } from './car/dust.js';
import { Controls } from './player/controls.js';
import { Hud } from './ui/hud.js';

const canvas = document.createElement('canvas');
document.body.appendChild(canvas);

const renderer = new THREE.WebGLRenderer({
  canvas, antialias: !QUALITY.smaa, powerPreference: 'high-performance', stencil: false,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY.pixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
if (QUALITY.shadows) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

// The composer renders several passes per frame and each renderer.render() would
// reset the counters, leaving stats reporting only the final fullscreen quad.
renderer.info.autoReset = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 4200);

const sky = new Sky(scene, QUALITY);
const terrain = new Terrain({ quality: QUALITY.terrain });
const scatter = new Scatter({ quality: QUALITY });
const grass = new Grass({ quality: QUALITY });
scene.add(terrain.group);
scene.add(scatter.group);
scene.add(grass.mesh);
scene.add(buildRoadMesh());

const car = new Car(DEFAULT_CAR);
car.placeOnRoad(40);
const carMesh = buildCarMesh(car.spec);
const lights = addHeadlights(carMesh, car.spec);
scene.add(carMesh);
const dust = new Dust(scene);

const chase = new ChaseCamera(camera);
const controls = new Controls();
const hud = new Hud();
const post = new Post(renderer, scene, camera, QUALITY);
controls.onCamera = () => chase.cycle();
controls.onRecover = () => { car.recover(); chase.snap(car); };

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  post.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const boot = document.getElementById('boot');
const bootStatus = document.getElementById('boot-status');
let running = false;

const STEP = 1 / 60;          // physics runs fixed so handling never depends on fps
let acc = 0;
let last = performance.now();

const meter = new QualityMeter(() => {
  // Only the cheap knobs move at runtime; rebuilding the whole scene mid-drive
  // would cost more than it saves.
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
  hud.note('graphics eased back to hold framerate');
});

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  renderer.info.reset();

  if (!running) {
    terrain.update(car.pos.x, car.pos.z, 10);
    scatter.update(car.pos.x, car.pos.z, 3);
    grass.update(dt, car.pos.x, car.pos.z, 14);
    const left = terrain.queue.length;
    bootStatus.textContent = left ? `shaping the land · ${left} left` : 'planting';
    if (!left && scatter.total > 0) {
      running = true;
      car.placeOnRoad(40);
      chase.snap(car);
      boot.classList.add('gone');
      setTimeout(() => boot.remove(), 800);
    }
    sky.update(dt, car.pos, camera.position);
    post.update(dt, { tint: sky.gradeTint, lift: sky.gradeLift, exposure: sky.exposure });
    post.render();
    return;
  }

  const input = controls.update(dt);
  acc = Math.min(acc + dt, 0.25);
  let steps = 0;
  while (acc >= STEP && steps < 6) { car.update(STEP, input); acc -= STEP; steps++; }
  car.braking = input.brake > 0.05;

  terrain.update(car.pos.x, car.pos.z, 2);
  scatter.update(car.pos.x, car.pos.z, 1);
  grass.update(dt, car.pos.x, car.pos.z, 5);
  chase.update(dt, car);
  sky.update(dt, car.pos, camera.position);

  poseCar(carMesh, car);
  lights.update(sky.daylight < 0.55);   // on through dawn and dusk, not just full dark
  dust.update(dt, car);
  hud.update(car, sky);

  post.update(dt, {
    tint: sky.gradeTint,
    lift: sky.gradeLift,
    exposure: sky.exposure,
    speed01: Math.abs(car.speed) / car.spec.topSpeed,
  });
  post.render();
  meter.update(dt);
}
requestAnimationFrame(frame);

// Debug handle. The preview browser here has no WebGL, so every visual check runs
// through puppeteer against this object — without it there is no way to pose the
// camera or drive input for a repeatable capture.
window.__game = {
  THREE, scene, camera, renderer, car, carMesh, terrain, scatter, grass, sky, post,
  chase, controls, hud, quality: QUALITY,
  elevation, pointAt, nearest, biomeAt, JOURNEY, ROAD_LENGTH, DAY_LENGTH,
  TIER_NAMES, setQuality,
  get ready() { return running; },
  settle() {
    terrain.settle(car.pos.x, car.pos.z);
    for (let i = 0; i < 60; i++) scatter.update(car.pos.x, car.pos.z, 8);
    for (let i = 0; i < 90; i++) grass.update(0, car.pos.x, car.pos.z, 24);
  },
  teleport(along) {
    car.placeOnRoad(along);
    this.settle();
    chase.snap(car);
    sky.update(0.016, car.pos, camera.position);
  },
  setTime(t) { sky.setTime(t); sky.update(0.016, car.pos, camera.position); },
  freezeClock(v = true) { sky.flow = !v; },
  drive(input, seconds = 1) {
    const n = Math.max(1, Math.round(seconds / STEP));
    for (let i = 0; i < n; i++) car.update(STEP, input);
    terrain.update(car.pos.x, car.pos.z, 8);
    scatter.update(car.pos.x, car.pos.z, 4);
    grass.update(STEP * n, car.pos.x, car.pos.z, 12);
    chase.update(0.016, car);
    poseCar(carMesh, car);
    dust.update(0.05, car);
  },
  setCamera(mode) { chase.mode = mode; chase.snap(car); },
  render() { post.render(); },
  stats() {
    return {
      calls: renderer.info.render.calls,
      tris: renderer.info.render.triangles,
      plants: scatter.total,
      grass: grass.mesh.count,
      tier: QUALITY.name,
    };
  },
};
