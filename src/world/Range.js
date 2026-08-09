import * as THREE from 'three';
import { submitRun } from '../core/records.js';
import { terrainHeight, RANGE, rangeTargetSpots } from './heightfield.js';
import { CONFIG } from '../core/config.js';
import { Drone, DRONE_CIRCUITS } from './Drone.js';

const _v = new THREE.Vector3(); // scratch, reused by centre()/isBullseye()

// The shooting range, built into the wilderness scene rather than a level
// of its own: a cleared lane north-west of the crash site (carved by
// heightfield.rangeCorridor) with pop-up steel from 25m to 500m.
//
// Targets don't stand permanently — they rise, wait, and drop again, so
// there's a reason to stay on the glass and a reason to hurry. Scoring is
// distance-weighted, because a 500m plate is a different problem from a
// 50m one and should pay like it.


/**
 * Plates grow with distance, as real range targets do. The generous base
 * size is deliberate: this rifle's drop is exaggerated ~12x, so even at 75m
 * a shot placed dead on the aiming mark lands half a metre low. Smaller
 * plates made close range unhittable without holdover the reticle has no
 * mark for.
 */
function plateSize(dist) {
  return 1.0 + dist * 0.005;
}

/** Distance-weighted, so the 500m plate is worth ~5x the 25m one. */
function pointsFor(dist) {
  return 10 + Math.round(dist / 10);
}

function makeLabelTexture(text) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#11141a';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#e8e4d8';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 244, 116);
  ctx.fillStyle = '#e8e4d8';
  ctx.font = 'bold 74px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 68);
  return new THREE.CanvasTexture(c);
}

