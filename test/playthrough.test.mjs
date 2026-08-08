import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Car } from '../src/car/physics.js';
import { ROSTER, specFor } from '../src/car/cars.js';
import { Fuel } from '../src/game/fuel.js';
import { STATION_RADIUS } from '../src/game/stations.js';
import { Stations } from '../src/game/stations.js';
import { TaskManager, Marker, Interact } from '../src/game/tasks/index.js';
import { FIRST_TASKS } from '../src/game/tasks/firstthree.js';
import { CREATURE_TASKS } from '../src/game/tasks/creatures.js';
import { DRIVING_TASKS } from '../src/game/tasks/driving.js';
import { SURVIVAL_TASKS } from '../src/game/tasks/survival.js';
import { OnFoot } from '../src/player/onfoot.js';
import { Animals } from '../src/animals/animals.js';
import { Weather } from '../src/world/weather.js';
import { Landmarks } from '../src/world/landmarks.js';
import { biomeAt } from '../src/world/biomes.js';
import { nearest, pointAt, ROAD_LENGTH } from '../src/world/road.js';
import { elevation } from '../src/world/terrain.js';
import { VALLEY } from '../src/world/valley.js';
import { Ending } from '../src/game/ending.js';
import { Save } from '../src/game/save.js';

// The whole game, front to back, in simulation: drive the entire road with real
// physics, run out of fuel, stop at stations, complete real tasks for real refills,
// and arrive in the valley. If any part of the loop cannot sustain the journey,
// this is where it surfaces.

// Ending/Save construct DOM UI; give node just enough of one.
global.document = {
  createElement: () => ({
    className: '', innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {}, addEventListener() {},
    querySelector: () => ({
      innerHTML: '', textContent: '', classList: { add() {}, remove() {} }, addEventListener() {},
    }),
    querySelectorAll: () => [],
  }),
  body: { appendChild() {} },
  visibilityState: 'visible',
};
global.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.get(k) ?? null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};
global.addEventListener = () => {};

const ALL = [...FIRST_TASKS, ...CREATURE_TASKS, ...DRIVING_TASKS, ...SURVIVAL_TASKS];
const DT = 1 / 60;

const scene = new THREE.Scene();
const stations = new Stations(scene);
const hud = { setTask() {}, setObjective() {}, setPrompt() {}, note() {}, setFuel() {} };
const controls = { onAction: null, showAction() {} };
const interact = new Interact(hud, controls);
const marker = new Marker(scene);
const car = new Car(specFor(ROSTER[0]));
const foot = new OnFoot();
const animals = new Animals(scene);
const weather = new Weather(scene);
const landmarks = new Landmarks(scene);
const sky = { isNight: false, time: 0.4, daylight: 1, flow: true, setTime(t) { this.time = t; } };
const chase = { mode: 'chase', snap() {} };
const fuel = new Fuel();
const mgr = new TaskManager(ALL, {
  scene, car, foot, hud, marker, interact, chase, station: null,
  animals, weather, sky, landmarks, biomeAt,
});
const ending = new Ending({ hud, sky, weather, fuel });
const save = new Save({ car, fuel, sky, stations, ending });

car.placeOnRoad(40);

