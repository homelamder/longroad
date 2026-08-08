import { launch } from 'puppeteer-core';
import { existsSync } from 'node:fs';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const browser = await launch({ executablePath: CHROME, headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox',
  '--no-sandbox','--in-process-gpu','--renderer-process-limit=1','--disable-dev-shm-usage','--disable-extensions'] });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => localStorage.setItem('lr.quality', 'low'));
await page.setViewport({ width: 500, height: 400 });
await (await page.createCDPSession()).send('Emulation.setFocusEmulationEnabled', { enabled: true });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 300)));
page.on('console', (m) => console.log('CONSOLE', m.type() + ':', m.text().slice(0, 300)));
page.on('requestfailed', (r) => console.log('REQFAIL:', r.url().slice(-60), r.failure()?.errorText));
page.on('response', (r) => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url().slice(-60)); });
await page.goto('http://localhost:5199', { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((res) => setTimeout(res, 25000));
console.log('ready:', await page.evaluate('window.__game && window.__game.ready'));
console.log('bootStatus:', await page.evaluate("document.getElementById('boot-status')?.textContent"));
await browser.close();
