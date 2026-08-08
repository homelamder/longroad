// All sound is synthesized — engine, wind, weather, chimes — so the game ships
// without a single audio asset. Everything hangs off one AudioContext that unlocks
// on the first user gesture, as browsers require.

import { clamp, lerp } from './world/rng.js';
import { asset } from './asset.js';

// Recorded CC0 ambience (OpenGameArt) — looping beds crossfaded by place, hour,
// weather and speed. If a file fails to load the synthesized layer keeps playing,
// so the world is never silent, even offline.
const BEDS = ['birds', 'crickets', 'stream', 'windsoft', 'windstrong', 'rain'];

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

    // Ambience bus for the living world: birdsong and crickets are synthesized on
    // schedule, so the forest sounds inhabited without a single recorded sample.
    this.ambGain = ctx.createGain();
    this.ambGain.gain.value = 0.5;
    this.ambGain.connect(this.master);
    this.nextChirp = 0;
    this.nextCricket = 0;

    // Load the recorded beds; each becomes a looping source behind its own gain.
    this.beds = {};
    for (const name of BEDS) {
      fetch(asset(`/sfx/${name}.ogg`))
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((ab) => ctx.decodeAudioData(ab))
        .then((buf) => {
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.loop = true;
          const g = ctx.createGain();
          g.gain.value = 0;
          src.connect(g);
          g.connect(this.master);
          src.start();
          this.beds[name] = g;
        })
        .catch(() => { /* fall back to synthesis for this layer */ });
    }

    this.ready = true;
  }

  // Target level for each recorded bed given where and when you are.
  bedTargets(biome, isNight, weather, still) {
    const birdy = { verdant: 0.8, duskwood: 1.0, whisper: 1.0, marsh: 0.5, frostveil: 0.12 }[biome] || 0;
    const cricketty = { verdant: 0.8, marsh: 1.0, whisper: 0.9, duskwood: 0.5 }[biome] || 0;
    const streamy = { whisper: 0.75, marsh: 0.45 }[biome] || 0;
    const gusty = { frostveil: 0.8, ashen: 0.55, emberfall: 0.4 }[biome] || 0.12;
    const wet = ['rain', 'storm', 'blizzard'].includes(weather.stateName)
      ? (weather.stateName === 'rain' ? 0.7 : 1.0) : 0;
    return {
      birds: (isNight ? 0 : birdy) * still * 0.5,
      crickets: (isNight ? cricketty : 0) * still * 0.45,
      stream: streamy * still * 0.5,
      windsoft: (0.25 + weather.wind * 0.5) * (1 - gusty) * 0.4,
      windstrong: (gusty * 0.6 + weather.wind * 0.5) * 0.45,
      rain: wet * 0.6,
    };
  }

  // A short songbird phrase: two to four descending chirps with pitch glides.
  chirp() {
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const base = 2200 + Math.random() * 1800;
    const notes = 2 + (Math.random() * 3 | 0);
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      const t = t0 + i * (0.09 + Math.random() * 0.06);
      o.frequency.setValueAtTime(base * (1 + Math.random() * 0.2), t);
      o.frequency.exponentialRampToValueAtTime(base * (0.7 + Math.random() * 0.15), t + 0.07);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05 + Math.random() * 0.04, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      o.connect(g); g.connect(this.ambGain);
      o.start(t); o.stop(t + 0.12);
    }
  }

  // One cricket burst: a fast trill on a high carrier.
  cricket() {
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = 4200 + Math.random() * 600;
    g.gain.value = 0;
    const pulses = 6 + (Math.random() * 6 | 0);
    for (let i = 0; i < pulses; i++) {
      const t = t0 + i * 0.042;
      g.gain.setValueAtTime(0.028, t);
      g.gain.setValueAtTime(0, t + 0.02);
    }
    o.connect(g); g.connect(this.ambGain);
    o.start(t0); o.stop(t0 + pulses * 0.042 + 0.05);
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

  update(dt, car, weather, driving, biome = 'verdant', isNight = false) {
    if (!this.ready) return;
    const speed = Math.abs(car.speed);

    // The living layer: recorded beds crossfade by place/hour/weather, and fade
    // with speed — you hear the world when you slow down for it.
    if (!this.muted) {
      const still = clamp(1 - speed / 20, 0, 1);
      const targets = this.bedTargets(biome, isNight, weather, still);
      const k = Math.min(1, dt * 1.2);
      for (const [name, g] of Object.entries(this.beds)) {
        g.gain.value = lerp(g.gain.value, targets[name] ?? 0, k);
      }

      // Synthesized accents only cover layers whose recording did not load.
      const t = this.ctx.currentTime;
      if (!this.beds.birds && ['verdant', 'duskwood', 'whisper'].includes(biome) && !isNight
        && t > this.nextChirp) {
        this.chirp();
        this.nextChirp = t + 1.2 + Math.random() * (3 + 8 * (1 - still));
      }
      if (!this.beds.crickets && ['verdant', 'marsh', 'whisper'].includes(biome) && isNight
        && t > this.nextCricket) {
        this.cricket();
        this.nextCricket = t + 0.4 + Math.random() * (1.5 + 5 * (1 - still));
      }
    }

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

    // Synth rain hiss only when the recorded rain bed is unavailable.
    const wet = !this.beds.rain && ['rain', 'storm', 'blizzard'].includes(weather.stateName)
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
