import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { smoothstep, lerp, clamp } from './heightfield.js';

// Day-night cycle: drives sun/moon light, hemisphere light, sky color, fog
// density and a star field. `time` is a fraction of a day (0 = midnight,
// 0.5 = noon).

const DAY_SKY = new THREE.Color(0x8fb2d4);
const DUSK_TINT = new THREE.Color(0xd07a45);
const SUN_LOW = new THREE.Color(0xff9a55);
const SUN_HIGH = new THREE.Color(0xfff2df);
const MOON_COLOR = new THREE.Color(0x93a7ce);
const HEMI_DAY = new THREE.Color(0xbdd3e8);
const GROUND_DAY = new THREE.Color(0x3d4536);

// Night lighting comes in two flavors, blended by `cloudCover` (0 = clear,
// 1 = overcast). There's no weather system yet, so `cloudCover` is pinned to
// 0 — a bright moonlit "clear" night — but the old, much darker "overcast"
// numbers (what the whole game used to look like at night) are kept here
// so a future cloud system can dial night brightness back down by raising
// cloudCover instead of needing new constants.
const NIGHT_SUN_INTENSITY_CLEAR = 0.7;
const NIGHT_SUN_INTENSITY_OVERCAST = 0.22;
const NIGHT_HEMI_INTENSITY_CLEAR = 0.4;
const NIGHT_HEMI_INTENSITY_OVERCAST = 0.12;
const NIGHT_FOG_DENSITY_CLEAR = 0.009;
const NIGHT_FOG_DENSITY_OVERCAST = 0.016;
const NIGHT_SKY_CLEAR = new THREE.Color(0x1c2740);
const NIGHT_SKY_OVERCAST = new THREE.Color(0x05070f);
const HEMI_NIGHT_CLEAR = new THREE.Color(0x4a5c82);
const HEMI_NIGHT_OVERCAST = new THREE.Color(0x1a2440);
const GROUND_NIGHT_CLEAR = new THREE.Color(0x232b22);
const GROUND_NIGHT_OVERCAST = new THREE.Color(0x05070c);

