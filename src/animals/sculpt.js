import * as THREE from 'three';

// Sculpted megafauna. Everything here follows the species-geometry contract:
// one merged BufferGeometry, colours baked per vertex, ready for InstancedMesh.
//
// Two things separate these from the first-generation sphere blobs:
//  - density: parts carry enough vertices that silhouettes curve, and
//  - paint: colour is a function of position, not a flat tint per part —
//    giraffes get their patchwork, elephants get mottled hide, cats get fur
//    tone that breaks the plastic look. No UVs needed; the paint is 3D.

// --- tiny 3D value noise (hash-based, deterministic) ------------------------
function hash3(x, y, z) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const s = (t) => t * t * (3 - 2 * t);
  const u = s(xf), v = s(yf), w = s(zf);
  let out = 0;
  for (const [dx, wx] of [[0, 1 - u], [1, u]]) {
    for (const [dy, wy] of [[0, 1 - v], [1, v]]) {
      for (const [dz, wz] of [[0, 1 - w], [1, w]]) {
        out += hash3(xi + dx, yi + dy, zi + dz) * wx * wy * wz;
      }
    }
  }
  return out;
}

// Worley-ish cellular distance, for the giraffe patchwork: distance to the
// nearest jittered cell centre. Ridges (large values) become the cream seams.
export function cell3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let best = 8;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cx = xi + dx, cy = yi + dy, cz = zi + dz;
        const jx = cx + hash3(cx, cy, cz);
        const jy = cy + hash3(cy, cz, cx);
        const jz = cz + hash3(cz, cx, cy);
        const d = Math.hypot(x - jx, y - jy, z - jz);
        if (d < best) best = d;
      }
    }
  }
  return best;
}

// --- assembly ---------------------------------------------------------------

export function makeParts() {
  const parts = [];
  const push = (geo, m, tint) => {
    const c = geo.applyMatrix4(m);
    c.computeVertexNormals();
    parts.push([c, tint]);
  };
  const M = (x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) => {
    const m = new THREE.Matrix4().makeScale(sx, sy, sz);
    if (rx) m.premultiply(new THREE.Matrix4().makeRotationX(rx));
    if (rz) m.premultiply(new THREE.Matrix4().makeRotationZ(rz));
    return m.premultiply(new THREE.Matrix4().makeTranslation(x, y, z));
  };
  return { parts, push, M };
}

