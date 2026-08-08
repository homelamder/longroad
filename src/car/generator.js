import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// The procedural car factory, mark II. Bodies are no longer boxes: each class is a
// side-profile silhouette swept across the car's width with a bevelled edge, then
// smoothed — which is how the hull picks up long, curved highlights from the HDRI
// the way real paintwork does. All silhouettes remain original designs.

function paintMat(style) {
  return new THREE.MeshPhysicalMaterial({
    color: style.paint ?? 0x9a3b2e,
    roughness: style.finish === 'matte' ? 0.62 : 0.32,
    metalness: style.finish === 'pearl' ? 0.6 : 0.22,
    clearcoat: style.finish === 'matte' ? 0.25 : 1.0,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.25,
  });
}

const GLASS = () => new THREE.MeshPhysicalMaterial({
  color: 0x0c1218, roughness: 0.05, metalness: 0.1,
  transparent: true, opacity: 0.82, envMapIntensity: 1.4,
});
const DARK = () => new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.62, metalness: 0.25 });
const CHROME = () => new THREE.MeshStandardMaterial({ color: 0xc4c8cc, roughness: 0.18, metalness: 0.95, envMapIntensity: 1.3 });
const RUBBER = () => new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.94, metalness: 0 });

// --- profile library ---------------------------------------------------------
// Points run nose -> roof -> tail as [z, y] in unit space: z 0..1 (front..rear),
// y in metres. Scaled to the spec's real length at build time. The floor line and
// wheel cutouts are added automatically.
const PROFILES = {
  hatch: [
    [0.00, 0.46], [0.03, 0.62], [0.10, 0.72], [0.30, 0.8], [0.38, 0.84],
    [0.46, 1.1], [0.58, 1.2], [0.80, 1.18], [0.92, 1.08], [0.985, 0.84], [1.0, 0.56],
  ],
  muscle: [
    [0.00, 0.46], [0.02, 0.60], [0.08, 0.72], [0.42, 0.80], [0.50, 0.83],
    [0.58, 1.06], [0.70, 1.14], [0.86, 1.1], [0.96, 0.92], [1.0, 0.66],
  ],
  suv: [
    [0.00, 0.52], [0.03, 0.72], [0.10, 0.84], [0.26, 0.94], [0.34, 0.98],
    [0.42, 1.34], [0.56, 1.44], [0.88, 1.42], [0.97, 1.28], [1.0, 0.72],
  ],
  pickup: [
    [0.00, 0.50], [0.03, 0.68], [0.10, 0.80], [0.28, 0.92], [0.36, 0.96],
    [0.44, 1.30], [0.56, 1.40], [0.64, 1.38], [0.66, 0.98], [0.98, 0.96], [1.0, 0.6],
  ],
  offroader: [
    [0.00, 0.55], [0.02, 0.78], [0.08, 0.90], [0.24, 0.96], [0.32, 1.0],
    [0.40, 1.38], [0.52, 1.46], [0.90, 1.44], [0.98, 1.3], [1.0, 0.78],
  ],
  rally: [
    [0.00, 0.46], [0.03, 0.6], [0.10, 0.72], [0.32, 0.8], [0.40, 0.84],
    [0.48, 1.08], [0.60, 1.16], [0.82, 1.12], [0.94, 0.96], [1.0, 0.6],
  ],
  van: [
    [0.00, 0.48], [0.02, 0.70], [0.06, 0.92], [0.16, 1.24], [0.24, 1.52],
    [0.40, 1.60], [0.92, 1.58], [0.985, 1.36], [1.0, 0.66],
  ],
  supercar: [
    [0.00, 0.36], [0.04, 0.5], [0.14, 0.62], [0.2, 0.66], [0.36, 0.64], [0.44, 0.66],
    [0.52, 0.94], [0.64, 1.0], [0.8, 0.96], [0.9, 0.82], [0.97, 0.72], [1.0, 0.54],
  ],
};

// Cabin glass as an inset band following the roofline, per class: [zStart, zEnd].
const CABIN = {
  hatch: [0.42, 0.95], muscle: [0.54, 0.90], suv: [0.38, 0.94], pickup: [0.40, 0.66],
  offroader: [0.36, 0.94], rally: [0.44, 0.88], van: [0.12, 0.5], supercar: [0.48, 0.86],
};

