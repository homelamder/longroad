import assert from 'node:assert/strict';
import { elevation, groundNormal, CHUNK, Terrain } from '../src/world/terrain.js';
import { pointAt, samples } from '../src/world/road.js';
import { JOURNEY, BIOMES, mixField } from '../src/world/biomes.js';

// Chunks get rebuilt as you drive back and forth. If the height function is not
// deterministic the world visibly shifts under the car.
for (let i = 0; i < 40; i++) {
  const x = -600 + i * 31.7, z = 200 + i * 371;
  assert.equal(elevation(x, z), elevation(x, z), 'elevation not deterministic');
}

// Nothing anywhere may be NaN — one bad vertex poisons a whole chunk's normals.
for (let z = 0; z <= JOURNEY; z += 250) {
  const p = pointAt(z);
  for (let o = -1000; o <= 1000; o += 125) {
    const y = elevation(p.x + o, p.z);
    assert.ok(Number.isFinite(y), `NaN elevation at ${p.x + o},${p.z}`);
  }
}

// On the tarmac the ground must be exactly the road surface, or the car sinks.
for (let d = 200; d < JOURNEY; d += 537) {
  const p = pointAt(d);
  assert.ok(Math.abs(elevation(p.x, p.z) - p.y) < 0.5,
    `road bed disagrees with road at ${d}`);
}

// The road bed must be drivable. Grade is rise over horizontal run between adjacent
// centreline samples — 25% is a brutal alpine pass, anything past that is a wall.
let worst = 0, worstAt = 0;
for (let i = 1; i < samples.length; i++) {
  const a = samples[i - 1], b = samples[i];
  const run = Math.hypot(b.x - a.x, b.z - a.z);
  if (run < 0.1) continue;
  const grade = Math.abs(elevation(b.x, b.z) - elevation(a.x, a.z)) / run;
  if (grade > worst) { worst = grade; worstAt = b.d; }
}
assert.ok(worst < 0.25,
  `road too steep: ${(worst * 100).toFixed(1)}% grade at ${worstAt.toFixed(0)} m`);

// Every region must actually have its own relief off the road, or the world is a
// ribbon of tarmac through a flat plain. Measured as spread across many samples
// rather than deviation at one fixed offset — a single offset can sit on a contour.
for (const b of BIOMES) {
  const start = BIOMES.indexOf(b) === 0 ? 0 : BIOMES[BIOMES.indexOf(b) - 1].end;
  let lo = Infinity, hi = -Infinity;
  for (let d = start + 200; d < b.end - 200; d += 90) {
    const p = pointAt(d);
    for (const off of [-800, -450, -180, 180, 450, 800]) {
      const y = elevation(p.x + p.rx * off, p.z + p.rz * off);
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  assert.ok(hi - lo > b.relief * 1.2,
    `${b.name} is too flat off-road: ${(hi - lo).toFixed(0)} m spread for relief ${b.relief}`);
}

// Immediately beside the road there must be a shelf to pull off onto, not a cliff.
// Without it the mountain pass is a slot canyon you cannot leave.
for (let d = 8800; d < 10600; d += 60) {
  const p = pointAt(d);
  for (const off of [-70, -55, 55, 70]) {
    const y = elevation(p.x + p.rx * off, p.z + p.rz * off);
    assert.ok(Math.abs(y - p.y) < 26,
      `wall ${Math.abs(y - p.y).toFixed(0)} m high, ${Math.abs(off)} m from the road at ${d} m`);
  }
}

// Far from the road the land walls up, so no invisible barriers are needed.
let walled = 0;
for (let d = 800; d < JOURNEY; d += 811) {
  const p = pointAt(d);
  for (const side of [1, -1]) {
    const near = elevation(p.x + p.rx * side * 200, p.z + p.rz * side * 200);
    const far = elevation(p.x + p.rx * side * 1300, p.z + p.rz * side * 1300);
    if (far > near + 150) walled++;
  }
}
assert.ok(walled > 20, `corridor walls missing (${walled} of ~36 sampled)`);

// Ground normals point up and are unit length.
for (let i = 0; i < 30; i++) {
  const p = pointAt(300 + i * 431);
  const n = groundNormal(p.x + 40, p.z);
  assert.ok(Math.abs(n.length() - 1) < 1e-5, 'normal not unit');
  assert.ok(n.y > 0, 'normal points down');
}

// The high pass has to reach snow, or "mountains covered in snow" is a lie.
let snowy = 0;
for (let d = 9200; d < 10700; d += 40) {
  const p = pointAt(d);
  if (elevation(p.x + 400, p.z) > mixField(p.z, 'snow')) snowy++;
}
assert.ok(snowy > 20, `Frostveil never reaches the snowline (${snowy} samples above)`);

// ...and the hot canyon must not. Snowcaps on red desert rock read as a bug.
for (let d = 4800; d < 6300; d += 50) {
  const p = pointAt(d);
  for (const off of [300, 700, 1100]) {
    assert.ok(elevation(p.x + off, p.z) < mixField(p.z, 'snow'),
      `Emberfall reaches its snowline at ${d} m, ${off} m off road`);
  }
}

// Chunk streaming: builds what is in range, releases what is not.
const t = new Terrain({ quality: 'low' });
t.settle(0, 0);
const built = t.chunks.size;
assert.ok(built > 20, `too few chunks built (${built})`);
assert.equal(t.queue.length, 0, 'settle left work queued');
for (const e of t.chunks.values()) assert.ok(e.mesh, 'chunk with no mesh after settle');

t.settle(0, CHUNK * 30);
assert.equal(t.chunks.size, built, 'chunk count changed after moving');
let stale = 0;
for (const e of t.chunks.values()) if (e.cz < 30 - t.radius) stale++;
assert.equal(stale, 0, `${stale} chunks left behind after moving away`);
assert.equal(t.group.children.length, t.chunks.size, 'scene graph out of step with chunk map');

// Geometry sanity on a real chunk.
const geo = [...t.chunks.values()][0].mesh.geometry;
const pos = geo.getAttribute('position').array;
for (let i = 0; i < pos.length; i++) assert.ok(Number.isFinite(pos[i]), 'NaN in chunk geometry');
assert.ok(geo.getAttribute('color'), 'chunk has no vertex colours');

console.log(`terrain ok — ${built} chunks, steepest grade ${(worst * 100).toFixed(1)}% `
  + `at ${(worstAt / 1000).toFixed(1)} km, ${walled} walled samples, ${snowy} above snowline`);
