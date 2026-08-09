import * as THREE from 'three';
import { terrainHeight } from './heightfield.js';
import { makeSmokeSprite, makeSparkSprite } from '../core/particleTextures.js';
import { CONFIG } from '../core/config.js';

/**
 * A quadcopter patrolling the range — the only target that moves under its own
 * power, and the only one that takes more than a single hit.
 *
 * The plates teach elevation and the balloons teach wind. A drone teaches the
 * third thing neither can: **lead**. It crosses at a steady speed, so a hit
 * needs the reticle put where it's going to be rather than where it is, and at
 * 400m with a 0.5s time of flight that's several metres of it.
 *
 * Three hits, each of which visibly changes the thing you're shooting at:
 *   1st — white smoke, flight otherwise steady
 *   2nd — dark smoke, and it starts to wallow: banking further, losing height,
 *         and slowing in a way that ruins the lead you'd just worked out
 *   3rd — it comes down
 *
 * That escalation is deliberately readable from the firing line. A health bar
 * would say the same thing more precisely and be worth much less: the point is
 * that you can see how badly you've hurt it from 400m through a scope, so a
 * damaged drone becomes a decision — finish it, or take the plate that's about
 * to drop.
 */

// Drones patrol *above* the sightline to the 700m plate, which is the upper
// envelope of every line of sight on the range — so they read against open
// sky and can never sit in front of something you're trying to range.
//
// These aren't eyeballed. Each circuit was checked against all twelve plate
// sightlines over the drone's whole excursion envelope, not just the ideal
// ellipse: peak gust blowing it off station (±4.9m with the lurching a
// crippled one does), vertical bob, and the full `sagMax` of height it loses
// before going down — every worst case applied at once. Clearance to the
// nearest sightline is 8.6m / 13.4m / 17.7m, and ground clearance at least
// 13.7m. Widening a radius is what breaks this: swing much past 38m off the
// lane and the circuit rides up into the shoulder rather than the sightlines.
export const DRONE_CIRCUITS = [
  { dist: 120, offX: -14, rx: 30, rz: 30, alt: 29, period: 26, colour: 0x51565e },
  { dist: 250, offX: -12, rx: 26, rz: 26, alt: 42, period: 34, colour: 0x5c5347 },
  { dist: 400, offX: -12, rx: 26, rz: 26, alt: 56, period: 42, colour: 0x4a5450 },
];

const HEALTHY = 0;
const WHITE = 1;
const DARK = 2;

const SMOKE_POOL = 26;

const _v = new THREE.Vector3();

export class Drone {
  constructor({ dist, offX, rx, rz, alt, period, colour }, laneX, firingZ, phase) {
    this.dist = dist;
    this.hp = CONFIG.drone.hitsToKill;
    this.dead = false;
    this.deadT = 0;
    this.exploded = false;

    // Sized for the range it patrols, exactly as the plates and balloons are:
    // a real quadcopter is half a metre across and would be a single pixel at
    // 400m. Readability wins over scale here, and consistently so.
    this.span = 2.0 + dist * 0.01;

    this.centre = new THREE.Vector3(laneX + offX, alt, firingZ - dist);
    this.rx = rx;
    this.rz = rz;
    this.omega = (Math.PI * 2) / period;
    this.angle = phase;
    this.wobble = 0;      // grows as it takes damage; drives the wallowing
    this.sag = 0;         // height lost, capped so it can't dip into a sightline
    this.fallVel = new THREE.Vector3();

    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);

    const s = this.span;
    const shell = new THREE.MeshStandardMaterial({
      color: colour, roughness: 0.55, metalness: 0.35,
      emissive: 0x14171a, emissiveIntensity: 0.5,
    });

    const hull = new THREE.Mesh(new THREE.BoxGeometry(s * 0.34, s * 0.15, s * 0.5), shell);
    hull.castShadow = true;
    this.body.add(hull);
    this.parts = [hull];

