import { JOURNEY, biomeAt } from '../world/biomes.js';
import { clamp } from '../world/rng.js';

const clock = (t) => {
  const mins = Math.round(((t % 1) + 1) % 1 * 1440);
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export class Hud {
  constructor(root = document.body) {
    const el = document.createElement('div');
    el.className = 'hud';
    el.innerHTML = `
      <div class="hud-region">
        <span class="hud-region-name">—</span>
        <div class="hud-progress"><i></i></div>
        <div class="hud-meta"><span class="hud-dist">0.0 km</span><span class="hud-clock">—</span></div>
      </div>
      <div class="hud-task">
        <span class="hud-task-name"></span>
        <span class="hud-objective"></span>
      </div>
      <div class="hud-fuel"><b>FUEL</b><div class="hud-fuel-bar"><i></i></div><em class="hud-cans"></em></div>
      <div class="hud-speed"><b>0</b><span>km/h</span></div>
      <div class="hud-prompt"><kbd>E</kbd><span></span></div>
      <div class="hud-note" aria-live="polite"></div>
      <div class="hud-hint">W/S drive · A/D steer · Space handbrake · E interact · G garage · C camera · R recover · M sound · V predators</div>`;
    root.appendChild(el);
    this.name = el.querySelector('.hud-region-name');
    this.bar = el.querySelector('.hud-progress i');
    this.dist = el.querySelector('.hud-dist');
    this.clockEl = el.querySelector('.hud-clock');
    this.speed = el.querySelector('.hud-speed b');
    this.taskEl = el.querySelector('.hud-task');
    this.taskName = el.querySelector('.hud-task-name');
    this.objective = el.querySelector('.hud-objective');
    this.fuelBar = el.querySelector('.hud-fuel-bar i');
    this.fuelWrap = el.querySelector('.hud-fuel');
    this.cans = el.querySelector('.hud-cans');
    this.promptEl = el.querySelector('.hud-prompt');
    this.promptText = el.querySelector('.hud-prompt span');
    this.noteEl = el.querySelector('.hud-note');
    this.hint = el.querySelector('.hud-hint');
    this.el = el;
    this._region = '';
    this._kmh = -1;
    this._pct = -1;
    this._clock = '';
    this._fuel = -1;
    this._prompt = null;
    this.isTouch = matchMedia('(pointer: coarse)').matches;
    if (this.isTouch) {
      this.hint.remove();
      this.promptEl.querySelector('kbd').remove();
    }
  }

  note(text, seconds = 4) {
    this.noteEl.textContent = text;
    this.noteEl.classList.add('show');
    clearTimeout(this._noteTimer);
    this._noteTimer = setTimeout(() => this.noteEl.classList.remove('show'), seconds * 1000);
  }

  setTask(name) {
    this.taskName.textContent = name || '';
    this.taskEl.classList.toggle('show', !!name);
    if (!name) this.objective.textContent = '';
  }

  setObjective(text) { this.objective.textContent = text || ''; }

  // near shows the actionable prompt; far shows nothing. Passing null hides it.
  setPrompt(nearLabel) {
    if (nearLabel === this._prompt) return;
    this._prompt = nearLabel;
    this.promptEl.classList.toggle('show', !!nearLabel);
    if (nearLabel) this.promptText.textContent = nearLabel;
  }

  setFuel(fraction, jerrycans, onReserve) {
    const pct = Math.round(fraction * 100);
    if (pct !== this._fuel) {
      this._fuel = pct;
      this.fuelBar.style.transform = `scaleX(${fraction})`;
      this.fuelWrap.classList.toggle('low', fraction < 0.22 && fraction > 0);
      this.fuelWrap.classList.toggle('reserve', onReserve);
    }
    const cans = jerrycans > 0 ? `+${jerrycans}` : '';
    if (cans !== this.cans.textContent) this.cans.textContent = cans;
  }

  update(car, sky) {
    const kmh = Math.round(car.kmh);
    if (kmh !== this._kmh) { this.speed.textContent = kmh; this._kmh = kmh; }

    const along = clamp(car.pos.z, 0, JOURNEY);
    const region = biomeAt(along).a.name;
    if (region !== this._region) { this.name.textContent = region; this._region = region; }

    const pct = Math.round((along / JOURNEY) * 1000) / 10;
    if (pct !== this._pct) {
      this.bar.style.transform = `scaleX(${pct / 100})`;
      this.dist.textContent = `${(along / 1000).toFixed(1)} / ${(JOURNEY / 1000).toFixed(1)} km`;
      this._pct = pct;
    }

    if (sky) {
      const t = clock(sky.time);
      if (t !== this._clock) { this.clockEl.textContent = t; this._clock = t; }
    }
  }
}
