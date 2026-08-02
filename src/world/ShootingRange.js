import * as THREE from 'three';

// A separate level: a flat practice range with steel plates from 25m out to
// 500m, reachable from the pause menu. It exists because the wilderness
// can't teach marksmanship — it's a 400m basin full of trees, so there is
// nowhere to take a 500m shot and nothing that tells you whether you missed
// high or low. Here the ground is flat, the sightlines are clear, and a
// plate either rings or it doesn't.
//
// It owns its own THREE.Scene rather than being a far-off corner of the
// wilderness: its own lighting, its own sky, no fog swallowing the far
// targets, and no wolves/stats/quest systems running in the background.

/** Firing line sits at z=0; targets march away down -Z. */
const TARGET_RANGES = [25, 50, 75, 100, 150, 200, 250, 300, 400, 500];

// Targets can't share a centreline: a plate at 150m sits exactly on the
// line of sight to the plate at 500m, so five of the ten would have been
// invisible from the firing point. Instead each gets its own *angular*
// lane, which keeps them separated no matter how far out they are.
//
// The farthest target takes the centre lane and the nearest the outermost.
// That's the cheap way round: a 25m plate subtends ~0.8° and needs the most
// angular room, but converting that to metres at 25m costs almost nothing,
// whereas giving the 500m plate an outer lane would fling it 60m sideways.
// Result — every plate visible, and the range stays 48m wide.
const LANE_STEP_DEG = 2.2;

const RANGE_HALF_WIDTH = 24;
const GROUND_START_Z = 40;      // a little apron behind the firing line
const GROUND_END_Z = -560;      // past the furthest plate

/**
 * Plates grow with distance, the way real range targets do — otherwise a
 * 500m plate is a couple of pixels and the exercise is pointless.
 *
 * The generous base size is deliberate. This rifle's drop is exaggerated
 * ~12x (see CONFIG.rifle.bulletGravity), so even at 75m a shot placed dead
 * on the aiming mark lands half a metre low. With a smaller plate the
 * close-range targets were literally unhittable without holdover the
 * reticle has no mark for; this makes them forgiving enough to be a warm-up
 * rather than a puzzle.
 */
function plateSize(dist) {
  return 1.0 + dist * 0.005; // 1.13m at 25m, 3.5m at 500m
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
  constructor(dist, laneX) {
    this.dist = dist;
    this.downT = 0;

    const size = plateSize(dist);
    this.group = new THREE.Group();
    this.group.position.set(laneX, 0, -dist);
    this.group.rotation.y = Math.atan2(laneX, dist); // square up to the firing point

    // Posts
    const postMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3e, roughness: 0.85 });
    const postH = size * 0.9;
    for (const sx of [-size * 0.42, size * 0.42]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.045, size * 0.045, postH, 6), postMat);
      post.position.set(sx, postH / 2, 0);
      this.group.add(post);
    }

    // The plate itself: pivots from its bottom edge so it can fall back
    // when hit, which is the clearest possible "you hit it" at 500m where
    // the plate is only a few pixels tall.
    this.pivot = new THREE.Group();
    this.pivot.position.y = postH;
    this.group.add(this.pivot);

    const plateMat = new THREE.MeshStandardMaterial({
      color: 0xd8d2c4, roughness: 0.55, metalness: 0.35,
    });
    this.plate = new THREE.Mesh(new THREE.BoxGeometry(size, size, size * 0.06), plateMat);
    this.plate.position.y = size / 2;
    this.pivot.add(this.plate);

    // Bullseye rings, so there's something to aim at rather than a blank slab.
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xc2402c, roughness: 0.7 });
    const ring = new THREE.Mesh(new THREE.CircleGeometry(size * 0.3, 20), ringMat);
    ring.position.set(0, size / 2, size * 0.031 + 0.001);
    this.pivot.add(ring);
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(size * 0.12, 16),
      new THREE.MeshStandardMaterial({ color: 0x14181e, roughness: 0.8 })
    );
    dot.position.set(0, size / 2, size * 0.031 + 0.002);
    this.pivot.add(dot);

    // Anything the bullet can strike routes back here.
    this.group.traverse((o) => {
      if (o.isMesh) o.userData.onShot = () => this.hit();
    });

    // Distance board beside the target, scaled so it stays readable through
    // the scope at whatever range it sits.
    const labelH = Math.max(1.1, dist * 0.012);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(labelH * 2, labelH),
      new THREE.MeshBasicMaterial({ map: makeLabelTexture(`${dist}m`), toneMapped: false })
    );
    label.position.set(-(size * 0.5 + labelH * 1.2), labelH * 0.7, 0);
    this.group.add(label);

    this.onHit = null; // set by ShootingRange
  }

  hit() {
    if (this.downT > 0) return; // already falling; ignore follow-ups
    this.downT = 1.6;
    if (this.onHit) this.onHit(this.dist);
  }

  update(dt) {
    if (this.downT <= 0) return;
    this.downT -= dt;
    // Snaps back hard, then eases upright — reads as a steel plate swinging.
    const t = Math.max(0, this.downT / 1.6);
    this.pivot.rotation.x = -Math.PI * 0.42 * Math.sin(Math.min(1, t * 1.3) * Math.PI) ** 0.7;
    if (this.downT <= 0) this.pivot.rotation.x = 0;
  }
}

