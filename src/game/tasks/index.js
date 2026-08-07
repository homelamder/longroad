import * as THREE from 'three';
import { biomeAt } from '../../world/biomes.js';
import { clamp } from '../../world/rng.js';

// The task system. A station picks one task valid for where you are and what time
// it is; completing it fills the tank. Tasks share this contract:
//
//   { id, name, biomes: ['verdant', ...] | 'any', time: 'any'|'day'|'night',
//     start(ctx), update(dt, ctx) -> 'running'|'done', cleanup(ctx) }
//
// ctx gives a task: scene, car, foot, hud, marker, interact, rng, station,
// and helpers for ground height. Tasks own their props and MUST remove them in
// cleanup — the world streams, tasks do not.

// One objective marker, reused by every task: a soft column of light plus a
// floating diamond, the universal "go here".
export class Marker {
  constructor(scene) {
    const col = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 1.1, 26, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffd987, transparent: true, opacity: 0.16,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    col.position.y = 13;
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.42),
      new THREE.MeshBasicMaterial({ color: 0xffd987 }),
    );
    gem.position.y = 2.6;
    this.group = new THREE.Group();
    this.group.add(col, gem);
    this.group.visible = false;
    this.gem = gem;
    this.t = 0;
    scene.add(this.group);
  }

  show(x, y, z) {
    this.group.position.set(x, y, z);
    this.group.visible = true;
  }

  hide() { this.group.visible = false; }

  update(dt) {
    if (!this.group.visible) return;
    this.t += dt;
    this.gem.position.y = 2.6 + Math.sin(this.t * 2.2) * 0.35;
    this.gem.rotation.y += dt * 1.6;
  }
}

export class TaskManager {
  constructor(registry, ctx) {
    this.registry = registry;
    this.ctx = ctx;                       // shared context handed to every task
    this.active = null;
    this.mode = 'drive';                  // 'drive' | 'foot'
    this.offer = null;                    // station currently offering a task
  }

  // Pick a task the current place and hour allows. Random on purpose — the user
  // asked for tasks to surprise, and repeats across 14 stations are fine.
  pick(along, sky) {
    const here = biomeAt(clamp(along, 0, 1e9)).a.id;
    const hour = sky.isNight ? 'night' : 'day';
    const pool = this.registry.filter((t) =>
      (t.biomes === 'any' || t.biomes.includes(here))
      && (t.time === 'any' || t.time === hour));
    if (!pool.length) return this.registry[0];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  begin(task, station) {
    this.active = { task, station };
    this.ctx.station = station;
    this.ctx.hud.setTask(task.name);
    task.start(this.ctx);
    if (task.needsFoot) this.exitCar();
  }

  exitCar() {
    this.mode = 'foot';
    this.ctx.foot.placeBeside(this.ctx.car);
    this.ctx.chase.mode = 'foot';
    this.ctx.chase.snap(this.ctx.foot);
  }

  enterCar() {
    this.mode = 'drive';
    this.ctx.foot.hide();
    this.ctx.chase.mode = 'chase';
    this.ctx.chase.snap(this.ctx.car);
  }

  update(dt) {
    if (!this.active) return null;
    const state = this.active.task.update(dt, this.ctx);
    if (state === 'done') {
      const station = this.active.station;
      this.active.task.cleanup(this.ctx);
      this.ctx.marker.hide();
      this.ctx.hud.setTask(null);
      if (this.mode === 'foot') this.enterCar();
      this.active = null;
      station.used = true;
      return 'done';
    }
    return 'running';
  }

  get busy() { return !!this.active; }
}

// Proximity interaction: the manager owns ONE current interactable at a time.
// Tasks set it, the HUD shows it, E or the action pad fires it.
export class Interact {
  constructor(hud, controls) {
    this.hud = hud;
    this.controls = controls;
    this.current = null;
    this.fired = false;
    controls.onAction = () => { this.fired = true; };
  }

  set(target) {                       // { x,y,z, radius, label, hold? }
    this.current = target;
  }

  clear() {
    this.current = null;
    this.hud.setPrompt(null);
    this.controls.showAction(false);
  }

  // Returns true when the player triggered it within range this frame.
  update(who) {
    const c = this.current;
    if (!c) { this.fired = false; return false; }
    const dx = who.pos.x - c.x, dz = who.pos.z - c.z;
    const near = dx * dx + dz * dz <= c.radius * c.radius;
    this.hud.setPrompt(near ? c.label : null, c.label);
    this.controls.showAction(near);
    const hit = near && this.fired;
    this.fired = false;
    return hit;
  }
}