// Merge parts into one geometry. `painter`, when given, computes the colour per
// vertex from (position, partTint) — this is where hide and fur come from.
export function mergeParts(parts, painter = null) {
  const pos = [], nor = [], col = [], idx = [];
  let base = 0;
  const c = new THREE.Color();
  const p3 = new THREE.Vector3();
  for (const [geo, tint] of parts) {
    c.setHex(tint, 'srgb');
    const p = geo.getAttribute('position'), n = geo.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      p3.set(p.getX(i), p.getY(i), p.getZ(i));
      pos.push(p3.x, p3.y, p3.z);
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      if (painter) {
        const out = painter(p3, c);
        col.push(out.r, out.g, out.b);
      } else {
        col.push(c.r, c.g, c.b);
      }
    }
    const index = geo.getIndex();
    for (let i = 0; i < index.count; i++) idx.push(base + index.getX(i));
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

// Fur painter for the cats and the bear: low-frequency tone drift plus a fine
// grain, so flanks stop reading as injection-moulded plastic.
const _f = new THREE.Color();
export function furPainter(strength = 0.14) {
  return (p, tint) => {
    const drift = (noise3(p.x * 2.1, p.y * 2.1, p.z * 2.1) - 0.5) * 2 * strength;
    const grain = (noise3(p.x * 14, p.y * 14, p.z * 14) - 0.5) * strength * 0.7;
    const k = 1 + drift + grain;
    return _f.setRGB(
      Math.min(1, tint.r * k),
      Math.min(1, tint.g * k),
      Math.min(1, tint.b * k),
    );
  };
}

// --- the elephant -----------------------------------------------------------
// A 2.8 m matriarch: domed head, trunk in falling segments, sail ears, tusks,
// pillar legs. Hide is grey with dust-coloured mottling — Emberfall's red dust
// works into the skin exactly as it does on real desert elephants.
export function buildElephantBody() {
  const { parts, push, M } = makeParts();
  const HIDE = 0x8a8078, DARKH = 0x6e655d, TUSK = 0xe8e0cc;

  push(new THREE.SphereGeometry(1.0, 20, 16), M(0, 1.72, -0.1, 1.05, 1.0, 1.45), HIDE);   // body
  push(new THREE.SphereGeometry(0.78, 18, 14), M(0, 1.9, 0.55, 0.95, 0.95, 1.0), HIDE);   // shoulder
  push(new THREE.SphereGeometry(0.8, 18, 14), M(0, 1.68, -0.85, 0.98, 0.92, 1.0), HIDE);  // rump
  push(new THREE.SphereGeometry(0.52, 18, 14), M(0, 2.2, 1.28), HIDE);                    // head dome
  push(new THREE.SphereGeometry(0.34, 14, 10), M(0, 2.0, 1.62, 1.0, 0.85, 0.9), HIDE);    // face

  // Trunk: five shrinking segments arcing down and slightly forward.
  const trunkY = [1.78, 1.5, 1.2, 0.92, 0.68];
  const trunkZ = [1.78, 1.86, 1.9, 1.9, 1.86];
  for (let i = 0; i < 5; i++) {
    const r = 0.19 - i * 0.026;
    push(new THREE.SphereGeometry(r, 12, 9), M(0, trunkY[i], trunkZ[i], 1, 1.35, 1), DARKH);
  }

  for (const sx of [-1, 1]) {
    // Ears: broad flattened spheres swept back against the head.
    push(new THREE.SphereGeometry(0.5, 16, 12),
      M(sx * 0.62, 2.24, 1.1, 0.18, 1.05, 0.8, 0, sx * -0.35), DARKH);
    // Tusks: thin cones curving forward from under the face.
    push(new THREE.ConeGeometry(0.055, 0.62, 8),
      M(sx * 0.2, 1.62, 1.72, 1, 1, 1, 2.5, sx * 0.25), TUSK);
    // Legs: true pillars, front pair slightly forward.
    for (const [lz, lx] of [[0.55, 0.42], [-0.78, 0.46]]) {
      push(new THREE.CylinderGeometry(0.21, 0.25, 1.15, 10), M(sx * lx, 0.58, lz), HIDE);
    }
  }
  push(new THREE.CylinderGeometry(0.03, 0.045, 0.9, 6), M(0, 1.5, -1.42, 1, 1, 1, 0.5), DARKH); // tail
  push(new THREE.SphereGeometry(0.06, 6, 5), M(0, 1.05, -1.6), DARKH);

  return mergeParts(parts, (p, tint) => {
    // Mottled hide: patches of dust tone worked into the grey, heavier low on
    // the body where the animal dusts itself.
    const mottle = noise3(p.x * 3.2, p.y * 3.2, p.z * 3.2);
    const dust = Math.max(0, 1.2 - p.y * 0.55) * 0.25 * noise3(p.x * 1.4, 7, p.z * 1.4);
    const k = 0.9 + mottle * 0.2;
    return _f.setRGB(
      Math.min(1, tint.r * k + dust * 0.35),
      Math.min(1, tint.g * k + dust * 0.22),
      Math.min(1, tint.b * k + dust * 0.12),
    );
  });
}

// --- the giraffe ------------------------------------------------------------
// 4.2 m of neck and legs. The patchwork is cellular: tawny patches split by
// cream seams, fading toward the belly and legs, exactly as the real coat does.
export function buildGiraffeBody() {
  const { parts, push, M } = makeParts();
  const COAT = 0xc89858, CREAM = 0xe8dcc0, DARKG = 0x6b4a26;

  push(new THREE.SphereGeometry(0.62, 18, 14), M(0, 2.05, -0.15, 0.9, 1.0, 1.35), COAT);  // body
  push(new THREE.SphereGeometry(0.5, 16, 12), M(0, 2.3, 0.42, 0.85, 0.95, 0.9), COAT);    // withers

  // Neck: six segments rising steeply forward.
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const r = 0.3 - t * 0.13;
    push(new THREE.SphereGeometry(r, 14, 10),
      M(0, 2.55 + t * 1.5, 0.62 + t * 0.55, 1, 1.5, 1), COAT);
  }
  push(new THREE.SphereGeometry(0.19, 14, 10), M(0, 4.2, 1.32, 1.0, 0.9, 1.35), COAT);    // head
  push(new THREE.SphereGeometry(0.1, 10, 8), M(0, 4.12, 1.56, 0.9, 0.7, 1.0), DARKG);     // muzzle
  for (const sx of [-1, 1]) {
    push(new THREE.CylinderGeometry(0.02, 0.025, 0.16, 6), M(sx * 0.07, 4.4, 1.28), DARKG); // ossicones
    push(new THREE.SphereGeometry(0.035, 6, 5), M(sx * 0.07, 4.49, 1.28), DARKG);
    push(new THREE.SphereGeometry(0.07, 8, 6), M(sx * 0.16, 4.28, 1.2, 0.5, 1, 0.8), COAT); // ears
    // Legs: long and slightly knock-kneed, rear pair shorter.
    push(new THREE.CylinderGeometry(0.09, 0.065, 1.9, 8), M(sx * 0.34, 0.95, 0.42), COAT);
    push(new THREE.CylinderGeometry(0.09, 0.065, 1.7, 8), M(sx * 0.36, 0.85, -0.62, 1, 1, 1, 0.12), COAT);
  }
  push(new THREE.CylinderGeometry(0.025, 0.035, 1.0, 6), M(0, 1.8, -0.98, 1, 1, 1, 0.35), COAT); // tail
  push(new THREE.SphereGeometry(0.06, 6, 5), M(0, 1.28, -1.18), DARKG);

  const coat = new THREE.Color(COAT).convertSRGBToLinear();
  const cream = new THREE.Color(CREAM).convertSRGBToLinear();
  const dark = new THREE.Color(DARKG).convertSRGBToLinear();
  return mergeParts(parts, (p, tint) => {
    if (tint.equals(dark)) return tint;
    // The patchwork lives on body and neck; belly and lower legs fade to cream.
    const seam = cell3(p.x * 2.6, p.y * 2.6, p.z * 2.6);
    const patch = seam < 0.42 ? 1 : 0;
    const fade = Math.min(1, Math.max(0, (p.y - 1.1) / 0.9));
    const tone = (noise3(p.x * 5, p.y * 5, p.z * 5) - 0.5) * 0.12;
    _f.copy(cream).lerp(patch ? coat : cream, fade);
    if (patch && fade > 0.2) _f.multiplyScalar(0.92 + tone);
    return _f;
  });
}
