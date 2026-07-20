import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { terrainHeight } from '../world/heightfield.js';
import { makeGlowSprite } from '../core/glow.js';

// Campfires: built anywhere on open ground for wood. A lit fire radiates
// warmth in a radius and enables sleeping through the night.

export class CampfireSystem {
  constructor(scene, sfx) {
    this.scene = scene;
    this.sfx = sfx;
    this.fires = [];
    this.nearFire = false;
    this.t = 0;
  }

  tryBuild(controller, inventory, hud) {
    const cost = CONFIG.fire.woodCost;
    if (inventory.wood < cost) {
      hud.toast(`Not enough wood — need ${cost}, have ${inventory.wood}. Gather branches (E).`);
      return;
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
    // flame cones (additive) + glow + light
    const flameOuter = new THREE.Mesh(
      new THREE.ConeGeometry(0.32, 0.85, 8),
      new THREE.MeshBasicMaterial({
        color: 0xff7722, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    flameOuter.position.y = 0.55;
    const flameInner = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.55, 8),
      new THREE.MeshBasicMaterial({
        color: 0xffdd66, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    flameInner.position.y = 0.5;
    const glow = makeGlowSprite(0xff8833, 2.2, 0.35);
    glow.position.y = 0.6;
    const light = new THREE.PointLight(0xff7722, 2.4, 16, 1.6);
    light.position.y = 0.8;
    group.add(flameOuter, flameInner, glow, light);

    this.scene.add(group);
    this.fires.push({
      group, flameOuter, flameInner, glow, light,
      pos: new THREE.Vector3(x, y, z),
      fuel: CONFIG.fire.burnTimeSec,
    });

    this.sfx.build();
    hud.toast('You build a campfire. Stay close to warm up — sleep with G at night.');
  }

  /** Burn down the nearest lit fire after sleeping (embers by morning). */
  consumeForSleep(playerPos) {
    for (const f of this.fires) {
      if (f.fuel > 0 && f.pos.distanceTo(playerPos) < CONFIG.fire.warmRadius + 1) {
        f.fuel = Math.min(f.fuel, 30);
        return;
      }
    }
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
        hud.toast('A campfire has burned out.');
        continue;
      }
      // flicker
      const flicker = Math.sin(this.t * 13 + f.pos.x) * 0.2 + Math.sin(this.t * 29) * 0.12;
      f.light.intensity = 2.4 + flicker;
      const s = 1 + flicker * 0.4;
      f.flameOuter.scale.set(s, 0.9 + flicker * 0.5, s);
      f.flameInner.scale.set(s, 1 + flicker * 0.3, s);
      f.glow.material.opacity = 0.3 + flicker * 0.1;

      if (f.pos.distanceTo(playerPos) < CONFIG.fire.warmRadius) this.nearFire = true;
    }
  }
}
