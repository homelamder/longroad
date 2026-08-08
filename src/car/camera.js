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
    this.t = 0;              // shake clock
    this.prevSpeed = 0;      // for accel-based dive/squat
    this.dive = 0;
    this.lean = 0;
  }

  cycle() {
    this.mode = { chase: 'dash', dash: 'hood', hood: 'far', far: 'chase' }[this.mode] || 'chase';
  }

  // `car` here is anything with pos, forward() and optionally speed — the on-foot
  // player satisfies the same contract, which is what mode 'foot' relies on.
  update(dt, car) {
    const f = car.forward(this._f);
    const speed = Math.abs(car.speed || 0);
    const t = clamp(speed / 35, 0, 1);

    let back, up, ahead, stiff;
    if (this.mode === 'foot') { back = 4.4; up = 2.1; ahead = 5.5; stiff = 7; }
    else if (this.mode === 'dash') {
      // Driver's eye: inside the cabin, rigid to the car. Eye height per class.
      const low = car.spec && (car.spec.class === 'supercar' || car.spec.class === 'muscle');
      back = (car.spec ? car.spec.wheelBase : 3) * 0.16;
      up = low ? 0.98 : 1.28;
      ahead = 16; stiff = 30;
    }
    else if (this.mode === 'hood') { back = -0.2; up = 1.55; ahead = 14; stiff = 22; }
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
      car.pos.y + (this.mode === 'foot' ? 1.4 : 1.1),
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

    // Cockpit feel. Strongest at the wheel, a whisper in chase, absent in far.
    this.t += dt;
    const speedAbs = Math.abs(car.speed);
    const accel = dt > 0 ? (speedAbs - this.prevSpeed) / dt : 0;
    this.prevSpeed = speedAbs;
    if (this.mode === 'dash' || this.mode === 'hood' || this.mode === 'chase') {
      const inCab = this.mode !== 'chase';
      const sp = clamp(speedAbs / 38, 0, 1);
      // Road texture: high-frequency micro-jitter, rougher off the tarmac.
      const rough = car.onRoad ? 0.5 : 1.6;
      const amp = (inCab ? 0.0035 : 0.0012) * rough * Math.pow(sp, 1.4)
        + (car.airborne ? 0.004 : 0);
      const nx = Math.sin(this.t * 37.7) + 0.6 * Math.sin(this.t * 59.3 + 1.3);
      const ny = Math.sin(this.t * 43.1 + 0.7) + 0.6 * Math.sin(this.t * 67.9);
      // Head-lean: slide and steering tip the head into the corner; braking dives.
      const targetLean = inCab
        ? clamp(-car.lateral * 0.016 - car.steerAngle * sp * 0.5, -0.1, 0.1) : 0;
      this.lean = lerp(this.lean, targetLean, Math.min(1, dt * 5));
      const targetDive = inCab ? clamp(-accel * 0.004, -0.03, 0.045) : 0;
      this.dive = lerp(this.dive, targetDive, Math.min(1, dt * 4));
      this.camera.rotateZ(this.lean + nx * amp);
      this.camera.rotateX(this.dive + ny * amp * 0.7);
    }

    const wantFov = this.mode === 'foot' ? this.baseFov
      : this.baseFov + t * 13 + (car.airborne ? 3 : 0);
    if (Math.abs(this.camera.fov - wantFov) > 0.01) {
      this.camera.fov = lerp(this.camera.fov, wantFov, 1 - Math.exp(-4 * dt));
      this.camera.updateProjectionMatrix();
    }
  }

  snap(car) { this.ready = false; this.update(0.016, car); }
}
