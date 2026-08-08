import * as THREE from 'three';
import { asset } from './asset.js';
import { QUALITY, QualityMeter, setQuality, TIER_NAMES } from './quality.js';
import { Terrain, elevation } from './world/terrain.js';
import { buildRoadMesh, pointAt, nearest, ROAD_LENGTH } from './world/road.js';
import { Scatter } from './world/scatter.js';
import { loadVegetation, WIND } from './world/veg.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { Grass } from './world/grass.js';
import { Sky, DAY_LENGTH } from './world/sky.js';
import { Post } from './world/post.js';
import { Weather } from './world/weather.js';
import { Animals, setWolfTemper, wolfTemper, WOLF_TEMPERS } from './animals/animals.js';
import { MarshWater } from './world/water.js';
import { Landmarks } from './world/landmarks.js';
import { Secrets } from './world/secrets.js';
import { Finale } from './world/finale.js';
import { Ending } from './game/ending.js';
import { Save } from './game/save.js';
import { Audio } from './audio.js';
import { JOURNEY, biomeAt } from './world/biomes.js';
import { clamp } from './world/rng.js';
import { Car, DEFAULT_CAR } from './car/physics.js';
import { poseCar, addHeadlights } from './car/body.js';
import { buildCarBody } from './car/generator.js';
import { ROSTER, specFor } from './car/cars.js';
import { Garage } from './car/garage.js';
import { ChaseCamera } from './car/camera.js';
import { Dust } from './car/dust.js';
import { Controls } from './player/controls.js';
import { OnFoot } from './player/onfoot.js';
import { Hud } from './ui/hud.js';
import { Fuel } from './game/fuel.js';
import { Stations, STATION_RADIUS } from './game/stations.js';
import { TaskManager, Marker, Interact } from './game/tasks/index.js';
import { FIRST_TASKS } from './game/tasks/firstthree.js';
import { CREATURE_TASKS } from './game/tasks/creatures.js';
import { DRIVING_TASKS } from './game/tasks/driving.js';
import { SURVIVAL_TASKS } from './game/tasks/survival.js';
import { WONDER_TASKS } from './game/tasks/wonders.js';

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
const camera = new THREE.PerspectiveCamera(62, 1, 0.28, 4200);   // near covers the dash view

const sky = new Sky(scene, QUALITY);
const terrain = new Terrain({ quality: QUALITY.terrain, textured: true, res: QUALITY.tex2k ? '2k' : '1k' });

// Grow the forest before first frame — realistic trees are generated, not shipped.
document.getElementById('boot-status').textContent = 'growing the forest';
const veg = await loadVegetation();
const scatter = new Scatter({ quality: QUALITY, veg });

// HDRI environment for every reflective surface (car paint above all).
new RGBELoader().load(asset('/tex/hilly_terrain_01_puresky_1k.hdr'), (hdr) => {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  hdr.dispose();
  pmrem.dispose();
});
const grass = new Grass({ quality: QUALITY });
scene.add(terrain.group);
scene.add(scatter.group);
scene.add(grass.mesh);
scene.add(buildRoadMesh(QUALITY.tex2k ? '2k' : '1k'));

const weather = new Weather(scene);
const animals = new Animals(scene);
const water = new MarshWater(scene, sky);
const landmarks = new Landmarks(scene);
const finale = new Finale(scene, animals);

// Start in whatever the player last drove; the garage swaps bodies in place.
const startEntry = ROSTER.find((e) => e.id === (localStorage.getItem('lr.car') || 'trailhand'))
  || ROSTER[0];
const car = new Car(specFor(startEntry));
car.placeOnRoad(40);
const game = { car, carMesh: null, lights: null, hud: null };
game.carMesh = buildCarBody(car.spec);
game.lights = addHeadlights(game.carMesh, car.spec);
scene.add(game.carMesh);
const dust = new Dust(scene);

