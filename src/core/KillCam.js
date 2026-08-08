import * as THREE from 'three';
import { makeGlowSprite } from './glow.js';
import { CONFIG } from './config.js';

// Slow-motion third-person bullet cam, in the spirit of Sniper Elite's
// killcam: earn a headshot or a dead-centre plate hit and the world drops
// into slow motion while the camera pulls off your shoulder and chases the
// round to the target.
//
// The shot is judged at the trigger, not on impact (see Weapon._predictShot)
// — by the time the round lands there is no flight left to show.
//
// Timing is deliberately split. The world runs on scaled time, so the bullet
// really does crawl; the camera's own easing and the hold at the end run on
// *real* time, so the sequence takes the same couple of seconds whether the
// shot was 60m or 500m. Without that split a close headshot would be over
// before it registered, and a long one would overstay badly.


export class KillCam {
  constructor({ camera, scene, hud, onChange }) {
    this.onChange = onChange || (() => {});
    this.camera = camera;
    this.scene = scene;
    this.hud = hud;

    this.active = false;
    this.timeScale = 1;

    // The round itself. Invisible in normal play (a rifle bullet is not
    // something you see); it only exists so there's something to follow.
    this.tracer = makeGlowSprite(0xffd9a0, 0.5, 0.95);
    this.tracer.visible = false;
    this.scene.add(this.tracer);

    this._desired = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  /** @returns true if the sequence actually started. */
  start({ bullet, point, kind, flightTime }, shooterPos) {
    if (this.active) return false;
    if (shooterPos.distanceTo(point) < CONFIG.killcam.minDistance) return false;

    this.bullet = bullet;
    this.impact = point.clone();
    this.phase = 'flight';
    this.holdT = 0;
    this.orbit = 0;

    // Scale time so the remaining flight fills FLIGHT_SECONDS regardless of
    // range, clamped so it never becomes a crawl or a blink.
    this.timeScale = THREE.MathUtils.clamp(flightTime / CONFIG.killcam.flightSeconds, 0.04, 0.35);
    this.active = true;

    // A scoped 26° view makes a claustrophobic cinematic; widen out and
    // restore whatever the player had when we hand the camera back.
    this.prevFov = this.camera.fov;
    this.camera.fov = 55;
    this.camera.updateProjectionMatrix();

    this.tracer.position.copy(bullet.pos);
    this.tracer.visible = true;
    this.hud.setKillcam(kind);
    this.onChange(true);
    return true;
  }

  /** @param realDt unscaled delta — the camera moves in real time even
   *   though the world it's watching does not. */
  update(realDt) {
    if (!this.active) return;
    const cam = this.camera;

    if (this.phase === 'flight') {
      const b = this.bullet;
      this.tracer.position.copy(b.pos);

      // Trail the round, offset to one side and slightly above, looking at
      // where it's going to land. Framing the *impact point* rather than the
      // bullet is what makes the shot read: the target sits still in frame
      // and grows, while the round streaks in toward it.
      this._dir.copy(b.vel).normalize();
      this._right.crossVectors(this._dir, this._up).normalize();

      // The offset drifts slowly around the flight axis. Held rigid, a long
      // shot is two seconds of the camera staring at a distant speck with
      // nothing moving but the ground; rotating it keeps parallax alive so
      // you can feel the round travelling.
      this.orbit += realDt * 0.7;
      const swing = Math.cos(this.orbit);
      this._desired.copy(b.pos)
        .addScaledVector(this._dir, -3.4)
        .addScaledVector(this._right, 2.3 * swing)
        .addScaledVector(this._up, 1.15 + 0.75 * Math.sin(this.orbit));

      cam.position.lerp(this._desired, Math.min(1, realDt * 7));
      cam.lookAt(this.impact);

      if (b.resolved) {
        this.phase = 'impact';
        if (b.impact) this.impact.copy(b.impact);
        this.tracer.visible = false;
        // Slow further for the moment of contact.
        this.timeScale = 0.12;
      }
      return;
    }

    // Impact: ease in and drift around the strike, then hand back.
    this.holdT += realDt;
    this.orbit += realDt * 0.55;
    const r = 4.2;
    this._desired.set(
      this.impact.x + Math.cos(this.orbit) * r,
      this.impact.y + 1.5,
      this.impact.z + Math.sin(this.orbit) * r
    );
    cam.position.lerp(this._desired, Math.min(1, realDt * 3.2));
    cam.lookAt(this.impact);

    if (this.holdT >= CONFIG.killcam.impactHold) this.stop();
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.timeScale = 1;
    this.tracer.visible = false;
    this.bullet = null;
    this.camera.fov = this.prevFov;
    this.camera.updateProjectionMatrix();
    this.hud.setKillcam(null);
    this.onChange(false);
  }
}
