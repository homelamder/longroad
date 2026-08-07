// All sound is synthesized — engine, wind, weather, chimes — so the game ships
// without a single audio asset. Everything hangs off one AudioContext that unlocks
// on the first user gesture, as browsers require.

import { clamp, lerp } from './world/rng.js';

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = localStorage.getItem('lr.muted') === '1';

    const unlock = () => {
      if (this.ready) return;
      this.init();
      removeEventListener('pointerdown', unlock);
      removeEventListener('keydown', unlock);
    };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
  }

  init() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);

    // Engine: two detuned saws through a lowpass — reads as a workhorse four-pot.
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    const engFilter = ctx.createBiquadFilter();
    engFilter.type = 'lowpass';
    engFilter.frequency.value = 320;
    this.engOsc = [ctx.createOscillator(), ctx.createOscillator()];
    for (const [i, o] of this.engOsc.entries()) {
      o.type = 'sawtooth';
      o.frequency.value = 55;
      o.detune.value = i * 14;
      o.connect(engFilter);
      o.start();
    }
    engFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engFilter = engFilter;

    // One shared noise buffer feeds wind and weather through different filters.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    const noiseSrc = () => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.start();
      return src;
    };

    // Wind: bandpassed noise, gain follows speed.
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    const windF = ctx.createBiquadFilter();
    windF.type = 'bandpass';
    windF.frequency.value = 480;
    windF.Q.value = 0.6;
    noiseSrc().connect(windF);
    windF.connect(this.windGain);
    this.windGain.connect(this.master);

    // Weather bed: highpassed hiss for rain/storm/blizzard, gain from the weather.
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    const rainF = ctx.createBiquadFilter();
    rainF.type = 'highpass';
    rainF.frequency.value = 1800;
    noiseSrc().connect(rainF);
    rainF.connect(this.rainGain);
    this.rainGain.connect(this.master);

    this.ready = true;
  }

  // A soft two-note chime for completions and finds.
  chime(kind = 'done') {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const notes = kind === 'done' ? [523.25, 784] : kind === 'find' ? [392, 523.25, 659.25] : [659.25];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t = ctx.currentTime + i * 0.14;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      o.connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + 1);
    });
  }

  update(dt, car, weather, driving) {
    if (!this.ready) return;
    const speed = Math.abs(car.speed);

    // Engine pitch from speed, load from throttle-ish accel; idles at a putter.
    const revs = driving ? 55 + speed * 3.6 : 0;
    const target = driving ? clamp(0.06 + speed / 46 * 0.14, 0.06, 0.2) : 0;
    for (const o of this.engOsc) {
      o.frequency.value = lerp(o.frequency.value, Math.max(40, revs), Math.min(1, dt * 6));
    }
    this.engFilter.frequency.value = 280 + speed * 12;
    this.engineGain.gain.value = lerp(this.engineGain.gain.value, target, Math.min(1, dt * 4));

    this.windGain.gain.value = lerp(this.windGain.gain.value,
      clamp((speed - 8) / 38, 0, 1) * 0.16 + weather.wind * 0.05, Math.min(1, dt * 3));

    const wet = ['rain', 'storm', 'blizzard'].includes(weather.stateName)
      ? (weather.stateName === 'storm' ? 0.14 : 0.09) : 0;
    this.rainGain.gain.value = lerp(this.rainGain.gain.value, wet, Math.min(1, dt * 1.5));
  }

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem('lr.muted', this.muted ? '1' : '0');
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }
}
