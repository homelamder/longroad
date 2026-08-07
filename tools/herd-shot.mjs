// Frame a live herd: park the car on the road, aim the camera at the herd.
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
await page.goto('http://localhost:5190', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__game && window.__game.ready', { timeout: 180000 });
await page.evaluate(() => {
  const g = window.__game;
  g.freezeClock(true); g.setTime(0.35); g.setWeather('clear');
  g.teleport(1050);
});
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(() => {
  const g = window.__game;
  const herd = [...g.animals.herds.values()].filter(Boolean).find((h) => h.species === 'goat')
    || [...g.animals.herds.values()].filter(Boolean)[0];
  // Average the LIVE animal positions — the site centre can be tens of metres from
  // where the herd has drifted to.
  let cx = 0, cz = 0;
  for (const a of herd.animals) { cx += a.x; cz += a.z; }
  cx /= herd.animals.length; cz /= herd.animals.length;
  const y = g.elevation(cx, cz);
  // Pin the camera: kill the chase update for this capture so nothing re-aims it.
  g.chase.update = () => {};
  g.camera.position.set(cx + 8, y + 2.6, cz - 10);
  g.camera.lookAt(cx, y + 0.7, cz);
});
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: 'shots/herd.png' });
console.log('shots/herd.png');
await browser.close();
