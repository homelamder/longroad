import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { asset } from '../asset.js';
import { elevation } from '../world/terrain.js';
import { obstaclesNear } from '../world/scatter.js';
import { clamp, lerp } from '../world/rng.js';

// Walk mode. Exists because six of the sixteen tasks happen out of the car — you do
// not feed goats or light a fire through a windscreen. Tank-style controls on
// purpose: the same left/right + forward inputs as driving, so the phone pads and
// WASD keep their meaning and nothing needs relearning.

const WALK = 3.2;          // m/s
const TURN = 2.6;          // rad/s

export class OnFoot {
  constructor() {
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.moving = 0;
    this.bob = 0;
    this.mesh = buildWalker();
    this.mesh.visible = false;

    // A civilian human (Quaternius Animated Human, CC0, converted FBX -> GLB with
    // fbx2gltf). Clips ship as 'Human Armature|Idle' etc; strip the prefix. The
    // texture is a 32x32 palette assigned at runtime because fbx2gltf could not
    // embed it. If anything fails to load the capsule walker keeps the job.
    this.mixer = null;
    this.actions = null;
    this.activeAction = null;
    this.vy = 0;
    this.jumping = false;
    // Vite-only: node test runs stub the DOM, so the bundler env is the real tell.
    if (import.meta.env) new GLTFLoader().load(asset('/models/human.glb'), (gltf) => {
      const human = gltf.scene;
      // Normalize to a 1.75 m person whatever unit the FBX arrived in.
      const box = new THREE.Box3().setFromObject(human);
      const h = box.max.y - box.min.y || 1;
      human.scale.setScalar(1.75 / h);
      human.rotation.y = Math.PI;
      const skin = new THREE.TextureLoader().load(asset('/models/human_skin.png'));
      skin.flipY = false;                    // glTF UV convention
      skin.colorSpace = THREE.SRGBColorSpace;
      skin.magFilter = THREE.NearestFilter;  // palette texture: crisp cells, no smear
      human.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = false;
          o.material = new THREE.MeshStandardMaterial({ map: skin, roughness: 0.86 });
          o.frustumCulled = false;           // skinned bounds lag the pose
        }
      });
      for (const child of [...this.mesh.children]) this.mesh.remove(child);
      this.mesh.add(human);
      this.mixer = new THREE.AnimationMixer(human);
      this.actions = {};
      for (const clip of gltf.animations) {
        this.actions[clip.name.replace(/^.*\|/, '')] = this.mixer.clipAction(clip);
      }
      const idle = this.actions.Idle || Object.values(this.actions)[0];
      if (idle) { idle.play(); this.activeAction = idle; }
      this.human = human;
    }, undefined, () => { /* capsule fallback stands */ });
    this._f = new THREE.Vector3();
  }

  // Step out beside the driver's door.
  placeBeside(car) {
    const r = car.right(this._f);
    this.pos.copy(car.pos).addScaledVector(r, -(car.spec.track * 0.5 + 1.1));
    this.pos.y = elevation(this.pos.x, this.pos.z);
    this.yaw = car.yaw;
    this.mesh.visible = true;
  }

  hide() { this.mesh.visible = false; }

  forward(out = this._f) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  // Crossfade helper: switch the active clip only when the target changes.
  play(name) {
    if (!this.actions || !this.actions[name] || this.activeAction === this.actions[name]) return;
    const next = this.actions[name];
    next.reset().fadeIn(0.18).play();
    if (this.activeAction) this.activeAction.fadeOut(0.18);
    this.activeAction = next;
  }

  // One-shot overlay (Working, Jump): plays over the locomotion blend, then hands
  // control back to the state machine on its own.
  playOnce(name) {
    if (!this.actions || !this.actions[name]) return;
    const a = this.actions[name];
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = false;
    a.fadeIn(0.08).play();
    this.oneShot = a;
    this.oneShotT = a.getClip().duration;
  }

  update(dt, input, camYaw = null) {
    // With the mouse orbit active, W walks where the camera looks and A/D strafe.
    // Without it, classic tank turning stays.
    if (camYaw !== null) {
      const fwd = (input.throttle || 0) - (input.brake || 0);
      const strafe = input.steer || 0;
      if (Math.abs(fwd) > 0.02 || Math.abs(strafe) > 0.02) {
        this.yaw = camYaw + Math.atan2(strafe, fwd >= 0 ? Math.max(fwd, 0.001) : fwd);
      }
    } else {
      this.yaw -= (input.steer || 0) * TURN * dt;
    }

    const go = clamp((input.throttle || 0) - (input.brake || 0) * 0.55, -0.55, 1);
    this.moving = lerp(this.moving, go, Math.min(1, dt * 8));

    // Sprint doubles the stride; jump is a small ballistic arc with its clip.
    const sprint = input.sprint && this.moving > 0.05 ? 1.9 : 1;
    if (input.jump && !this.jumping) {
      this.jumping = true;
      this.vy = 4.6;
      this.playOnce('Jump');
    }
    if (this.jumping) {
      this.vy -= 13.5 * dt;
      this.jumpY = (this.jumpY || 0) + this.vy * dt;
      if (this.jumpY <= 0) { this.jumpY = 0; this.jumping = false; this.vy = 0; }
    }

    if (Math.abs(this.moving) > 0.02) {
      const f = this.forward();
      const step = WALK * sprint * this.moving * dt;
      const nx = this.pos.x + f.x * step, nz = this.pos.z + f.z * step;
      const ny = elevation(nx, nz);
      // Legs refuse slopes wheels would relish.
      if (Math.abs(ny - this.pos.y) / Math.max(Math.abs(step), 0.001) < 1.1) {
        this.pos.set(nx, ny, nz);
      }
      this.bob += dt * 9 * Math.abs(this.moving);
    }

    const obs = obstaclesNear(this.pos.x, this.pos.z, this._obs || (this._obs = []));
    for (const o of obs) {
      const dx = this.pos.x - o.x, dz = this.pos.z - o.z;
      const rr = o.r + 0.35;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 0.001;
        this.pos.x += (dx / d) * (rr - d);
        this.pos.z += (dz / d) * (rr - d);
        this.pos.y = elevation(this.pos.x, this.pos.z);
      }
    }
    this.mesh.position.copy(this.pos);
    if (!this.human) this.mesh.position.y += Math.abs(Math.sin(this.bob)) * 0.06;
    this.mesh.rotation.y = this.yaw;

    this.mesh.position.y += this.jumpY || 0;

    if (this.mixer) {
      if (this.oneShotT > 0) {
        this.oneShotT -= dt;
        if (this.oneShotT <= 0 && this.oneShot) { this.oneShot.fadeOut(0.12); this.oneShot = null; }
      } else {
        const sp = Math.abs(this.moving || 0) * (input.sprint ? 1.9 : 1);
        this.play(sp > 0.85 ? 'Run' : sp > 0.06 ? 'Walk' : 'Idle');
      }
      this.mixer.update(dt);
    }

    const swing = Math.sin(this.bob) * 0.5 * Math.abs(this.moving);
    this.mesh.userData.legL.rotation.x = swing;
    this.mesh.userData.legR.rotation.x = -swing;
    this.mesh.userData.armL.rotation.x = -swing * 0.7;
    this.mesh.userData.armR.rotation.x = swing * 0.7;
  }
}

