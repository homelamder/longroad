import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ROSTER, specFor } from './cars.js';
import { buildCarBody } from './generator.js';
import { addHeadlights, poseCar } from './body.js';
import { pointAt } from '../world/road.js';
import { STATION_POSITIONS } from '../game/stations.js';
import { elevation } from '../world/terrain.js';

// Finds, unlocks, and the garage screen. Unlocks persist in localStorage; the
// world shows every not-yet-claimed car parked where its roster entry says.

const KEY_UNLOCKS = 'lr.unlocks';
const KEY_CURRENT = 'lr.car';

export class Garage {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;             // { car, carMesh, lights, hud, interact, chase }
    this.unlocked = new Set(JSON.parse(localStorage.getItem(KEY_UNLOCKS) || '["trailhand"]'));
    this.loader = new GLTFLoader();

    // Park every unclaimed car in the world.
    this.parked = [];
    for (const entry of ROSTER) {
      if (!entry.where || this.unlocked.has(entry.id)) continue;
      const spec = specFor(entry);
      let x, z, ry;
      if (entry.where.station != null) {
        const p = pointAt(STATION_POSITIONS[entry.where.station] ?? STATION_POSITIONS[0]);
        x = p.x + p.rx * 18; z = p.z + p.rz * 18;
        ry = Math.atan2(p.rx, p.rz) + Math.PI / 2;
      } else {
        const p = pointAt(entry.where.hidden);
        x = p.x + p.rx * entry.where.side * entry.where.dist;
        z = p.z + p.rz * entry.where.side * entry.where.dist;
        ry = (entry.where.hidden * 7919) % 6.28;
      }
      const mesh = buildCarBody(spec);
      mesh.position.set(x, elevation(x, z), z);
      mesh.rotation.y = ry;
      scene.add(mesh);
      this.parked.push({ entry, mesh, x, z });
    }

    this.buildUI();
    this.open = false;
  }

  // --- world side -----------------------------------------------------------
  // Claim prompts are handled by the caller (main loop) via nearestFind().
  nearestFind(pos) {
    let best = null, bd = Infinity;
    for (const p of this.parked) {
      const d = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best && bd < 10 ? best : null;
  }

  claim(find) {
    this.unlocked.add(find.entry.id);
    localStorage.setItem(KEY_UNLOCKS, JSON.stringify([...this.unlocked]));
    this.scene.remove(find.mesh);
    this.parked.splice(this.parked.indexOf(find), 1);
    this.game.hud.note(`${find.entry.name} — added to your keys`, 4);
    this.refreshList();
  }

  get lastSelected() { return localStorage.getItem(KEY_CURRENT) || 'trailhand'; }

  // Swap the player into a different roster car, in place.
  select(id) {
    if (!this.unlocked.has(id)) return false;
    const entry = ROSTER.find((e) => e.id === id);
    if (!entry) return false;
    const g = this.game;
    const spec = specFor(entry);

    const apply = (mesh) => {
      const old = g.carMesh;
      this.scene.remove(old);
      g.carMesh = mesh;
      this.scene.add(mesh);
      g.car.spec = { ...g.car.spec, ...spec };
      g.lights = addHeadlights(mesh, spec);
      poseCar(mesh, g.car);
      localStorage.setItem(KEY_CURRENT, id);
    };

    if (entry.model) {
      // Drop-in .glb: use it if it loads, fall back to the generated body if not.
      this.loader.load(entry.model, (gltf) => {
        const mesh = gltf.scene;
        mesh.traverse((o) => { o.castShadow = true; });
        // A bare glb has none of the generator's userData; give poseCar what it needs.
        mesh.userData.wheels = [];
        mesh.userData.brakeMaterial = { emissiveIntensity: 0 };
        mesh.userData.headMaterial = { emissiveIntensity: 0 };
        apply(mesh);
      }, undefined, () => apply(buildCarBody(spec)));
    } else {
      apply(buildCarBody(spec));
    }
    return true;
  }

  // --- UI side --------------------------------------------------------------
  buildUI() {
    const el = document.createElement('div');
    el.className = 'garage';
    el.innerHTML = `
      <div class="garage-panel">
        <header><h2>The Keys</h2><button class="garage-close" aria-label="Close">×</button></header>
        <div class="garage-list"></div>
      </div>`;
    document.body.appendChild(el);
    this.el = el;
    this.list = el.querySelector('.garage-list');
    el.querySelector('.garage-close').addEventListener('click', () => this.toggle(false));
    el.addEventListener('click', (e) => { if (e.target === el) this.toggle(false); });
    this.refreshList();
  }

  refreshList() {
    const current = this.lastSelected;
    this.list.innerHTML = ROSTER.map((e) => {
      const owned = this.unlocked.has(e.id);
      const spec = specFor(e);
      const bars = owned ? `
        <div class="garage-bars">
          <i style="--v:${Math.min(1, spec.power / 14)}" title="power"></i>
          <i style="--v:${Math.min(1, spec.topSpeed / 70)}" title="speed"></i>
          <i style="--v:${Math.min(1, spec.grip / 6.5)}" title="grip"></i>
        </div>` : '';
      return `
        <button class="garage-card${owned ? '' : ' locked'}${e.id === current ? ' current' : ''}"
          data-id="${e.id}" ${owned ? '' : 'disabled'}>
          <span class="garage-swatch" style="background:#${(e.body.paint ?? 0x888888).toString(16).padStart(6, '0')}"></span>
          <span class="garage-name">${owned ? e.name : '· · ·'}</span>
          <span class="garage-class">${owned ? e.class : 'somewhere out there'}</span>
          ${owned ? `<span class="garage-blurb">${e.blurb}</span>` : ''}
          ${bars}
        </button>`;
    }).join('');
    for (const b of this.list.querySelectorAll('.garage-card:not(.locked)')) {
      b.addEventListener('click', () => {
        this.select(b.dataset.id);
        this.toggle(false);
      });
    }
  }

  toggle(want = !this.open) {
    this.open = want;
    this.el.classList.toggle('show', want);
    if (want) this.refreshList();
  }

  get count() { return this.unlocked.size; }
}
