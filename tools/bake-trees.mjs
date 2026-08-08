// Bake ez-tree GLBs to public/veg/ through the bake page. Run with dev server up.
import { launch } from 'puppeteer-core';
import { existsSync, writeFileSync } from 'node:fs';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);

const BAKES = [
  ['tree-pine-a',   'Pine Large',    1],
  ['tree-pine-b',   'Pine Medium',   7],
  ['tree-oak-a',    'Oak Large',     2],
  ['tree-oak-b',    'Oak Medium',    9],
  ['tree-ash-a',    'Ash Large',     4],
  ['tree-aspen-a',  'Aspen Medium',  5],
  ['bush-a',        'Bush 1',        3],
  ['bush-b',        'Bush 2',        6],
];

const browser = await launch({ executablePath: CHROME, headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox',
  '--no-sandbox','--in-process-gpu','--renderer-process-limit=1','--disable-dev-shm-usage','--disable-extensions'] });
for (const [name, preset, seed] of BAKES) {
  const page = await browser.newPage();
  await page.setViewport({ width: 700, height: 520 });
  await (await page.createCDPSession()).send('Emulation.setFocusEmulationEnabled', { enabled: true });
  page.on('pageerror', (e) => console.error('ERR', name, e.message.slice(0, 200)));
  await page.goto(`http://localhost:5199/tools/bake.html?p=${encodeURIComponent(preset)}&seed=${seed}`,
    { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__ready', { timeout: 120000 });
  const stats = await page.evaluate('window.__stats');
  const b64 = await page.evaluate('window.__glb');
  writeFileSync(`public/veg/${name}.glb`, Buffer.from(b64, 'base64'));
  await page.screenshot({ path: `shots/veg-${name}.png` });
  console.log(name, JSON.stringify(stats));
  await page.close();
}
await browser.close();