// A small explorer: rangy, weathered, backpack. Original low-poly shapes.
function buildWalker() {
  const g = new THREE.Group();
  g.name = 'walker';
  const skin = new THREE.MeshStandardMaterial({ color: 0xb98a62, roughness: 0.8 });
  const coat = new THREE.MeshStandardMaterial({ color: 0x7a5a34, roughness: 0.85 });
  const trouser = new THREE.MeshStandardMaterial({ color: 0x4a4438, roughness: 0.9 });
  const packMat = new THREE.MeshStandardMaterial({ color: 0x5e3f2a, roughness: 0.9 });

  const part = (geo, m, x, y, z) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };

  part(new THREE.CapsuleGeometry(0.21, 0.5, 3, 8), coat, 0, 1.05, 0);
  part(new THREE.SphereGeometry(0.15, 10, 8), skin, 0, 1.62, 0);
  part(new THREE.CylinderGeometry(0.19, 0.16, 0.1, 8), coat, 0, 1.74, 0);   // hat brim-ish
  part(new THREE.BoxGeometry(0.34, 0.44, 0.2), packMat, 0, 1.12, -0.24);

  const limb = (m, x, y, len) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const bone = part(new THREE.CapsuleGeometry(0.06, len, 2, 6), m, 0, 0, 0);
    bone.position.y = -len / 2 - 0.06;
    g.remove(bone);
    pivot.add(bone);
    g.add(pivot);
    return pivot;
  };
  g.userData.legL = limb(trouser, -0.11, 0.62, 0.5);
  g.userData.legR = limb(trouser, 0.11, 0.62, 0.5);
  g.userData.armL = limb(coat, -0.28, 1.38, 0.42);
  g.userData.armR = limb(coat, 0.28, 1.38, 0.42);
  return g;
}
