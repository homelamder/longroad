import * as THREE from 'three';
import { elevation } from '../world/terrain.js';
import { clamp, lerp } from '../world/rng.js';

// A chase camera that lags. The lag IS the sense of speed — a rigidly parented
// camera makes 140 km/h feel like 40.
export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.baseFov = 62;
    this.mode = 'chase';
    this._want = new THREE.Vector3();
    this._wantLook = new THREE.Vector3();
    this._f = new THREE.Vector3();
    this.ready = false;
  }

  cycle() {
    this.mode = this.mode === 'chase' ? 'hood' : this.mode === 'hood' ? 'far' : 'chase';
  }

  update(dt, car) {
    const f = car.forward(this._f);
    const speed = Math.abs(car.speed);
    const t = clamp(speed / 35, 0, 1);

    let back, up, ahead, stiff;
    if (this.mode === 'hood') { back = -0.2; up = 1.55; ahead = 14; stiff = 22; }
    else if (this.mode === 'far') { back = lerp(11, 15.5, t); up = lerp(5.2, 6.4, t); ahead = 16; stiff = 3.0; }
    else { back = lerp(7.2, 9.4, t); up = lerp(3.0, 3.7, t); ahead = 11; stiff = 4.2; }

    this._want.set(
      car.pos.x - f.x * back,
      car.pos.y + up,
      car.pos.z - f.z * back,
    );
    // Never let the camera end up inside a hillside behind the car.
    const floor = elevation(this._want.x, this._want.z) + 1.4;
    if (this._want.y < floor) this._want.y = floor;

    this._wantLook.set(
      car.pos.x + f.x * ahead,
      car.pos.y + 1.1,
      car.pos.z + f.z * ahead,
    );

    if (!this.ready) {
      this.pos.copy(this._want); this.look.copy(this._wantLook); this.ready = true;
    } else {
      const k = 1 - Math.exp(-stiff * dt);
      this.pos.lerp(this._want, k);
      this.look.lerp(this._wantLook, 1 - Math.exp(-(stiff + 3) * dt));
    }

    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);

    const wantFov = this.baseFov + t * 13 + (car.airborne ? 3 : 0);
    if (Math.abs(this.camera.fov - wantFov) > 0.01) {
      this.camera.fov = lerp(this.camera.fov, wantFov, 1 - Math.exp(-4 * dt));
      this.camera.updateProjectionMatrix();
    }
  }

  snap(car) { this.ready = false; this.update(0.016, car); }
}
