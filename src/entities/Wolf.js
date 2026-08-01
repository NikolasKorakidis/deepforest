import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { CONFIG } from '../core/config.js';
import { terrainHeight, hash2, clamp, POND, POND_RADIUS } from '../world/heightfield.js';
import { loadGLTF, normalizeModel } from '../core/assets.js';
import wolfUrl from '../assets/models/wolf.glb?url';

// Wolf: simple state machine — idle <-> wander around its den, chase when
// the player gets close (larger radius at night), lunge attacks on contact,
// returns home if the player escapes. Dies after enough rifle hits.
//
// TODO(future): birds (ambience only), foxes (flee from the player, steal
// dropped food) and a bear (tanky, slower detect but relentless, forces the
// player to burn ammo or run). The state machine below generalizes: add
// per-species speeds/health/damage in config and a `flee` state.

// The GLB carries five clips (named by the artist) plus a huge unnamed
// ground-catcher plane left over from the turntable render — that plane
// isn't part of the rig and would wreck bounding-box scaling if left in.
const CLIP_NAMES = {
  run: '01_Run',
  walk: '02_walk',
  creep: '03_creep',
  idle: '04_Idle',
  sit: '05_site',
};
const GROUND_PLANE_NAME = 'Plane_unnamed_0';
// The rig was authored/exported with German bone names — "Kopf" = head.
// Exact name confirmed via gltf-transform inspection; the regex fallback
// below guards against the numeric suffix ever shifting on a re-export.
const HEAD_BONE_NAME = 'Kopf_002_014';

// Wolves can't swim: the lake is a hole in their walkable space. Without
// this they take the straight line to the player and trot across open
// water — most visibly right after being shot, when they aggro from the
// far shore.
const LAKE_MARGIN = 2.5;    // how far outside the waterline they stay
const LAKE_STEER_BAND = 12; // distance over which the turn is blended in

/**
 * Bends a desired heading around the lake. Returns the steered unit
 * direction. Blending from the straight line into the tangent (rather than
 * flipping to it at the water's edge) keeps them from visibly snapping
 * sideways when they get near the shore.
 */
function avoidLake(x, z, dirX, dirZ) {
  const keepOut = POND_RADIUS + LAKE_MARGIN;
  const toCx = x - POND.x, toCz = z - POND.z;
  const dist = Math.hypot(toCx, toCz) || 1;
  if (dist > keepOut + LAKE_STEER_BAND) return [dirX, dirZ]; // nowhere near it

  const nx = toCx / dist, nz = toCz / dist; // outward from the lake centre
  if (dirX * nx + dirZ * nz >= 0) return [dirX, dirZ]; // already heading away

  // Round the shore on whichever side the wolf was already leaning.
  let tx = -nz, tz = nx;
  if (dirX * tx + dirZ * tz < 0) { tx = nz; tz = -nx; }

  const blend = clamp((keepOut + LAKE_STEER_BAND - dist) / LAKE_STEER_BAND, 0, 1);
  let ox = dirX * (1 - blend) + tx * blend;
  let oz = dirZ * (1 - blend) + tz * blend;
  if (dist < keepOut) { ox += nx * 1.5; oz += nz * 1.5; } // already wet — push out
  const len = Math.hypot(ox, oz) || 1;
  return [ox / len, oz / len];
}

const WOLF_MODEL = {
  size: 1.9,          // target nose-to-tail length, world units
  yawOffset: Math.PI, // rest pose faces -X; flip so it faces its moveDir
};

export class Wolf {
  constructor(scene, spawn, { onKilled } = {}) {
    this.home = new THREE.Vector3(spawn.x, 0, spawn.z);
    this.pos = this.home.clone();
    this.pos.y = terrainHeight(this.pos.x, this.pos.z);
    this.onKilled = onKilled;

    this.scene = scene;
    this.health = CONFIG.wolf.health;
    this.dead = false;
    this.wounded = false; // survived a body shot — slowed until finished off
    this.ragdoll = null;
    this.state = 'idle';
    this.idleTimer = 1 + Math.random() * 3;
    this.idleAnim = 'idle';
    this.wanderTarget = new THREE.Vector3();
    this.attackCd = 0;
    this.alertCd = 0;
    this.flinch = 0;
    this.deathT = 0;
    this.moveDir = new THREE.Vector3(1, 0, 0);

    this.mixer = null;
    this.actions = {};
    this.currentAnim = null;
    this.eyeMat = null;
    this.headBone = null; // found once the model loads; see _loadModel/isHeadshot
    this.ready = false;
    this._headWorldPos = new THREE.Vector3(); // scratch, reused each isHeadshot() call

    // Lightweight placeholder container; raycasts and movement work
    // immediately, the visible model pops in once the GLTF resolves (shared
    // across all wolf instances via loadGLTF's cache).
    this.group = new THREE.Group();
    this.group.position.copy(this.pos);
    this.group.userData.wolfRef = this;
    scene.add(this.group);

    this._loadModel();
  }

