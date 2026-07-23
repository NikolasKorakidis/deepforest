import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { CONFIG } from '../core/config.js';
import { terrainHeight, hash2 } from '../world/heightfield.js';
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

    this.health = CONFIG.wolf.health;
    this.dead = false;
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
    this.ready = false;

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

  takeDamage(n) {
    if (this.dead) return;
    this.health -= n;
    this.flinch = 0.18;
    if (this.health <= 0) {
      this._die();
    } else {
      this.state = 'chase'; // getting shot always aggros
    }
  }

  _die() {
    this.dead = true;
    this.group.rotation.z = 1.45; // no death clip — tip the whole rig over
    this.group.position.y = this.pos.y + 0.15;
    if (this.onKilled) this.onKilled();
  }

  _moveToward(target, speed, dt) {
    const dx = target.x - this.pos.x;
    const dz = target.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.2) return true;
    this.moveDir.set(dx / d, 0, dz / d);
    this.pos.x += this.moveDir.x * speed * dt;
    this.pos.z += this.moveDir.z * speed * dt;
    return false;
  }

  update(dt, ctx) {
    if (!this.ready) return; // model still loading — pop in once ready

    if (this.dead) {
      // settle into the ground a little; mixer stays paused on last frame
      if (this.deathT < 1) {
        this.deathT += dt;
        this.group.position.y -= dt * 0.1;
      }
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
            this._moveToward(p, stalking ? W.wanderSpeed * 1.4 : W.chaseSpeed, dt);
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

/** Deterministic wolf dens along the route. */
export function wolfSpawnPoints(pathXFn, pond) {
  return [
    { x: pathXFn(-95) + 6, z: -95 },
    { x: pond.x + 4, z: pond.z + 20 }, // north shore of the lake, clear of the water
    { x: pathXFn(-235) - 7, z: -235 },
  ];
}