export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.time = CONFIG.startTimeOfDay;
    this.day = 1;
    this.daylight = 1;
    this.cloudCover = 0; // 0 = clear moonlit night, 1 = overcast/pitch dark

    // Scratch colors for the night clear/overcast blend, reused every frame.
    this._nightSky = new THREE.Color();
    this._nightHemi = new THREE.Color();
    this._nightGround = new THREE.Color();

    this.hemi = new THREE.HemisphereLight(0xbdd3e8, 0x3d4536, 0.6);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = -60; cam.right = 60; cam.top = 60; cam.bottom = -60;
    cam.near = 1; cam.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.5;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.skyColor = new THREE.Color();
    scene.background = this.skyColor;
    scene.fog = new THREE.FogExp2(0x8fb2d4, 0.008);

    this.stars = this._makeStars();
    scene.add(this.stars);

    this.moon = this._makeMoon();
    scene.add(this.moon);
    // Fixed low compass direction, roughly ahead up the valley — a big,
    // low-hanging moon framed over the route rather than something that
    // rises and sets like the sun/moon light does.
    this.moonDir = new THREE.Vector3(0.42, 0.16, -0.89).normalize();
  }

  _makeMoon() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,251,240,1)');
    g.addColorStop(0.4, 'rgba(255,248,228,0.95)');
    g.addColorStop(0.62, 'rgba(226,224,210,0.45)');
    g.addColorStop(1, 'rgba(226,224,210,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    // A few faint crater blotches so the disc reads as a moon, not a blob.
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgba(210,206,196,0.5)';
    for (const [cx, cy, r] of [[95, 100, 22], [160, 150, 16], [110, 175, 12], [175, 90, 10]]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({
      map: tex, color: 0xfff6e0, transparent: true, depthWrite: false, fog: false,
    });
    const moon = new THREE.Sprite(mat);
    moon.scale.setScalar(185); // huge — meant to loom low over the horizon
    return moon;
  }

  _makeStars() {
    const count = 2400;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // random point on the upper hemisphere of a big dome
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.85 + 0.1);
      const r = 700;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta) - 140;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xcdd8ff,
      size: 1.6,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      fog: false,
      depthWrite: false,
    });
    return new THREE.Points(geo, mat);
  }

  get isNight() {
    return this.daylight < 0.15;
  }

  timeString() {
    const h = Math.floor(this.time * 24);
    const m = Math.floor((this.time * 24 - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /** Jump to the next morning (used by sleeping at a campfire). Lands just
   *  past the sunrise threshold (time=0.25 is exactly horizon) — early
   *  enough that the sun is barely up and the sky still carries a warm
   *  dawn tint, rather than mid-morning full daylight. */
  skipToMorning() {
    const DAWN = 0.26;
    if (this.time > DAWN) this.day++;
    this.time = DAWN;
  }

  update(dt, playerPos) {
    this.time += dt / CONFIG.dayLengthSec;
    if (this.time >= 1) {
      this.time -= 1;
      this.day++;
    }

    const ang = (this.time - 0.25) * Math.PI * 2;
    const elev = Math.sin(ang); // sun elevation: 1 at noon, negative at night
    const azim = Math.cos(ang);
    this.daylight = smoothstep(-0.04, 0.28, elev);

    // Sun by day, a fixed moon by night (brightness/color set by cloudCover).
    const nightSunIntensity = lerp(NIGHT_SUN_INTENSITY_CLEAR, NIGHT_SUN_INTENSITY_OVERCAST, this.cloudCover);
    if (elev > -0.04) {
      const dir = new THREE.Vector3(azim * 0.9, Math.max(elev, 0.02), -0.4).normalize();
      this.sun.position.copy(playerPos).addScaledVector(dir, 150);
      this.sun.intensity = 0.05 + 2.4 * this.daylight;
      this.sun.color.copy(SUN_LOW).lerp(SUN_HIGH, smoothstep(0.02, 0.45, elev));
    } else {
      this.sun.position.set(playerPos.x + 40, playerPos.y + 70, playerPos.z + 25);
      this.sun.intensity = nightSunIntensity;
      this.sun.color.copy(MOON_COLOR);
    }
    this.sun.target.position.copy(playerPos);

    const nightHemiIntensity = lerp(NIGHT_HEMI_INTENSITY_CLEAR, NIGHT_HEMI_INTENSITY_OVERCAST, this.cloudCover);
    this._nightHemi.copy(HEMI_NIGHT_CLEAR).lerp(HEMI_NIGHT_OVERCAST, this.cloudCover);
    this._nightGround.copy(GROUND_NIGHT_CLEAR).lerp(GROUND_NIGHT_OVERCAST, this.cloudCover);
    this.hemi.intensity = nightHemiIntensity + 0.5 * this.daylight;
    this.hemi.color.copy(this._nightHemi).lerp(HEMI_DAY, this.daylight);
    this.hemi.groundColor.copy(this._nightGround).lerp(GROUND_DAY, this.daylight);

    // Sky with a warm tint near sunrise/sunset.
    this._nightSky.copy(NIGHT_SKY_CLEAR).lerp(NIGHT_SKY_OVERCAST, this.cloudCover);
    this.skyColor.copy(this._nightSky).lerp(DAY_SKY, this.daylight);
    const duskAmt = clamp(1 - Math.abs(elev) * 4, 0, 1) * clamp(this.daylight * 2, 0, 1) * 0.55;
    this.skyColor.lerp(DUSK_TINT, duskAmt);

    this.scene.fog.color.copy(this.skyColor);
    const nightFogDensity = lerp(NIGHT_FOG_DENSITY_CLEAR, NIGHT_FOG_DENSITY_OVERCAST, this.cloudCover);
    this.scene.fog.density = lerp(nightFogDensity, 0.0065, this.daylight);

    // Clouds (once they exist) hide stars and the moon, not just dim them.
    const nightVisibility = (1 - this.daylight) * (1 - this.cloudCover);
    this.stars.material.opacity = nightVisibility;
    this.stars.position.set(playerPos.x, 0, playerPos.z);

    const moonDist = 620;
    this.moon.position.set(
      playerPos.x + this.moonDir.x * moonDist,
      this.moonDir.y * moonDist,
      playerPos.z + this.moonDir.z * moonDist
    );
    this.moon.material.opacity = nightVisibility;
  }
}