export class ShootingRange {
  constructor({ hud, sfx }) {
    this.hud = hud;
    this.sfx = sfx;
    this.hits = 0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fc0da);
    // Deliberately no fog: the whole point is an unobstructed look at 500m.

    // Flat light so plates read the same at every distance. No shadows —
    // a shadow camera spanning 600m would be worthless at any sane map
    // size, and flat lighting is what a practice range wants anyway.
    this.scene.add(new THREE.HemisphereLight(0xdcebf5, 0x53603f, 1.5));
    const sun = new THREE.DirectionalLight(0xfff4e2, 1.5);
    sun.position.set(60, 90, 40);
    this.scene.add(sun);

    this._buildGround();

    // Farthest first, alternating outward: lane 0, -1, +1, -2, +2 ...
    const byDistance = [...TARGET_RANGES].sort((a, b) => b - a);
    this.targets = byDistance.map((d, j) => {
      const lane = Math.ceil(j / 2) * (j % 2 === 1 ? -1 : 1);
      const laneX = d * Math.tan((lane * LANE_STEP_DEG * Math.PI) / 180);
      const t = new Target(d, laneX);
      t.onHit = (dist) => this._registerHit(dist);
      this.scene.add(t.group);
      return t;
    });

    // Standing *on* the firing line, so a plate labelled 300m really is
    // 300m away and the scope's rangefinder agrees with the sign.
    this.spawn = new THREE.Vector3(0, 0, 0);
    this.bounds = {
      minX: -RANGE_HALF_WIDTH + 4, maxX: RANGE_HALF_WIDTH - 4,
      minZ: GROUND_END_Z + 10, maxZ: GROUND_START_Z - 6,
    };
  }

  /** Flat — the level's whole reason for existing is a known, level shot. */
  groundAt() {
    return 0;
  }

  _buildGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(RANGE_HALF_WIDTH * 2, GROUND_START_Z - GROUND_END_Z),
      new THREE.MeshStandardMaterial({ color: 0x4a5738, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, (GROUND_START_Z + GROUND_END_Z) / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Lane stripe down the middle, so distance is legible even between
    // targets and the eye has something to follow downrange.
    const stripe = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, GROUND_START_Z - GROUND_END_Z),
      new THREE.MeshStandardMaterial({ color: 0x6d7a52, roughness: 1 })
    );
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(0, 0.01, (GROUND_START_Z + GROUND_END_Z) / 2);
    this.scene.add(stripe);

    // A low berm behind the targets, so shots that miss stop somewhere
    // visible instead of sailing into empty sky.
    const berm = new THREE.Mesh(
      new THREE.BoxGeometry(RANGE_HALF_WIDTH * 2, 14, 6),
      new THREE.MeshStandardMaterial({ color: 0x3d4632, roughness: 1 })
    );
    berm.position.set(0, 7, GROUND_END_Z + 20);
    this.scene.add(berm);

    // Firing-line marker.
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(RANGE_HALF_WIDTH * 2, 0.4),
      new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 1 })
    );
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.02, 0);
    this.scene.add(line);
  }

  _registerHit(dist) {
    this.hits++;
    this.sfx.ding();
    this.hud.toast(`Hit — ${dist}m`, 1400);
  }

  update(dt) {
    for (const t of this.targets) t.update(dt);
  }
}