class Target {
  constructor(dist, laneX, groundY) {
    this.dist = dist;
    this.points = pointsFor(dist);

    // Pop-up cycle. Staggered start delays so they don't rise in unison.
    this.up = false;
    this.timer = 1 + Math.random() * 6;
    // Once hit, a plate is done — it drops and never comes back up. Each
    // target is a single scoring opportunity, so a run is about clearing
    // the range rather than farming the easy 25m plate.
    this.knocked = false;

    const size = plateSize(dist);
    this.size = size;

    this.group = new THREE.Group();
    this.group.position.set(laneX, groundY, RANGE.firingZ - dist);
    this.group.rotation.y = Math.atan2(laneX - RANGE.laneX, dist); // square up to the firing line

    const postMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3e, roughness: 0.85 });
    const postH = size * 0.9;
    this.postH = postH;
    for (const sx of [-size * 0.42, size * 0.42]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.045, size * 0.045, postH, 6), postMat);
      post.position.set(sx, postH / 2, 0);
      this.group.add(post);
    }

    // The plate hinges at its base, so "down" is flat and edge-on — nearly
    // invisible at range, which is what makes a pop-up read as a pop-up.
    this.pivot = new THREE.Group();
    this.pivot.position.y = postH;
    this.pivot.rotation.x = -Math.PI / 2; // starts down
    this.group.add(this.pivot);

    // Dark backing board, a little larger than the plate. This is what
    // actually makes a target readable at 500m: the plate alone is a pale
    // shape against pale hillside, whereas a light face ringed by a dark
    // border silhouettes against *any* background.
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(size * 1.16, size * 1.16, size * 0.05),
      new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.95 })
    );
    board.position.set(0, size / 2, -size * 0.02);
    this.pivot.add(board);

    // Emissive lifts the face out of shadow so a plate under the ridge or
    // backlit at dawn stays as legible as one in full sun — without it,
    // visibility swung wildly with the time of day.
    const plateMat = new THREE.MeshStandardMaterial({
      color: 0xf4f1e8, roughness: 0.5, metalness: 0.25,
      emissive: 0x2a2823, emissiveIntensity: 0.45,
    });
    this.plate = new THREE.Mesh(new THREE.BoxGeometry(size, size, size * 0.06), plateMat);
    this.plate.position.y = size / 2;
    this.pivot.add(this.plate);

    const ring = new THREE.Mesh(
      new THREE.CircleGeometry(size * 0.32, 20),
      new THREE.MeshStandardMaterial({
        color: 0xe2481f, roughness: 0.6, emissive: 0x3a1206, emissiveIntensity: 0.5,
      })
    );
    ring.position.set(0, size / 2, size * 0.031 + 0.001);
    this.pivot.add(ring);
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(size * 0.13, 16),
      new THREE.MeshStandardMaterial({ color: 0x0d1014, roughness: 0.85 })
    );
    dot.position.set(0, size / 2, size * 0.031 + 0.002);
    this.pivot.add(dot);

    // Only the plate is shootable — the posts aren't, so a hit is a hit on
    // the target proper rather than on its furniture. `rangeTarget` lets the
    // shot predictor ask about a candidate hit before the bullet gets there.
    for (const m of [this.plate, ring, dot, board]) {
      m.userData.onShot = (point) => this.hit(point);
      m.userData.rangeTarget = this;
    }

    const labelH = Math.max(1.1, dist * 0.012);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(labelH * 2, labelH),
      new THREE.MeshBasicMaterial({ map: makeLabelTexture(`${dist}m`), toneMapped: false })
    );
    label.position.set(-(size * 0.5 + labelH * 1.2), labelH * 0.7, 0);
    this.group.add(label);

    this.onHit = null;
  }

  /** World-space centre of the plate face — the bullseye. */
  centre(out = new THREE.Vector3()) {
    return this.plate.getWorldPosition(out);
  }

  /** Dead centre, within the black dot. Used both for scoring flourish and
   *  to decide whether a shot earns the slow-motion camera. */
  isBullseye(point) {
    return point.distanceTo(this.centre(_v)) < this.size * 0.13;
  }

  /** What the spotter needs to grade a shot against this plate. The centre
   *  is a fresh vector, not the shared scratch one `centre()` defaults to:
   *  the spotter holds onto the best candidate while it goes on to test the
   *  rest, and a shared vector would have it grading against whichever
   *  target happened to be examined last. */
  spotterInfo() {
    return {
      live: this.up && !this.knocked,
      centre: this.centre(new THREE.Vector3()),
      half: this.size * 0.5,
      dist: this.dist,
    };
  }

  /** Back to standing-by, for a fresh session. The pivot is already flat, so
   *  it simply pops up again when the stagger timer runs out. */
  reset() {
    this.knocked = false;
    this.bullseye = false;
    this.up = false;
    this.timer = 0.5 + Math.random() * 5;
  }

  hit(point) {
    if (!this.up || this.knocked) return; // edge-on, or already knocked down
    this.bullseye = point ? this.isBullseye(point) : false;
    this.up = false;
    this.knocked = true;
    if (this.onHit) this.onHit(this);
  }

  update(dt) {
    if (this.knocked) {
      // Settle flat and stay there.
      this.pivot.rotation.x += (-Math.PI / 2 - this.pivot.rotation.x) * Math.min(1, dt * 9);
      return;
    }
    this.timer -= dt;
    if (this.timer <= 0) {
      this.up = !this.up;
      // Up for a while, then down for a while — long enough at distance to
      // actually range and hold, short enough to keep pressure on.
      this.timer = this.up
        ? 4 + this.dist * 0.012 + Math.random() * 3
        : 2.5 + Math.random() * 5;
    }
    // Ease toward the target angle rather than snapping, so a plate visibly
    // swings up into view.
    const want = this.up ? 0 : -Math.PI / 2;
    this.pivot.rotation.x += (want - this.pivot.rotation.x) * Math.min(1, dt * 9);
  }
}

/**
 * Tethered balloons — moving targets between the static plates.
 *
 * Their real job is to make the wind legible. A windsock tells you the
 * direction at one spot; a balloon on a taut line leans downwind by an angle
 * set by the strength, so five of them at different ranges show you the wind
 * *along the lane* at a glance. They're also the only target that moves, so
 * they punish a slow trigger in a way the plates can't.
 *
 * Anchors are angles rather than raw coordinates so they can be checked
 * against the plate lanes — a balloon drifting into a sightline would hide a
 * plate, and it moves, so it wouldn't even be reliably reproducible.
 */
