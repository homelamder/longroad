import * as THREE from 'three';

// The procedural car factory. Eight archetype silhouettes, each reshaped by its
// spec's real dimensions (wheelBase, track, wheelR) plus styling — paint, finish,
// accessories. Every car in the game comes out of here unless a registry entry
// points at a .glb, so "hundreds of cars" costs data, not art.
//
// All bodies are original low-poly shapes. No real-world model is imitated —
// that boundary is what makes the roster shippable.

function mat(color, { rough = 0.42, metal = 0.4 } = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

const GLASS = () => new THREE.MeshStandardMaterial({
  color: 0x141b22, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.72,
});
const DARK = () => mat(0x1a1c1e, { rough: 0.7, metal: 0.2 });
const CHROME = () => mat(0xb8bcc0, { rough: 0.25, metal: 0.9 });

function box(g, w, h, d, m, x = 0, y = 0, z = 0, rx = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.rotation.x = rx;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}

// Archetype recipes. Each gets (group, L, W, paint, style) and sculpts the body
// above the floor line; wheels, lamps and accessories are common below.
const ARCHETYPES = {
  hatch(g, L, W, paint) {
    box(g, W, 0.52, L * 0.96, paint, 0, 0.48, 0);
    box(g, W * 0.92, 0.52, L * 0.52, paint, 0, 0.94, -L * 0.08);
    box(g, W * 0.84, 0.4, L * 0.46, GLASS(), 0, 1.0, -L * 0.08);
  },
  muscle(g, L, W, paint) {
    box(g, W, 0.5, L, paint, 0, 0.5, 0);
    box(g, W * 0.99, 0.2, L * 0.42, paint, 0, 0.82, L * 0.26);      // long bonnet
    box(g, W * 0.9, 0.44, L * 0.34, paint, 0, 0.98, -L * 0.12);
    box(g, W * 0.82, 0.34, L * 0.3, GLASS(), 0, 1.02, -L * 0.12);
    box(g, W * 0.7, 0.07, 0.5, DARK(), 0, 0.98, -L * 0.47);        // ducktail
  },
  suv(g, L, W, paint) {
    box(g, W, 0.66, L, paint, 0, 0.62, 0);
    box(g, W * 0.94, 0.6, L * 0.68, paint, 0, 1.22, -L * 0.06);
    box(g, W * 0.86, 0.46, L * 0.62, GLASS(), 0, 1.3, -L * 0.06);
  },
  pickup(g, L, W, paint) {
    box(g, W, 0.62, L, paint, 0, 0.52, 0);
    box(g, W * 0.94, 0.34, L * 0.42, paint, 0, 0.95, L * 0.14);
    box(g, W * 0.9, 0.66, L * 0.34, paint, 0, 1.2, -L * 0.05);
    box(g, W * 0.82, 0.5, L * 0.3, GLASS(), 0, 1.28, -L * 0.05);
    box(g, W * 0.98, 0.42, L * 0.36, paint, 0, 0.94, -L * 0.32);
    box(g, W * 0.86, 0.3, L * 0.32, DARK(), 0, 0.9, -L * 0.32);
  },
  offroader(g, L, W, paint) {
    box(g, W, 0.6, L * 0.98, paint, 0, 0.66, 0);
    box(g, W * 0.96, 0.62, L * 0.6, paint, 0, 1.26, -L * 0.1);
    box(g, W * 0.88, 0.48, L * 0.54, GLASS(), 0, 1.34, -L * 0.1);
    box(g, W * 0.3, 0.3, 0.3, DARK(), -W * 0.36, 1.68, -L * 0.34); // spare on the roof
  },
  rally(g, L, W, paint) {
    box(g, W, 0.5, L, paint, 0, 0.46, 0);
    box(g, W * 0.9, 0.46, L * 0.44, paint, 0, 0.92, -L * 0.04);
    box(g, W * 0.82, 0.36, L * 0.4, GLASS(), 0, 0.98, -L * 0.04);
    const wing = box(g, W * 0.86, 0.06, 0.34, DARK(), 0, 1.12, -L * 0.46);
    box(g, 0.08, 0.22, 0.2, DARK(), -W * 0.32, 0.98, -L * 0.46);
    box(g, 0.08, 0.22, 0.2, DARK(), W * 0.32, 0.98, -L * 0.46);
    void wing;
  },
  van(g, L, W, paint) {
    box(g, W, 0.6, L, paint, 0, 0.56, 0);
    box(g, W * 0.98, 0.94, L * 0.82, paint, 0, 1.32, -L * 0.08);   // tall box
    box(g, W * 0.9, 0.42, L * 0.2, GLASS(), 0, 1.42, L * 0.32);
  },
  supercar(g, L, W, paint) {
    box(g, W, 0.34, L, paint, 0, 0.36, 0);
    box(g, W * 0.98, 0.2, L * 0.5, paint, 0, 0.56, L * 0.2, -0.05); // wedge nose
    box(g, W * 0.88, 0.32, L * 0.4, paint, 0, 0.68, -L * 0.12);
    box(g, W * 0.8, 0.26, L * 0.36, GLASS(), 0, 0.74, -L * 0.08);
    box(g, W * 0.9, 0.05, 0.4, DARK(), 0, 0.86, -L * 0.46);
  },
};

export function buildCarBody(spec) {
  const g = new THREE.Group();
  g.name = `car-${spec.id}`;

  const style = spec.body || {};
  const paint = mat(style.paint ?? 0x9a3b2e, {
    rough: style.finish === 'matte' ? 0.75 : 0.42,
    metal: style.finish === 'matte' ? 0.15 : style.finish === 'pearl' ? 0.65 : 0.4,
  });
  const L = spec.wheelBase + 1.5;
  const W = spec.track + 0.36;

  (ARCHETYPES[spec.class] || ARCHETYPES.pickup)(g, L, W, paint);

  // Common furniture: bumpers, lamps.
  box(g, W + 0.1, 0.14, 0.28, CHROME(), 0, 0.5, L * 0.5);
  box(g, W + 0.1, 0.14, 0.28, CHROME(), 0, 0.5, -L * 0.5);

  const lamp = new THREE.MeshStandardMaterial({
    color: 0xfff3d0, emissive: 0xffe9b0, emissiveIntensity: 1.6, roughness: 0.3,
  });
  const tail = new THREE.MeshStandardMaterial({
    color: 0x5a1010, emissive: 0xff2010, emissiveIntensity: 0.35, roughness: 0.4,
  });
  const lampY = spec.class === 'supercar' ? 0.55 : 0.82;
  for (const sx of [-1, 1]) {
    box(g, 0.26, 0.15, 0.1, lamp, sx * W * 0.33, lampY, L * 0.51);
    box(g, 0.24, 0.17, 0.1, tail, sx * W * 0.33, lampY + 0.04, -L * 0.51);
  }
  g.userData.brakeMaterial = tail;
  g.userData.headMaterial = lamp;

  // Accessories from styling.
  if (style.bullbar) box(g, W * 0.8, 0.5, 0.12, CHROME(), 0, 0.95, L * 0.51);
  if (style.roofrack) {
    const top = spec.class === 'van' ? 1.84 : spec.class === 'suv' || spec.class === 'offroader' ? 1.6 : 1.32;
    box(g, W * 0.8, 0.07, L * 0.4, DARK(), 0, top, -L * 0.08);
  }
  if (style.stripe) {
    const stripe = box(g, W * 0.34, 0.02, L * 0.98, mat(style.stripe, { rough: 0.5, metal: 0.3 }), 0, (spec.class === 'supercar' ? 0.54 : 0.79) + 0.01, 0);
    stripe.castShadow = false;
  }

  // Wheels sized and placed from the physics spec, so visuals never argue with
  // the raycast corners.
  const tyre = new THREE.CylinderGeometry(spec.wheelR, spec.wheelR, 0.3 + (style.fatTyres ? 0.12 : 0), 18);
  tyre.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(spec.wheelR * 0.55, spec.wheelR * 0.55, 0.32 + (style.fatTyres ? 0.12 : 0), style.rimSpokes || 12);
  rimGeo.rotateZ(Math.PI / 2);
  const rubber = mat(0x1b1b1d, { rough: 0.95, metal: 0 });
  const rim = style.rimDark ? DARK() : CHROME();

  const wheels = [];
  const hb = spec.wheelBase * 0.5, ht = spec.track * 0.5;
  for (const [fz, fs] of [[hb, 1], [-hb, -1]]) {
    for (const sx of [-1, 1]) {
      const hub = new THREE.Group();
      hub.position.set(sx * ht, spec.wheelR, fz);
      const t = new THREE.Mesh(tyre, rubber);
      t.castShadow = true;
      const r = new THREE.Mesh(rimGeo, rim);
      r.position.x = sx * 0.02;
      const spin = new THREE.Group();
      spin.add(t, r);
      hub.add(spin);
      hub.userData.spin = spin;
      hub.userData.front = fs > 0;
      g.add(hub);
      wheels.push(hub);
    }
  }
  g.userData.wheels = wheels;
  return g;
}
