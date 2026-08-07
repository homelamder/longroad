// Boot the game at each quality tier and confirm the full pipeline renders without
// page errors. SwiftShader auto-probes to medium, so the ultra path (bloom + SMAA +
// motion blur) would otherwise never execute before a real player hits it.
import { launch } from 'puppeteer-core';
import { existsSync } from 'node:fs';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
].find(existsSync);

const browser = await launch({
  executablePath: CHROME, headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox', '--no-sandbox', '--in-process-gpu', '--renderer-process-limit=1',
    '--disable-dev-shm-usage', '--disable-extensions', '--js-flags=--max-old-space-size=640'],
});

let failed = false;
for (const tier of ['ultra', 'high', 'low']) {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });
  await (await page.createCDPSession()).send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.evaluateOnNewDocument((t) => localStorage.setItem('lr.quality', t), tier);
  await page.goto('http://localhost:5190', { waitUntil: 'domcontentloaded', timeout: 60000 });
  try {
    await page.waitForFunction('window.__game && window.__game.ready', { timeout: 240000 });
    await page.evaluate(() => window.__game.drive({ throttle: 1, brake: 0, steer: 0.2, handbrake: false }, 2));
    await new Promise((r) => setTimeout(r, 900));
  } catch (e) {
    errors.push('boot: ' + e.message);
  }
  const stats = errors.length ? null : await page.evaluate('window.__game.stats()');
  console.log(tier, errors.length ? `FAILED: ${errors[0]}` : `ok — ${JSON.stringify(stats)}`);
  if (errors.length) failed = true;
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
