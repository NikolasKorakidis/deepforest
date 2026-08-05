import * as THREE from 'three';
import { terrainHeight, RANGE, rangeTargetSpots } from './heightfield.js';

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

export class Range {
  constructor({ scene, hud, sfx, interactions, weapon }) {
    this.hud = hud;
    this.sfx = sfx;
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

  get remaining() {
    return this.targets.filter((t) => !t.knocked).length;
  }

  /** Which plates are already down, for the save. Without this the score
   *  would persist across a reload while the targets stood back up, so the
   *  same plates could be scored again and again. */
  get knockedDistances() {
    return this.targets.filter((t) => t.knocked).map((t) => t.dist);
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

    if (this.remaining === 0) {
      this.hud.toast(`Range cleared — ${this.score} points, ${this.hits} plates.`, 9000);
    }
  }

  update(dt, wind) {
    for (const t of this.targets) t.update(dt);
    if (wind) for (const s of this.socks) s.update(wind);

    if (this.streakTimer > 0) {
      this.streakTimer -= dt;
      if (this.streakTimer <= 0) {
        this.streak = 0;
        this.hud.setScore(this.score, 0);
      }
    }
  }
}
