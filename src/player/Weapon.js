import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { CONFIG } from '../core/config.js';
import { makeGlowSprite } from '../core/glow.js';
import { makeSparkSprite } from '../core/particleTextures.js';
import { loadGLTF, normalizeModel } from '../core/assets.js';
import fpsHandsUrl from '../assets/models/fps_hands.glb?url';
import binocularsUrl from '../assets/models/binoculars.glb?url';

// Rifle + binoculars: the rifle viewmodel is a rigged hands+weapon GLB
// driven by its own authored animation clips (idle/walk/shoot/reload)
// rather than hand-rolled sway/bob math; binoculars stay a simple
// primitive. Firing launches a real (if exaggerated) ballistic projectile
// — see _updateBullets — rather than an instant hitscan, so shots actually
// drop in flight and the scope's BDC ladder means something.

/** First hit that's actually solid geometry — `intersectObjects` happily
 *  reports hits against decorative Sprite/Points objects (glow sprites,
 *  fire/smoke/spark billboards, the moon, stars), which aren't real
 *  surfaces a bullet (or the rangefinder) should stop at. Results are
 *  distance-sorted, so this is just "skip the non-solid ones". */
function firstSolidHit(hits) {
  for (const hit of hits) {
    if (!hit.object.isSprite && !hit.object.isPoints) return hit;
  }
  return null;
}

// Clip names as authored in the GLB.
const CLIPS = {
  idle: 'Rig|SRifle_Idle',
  walk: 'Rig|SRifle_Walk',
  shotHip: 'Rig|SRifle_Shot_nosight',
  shotAim: 'Rig|SRifle_Shot_sight',
  reload: 'Rig|SRifle_Reload',
  reloadFull: 'Rig|SRifle_Reload_Full',
};

// Viewmodel placement: the asset is authored at real-world (roughly
// human-forearm) scale, which is far too large at typical viewmodel
// distance from the camera — scaled down and positioned empirically for a
// comfortable lower-right FPS frame. A different offset is used while
// aiming down sights (arms move it up toward center to look through the
// scope). See the bottom of this file for what each number controls.
const MODEL_SCALE = 1;
const HIP_POS = new THREE.Vector3(-0.075, -0.21, -0.055);
const AIM_POS = new THREE.Vector3(0.055, -0.26, -0.025);

export class Weapon {
  constructor({ camera, input, controller, hud, sfx, getWorld }) {
    this.camera = camera;
    this.input = input;
    this.controller = controller;
    this.hud = hud;
    this.sfx = sfx;
    this.getWorld = getWorld;

    this.equipped = null; // 'rifle' | 'binoculars' | null
    this.hasRifle = false;
    this.hasBinoculars = false;
    this.magAmmo = 0;
    this.reserveAmmo = 0;
    this.cooldown = 0;
    this.reloadT = 0;
    this.shotT = 0; // keeps a fire animation from being interrupted by walk/idle
    this.aiming = false;
    this.flashT = 0;
    this.aimAmount = 0; // 0..1, smoothed toward 1 while aiming (see update)
    this.swayTime = 0;

    this.mixer = null;
    this.actions = {};
    this.currentAnim = null;
    this.ready = false;

    // In-flight projectiles (see tryFire/_updateBullets) and their impact
    // spark effects (see _spawnImpact/_updateImpacts).
    this.bullets = [];
    this.impacts = [];
    this.bulletRaycaster = new THREE.Raycaster();
    // Sprite.raycast() throws if raycaster.camera isn't set (it needs it to
    // compute the billboard's facing) — setFromCamera() sets this for us
    // automatically, but .set(origin, direction) (what bullets use, since
    // they don't originate from the camera) does not, and the scene is full
    // of sprites (glow/fire/smoke/spark/moon). Set it once explicitly.
    this.bulletRaycaster.camera = this.camera;

    // Separate raycaster for the scope's rangefinder readout: checks
    // distance to anything in the scene (not just wolves), so it needs its
    // own far plane matching the camera's.
    this.rangeRaycaster = new THREE.Raycaster();
    this.rangeRaycaster.far = 420; // matches the camera's far plane

    this._buildViewmodels();

    input.onMouseDown(0, () => this.tryFire());
    input.onMouseDown(2, () => { this.aiming = !this.aiming; });
    input.onPress('KeyR', () => this.tryReload());
    input.onPress('Digit1', () => this.toggle('rifle'));
    input.onPress('Digit2', () => this.toggle('binoculars'));
  }

