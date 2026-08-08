import { clamp } from '../world/rng.js';

// One normalized input struct, three sources. Physics never learns which one is in
// use, so the car handles identically on a phone and on a keyboard.
export class Controls {
  constructor(root = document.body) {
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false, sprint: false, jump: false };
    this.steerTarget = 0;
    this.keys = new Set();
    this.touch = { left: 0, right: 0, gas: 0, brake: 0, hand: false };
    this.tilt = false;
    this.tiltValue = 0;
    this.onCamera = null;
    this.onLook = null;

    // Hold-and-drag mouse look. Deltas stream to whoever registered onLook; no
    // pointer lock, so the cursor never gets trapped.
    let dragging = false;
    addEventListener('mousedown', (e) => { if (e.button === 0) dragging = true; });
    addEventListener('mouseup', () => { dragging = false; });
    addEventListener('mousemove', (e) => {
      if (dragging && this.onLook) this.onLook(e.movementX, e.movementY);
    });
    this.onRecover = null;
    this.onAction = null;
    this.isTouch = matchMedia('(pointer: coarse)').matches;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyC') this.onCamera?.();
      if (e.code === 'KeyR') this.onRecover?.();
      if (e.code === 'KeyE') this.onAction?.();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    this.buildTouchUI(root);
    if (this.isTouch) this.enableTilt();
  }

  buildTouchUI(root) {
    const pad = document.createElement('div');
    pad.className = 'pads' + (this.isTouch ? '' : ' pads-hidden');
    pad.innerHTML = `
      <div class="pad-cluster pad-steer">
        <button class="pad" data-k="left"  aria-label="Steer left">‹</button>
        <button class="pad" data-k="right" aria-label="Steer right">›</button>
      </div>
      <div class="pad-cluster pad-drive">
        <button class="pad pad-gas"   data-k="gas"   aria-label="Accelerate">▲</button>
        <button class="pad pad-brake" data-k="brake" aria-label="Brake and reverse">▼</button>
      </div>`;
    root.appendChild(pad);
    this.padRoot = pad;

    // The action button lives outside the pads container so it shows even where the
    // drive pads are hidden (desktop testing of touch flows) — but it is touch-only.
    const act = document.createElement('button');
    act.className = 'pad-action';
    act.setAttribute('aria-label', 'Interact');
    act.textContent = '✦';
    act.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      act.classList.add('down');
      this.onAction?.();
    });
    act.addEventListener('pointerup', () => act.classList.remove('down'));
    act.addEventListener('contextmenu', (e) => e.preventDefault());
    root.appendChild(act);
    this.actionBtn = act;

    // Pointer capture per button gives multi-touch for free: two thumbs, two ids.
    for (const b of pad.querySelectorAll('.pad')) {
      const k = b.dataset.k;
      const on = (e) => {
        e.preventDefault();
        b.setPointerCapture?.(e.pointerId);
        this.touch[k] = 1; b.classList.add('down');
      };
      const off = () => { this.touch[k] = 0; b.classList.remove('down'); };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('pointerleave', off);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  showAction(show) {
    // Desktop has the E key; the floating button is for thumbs.
    if (this.isTouch) this.actionBtn.classList.toggle('show', !!show);
  }

  // Tilt steering is opt-in: some players want it, some are on a bus.
  enableTilt() {
    addEventListener('deviceorientation', (e) => {
      if (e.gamma == null) return;
      // Portrait gamma is roll; landscape uses beta. Pick whichever axis is live.
      const raw = Math.abs(screen.orientation?.angle || 0) === 0 ? e.gamma : e.beta;
      this.tiltValue = clamp((raw || 0) / 26, -1, 1);
    });
  }

  setTilt(on) { this.tilt = on; }

  pollGamepad() {
    const pads = navigator.getGamepads?.() || [];
    for (const p of pads) {
      if (!p) continue;
      const steer = Math.abs(p.axes[0]) > 0.12 ? p.axes[0] : 0;
      const gas = p.buttons[7]?.value || 0;
      const brake = p.buttons[6]?.value || 0;
      if (steer || gas > 0.05 || brake > 0.05 || p.buttons[0]?.pressed) {
        return { steer, gas, brake, hand: !!p.buttons[0]?.pressed };
      }
    }
    return null;
  }

  update(dt) {
    const k = this.keys;
    const gp = this.pollGamepad();

    let steer = 0, gas = 0, brake = 0, hand = false;

    if (k.has('KeyA') || k.has('ArrowLeft')) steer -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) steer += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) gas = 1;
    if (k.has('KeyS') || k.has('ArrowDown')) brake = 1;
    if (k.has('Space')) hand = true;

    if (this.touch.left) steer -= 1;
    if (this.touch.right) steer += 1;
    gas = Math.max(gas, this.touch.gas);
    brake = Math.max(brake, this.touch.brake);
    if (this.tilt) steer = clamp(steer + this.tiltValue, -1, 1);

    if (gp) {
      steer = clamp(steer + gp.steer, -1, 1);
      gas = Math.max(gas, gp.gas);
      brake = Math.max(brake, gp.brake);
      hand = hand || gp.hand;
    }

    // Ramp rather than snap, or digital inputs make the car twitch.
    this.steerTarget = clamp(steer, -1, 1);
    const rate = this.steerTarget === 0 ? 11 : 7;
    this.state.steer += (this.steerTarget - this.state.steer) * Math.min(1, dt * rate);
    if (Math.abs(this.state.steer) < 0.002) this.state.steer = 0;

    this.state.throttle = gas;
    this.state.brake = brake;
    this.state.handbrake = hand;
    this.state.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    // Jump is edge-triggered: consumed the frame after Space goes down on foot.
    this.state.jump = k.has('Space') && !this._spaceHeld;
    this._spaceHeld = k.has('Space');
    return this.state;
  }
}
