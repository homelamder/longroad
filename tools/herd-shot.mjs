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
await page.goto('http://localhost:5199', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__game && window.__game.ready', { timeout: 180000 });
const mode = process.argv[2] || 'herd';
await page.evaluate((m) => {
  const g = window.__game;
  g.freezeClock(true); g.setTime(m === 'pool' ? 0.3 : 0.35); g.setWeather('clear');
  g.teleport(m === 'pool' ? 12100 : 1050);
}, mode);
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate((m) => {
  const g = window.__game;
  g.chase.update = () => {};       // pin the camera for the capture
  if (m === 'pool') {
    // Nearest pool disc to the car: read the merged geometry's vertices.
    const pos = g.water.mesh.geometry.getAttribute('position');
    let best = null, bd = Infinity;
    for (let i = 0; i < pos.count; i += 19) {
      const d = Math.hypot(pos.getX(i) - g.car.pos.x, pos.getZ(i) - g.car.pos.z);
      if (d < bd) { bd = d; best = i; }
    }
    const px = pos.getX(best), py = pos.getY(best), pz = pos.getZ(best);
    g.camera.position.set(px + 26, py + 4.5, pz - 30);
    g.camera.lookAt(px, py, pz);
  } else {
    const herd = [...g.animals.herds.values()].filter(Boolean).find((h) => h.species === 'goat')
      || [...g.animals.herds.values()].filter(Boolean)[0];
    let cx = 0, cz = 0;
    for (const a of herd.animals) { cx += a.x; cz += a.z; }
    cx /= herd.animals.length; cz /= herd.animals.length;
    const y = g.elevation(cx, cz);
    g.camera.position.set(cx + 8, y + 2.6, cz - 10);
    g.camera.lookAt(cx, y + 0.7, cz);
  }
}, mode);
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: `shots/${mode}.png` });
console.log(`shots/${mode}.png`);
await browser.close();
