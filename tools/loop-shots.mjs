// Visual verification of the phase-3 loop: pull in with low fuel, accept the task,
// walk it through on foot. Captures each beat.
import { launch } from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
await mkdir('shots', { recursive: true });

const browser = await launch({
  executablePath: CHROME, headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--no-sandbox', '--in-process-gpu', '--renderer-process-limit=1',
    '--disable-dev-shm-usage', '--disable-extensions', '--js-flags=--max-old-space-size=640'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 560 });
await (await page.createCDPSession()).send('Emulation.setFocusEmulationEnabled', { enabled: true });
page.on('pageerror', (e) => console.error('PAGEERROR', e.stack || e.message));

await page.goto('http://localhost:5199', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__game && window.__game.ready', { timeout: 180000 });

const shot = async (name, ms = 900) => {
  await new Promise((r) => setTimeout(r, ms));
  await page.screenshot({ path: `shots/${name}.png` });
  console.log(`shots/${name}.png`);
};

// Beat 1: rolling up to the station, low on fuel, offer visible.
await page.evaluate(() => {
  const g = window.__game;
  g.freezeClock(true); g.setTime(0.72);          // late golden hour
  g.teleport(g.stations.list[0].along - 4);
  g.fuel.level = 8;
  g.car.speed = 0;
});
await shot('loop-station');

// Beat 2: accept whatever was offered (force firewatch for a deterministic capture).
await page.evaluate(() => {
  const g = window.__game;
  const s = g.stations.list[0];
  const fw = g.tasks.registry.find((t) => t.id === 'firewatch');
  g.tasks.begin(fw, s);
});
await shot('loop-onfoot');

// Beat 3: walk to the first branch (real on-foot movement, not a teleport).
await page.evaluate(() => {
  const g = window.__game;
  const t = g.interact.current;
  // Point the walker at the target and let the real loop move it.
  const dx = t.x - g.foot.pos.x, dz = t.z - g.foot.pos.z;
  g.foot.yaw = Math.atan2(dx, dz);
  g.controls.keys.add('KeyW');
});
await new Promise((r) => setTimeout(r, 2600));
await page.evaluate(() => window.__game.controls.keys.delete('KeyW'));
await shot('loop-walking', 300);

// Beat 4: finish the task via the interfaces. Frame-synced, not timer-synced — at
// software-render framerates two timer fires can land inside one frame and the
// second is swallowed, so instead press once per rendered frame until done.
await page.evaluate(() => new Promise((done) => {
  const g = window.__game;
  const step = () => {
    if (!g.tasks.busy) return done();
    const t = g.interact.current;
    if (t) {
      g.foot.pos.set(t.x, g.elevation(t.x, t.z), t.z);
      g.controls.onAction();
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}));
await shot('loop-fire', 400);
await shot('loop-refuelled', 2400);

const state = await page.evaluate(() => ({
  fuel: Math.round(window.__game.fuel.level),
  mode: window.__game.tasks.mode,
  busy: window.__game.tasks.busy,
}));
console.log(JSON.stringify(state));
await browser.close();
