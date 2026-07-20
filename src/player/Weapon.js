import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { CONFIG } from '../core/config.js';
import { makeGlowSprite } from '../core/glow.js';
import { loadGLTF } from '../core/assets.js';
import fpsHandsUrl from '../assets/models/fps_hands.glb?url';

// Rifle + binoculars: the rifle viewmodel is a rigged hands+weapon GLB
// driven by its own authored animation clips (idle/walk/shoot/reload)
// rather than hand-rolled sway/bob math; binoculars stay a simple
// primitive. Hitscan shooting via raycast, ammo/reload.

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
const MODEL_SCALE = 3;
const HIP_POS = new THREE.Vector3(0.15, -0.75, -0.55);
const AIM_POS = new THREE.Vector3(1, -0.05, -0.3);

export class Weapon {
  constructor({ camera, input, controller, hud, sfx, getTargets }) {
    this.camera = camera;
    this.input = input;
    this.controller = controller;
    this.hud = hud;
    this.sfx = sfx;
    this.getTargets = getTargets;

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

    this.mixer = null;
    this.actions = {};
    this.currentAnim = null;
    this.ready = false;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = CONFIG.rifle.range;

    this._buildViewmodels();

    input.onMouseDown(0, () => this.tryFire());
    input.onMouseDown(2, () => { this.aiming = true; });
    input.onMouseUp(2, () => { this.aiming = false; });
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
    // computed from the skin-weighted "Rifle" mesh's bind-pose extent
    // (raw local ~(-0.06, 0.09, 0.7), the muzzle-end bounding-box corner)
    // run through the same scale+180°-yaw transform as the model above,
    // then nudged a bit further out so the flash reads as erupting from
    // the barrel rather than sitting inside it.
    this.flash = makeGlowSprite(0xffcc77, 0.4, 0.9);
    this.flash.position.set(-0.03, 0.04, -0.34);
    this.flash.visible = false;
    rifle.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffaa55, 0, 8, 2);
    this.flashLight.position.set(-0.03, 0.04, -0.32);
    rifle.add(this.flashLight);

    // Binoculars.
    const binoc = new THREE.Group();
    const tubeMat = new THREE.MeshStandardMaterial({ color: 0x1e1f22, roughness: 0.6 });
    for (const off of [-0.035, 0.035]) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.12, 10), tubeMat);
      tube.rotation.x = Math.PI;
      tube.position.set(off, 0, 0);
      binoc.add(tube);
    }
    binoc.position.set(0.16, -0.18, -0.4);
    binoc.visible = false;
    this.binocGroup = binoc;
    this.camera.add(binoc);
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

    // World matrices are normally refreshed during render, i.e. one frame
    // behind by the time we fire — sync them so the ray matches the view.
    this.camera.updateMatrixWorld();
    const targets = this.getTargets();
    for (const t of targets) t.updateMatrixWorld(true);
    this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    const hits = this.raycaster.intersectObjects(targets, true);
    if (hits.length > 0) {
      let obj = hits[0].object;
      while (obj && !obj.userData.wolfRef) obj = obj.parent;
      if (obj && obj.userData.wolfRef) {
        obj.userData.wolfRef.takeDamage(1);
        this.hud.hitmarker();
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
    const animName = this.magAmmo === 0 ? 'reloadFull' : 'reload';
    const action = this.actions[animName];
    this.reloadT = action ? action.getClip().duration : CONFIG.rifle.reloadTimeFallback;
    this._playAnim(animName, 0.1);
    this.sfx.reload();
  }

  update(dt) {
    this.cooldown -= dt;
    this.shotT = Math.max(0, this.shotT - dt);

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
    if (this.aiming && this.equipped === 'rifle') targetFov = 52;
    if (binocAim) targetFov = 18;
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 10);
      this.camera.updateProjectionMatrix();
    }
    this.hud.setBinocularMask(binocAim);
    this.hud.setCrosshair(this.equipped === 'rifle' && !binocAim);

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
