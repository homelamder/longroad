import { VALLEY } from '../world/valley.js';
import { JOURNEY } from '../world/biomes.js';

// The arrival. Crossing the gate at the end of the road starts the finale: light
// settles into a permanent gold, the card comes up with the journey's numbers, and
// then the valley is yours to wander. Nothing is taken away — the game continues.

export class Ending {
  constructor({ hud, sky, weather, fuel }) {
    this.hud = hud;
    this.sky = sky;
    this.weather = weather;
    this.fuel = fuel;
    this.arrived = false;
    this.shown = false;

    // The journey ledger, updated by main.
    this.stats = {
      metres: 0,
      tasks: 0,
      days: 0,
      startedAt: Date.now(),
    };
    this._lastTime = null;

    this.buildCard();
  }

  track(dt, car, sky) {
    this.stats.metres += Math.abs(car.speed) * dt;
    if (this._lastTime !== null && sky.time < this._lastTime - 0.5) this.stats.days++;
    this._lastTime = sky.time;
  }

  taskDone() { this.stats.tasks++; }

  // Called every frame with the car's position; fires once.
  update(car, garage) {
    if (this.arrived) return;
    const pastGate =
      (car.pos.x - VALLEY.endX) * VALLEY.dirX + (car.pos.z - VALLEY.endZ) * VALLEY.dirZ > 24;
    if (!pastGate) return;

    this.arrived = true;
    // Perpetual first-morning light; the valley has no weather to survive.
    this.sky.setTime(0.30);
    this.sky.flow = false;
    this.weather.set('clear');
    this.weather.hold = 1e9;
    this.fuel.fill();                 // the valley never asks for another task

    const s = this.stats;
    const hours = Math.max(1, Math.round((Date.now() - s.startedAt) / 60000));
    this.card.querySelector('.end-stats').innerHTML = [
      `${(Math.max(s.metres, JOURNEY) / 1000).toFixed(1)} km driven`,
      `${s.tasks} ${s.tasks === 1 ? 'kindness' : 'kindnesses'} done along the way`,
      `${garage.count} of 15 cars found`,
      `${s.days + 1} ${s.days ? 'days and nights' : 'long day'} on the road`,
      `${hours} ${hours === 1 ? 'minute' : 'minutes'} of your time — thank you`,
    ].map((l) => `<span>${l}</span>`).join('');

    setTimeout(() => {
      this.card.classList.add('show');
      this.shown = true;
    }, 2600);
  }

  buildCard() {
    const el = document.createElement('div');
    el.className = 'end-card';
    el.innerHTML = `
      <div class="end-inner">
        <p class="end-kicker">the road ends where the world begins</p>
        <h1>The Long Road</h1>
        <div class="end-stats"></div>
        <button class="end-continue">keep wandering</button>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('.end-continue').addEventListener('click', () => {
      el.classList.remove('show');
    });
    this.card = el;
  }
}
