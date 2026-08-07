// Garage verification: open the screen, claim a hidden find, swap into it.
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

// Roll up to the hidden Fenwing in the meadow and claim it via the interfaces.
const claim = await page.evaluate(() => {
  const g = window.__game;
  g.freezeClock(true); g.setTime(0.4); g.setWeather('clear');
  const find = g.garage.parked.find((p) => p.entry.id === 'fenwing');
  g.teleport(1750);
  g.car.pos.set(find.x + 6, g.elevation(find.x + 6, find.z), find.z);
  g.car.speed = 0;
  return { name: find.entry.name };
});
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: 'shots/find.png' });
console.log('shots/find.png — near', claim.name);

await page.evaluate(() => window.__game.controls.onAction());
await new Promise((r) => setTimeout(r, 800));

const state1 = await page.evaluate(() => ({
  unlocked: [...window.__game.garage.unlocked],
}));
console.log('after claim:', JSON.stringify(state1));

// Open the garage and swap into the Fenwing.
await page.evaluate(() => window.__game.garage.toggle(true));
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: 'shots/garage.png' });
console.log('shots/garage.png');

await page.evaluate(() => { window.__game.garage.select('fenwing'); window.__game.garage.toggle(false); });
await new Promise((r) => setTimeout(r, 900));
const state2 = await page.evaluate(() => ({
  spec: window.__game.car.spec.id,
  meshName: window.__game.carMesh.name,
}));
console.log('after swap:', JSON.stringify(state2));
await page.screenshot({ path: 'shots/swapped.png' });
console.log('shots/swapped.png');
await browser.close();
