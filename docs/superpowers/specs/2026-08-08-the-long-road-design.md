# The Long Road — Design

**Date:** 2026-08-08
**Status:** Approved

A driving-and-exploration game. One road, seven biomes, no buildings — only nature.
The player drives toward an unknown destination; every refuel is paid for with a
nature-survival task.

## Decisions (locked)

| Decision | Choice | Why |
|---|---|---|
| Target | PC browser **and** phone, one build, quality tier auto-detected | Best graphics where a GPU exists, playable framerate where it doesn't |
| World | Corridor — one road, fully drivable open terrain either side | A road implies direction; open world implies freedom. Corridor gives both without an empty map |
| Competition | None. Pure journey | Pressure comes from fuel, weather, terrain, nightfall |
| Scope | 7 biomes + destination, 16 tasks | User chose the full version over a vertical slice |
| Art | Stylized realism | Only style that reads as "insane graphics" on PC and still holds framerate on a phone |
| Cars | Procedural originals + drop-in `.glb` registry | Real car designs are trademarked and thousands of licensed models do not exist |
| Failure | Forgiving | Dr. Driving feel. No death, no wreck, no softlock |

### Explicitly not built

Multiplayer, physics engine, damage model, racing AI, real-world car likenesses.

## Architecture

### Streaming corridor world

Terrain is a **chunked heightfield**, 128 m chunks, generated on demand in a ring
around the player and released behind. World length is therefore unbounded at
constant memory — the journey is ~12–15 km, which a single fixed mesh could not hold.

**The road defines the terrain, not the reverse.** A Catmull-Rom spline runs through
authored control points; terrain elevation is blended toward the road's height inside
a corridor whose width falls off smoothly. This is what lets the road climb a pass and
drop into a gorge without fighting the noise function. Off-corridor terrain is pure
biome noise and fully drivable.

Determinism: all world randomness derives from a single seed via `mulberry32`
streams. Never `Math.random()` for anything placed in the world — chunks must
regenerate identically when revisited.

### Biomes

Biome identity is a function of distance along the road spline, blended at the
boundaries. Each biome supplies: elevation profile, colour palette, fog colour and
density, scatter set (species + density + size range), weather tendencies, animal
roster, valid task pool.

| # | Region | Character | Wildlife |
|---|---|---|---|
| 1 | Verdant Reach | Rolling greenland, wildflowers, warm low sun | Goats, sheep, deer |
| 2 | Duskwood Pines | Dense conifers, mist between trunks, fireflies at dusk | Elk, distant wolves |
| 3 | Emberfall Canyon | Red rock mesas, hard dry light, dust devils | Eagles, desert foxes |
| 4 | Whisper Falls | Layered rainforest canopy, waterfalls, humidity | Monkeys, macaws, tapir |
| 5 | Frostveil Pass | Snow peaks, blizzards, ice, caves. Hardest driving | Mountain goats, one snow leopard |
| 6 | Mirror Marsh | Wetland at night, still reflective water, low fog | Herons, deer, fireflies |
| 7 | Ashen Rise | Volcanic highland, black sand, steam vents, sparse life | Almost none — deliberate |
| 8 | The destination | Designed as a surprise; pays off the mystery and the biomes crossed | — |

Day/night runs continuously on a ~20 minute cycle. Weather is per-biome and affects
**grip and visibility**, not only appearance.

### Core loop

1. Fuel drains with throttle and distance. A full tank is about one biome leg.
2. Fuel stations sit at every biome boundary plus one midway — 14 total.
3. Arriving at a station offers **one task chosen at random from the pool valid for
   the current biome and time of day**. Completing it fills the tank.
4. Optional tasks scattered off-road bank spare jerrycans and sometimes reveal a
   hidden car. This is the payoff for leaving the road.
5. **Reserve tank**: at zero, the car limps at 25 km/h rather than stalling. The
   player always reaches the next station. Running dry costs time, never the run.

### Tasks

Every task implements the same interface so the station can pick blind:

```js
{ id, name, biomes: [...], timeOfDay: 'any'|'day'|'night', needsFoot: bool,
  start(ctx), update(dt, ctx), // returns 'running' | 'done' | 'failed'
  cleanup(ctx) }
```

Sixteen tasks: feed the goats · round up strays · photograph wildlife · clear the road ·
firewatch before dark · night in the cave · find water · dust-storm run · ford the
river · free the trapped animal · seed the canopy · avalanche escape · guide the lost
herd by headlight · firefly lanterns · weather the ashfall · repair the bridge.

Six require leaving the vehicle, so a **walk mode** exists: simple capsule movement
over the same heightfield, slower camera, interact prompt.

### Car

Arcade physics, no physics engine:

- Raycast suspension at four corners against the terrain height function
- Longitudinal: engine force curve, brake, drag, rolling resistance, surface friction
- Lateral: grip circle; exceeding it slips into a controllable drift
- Body aligned to interpolated ground normal
- Per-car tunables: mass, power, grip, ride height, drivetrain bias, steering rate

Roughly 250 lines. A physics library would be both heavier and worse — arcade feel
comes from breaking simulation rules on purpose.

**Procedural body generator**: 8 archetypes (hatch, muscle, SUV, pickup, offroader,
rally, van, supercar), each with tunable proportions, paint (metallic / matte /
pearl), wheel style, tyre profile, lift, bullbar, roof rack, spoiler, decals.
Hundreds of distinct originals.

**Registry** (`car/cars.js`): one entry per car. Either procedural
(`{ id, name, class, physics, body }`) or a dropped-in model
(`{ model: '/cars/x.glb' }`). Adding a car is one line plus a file.

Progression: start in a battered pickup; everything else is found at stations or
hidden off-road.

### Rendering

Sun that moves and shifts colour temperature · height fog tinted per biome · ~50k
instanced grass blades with a wind vertex shader · ACES filmic tonemapping with a
per-biome grade · bloom, vignette, SMAA · radial motion blur ramping with speed ·
envmap reflection on paint, emissive brake lights, headlight cones at night · tyre
dust and spray varying by surface · rain, snow, dust, ash · wet-road darkening and
reflection.

Every effect gates on a **quality tier** (`low` / `med` / `high` / `ultra`) probed
from the device at startup and overridable in settings.

### Controls

- **Phone**: two thumb pads — right throttle/brake, left steer. Optional tilt steering.
  On-foot uses a virtual stick.
- **PC**: WASD/arrows plus gamepad.

Both drive the same normalized input struct, so physics never knows which is in use.

## File layout

```
src/
  main.js          bootstrap, loop, mode switching
  quality.js       device probe + tier config
  world/  terrain.js biomes.js road.js scatter.js water.js sky.js weather.js
  car/    physics.js body.js cars.js camera.js
  player/ onfoot.js controls.js
  animals/ animals.js behaviour.js
  game/   fuel.js progress.js tasks/
  ui/     hud.js menus.js style.css
public/cars/       drop .glb here
test/              headless suites
tools/shot.mjs     puppeteer + SwiftShader screenshot harness
```

## Verification

The in-app browser pane has no WebGL on this machine. All visual verification runs
through `tools/shot.mjs` — puppeteer-core driving installed Chrome with
`--use-angle=swiftshader`, plus a `window.__game` debug handle exposing scene,
camera, renderer, input, `teleport()` and state setters. Per-page
`Emulation.setFocusEmulationEnabled` is required or background pages suspend rAF.

Logic suites (terrain determinism, road carving, physics integration) run in plain
node against the same modules, no browser.

## Build order

Each phase ends in something playable.

1. Terrain + road + drivable car, one biome
2. Graphics core — sky, fog, shadows, vegetation, post stack, quality tiers
3. Fuel + stations + first 3 tasks + walk mode — the loop closes
4. Biomes 2–4 with weather
5. Animals
6. Biomes 5–7
7. Remaining tasks to 16
8. Cars — generator, garage, unlocks, hidden finds
9. The destination
10. Polish, audio, mobile tuning, full playthrough
