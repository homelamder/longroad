// Phone-shaped verification: coarse-pointer emulation so the touch pads appear,
// landscape phone viewport, low quality tier.
import { launch } from 'puppeteer-core';
import { existsSync } from 'node:fs';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const browser = await launch({ executablePath: CHROME, headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox',
  '--no-sandbox','--in-process-gpu','--renderer-process-limit=1','--disable-dev-shm-usage','--disable-extensions',
  '--blink-settings=primaryPointerType=4'] });
const page = await browser.newPage();
await page.emulate({
  viewport: { width: 880, height: 405, deviceScaleFactor: 1, isMobile: true, hasTouch: true, isLandscape: true },
  userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36',
});
await (await page.createCDPSession()).send('Emulation.setFocusEmulationEnabled', { enabled: true });
page.on('pageerror', (e) => console.error('PAGEERROR', e.stack || e.message));
await page.evaluateOnNewDocument(() => localStorage.setItem('lr.quality', 'low'));
await page.goto('http://localhost:5190', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__game && window.__game.ready', { timeout: 180000 });
await page.evaluate(() => {
  const g = window.__game;
  g.freezeClock(true); g.setTime(0.35); g.setWeather('clear');
  g.teleport(1400);
});
await new Promise((r) => setTimeout(r, 1200));
const info = await page.evaluate(() => ({
  tier: window.__game.quality.name,
  padsVisible: !document.querySelector('.pads').classList.contains('pads-hidden'),
  ...window.__game.stats(),
}));
await page.screenshot({ path: 'shots/phone.png' });
console.log('shots/phone.png', JSON.stringify(info));
await browser.close();
