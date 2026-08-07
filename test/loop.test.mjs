import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Fuel, TANK, RESERVE_SPEED } from '../src/game/fuel.js';
import { Stations, STATION_POSITIONS, STATION_RADIUS } from '../src/game/stations.js';
import { TaskManager, Marker, Interact } from '../src/game/tasks/index.js';
import { FIRST_TASKS, firewatch, clearRoad, findWater } from '../src/game/tasks/firstthree.js';
import { Car, DEFAULT_CAR } from '../src/car/physics.js';
import { OnFoot } from '../src/player/onfoot.js';
import { JOURNEY, BIOMES } from '../src/world/biomes.js';
import { pointAt, nearest } from '../src/world/road.js';
import { elevation } from '../src/world/terrain.js';

// The game loop, headless: fuel drains, stations sit on the roadside, every task
// can be driven from start to done through the same interfaces the player uses.

const DT = 1 / 60;

// --- fuel -------------------------------------------------------------------
{
  const f = new Fuel();
  const car = new Car(DEFAULT_CAR);
  car.placeOnRoad(300);
  car.speed = 25;

  // Full-throttle range must be about one biome leg: at least 1.6 km, at most 4 km.
  let dist = 0;
  while (f.level > 0) { f.update(DT, car, 1); dist += car.speed * DT; }
  assert.ok(dist > 1600 && dist < 4200, `tank range ${dist.toFixed(0)} m is out of tune`);

  // Reserve caps speed instead of stalling.
  assert.ok(f.onReserve);
  f.capSpeed(car);
  assert.equal(car.speed, RESERVE_SPEED, 'reserve does not cap to limp speed');

  // A banked jerrycan pours itself on the frame the tank hits empty.
  const g = new Fuel();
  g.addJerrycan();
  g.level = 0.01;
  const car2 = new Car(DEFAULT_CAR); car2.placeOnRoad(300); car2.speed = 20;
  let event = null;
  for (let i = 0; i < 300 && !event; i++) event = g.update(DT, car2, 1);
  assert.equal(event, 'jerrycan');
  assert.ok(g.level > TANK * 0.3, 'jerrycan did not refill');
  assert.equal(g.jerrycans, 0);

  f.fill();
  assert.equal(f.level, TANK);
  assert.ok(!f.onReserve);
}

// --- stations ---------------------------------------------------------------
{
  // Enough stations that a tank leg always reaches the next one.
  assert.ok(STATION_POSITIONS.length >= 12, `only ${STATION_POSITIONS.length} stations`);
  for (let i = 1; i < STATION_POSITIONS.length; i++) {
    const gap = STATION_POSITIONS[i] - STATION_POSITIONS[i - 1];
    assert.ok(gap < 1700, `stations ${i - 1}->${i} are ${gap} m apart — beyond tank range`);
  }

  const scene = new THREE.Scene();
  const st = new Stations(scene);
  // Every station must stand near the road but off the tarmac, on real ground.
  for (const s of st.list) {
    const r = nearest(s.x, s.z);
    assert.ok(r.dist > 6 && r.dist < 20, `station ${s.index} is ${r.dist.toFixed(1)} m from the road`);
    assert.ok(Math.abs(s.y - elevation(s.x, s.z)) < 0.5, `station ${s.index} floats`);
  }

  // near() finds a station when parked at one, and not from half a kilometre out.
  const s0 = st.list[0];
  assert.ok(st.near({ x: s0.x + 3, z: s0.z + 3 }));
  assert.equal(st.near({ x: s0.x + 500, z: s0.z + 500 }), null);
  assert.equal(st.next(s0.along).index, 1);
}

// --- tasks ------------------------------------------------------------------
// Drive each task from start to done exactly as a player would: walk to the
// current interactable, press the button, repeat.
function runTask(task, stationIndex = 1) {
  const scene = new THREE.Scene();
  const stations = new Stations(scene);
  const station = stations.list[stationIndex];

  const hudStub = {
    prompts: [], objectives: [],
    setTask() {}, setObjective(t) { this.objectives.push(t); },
    setPrompt(t) { this.prompts.push(t); }, note() {},
  };
  const controlsStub = { onAction: null, showAction() {} };
  const interact = new Interact(hudStub, controlsStub);
  const marker = new Marker(scene);
  const car = new Car(DEFAULT_CAR);
  car.placeOnRoad(station.along);
  const foot = new OnFoot();
  const chaseStub = { mode: 'chase', snap() {} };

  const mgr = new TaskManager([task], {
    scene, car, foot, hud: hudStub, marker, interact, chase: chaseStub, station: null,
  });
  mgr.begin(task, station);
  assert.equal(mgr.mode, task.needsFoot ? 'foot' : 'drive', `${task.id} mode`);

  // Player brain: every few frames, teleport to the current objective and press E.
  let steps = 0;
  while (mgr.busy && steps < 4000) {
    steps++;
    const target = interact.current;
    if (target && steps % 12 === 0) {
      foot.pos.set(target.x, elevation(target.x, target.z), target.z);
      controlsStub.onAction();          // the wired handler sets interact.fired
    }
    mgr.update(DT);
    marker.update(DT);
  }
  assert.ok(!mgr.busy, `${task.id} never completed (${steps} steps)`);
  assert.equal(mgr.mode, 'drive', `${task.id} left the player on foot`);
  assert.ok(station.used, `${task.id} did not mark the station used`);
  return { scene, steps };
}

for (const task of [firewatch, clearRoad, findWater]) {
  const { steps } = runTask(task);
  assert.ok(steps > 10, `${task.id} completed suspiciously fast`);
}

// The lit fire outlives its task — the reward is driving away from your own light.
{
  const { scene } = runTask(firewatch, 2);
  let flames = 0;
  scene.traverse((o) => { if (o.isPointLight) flames++; });
  assert.ok(flames >= 1, 'firewatch fire was cleaned away');
}

// Task picking respects biome and hour.
{
  const scene = new THREE.Scene();
  const mgr = new TaskManager(FIRST_TASKS, { scene });
  const daySky = { isNight: false };
  // clear-road excludes verdant/marsh; firewatch and find-water allow anywhere.
  for (let i = 0; i < 40; i++) {
    const t = mgr.pick(600, daySky);              // verdant
    assert.notEqual(t.id, 'clear-road', 'clear-road offered in a biome it excludes');
  }
  const ids = new Set();
  for (let i = 0; i < 60; i++) ids.add(mgr.pick(3400, daySky).id);   // duskwood
  assert.ok(ids.size >= 2, 'duskwood only ever offers one task');
}

console.log(`loop ok — ${STATION_POSITIONS.length} stations, `
  + `${FIRST_TASKS.length} tasks all completable, fuel range in tune`);