const chase = new ChaseCamera(camera);
const controls = new Controls();
const hud = new Hud();
game.hud = hud;
const garage = new Garage(scene, game);
addEventListener('keydown', (e) => {
  // F steps out of the car anywhere — free roam, no task attached. The world
  // just carries on around you.
  if (e.code === 'KeyF' && !e.repeat && tasks.mode === 'drive' && !tasks.busy
    && !garage.open && Math.abs(car.speed) < 1.5) {
    tasks.exitCar();
    hud.note('on foot — E by the car to drive on', 4);
  }
  if (e.code === 'KeyG' && !e.repeat && tasks.mode === 'drive' && !tasks.busy
    && Math.abs(car.speed) < 1.5) garage.toggle();
  if (e.code === 'Escape' && garage.open) garage.toggle(false);
  if (e.code === 'KeyM' && !e.repeat) hud.note(audio.toggleMute() ? 'sound off' : 'sound on', 2);
  if (e.code === 'KeyV' && !e.repeat) {
    const order = Object.keys(WOLF_TEMPERS);
    const next = order[(order.indexOf(wolfTemper.name) + 1) % order.length];
    hud.note(`wolves: ${setWolfTemper(next)}`, 3);
  }
});
const post = new Post(renderer, scene, camera, QUALITY);
controls.onCamera = () => { if (tasks.mode === 'drive') chase.cycle(); };
controls.onLook = (dx, dy) => chase.look(dx, dy);
controls.onRecover = () => { if (tasks.mode === 'drive') { car.recover(); chase.snap(car); } };

// --- the loop: fuel, stations, tasks ---------------------------------------
const fuel = new Fuel();
const foot = new OnFoot();
scene.add(foot.mesh);
const stations = new Stations(scene);
const marker = new Marker(scene);
const interact = new Interact(hud, controls);
const tasks = new TaskManager(
  [...FIRST_TASKS, ...CREATURE_TASKS, ...DRIVING_TASKS, ...SURVIVAL_TASKS, ...WONDER_TASKS],
  { scene, car, foot, hud, marker, interact, chase, station: null,
    animals, weather, sky, landmarks, biomeAt },
);

const ending = new Ending({ hud, sky, weather, fuel });
const audio = new Audio();
const secrets = new Secrets(scene, { sky, weather, hud, audio });
animals.onStalk = () => { hud.note('eyes in the treeline…', 4); audio.growl(0.5); };
animals.onStrike = (a) => {
  foot.stagger(a.x, a.z);
  hud.note('the wolf got you — the pack stands off, for now', 5);
  audio.growl(1);
};
const save = new Save({ car, fuel, sky, stations, ending });
const resumed = save.restore();
if (resumed) chase.snap(car);

// Station offers are edge-triggered: the task is picked once on arrival, so the
// offer cannot reroll by the frame while you sit there.
let offeredStation = null;

