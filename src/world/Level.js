import * as THREE from 'three';
import {
  terrainHeight, pathX, hash2, POND, POND_RADIUS, POND_WATER_Y, CHECKPOINT,
} from './heightfield.js';
import { makeGlowSprite } from '../core/glow.js';
import { loadGLTF, normalizeModel } from '../core/assets.js';
import { loadTreeAssets } from './TreeAssets.js';
import { createWaterMaterial, updateWaterMaterial } from './Water.js';
import helicopterUrl from '../assets/models/helicopter_crashed.glb?url';
import rifleUrl from '../assets/models/rifle.glb?url';

const BASE_LAKE_TREE_HEIGHT = 7; // slightly taller than the ambient forest for a set-piece feel

// Placement of the crashed helicopter model in the crash clearing.
const HELICOPTER = {
  x: -2, z: -2,
  size: 11,        // target longest bounding-box dimension, world units
  yaw: 0.5,        // facing, radians
  tiltX: 0.06,     // came down hard, resting crooked
  tiltZ: 0.12,
  yOffset: 0,      // manual ground clearance tweak after normalization
};

// A second piece of wreckage, torn off in the crash and thrown clear up
// the valley — between the crash site and the lake. This is where the
// rifle and its ammo ended up; finding it is the "look for survivors"
// quest beat (see _buildWreckage / _completeSurvivorsQuest).
const WRECKAGE = { x: pathX(-34) - 7, z: -34 };

// Hand-placed level content: the helicopter wreck and starting loadout at
// the crash clearing, wood/loot along the path, the pond, and the
// "to be continued" checkpoint at the end of the valley.

export class Level {
  constructor({ scene, grid, interactions, inventory, weapon, stats, hud, sfx }) {
    this.scene = scene;
    this.grid = grid;
    this.interactions = interactions;
    this.inventory = inventory;
    this.weapon = weapon;
    this.stats = stats;
    this.hud = hud;
    this.sfx = sfx;

    this.t = 0;
    this.pickupSprites = [];
    this.smoke = [];

    this._buildHelicopter();
    this._placeStartingLoadout();
    this._buildWreckage();
    this._placeWood();
    this._buildPond();
    this._buildSupplyCrate();
    this._buildSigns();
    this._buildCheckpoint();

    // No wolves on this map — it's a quiet, unsettling valley, not a hunt.
    this.wolfSpawns = [];
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

    // Smoke rising from the wreck (synchronous).
    for (let i = 0; i < 10; i++) {
      const s = makeGlowSprite(0x2a2a2a, 1.7, 0.28, false);
      s.userData.phase = i / 10;
      s.position.set(hx + 0.4, 0, hz);
      this.scene.add(s);
      this.smoke.push(s);
    }
    this.smokeBaseY = groundY + 2.3;
    this.smokeX = hx + 0.4;
    this.smokeZ = hz;

    this._buildFlare(hx, hz, groundY);

    // Collision footprint (independent of the mesh — always present).
    this.grid.insert(hx, hz, 2.4);
    this.grid.insert(hx - 3.5, hz + 0.8, 1.2);
    this.grid.insert(hx + 2.2, hz - 1.2, 1.4);
  }

