import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Input } from './Input.js';
import { SFX } from './sfx.js';
import { SpatialGrid } from './SpatialGrid.js';
import { createTerrain } from '../world/Terrain.js';
import { scatterVegetation } from '../world/Vegetation.js';
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
import { clamp } from '../world/heightfield.js';
import { saveGame, loadGame, clearSave } from './save.js';
import { allAssetsSettled, loadProgress } from './assets.js';

// Orchestrator: owns the renderer/scene/camera and every game system,
// drives the fixed update -> render loop, and handles the meta state
// machine: start -> playing <-> paused / sleeping -> dead | finished.

export class Game {
  constructor(container) {
    // --- renderer / scene / camera ---
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      70, window.innerWidth / window.innerHeight, 0.08, 900
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
    scatterVegetation(this.scene, this.grid);
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
      onQuestAdvance: () => this.save(),
    });

    this.kills = 0;
    this.wolves = this.level.wolfSpawns.map(
      (p) => new Wolf(this.scene, p, { onKilled: () => { this.kills++; } })
    );

    // --- discrete actions ---
    this.input.onPress('KeyF', () => this.eatRation());
    this.input.onPress('KeyT', () => {
      if (this.state !== 'playing') return;
      if (this.campfires.tryBuild(this.controller, this.inventory, this.hud)) {
        this.level.notifyCampfireBuilt();
      }
    });
    // Sleeping (and now cooking) happens through the campfire's own E-menu
    // (see openCampfireMenu) rather than a standalone key.

    this.stats.onDamaged = () => this.hud.damageFlash();

    // --- meta state ---
    this.state = 'loading';
    this.elapsed = 0;
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
          this.hud.setObjective('Look for survivors');
          this.hud.toast('Your head pounds. The helicopter still burns behind you.', 5000);
          setTimeout(() => this.hud.toast('No one answers your calls. Search the crash site.', 5000), 4000);
          setTimeout(() => this.hud.toast('Then follow the valley north — into the dark.', 5000), 8500);
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
        this.state = 'paused';
        this.hud.showPause(true, () => this.input.lock());
      } else if (locked && this.state === 'paused') {
        this.state = 'playing';
        this.hud.showPause(false);
      }
    });

    // Prime lighting/sky so the start-screen backdrop isn't black.
    this.env.update(0, this.controller.position);

    // --- main loop ---
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.state === 'playing') this.update(dt);
    if (this.state === 'loading') this.hud.setLoadingProgress(loadProgress());
    this.level.update(dt); // ambient animation keeps running on menus
    this.renderer.render(this.scene, this.camera);
  }

  update(dt) {
    this.elapsed += dt;

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

    const stealthMult = this.controller.stance === 'prone' ? CONFIG.wolf.proneDetectMult
      : this.controller.stance === 'crouch' ? CONFIG.wolf.crouchDetectMult
      : 1;
    const wolfCtx = {
      playerPos: this.controller.position,
      stats: this.stats,
      env: this.env,
      sfx: this.sfx,
      hud: this.hud,
      stealthMult,
    };
    for (const w of this.wolves) w.update(dt, wolfCtx);

    this.interactions.update(this.controller.position);

    // --- HUD ---
    this.hud.setStats(this.stats);
    this.hud.setAmmo(this.weapon.magAmmo, this.weapon.reserveAmmo, this.weapon.equipped === 'rifle');
    this.hud.setCounts(this.inventory);
    this.hud.setClock(this.env.day, this.env.timeString());
    const headingDeg = ((-this.controller.yaw * 180) / Math.PI % 360 + 360) % 360;
    this.hud.setCompass(this.inventory.hasCompass ? headingDeg : null);
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
    this.level.notifySlept();
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
      questStage: this.level.questStage,
      takenPickups: [...this.level.takenPickups],
      day: this.env.day,
      time: this.env.time,
      elapsed: this.elapsed,
      kills: this.kills,
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

    this.level.questStage = data.questStage;
    const { text, complete } = Level.objectiveForStage(data.questStage);
    this.hud.setObjective(text, complete);

    for (const f of data.campfires) this.campfires.rebuild(f.x, f.z, f.fuel, this.hud);
  }
}
