import { samples } from './road.js';

// Where the final valley sits, derived from the road's true endpoint so the carve,
// the props and the ending trigger can never disagree. Depends only on road.js —
// terrain.js reads this to shape the bowl, finale.js to furnish it.
export const VALLEY = (() => {
  const end = samples[samples.length - 1];
  const prev = samples[samples.length - 8];
  const dx = end.x - prev.x, dz = end.z - prev.z;
  const d = Math.hypot(dx, dz) || 1;
  return {
    x: end.x + (dx / d) * 430,
    z: end.z + (dz / d) * 430,
    r: 520,
    floorY: end.y - 46,
    endX: end.x, endZ: end.z, endY: end.y,
    dirX: dx / d, dirZ: dz / d,
  };
})();