  /** A signal flare planted upright near the wreck — the only warm, moving
   *  light for a long stretch of dark valley. Burns steadier than an open
   *  fire (gentle flicker, not the wild cone-flame look), throws a bright
   *  red light across the clearing and up the fuselage, and trails smoke.
   *  Reads as both a landmark and a "someone was signaling for help" cue. */
  _buildFlare(hx, hz, groundY) {
    const fx = hx + 2.6, fz = hz + 1.4; // a few units clear of the fuselage
    const fy = this._groundY(fx, fz);

    const group = new THREE.Group();
    group.position.set(fx, fy, fz);
    group.rotation.set(0.22, 2.1, 0.16); // jammed into the ground at a lean

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4a0d0d, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.32, 8), bodyMat);
    body.position.y = 0.16;
    group.add(body);

    const tipMat = new THREE.MeshStandardMaterial({
      color: 0xff2010, emissive: 0xff2010, emissiveIntensity: 2.5, roughness: 0.3,
    });
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), tipMat);
    tip.position.y = 0.34;
    group.add(tip);
    this.flareTipMat = tipMat;

    this.flareGlow = makeGlowSprite(0xff2010, 2.6, 0.55);
    this.flareGlow.position.set(fx, fy + 0.36, fz);
    this.scene.add(this.flareGlow);

    group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(group);

    // Raised a bit above the physical tip so it rakes evenly up the
    // fuselage instead of just lighting the ground around the flare.
    this.flareLight = new THREE.PointLight(0xff2010, 6, 45, 1.8);
    this.flareLight.position.set(fx, fy + 1.2, fz);
    this.scene.add(this.flareLight);

    // Thin trail of dark, red-lit smoke — same drifting rig as the
    // wreck's engine smoke, just sparser and tinted from the flare.
    this.flareSmoke = [];
    for (let i = 0; i < 8; i++) {
      const s = makeGlowSprite(0x502420, 1.1, 0.2, false);
      s.userData.phase = i / 8;
      s.position.set(fx, fy, fz);
      this.scene.add(s);
      this.flareSmoke.push(s);
    }
    this.flareBaseY = fy + 0.35;
    this.flareX = fx;
    this.flareZ = fz;
  }

  // --------------------------------------------------------------- pickups
  _addPickup(mesh, x, z, label, onTake, { yOffset = 0.15, glowColor = 0xffe9a0 } = {}) {
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

  // Only the compass and binoculars start at the crash site — no weapon
  // here. The rifle and ammo are further up the valley at the wreckage
  // (see _buildWreckage), which doubles as the "look for survivors" quest
  // objective.
  _placeStartingLoadout() {
    const inv = this.inventory;
    const hud = this.hud;

    const compass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.05, 12),
      new THREE.MeshStandardMaterial({ color: 0xb8952f, roughness: 0.4, metalness: 0.7 })
    );
    this._addPickup(compass, -1.4, 3.2, 'Take compass', () => {
      inv.hasCompass = true;
      hud.toast('Compass acquired. The valley runs north — follow it.');
    });

    const binoc = new THREE.Group();
    const tubeMat = new THREE.MeshStandardMaterial({ color: 0x1e1f22, roughness: 0.6 });
    for (const off of [-0.06, 0.06]) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.18, 8), tubeMat);
      tube.position.x = off;
      binoc.add(tube);
    }
    this._addPickup(binoc, -3.2, -0.4, 'Take binoculars', () => {
      inv.hasBinoculars = true;
      this.weapon.giveBinoculars();
      hud.toast('Binoculars acquired — press 2, hold RMB to scan ahead.');
    });

    const rationBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.22, 0.25),
      new THREE.MeshStandardMaterial({ color: 0x7a2e22, roughness: 0.8 })
    );
    this._addPickup(rationBox, 0.9, 3.9, 'Take ration pack (+3 rations)', () => {
      inv.rations += 3;
      hud.toast('Rations stowed. Press F to eat one.');
    });
  }

  // ---------------------------------------------------------- wreckage
  /** A torn-off section of fuselage thrown clear in the crash, found further
   *  up the valley between the crash site and the lake — cold and quiet,
   *  unlike the still-burning helicopter. The rifle and its ammo ended up
   *  here; finding it is the payoff for the "look for survivors" objective:
   *  no one made it this far either, just their gear. */
  _buildWreckage() {
    const x = WRECKAGE.x, z = WRECKAGE.z;
    const y = this._groundY(x, z);
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x4a4d4f, roughness: 0.7, metalness: 0.6 });
    const scorchMat = new THREE.MeshStandardMaterial({ color: 0x1c1815, roughness: 1 });

    const scorch = new THREE.Mesh(new THREE.CircleGeometry(2.6, 20), scorchMat);
    scorch.rotation.x = -Math.PI / 2;
    scorch.position.set(x, y + 0.03, z);
    scorch.receiveShadow = true;
    this.scene.add(scorch);

    const g = new THREE.Group();
    g.position.set(x, y, z);

    const panel = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 0.06), metalMat);
    panel.position.set(0, 0.5, 0);
    panel.rotation.set(0.3, 0.6, 0.5); // buckled, half-buried
    g.add(panel);

    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.6, 6), metalMat);
    strut.position.set(-1, 0.35, 0.6);
    strut.rotation.set(0.2, 0, 1.1);
    g.add(strut);

    const blade = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.05, 0.28), metalMat);
    blade.position.set(0.8, 0.12, -0.9);
    blade.rotation.y = 0.9;
    g.add(blade);

    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.scene.add(g);
    this.grid.insert(x, z, 1.6);

    // The rifle and its magazines — moved here from the crash site.
    this._addPickup(
      this._makeRifleProp(), x + 0.6, z - 1.1,
      'Take hunting rifle (loaded)',
      () => {
        this.inventory.hasRifle = true;
        this.weapon.giveRifle();
        this.hud.toast('Rifle equipped — LMB fire, RMB aim, R reload, 1 to holster.');
        this._completeSurvivorsQuest();
      }
    );

    const magBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.14, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x3a4030, roughness: 0.8 })
    );
    this._addPickup(magBox, x - 0.7, z + 0.9, 'Take rifle magazines (+10 rounds)',
      () => this.weapon.addAmmo(10));
  }

  _completeSurvivorsQuest() {
    if (this.questComplete) return;
    this.questComplete = true;
    this.hud.setObjective('No survivors — just their gear', true);
    this.hud.toast("Whoever carried this didn't leave willingly. You're on your own out here.", 6500);
  }

  // ------------------------------------------------------------- wood/loot
  _placeWood() {
    const logMat = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 1 });
    const spots = [
      [pathX(6) + 5, 6], [pathX(-14) - 5, -14],
      [pathX(-42) + 4, -42], [pathX(-72) - 5, -72],
      [pathX(-112) + 5, -112], [POND.x - 10, POND.z - 11],
      [pathX(-192) + 4, -192], [pathX(-228) - 4, -228],
    ];
    for (const [x, z] of spots) {
      const g = new THREE.Group();
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 1.3, 6), logMat);
      log.rotation.set(Math.PI / 2, 0, Math.random() * Math.PI);
      const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.9, 5), logMat);
      branch.rotation.set(Math.PI / 2, 0, Math.random() * Math.PI);
      branch.position.set(0.25, 0.05, 0.2);
      g.add(log, branch);
      this._addPickup(g, x, z, 'Gather firewood (+2 wood)',
        () => { this.inventory.wood += 2; }, { glowColor: 0xd8b475 });
    }
  }

  _buildSupplyCrate() {
    const x = pathX(-205) + 3.5, z = -205;
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.7, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x6b5a3a, roughness: 0.9 })
    );
    this._addPickup(crate, x, z, 'Search old supply crate', () => {
      this.inventory.rations += 2;
      this.weapon.addAmmo(5);
      this.hud.toast('Inside: 2 rations and a box of cartridges (+5). Someone left in a hurry.');
    }, { yOffset: 0.35 });
    this.grid.insert(x, z, 0.7);
  }

  // ------------------------------------------------------------------ lake
  _buildPond() {
    const waterMat = createWaterMaterial();
    this.waterMaterial = waterMat;

    // Placeholder disc so the basin isn't empty for the moment it takes the
    // GLB to resolve; swapped for the real (irregular, more natural-looking)
    // lake-shore mesh once it loads.
    const placeholder = new THREE.Mesh(new THREE.CircleGeometry(POND_RADIUS, 28), waterMat);
    placeholder.rotation.x = -Math.PI / 2;
    placeholder.position.set(POND.x, POND_WATER_Y, POND.z);
    this.scene.add(placeholder);

    loadTreeAssets()
      .then((assets) => {
        const water = new THREE.Mesh(assets.waterGeo, waterMat);
        const scale = POND_RADIUS / assets.waterRadius;
        water.scale.set(scale, 1, scale);
        water.position.set(POND.x, POND_WATER_Y, POND.z);
        this.scene.add(water);
        this.scene.remove(placeholder);
        this._buildLakeTrees(assets);
      })
      .catch((err) => console.error('Failed to load lake water mesh:', err));

    // drink spot at the rim closest to the path
    const dirX = pathX(POND.z) - POND.x;
    const len = Math.abs(dirX) || 1;
    const rimX = POND.x + (dirX / len) * (POND_RADIUS - 2);
    const rimZ = POND.z;
    this.interactions.add({
      position: new THREE.Vector3(rimX, this._groundY(rimX, rimZ), rimZ),
      radius: 3.2,
      label: 'Drink from the lake',
      onUse: () => {
        this.stats.drink();
        this.sfx.drink();
        this.hud.toast('You drink deeply. The water is ice-cold and clean.');
      },
    });
  }

  /** A curated treeline around the lake shore — denser and more deliberate
   *  than the ambient procedural forest, to read as a set-piece "lake area"
   *  rather than just more scattered woods. Reuses the same big/small/dead
   *  species as the ambient forest (see TreeAssets.js), just placed by hand
   *  in two staggered bands instead of scattered. The path-facing shore,
   *  where the player walks up to drink, is left clear. */
  _buildLakeTrees(assets) {
    const approachAngle = Math.atan2(0, pathX(POND.z) - POND.x); // pond -> path
    const approachHalfWidth = 0.8;
    const bands = [
      { radiusMul: 1.15, count: 15, heightMul: 1.0, salt: 40 },
      { radiusMul: 1.38, count: 15, heightMul: 1.15, salt: 60 },
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
          leaves.position.set(x, y, z);
          leaves.rotation.y = rotY;
          leaves.scale.setScalar(scale);
          leaves.castShadow = true;
          this.scene.add(leaves);
        }
        this.grid.insert(x, z, 0.5 * scale);
      }
    }
  }

  // ----------------------------------------------------------------- signs
  _buildSigns() {
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x54432c, roughness: 1 });
    const x = pathX(-28) + 2.2, z = -28;
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.6, 6), woodMat);
    post.position.y = 0.8;
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 0.05), woodMat);
    board.position.set(0, 1.45, 0);
    board.rotation.y = 0.3;
    g.add(post, board);
    g.position.set(x, this._groundY(x, z), z);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(g);

    this.interactions.add({
      position: g.position.clone(),
      radius: 2.5,
      label: 'Read weathered sign',
      onUse: () => {
        this.hud.toast('"RANGER STATION — ▓ km N". The distance has been scratched out.');
      },
    });
  }

  // ------------------------------------------------------------ checkpoint
  _buildCheckpoint() {
    const { x, z } = CHECKPOINT;
    const y = this._groundY(x, z);
    const g = new THREE.Group();
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 3, 6),
      new THREE.MeshStandardMaterial({ color: 0x54432c, roughness: 1 })
    );
    post.position.y = 1.5;
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.6),
      new THREE.MeshStandardMaterial({
        color: 0xd84315, emissive: 0xd84315, emissiveIntensity: 0.4, side: THREE.DoubleSide,
      })
    );
    flag.position.set(0.55, 2.6, 0);
    this.flag = flag;
    const beacon = makeGlowSprite(0xff6d3a, 4, 0.5);
    beacon.position.y = 2.8;
    const light = new THREE.PointLight(0xff7744, 2, 25, 1.5);
    light.position.y = 2.5;
    g.add(post, flag, beacon, light);
    g.position.set(x, y, z);
    this.scene.add(g);
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    this.t += dt;

    if (this.waterMaterial) updateWaterMaterial(this.waterMaterial, this.t);

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

    // signal flare: gentle, steady flicker — not the wild cone-flame look —
    // plus its trail of drifting smoke.
    if (this.flareLight) {
      const flicker = Math.sin(this.t * 9) * 0.12 + Math.sin(this.t * 22 + 1.3) * 0.06;
      this.flareLight.intensity = 6 + flicker;
      this.flareTipMat.emissiveIntensity = 2.5 + flicker * 0.8;
      this.flareGlow.material.opacity = 0.55 + flicker * 0.15;
      const gs = 1 + flicker * 0.15;
      this.flareGlow.scale.set(2.6 * gs, 2.6 * gs, 1);

      for (const s of this.flareSmoke) {
        const cycle = (this.t * 0.16 + s.userData.phase) % 1;
        s.position.set(
          this.flareX + Math.sin(cycle * 8 + s.userData.phase * 20) * 0.35,
          this.flareBaseY + cycle * 4,
          this.flareZ + Math.cos(cycle * 6) * 0.3
        );
        s.material.opacity = 0.2 * (1 - cycle);
        s.scale.setScalar(0.8 + cycle * 2);
      }
    }
  }
}
