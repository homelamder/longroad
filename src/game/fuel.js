import { clamp } from '../world/rng.js';

// Fuel is the game's heartbeat: a tank is roughly one biome leg, so every region
// asks one task of you. Numbers here are tuned against JOURNEY/7 ≈ 2.1 km legs.
//
// The reserve is the anti-frustration valve. Hitting empty drops you to a crawl —
// it never strands you. Running dry costs time, never the run.

export const TANK = 100;
export const RESERVE_SPEED = 7;          // m/s ≈ 25 km/h limp

// litres per second: a base idle burn plus throttle burn scaled by speed. Tuned
// against the loop test: flat-out at ~25 m/s must empty the tank in 2.2-2.6 km, so
// one tank is one biome leg and every region asks its task.
const IDLE_BURN = 0.22;
const DRIVE_BURN = 0.60;

export class Fuel {
  constructor() {
    this.level = TANK;
    this.jerrycans = 0;                 // banked by optional off-road tasks
    this.onReserve = false;
  }

  update(dt, car, throttle) {
    const burn = IDLE_BURN + DRIVE_BURN * throttle * clamp(Math.abs(car.speed) / 8, 0.2, 1.6);
    this.level = Math.max(0, this.level - burn * dt);

    this.onReserve = this.level <= 0;
    if (this.onReserve && this.jerrycans > 0) {
      // A banked jerrycan pours itself — finding one earlier IS the convenience.
      this.jerrycans--;
      this.level = TANK * 0.35;
      this.onReserve = false;
      return 'jerrycan';
    }
    return null;
  }

  // Reserve does not stall the car; it caps it. The car module never learns about
  // fuel — the cap is applied to its output speed from outside.
  capSpeed(car) {
    if (this.onReserve && car.speed > RESERVE_SPEED) car.speed = RESERVE_SPEED;
  }

  fill() { this.level = TANK; this.onReserve = false; }
  addJerrycan() { this.jerrycans++; }

  get fraction() { return this.level / TANK; }
  get low() { return this.level < TANK * 0.22 && !this.onReserve; }
}