  _loadModel() {
    loadGLTF(wolfUrl)
      .then((gltf) => {
        // Skinned meshes need SkeletonUtils.clone — a plain Object3D clone
        // would leave every wolf instance sharing (and fighting over) one
        // skeleton.
        const clone = cloneSkinned(gltf.scene);

        const plane = clone.getObjectByName(GROUND_PLANE_NAME);
        if (plane) plane.parent.remove(plane);

        this.headBone = clone.getObjectByName(HEAD_BONE_NAME);
        if (!this.headBone) {
          clone.traverse((o) => { if (!this.headBone && /kopf/i.test(o.name)) this.headBone = o; });
        }

        // yawOffset is applied once, dynamically, in update()'s facing
        // formula on the outer group — this inner model stays unrotated.
        const model = normalizeModel(clone, WOLF_MODEL.size);
        this.group.add(model);

        this.mixer = new THREE.AnimationMixer(clone);
        for (const [key, clipName] of Object.entries(CLIP_NAMES)) {
          const clip = THREE.AnimationClip.findByName(gltf.animations, clipName);
          if (clip) this.actions[key] = this.mixer.clipAction(clip);
        }
        this._playAnim('idle', 0);

        model.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.userData.wolfRef = this;
            if (o.material?.isMeshStandardMaterial && o.material.name === 'eyes') {
              o.material.emissive = new THREE.Color(0x220800);
              o.material.emissiveIntensity = 0.3;
              this.eyeMat = o.material;
            }
          }
        });

        this.ready = true;
      })
      .catch((err) => console.error('Failed to load wolf model:', err));
  }

  _playAnim(name, fade = 0.25) {
    const next = this.actions[name];
    if (!next || this.currentAnim === name) return;
    const prev = this.currentAnim ? this.actions[this.currentAnim] : null;
    next.reset().fadeIn(fade).play();
    if (prev) prev.fadeOut(fade);
    this.currentAnim = name;
  }

  /** @param point world-space hit point (from the bullet's raycast) */
  isHeadshot(point) {
    if (!this.headBone) return false;
    this.headBone.getWorldPosition(this._headWorldPos);
    return this._headWorldPos.distanceTo(point) < CONFIG.wolf.headshotRadius;
  }

  /**
   * @param n         damage; Infinity from a headshot, 1 from a body shot.
   * @param impulseDir unit direction the shot was travelling, used to throw
   *   the corpse. Optional — a wolf can die without being shot.
   */
  takeDamage(n, impulseDir) {
    if (this.dead) return;
    this.health -= n;
    this.flinch = 0.18;
    if (this.health <= 0) {
      this._die(impulseDir);
    } else {
      // Survived it, so it's hurt: a body shot cripples rather than doing
      // nothing visible, and the follow-up finishes it. Without this the
      // first of two body shots had no effect the player could perceive.
      this.wounded = true;
      this.state = 'chase'; // getting shot always aggros
    }
  }

  _die(impulseDir) {
    this.dead = true;

    // There's no death clip in the GLB, and the old "tip it over on its
    // side" was worse than nothing. So: launch it. The rig keeps its last
    // animated pose and gets thrown along the bullet's path, tumbling, with
    // a bounce off the terrain — deliberately absurd rather than a bad
    // attempt at being solemn.
    const R = CONFIG.wolf.ragdoll;
    const dx = impulseDir ? impulseDir.x : 0;
    const dz = impulseDir ? impulseDir.z : 1;
    this.ragdoll = {
      vel: new THREE.Vector3(
        dx * R.launchSpeed + (Math.random() - 0.5) * 5,
        R.launchUp + Math.random() * 5,
        dz * R.launchSpeed + (Math.random() - 0.5) * 5
      ),
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 16,
        (Math.random() - 0.5) * 11,
        (Math.random() - 0.5) * 16
      ),
    };
    if (this.onKilled) this.onKilled();
  }

  /** Integrates the launched corpse, then despawns it. */
  _updateRagdoll(dt) {
    const R = CONFIG.wolf.ragdoll;
    const r = this.ragdoll;
    this.deathT += dt;

    r.vel.y -= R.gravity * dt;
    this.pos.addScaledVector(r.vel, dt);

    const groundY = terrainHeight(this.pos.x, this.pos.z);
    if (this.pos.y < groundY + 0.3 && r.vel.y < 0) {
      this.pos.y = groundY + 0.3;
      r.vel.y *= -R.bounce;      // comedy bounce
      r.vel.x *= 0.82;
      r.vel.z *= 0.82;
      r.spin.multiplyScalar(0.7);
    }

    this.group.position.copy(this.pos);
    this.group.rotation.x += r.spin.x * dt;
    this.group.rotation.y += r.spin.y * dt;
    this.group.rotation.z += r.spin.z * dt;

    if (this.deathT > R.despawnSec) {
      this.scene.remove(this.group);
      this.ragdoll = null;
    }
  }

  _moveToward(target, speed, dt) {
    const dx = target.x - this.pos.x;
    const dz = target.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.2) return true;
    const [sx, sz] = avoidLake(this.pos.x, this.pos.z, dx / d, dz / d);
    this.moveDir.set(sx, 0, sz);
    this.pos.x += sx * speed * dt;
    this.pos.z += sz * speed * dt;
    return false;
  }

  update(dt, ctx) {
    if (!this.ready) return; // model still loading — pop in once ready

    if (this.dead) {
      if (this.ragdoll) this._updateRagdoll(dt);
      return;
    }

    const W = CONFIG.wolf;
    const p = ctx.playerPos;
    const dist = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    const detectR = (ctx.env.isNight ? W.detectRadiusNight : W.detectRadiusDay) * (ctx.stealthMult ?? 1);

    this.attackCd -= dt;
    this.alertCd -= dt;
    this.flinch = Math.max(0, this.flinch - dt);

    if (this.state !== 'chase' && dist < detectR) {
      this.state = 'chase';
      if (this.alertCd <= 0) {
        this.alertCd = 20;
        ctx.sfx.growl();
        ctx.hud.toast('Something is stalking you…');
      }
    }

    let desiredAnim = 'idle';

    switch (this.state) {
      case 'idle':
        this.idleTimer -= dt;
        desiredAnim = this.idleAnim;
        if (this.idleTimer <= 0) {
          const a = Math.random() * Math.PI * 2;
          const r = 4 + Math.random() * 10;
          this.wanderTarget.set(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
          this.state = 'wander';
        }
        break;

      case 'wander':
        desiredAnim = 'walk';
        if (this._moveToward(this.wanderTarget, W.wanderSpeed, dt)) {
          this.state = 'idle';
          this.idleTimer = 2 + Math.random() * 4;
          // occasional sit for idle variety, if the clip loaded
          this.idleAnim = this.actions.sit && Math.random() < 0.3 ? 'sit' : 'idle';
        }
        break;

      case 'chase':
        if (dist > W.giveUpRadius) {
          this.state = 'return';
        } else {
          // Close the gap at a run; once within lunging distance, drop to a
          // stalking creep and square up to the player rather than sliding
          // straight through them.
          const stalking = dist < W.attackRange * 2.4;
          desiredAnim = stalking ? 'creep' : 'run';
          if (dist > W.attackRange * 0.8) {
            const hurt = this.wounded ? W.woundedSpeedMult : 1;
            this._moveToward(p, (stalking ? W.wanderSpeed * 1.4 : W.chaseSpeed) * hurt, dt);
          } else {
            const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
            const d = Math.hypot(dx, dz) || 1;
            this.moveDir.set(dx / d, 0, dz / d);
          }
          if (dist < W.attackRange && this.attackCd <= 0 && this.flinch <= 0) {
            this.attackCd = W.attackCooldown;
            ctx.stats.damage(W.damage, 'a wolf');
            ctx.sfx.bite();
          }
        }
        break;

      case 'return':
        desiredAnim = 'walk';
        if (this._moveToward(this.home, 3, dt)) this.state = 'idle';
        if (dist < detectR * 0.8) this.state = 'chase';
        break;
    }

    this._playAnim(desiredAnim);
    this.mixer.update(dt);

    // Grounding, facing, eye glow.
    this.pos.y = terrainHeight(this.pos.x, this.pos.z);
    this.group.position.copy(this.pos);

    const targetRot = Math.atan2(-this.moveDir.z, this.moveDir.x) + WOLF_MODEL.yawOffset;
    let dr = targetRot - this.group.rotation.y;
    while (dr > Math.PI) dr -= Math.PI * 2;
    while (dr < -Math.PI) dr += Math.PI * 2;
    this.group.rotation.y += dr * Math.min(1, dt * 8);

    if (this.eyeMat) this.eyeMat.emissiveIntensity = ctx.env.isNight ? 2.2 : 0.3;

    // Flinch feedback when shot.
    this.group.position.y += this.flinch > 0 ? Math.sin(this.flinch * 40) * 0.05 : 0;
  }
}