// Anchors are given as a lateral offset in metres, not an angle: an angle
// multiplies with distance, which flung the far balloons 100m sideways onto
// the mountain instead of leaving them over the range. Offsets keep every
// one of them on the cleared lane.
//
// Positions aren't eyeballed. A balloon on a long tether sweeps a wide
// circle as the wind swings it, and drifting into a sightline would hide a
// plate — unpredictably, since it moves. These were picked by searching the
// lane for placements whose *entire* swept circle, at every wind strength up
// to a full gust, stays clear of all twelve plate sightlines. Worst margin
// in this set is 5m.
const BALLOON_ANCHORS = [
  { offX: 28, dist: 70, tether: 12, colour: 0xe2402c },
  { offX: -30, dist: 130, tether: 14, colour: 0xf0a32a },
  { offX: 30, dist: 200, tether: 11, colour: 0x3fa9d8 },
  { offX: -28, dist: 260, tether: 15, colour: 0xe8e4d8 },
  { offX: 30, dist: 340, tether: 10, colour: 0x8fc94a },
];

// Lean per m/s of wind. Gentle enough that a gust doesn't sweep a balloon
// through half the range — the swept circle is what has to stay out of the
// sightlines above.
const LEAN_DIVISOR = 14;

class Balloon {
  constructor({ offX, dist, tether, colour }) {
    this.dist = dist;
    this.tether = tether;
    this.points = pointsFor(dist) + 15; // a moving target is worth more
    this.popped = false;
    this.popT = 0;
    this.phase = Math.random() * Math.PI * 2;
    this.radius = 0.9 + dist * 0.004; // visible at range, like the plates

    this.anchor = new THREE.Vector3(RANGE.laneX + offX, 0, RANGE.firingZ - dist);
    this.anchor.y = terrainHeight(this.anchor.x, this.anchor.z);

    this.group = new THREE.Group();

    this.balloon = new THREE.Mesh(
      new THREE.SphereGeometry(this.radius, 18, 14),
      new THREE.MeshStandardMaterial({
        color: colour, roughness: 0.45, emissive: colour, emissiveIntensity: 0.18,
      })
    );
    this.balloon.scale.set(0.86, 1.12, 0.86); // egg, not a ball
    this.balloon.castShadow = true;
    this.balloon.userData.onShot = () => this.pop();
    this.balloon.userData.balloon = this;
    // A popped balloon is hidden, but hidden is not the same as gone: three.js
    // still raycasts invisible meshes, so without this the burst would leave
    // an invisible obstacle hanging over the lane that quietly ate rounds
    // aimed at anything behind it.
    const meshRaycast = THREE.Mesh.prototype.raycast;
    const self = this;
    this.balloon.raycast = function (raycaster, intersects) {
      if (self.popped) return;
      meshRaycast.call(this, raycaster, intersects);
    };
    this.group.add(this.balloon);

    const knot = new THREE.Mesh(
      new THREE.ConeGeometry(this.radius * 0.22, this.radius * 0.34, 8),
      new THREE.MeshStandardMaterial({ color: colour, roughness: 0.6 })
    );
    knot.position.y = -this.radius * 1.16;
    knot.rotation.x = Math.PI;
    this.group.add(knot);

    // Tether, redrawn each frame between anchor and balloon. Its raycast is
    // disabled: three.js will happily report a hit on a line, and a hairline
    // string is not something a bullet should stop on.
    const geo = new THREE.BufferGeometry().setFromPoints([
      this.anchor.clone(), this.anchor.clone(),
    ]);
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x2a2b28 }));
    this.line.raycast = () => {};

    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.11, 0.7, 6),
      new THREE.MeshStandardMaterial({ color: 0x44483a, roughness: 0.9 })
    );
    post.position.set(this.anchor.x, this.anchor.y + 0.35, this.anchor.z);
    this.stake = post;

    this.onPop = null;
  }

  spotterInfo() {
    return {
      live: !this.popped,
      centre: this.group.position.clone(),
      half: this.radius,
      dist: this.dist,
    };
  }

  reset() {
    this.popped = false;
    this.popT = 0;
    // pop() inflates and fades the mesh; both have to be undone, or a
    // re-inflated balloon comes back invisible and twice the size.
    this.balloon.scale.set(0.86, 1.12, 0.86);
    this.balloon.material.opacity = 1;
    this.balloon.material.transparent = false;
    this.group.visible = true;
    this.line.visible = true;
  }

  pop() {
    if (this.popped) return;
    this.popped = true;
    this.popT = 0;
    if (this.onPop) this.onPop(this);
  }

  /** Credit a scoring hit to the live run, and end it if that cleared the
   *  range. Called by both the plate and the balloon paths so neither has to
   *  know whether a session is running. */
  _recordShot(gained, dist, bull = false) {
    const cleared = this.remaining === 0;
    const s = this.session;
    if (!s) {
      if (cleared) {
        this.hud.toast(
          `Range cleared — ${this.score} points. Start a timed run to reset it.`, 9000
        );
      }
      return;
    }
    s.score += gained;
    s.hits++;
    s.bestShot = Math.max(s.bestShot, dist);
    s.longestStreak = Math.max(s.longestStreak, this.streak);
    if (bull) s.bulls++;
    if (cleared) this.endSession('cleared');
  }

  update(dt, wind, realDt = 0) {
    if (this.popped) {
      // Burst outward and vanish, rather than blinking out.
      this.popT += dt;
      const k = Math.min(1, this.popT / 0.22);
      this.balloon.scale.setScalar(1 + k * 1.7);
      this.balloon.material.opacity = 1 - k;
      this.balloon.material.transparent = true;
      if (k >= 1) {
        this.group.visible = false;
        this.line.visible = false;
      }
      return;
    }

    // A taut tether swings downwind by an angle set by wind strength against
    // buoyancy — so lean is the readable part, and the bob is just life.
    const lean = Math.atan((wind?.speed ?? 0) / LEAN_DIVISOR);
    const horiz = Math.sin(lean) * this.tether;
    const vert = Math.cos(lean) * this.tether;
    const t = performance.now() * 0.001;
    const bobX = Math.sin(t * 0.9 + this.phase) * 0.35;
    const bobZ = Math.cos(t * 0.7 + this.phase * 1.3) * 0.35;

    this.group.position.set(
      this.anchor.x + (wind?.x ?? 0) * horiz + bobX,
      this.anchor.y + vert + Math.sin(t * 1.3 + this.phase) * 0.25,
      this.anchor.z + (wind?.z ?? 0) * horiz + bobZ
    );
    // Leans into the wind as it goes, so the whole shape reads downwind.
    this.group.rotation.z = -(wind?.x ?? 0) * lean * 0.7;
    this.group.rotation.x = (wind?.z ?? 0) * lean * 0.7;

    const pts = this.line.geometry.attributes.position;
    pts.setXYZ(1, this.group.position.x, this.group.position.y - this.radius * 1.2, this.group.position.z);
    pts.needsUpdate = true;
  }
}

