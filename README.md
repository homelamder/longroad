# The Long Road

A driving-and-exploration game. One road, seven biomes, no buildings — only nature.
Drive toward the unknown at the end of the road; every tank of fuel is earned with a
nature task: feed the goats, keep a cave fire alive through a blizzard night, guide a
lost herd home by headlight.

Three.js + Vite, no engine, no physics library, no server.

## Play

```
npm install
npm run dev
```

- **PC:** open http://localhost:5190 — WASD/arrows drive, Space handbrake,
  E interact, G garage, C camera, R recover, M sound.
- **Phone:** on the same Wi-Fi, open `http://<your-PC-IP>:5190` — touch pads,
  landscape. Add to Home Screen for fullscreen.

Graphics pick a quality tier automatically (`low` … `ultra`); override with
`localStorage.setItem('lr.quality', 'ultra')` in the console. Progress autosaves.

## The journey

Verdant Reach → Duskwood Pines → Emberfall Canyon → Whisper Falls → Frostveil Pass →
Mirror Marsh → Ashen Rise → *the end of the road*. ~15.4 km, 14 fuel stations,
16 tasks, 15 findable cars (6 waiting at stations, 8 hidden off-road).
Running dry never strands you: the reserve limps you to the next station.

## Add your own car

One entry in `src/car/cars.js`. Either describe it (archetype + paint + tweaks) and
the generator builds the body, or add `model: '/cars/yourcar.glb'` and drop the file
in `public/cars/` — physics come from the spec either way.

## Verify

```
npm test          # 8 suites: terrain, road, physics, loop, animals, tasks, cars, finale, playthrough
node tools/shot.mjs --all      # headless screenshots (needs npm run dev running)
node tools/tier-check.mjs      # boots every quality tier
```

The in-app preview browser on this machine has no GPU; all visual verification runs
through `tools/*.mjs` (puppeteer-core + installed Chrome + SwiftShader).
