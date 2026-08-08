import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Input } from './Input.js';
import { SFX } from './sfx.js';
import { SpatialGrid } from './SpatialGrid.js';
import { createTerrain } from '../world/Terrain.js';
import { scatterVegetation, updateVegetation } from '../world/Vegetation.js';
import { Environment } from '../world/Environment.js';
import { Level } from '../world/Level.js';
import { PlayerStats } from '../player/PlayerStats.js';
import { PlayerController } from '../player/PlayerController.js';
import { Weapon } from '../player/Weapon.js';
import { Wolf } from '../entities/Wolf.js';
import { InteractionSystem } from '../systems/Interaction.js';
import { CampfireSystem } from '../systems/Campfire.js';
import { Inventory } from '../items/Inventory.js';
import { HUD } from '../ui/HUD.js';
import { clamp, terrainHeight, POND, POND_RADIUS } from '../world/heightfield.js';
import { saveGame, loadGame, clearSave } from './save.js';
import { PerfScaler } from './PerfScaler.js';
import { Range } from '../world/Range.js';
import { Wind } from '../world/Wind.js';
import { KillCam } from './KillCam.js';
import { Focus } from '../player/Focus.js';

import { allAssetsSettled, loadProgress } from './assets.js';

// Orchestrator: owns the renderer/scene/camera and every game system,
// drives the fixed update -> render loop, and handles the meta state
// machine: start -> playing <-> paused / sleeping -> dead | finished.