/** How many rounds a visit to the crate leaves you holding. */
const RESUPPLY_RESERVE = 60;

/**
 * The ammunition crate behind the firing line. Unlimited and repeatable —
 * a practice range you can run dry isn't one, and until this existed the
 * rifle's starting ten rounds were the only ammunition in the game.
 */
class AmmoCrate {
  constructor(x, z, groundY) {
    this.group = new THREE.Group();
    this.group.position.set(x, groundY, z);
    this.group.rotation.y = -0.25; // set at an angle, not squared to the world

    const w = 1.35, h = 0.85, d = 0.9;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: 0x4b5233, roughness: 0.9 })
    );
    body.position.y = h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    this.group.add(body);

    // Lid rim and a banding strap, so it reads as a crate rather than a box.
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x33381f, roughness: 0.85 });
    const lid = new THREE.Mesh(new THREE.BoxGeometry(w * 1.04, 0.1, d * 1.04), trimMat);
    lid.position.y = h;
    this.group.add(lid);
    for (const sx of [-w * 0.28, w * 0.28]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.07, h, d * 1.02), trimMat);
      strap.position.set(sx, h / 2, 0);
      this.group.add(strap);
    }

    // Sign above it. Double-sided so it reads whichever way you walk up —
    // you approach from the crash site but turn back to it from the line.
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 0.75),
      new THREE.MeshBasicMaterial({
        map: makeLabelTexture('AMMO'), toneMapped: false, side: THREE.DoubleSide,
      })
    );
    label.position.y = h + 0.62;
    this.group.add(label);

    const postMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3e, roughness: 0.9 });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.62, 6), postMat);
    post.position.y = h + 0.31;
    this.group.add(post);
  }
}

