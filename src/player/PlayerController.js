import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { terrainHeight, clamp, WORLD } from '../world/heightfield.js';

// First-person controller: pointer-lock mouse look, WASD + sprint, circle
// collision against the static collider grid, terrain grounding, head bob.

export class PlayerController {
  constructor({ camera, input, grid, stats }) {
    this.camera = camera;
    this.input = input;
    this.grid = grid;
    this.stats = stats;

    this.position = new THREE.Vector3(4, 0, 14);
    this.position.y = terrainHeight(this.position.x, this.position.z);
    this.yaw = 0.28; // facing the wreck
    this.pitch = 0;
    this.vel = new THREE.Vector3();
    this.bobTime = 0;
    this.smoothY = this.position.y;
    this.isSprinting = false;
    this.speed2D = 0;
    this.lookDX = 0;
    this.lookDY = 0;
    this.stance = 'stand'; // 'stand' | 'crouch' | 'prone'
    this.eyeHeightCur = CONFIG.player.eyeHeight;
    this.crouchToggled = false; // KeyC toggles; Ctrl still crouches only while held
    this.proneToggled = false; // KeyZ toggles

    camera.rotation.order = 'YXZ';
    input.onPress('KeyC', () => { this.crouchToggled = !this.crouchToggled; });
    input.onPress('KeyZ', () => { this.proneToggled = !this.proneToggled; });
  }

  /** Kick from firing the rifle: pitch up + small random yaw. */
  addRecoil(pitchKick, yawKick) {
    this.pitch = clamp(this.pitch + pitchKick, -1.45, 1.45);
    this.yaw += yawKick;
  }

  update(dt) {
    const P = CONFIG.player;

    // --- look ---
    const { dx, dy } = this.input.consumeMouseDelta();
    this.lookDX = dx;
    this.lookDY = dy;
    this.yaw -= dx * P.lookSensitivity;
    this.pitch = clamp(this.pitch - dy * P.lookSensitivity, -1.45, 1.45);

    // --- move ---
    const f = (this.input.isDown('KeyW') ? 1 : 0) - (this.input.isDown('KeyS') ? 1 : 0);
    const s = (this.input.isDown('KeyD') ? 1 : 0) - (this.input.isDown('KeyA') ? 1 : 0);
    const moving = f !== 0 || s !== 0;

    // Stance: Z (toggled by press) is the deepest, prone, and wins over
    // crouch; crouch comes from either KeyC (also toggled) or Ctrl
    // (crouches only while held). Standing is the only stance that can
    // sprint.
    const ctrlHeld = this.input.isDown('ControlLeft') || this.input.isDown('ControlRight');
    this.stance = this.proneToggled ? 'prone'
      : (this.crouchToggled || ctrlHeld) ? 'crouch'
      : 'stand';

    const exhausted = this.stats.energy < 12;
    this.isSprinting =
      moving && f > 0 && !exhausted && this.stance === 'stand' &&
      (this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight'));

    let speed;
    if (this.stance === 'prone') speed = P.proneSpeed;
    else if (this.stance === 'crouch') speed = P.crouchSpeed;
    else speed = (this.isSprinting ? P.sprintSpeed : P.walkSpeed) * (exhausted ? 0.85 : 1);

    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    // yaw = 0 faces -Z (north)
    const fwdX = -sinY, fwdZ = -cosY;
    const rightX = cosY, rightZ = -sinY;

    let wishX = fwdX * f + rightX * s;
    let wishZ = fwdZ * f + rightZ * s;
    if (moving) {
      const len = Math.hypot(wishX, wishZ);
      wishX = (wishX / len) * speed;
      wishZ = (wishZ / len) * speed;
    } else {
      wishX = 0;
      wishZ = 0;
    }

    const accel = Math.min(1, dt * 10);
    this.vel.x += (wishX - this.vel.x) * accel;
    this.vel.z += (wishZ - this.vel.z) * accel;

    let nx = this.position.x + this.vel.x * dt;
    let nz = this.position.z + this.vel.z * dt;
    [nx, nz] = this.grid.resolveCircle(nx, nz, P.radius);
    nx = clamp(nx, WORLD.minX + 8, WORLD.maxX - 8);
    nz = clamp(nz, WORLD.minZ + 8, WORLD.maxZ - 8);
    this.position.set(nx, terrainHeight(nx, nz), nz);

    // --- camera: smoothed ground follow + head bob ---
    this.smoothY += (this.position.y - this.smoothY) * Math.min(1, dt * 12);
    this.speed2D = Math.hypot(this.vel.x, this.vel.z);
    if (this.speed2D > 0.5) this.bobTime += dt * this.speed2D * 1.35;
    const bobAmt = clamp(this.speed2D / P.sprintSpeed, 0, 1);
    const bobY = Math.sin(this.bobTime * 2) * 0.04 * bobAmt;
    const roll = Math.cos(this.bobTime) * 0.006 * bobAmt;

    const targetEye = this.stance === 'prone' ? P.proneEyeHeight
      : this.stance === 'crouch' ? P.crouchEyeHeight
      : P.eyeHeight;
    this.eyeHeightCur += (targetEye - this.eyeHeightCur) * Math.min(1, dt * 8);

    this.camera.position.set(nx, this.smoothY + this.eyeHeightCur + bobY, nz);
    this.camera.rotation.set(this.pitch, this.yaw, roll);
  }
}