function gameLogic(dt, input) {
  const jerry = fuel.update(dt, car, tasks.mode === 'drive' ? input.throttle : 0);
  if (jerry === 'jerrycan') hud.note('reserve — a jerrycan saves the day');
  fuel.capSpeed(car);
  hud.setFuel(fuel.fraction, fuel.jerrycans, fuel.onReserve);
  stations.setNight(sky.daylight < 0.4);
  marker.update(dt);

  // Free roam: on foot with no task. The only interactable is the car door.
  if (!tasks.busy && tasks.mode === 'foot') {
    interact.set({ x: car.pos.x, z: car.pos.z, radius: 3.4, label: 'drive on' });
    if (interact.update(foot)) {
      interact.clear();
      tasks.enterCar();
    }
    return;
  }

  if (tasks.busy) {
    if (tasks.update(dt) === 'done') {
      fuel.fill();
      ending.taskDone();
      audio.chime('done');
      hud.note('tank filled — the road goes on');
    }
    return;
  }

  // A parked car nearby? Claiming beats refuelling for the prompt slot.
  const find = garage.nearestFind(car.pos);
  if (find && Math.abs(car.speed) < 1.5) {
    interact.set({ x: find.x, z: find.z, radius: 10, label: `take the ${find.entry.name}` });
    if (interact.update(car)) {
      garage.claim(find);
      audio.chime('find');
      interact.clear();
    }
    return;
  }

  // Not on a task: stations offer one when you pull up needing fuel.
  const s = stations.near(car.pos);
  if (s && Math.abs(car.speed) < 1.5) {
    if (offeredStation !== s) {
      offeredStation = s;
      const task = tasks.pick(s.along, sky);
      s.offer = task;
    }
    if (fuel.fraction > 0.96) {
      hud.setPrompt(null);
      hud.setObjective('');
    } else {
      interact.set({ x: s.x, z: s.z, radius: STATION_RADIUS, label: s.offer.name });
      if (interact.update(car)) {
        interact.clear();
        tasks.begin(s.offer, s);
        hud.note(s.offer.name, 3);
      }
    }
  } else if (offeredStation && (!s || Math.abs(car.speed) >= 1.5)) {
    offeredStation = null;
    interact.clear();
  }

  if (fuel.low && Math.floor(performance.now() / 12000) !== lastLowNote) {
    lastLowNote = Math.floor(performance.now() / 12000);
    const next = stations.next(car.pos.z);
    hud.note(next ? `fuel low — station in ${((next.along - car.pos.z) / 1000).toFixed(1)} km` : 'fuel low');
  }
  if (fuel.onReserve && Math.floor(performance.now() / 9000) !== lastLowNote) {
    lastLowNote = Math.floor(performance.now() / 9000);
    hud.note('reserve tank — limp to the next station');
  }
}
let lastLowNote = -1;

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
    // Burn a real time budget per boot frame instead of one streaming step — the
    // world settles in a handful of frames even on slow renderers.
    const t0 = performance.now();
    do {
      terrain.update(car.pos.x, car.pos.z, 10);
      scatter.update(car.pos.x, car.pos.z, 3);
      grass.update(dt, car.pos.x, car.pos.z, 14);
    } while (terrain.queue.length && performance.now() - t0 < 60);
    const left = terrain.queue.length;
    bootStatus.textContent = left ? `shaping the land · ${left} left` : 'planting';
    if (!left && scatter.total > 0) {
      running = true;
      if (!resumed) car.placeOnRoad(40);
      else hud.note(`resuming — ${(car.pos.z / 1000).toFixed(1)} km down the road`, 4);
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
  const driving = tasks.mode === 'drive';

  if (driving) {
    acc = Math.min(acc + dt, 0.25);
    let steps = 0;
    while (acc >= STEP && steps < 6) { car.update(STEP, input); acc -= STEP; steps++; }
    car.braking = input.brake > 0.05;
  } else {
    foot.update(dt, input, chase.orbYaw);
  }
  gameLogic(dt, input);

  const focus = driving ? car.pos : foot.pos;
  terrain.update(focus.x, focus.z, 2);
  scatter.update(focus.x, focus.z, 1);
  grass.update(dt, focus.x, focus.z, 5);
  chase.update(dt, driving ? car : foot);
  sky.update(dt, focus, camera.position);
  // Reflections dim with the daylight or the night would glow like a showroom.
  scene.environmentIntensity = 0.08 + sky.daylight * 0.75;
  weather.update(dt, camera.position, focus.z);
  animals.update(dt, focus, driving ? Math.abs(car.speed) : foot.moving * 3.2, !driving);
  water.update(dt);
  landmarks.update(dt, focus);
  secrets.update(dt, focus);
  finale.update(dt, focus);
  ending.track(dt, car, sky);
  ending.update(car, garage);
  save.update(dt);
  audio.update(dt, car, weather, driving, biomeAt(clamp(focus.z, 0, JOURNEY)).a.id, sky.isNight);
  sky.visibility = weather.vis;
  car.weatherGrip = weather.grip;
  grass.setWind(weather.wind);
  WIND.uTime.value += dt;
  WIND.uStrength.value = 0.05 + weather.wind * 0.55;

  poseCar(game.carMesh, car);
  if (game.carMesh.userData.interior) {
    game.carMesh.userData.interior.visible = chase.mode === 'dash';
  }
  game.lights.update(sky.daylight < 0.55);   // on through dawn and dusk, not just full dark
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
  THREE, scene, camera, renderer, car, terrain, scatter, grass, sky, post,
  get carMesh() { return game.carMesh; },
  garage,
  chase, controls, hud, quality: QUALITY,
  fuel, stations, tasks, foot, interact, weather, animals, water, landmarks, finale, ending, save, audio, secrets,
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
  setWeather(name) { weather.set(name, true); weather.hold = 1e9; },
  freezeClock(v = true) { sky.flow = !v; },
  drive(input, seconds = 1) {
    const n = Math.max(1, Math.round(seconds / STEP));
    for (let i = 0; i < n; i++) car.update(STEP, input);
    terrain.update(car.pos.x, car.pos.z, 8);
    scatter.update(car.pos.x, car.pos.z, 4);
    grass.update(STEP * n, car.pos.x, car.pos.z, 12);
    chase.update(0.016, car);
    poseCar(game.carMesh, car);
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