/** A windsock on a pole: the in-world read on wind, before you trust the
 *  gauge. Yaws to the wind and lifts toward horizontal as it strengthens. */
class Windsock {
  constructor(x, z, groundY, height = 4.5) {
    this.group = new THREE.Group();
    this.group.position.set(x, groundY, z);

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.09, height, 6),
      new THREE.MeshStandardMaterial({ color: 0x53565c, roughness: 0.8 })
    );
    pole.position.y = height / 2;
    this.group.add(pole);

    // Cone, wide end at the pole, tapering downwind.
    this.sock = new THREE.Mesh(
      new THREE.ConeGeometry(0.42, 2.2, 10, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0xe2612f, roughness: 0.9, side: THREE.DoubleSide,
      })
    );
    // Cone points along -Y by default; lay it along +Z so yaw aims it.
    this.sock.rotation.x = Math.PI / 2;
    this.sock.position.z = 1.1;

    this.pivot = new THREE.Group();
    this.pivot.position.y = height - 0.25;
    this.pivot.add(this.sock);
    this.group.add(this.pivot);
  }

  update(wind) {
    // Point downwind, and droop when the wind is light.
    this.pivot.rotation.y = Math.atan2(wind.x, wind.z);
    const lift = Math.min(1, wind.speed / 9);
    this.pivot.rotation.x = (1 - lift) * 0.95;
  }
}

/**
 * The post you start a timed run from, at the firing line beside the ammo
 * crate. A lamp on top reads green when the range is cold and red while a
 * run is live, so the range's state is legible from down the lane rather
 * than only from the HUD.
 */
class RangeControl {
  constructor(x, z, groundY) {
    this.group = new THREE.Group();
    this.group.position.set(x, groundY, z);
    this.group.rotation.y = Math.PI; // face back toward the firing line

    const postMat = new THREE.MeshStandardMaterial({ color: 0x4a4438, roughness: 0.9 });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.5, 8), postMat);
    post.position.y = 0.75;
    post.castShadow = true;
    this.group.add(post);

    const board = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 0.58, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.9 })
    );
    board.position.y = 1.45;
    board.castShadow = true;
    this.group.add(board);

    for (const sz of [0.032, -0.032]) {
      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(1.05, 0.5),
        new THREE.MeshBasicMaterial({ map: makeLabelTexture('RUN'), toneMapped: false })
      );
      face.position.set(0, 1.45, sz);
      if (sz < 0) face.rotation.y = Math.PI;
      this.group.add(face);
    }

    this.lampMat = new THREE.MeshStandardMaterial({
      color: 0x8fc94a, emissive: 0x8fc94a, emissiveIntensity: 1.4, roughness: 0.4,
    });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), this.lampMat);
    lamp.position.y = 1.82;
    this.group.add(lamp);
  }

  setLive(live) {
    this.lampMat.color.setHex(live ? 0xe2402c : 0x8fc94a);
    this.lampMat.emissive.setHex(live ? 0xe2402c : 0x8fc94a);
  }
}