  _buildViewmodels() {
    const rifle = new THREE.Group();
    rifle.visible = false;
    rifle.position.copy(HIP_POS);
    this.rifleGroup = rifle;
    this.camera.add(rifle);

    loadGLTF(fpsHandsUrl)
      .then((gltf) => {
        const model = cloneSkinned(gltf.scene);
        // The source rig is left-handed (left hand on the trigger, right on
        // the forestock) — mirror on X to get the standard right-handed
        // grip our camera framing expects. Separately, the raw mesh's
        // muzzle sits at local +Z (verified via proper skin-weighted
        // vertex transforms — the mesh is skinned, so its node's own
        // transform alone doesn't give the true bind-pose position), i.e.
        // pointing back at the camera (-Z is forward), so a 180° yaw is
        // needed to bring it around. (A 90° yaw points the muzzle
        // sideways instead — it swaps local X and Z rather than flipping
        // Z, a materially different, wrong fix — don't reintroduce it.)
        // Combined, X-mirror + 180° yaw nets out to a single Z-axis
        // mirror: X keeps its sign, Z flips — still one reflection (fixes
        // handedness) that also correctly reorients the barrel.
        model.scale.set(-MODEL_SCALE, MODEL_SCALE, MODEL_SCALE);
        model.rotation.y = Math.PI;
        model.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = false;
            o.receiveShadow = false;
            o.renderOrder = 2;
            o.frustumCulled = false; // viewmodel sits right at the near plane
          }
        });
        rifle.add(model);

