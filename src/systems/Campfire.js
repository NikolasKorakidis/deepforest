import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { terrainHeight } from '../world/heightfield.js';
import { makeGlowSprite } from '../core/glow.js';
import { makeFireSprite, makeSmokeSprite } from '../core/particleTextures.js';

// Campfires: built anywhere on open ground for wood. A lit fire radiates
// warmth in a radius; pressing E beside a lit one opens a menu (handled by
// Game.js/HUD) to cook a ration or sleep through the night.

export class CampfireSystem {
  /**
   * @param onInteract(fire) called when the player presses E beside a
   *   still-lit fire — Game.js uses this to open the cook/sleep menu.
   */
  constructor(scene, sfx, interactions, onInteract) {
    this.scene = scene;
    this.sfx = sfx;
    this.interactions = interactions;
    this.onInteract = onInteract;
    this.fires = [];
    this.nearFire = false;
    this.t = 0;
  }

  /** @returns true if a fire was actually built (false if there's not enough wood). */
  tryBuild(controller, inventory, hud) {
    const cost = CONFIG.fire.woodCost;
    if (inventory.wood < cost) {
      hud.toast(`Not enough wood — need ${cost}, have ${inventory.wood}. Gather branches (E).`);
      return false;
    }
    inventory.wood -= cost;

    const yaw = controller.yaw;
    const x = controller.position.x - Math.sin(yaw) * 1.7;
    const z = controller.position.z - Math.cos(yaw) * 1.7;
    const y = terrainHeight(x, z);

    const group = new THREE.Group();
    group.position.set(x, y, z);

    // stone ring
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x5c5e63, roughness: 1 });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12, 0), stoneMat);
      stone.position.set(Math.cos(a) * 0.55, 0.06, Math.sin(a) * 0.55);
      group.add(stone);
    }
    // crossed logs
    const logMat = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 1 });
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.85, 6), logMat);
      log.rotation.set(Math.PI / 2 - 0.4, 0, (i / 3) * Math.PI * 2);
      log.position.y = 0.15;
      group.add(log);
    }
    // flame billboards (sprites always face the camera, so a soft outer
    // tongue + a brighter inner core reads as real fire from any angle,
    // unlike the flat-looking cone meshes this replaced) + glow + light
    const flameOuter = makeFireSprite(1.05, 0.9);
    flameOuter.position.y = 0.42;
    const flameInner = makeFireSprite(0.6, 0.95);
    flameInner.position.y = 0.32;
    const glow = makeGlowSprite(0xff8833, 2.2, 0.35);
    glow.position.y = 0.6;
    const light = new THREE.PointLight(0xff7722, 2.4, 16, 1.6);
    light.position.y = 0.8;
    group.add(flameOuter, flameInner, glow, light);

    // Rising smoke, same technique as the wreck/beacon in Level.js.
    const smoke = [];
    for (let i = 0; i < 6; i++) {
      const s = makeSmokeSprite(0x333333, 0.9, 0.22);
      s.userData.phase = i / 6;
      s.position.set(x, y, z);
      this.scene.add(s);
      smoke.push(s);
    }

    this.scene.add(group);
    const fire = {
      group, flameOuter, flameInner, glow, light, smoke,
      pos: new THREE.Vector3(x, y, z),
      baseY: y + 0.5,
      fuel: CONFIG.fire.burnTimeSec,
    };
    this.fires.push(fire);

    this.interactions.add({
      position: fire.pos.clone(),
      radius: CONFIG.fire.warmRadius,
      label: 'Campfire',
      onUse: () => {
        if (fire.fuel <= 0) hud.toast('This campfire has burned out.');
        else this.onInteract(fire);
      },
    });

    this.sfx.build();
    hud.toast('You build a campfire. Stay close to warm up — press E to cook or sleep.');
    return true;
  }

  update(dt, playerPos, hud) {
    this.t += dt;
    this.nearFire = false;
    for (const f of this.fires) {
      if (f.fuel <= 0) continue;
      f.fuel -= dt;
      if (f.fuel <= 0) {
        // extinguish
        f.flameOuter.visible = false;
        f.flameInner.visible = false;
        f.glow.visible = false;
        f.light.intensity = 0;
        for (const s of f.smoke) s.visible = false;
        hud.toast('A campfire has burned out.');
        continue;
      }
      // flicker
      const flicker = Math.sin(this.t * 13 + f.pos.x) * 0.2 + Math.sin(this.t * 29) * 0.12;
      f.light.intensity = 2.4 + flicker;
      const s = 1 + flicker * 0.4;
      f.flameOuter.scale.set(s, 0.9 + flicker * 0.5, s);
      f.flameInner.scale.set(s, 1 + flicker * 0.3, s);
      f.flameOuter.material.rotation = Math.sin(this.t * 3 + f.pos.x) * 0.15;
      f.flameInner.material.rotation = Math.sin(this.t * 4.2 + f.pos.z) * 0.2;
      f.glow.material.opacity = 0.3 + flicker * 0.1;

      // Rising smoke, same loop-and-fade technique as the wreck/beacon.
      for (const sp of f.smoke) {
        const cycle = (this.t * 0.1 + sp.userData.phase) % 1;
        sp.position.set(
          f.pos.x + Math.sin(cycle * 7 + sp.userData.phase * 20) * 0.25,
          f.baseY + cycle * 2.6,
          f.pos.z + Math.cos(cycle * 5) * 0.2
        );
        sp.material.opacity = 0.22 * (1 - cycle);
        sp.scale.setScalar(0.7 + cycle * 1.6);
      }

      if (f.pos.distanceTo(playerPos) < CONFIG.fire.warmRadius) this.nearFire = true;
    }
  }
}
