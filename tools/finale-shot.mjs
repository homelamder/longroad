// Arrive at the end of the world and photograph it.
import { launch } from 'puppeteer-core';
import { existsSync } from 'node:fs';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const browser = await launch({ executablePath: CHROME, headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox',
  '--no-sandbox','--in-process-gpu','--renderer-process-limit=1','--disable-dev-shm-usage','--disable-extensions'] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 560 });
await (await page.createCDPSession()).send('Emulation.setFocusEmulationEnabled', { enabled: true });
page.on('pageerror', (e) => console.error('PAGEERROR', e.stack || e.message));
await page.goto('http://localhost:5190', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__game && window.__game.ready', { timeout: 180000 });

// Approach: park just before the gate, at dusk light.
await page.evaluate(() => {
  const g = window.__game;
  g.setTime(0.7);
  g.teleport(g.ROAD_LENGTH - 40);   // arc length, not z — the road runs 15.4 km along
});
await new Promise((r) => setTimeout(r, 1600));
await page.screenshot({ path: 'shots/finale-gate.png' });
console.log('shots/finale-gate.png');

// Drive through the gate (teleport just past it) and let the finale trigger.
await page.evaluate(() => {
  const g = window.__game;
  const V = g.finale && null;
  g.car.pos.x += Math.sin(g.car.yaw) * 90;
  g.car.pos.z += Math.cos(g.car.yaw) * 90;
  g.car.pos.y = g.elevation(g.car.pos.x, g.car.pos.z) + 0.6;
  g.settle();
});
await new Promise((r) => setTimeout(r, 4200));
await page.screenshot({ path: 'shots/finale-card.png' });
console.log('shots/finale-card.png');

// Dismiss and look across the valley from the rim.
const state = await page.evaluate(() => {
  const g = window.__game;
  document.querySelector('.end-continue')?.click();
  g.chase.update = () => {};
  const e = g.ending;
  const f = g.finale;
  const V = f.built ? { ok: true } : { ok: false };
  // Pin the camera on the rim looking into the bowl.
  const v = (async () => {})();
  return { arrived: e.arrived, built: f.built, herds: f.herds?.length ?? 0 };
});
await page.evaluate(() => {
  const g = window.__game;
  const c = g.car.pos;
  g.camera.position.set(c.x, c.y + 6, c.z);
  const V2 = { x: c.x + Math.sin(g.car.yaw) * 100, z: c.z + Math.cos(g.car.yaw) * 100 };
  g.camera.lookAt(V2.x, c.y - 20, V2.z);
});
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: 'shots/finale-valley.png' });
console.log('shots/finale-valley.png', JSON.stringify(state));
await browser.close();
