import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Stations } from '../src/game/stations.js';
import { TaskManager, Marker, Interact } from '../src/game/tasks/index.js';
import { FIRST_TASKS } from '../src/game/tasks/firstthree.js';
import { CREATURE_TASKS } from '../src/game/tasks/creatures.js';
import { DRIVING_TASKS } from '../src/game/tasks/driving.js';
import { SURVIVAL_TASKS } from '../src/game/tasks/survival.js';
import { WONDER_TASKS } from '../src/game/tasks/wonders.js';
import { Car, DEFAULT_CAR } from '../src/car/physics.js';
import { OnFoot } from '../src/player/onfoot.js';
import { Animals } from '../src/animals/animals.js';
import { Weather } from '../src/world/weather.js';
import { Landmarks, CAVE_SITES } from '../src/world/landmarks.js';
import { biomeAt } from '../src/world/biomes.js';
import { pointAt } from '../src/world/road.js';
import { elevation } from '../src/world/terrain.js';
import { STATION_POSITIONS } from '../src/game/stations.js';

// Every one of the sixteen tasks, driven start to completion through the same
// interfaces the player uses. Each task runs at a station inside its own biome.

const ALL = [...FIRST_TASKS, ...CREATURE_TASKS, ...DRIVING_TASKS, ...SURVIVAL_TASKS, ...WONDER_TASKS];
assert.equal(ALL.length, 19, `expected 19 tasks, have ${ALL.length}`);

// A station in each biome (by along-distance ranges of the regions).
const stationIn = (list, lo, hi) => list.find((s) => s.along > lo && s.along < hi);

const DT = 1 / 30;

function makeWorld() {
  const scene = new THREE.Scene();
  const stations = new Stations(scene);
  const hud = {
    setTask() {}, setObjective() {}, setPrompt() {}, note() {}, setFuel() {},
  };
  const controls = { onAction: null, showAction() {} };
  const interact = new Interact(hud, controls);
  const marker = new Marker(scene);
  const car = new Car(DEFAULT_CAR);
  const foot = new OnFoot();
  const animals = new Animals(scene);
  const weather = new Weather(scene);
  const landmarks = new Landmarks(scene);
  const sky = {
    isNight: false, time: 0.5, daylight: 1,
    setTime(t) { this.time = t; },
  };
  const chase = { mode: 'chase', snap() {} };
  const ctx = {
    scene, car, foot, hud, marker, interact, chase, station: null,
    animals, weather, sky, landmarks, biomeAt,
  };
  const mgr = new TaskManager(ALL, ctx);
  return { scene, stations, hud, controls, interact, marker, car, foot, animals, weather, landmarks, sky, ctx, mgr };
}

// The generic on-foot player: teleport to the current interactable, press the
// button, let the world tick.
function footStep(w) {
  const t = w.interact.current;
  if (t) {
    w.foot.pos.set(t.x, elevation(t.x, t.z), t.z);
    w.foot.moving = 0;
    w.controls.onAction();
  }
}

function run(taskId, station, opts = {}) {
  const w = makeWorld();
  const task = ALL.find((t) => t.id === taskId);
  assert.ok(task, `no task ${taskId}`);
  if (opts.night) w.sky.isNight = true;

  w.car.placeOnRoad(station.along);
  w.mgr.begin(task, station);

  const maxSteps = opts.maxSteps || 12000;
  let steps = 0;
  while (w.mgr.busy && steps < maxSteps) {
    steps++;
    if (opts.drive) opts.drive(w, task, steps);
    else if (steps % 10 === 0) footStep(w);
    w.mgr.update(DT);
    const focus = w.mgr.mode === 'drive' ? w.car.pos : w.foot.pos;
    w.animals.update(DT, focus, opts.playerSpeed ?? 0);
    w.weather.update(DT, focus, focus.z);
  }
  assert.ok(!w.mgr.busy, `${taskId} never completed (${steps}/${maxSteps} steps)`);
  assert.equal(w.mgr.mode, 'drive', `${taskId} left the player on foot`);
  return { w, steps };
}

const st = new Stations(new THREE.Scene()).list;
const verdant = stationIn(st, 200, 2000);
const duskwood = stationIn(st, 2300, 4200);
const emberfall = stationIn(st, 4400, 6300);
const whisper = stationIn(st, 6600, 8500);
const frostveil = stationIn(st, 8800, 10600);
const marsh = stationIn(st, 11000, 12800);
const ashen = stationIn(st, 13000, 14900);
assert.ok(verdant && duskwood && emberfall && whisper && frostveil && marsh && ashen,
  'missing a station in some biome');

// --- on-foot tasks, generic driver ------------------------------------------
run('firewatch', verdant);
run('clear-road', duskwood);
run('find-water', whisper);
run('feed-goats', verdant);
run('free-animal', duskwood);
run('lanterns', marsh, { night: true });
run('seed-canopy', whisper);
run('bridge', duskwood);

// round-up: shoo three strays, then the escort walks them home — takes sim time.
run('round-up', verdant, { maxSteps: 20000 });

// The new wonder tasks: two on foot via the generic driver, one chase by car.
run('stargazer', duskwood, { night: true });
run('log-jam', whisper);
run('runaway', verdant, {
  maxSteps: 24000,
  drive(w, task) {
    const g = task.goal;
    const d = Math.hypot(w.car.pos.x - g.x, w.car.pos.z - g.z);
    // Creep in: slow enough never to spook it, fast enough to close.
    if (d > 10) {
      const step = 4.5 * (1 / 30);
      w.car.pos.x += ((g.x - w.car.pos.x) / d) * step;
      w.car.pos.z += ((g.z - w.car.pos.z) / d) * step;
      w.car.speed = 4.5;
    } else {
      w.car.speed = 0;
    }
  },
});

