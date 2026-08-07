import * as THREE from 'three';

// ponytail: boxes and cylinders. The procedural body generator lands in phase 8 —
// this exists so phase 1 has something to look at that reads as a truck.

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({
  color, roughness: 0.45, metalness: 0.35, ...opts,
});

function box(w, h, d, m, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildCarMesh(spec) {
  const g = new THREE.Group();
  g.name = 'car';

  const paint = mat(0x2f5d4a);
  const dark = mat(0x1a1c1e, { roughness: 0.7, metalness: 0.2 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x141b22, roughness: 0.08, metalness: 0.1,
    transparent: true, opacity: 0.72,
  });
  const chrome = mat(0xb8bcc0, { roughness: 0.25, metalness: 0.9 });

  const L = spec.wheelBase + 1.5, W = spec.track + 0.36;

  const hull = box(W, 0.62, L, paint, 0, 0.52, 0);
  g.add(hull);
  g.add(box(W * 0.94, 0.34, L * 0.42, paint, 0, 0.95, L * 0.14));      // bonnet line
  const cab = box(W * 0.9, 0.66, L * 0.34, paint, 0, 1.2, -L * 0.05);
  g.add(cab);
  g.add(box(W * 0.82, 0.5, L * 0.3, glass, 0, 1.28, -L * 0.05));       // greenhouse
  g.add(box(W * 0.98, 0.42, L * 0.36, paint, 0, 0.94, -L * 0.32));     // bed sides
  g.add(box(W * 0.86, 0.3, L * 0.32, dark, 0, 0.9, -L * 0.32));        // bed floor
  g.add(box(W + 0.1, 0.16, 0.3, chrome, 0, 0.62, L * 0.5));            // front bumper
  g.add(box(W + 0.1, 0.16, 0.3, chrome, 0, 0.62, -L * 0.5));           // rear bumper
  g.add(box(W * 0.8, 0.5, 0.12, chrome, 0, 1.05, L * 0.51));           // bullbar

  const lamp = new THREE.MeshStandardMaterial({
    color: 0xfff3d0, emissive: 0xffe9b0, emissiveIntensity: 1.6, roughness: 0.3,
  });
  const tail = new THREE.MeshStandardMaterial({
    color: 0x5a1010, emissive: 0xff2010, emissiveIntensity: 0.35, roughness: 0.4,
  });
  for (const sx of [-1, 1]) {
    g.add(box(0.3, 0.18, 0.1, lamp, sx * W * 0.33, 0.86, L * 0.52));
    g.add(box(0.26, 0.2, 0.1, tail, sx * W * 0.33, 0.9, -L * 0.52));
  }
  g.userData.brakeMaterial = tail;
  g.userData.headMaterial = lamp;

  const tyre = new THREE.CylinderGeometry(spec.wheelR, spec.wheelR, 0.32, 18);
  tyre.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(spec.wheelR * 0.55, spec.wheelR * 0.55, 0.34, 12);
  rimGeo.rotateZ(Math.PI / 2);
  const rubber = mat(0x1b1b1d, { roughness: 0.95, metalness: 0.0 });

  const wheels = [];
  const hb = spec.wheelBase * 0.5, ht = spec.track * 0.5;
  for (const [fz, fs] of [[hb, 1], [-hb, -1]]) {
    for (const sx of [-1, 1]) {
      const hub = new THREE.Group();
      hub.position.set(sx * ht, spec.wheelR, fz);
      const t = new THREE.Mesh(tyre, rubber);
      t.castShadow = true;
      const r = new THREE.Mesh(rimGeo, chrome);
      r.position.x = sx * 0.02;
      const spin = new THREE.Group();
      spin.add(t); spin.add(r);
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

// Headlights: two spots for the pool of light on the road, and the lamp glass lit up.
// No shadow casting — two more shadow maps cost more than every other night effect
// put together and buy almost nothing at night.
//
// ponytail: no visible beam cone. An additive cone in the air is the obvious way to
// draw a light shaft, but from a chase camera it hangs over the bodywork as a hard-
// edged grey bag and reads as a rendering bug. The pools on the road already sell it.
export function addHeadlights(mesh, spec) {
  const L = spec.wheelBase + 1.5, W = spec.track + 0.36;
  const spots = [];

  for (const sx of [-1, 1]) {
    const spot = new THREE.SpotLight(0xffeec4, 0, 78, 0.55, 0.6, 1.1);
    spot.position.set(sx * W * 0.33, 0.86, L * 0.5);
    spot.target.position.set(sx * W * 0.2, -0.9, L * 0.5 + 24);
    mesh.add(spot);
    mesh.add(spot.target);
    spots.push(spot);
  }

  return {
    on: false,
    update(want) {
      if (want === this.on) return;
      this.on = want;
      for (const s of spots) s.intensity = want ? 52 : 0;
      mesh.userData.headMaterial.emissiveIntensity = want ? 2.6 : 0.35;
    },
  };
}

// Pose the visual mesh from physics state. Kept apart from the physics so the two
// can never drift out of step through a shared mutable object.
export function poseCar(mesh, car) {
  mesh.position.copy(car.pos);
  mesh.rotation.set(0, car.yaw, 0, 'YXZ');
  mesh.rotateX(-car.pitch);
  mesh.rotateZ(-car.roll);
  for (const hub of mesh.userData.wheels) {
    hub.userData.spin.rotation.x = car.wheelSpin;
    hub.rotation.y = hub.userData.front ? car.steerAngle : 0;
  }
  mesh.userData.brakeMaterial.emissiveIntensity = car.braking ? 2.4 : 0.35;
}
