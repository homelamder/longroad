// The journey is a line. Everything about the world — terrain shape, colour, fog,
// what grows and what lives there — is a function of how far along that line you are.
//
// Distance is measured in metres along +Z. The road wanders laterally, so true arc
// length is a few percent longer than Z, but nothing here needs that precision.
// ponytail: distance ≈ z. Exact arc length would need a lookup table for no visible gain.

export const JOURNEY = 15000;

// relief  how far off-road terrain swings above/below the road
// snow    altitude snow starts settling here. One global snowline put snowcaps on
//         the red rock of a hot canyon, so each region gets its own (2000 = never)
// rough   terrain frequency — small is smooth and rolling, large is broken
// curvy   how much the road wanders side to side (1 = normal sweeping bends)
// The road's own height is NOT here — see the PROFILE table at the bottom.
export const BIOMES = [
  {
    id: 'verdant', name: 'Verdant Reach', end: 2150,
    relief: 38, rough: 1.0, curvy: 0.6,
    snow: 380,
    grass: 0x6f9440, grass2: 0x8cae52, rock: 0x7d7468, soil: 0x6d5c46,
    fog: 0xb9d3e8, fogNear: 260, fogFar: 1500,
    sky: 0x8fc0e8,
  },
  {
    id: 'duskwood', name: 'Duskwood Pines', end: 4300,
    relief: 62, rough: 1.25, curvy: 0.85,
    snow: 430,
    grass: 0x5c7d3f, grass2: 0x496a34, rock: 0x7d766a, soil: 0x5b4c39,
    fog: 0x9fb0a8, fogNear: 120, fogFar: 900,
    sky: 0x9db6c4,
  },
  {
    id: 'emberfall', name: 'Emberfall Canyon', end: 6450,
    relief: 130, rough: 1.35, curvy: 1.0,
    snow: 2000,
    grass: 0x9c7c4e, grass2: 0xb08b58, rock: 0xa2573a, soil: 0xc0895c,
    fog: 0xe0b489, fogNear: 400, fogFar: 2600,
    sky: 0xd9b98e,
  },
  {
    id: 'whisper', name: 'Whisper Falls', end: 8600,
    relief: 78, rough: 1.45, curvy: 0.95,
    snow: 760,
    grass: 0x3d8446, grass2: 0x4f9a4a, rock: 0x6f7566, soil: 0x4c3f30,
    fog: 0x8fbfa0, fogNear: 70, fogFar: 620,
    sky: 0xa8c9b4,
  },
  {
    id: 'frostveil', name: 'Frostveil Pass', end: 10750,
    relief: 280, rough: 1.35, curvy: 1.7,
    snow: 336,
    grass: 0x8b9593, grass2: 0xa2aaa8, rock: 0x7c828c, soil: 0x6d727b,
    fog: 0xdfe8f2, fogNear: 90, fogFar: 1100,
    sky: 0xc3d6ea,
  },
  {
    id: 'marsh', name: 'Mirror Marsh', end: 12900,
    relief: 14, rough: 0.7, curvy: 0.45,
    snow: 620,
    grass: 0x64784a, grass2: 0x738450, rock: 0x6d6f65, soil: 0x4c5140,
    fog: 0x8d9c96, fogNear: 60, fogFar: 800,
    sky: 0x93a7ad,
  },
  {
    id: 'ashen', name: 'Ashen Rise', end: JOURNEY,
    relief: 150, rough: 1.7, curvy: 1.15,
    snow: 560,
    grass: 0x46403f, grass2: 0x534b49, rock: 0x363231, soil: 0x2f2b2a,
    fog: 0x77675f, fogNear: 80, fogFar: 900,
    sky: 0x8a7168,
  },
];

// Regions blend into one another over this many metres, so nothing changes abruptly.
const BLEND = 420;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => t * t * (3 - 2 * t);

export function biomeIndexAt(dist) {
  for (let i = 0; i < BIOMES.length; i++) if (dist < BIOMES[i].end) return i;
  return BIOMES.length - 1;
}

// Returns the two regions in play at this distance and how far between them we are.
// Away from a boundary, a === b and t === 0.
export function biomeAt(dist) {
  const i = biomeIndexAt(clamp(dist, 0, JOURNEY));
  const a = BIOMES[i];
  const start = i === 0 ? 0 : BIOMES[i - 1].end;

  if (i > 0 && dist - start < BLEND) {
    const t = smooth(1 - (dist - start) / BLEND);
    return { a, b: BIOMES[i - 1], t: t * 0.5, i };
  }
  if (i < BIOMES.length - 1 && a.end - dist < BLEND) {
    const t = smooth(1 - (a.end - dist) / BLEND);
    return { a, b: BIOMES[i + 1], t: t * 0.5, i };
  }
  return { a, b: a, t: 0, i };
}

// Blend a numeric field of the two active regions.
export function mixField(dist, key) {
  const { a, b, t } = biomeAt(dist);
  return a[key] + (b[key] - a[key]) * t;
}

// Blend a hex colour field into `out` (a THREE.Color).
export function mixColor(dist, key, out) {
  const { a, b, t } = biomeAt(dist);
  const ar = (a[key] >> 16) & 255, ag = (a[key] >> 8) & 255, ab = a[key] & 255;
  const br = (b[key] >> 16) & 255, bg = (b[key] >> 8) & 255, bb = b[key] & 255;
  out.setRGB(
    (ar + (br - ar) * t) / 255,
    (ag + (bg - ag) * t) / 255,
    (ab + (bb - ab) * t) / 255,
    'srgb',
  );
  return out;
}

// --- road elevation profile -------------------------------------------------
// Authored, not derived. Deriving the road's height from the regions either side
// crammed the entire climb to the pass into the band around one boundary — a 65%
// grade, a wall rather than a road. This table is the shape of the journey: anchors
// roughly 700 m apart, none rising more than about 100 m from the last, run through
// a Catmull-Rom. Keep segments gentle here and the road stays drivable everywhere.
const PROFILE = [
  [0, 26], [700, 36], [1400, 50], [2100, 68],             // Verdant Reach, easy country
  [2800, 94], [3500, 122], [4200, 152],                   // Duskwood, climbing steadily
  [4900, 184], [5600, 208], [6300, 202],                  // Emberfall high desert
  [7000, 180], [7700, 172],                               // Whisper Falls gorge
  // The climb starts before Frostveil does and summits above the snowline, so the
  // pass is genuinely in the snow rather than merely near it.
  [8300, 192], [8900, 238], [9500, 308], [10000, 382], [10450, 452],
  [10900, 424], [11400, 352], [11900, 268], [12400, 208], [12800, 176], // into the marsh
  [13400, 220], [14100, 320], [JOURNEY, 404],             // Ashen Rise
];

export function roadElevation(d) {
  const n = PROFILE.length;
  if (d <= PROFILE[0][0]) return PROFILE[0][1];
  if (d >= PROFILE[n - 1][0]) return PROFILE[n - 1][1];
  let i = 0;
  while (i < n - 2 && d > PROFILE[i + 1][0]) i++;
  const p0 = PROFILE[Math.max(0, i - 1)][1], p1 = PROFILE[i][1];
  const p2 = PROFILE[i + 1][1], p3 = PROFILE[Math.min(n - 1, i + 2)][1];
  const t = (d - PROFILE[i][0]) / (PROFILE[i + 1][0] - PROFILE[i][0]);
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1
    + (-p0 + p2) * t
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

// How far above a region's snow altitude the cover goes from a dusting to complete.
export const SNOW_FADE = 90;