// photograph: the generic driver already teleports gently (moving = 0).
run('photograph', verdant, { maxSteps: 16000 });

// --- driving tasks, scripted drivers ----------------------------------------
run('dust-run', emberfall, {
  drive(w, task) {
    // Approach the waymarker at speed.
    const g = task.goal;
    const d = Math.hypot(w.car.pos.x - g.x, w.car.pos.z - g.z);
    if (d > 14) {
      const step = 24 * DT;
      w.car.pos.x += ((g.x - w.car.pos.x) / d) * step;
      w.car.pos.z += ((g.z - w.car.pos.z) / d) * step;
      w.car.speed = 24;
    }
  },
});

run('avalanche', frostveil, {
  drive(w, task) {
    const g = task.goal;
    const d = Math.hypot(w.car.pos.x - g.x, w.car.pos.z - g.z);
    if (d > 14) {
      const step = 22 * DT;
      w.car.pos.x += ((g.x - w.car.pos.x) / d) * step;
      w.car.pos.z += ((g.z - w.car.pos.z) / d) * step;
      w.car.speed = 22;
    }
  },
});

// Ford: creep across between the banks under the speed limit.
{
  const { w } = run('ford-river', whisper, {
    drive(w2, task, steps) {
      const along = task.entry - 14 + steps * DT * 3.2;
      const p = pointAt(Math.min(along, task.exit + 10));
      w2.car.pos.set(p.x, p.y + 0.6, p.z);
      w2.car.speed = 3.2;                       // ~11.5 km/h — under the limit
    },
  });
  void w;
}

// Ford at speed must throw you back to the entry, not complete.
{
  const w = makeWorld();
  const task = ALL.find((t) => t.id === 'ford-river');
  w.car.placeOnRoad(whisper.along);
  w.mgr.begin(task, whisper);
  const p = pointAt(task.entry + 6);
  w.car.pos.set(p.x, p.y + 0.6, p.z);
  w.car.speed = 12;                             // 43 km/h through the water
  w.mgr.update(DT);
  assert.ok(w.car.along < task.entry - 5, 'speeding through the ford was not punished');
  assert.ok(w.mgr.busy, 'ford completed despite the flooded engine');
  task.cleanup(w.ctx);
}

run('ash-shelter', ashen, {
  maxSteps: 16000,
  drive(w, task) {
    // Drive to the overhang, then sit dead still.
    const d = Math.hypot(w.car.pos.x - task.spot.x, w.car.pos.z - task.spot.z);
    if (d > 4) {
      const step = 16 * DT;
      w.car.pos.x += ((task.spot.x - w.car.pos.x) / d) * step;
      w.car.pos.z += ((task.spot.z - w.car.pos.z) / d) * step;
      w.car.speed = 16;
    } else {
      w.car.speed = 0;
    }
  },
});

// Cave night: drive to the cave, then the generic foot driver tends the fire.
{
  const { w } = run('cave-night', frostveil, {
    night: true,
    maxSteps: 30000,
    drive(w2, task, steps) {
      if (task.phase === 'drive') {
        w2.car.pos.set(task.cave.x + 10, task.cave.y, task.cave.z);
        w2.car.speed = 0;
      } else if (steps % 10 === 0) {
        footStep(w2);
      }
    },
  });
  // Dawn must have broken.
  assert.ok(Math.abs(w.sky.time - 0.27) < 0.01, 'cave night did not end at first light');
}

// Guide the herd: crawl ahead of the flock all the way to the fold.
{
  const { w, steps } = run('guide-herd', duskwood, {
    night: true,
    maxSteps: 40000,
    drive(w2, task) {
      // Stay just ahead of the herd, at lantern pace, aimed at the fold.
      let cx = 0, cz = 0;
      for (const a of task.herd.animals) { cx += a.x; cz += a.z; }
      cx /= task.herd.animals.length; cz /= task.herd.animals.length;
      const fx = task.fold.x - cx, fz = task.fold.z - cz;
      const fd = Math.hypot(fx, fz) || 1;
      w2.car.pos.set(cx + (fx / fd) * 16, 0, cz + (fz / fd) * 16);
      w2.car.speed = 1.9;
    },
  });
  assert.ok(steps > 400, 'herd arrived suspiciously fast');
}

// --- offer pools ------------------------------------------------------------
// Every station must be able to offer at least one task at any hour.
{
  const w = makeWorld();
  for (const s of STATION_POSITIONS) {
    for (const night of [false, true]) {
      const t = w.mgr.pick(s, { isNight: night });
      assert.ok(t, `no task offered at ${s} (night=${night})`);
      const here = biomeAt(s).a.id;
      assert.ok(t.biomes === 'any' || t.biomes.includes(here),
        `${t.id} offered outside its biomes at ${s}`);
      assert.ok(t.time === 'any' || t.time === (night ? 'night' : 'day'),
        `${t.id} offered at the wrong hour at ${s}`);
    }
  }
}

// The cave task must have a cave within driving reach of every Frostveil station.
for (const s of st.filter((x) => x.along > 8700 && x.along < 10700)) {
  const nearest = Math.min(...CAVE_SITES.map((c) => Math.abs(c - s.along)));
  assert.ok(nearest < 700, `station at ${s.along} is ${nearest} m from the nearest cave`);
}

console.log(`tasks ok — all ${ALL.length} tasks complete via player interfaces`);