function steerToRoad() {
  const r = nearest(car.pos.x, car.pos.z);
  const t = pointAt(Math.min(r.along + 26, ROAD_LENGTH));
  const want = Math.atan2(t.x - car.pos.x, t.z - car.pos.z);
  const err = ((want - car.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return Math.max(-1, Math.min(1, err * 2.4));
}

// The player brain: drive the road; when fuel is low, stop at the next station and
// do whatever task it offers through the real interfaces.
let simSeconds = 0;
let stops = 0;
const tasksSeen = new Set();
let taskSteps = 0;
let target = null;                  // station currently being pulled into

const MAX_SIM = 9000;               // 150 sim-minutes: the brain sometimes rolls several slow tasks
let lastLog = 0;
while (car.along < ROAD_LENGTH - 60 && simSeconds < MAX_SIM) {
  if (process.env.PT_DEBUG && simSeconds - lastLog > 120) {
    lastLog = simSeconds;
    console.log(`[${(simSeconds / 60).toFixed(1)}m] ${(car.along / 1000).toFixed(2)} km`,
      'fuel', fuel.level.toFixed(0), 'task', mgr.active?.task.id || '-',
      'mode', mgr.mode, 'target', target?.along ?? '-');
  }
  simSeconds += DT;
  sky.time = (sky.time + DT / 240) % 1;          // fast days: hit both hours
  sky.isNight = sky.time < 0.22 || sky.time > 0.78;
  sky.daylight = sky.isNight ? 0 : 1;

  if (mgr.busy) {
    // Generic solver: teleport whoever is active to the objective and press E;
    // drive tasks get the car placed at their goal.
    taskSteps++;
    const t = interact.current;
    const task = mgr.active.task;
    if (task.goal && mgr.mode === 'drive') {
      const d = Math.hypot(car.pos.x - task.goal.x, car.pos.z - task.goal.z);
      if (d > 13) {
        car.pos.x += ((task.goal.x - car.pos.x) / d) * 22 * DT;
        car.pos.z += ((task.goal.z - car.pos.z) / d) * 22 * DT;
        car.speed = 22;
      }
    } else if (task.id === 'ford-river' && mgr.mode === 'drive') {
      const along = car.along + 3.0 * DT;
      const p = pointAt(along);
      car.pos.set(p.x, p.y + 0.6, p.z);
      car.speed = 3.0;
    } else if (task.id === 'ash-shelter' && mgr.mode === 'drive') {
      const d = Math.hypot(car.pos.x - task.spot.x, car.pos.z - task.spot.z);
      if (d > 4) {
        car.pos.x += ((task.spot.x - car.pos.x) / d) * 15 * DT;
        car.pos.z += ((task.spot.z - car.pos.z) / d) * 15 * DT;
        car.speed = 15;
      } else car.speed = 0;
    } else if (task.id === 'cave-night' && task.phase === 'drive') {
      car.pos.set(task.cave.x + 9, task.cave.y, task.cave.z);
      car.speed = 0;
    } else if (task.id === 'guide-herd') {
      let cx = 0, cz = 0;
      for (const a of task.herd.animals) { cx += a.x; cz += a.z; }
      cx /= task.herd.animals.length; cz /= task.herd.animals.length;
      const fx = task.fold.x - cx, fz = task.fold.z - cz;
      const fd = Math.hypot(fx, fz) || 1;
      car.pos.set(cx + (fx / fd) * 16, 0, cz + (fz / fd) * 16);
      car.speed = 1.9;
    } else if (t && taskSteps % 8 === 0) {
      foot.pos.set(t.x, elevation(t.x, t.z), t.z);
      foot.moving = 0;
      controls.onAction();
    }
    if (mgr.update(DT) === 'done') {
      fuel.fill();
      ending.taskDone();
      target = null;
    }
    animals.update(DT, mgr.mode === 'drive' ? car.pos : foot.pos, 0);
    weather.update(DT, car.pos, car.pos.z);
    continue;
  }

  // Choose: refuel or drive on. Stations sit 12 m off the tarmac, so the brain must
  // actually steer off the road to the pump — the same radius the game itself uses.
  if (!target && fuel.fraction < 0.4) target = stations.next(car.along - 20);
  let input;
  const td = target ? Math.hypot(car.pos.x - target.x, car.pos.z - target.z) : Infinity;
  if (td < STATION_RADIUS - 1) {
    input = { throttle: 0, brake: 1, steer: 0, handbrake: false };
    if (Math.abs(car.speed) < 1.5) {
      const task = mgr.pick(target.along, sky);
      tasksSeen.add(task.id);
      stops++;
      taskSteps = 0;
      mgr.begin(task, target);
      continue;
    }
  } else if (target && Math.abs(target.along - car.along) < 130) {
    // Close: aim straight at the pump, slow down.
    const want = Math.atan2(target.x - car.pos.x, target.z - car.pos.z);
    const err = ((want - car.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    input = {
      throttle: car.speed > 9 ? 0 : 0.5,
      brake: car.speed > 11 ? 0.6 : 0,
      steer: Math.max(-1, Math.min(1, err * 2.4)), handbrake: false,
    };
  } else {
    input = { throttle: 1, brake: 0, steer: steerToRoad(), handbrake: false };
  }

  car.weatherGrip = weather.grip;
  car.update(DT, input);
  fuel.update(DT, car, input.throttle);
  fuel.capSpeed(car);
  weather.update(DT, car.pos, car.pos.z);
  ending.track(DT, car, sky);
  ending.update(car, { count: 1 });
  save.update(DT);

  assert.ok(Number.isFinite(car.pos.x + car.speed), `NaN at ${simSeconds.toFixed(0)}s`);
}

assert.ok(car.along >= ROAD_LENGTH - 60,
  `never reached the end: ${(car.along / 1000).toFixed(1)} km after ${simSeconds.toFixed(0)}s sim`);
assert.ok(stops >= 4, `only ${stops} fuel stops on a full journey`);
assert.ok(tasksSeen.size >= 3, `only ${[...tasksSeen]} tasks encountered`);
// Finishing the last leg on reserve is legitimate — the reserve is designed so a
// player can always limp home. Arrival must then retire fuel pressure for good.

// Cross the gate: the ending must fire.
{
  const p = { x: VALLEY.endX + VALLEY.dirX * 40, z: VALLEY.endZ + VALLEY.dirZ * 40 };
  car.pos.set(p.x, elevation(p.x, p.z) + 0.6, p.z);
  ending.update(car, { count: 3 });
  assert.ok(ending.arrived, 'drove past the gate and nothing happened');
  assert.equal(fuel.fraction, 1, 'arrival did not retire fuel pressure');
}

// Save round-trip: write, mutate, restore.
{
  save.write();
  const along = car.along;
  const time = sky.time;
  car.placeOnRoad(500);
  sky.setTime(0.1);
  const ok = save.restore();
  assert.ok(ok, 'save did not restore');
  assert.ok(Math.abs(car.along - Math.round(along)) < 60, `resume position off: ${car.along} vs ${along}`);
  assert.ok(Math.abs(sky.time - time) < 0.01, 'resume time off');
}

console.log(`playthrough ok — ${(ROAD_LENGTH / 1000).toFixed(1)} km driven in `
  + `${(simSeconds / 60).toFixed(1)} sim-minutes, ${stops} stops, `
  + `tasks: ${[...tasksSeen].join(', ')} · arrival + save verified`);
