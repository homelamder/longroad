// Same pinned view three times: full scene, water hidden, scatter hidden.
// Whichever toggle removes the artifact names the culprit.
import { launch } from 'puppeteer-core';
import { existsSync } from 'node:fs';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const browser = await launch({ executablePath: CHROME, headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox',
  '--no-sandbox','--in-process-gpu','--renderer-process-limit=1','--disable-dev-shm-usage','--disable-extensions'] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 560 });
await (await page.createCDPSession()).send('Emulation.setFocusEmulationEnabled', { enabled: true });
page.on('pageerror', (e) => console.error('PAGEERROR', e.message));
await page.goto('http://localhost:5199', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__game && window.__game.ready', { timeout: 180000 });
await page.evaluate(() => {
  const g = window.__game;
  g.freezeClock(true); g.setTime(0.34); g.setWeather('clear');
  g.teleport(12300);
  g.chase.update = () => {};
  const pos = g.water.mesh.geometry.getAttribute('position');
  const px = pos.getX(0), py = pos.getY(0), pz = pos.getZ(0);
  g.camera.position.set(px + 30, py + 14, pz - 34);
  g.camera.lookAt(px, py, pz);
});
await new Promise((r) => setTimeout(r, 1000));
for (const [name, expr] of [
  ['layers-full', ''],
  ['layers-nowater', 'window.__game.water.mesh.visible = false'],
  ['layers-noscatter', 'window.__game.water.mesh.visible = true; window.__game.scatter.group.visible = false'],
]) {
  if (expr) await page.evaluate(expr);
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: `shots/${name}.png` });
  console.log(`shots/${name}.png`);
}
await browser.close();
