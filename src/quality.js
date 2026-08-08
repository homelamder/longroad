// One build, two very different machines. Everything expensive reads its budget
// from here rather than testing for "is this a phone" at the point of use.

const TIERS = {
  ultra: {
    name: 'ultra',
    terrain: 'high', shadows: 4096, shadowRange: 230,
    scatterRings: 4, scatterDensity: 1.3, grassRadius: 150, grassBlades: 95000,
    bloom: true, motionBlur: true, smaa: true, pixelRatio: 2,
    tex2k: true, gtao: true,
  },
  high: {
    name: 'high',
    terrain: 'high', shadows: 2048, shadowRange: 160,
    scatterRings: 3, scatterDensity: 0.9, grassRadius: 100, grassBlades: 52000,
    bloom: true, motionBlur: true, smaa: true, pixelRatio: 2,
    tex2k: true, gtao: false,
  },
  medium: {
    name: 'medium',
    terrain: 'high', shadows: 1024, shadowRange: 110,
    scatterRings: 2, scatterDensity: 0.55, grassRadius: 64,  grassBlades: 26000,
    bloom: true, motionBlur: false, smaa: false, pixelRatio: 1.5,
  },
  low: {
    name: 'low',
    terrain: 'low', shadows: 0, shadowRange: 0,
    scatterRings: 2, scatterDensity: 0.35, grassRadius: 44,  grassBlades: 11000,
    bloom: false, motionBlur: false, smaa: false, pixelRatio: 1,
  },
};

// Probing a GPU from JavaScript is guesswork. This deliberately errs low and lets
// the runtime meter below promote a machine that turns out to cope — being wrong
// downward costs some prettiness, being wrong upward costs a playable framerate.
function probe() {
  const saved = localStorage.getItem('lr.quality');
  if (saved && TIERS[saved]) return TIERS[saved];

  const coarse = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || (coarse ? 4 : 8);

  let renderer = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
      || document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    if (ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
  } catch { /* blocked by privacy settings — fall through to the cheap signals */ }

  // Software rasterisers name themselves, and they are 50x slower than any real GPU.
  if (/swiftshader|llvmpipe|software|microsoft basic/i.test(renderer)) return TIERS.medium;

  if (coarse) return mem >= 6 && cores >= 8 ? TIERS.medium : TIERS.low;
  // Desktop defaults straight to ultra — this build targets the player's own PC;
  // the runtime meter still demotes anything that genuinely cannot keep up.
  return cores >= 6 ? TIERS.ultra : TIERS.high;
}

export const QUALITY = probe();
export const TIER_NAMES = Object.keys(TIERS);

export function setQuality(name) {
  if (!TIERS[name]) return false;
  localStorage.setItem('lr.quality', name);
  location.reload();
  return true;
}

// A running framerate meter. A probe can be wrong in either direction; sustained
// real frame times cannot be. Drops one tier if the machine is visibly struggling.
export class QualityMeter {
  constructor(onDrop) {
    this.onDrop = onDrop;
    this.samples = [];
    this.cooldown = 6;
    this.tier = QUALITY.name;
  }

  update(dt) {
    if (this.cooldown > 0) { this.cooldown -= dt; return; }
    this.samples.push(dt);
    if (this.samples.length < 180) return;

    // Median, not mean: one 300 ms chunk-build hitch must not condemn the tier.
    const sorted = this.samples.slice().sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    this.samples.length = 0;

    const order = ['ultra', 'high', 'medium', 'low'];
    const i = order.indexOf(this.tier);
    if (median > 1 / 26 && i < order.length - 1) {
      this.tier = order[i + 1];
      this.cooldown = 12;
      this.onDrop?.(TIERS[this.tier]);
    }
  }
}

export { TIERS };