    // Arms out to four rotors, and the rotors themselves as thin discs. They
    // spin fast enough to blur into the classic grey ring.
    this.rotors = [];
    const armMat = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.8 });
    const rotorMat = new THREE.MeshStandardMaterial({
      color: 0xb9bec4, roughness: 0.4, transparent: true, opacity: 0.45,
      side: THREE.DoubleSide, emissive: 0x6a7078, emissiveIntensity: 0.3,
    });
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const ax = ox * s * 0.3, az = oz * s * 0.3;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(s * 0.07, s * 0.05, s * 0.07), armMat);
      arm.position.set(ax * 0.55, 0, az * 0.55);
      arm.scale.set(Math.abs(ox) * 6 + 1, 1, Math.abs(oz) * 6 + 1);
      this.body.add(arm);
      this.parts.push(arm);

      const rotor = new THREE.Mesh(new THREE.CircleGeometry(s * 0.22, 14), rotorMat);
      rotor.rotation.x = -Math.PI / 2;
      rotor.position.set(ax, s * 0.09, az);
      this.body.add(rotor);
      this.rotors.push(rotor);
      this.parts.push(rotor);
    }

    // A blinking nav light, which is most of what makes it findable against
    // sky at 400m before you've got the scope on it.
    this.lampMat = new THREE.MeshBasicMaterial({ color: 0xff3b2f, toneMapped: false });
    this.lamp = new THREE.Mesh(new THREE.SphereGeometry(s * 0.055, 8, 6), this.lampMat);
    this.lamp.position.set(0, -s * 0.11, s * 0.2);
    this.body.add(this.lamp);
    this.parts.push(this.lamp);

    // One invisible box decides hits, and none of the visible parts do.
    //
    // Shooting the real geometry sounds more honest and plays much worse: the
    // rotor discs are wide, thin and horizontal, so from the firing line they
    // present almost no area, and a round that clipped one would stop dead
    // without registering damage — a drone that reads as bulletproof from the
    // angle you actually shoot it from. The proxy covers the silhouette you
    // can see at 400m, which is the thing you were aiming at.
    //
    // It works precisely because three.js raycasts on layers and geometry, not
    // on `visible` — the same behaviour that makes hidden meshes an ongoing
    // hazard here (verified against three 0.170: an invisible mesh still
    // returns intersections; only overriding `raycast` removes it).
    for (const part of this.parts) part.raycast = () => {};

    this.hitProxy = new THREE.Mesh(
      new THREE.BoxGeometry(s * 0.95, s * 0.34, s * 0.8),
      new THREE.MeshBasicMaterial()
    );
    this.hitProxy.visible = false;
    this.hitProxy.userData.onShot = (point) => this.hit(point);
    this.hitProxy.userData.droneRef = this;
    // And once it's down, stop catching rounds altogether. Hiding the wreck
    // isn't enough on its own: an invisible group still intersects, so
    // without this a destroyed drone would go on stopping bullets in mid-air
    // and shielding whatever is behind it.
    const meshRaycast = THREE.Mesh.prototype.raycast;
    const self = this;
    this.hitProxy.raycast = function (raycaster, intersects) {
      if (self.dead) return;
      meshRaycast.call(this, raycaster, intersects);
    };
    this.body.add(this.hitProxy);

    this._buildSmoke();
    this.onHit = null;
  }

  _buildSmoke() {
    this.puffs = [];
    this.smokeGroup = new THREE.Group();
    for (let i = 0; i < SMOKE_POOL; i++) {
      const sprite = makeSmokeSprite(0xffffff, 1, 0);
      sprite.visible = false;
      this.smokeGroup.add(sprite);
      this.puffs.push({ sprite, life: 0, max: 1, vel: new THREE.Vector3() });
    }
    this.emitT = 0;

    this.sparks = [];
    for (let i = 0; i < 14; i++) {
      const sprite = makeSparkSprite(this.span * 0.12, 0);
      sprite.visible = false;
      this.smokeGroup.add(sprite);
      this.sparks.push({ sprite, life: 0, vel: new THREE.Vector3() });
    }
  }

  /** What the spotter grades a missed shot against. */
  spotterInfo() {
    return {
      live: !this.dead,
      centre: this.group.position.clone(),
      half: this.span * 0.4,
      dist: this.dist,
    };
  }

  get damage() {
    return CONFIG.drone.hitsToKill - this.hp;
  }

  hit() {
    if (this.dead) return;
    this.hp--;
    if (this.hp <= 0) {
      this.dead = true;
      this.deadT = 0;
      // Carries its momentum into the fall rather than dropping straight
      // down — it was travelling when the rotors quit.
      this.fallVel.copy(this._velocity()).multiplyScalar(0.55);
      this.spin = (Math.random() - 0.5) * 7;
    } else {
      // Each hit costs it authority: it banks further, wallows more, and
      // bleeds height. Capped by SAG_MAX so a crippled drone still can't
      // wander down into a plate sightline.
      this.wobble = this.damage;
    }
    if (this.onHit) this.onHit(this);
  }

  /** World velocity of the circuit at the current angle — used for the fall
   *  and available to anything that wants to lead it. */
  _velocity(out = _v) {
    return out.set(
      -Math.sin(this.angle) * this.rx * this.omega * this._speedMult(),
      0,
      Math.cos(this.angle) * this.rz * this.omega * this._speedMult()
    );
  }

  _speedMult() {
    // A hurt drone slows, which is the part that actually ruins your lead:
    // the sight picture you'd worked out a second ago is now wrong.
    return this.damage === DARK ? 0.62 : this.damage === WHITE ? 0.85 : 1;
  }

  update(dt, wind) {
    if (this.dead) return this._updateWreck(dt, wind);

    this.angle += this.omega * this._speedMult() * dt;
    const t = performance.now() * 0.001;

    // Wallowing: a wounded airframe can't hold a line or a height.
    const w = this.wobble;
    this.sag = Math.min(CONFIG.drone.sagMax, this.sag + w * dt * 0.55);
    const bobY = Math.sin(t * 1.4 + this.angle) * (0.25 + w * 0.5);
    const stagger = w > 0 ? Math.sin(t * (3.1 + w)) * w * 0.9 : 0;

    // Wind pushes it off station, and pushes a crippled one harder — it has
    // less to fight with. Same wind object the bullets read.
    const push = (wind ? wind.speed : 0) * (0.16 + w * 0.14);

    this.group.position.set(
      this.centre.x + Math.cos(this.angle) * this.rx + (wind?.x ?? 0) * push + stagger,
      this.centre.y + bobY - this.sag,
      this.centre.z + Math.sin(this.angle) * this.rz + (wind?.z ?? 0) * push
    );

    // Face the way it's going, and bank into the turn — more, and raggedly,
    // the more broken it is.
    const vel = this._velocity();
    this.group.rotation.y = Math.atan2(vel.x, vel.z);
    this.body.rotation.z = -0.25 - w * 0.16 + Math.sin(t * (2.3 + w * 1.7)) * w * 0.22;
    this.body.rotation.x = Math.sin(t * (1.9 + w)) * w * 0.14;

    const spin = dt * (this.damage === DARK ? 26 : 44);
    for (let i = 0; i < this.rotors.length; i++) {
      // One rotor stutters once it's badly hit — the visible reason it can't
      // hold attitude any more.
      this.rotors[i].rotation.z += (w >= DARK && i === 1) ? spin * 0.35 : spin;
    }
    this.lampMat.color.setHex(Math.sin(t * 4) > 0 ? 0xff3b2f : 0x3a0f0c);

    this._emit(dt, wind);
    this._updateParticles(dt, wind);
  }

  _updateWreck(dt, wind) {
    this.deadT += dt;
    if (!this.exploded) {
      this.fallVel.y -= 16 * dt;
      this.fallVel.x += (wind?.x ?? 0) * (wind?.speed ?? 0) * 0.25 * dt;
      this.fallVel.z += (wind?.z ?? 0) * (wind?.speed ?? 0) * 0.25 * dt;
      this.group.position.addScaledVector(this.fallVel, dt);
      this.body.rotation.z += this.spin * dt;
      this.body.rotation.x += this.spin * 0.6 * dt;
      for (const r of this.rotors) r.rotation.z += dt * 4;

      const ground = terrainHeight(this.group.position.x, this.group.position.z);
      if (this.group.position.y <= ground + this.span * 0.2) {
        this.group.position.y = ground + this.span * 0.2;
        this._explode();
      }
    }
    this._emit(dt, wind);
    this._updateParticles(dt, wind);

    // Leave the wreck a moment, then take it away — a quadcopter lying on the
    // lane at 400m reads as a live target through a scope.
    if (this.exploded && this.deadT > CONFIG.drone.wreckSeconds) this.group.visible = false;
  }

  _explode() {
    this.exploded = true;
    this.deadT = 0;
    this.group.visible = true;
    for (const s of this.sparks) {
      s.life = 0.4 + Math.random() * 0.4;
      s.maxLife = s.life;
      s.vel.set(
        (Math.random() - 0.5) * 14,
        Math.random() * 11 + 2,
        (Math.random() - 0.5) * 14
      );
      s.sprite.position.copy(this.group.position);
      s.sprite.visible = true;
    }
    for (let i = 0; i < 8; i++) this._puff(0x3a3630, this.span * 1.4, 2.4);
  }

  /** Smoke rate and colour are the damage readout: nothing at full health,
   *  a thin white trail after one hit, heavy dark smoke after two. */
  _emit(dt, wind) {
    if (!this.dead && this.damage === HEALTHY) return;
    const dark = this.dead || this.damage >= DARK;
    const interval = dark ? 0.055 : 0.13;
    this.emitT -= dt;
    if (this.emitT > 0) return;
    this.emitT = interval;
    this._puff(
      dark ? 0x24211d : 0xe8e8e4,
      this.span * (dark ? 0.85 : 0.55),
      dark ? 1.9 : 1.3
    );
  }

  _puff(colour, scale, life) {
    const p = this.puffs.find((x) => x.life <= 0);
    if (!p) return; // pool exhausted; dropping a puff is invisible
    p.life = life;
    p.max = life;
    p.scale0 = scale;
    p.sprite.material.color.setHex(colour);
    p.sprite.position.copy(this.group.position);
    p.sprite.position.y -= this.span * 0.1;
    p.sprite.scale.setScalar(scale);
    p.sprite.visible = true;
    p.vel.set((Math.random() - 0.5) * 0.7, 1.1 + Math.random() * 0.8, (Math.random() - 0.5) * 0.7);
  }

  _updateParticles(dt, wind) {
    const wx = (wind?.x ?? 0) * (wind?.speed ?? 0);
    const wz = (wind?.z ?? 0) * (wind?.speed ?? 0);
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.sprite.visible = false; continue; }
      const k = 1 - p.life / p.max;
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.position.x += wx * dt * 0.5;
      p.sprite.position.z += wz * dt * 0.5;
      p.sprite.scale.setScalar(p.scale0 * (1 + k * 2.2));
      p.sprite.material.opacity = Math.sin((1 - k) * Math.PI * 0.75) * 0.5;
    }
    for (const s of this.sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { s.sprite.visible = false; continue; }
      s.vel.y -= 22 * dt;
      s.sprite.position.addScaledVector(s.vel, dt);
      s.sprite.material.opacity = s.life / s.maxLife;
    }
  }

  reset() {
    this.hp = CONFIG.drone.hitsToKill;
    this.dead = false;
    this.exploded = false;
    this.deadT = 0;
    this.wobble = 0;
    this.sag = 0;
    this.fallVel.set(0, 0, 0);
    this.group.visible = true;
    this.body.rotation.set(0, 0, 0);
    for (const p of this.puffs) { p.life = 0; p.sprite.visible = false; }
    for (const s of this.sparks) { s.life = 0; s.sprite.visible = false; }
  }
}