export class Game {
  constructor(container) {
    // --- renderer / scene / camera ---
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Pixel ratio is owned by PerfScaler from here on. It starts at 1.5
    // rather than the device's own ratio because on a 2x display that meant
    // rendering four times the pixels, which is by far the cheapest thing
    // to give up and the least likely to be noticed.
    this.perf = new PerfScaler(this.renderer, { targetFps: 60, minScale: 0.6, maxScale: 1.5 });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    // Far enough to see the 700m plates up on the mountain shelf, with
    // margin for the ridge standing behind them.
    this.camera = new THREE.PerspectiveCamera(
      70, window.innerWidth / window.innerHeight, 0.08, 1200
    );
    this.scene.add(this.camera); // required: viewmodels are camera children

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Loaded up front (not just on "Continue") because Level needs
    // takenPickups at construction time, before the player has chosen
    // anything on the start screen.
    this.pendingSave = loadGame();

    // --- systems ---
    this.hud = new HUD();
    this.sfx = new SFX();
    this.input = new Input();
    this.grid = new SpatialGrid(8);

    this.scene.add(createTerrain());
    // Firewood is placed under a fraction of the scattered trees, so Level
    // takes its spots from the vegetation pass rather than picking its own.
    const { firewoodSpots, treeSpots } = scatterVegetation(this.scene, this.grid);
    this.env = new Environment(this.scene);

    this.stats = new PlayerStats();
    this.inventory = new Inventory();
    this.interactions = new InteractionSystem(this.input, this.hud);
    this.controller = new PlayerController({
      camera: this.camera, input: this.input, grid: this.grid, stats: this.stats,
    });
    this.weapon = new Weapon({
      camera: this.camera,
      input: this.input,
      controller: this.controller,
      hud: this.hud,
      sfx: this.sfx,
      getWorld: () => this.scene,
      getWind: () => this.wind,
      getFocus: () => this.focus,
      // Plates and balloons both, so a missed balloon gets called too.
      getTargets: () => (this.range ? [...this.range.targets, ...this.range.balloons] : []),
    });
    this.campfires = new CampfireSystem(
      this.scene, this.sfx, this.interactions,
      (fire) => this.openCampfireMenu(fire)
    );
    this.level = new Level({
      scene: this.scene, grid: this.grid, interactions: this.interactions,
      inventory: this.inventory, weapon: this.weapon, stats: this.stats,
      hud: this.hud, sfx: this.sfx,
      takenPickups: new Set(this.pendingSave?.takenPickups ?? []),
      firewoodSpots,
      treeSpots,
    });

    this.kills = 0;
    this.wolves = this.level.wolfSpawns.map(
      (p) => new Wolf(this.scene, p, { onKilled: () => { this.kills++; } })
    );

    // --- discrete actions ---
    this.input.onPress('KeyF', () => this.eatRation());
    this.input.onPress('KeyT', () => {
      if (this.state !== 'playing') return;
      this.campfires.tryBuild(this.controller, this.inventory, this.hud);
    });
    // Sleeping (and now cooking) happens through the campfire's own E-menu
    // (see openCampfireMenu) rather than a standalone key.

    this.stats.onDamaged = () => this.hud.damageFlash();

    // One wind, read by the bullet solver, the grass shader and the HUD
    // gauge alike — so what the gauge shows is literally what pushes the
    // bullet, and a player who learns to read it is actually right.
    this.wind = new Wind();
    this.focus = new Focus({ input: this.input });
    this.range = new Range({
      scene: this.scene, hud: this.hud, sfx: this.sfx,
      interactions: this.interactions, weapon: this.weapon,
    });

    this.killcam = new KillCam({
      camera: this.camera, scene: this.scene, hud: this.hud,
      // Weapon hides its own viewmodels and scope overlay while the camera
      // isn't the player's — pushed rather than polled so there's no frame
      // where the rifle hangs in mid-air in third person.
      onChange: (active) => { this.weapon.cinematic = active; },
    });
    this.weapon.onSpecialShot = (shot) => {
      if (this.state !== 'playing') return;
      this.killcam.start(shot, this.controller.position);
    };

    // --- meta state ---
    this.state = 'loading';
    this.elapsed = 0;
    this.saveTimer = 30;
    this.warnCooldowns = new Map();

    // Hold the start screen behind real asset readiness — every GLTF
    // requested during construction above (helicopter, rifle, wood pile,
    // fps hands, tree_assets) is tracked in core/assets.js. Without this,
    // "click to begin" was available instantly, so a slow connection (or a
    // broken deploy where assets 404) meant playing against placeholder
    // boxes with no trees, forever, with no indication anything was wrong.
    // Raced against a timeout so one hung/never-settling request can't
    // block the game forever either.
    const timeout = new Promise((resolve) => setTimeout(resolve, 20000));
    Promise.race([allAssetsSettled(), timeout]).then((result) => {
      const failed = Array.isArray(result) ? result.filter((r) => r.status === 'rejected').length : 0;
      const { loaded, total } = loadProgress();
      if (failed > 0) {
        console.error(`${failed} asset(s) failed to load — see errors above. Continuing with placeholders.`);
        this.hud.toast('Some assets failed to load — check your connection.', 6000);
      } else if (loaded < total) {
        console.error(`Gave up waiting on ${total - loaded} asset(s) after 20s — continuing with placeholders.`);
        this.hud.toast('Some assets are taking too long to load — continuing anyway.', 6000);
      }
      this.state = 'start';
      this.hud.hideLoading();
      this.hud.showStart({
        hasSave: !!this.pendingSave,
        onBegin: () => {
          this.sfx.resume();
          this.input.lock();
          this.state = 'playing';
          this.hud.toast('The range is west of the wreck. Watch the wind.', 6000);
        },
        onContinue: () => {
          this.sfx.resume();
          this.input.lock();
          this.applySave(this.pendingSave);
          this.state = 'playing';
          this.hud.toast('Welcome back.');
        },
        onNewGame: () => {
          clearSave();
          location.reload();
        },
      });
    });

    this.input.onLockChange((locked) => {
      if (!locked && this.state === 'playing') {
        // Pausing cancels the cinematic. Otherwise the world stops while the
        // kill cam waits on a bullet that can no longer move, and it hangs
        // letterboxed forever.
        this.killcam.stop();
        this.state = 'paused';
        this.hud.showPause(true, () => this.input.lock());
      } else if (locked && this.state === 'paused') {
        this.state = 'playing';
        this.hud.showPause(false);
      }
    });

    // Safety net for a lost pointer lock. Browsers refuse to re-lock for a
    // moment after Escape, so a level switch made straight from the pause
    // menu can land in 'playing' with the mouse still free and no visible
    // way back in. A click on the canvas always re-arms it.
    this.renderer.domElement.addEventListener('click', () => {
      if (this.state === 'playing' && !this.input.pointerLocked) this.input.lock();
    });

    // Prime lighting/sky so the start-screen backdrop isn't black.
    this.env.update(0, this.controller.position);

    // --- main loop ---
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  frame() {
    // Real elapsed time drives the kill cam's own choreography; everything
    // in the world runs on the scaled clock, which is what slow motion is.
    const real = Math.min(0.05, this.clock.getDelta());

    // Two systems can slow the world. The kill cam outranks focus: it has
    // taken the camera away, and letting a held breath stretch a cinematic
    // as well would compound two slowdowns into a crawl.
    const scoped = this.state === 'playing' && !this.killcam.active && this.weapon.scopeView;
    this.focus.update(real, scoped);
    this.controller.blockSprint = this.weapon.scopeView;
    this.hud.setFocus(this.focus);

    const dt = real * (this.killcam.active ? this.killcam.timeScale : this.focus.timeScale);
    if (this.state === 'playing') this.update(dt);
    if (this.state === 'loading') this.hud.setLoadingProgress(loadProgress());

    // Ambient animation keeps running on menus, so the start screen has a
    // living world behind it rather than a freeze-frame.
    this.wind.update(dt);
    this.level.update(dt, this.env, this.controller.position);
    // The run clock is paused with the game but never scaled by focus.
    this.range.update(dt, this.wind, this.state === 'playing' ? real : 0);
    updateVegetation(dt, this.camera.position, this.wind);
    // After every other camera write, so nothing fights it for control.
    this.killcam.update(real);
    this.perf.update(real);
    this.renderer.render(this.scene, this.camera);
  }

  update(dt) {
    this.elapsed += dt;

    // Quest beats used to be the save trigger. With them gone, save on a
    // timer instead — otherwise a session would never persist at all.
    this.saveTimer -= dt;
    if (this.saveTimer <= 0) {
      this.saveTimer = 30;
      this.save();
    }

    // During the kill cam the player is a spectator: the round and the world
    // keep moving (slowly), but nothing that would let them act or come to
    // harm while they can't see their own view.
    if (this.killcam.active) {
      this.input.consumeMouseDelta(); // or a scene's worth of look lands in one jolt
      this.weapon.update(dt);
      // Wolves keep running so the ragdoll a headshot causes actually plays
      // out in slow motion — that hit is the whole reason for the camera.
      for (const w of this.wolves) w.update(dt, this.wolfCtx());
      return;
    }

    this.env.update(dt, this.controller.position);
    this.controller.update(dt);
    this.weapon.update(dt);
    this.campfires.update(dt, this.controller.position, this.hud);
    this.stats.update(dt, {
      daylight: this.env.daylight,
      nearFire: this.campfires.nearFire,
      sprinting: this.controller.isSprinting,
      altitude: this.controller.position.y,
    });

    const ctx = this.wolfCtx();
    for (const w of this.wolves) w.update(dt, ctx);

    this.interactions.update(this.controller.position);

    // --- HUD ---
    this.hud.setStats(this.stats);
    this.hud.setAmmo(this.weapon.magAmmo, this.weapon.reserveAmmo, this.weapon.equipped === 'rifle');
    this.hud.setCounts(this.inventory);
    this.hud.setClock(this.env.day, this.env.timeString());
    const headingDeg = ((-this.controller.yaw * 180) / Math.PI % 360 + 360) % 360;
    this.hud.setCompass(this.inventory.hasCompass ? headingDeg : null);
    this.hud.setWind(this.wind, this.controller.yaw);
    this.hud.setColdOverlay(clamp((30 - this.stats.warmth) / 30, 0, 1));
    this.hud.setHealthPulse(this.stats.health < 25);

    // --- survival warnings (throttled) ---
    this.warn('freeze', this.stats.warmth < 25, 'You are freezing. Build a campfire (T) — you need 3 wood.');
    this.warn('thirst', this.stats.thirst < 20, 'Your throat is parched. Find water.');
    this.warn('hunger', this.stats.hunger < 20, 'Your stomach cramps with hunger. Eat a ration (F).');
    this.warn('energy', this.stats.energy < 15, 'You are exhausted. Rest at a campfire (E) after dark.');
    this.warn('night', this.env.isNight, 'Night has fallen. The cold gets worse — and the dark feels wrong.', 200);

    // --- terminal states ---
    if (!this.stats.alive) this.gameOver();
    else if (this.controller.position.distanceTo(this.level.checkpoint) < 5) this.finish();
  }



  /** Shared context handed to every wolf each frame. */
  wolfCtx() {
    const stealthMult = this.controller.stance === 'prone' ? CONFIG.wolf.proneDetectMult
      : this.controller.stance === 'crouch' ? CONFIG.wolf.crouchDetectMult
      : 1;
    return {
      playerPos: this.controller.position,
      stats: this.stats,
      env: this.env,
      sfx: this.sfx,
      hud: this.hud,
      stealthMult,
    };
  }

  warn(key, condition, message, cooldownSec = 45) {
    if (!condition) return;
    const until = this.warnCooldowns.get(key) || 0;
    if (this.elapsed < until) return;
    this.warnCooldowns.set(key, this.elapsed + cooldownSec);
    this.hud.toast(message, 5000);
  }

  eatRation() {
    if (this.state !== 'playing') return;
    if (this.inventory.rations <= 0) {
      this.hud.toast('No rations left.');
      return;
    }
    this.inventory.rations--;
    this.stats.eat();
    this.sfx.eat();
    this.hud.toast('You eat a ration. A little strength returns.');
  }

  /** Opens the pizza-slice cook/sleep menu for a specific lit campfire.
   *  Pointer lock is released for the duration (the menu is a normal
   *  clickable HTML overlay, same as the pause screen) and re-acquired
   *  once the player picks an option or cancels. `state = 'menu'` keeps
   *  the lock-change handler from mistaking this for the pause screen. */
  async openCampfireMenu(fire) {
    if (this.state !== 'playing') return;
    const canCook = this.inventory.rations > 0;
    const canSleep = this.env.daylight <= 0.5;

    this.state = 'menu';
    document.exitPointerLock();
    const key = await this.hud.showRadialMenu([
      { key: 'cook', label: canCook ? 'Cook' : 'Cook (no rations)', enabled: canCook },
      { key: 'sleep', label: canSleep ? 'Sleep' : 'Sleep (too bright)', enabled: canSleep },
    ]);
    this.state = 'playing';
    this.input.lock();

    if (key === 'cook') this.cookAtFire();
    else if (key === 'sleep') await this.sleepAtFire(fire);
  }

  cookAtFire() {
    if (this.inventory.rations <= 0) {
      this.hud.toast('No rations left to cook.');
      return;
    }
    this.inventory.rations--;
    this.stats.cookedMeal();
    this.sfx.eat();
    this.hud.toast('You cook and eat a ration over the fire — hot food, real warmth.');
  }

  async sleepAtFire(fire) {
    if (this.env.daylight > 0.5) {
      this.hud.toast('It is too bright to sleep. Wait for evening.');
      return;
    }
    this.state = 'sleeping';
    await this.hud.fade(true);
    this.env.skipToMorning();
    this.stats.applySleep();
    fire.fuel = Math.min(fire.fuel, 30); // burns down to embers overnight
    this.env.update(0.001, this.controller.position); // refresh lighting before reveal
    await this.hud.fade(false);
    this.state = 'playing';
    this.hud.toast('You wake at first light, stiff and cold — but rested.');
  }

  gameOver() {
    this.state = 'dead';
    document.exitPointerLock();
    clearSave(); // a dead run shouldn't be "continued"
    this.hud.showDeath({
      cause: this.stats.lastCause,
      day: this.env.day,
      minutes: Math.round(this.elapsed / 60),
      kills: this.kills,
    });
  }

  finish() {
    this.state = 'finished';
    document.exitPointerLock();
    clearSave(); // the slice is over — nothing left to continue into
    this.hud.showEnd({
      day: this.env.day,
      minutes: Math.round(this.elapsed / 60),
      kills: this.kills,
    });
  }

  /** Called at each quest beat (see Level.js's onQuestAdvance) — captures
   *  everything needed to resume roughly where the player left off. */
  save() {
    saveGame({
      takenPickups: [...this.level.takenPickups],
      day: this.env.day,
      time: this.env.time,
      elapsed: this.elapsed,
      kills: this.kills,
      score: this.range.score,
      rangeKnocked: this.range.knockedDistances,
      rangePopped: this.range.poppedBalloons,
      player: {
        x: this.controller.position.x,
        y: this.controller.position.y,
        z: this.controller.position.z,
        yaw: this.controller.yaw,
        pitch: this.controller.pitch,
      },
      stats: {
        health: this.stats.health,
        hunger: this.stats.hunger,
        thirst: this.stats.thirst,
        warmth: this.stats.warmth,
        energy: this.stats.energy,
      },
      inventory: { ...this.inventory },
      weapon: {
        equipped: this.weapon.equipped,
        magAmmo: this.weapon.magAmmo,
        reserveAmmo: this.weapon.reserveAmmo,
      },
      campfires: this.campfires.fires
        .filter((f) => f.fuel > 0)
        .map((f) => ({ x: f.pos.x, z: f.pos.z, fuel: f.fuel })),
    });
  }

  /** Restores state saved by save() — called from the start screen's
   *  "Continue" choice. Level/its pickups are already correct by this point
   *  (takenPickups was applied at construction, before the start screen). */
  applySave(data) {
    this.controller.position.set(data.player.x, data.player.y, data.player.z);
    this.controller.smoothY = data.player.y;
    this.controller.yaw = data.player.yaw;
    this.controller.pitch = data.player.pitch;

    Object.assign(this.stats, data.stats);
    Object.assign(this.inventory, data.inventory);

    if (this.inventory.hasRifle) this.weapon.giveRifle();
    if (this.inventory.hasBinoculars) this.weapon.giveBinoculars();
    this.weapon.magAmmo = data.weapon.magAmmo;
    this.weapon.reserveAmmo = data.weapon.reserveAmmo;
    this.weapon.equip(data.weapon.equipped);

    this.env.day = data.day;
    this.env.time = data.time;
    this.env.update(0.001, this.controller.position); // refresh lighting before the reveal

    this.elapsed = data.elapsed;
    this.kills = data.kills;
    if (data.score) { this.range.score = data.score; this.hud.setScore(data.score, 0); }
    this.range.restore(data.rangeKnocked ?? []);
    this.range.restoreBalloons(data.rangePopped ?? []);


    for (const f of data.campfires) this.campfires.rebuild(f.x, f.z, f.fuel, this.hud);
  }
}
