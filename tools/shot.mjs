// Headless screenshots of the running game. The in-app preview browser on this
// machine has no GPU at all, so this drives the real installed Chrome with software
// WebGL instead. Slow, but it renders a full Three.js scene and it never lies.
//
//   npm run dev                      (in another terminal)
//   node tools/shot.mjs verdant pass
//   node tools/shot.mjs --all
//   node tools/shot.mjs --drive      (capture a moving car, not a parked one)
import { launch } from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
].find(existsSync);
if (!CHROME) throw new Error('No Chrome/Edge found — set CHROME manually in tools/shot.mjs');

const URL = process.env.GAME_URL || 'http://localhost:5199';
const OUT = 'shots';

// name: [distance along the road, camera mode, time of day]
// Time defaults to mid-morning so location shots stay comparable between runs; the
// clock is frozen for captures or a slow software render drifts mid-screenshot.
export const POSES = {
  start: [60, 'chase'],
  verdant: [1400, 'chase'],
  duskwood: [3300, 'chase'],
  emberfall: [5500, 'chase'],
  whisper: [7600, 'chase'],
  climb: [9400, 'chase'],
  pass: [10430, 'chase'],
  descent: [11300, 'chase'],
  marsh: [12300, 'chase'],
  ashen: [14200, 'chase'],
  'pass-far': [10430, 'far'],
  hood: [1400, 'hood'],

  cave: [10180, 'chase', 0.4],
  vents: [13400, 'chase', 0.5, 'ashfall'],
  'marsh-mirror': [12300, 'chase', 0.28],

  rain: [7600, 'chase', 0.4, 'rain'],
  storm: [7600, 'chase', 0.55, 'storm'],
  'dust-storm': [5500, 'chase', 0.45, 'dust'],
  'mist-wood': [3300, 'chase', 0.3, 'mist'],
  blizzard: [10430, 'chase', 0.45, 'blizzard'],
  'ash-fall': [14200, 'chase', 0.5, 'ashfall'],

  dawn: [1400, 'chase', 0.255],
  noon: [1400, 'chase', 0.5],
  dusk: [3300, 'chase', 0.745],
  night: [1400, 'chase', 0.02],
  'night-forest': [3300, 'chase', 0.98],
  'golden-pass': [10430, 'chase', 0.28],
};

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const wanted = args.filter((a) => !a.startsWith('--'));
const names = flags.has('--all') || !wanted.length ? Object.keys(POSES) : wanted;

await mkdir(OUT, { recursive: true });

const browser = await launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox',
    '--no-sandbox',
    '--hide-scrollbars',
    // This machine routinely runs with under 2 GB free. A default Chrome spawns a
    // process per frame and per service and simply fails to start; these keep it to
    // roughly one renderer, which is all a screenshot needs.
    '--in-process-gpu',
    '--renderer-process-limit=1',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-features=site-per-process,TranslateUI,BackForwardCache',
    '--js-flags=--max-old-space-size=640',
  ],
});

const errors = [];
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 560, deviceScaleFactor: 1 });
// Chrome suspends requestAnimationFrame on background tabs, which freezes the game
// loop and every animation with it. This is per page and is not optional.
await (await page.createCDPSession()).send('Emulation.setFocusEmulationEnabled', { enabled: true });
page.on('pageerror', (e) => errors.push(e.stack || String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('!!window.__game', { timeout: 60000 });
await page.waitForFunction('window.__game.ready', { timeout: 180000 });

for (const name of names) {
  const pose = POSES[name];
  if (!pose) { console.warn(`skipping unknown pose "${name}"`); continue; }
  await page.evaluate((p) => {
    window.__game.freezeClock(true);
    window.__game.setTime(p[2] === undefined ? 0.34 : p[2]);
    window.__game.setWeather(p[3] || 'clear');
    window.__game.teleport(p[0]);
    window.__game.setCamera(p[1]);
  }, pose);

  // A parked car on an empty road says nothing about how the game feels. Roll it
  // forward under power first so the shot has attitude, lean and camera lag in it.
  if (flags.has('--drive')) {
    await page.evaluate(() => {
      const g = window.__game;
      for (let i = 0; i < 240; i++) {
        const r = g.pointAt(g.car.along + 26);
        const want = Math.atan2(r.x - g.car.pos.x, r.z - g.car.pos.z);
        const err = ((want - g.car.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        g.drive({ throttle: 1, brake: 0, handbrake: false, steer: Math.max(-1, Math.min(1, err * 2.4)) }, 1 / 60);
      }
    });
  }
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`${OUT}/${name}.png`);
}

const stats = await page.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  const tick = () => (++n < 60 ? requestAnimationFrame(tick)
    : res({
      fps: Math.round(n / ((performance.now() - t0) / 1000)),
      ...window.__game.stats(),
    }));
  requestAnimationFrame(tick);
}));
console.log(`~${stats.fps} fps software · ${stats.calls} draw calls · `
  + `${(stats.tris / 1000).toFixed(0)}k triangles · ${stats.plants} plants · `
  + `${stats.grass} grass · tier ${stats.tier}`);

await browser.close();
if (errors.length) {
  console.error('\npage errors:');
  for (const e of new Set(errors)) console.error('  ' + e);
  process.exit(1);
}
