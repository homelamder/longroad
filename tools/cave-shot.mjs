// The cave-night beat, captured: blizzard drive-up, fire lit inside the shelter.
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
await page.goto('http://localhost:5199', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__game && window.__game.ready', { timeout: 180000 });

await page.evaluate(() => {
  const g = window.__game;
  g.freezeClock(true);
  g.setTime(0.97);                       // deep night
  const frost = g.stations.list.find((s) => s.along > 8800 && s.along < 10600);
  g.teleport(frost.along);
  g.fuel.level = 5;
  const cave = g.tasks.registry.find((t) => t.id === 'cave-night');
  g.tasks.begin(cave, frost);
});
await new Promise((r) => setTimeout(r, 1400));
await page.screenshot({ path: 'shots/cave-drive.png' });
console.log('shots/cave-drive.png');

// Drive to the cave (teleport the car there), get out, gather + light via the loop.
await page.evaluate(() => new Promise((done) => {
  const g = window.__game;
  const task = g.tasks.active.task;
  g.car.pos.set(task.cave.x + 8, g.elevation(task.cave.x + 8, task.cave.z), task.cave.z);
  g.car.speed = 0;
  const step = () => {
    if (!g.tasks.busy || task.lit) return done();
    const t = g.interact.current;
    if (t && g.tasks.mode === 'foot') {
      g.foot.pos.set(t.x, g.elevation(t.x, t.z), t.z);
      g.controls.onAction();
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}));
// Frame the cave mouth with the fire going.
await page.evaluate(() => {
  const g = window.__game;
  const task = g.tasks.active?.task;
  if (!task) return;
  g.chase.update = () => {};
  const c = task.cave;
  g.camera.position.set(c.x + 12, c.y + 4, c.z + 10);
  g.camera.lookAt(c.x, c.y + 1.2, c.z);
});
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: 'shots/cave-fire.png' });
console.log('shots/cave-fire.png');
await browser.close();
