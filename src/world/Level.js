import * as THREE from 'three';
import {
  terrainHeight, hash2, POND, POND_RADIUS, POND_WATER_Y, CHECKPOINT,
  SPAWN_CLEARING_RADIUS,
} from './heightfield.js';
import { makeGlowSprite } from '../core/glow.js';
import { makeSmokeSprite } from '../core/particleTextures.js';
import { loadGLTF, normalizeModel } from '../core/assets.js';
import { loadTreeAssets } from './TreeAssets.js';
import { wolfSpawnPoints } from '../entities/Wolf.js';
import { createWaterSurface, updateWaterSurface, createShoreBlend } from './Water.js';
import helicopterUrl from '../assets/models/helicopter_crashed.glb?url';
import rifleUrl from '../assets/models/rifle.glb?url';
import woodPileUrl from '../assets/models/wood_pile.glb?url';

const BASE_LAKE_TREE_HEIGHT = 7; // slightly taller than the ambient forest for a set-piece feel

// The crashed helicopter sits in the spawn clearing — the one hand-placed
// landmark in an otherwise fully procedural world, and the reason the
// player is out here at all.
const HELICOPTER = {
  x: -3, z: 3,
  size: 11,        // target longest bounding-box dimension, world units
  yaw: 0.9,        // facing, radians
  tiltX: 0.06,     // came down hard, resting crooked
  tiltZ: 0.12,
  yOffset: 0,      // manual ground clearance tweak after normalization
};

// Hand-placed content on top of the procedural wilderness: the crash site
// and starting loadout in the spawn clearing, firewood scattered through
// the woods, the lake, and the ridge overlook that ends the slice.

export class Level {
  /** @param takenPickups Set of pickup ids to skip entirely (restoring a save
   *   — those items were already collected in a previous session).
   *  @param onQuestAdvance(stage) called right after questStage changes —
   *   Game.js uses this to autosave at each quest beat. */
  constructor({ scene, grid, interactions, inventory, weapon, stats, hud, sfx, takenPickups, onQuestAdvance, firewoodSpots }) {
    this.scene = scene;
    this.grid = grid;
    this.interactions = interactions;
    this.inventory = inventory;
    this.weapon = weapon;
    this.stats = stats;
    this.hud = hud;
    this.sfx = sfx;
    this.takenPickups = takenPickups || new Set();
    this.onQuestAdvance = onQuestAdvance || (() => {});
    this.firewoodSpots = firewoodSpots || [];

    this.t = 0;
    this.pickupSprites = [];
    this.smoke = [];

    // Quest chain: 1 find water -> 2 build a campfire -> 3 sleep -> 4 done.
    // Each _completeX/notifyX advances the stage and stages the next
    // objective text a few seconds later so the player has time to read
    // the completion line before it's replaced.
    this.questStage = 1;

    this._buildHelicopter();
    this._placeStartingLoadout();
    this._placeWood();
    this._buildPond();
    this._buildCheckpoint();

    // Wolf territory is the lake — see Wolf.js's wolfSpawnPoints for why.
    this.wolfSpawns = wolfSpawnPoints(POND);
    this.checkpoint = new THREE.Vector3(
      CHECKPOINT.x, terrainHeight(CHECKPOINT.x, CHECKPOINT.z), CHECKPOINT.z
    );
  }

  _groundY(x, z) {
    return terrainHeight(x, z);
  }

