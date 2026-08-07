import * as THREE from 'three';

// Visual-state glue shared by every car body the generator (or a .glb) produces:
// headlight rig and physics-to-mesh posing. Body construction lives in generator.js.

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
