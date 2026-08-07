// Save and resume. One small JSON blob, written on a slow timer and on tab-hide.
// Car unlocks and the chosen car already persist via the garage's own keys.

const KEY = 'lr.save';

export class Save {
  constructor({ car, fuel, sky, stations, ending }) {
    this.refs = { car, fuel, sky, stations, ending };
    this.timer = 0;
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.write();
    });
  }

  write() {
    const { car, fuel, sky, stations, ending } = this.refs;
    const blob = {
      v: 1,
      along: Math.round(car.along),
      fuel: Math.round(fuel.level),
      cans: fuel.jerrycans,
      time: +sky.time.toFixed(4),
      used: stations.list.filter((s) => s.used).map((s) => s.index),
      stats: {
        metres: Math.round(ending.stats.metres),
        tasks: ending.stats.tasks,
        days: ending.stats.days,
        startedAt: ending.stats.startedAt,
      },
      arrived: ending.arrived,
    };
    localStorage.setItem(KEY, JSON.stringify(blob));
  }

  // Restore before the first frame. Returns true if there was a run to resume.
  restore() {
    let blob;
    try {
      blob = JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch { blob = null; }
    if (!blob || blob.v !== 1) return false;

    const { car, fuel, sky, stations, ending } = this.refs;
    car.placeOnRoad(Math.max(40, blob.along));
    fuel.level = Math.max(8, blob.fuel);       // never resume stranded at 0
    fuel.jerrycans = blob.cans || 0;
    sky.setTime(blob.time ?? 0.32);
    for (const i of blob.used || []) {
      const s = stations.list[i];
      if (s) s.used = true;
    }
    Object.assign(ending.stats, blob.stats || {});
    // arrived is NOT restored as done — driving back through the gate re-fires the
    // arrival, which is harmless and lets returning players see the card again.
    return true;
  }

  update(dt) {
    this.timer += dt;
    if (this.timer > 6) {
      this.timer = 0;
      this.write();
    }
  }

  static clear() { localStorage.removeItem(KEY); }
}