  // ------------------------------------------------------------ helicopter
  _buildHelicopter() {
    const hx = HELICOPTER.x, hz = HELICOPTER.z;
    const groundY = this._groundY(hx, hz);

    // Scorched ground under the wreck (synchronous — independent of the model).
    const scorch = new THREE.Mesh(
      new THREE.CircleGeometry(6, 24),
      new THREE.MeshStandardMaterial({ color: 0x181410, roughness: 1 })
    );
    scorch.rotation.x = -Math.PI / 2;
    scorch.position.set(hx, groundY + 0.04, hz);
    scorch.receiveShadow = true;
    this.scene.add(scorch);

    // Load the crashed-helicopter model asynchronously. A neutral placeholder
    // keeps the clearing from looking empty on the first frame; it's swapped
    // out once the GLB resolves.
    const placeholder = new THREE.Mesh(
      new THREE.BoxGeometry(6, 2, 2),
      new THREE.MeshStandardMaterial({ color: 0x3a4030, roughness: 0.9 })
    );
    placeholder.position.set(hx, groundY + 1, hz);
    placeholder.rotation.y = HELICOPTER.yaw;
    placeholder.castShadow = true;
    this.scene.add(placeholder);

    loadGLTF(helicopterUrl)
      .then((gltf) => {
        const model = normalizeModel(gltf.scene.clone(true), HELICOPTER.size);
        model.position.set(hx, groundY + HELICOPTER.yOffset, hz);
        model.rotation.set(HELICOPTER.tiltX, HELICOPTER.yaw, HELICOPTER.tiltZ);
        this.scene.add(model);
        this.scene.remove(placeholder);
        this.helicopter = model;
      })
      .catch((err) => {
        console.error('Failed to load helicopter model:', err);
        // Placeholder stays as a graceful fallback.
      });

    // Smoke still rising from the wreck (synchronous).
    for (let i = 0; i < 10; i++) {
      const s = makeSmokeSprite(0x2a2a2a, 1.7, 0.28);
      s.userData.phase = i / 10;
      s.position.set(hx + 0.4, 0, hz);
      this.scene.add(s);
      this.smoke.push(s);
    }
    this.smokeBaseY = groundY + 2.3;
    this.smokeX = hx + 0.4;
    this.smokeZ = hz;

    // A dying flare's light, raking up the fuselage — no visible prop.
    const fx = hx + 2.6, fz = hz + 1.4;
    this.flareLight = new THREE.PointLight(0xff2010, 6, 45, 1.8);
    this.flareLight.position.set(fx, this._groundY(fx, fz) + 1.2, fz);
    this.scene.add(this.flareLight);

    // Collision footprint (independent of the mesh — always present).
    this.grid.insert(hx, hz, 2.4);
    this.grid.insert(hx - 3.5, hz + 0.8, 1.2);
    this.grid.insert(hx + 2.2, hz - 1.2, 1.4);
  }

  // --------------------------------------------------------------- pickups
  /** @param opts.id stable string identifying this pickup across a save/load —
   *   if it's already in takenPickups (restoring a save), skip it entirely. */
  _addPickup(mesh, x, z, label, onTake, { yOffset = 0.15, glowColor = 0xffe9a0, id } = {}) {
    if (id && this.takenPickups.has(id)) return;

    const y = this._groundY(x, z) + yOffset;
    mesh.position.set(x, y, z);
    mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const glow = makeGlowSprite(glowColor, 0.9, 0.28);
    glow.position.y = 0.25;
    mesh.add(glow);
    this.pickupSprites.push(glow);
    this.scene.add(mesh);

    this.interactions.add({
      position: new THREE.Vector3(x, y, z),
      radius: 2.6,
      label,
      onUse: (entry) => {
        // Marked taken before onTake() runs: onTake can synchronously
        // advance the quest, which autosaves — the save must already see
        // this pickup as collected.
        if (id) this.takenPickups.add(id);
        onTake();
        this.sfx.pickup();
        this.scene.remove(mesh);
        entry.disabled = true;
      },
    });
  }

  _makeRifleProp() {
    // Same GLB as the held viewmodel, laid on the ground at pickup scale.
    const g = new THREE.Group();
    g.rotation.set(0, 0.9, 0);
    loadGLTF(rifleUrl)
      .then((gltf) => {
        const model = normalizeModel(gltf.scene.clone(true), 1.15, { ground: false });
        model.rotation.set(0, Math.PI / 2, 0); // lying flat, barrel along X
        g.add(model);
      })
      .catch((err) => console.error('Failed to load rifle pickup model:', err));
    return g;
  }