function profileShape(points, L, floor) {
  const shape = new THREE.Shape();
  shape.moveTo(-L / 2, floor);
  for (const [t, y] of points) shape.lineTo(t * L - L / 2, y);
  shape.lineTo(L / 2, floor);
  shape.closePath();
  return shape;
}

function extrudeProfile(points, L, W, floor, { bevel = 0.09, curveSegments = 6 } = {}) {
  const geo = new THREE.ExtrudeGeometry(profileShape(points, L, floor), {
    depth: W - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments,
  });
  geo.translate(0, 0, -(W - bevel * 2) / 2);
  // Extrude lays the profile's length along X and the sweep (width) along Z; the
  // car's forward axis is +Z, so rotate the whole solid into car space once here —
  // nose (t = 0) lands at +Z, width across X.
  geo.rotateY(Math.PI / 2);
  // Crease-aware smoothing: hull faces flow into each other, edges stay edges.
  return toCreasedNormals(geo, Math.PI / 5);
}

export function buildCarBody(spec) {
  const g = new THREE.Group();
  g.name = `car-${spec.id}`;
  const style = spec.body || {};
  const paint = paintMat(style);
  const dark = DARK();
  const chrome = CHROME();

  const L = spec.wheelBase + 1.55;
  const W = spec.track + 0.3;
  const floor = 0.28;
  const cls = PROFILES[spec.class] ? spec.class : 'pickup';

  // Hull. The profile runs nose(+z) to tail(-z) — flip z so +z is forward.
  const hull = new THREE.Mesh(extrudeProfile(PROFILES[cls], L, W, floor), paint);
  hull.castShadow = true;
  hull.receiveShadow = true;
  g.add(hull);

  // Cabin glass: a narrower, slightly taller sweep over the cabin span, so panes
  // read as glass set into the body rather than painted on.
  const [c0, c1] = CABIN[cls];
  const roof = PROFILES[cls];
  const cabinPts = [[c0, floor + 0.02]];
  for (const [t, y] of roof) {
    if (t >= c0 - 0.04 && t <= c1 + 0.04) cabinPts.push([t, y + 0.012]);
  }
  cabinPts.push([c1, floor + 0.02]);
  const glassGeo = extrudeProfile(cabinPts, L, W * 0.86, floor + 0.01, { bevel: 0.04 });
  const glass = new THREE.Mesh(glassGeo, GLASS());
  g.add(glass);

  // Wheel arches: dark rings that seat the wheels into the body.
  const archGeo = new THREE.TorusGeometry(spec.wheelR + 0.04, 0.045, 8, 22, Math.PI);
  const hb = spec.wheelBase * 0.5, ht = spec.track * 0.5;
  for (const fz of [hb, -hb]) {
    for (const sx of [-1, 1]) {
      const arch = new THREE.Mesh(archGeo, dark);
      arch.position.set(sx * (ht + 0.07), spec.wheelR + 0.02, fz);
      arch.rotation.y = Math.PI / 2;
      g.add(arch);
    }
  }

  // Furniture.
  const bumperGeo = new RoundedBoxGeometry(W * 0.98, 0.17, 0.26, 3, 0.07);
  for (const [z, y] of [[L / 2 - 0.02, 0.42], [-L / 2 + 0.02, 0.44]]) {
    const b = new THREE.Mesh(bumperGeo, dark);
    b.position.set(0, y, z);
    b.castShadow = true;
    g.add(b);
  }
  const grille = new THREE.Mesh(new RoundedBoxGeometry(W * 0.5, 0.16, 0.06, 2, 0.03), dark);
  grille.position.set(0, 0.56, L / 2 + 0.05);
  g.add(grille);
  for (const sx of [-1, 1]) {
    const mirror = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.09, 0.16, 2, 0.02), paint);
    const mirrorY = cls === 'van' || cls === 'suv' || cls === 'offroader' ? 1.16 : cls === 'supercar' ? 0.72 : 0.98;
    mirror.position.set(sx * (W / 2 + 0.09), mirrorY, L / 2 - CABIN[cls][0] * L + 0.1);
    g.add(mirror);
  }

  // Lamps: lens glass over emissive cores.
  const lamp = new THREE.MeshStandardMaterial({
    color: 0xfff3d0, emissive: 0xffe9b0, emissiveIntensity: 1.6, roughness: 0.2,
  });
  const tail = new THREE.MeshStandardMaterial({
    color: 0x5a1010, emissive: 0xff2010, emissiveIntensity: 0.35, roughness: 0.25,
  });
  const lampY = { supercar: 0.5, muscle: 0.6, hatch: 0.62, rally: 0.62 }[cls] ?? 0.78;
  const lampGeo = new RoundedBoxGeometry(0.3, 0.13, 0.09, 2, 0.035);
  for (const sx of [-1, 1]) {
    const head = new THREE.Mesh(lampGeo, lamp);
    head.position.set(sx * W * 0.32, lampY, L / 2 + 0.03);
    g.add(head);
    const rear = new THREE.Mesh(lampGeo, tail);
    rear.position.set(sx * W * 0.32, lampY + 0.05, -L / 2 - 0.03);
    g.add(rear);
  }
  g.userData.brakeMaterial = tail;
  g.userData.headMaterial = lamp;

  // Class accessories.
  if (style.bullbar) {
    const frame = new THREE.Mesh(new RoundedBoxGeometry(W * 0.6, 0.46, 0.07, 2, 0.03), chrome);
    frame.position.set(0, 0.72, L / 2 + 0.12);
    g.add(frame);
    for (const sx of [-0.18, 0.18]) {
      const post = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.42, 0.12, 2, 0.02), chrome);
      post.position.set(sx * W, 0.7, L / 2 + 0.08);
      g.add(post);
    }
  }
  if (style.roofrack) {
    const top = { van: 1.66, suv: 1.5, offroader: 1.52 }[cls] ?? 1.24;
    const rack = new THREE.Mesh(new RoundedBoxGeometry(W * 0.78, 0.06, L * 0.4, 2, 0.03), dark);
    rack.position.set(0, top, -L * 0.08);
    g.add(rack);
  }
  if (cls === 'rally' || cls === 'supercar') {
    const wing = new THREE.Mesh(new RoundedBoxGeometry(W * 0.9, 0.05, 0.3, 2, 0.02), dark);
    wing.position.set(0, cls === 'rally' ? 1.16 : 0.95, -L / 2 + 0.12);
    g.add(wing);
    for (const sx of [-1, 1]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.14), dark);
      strut.position.set(sx * W * 0.3, (cls === 'rally' ? 1.16 : 0.95) - 0.11, -L / 2 + 0.12);
      g.add(strut);
    }
  }
  if (style.stripe) {
    const stripe = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 0.32, L * 0.96),
      new THREE.MeshStandardMaterial({ color: style.stripe, roughness: 0.4, metalness: 0.2 }),
    );
    stripe.rotation.x = -Math.PI / 2;
    const stripeY = Math.max(...PROFILES[cls].map((p) => p[1])) + 0.015;
    stripe.position.set(0, stripeY * 0.72, 0);
    g.add(stripe);
  }

  // Wheels: high-seg tyres, rim dish, six spokes, hub.
  const fat = style.fatTyres ? 0.1 : 0;
  const tyreGeo = new THREE.CylinderGeometry(spec.wheelR, spec.wheelR, 0.3 + fat, 28);
  tyreGeo.rotateZ(Math.PI / 2);
  const dishGeo = new THREE.CylinderGeometry(spec.wheelR * 0.6, spec.wheelR * 0.64, 0.26 + fat, 22);
  dishGeo.rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.045, spec.wheelR * 0.95, 0.06);
  const hubGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.34 + fat, 12);
  hubGeo.rotateZ(Math.PI / 2);
  const rubber = RUBBER();
  const rim = style.rimDark ? DARK() : CHROME();

  const wheels = [];
  for (const [fz, front] of [[hb, true], [-hb, false]]) {
    for (const sx of [-1, 1]) {
      const hub = new THREE.Group();
      hub.position.set(sx * (ht + 0.07), spec.wheelR, fz);
      const spin = new THREE.Group();
      const t = new THREE.Mesh(tyreGeo, rubber);
      t.castShadow = true;
      spin.add(t);
      const dish = new THREE.Mesh(dishGeo, dark);
      spin.add(dish);
      for (let k = 0; k < 6; k++) {
        const spoke = new THREE.Mesh(spokeGeo, rim);
        spoke.rotation.x = (k / 6) * Math.PI * 2;
        spoke.position.x = sx * (0.09 + fat / 2);
        spin.add(spoke);
      }
      const hubCap = new THREE.Mesh(hubGeo, rim);
      spin.add(hubCap);
      hub.add(spin);
      hub.userData.spin = spin;
      hub.userData.front = front;
      g.add(hub);
      wheels.push(hub);
    }
  }
  g.userData.wheels = wheels;

  // Interior for the dashboard camera: dash top, instrument brow, steering wheel
  // on a column, A-pillar hints. Hidden until the camera is inside; the hull's
  // front faces cull themselves automatically from within.
  const interior = new THREE.Group();
  const dashTop = { supercar: 0.62, muscle: 0.72, hatch: 0.74, rally: 0.74, van: 0.98 }[cls] ?? 0.86;
  const dashZ = L / 2 - CABIN[cls][0] * L - 0.05;
  const dashMat = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.88 });
  const dash = new THREE.Mesh(new RoundedBoxGeometry(W * 0.86, 0.16, 0.5, 2, 0.05), dashMat);
  dash.position.set(0, dashTop, dashZ);
  dash.rotation.x = -0.12;
  interior.add(dash);
  const brow = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.1, 0.16, 2, 0.03), dashMat);
  brow.position.set(W * 0.22, dashTop + 0.1, dashZ - 0.12);
  interior.add(brow);
  const dial = new THREE.Mesh(
    new THREE.CircleGeometry(0.055, 20),
    new THREE.MeshStandardMaterial({ color: 0xd8e4ee, emissive: 0x93b8d0, emissiveIntensity: 0.5 }),
  );
  dial.position.set(W * 0.22, dashTop + 0.1, dashZ - 0.035);
  interior.add(dial);

  const wheelRim = new THREE.Mesh(
    new THREE.TorusGeometry(0.19, 0.021, 10, 28),
    new THREE.MeshStandardMaterial({ color: 0x232426, roughness: 0.6 }),
  );
  const spokeM = new THREE.MeshStandardMaterial({ color: 0x2c2d30, roughness: 0.55 });
  const steering = new THREE.Group();
  steering.add(wheelRim);
  for (const a of [0, 2.1, -2.1]) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.18, 0.02), spokeM);
    sp.position.set(Math.sin(a) * 0.09, -Math.cos(a) * 0.09, 0);
    sp.rotation.z = -a;
    steering.add(sp);
  }
  steering.position.set(W * 0.22, dashTop + 0.02, dashZ - 0.2);
  steering.rotation.x = 0.32;
  interior.add(steering);

  const pillarM = new THREE.MeshStandardMaterial({ color: 0x232427, roughness: 0.8 });
  for (const sx of [-1, 1]) {
    const pillar = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.55, 0.09, 2, 0.02), pillarM);
    pillar.position.set(sx * W * 0.41, dashTop + 0.32, dashZ + 0.06);
    pillar.rotation.x = -0.45;
    interior.add(pillar);
  }
  // The hull's own bonnet backface-culls from the driver's seat, which would leave
  // lamp housings and the bullbar floating in space — so the interior carries its
  // own bonnet panel, pitched from windshield base down to the nose line.
  const noseY = PROFILES[cls][0][1];
  const windY = dashTop + 0.06;
  const bl = (L / 2) - dashZ - 0.06;
  const bonnet = new THREE.Mesh(
    new RoundedBoxGeometry(W * 0.96, 0.06, bl, 2, 0.03),
    paint,
  );
  bonnet.position.set(0, (windY + noseY) / 2 + 0.03, dashZ + bl / 2 + 0.03);
  bonnet.rotation.x = -Math.atan2(windY - noseY, bl);   // nose end pitches DOWN
  interior.add(bonnet);

  interior.visible = false;
  g.add(interior);
  g.userData.interior = interior;
  g.userData.steering = steering;
  return g;
}