/** Wolf territory: the lake. Tied to the "find water" quest beat — the
 *  danger is exactly where that objective sends the player, rather than
 *  scattered across the whole map. Both dens sit just past the lake's own
 *  treeline, on the far side from the approach shore the player walks up
 *  to drink from, so they're something you notice at the water rather than
 *  something you blunder into on the way. */
export function wolfSpawnPoints(pond) {
  // Four dens ringing the lake at ~21 units, deliberately spread across the
  // half of the shore *away* from the approach the player walks in on (the
  // gap in the treeline facing spawn, ~129°) — so the water is contested
  // ground rather than an ambush the moment you arrive.
  const shore = [25, -35, -95, -155].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return { x: pond.x + Math.cos(a) * 21, z: pond.z + Math.sin(a) * 21 };
  });

  // Two more up on the ridge that overlooks the lake from the north-east.
  // Offsets are relative to the lake so the pair travels with it, but the
  // values come from scanning the heightfield for the flattest footing on
  // the first real high ground beyond the water — the basin between here
  // and the shore only rises a few units, so this genuinely is where the
  // mountain starts. Far enough out (~80m) that they're a separate
  // encounter for anyone who climbs, not extra pressure at the waterline.
  const mountain = [
    { x: pond.x + 78, z: pond.z - 25 },
    { x: pond.x + 60, z: pond.z - 58 },
  ];

  return [...shore, ...mountain];
}