  /** Everything salvageable from the crash, scattered around the wreck. */
  _placeStartingLoadout() {
    const inv = this.inventory;
    const hud = this.hud;

    this._addPickup(
      this._makeRifleProp(), 2.6, 4.4,
      'Take hunting rifle (loaded)',
      () => {
        inv.hasRifle = true;
        this.weapon.giveRifle();
        hud.toast('Rifle equipped — LMB fire, RMB aim, R reload, 1 to holster.');
      },
      { id: 'rifle' }
    );

    const magBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.14, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x3a4030, roughness: 0.8 })
    );
    this._addPickup(magBox, 4.2, 2.1, 'Take rifle magazines (+10 rounds)',
      () => this.weapon.addAmmo(10), { id: 'ammo' });

    const compass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.05, 12),
      new THREE.MeshStandardMaterial({ color: 0xb8952f, roughness: 0.4, metalness: 0.7 })
    );
    this._addPickup(compass, -1.4, 5.2, 'Take compass', () => {
      inv.hasCompass = true;
      hud.toast('Compass acquired. Get your bearings.');
    }, { id: 'compass' });

    const binoc = new THREE.Group();
    const tubeMat = new THREE.MeshStandardMaterial({ color: 0x1e1f22, roughness: 0.6 });
    for (const off of [-0.06, 0.06]) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.18, 8), tubeMat);
      tube.position.x = off;
      binoc.add(tube);
    }
    this._addPickup(binoc, -5.2, 1.4, 'Take binoculars', () => {
      inv.hasBinoculars = true;
      this.weapon.giveBinoculars();
      hud.toast('Binoculars acquired — press 2, hold RMB to scan ahead.');
    }, { id: 'binoculars' });

    const rationBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.22, 0.25),
      new THREE.MeshStandardMaterial({ color: 0x7a2e22, roughness: 0.8 })
    );
    this._addPickup(rationBox, 0.9, 6.2, 'Take ration pack (+3 rations)', () => {
      inv.rations += 3;
      hud.toast('Rations stowed. Press F to eat one.');
    }, { id: 'rations' });
  }

  // ------------------------------------------------------------------ quest
  /** Called by the lake's drink interaction the first time the player uses it. */
  _completeWaterQuest() {
    if (this.questStage !== 1) return;
    this.questStage = 2;
    this.hud.setObjective('Found water', true);
    this.hud.toast('Something moved in the treeline across the water.', 6000);
    setTimeout(() => {
      this.hud.setObjective('Build a campfire');
      this.hud.toast('You should get a fire going before the cold gets worse.', 5500);
    }, 4000);
    this.onQuestAdvance(this.questStage);
  }

  /** Called by Game.js right after a campfire is successfully built. */
  notifyCampfireBuilt() {
    if (this.questStage !== 2) return;
    this.questStage = 3;
    this.hud.setObjective('Camp made — settle in for the night', true);
    setTimeout(() => {
      this.hud.setObjective('Sleep until morning');
      this.hud.toast('Press E at the campfire to cook or sleep until dawn.', 5500);
    }, 3500);
    this.onQuestAdvance(this.questStage);
  }

  /** Called by Game.js right after the player sleeps through to dawn. */
  notifySlept() {
    if (this.questStage !== 3) return;
    this.questStage = 4;
    this.hud.setObjective('Rested until dawn', true);
    this.onQuestAdvance(this.questStage);
  }

  /** The stable resting objective text for a given quest stage — used to
   *  restore the HUD objective when loading a save (the setTimeout-staged
   *  transition text above only plays out once, live). */
  static objectiveForStage(stage) {
    switch (stage) {
      case 1: return { text: 'Find water', complete: false };
      case 2: return { text: 'Build a campfire', complete: false };
      case 3: return { text: 'Sleep until morning', complete: false };
      default: return { text: 'Rested until dawn', complete: true };
    }
  }

  // ------------------------------------------------------------------- wood
  /**
   * Fallen branches at the foot of every fifth tree (spots come from
   * Vegetation.js, so they genuinely sit under trees rather than being
   * scattered independently).
   *
   * There are a couple of hundred of these, which is far too many to build
   * the way the handful of crash-site pickups are built: a Group per pile
   * would mean ~3 draw calls each plus a glow sprite, i.e. close to a
   * thousand draw calls for firewood alone. Instead every pile shares one
   * InstancedMesh per sub-mesh of the GLB (3 draw calls total), and
   * "removing" a collected pile means zeroing that instance's matrix. They
   * also skip the glow sprite the loot pickups use — the [E] prompt is
   * discovery enough for something this common, and 250 more sprites would
   * put the draw calls straight back.
   */
  _placeWood() {
    const live = (this.firewoodSpots || [])
      .map((s, i) => ({ ...s, id: `wood${i}` }))
      .filter((s) => !this.takenPickups.has(s.id));
    if (live.length === 0) return;

    this.woodParts = []; // InstancedMeshes, once the GLB resolves
    const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

    loadGLTF(woodPileUrl)
      .then((gltf) => {
        const proto = normalizeModel(gltf.scene.clone(true), 1.2);
        proto.updateMatrixWorld(true);

        const dummy = new THREE.Object3D();
        proto.traverse((o) => {
          if (!o.isMesh) return;
          // The mesh's transform *within* the normalized wrapper has to be
          // folded into each instance matrix, since the InstancedMesh sits
          // at the scene root with no parent transform of its own.
          const local = o.matrixWorld.clone();
          const inst = new THREE.InstancedMesh(o.geometry, o.material, live.length);
          live.forEach((s, i) => {
            dummy.position.set(s.x, s.y, s.z);
            dummy.rotation.set(0, s.rot, 0);
            dummy.updateMatrix();
            inst.setMatrixAt(i, dummy.matrix.clone().multiply(local));
          });
          inst.instanceMatrix.needsUpdate = true;
          inst.castShadow = true;
          inst.receiveShadow = true;
          this.scene.add(inst);
          this.woodParts.push(inst);
        });
      })
      .catch((err) => console.error('Failed to load wood pile model:', err));

    // Interactions register immediately — gathering never waits on the GLB.
    live.forEach((s, i) => {
      this.interactions.add({
        position: new THREE.Vector3(s.x, s.y, s.z),
        radius: 2.4,
        label: 'Gather firewood (+2 wood)',
        onUse: (entry) => {
          this.takenPickups.add(s.id);
          this.inventory.wood += 2;
          this.sfx.pickup();
          entry.disabled = true;
          for (const part of this.woodParts) {
            part.setMatrixAt(i, ZERO);
            part.instanceMatrix.needsUpdate = true;
          }
        },
      });
    });
  }

  // ------------------------------------------------------------------ lake
  _buildPond() {
    // POND_RADIUS is exactly where the analytic lake bed crosses
    // POND_WATER_Y (see heightfield.js), so the water plane's edge meets
    // the shore precisely — no floating rim, no water spilling over dry
    // ground, in any direction.
    this.water = createWaterSurface({
      x: POND.x, z: POND.z, waterY: POND_WATER_Y, flatRadius: POND_RADIUS,
    });
    this.scene.add(this.water);

    // Damp ground fading out from the waterline, so the shore reads as
    // shore rather than as a hard edge where two meshes happen to meet.
    this.scene.add(createShoreBlend({
      x: POND.x, z: POND.z, innerRadius: POND_RADIUS - 0.5, outerRadius: POND_RADIUS + 9,
    }));

    // Solid — walking "into" the lake used to just walk you along the lake
    // bed underneath the water plane. Simplest fix: you can't. Stops a
    // little short of the waterline so the player can stand on wet sand.
    this.grid.insert(POND.x, POND.z, POND_RADIUS - 1.2);

    loadTreeAssets()
      .then((assets) => this._buildLakeTrees(assets))
      .catch((err) => console.error('Failed to load lake treeline assets:', err));

    // Drink spot on the shore facing spawn, so the player meets the lake
    // (and the wolves) from the side they'll approach from.
    const toSpawn = Math.atan2(-POND.z, -POND.x);
    const rimX = POND.x + Math.cos(toSpawn) * (POND_RADIUS - 1.5);
    const rimZ = POND.z + Math.sin(toSpawn) * (POND_RADIUS - 1.5);
    this.interactions.add({
      position: new THREE.Vector3(rimX, this._groundY(rimX, rimZ), rimZ),
      radius: 3.6,
      label: 'Drink from the lake',
      onUse: () => {
        this.stats.drink();
        this.sfx.drink();
        this.hud.toast('You drink deeply. The water is ice-cold and clean.');
        this._completeWaterQuest();
      },
    });
  }

  /** A curated treeline around the lake shore — denser and more deliberate
   *  than the ambient procedural forest, to read as a set-piece "lake area".
   *  Reuses the same big/small/dead species as the ambient forest (see
   *  TreeAssets.js), just placed by hand in two staggered bands. The shore
   *  the player walks up to drink from is left clear. */
  _buildLakeTrees(assets) {
    const approachAngle = Math.atan2(-POND.z, -POND.x); // lake -> spawn
    const approachHalfWidth = 0.75;
    const bands = [
      { radiusMul: 1.12, count: 16, heightMul: 1.0, salt: 40 },
      { radiusMul: 1.34, count: 16, heightMul: 1.15, salt: 60 },
    ];

    for (const band of bands) {
      for (let i = 0; i < band.count; i++) {
        const angle = (i / band.count) * Math.PI * 2 + hash2(i, band.salt, 1) * 0.4;
        const da = Math.atan2(Math.sin(angle - approachAngle), Math.cos(angle - approachAngle));
        if (Math.abs(da) < approachHalfWidth) continue; // keep the approach shore clear

        const roll = hash2(i, band.salt, 2);
        const speciesName = roll < 0.08 ? 'dead' : roll < 0.55 ? 'small' : 'big';
        const species = assets[speciesName];

        const r = POND_RADIUS * band.radiusMul + 2 + hash2(i, band.salt, 3) * 2.5;
        const x = POND.x + Math.cos(angle) * r;
        const z = POND.z + Math.sin(angle) * r;
        const y = this._groundY(x, z);
        const heightVar = 0.85 + hash2(i, band.salt, 4) * 0.4;
        const scale = (BASE_LAKE_TREE_HEIGHT * band.heightMul * heightVar) / species.naturalHeight;
        const rotY = hash2(i, band.salt, 5) * Math.PI * 2;

        // Plain mesh transform properties, NOT applyMatrix4 — the bark/leaves
        // geometries are shared with the ambient forest's InstancedMesh, and
        // applyMatrix4 bakes the transform into the geometry itself, which
        // would corrupt every other user of that same geometry.
        const bark = new THREE.Mesh(species.barkGeo, species.barkMat);
        bark.position.set(x, y, z);
        bark.rotation.y = rotY;
        bark.scale.setScalar(scale);
        bark.castShadow = true;
        bark.receiveShadow = true;
        this.scene.add(bark);

        if (species.leavesGeo) {
          const leaves = new THREE.Mesh(species.leavesGeo, species.leavesMat);
          leaves.position.copy(bark.position);
          leaves.rotation.y = rotY;
          leaves.scale.setScalar(scale);
          leaves.castShadow = true;
          this.scene.add(leaves);
        }

        this.grid.insert(x, z, 0.55);
      }
    }
  }

  // ------------------------------------------------------------ checkpoint
  /** A marker on the far ridge — reaching it ends the slice. */
  _buildCheckpoint() {
    const x = CHECKPOINT.x, z = CHECKPOINT.z;
    const y = this._groundY(x, z);
    const g = new THREE.Group();
    g.position.set(x, y, z);

    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 3.2, 6),
      new THREE.MeshStandardMaterial({ color: 0x54432c, roughness: 1 })
    );
    post.position.y = 1.6;
    post.castShadow = true;

    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.7),
      new THREE.MeshStandardMaterial({ color: 0xe06a2a, roughness: 0.9, side: THREE.DoubleSide })
    );
    flag.position.set(0.55, 2.7, 0);
    this.flag = flag;

    const beacon = makeGlowSprite(0xff6d3a, 4, 0.5);
    beacon.position.y = 2.8;
    beacon.material.fog = false; // must stay visible across the whole basin
    const light = new THREE.PointLight(0xff6d3a, 3, 30, 2);
    light.position.y = 2.8;

    g.add(post, flag, beacon, light);
    this.scene.add(g);
    this.grid.insert(x, z, 0.4);
  }

  // ---------------------------------------------------------------- update
  /** @param sun Environment's directional light (sun by day, moon by night)
   *   — keeps the lake's specular highlight tracking wherever it actually is. */
  update(dt, sun) {
    this.t += dt;

    if (this.water && sun) updateWaterSurface(this.water, dt, sun);

    // pickup glow pulse
    const pulse = 0.24 + Math.sin(this.t * 2.5) * 0.1;
    for (const s of this.pickupSprites) s.material.opacity = pulse;

    // wreck smoke: sprites loop upward, fading out
    for (const s of this.smoke) {
      const cycle = (this.t * 0.12 + s.userData.phase) % 1;
      s.position.set(
        this.smokeX + Math.sin(cycle * 9 + s.userData.phase * 20) * 0.6,
        this.smokeBaseY + cycle * 7,
        this.smokeZ + Math.cos(cycle * 7) * 0.4
      );
      s.material.opacity = 0.22 * (1 - cycle);
      s.scale.setScalar(1.2 + cycle * 3);
    }

    // checkpoint flag wave
    if (this.flag) this.flag.rotation.y = Math.sin(this.t * 2.2) * 0.35;

    // crash-site flare light: gentle, steady flicker
    if (this.flareLight) {
      const flicker = Math.sin(this.t * 9) * 0.12 + Math.sin(this.t * 22 + 1.3) * 0.06;
      this.flareLight.intensity = 6 + flicker;
    }
  }
}
