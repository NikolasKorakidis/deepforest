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
      getTargets: () => this.wolves.filter((w) => !w.dead).map((w) => w.group),
    });
    this.campfires = new CampfireSystem(this.scene, this.sfx);
    this.level = new Level({
      scene: this.scene, grid: this.grid, interactions: this.interactions,
      inventory: this.inventory, weapon: this.weapon, stats: this.stats,
      hud: this.hud, sfx: this.sfx,
    });

    this.kills = 0;
    this.wolves = this.level.wolfSpawns.map(
      (p) => new Wolf(this.scene, p, { onKilled: () => { this.kills++; } })
    );

    // --- discrete actions ---
    this.input.onPress('KeyF', () => this.eatRation());
    this.input.onPress('KeyT', () => {
      if (this.state === 'playing') this.campfires.tryBuild(this.controller, this.inventory, this.hud);
    });
    this.input.onPress('KeyG', () => this.trySleep());

    this.stats.onDamaged = () => this.hud.damageFlash();

    // --- meta state ---
    this.state = 'start';
    this.elapsed = 0;
    this.warnCooldowns = new Map();

    this.hud.showStart(() => {
      this.sfx.resume();
      this.input.lock();
      this.state = 'playing';
      this.hud.setObjective('Look for survivors');
      this.hud.toast('Your head pounds. The helicopter still burns behind you.', 5000);
      setTimeout(() => this.hud.toast('No one answers your calls. Search the crash site.', 5000), 4000);
      setTimeout(() => this.hud.toast('Then follow the valley north — into the dark.', 5000), 8500);
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

    const wolfCtx = {
      playerPos: this.controller.position,
      stats: this.stats,
      env: this.env,
      sfx: this.sfx,
      hud: this.hud,
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
    this.warn('energy', this.stats.energy < 15, 'You are exhausted. Sleep at a campfire (G) after dark.');
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

  async trySleep() {
    if (this.state !== 'playing') return;
    if (!this.campfires.nearFire) {
      this.hud.toast('You need to be beside a burning campfire to sleep.');
      return;
    }
    if (this.env.daylight > 0.5) {
      this.hud.toast('It is too bright to sleep. Wait for evening.');
      return;
    }
    this.state = 'sleeping';
    await this.hud.fade(true);
    this.env.skipToMorning();
    this.stats.applySleep();
    this.campfires.consumeForSleep(this.controller.position);
    this.env.update(0.001, this.controller.position); // refresh lighting before reveal
    await this.hud.fade(false);
    this.state = 'playing';
    this.hud.toast('You wake stiff and cold at dawn — but rested.');
  }

  gameOver() {
    this.state = 'dead';
    document.exitPointerLock();
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
    this.hud.showEnd({
      day: this.env.day,
      minutes: Math.round(this.elapsed / 60),
      kills: this.kills,
    });
  }
}
