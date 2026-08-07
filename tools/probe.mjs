// One-off inspector: opens the game headlessly and evaluates whatever expression you
// pass on the command line. For questions the screenshots cannot answer.
//
//   node tools/probe.mjs "window.__game.stats()"
//   node tools/probe.mjs "..." 10430 0.28        (distance along road, time of day)
import { launch } from 'puppeteer-core';
import { existsSync } from 'node:fs';

// Forward slashes deliberately — node accepts them on Windows and they survive
// being pasted through a shell without backslash mangling.
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
].find(existsSync);
if (!CHROME) throw new Error('No Chrome found');

const expr = process.argv[2] || 'window.__game.stats()';
const along = Number(process.argv[3] ?? 1400);
const time = Number(process.argv[4] ?? 0.34);

const browser = await launch({
  executablePath: CHROME, headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--no-sandbox', '--in-process-gpu', '--renderer-process-limit=1',
    '--disable-dev-shm-usage', '--disable-extensions', '--js-flags=--max-old-space-size=640'],
});
const page = await browser.newPage();
await page.setViewport({ width: 800, height: 420 });
await (await page.createCDPSession()).send('Emulation.setFocusEmulationEnabled', { enabled: true });
page.on('pageerror', (e) => console.error('PAGEERROR', e.stack || e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('CONSOLE', m.text()); });

await page.goto('http://localhost:5190', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__game && window.__game.ready', { timeout: 180000 });
await page.evaluate((a, t) => {
  window.__game.freezeClock(true);
  window.__game.setTime(t);
  window.__game.teleport(a);
}, along, time);
await new Promise((r) => setTimeout(r, 700));

console.log(JSON.stringify(await page.evaluate(expr), null, 2));
await browser.close();