export class Range {
  constructor({ scene, hud, sfx, interactions, weapon }) {
    this.hud = hud;
    this.sfx = sfx;
    this.weapon = weapon;
    // Null between runs. Free practice is always available; a session is an
    // opt-in overlay on top of it that resets the range, starts a clock and
    // measures you.
    this.session = null;
    this.score = 0;
    this.hits = 0;
    this.streak = 0;
    this.streakTimer = 0;

    // Firing line, so it's obvious where the measured distances start.
    // Sits on real terrain, not on RANGE.laneY — the lane floor rolls now,
    // so the nominal height would have it buried at one end.
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(RANGE.halfWidth * 2, 0.5),
      new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 1 })
    );
    line.rotation.x = -Math.PI / 2;
    line.position.set(
      RANGE.laneX,
      terrainHeight(RANGE.laneX, RANGE.firingZ) + 0.06,
      RANGE.firingZ
    );
    scene.add(line);

    // Each target sits on the real ground at its spot — several stand on
    // mounds (see heightfield's HILL_TARGETS), which both varies the lane
    // and lifts those plates clear of the ground behind them.
    this.targets = rangeTargetSpots().map((spot) => {
      const t = new Target(spot.dist, spot.x, terrainHeight(spot.x, spot.z));
      t.onHit = (target) => this._registerHit(target);
      scene.add(t.group);
      return t;
    });

    // Socks down the lane, so wind is readable at the distance you're
    // shooting rather than only at your feet — the far one is what matters
    // for a 500m shot.
    this.balloons = BALLOON_ANCHORS.map((a) => {
      const b = new Balloon(a);
      b.onPop = (balloon) => this._registerPop(balloon);
      scene.add(b.group, b.line, b.stake);
      return b;
    });

    // Ammunition, behind the line so it's never in the way of a shot.
    const crateX = RANGE.laneX + 4.5;
    const crateZ = RANGE.firingZ + 4;
    scene.add(new AmmoCrate(crateX, crateZ, terrainHeight(crateX, crateZ)).group);
    if (interactions && weapon) {
      interactions.add({
        position: new THREE.Vector3(crateX, terrainHeight(crateX, crateZ) + 0.6, crateZ),
        radius: 3.2,
        label: 'Resupply ammunition',
        // Never disabled — the whole point is that it can't run out.
        onUse: () => {
          weapon.reserveAmmo = Math.max(weapon.reserveAmmo, RESUPPLY_RESERVE);
          this.sfx.pickup();
          this.hud.toast(`Ammunition resupplied — ${weapon.reserveAmmo} rounds.`, 2200);
        },
      });
    }

    // Quadcopters, one per engagement band. Their circuits sit above the
    // sightline to the 700m plate — the upper envelope of every line of
    // sight here — so a drone is always against sky and never in front of
    // something you're trying to range. See Drone.js for the clearances.
    this.drones = DRONE_CIRCUITS.map((c, i) => {
      const d = new Drone(c, RANGE.laneX, RANGE.firingZ, (i * Math.PI * 2) / DRONE_CIRCUITS.length);
      d.onHit = (drone) => this._registerDroneHit(drone);
      scene.add(d.group, d.smokeGroup);
      return d;
    });

    // Start post, mirroring the ammo crate on the other side of the line.
    const postX = RANGE.laneX - 4.5;
    const postZ = RANGE.firingZ + 4;
    this.control = new RangeControl(postX, postZ, terrainHeight(postX, postZ));
    scene.add(this.control.group);
    if (interactions) {
      this.controlEntry = interactions.add({
        position: new THREE.Vector3(postX, terrainHeight(postX, postZ) + 0.9, postZ),
        radius: 3.2,
        label: `Start timed run (${CONFIG.session.seconds}s)`,
        // The same post both starts and stops a run, so there is one place
        // to go and no second control to find mid-session.
        onUse: () => {
          if (this.session) this.endSession('abandoned');
          else this.startSession();
        },
      });
    }

    // Alternating sides so there's one in view wherever you're pointed, and
    // set in from the corridor edge so they read against the lane rather
    // than against the treeline.
    this.socks = [[35, 15], [170, -17], [330, 14]].map(([d, off]) => {
      const x = RANGE.laneX + off;
      const z = RANGE.firingZ - d;
      const s = new Windsock(x, z, terrainHeight(x, z));
      scene.add(s.group);
      return s;
    });
  }

  /**
   * Reset the range and start the clock.
   *
   * Everything stands back up — that is the point. Plates are one-shot by
   * design, so without a reset the range is a resource you exhaust once and
   * then have no reason to return to. A run turns the same twelve plates and
   * five balloons into something you can attempt again and shoot better.
   */
  startSession() {
    for (const t of this.targets) t.reset();
    for (const b of this.balloons) b.reset();
    for (const d of this.drones) d.reset();
    this.streak = 0;
    this.streakTimer = 0;

    this.session = {
      left: CONFIG.session.seconds,
      score: 0,
      hits: 0,
      bestShot: 0,
      longestStreak: 0,
      bulls: 0,
      // Snapshot rather than a counter of our own: the weapon already knows
      // how many rounds it has fired, and a diff can't drift out of sync.
      shotsAt: this.weapon ? this.weapon.shotsFired : 0,
    };

    this.control.setLive(true);
    if (this.controlEntry) this.controlEntry.label = 'Abandon run';
    this.hud.hideScorecard();
    this.sfx.ding();
    this.hud.toast(`Run started — ${CONFIG.session.seconds}s. Everything is up.`, 3200);
  }

  /** @param reason 'time' | 'cleared' | 'abandoned' */
  endSession(reason) {
    const s = this.session;
    if (!s) return;
    this.session = null;
    this.control.setLive(false);
    if (this.controlEntry) {
      this.controlEntry.label = `Start timed run (${CONFIG.session.seconds}s)`;
    }
    this.hud.setSession(null);

    if (reason === 'abandoned') {
      this.hud.toast('Run abandoned.', 2600);
      return;
    }

    // Clearing the range early banks the time you saved, so a run is a race
    // rather than a fixed two minutes of plinking.
    const timeBonus = reason === 'cleared'
      ? Math.round(s.left * CONFIG.session.clearBonusPerSecond) : 0;
    const shots = this.weapon ? this.weapon.shotsFired - s.shotsAt : 0;
    const run = {
      score: s.score + timeBonus,
      hits: s.hits,
      shots,
      accuracy: shots > 0 ? s.hits / shots : 0,
      bestShot: s.bestShot,
      longestStreak: s.longestStreak,
      bulls: s.bulls,
      cleared: reason === 'cleared',
      timeBonus,
      secondsLeft: Math.max(0, s.left),
    };
    // The career score keeps the bonus too — it was earned in the same run.
    if (timeBonus) {
      this.score += timeBonus;
      this.hud.setScore(this.score, this.streak);
    }

    const { best, beaten, newMedals, medalCount } = submitRun(run);
    this.sfx.ding();
    this.hud.showScorecard(run, best, beaten, newMedals, medalCount);
  }

  get remaining() {
    return this.targets.filter((t) => !t.knocked).length
      + this.balloons.filter((b) => !b.popped).length;
  }

  /**
   * A hit on a drone — one of three, so this fires more than once per target.
   *
   * Deliberately absent from `remaining`: drones do not gate "range cleared".
   * Requiring nine more hits inside the two minutes drops a strong shooter
   * from clearing every run to under half of them, and an average one from
   * 56% to 1% — which would quietly retire the Clean Sweep and Quick Work
   * medals for almost everyone. They're an opportunity during a run, not a
   * gate on finishing it.
   */
  _registerDroneHit(drone) {
    this.streak = this.streakTimer > 0 ? Math.min(5, this.streak + 1) : 1;
    this.streakTimer = 6;

    const killed = drone.dead;
    const base = pointsFor(drone.dist) + CONFIG.drone.hitPoints;
    const gained = base * this.streak * (killed ? CONFIG.drone.killMultiplier : 1);
    this.score += gained;
    this.hits++;

    if (killed) {
      this.sfx.boom();
      this.hud.toast(`DRONE DOWN  ${drone.dist}m  +${gained}`, 2400);
    } else {
      this.sfx.ding();
      const state = drone.damage === 1 ? 'hit — trailing smoke' : 'hit — losing it';
      this.hud.toast(`Drone ${drone.dist}m  ${state}  +${gained}`, 1600);
    }
    this.hud.setScore(this.score, this.streak);
    this._recordShot(gained, drone.dist);
  }

  _registerPop(balloon) {
    this.streak = this.streakTimer > 0 ? Math.min(5, this.streak + 1) : 1;
    this.streakTimer = 6;
    const gained = balloon.points * this.streak;
    this.score += gained;
    this.hits++;
    this.sfx.ding();
    this.hud.toast(
      `Balloon ${balloon.dist}m  +${gained}${this.streak > 1 ? `  x${this.streak}` : ''}`,
      1500
    );
    this.hud.setScore(this.score, this.streak);
    this._recordShot(gained, balloon.dist);
  }

  /** Which plates are already down, for the save. Without this the score
   *  would persist across a reload while the targets stood back up, so the
   *  same plates could be scored again and again. */
  get knockedDistances() {
    return this.targets.filter((t) => t.knocked).map((t) => t.dist);
  }

  get poppedBalloons() {
    return this.balloons.filter((b) => b.popped).map((b) => b.dist);
  }

  /** Drone damage survives a reload for the same reason plate hits do:
   *  otherwise the score persists while the targets come back whole, and the
   *  same drone can be shot down repeatedly for points. */
  get droneDamage() {
    return this.drones.map((d) => d.hp);
  }

  restoreDrones(hps = []) {
    hps.forEach((hp, i) => {
      const d = this.drones[i];
      if (!d || hp >= CONFIG.drone.hitsToKill) return;
      d.hp = Math.max(0, hp);
      d.wobble = d.damage;
      if (d.hp <= 0) { d.dead = true; d.exploded = true; d.group.visible = false; }
    });
  }

  restore(distances = []) {
    const down = new Set(distances);
    for (const t of this.targets) {
      if (!down.has(t.dist)) continue;
      t.knocked = true;
      t.up = false;
      t.pivot.rotation.x = -Math.PI / 2;
    }
    this.hits = distances.length;
  }

  restoreBalloons(distances = []) {
    const gone = new Set(distances);
    for (const b of this.balloons) {
      if (!gone.has(b.dist)) continue;
      b.popped = true;
      b.popT = 1;
      b.group.visible = false;
      b.line.visible = false;
    }
    this.hits += distances.length;
  }

  _registerHit(target) {
    // Chained hits build a multiplier; let it lapse and you start over.
    this.streak = this.streakTimer > 0 ? Math.min(5, this.streak + 1) : 1;
    this.streakTimer = 6;

    // Dead centre pays double — the same shot the kill cam rewards.
    const bull = target.bullseye ? 2 : 1;
    const gained = target.points * this.streak * bull;
    this.score += gained;
    this.hits++;
    this.sfx.ding();
    this.hud.toast(
      `${target.dist}m  +${gained}`
        + `${this.streak > 1 ? `  x${this.streak}` : ''}`
        + `${target.bullseye ? '  BULLSEYE' : ''}`,
      1500
    );
    this.hud.setScore(this.score, this.streak);
    this._recordShot(gained, target.dist, target.bullseye);
  }

  /** Credit a scoring hit to the live run, and end it if that cleared the
   *  range. Called by both the plate and the balloon paths so neither has to
   *  know whether a session is running. */
  _recordShot(gained, dist, bull = false) {
    const cleared = this.remaining === 0;
    const s = this.session;
    if (!s) {
      if (cleared) {
        this.hud.toast(
          `Range cleared — ${this.score} points. Start a timed run to reset it.`, 9000
        );
      }
      return;
    }
    s.score += gained;
    s.hits++;
    s.bestShot = Math.max(s.bestShot, dist);
    s.longestStreak = Math.max(s.longestStreak, this.streak);
    if (bull) s.bulls++;
    if (cleared) this.endSession('cleared');
  }

  update(dt, wind, realDt = 0) {
    for (const t of this.targets) t.update(dt);
    for (const b of this.balloons) b.update(dt, wind);
    for (const d of this.drones) d.update(dt, wind);
    if (wind) for (const s of this.socks) s.update(wind);

    if (this.streakTimer > 0) {
      this.streakTimer -= dt;
      if (this.streakTimer <= 0) {
        this.streak = 0;
        this.hud.setScore(this.score, 0);
      }
    }

    // Real time, not the scaled clock: holding your breath must not buy you
    // extra seconds, or the optimal run is one long stretch of slow motion.
    const s = this.session;
    if (s && realDt > 0) {
      const was = s.left;
      s.left -= realDt;
      // Last ten seconds get a tick, so the clock is audible while you're
      // looking down a scope at something 500m away.
      if (Math.ceil(s.left) !== Math.ceil(was) && s.left > 0 && s.left <= 10) this.sfx.tick();
      if (s.left <= 0) { this.endSession('time'); return; }
      const shots = this.weapon ? this.weapon.shotsFired - s.shotsAt : 0;
      this.hud.setSession({ left: s.left, score: s.score, hits: s.hits, shots });
    }
  }
}