        this.mixer = new THREE.AnimationMixer(model);
        for (const [key, clipName] of Object.entries(CLIPS)) {
          const clip = THREE.AnimationClip.findByName(gltf.animations, clipName);
          if (!clip) continue;
          const action = this.mixer.clipAction(clip);
          if (key === 'shotHip' || key === 'shotAim' || key === 'reload' || key === 'reloadFull') {
            action.setLoop(THREE.LoopOnce);
            action.clampWhenFinished = true;
          }
          this.actions[key] = action;
        }
        this._playAnim('idle', 0);
        this.ready = true;
      })
      .catch((err) => console.error('Failed to load FPS hands model:', err));

    // Muzzle flash: sprite + point light near the rifle's muzzle. Position
    // tuned visually via the /test.html viewmodel tuner (Test Fire
    // preview) — re-check with that tool if MODEL_SCALE changes again,
    // since this offset is relative to the model at its current scale.
    this.flash = makeGlowSprite(0xffcc77, 0.4, 0.9);
    this.flash.position.set(-0.03, 0.04, -0.34);
    this.flash.visible = false;
    rifle.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffaa55, 0, 8, 2);
    this.flashLight.position.set(-0.03, 0.04, -0.32);
    rifle.add(this.flashLight);

    // Binoculars viewmodel — only ever seen lowered (it's hidden while
    // actually glassing, same as the rifle is hidden while scoped), so it's
    // framed as something carried at the ready in the lower right.
    const binoc = new THREE.Group();
    binoc.position.set(0.15, -0.17, -0.38);
    binoc.rotation.set(0.12, 0.3, -0.07); // canted, as if just dropped from the eyes
    binoc.visible = false;
    this.binocGroup = binoc;
    this.camera.add(binoc);

    loadGLTF(binocularsUrl)
      .then((gltf) => {
        // The source is a porro-prism pair whose optical axis runs along
        // local +X (objectives at +X, eyepieces at -X — established by
        // measuring barrel radius at each end: 36mm vs 18mm). A +90° yaw
        // maps +X onto the camera's -Z, i.e. pointing away from the player.
        const model = normalizeModel(gltf.scene.clone(true), 0.19, {
          ground: false, shadows: false,
        });
        model.rotation.y = Math.PI / 2;
        model.traverse((o) => {
          if (o.isMesh) {
            o.renderOrder = 2;
            o.frustumCulled = false; // viewmodel sits right at the near plane
          }
        });
        binoc.add(model);
      })
      .catch((err) => console.error('Failed to load binoculars model:', err));
  }

  _playAnim(name, fade = 0.15) {
    const next = this.actions[name];
    if (!next || this.currentAnim === name) return;
    const prev = this.currentAnim ? this.actions[this.currentAnim] : null;
    next.reset().fadeIn(fade).play();
    if (prev) prev.fadeOut(fade);
    this.currentAnim = name;
  }

  giveRifle() {
    this.hasRifle = true;
    this.magAmmo = CONFIG.rifle.magSize;
    this.equip('rifle');
  }

  giveBinoculars() {
    this.hasBinoculars = true;
  }

  addAmmo(n) {
    this.reserveAmmo += n;
  }

  toggle(what) {
    this.equip(this.equipped === what ? null : what);
  }

  equip(what) {
    if (what === 'rifle' && !this.hasRifle) return;
    if (what === 'binoculars' && !this.hasBinoculars) return;
    this.equipped = what;
    this.rifleGroup.visible = what === 'rifle';
    this.binocGroup.visible = what === 'binoculars';
  }

  tryFire() {
    if (this.equipped !== 'rifle' || this.reloadT > 0 || this.cooldown > 0) return;
    if (this.magAmmo <= 0) {
      this.sfx.dry();
      this.hud.toast(this.reserveAmmo > 0 ? 'Empty — press R to reload.' : 'Out of ammo.');
      return;
    }
    this.magAmmo--;
    this.cooldown = CONFIG.rifle.fireCooldown;
    this.flashT = 0.06;
    this.controller.addRecoil(0.032 + Math.random() * 0.012, (Math.random() - 0.5) * 0.012);
    this.sfx.shot();

    const shotAnim = this.aiming ? 'shotAim' : 'shotHip';
    if (this.actions[shotAnim]) {
      this.shotT = this.actions[shotAnim].getClip().duration * 0.5; // recoil half; let walk/idle resume after
      this._playAnim(shotAnim, 0.05);
    }

    // Launch the actual projectile (world matrices are normally refreshed
    // during render, i.e. one frame behind by the time we fire — sync them
    // so the initial direction matches what's on screen).
    this.camera.updateMatrixWorld();
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const muzzlePos = new THREE.Vector3();
    this.camera.getWorldPosition(muzzlePos);
    this.bullets.push({
      pos: muzzlePos,
      vel: dir.multiplyScalar(CONFIG.rifle.muzzleVelocity),
      life: CONFIG.rifle.bulletLifetime,
    });
  }

  /** Advances in-flight bullets: gravity + a swept raycast per step so fast
   *  projectiles can't tunnel through a wolf or the terrain between frames. */
  _updateBullets(dt) {
    if (this.bullets.length === 0) return;
    const world = this.getWorld().children.filter((o) => o !== this.camera);
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      const prevPos = b.pos.clone();
      // Closed-form constant-acceleration step: x += v·dt + ½·g·dt², then
      // v += g·dt. Exact, so point of impact doesn't shift with framerate.
      // (Stepping velocity first and then x += v·dt — plain Euler — biases
      // the drop by ½·g·dt·t, which measured 0.12m low at 60fps and 0.25m
      // low at 30fps on a 100m shot: the same hold landing differently on
      // a slower machine.)
      const g = CONFIG.rifle.bulletGravity;
      b.pos.addScaledVector(b.vel, dt);
      b.pos.y -= 0.5 * g * dt * dt;
      b.vel.y -= g * dt;

      const segment = new THREE.Vector3().subVectors(b.pos, prevPos);
      const dist = segment.length();
      let hit = null;
      if (dist > 1e-6) {
        segment.divideScalar(dist); // normalize in place
        this.bulletRaycaster.set(prevPos, segment);
        this.bulletRaycaster.far = dist;
        const hits = this.bulletRaycaster.intersectObjects(world, true);
        hit = firstSolidHit(hits);
      }

      if (hit) {
        let obj = hit.object;
        while (obj && !obj.userData.wolfRef) obj = obj.parent;
        if (obj && obj.userData.wolfRef) {
          const wolf = obj.userData.wolfRef;
          // Headshots always drop a wolf outright, regardless of remaining
          // health — everywhere else takes CONFIG.wolf.health hits (2), the
          // first of which leaves it wounded and slowed. `segment` is the
          // bullet's unit direction, which the corpse is thrown along.
          wolf.takeDamage(wolf.isHeadshot(hit.point) ? Infinity : 1, segment);
          this.hud.hitmarker();
        }
        this._spawnImpact(hit.point);
        this.bullets.splice(i, 1);
      } else if (b.life <= 0) {
        this.bullets.splice(i, 1);
      }
    }
  }

  /** A brief burst of sparks where a shot lands — terrain or a wolf alike. */
  _spawnImpact(point) {
    const sprites = [];
    const n = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const s = makeSparkSprite(0.09 + Math.random() * 0.06, 1);
      s.position.copy(point);
      const theta = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 2.5;
      s.userData.vel = new THREE.Vector3(
        Math.cos(theta) * speed,
        (0.6 + Math.random() * 0.8) * speed,
        Math.sin(theta) * speed
      );
      this.getWorld().add(s);
      sprites.push(s);
    }
    this.impacts.push({ sprites, age: 0, life: 0.35 });
  }

  _updateImpacts(dt) {
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const imp = this.impacts[i];
      imp.age += dt;
      const fade = Math.max(0, 1 - imp.age / imp.life);
      for (const s of imp.sprites) {
        s.userData.vel.y -= 9.8 * dt;
        s.position.addScaledVector(s.userData.vel, dt);
        s.material.opacity = fade;
      }
      if (imp.age >= imp.life) {
        for (const s of imp.sprites) this.getWorld().remove(s);
        this.impacts.splice(i, 1);
      }
    }
  }

  tryReload() {
    if (this.equipped !== 'rifle' || this.reloadT > 0) return;
    if (this.magAmmo >= CONFIG.rifle.magSize) return;
    if (this.reserveAmmo <= 0) {
      this.hud.toast('No spare ammunition.');
      return;
    }
    // Drop out of the scope/binoculars view — the reload plays out on the
    // visible viewmodel, which is hidden while looking through a lens.
    this.aiming = false;

    const animName = this.magAmmo === 0 ? 'reloadFull' : 'reload';
    const action = this.actions[animName];
    this.reloadT = action ? action.getClip().duration : CONFIG.rifle.reloadTimeFallback;
    this._playAnim(animName, 0.1);
    this.sfx.reload();
  }

  /** Distance in meters from the camera to whatever's dead-center in the scope, or null. */
  _rangefinder() {
    this.camera.updateMatrixWorld();
    const targets = this.getWorld().children.filter((o) => o !== this.camera);
    this.rangeRaycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    const hits = this.rangeRaycaster.intersectObjects(targets, true);
    const hit = firstSolidHit(hits);
    return hit ? Math.round(hit.distance) : null;
  }

  update(dt) {
    this.cooldown -= dt;
    this.shotT = Math.max(0, this.shotT - dt);
    this._updateBullets(dt);
    this._updateImpacts(dt);

    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const take = Math.min(CONFIG.rifle.magSize - this.magAmmo, this.reserveAmmo);
        this.magAmmo += take;
        this.reserveAmmo -= take;
      }
    }

    // FOV zoom for aiming / binoculars.
    let targetFov = 70;
    const binocAim = this.aiming && this.equipped === 'binoculars';
    const rifleAim = this.aiming && this.equipped === 'rifle';
    if (rifleAim) targetFov = 26; // ~2x the magnification of the old 52° scope zoom
    if (binocAim) targetFov = 18;
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 10);
      this.camera.updateProjectionMatrix();
    }
    // The scope view only appears once the zoom-in animation has actually
    // settled on its target FOV, not the instant RMB goes down.
    const scopeView = rifleAim && Math.abs(this.camera.fov - targetFov) < 0.5;
    this.hud.setBinocularMask(binocAim);
    this.hud.setCrosshair(this.equipped === 'rifle' && !binocAim && !scopeView);
    this.hud.setScopeView(scopeView, scopeView ? this._rangefinder() : null);

    // Hide the viewmodel itself while looking through a lens — real scopes
    // only show what's down the barrel, not the gun body/scope housing
    // blocking half the view; the 2D HUD overlay carries the whole "zoomed
    // view" illusion once scoped/binoculars are up.
    this.rifleGroup.visible = this.equipped === 'rifle' && !scopeView;
    this.binocGroup.visible = this.equipped === 'binoculars' && !binocAim;

    // Aim sway: a real camera-rotation drift, not a cosmetic wobble — shots
    // fire along the camera's actual direction, so this is what actually
    // makes holding a steadier stance (crouch/prone) matter for accuracy.
    // Ramps in/out smoothly with aiming, layers two off-frequency sine waves
    // per axis so the motion reads as organic breathing rather than a
    // metronome, and worsens as energy drains (a winded shooter shakes more).
    const A = CONFIG.aim;
    this.aimAmount += ((this.aiming ? 1 : 0) - this.aimAmount) * Math.min(1, dt * A.swayRampRate);
    if (this.aimAmount > 0.001) {
      this.swayTime += dt;
      const stanceMult = A.stanceMult[this.controller.stance] ?? 1;
      const energyMult = THREE.MathUtils.lerp(A.energySwayMax, 1, this.controller.stats.energy / 100);
      const amp = THREE.MathUtils.degToRad(A.swayMaxDeg) * stanceMult * energyMult * this.aimAmount;
      const swayPitch = (Math.sin(this.swayTime * 0.9) * 0.6 + Math.sin(this.swayTime * 2.3 + 1.7) * 0.4) * amp;
      const swayYaw = (Math.sin(this.swayTime * 0.75 + 0.5) * 0.6 + Math.sin(this.swayTime * 1.9 + 3.1) * 0.4) * amp;
      this.camera.rotation.x += swayPitch;
      this.camera.rotation.y += swayYaw;
    }

    // Animation state, by priority: reload > recovering-from-shot > walk > idle.
    if (this.ready) {
      if (this.reloadT > 0) {
        // already playing (triggered in tryReload); nothing to do
      } else if (this.shotT > 0) {
        // let the shot animation play out
      } else if (this.controller.speed2D > 0.3) {
        this._playAnim('walk');
        const walkAction = this.actions.walk;
        if (walkAction) {
          walkAction.timeScale = THREE.MathUtils.clamp(
            this.controller.speed2D / CONFIG.player.walkSpeed, 0.8, 1.8
          );
        }
      } else {
        this._playAnim('idle');
      }
      this.mixer.update(dt);
    }

    // Aim-down-sights position shift (the clips don't carry a distinct aim
    // pose, so this is the one bit of manual positioning left).
    const targetPos = this.aiming ? AIM_POS : HIP_POS;
    this.rifleGroup.position.lerp(targetPos, Math.min(1, dt * 10));

    // Muzzle flash decay.
    this.flashT -= dt;
    const flashOn = this.flashT > 0;
    this.flash.visible = flashOn;
    this.flashLight.intensity = flashOn ? 14 : 0;
  }
}
