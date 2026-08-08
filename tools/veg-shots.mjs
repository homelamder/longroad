// Screenshot every decimated GLB through the viewer page. Judgement by eye.
import { launch } from 'puppeteer-core';
import { existsSync } from 'node:fs';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const browser = await launch({ executablePath: CHROME, headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox',
  '--no-sandbox','--in-process-gpu','--renderer-process-limit=1','--disable-dev-shm-usage','--disable-extensions'] });
const models = process.argv.slice(2).length ? process.argv.slice(2)
  : ['boulder_01', 'namaq_boulder', 'stump', 'dead_trunk', 'quiver', 'fir_test'];
for (const m of models) {
  const page = await browser.newPage();
  await page.setViewport({ width: 700, height: 520 });
  await (await page.createCDPSession()).send('Emulation.setFocusEmulationEnabled', { enabled: true });
  page.on('pageerror', (e) => console.error('ERR', m, e.message));
  await page.goto(`http://localhost:5199/tools/view.html?m=/veg/${m}.glb`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__ready', { timeout: 120000 }).catch(() => console.error('timeout', m));
  await new Promise((r) => setTimeout(r, 700));
  const stats = await page.evaluate('window.__stats');
  await page.screenshot({ path: `shots/veg-${m}.png` });
  console.log(`shots/veg-${m}.png`, JSON.stringify(stats));
  await page.close();
}
await browser.close();
