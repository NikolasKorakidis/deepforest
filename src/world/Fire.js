import * as THREE from 'three';
import { makeFireSprite, makeSparkSprite } from '../core/particleTextures.js';
import { makeGlowSprite } from '../core/glow.js';

// A reusable flame: a cluster of billboard tongues that are born at the
// base, lick upward, and die — plus rising embers, a glowing ember bed and
// a flickering light. Shared by the campfire and the helicopter wreck so
// there's one place where fire behaviour lives.
//
// The thing that makes this read as fire rather than as a pulsing sprite is
// that each tongue runs its own birth-to-death cycle on its own phase and
// speed: something is always appearing while something else is fading, so
// the silhouette never repeats. The old version scaled two fixed sprites
// with a sine, which reads as breathing.

const TAU = Math.PI * 2;

export class FireEffect {
  /**
   * @param radius  horizontal spread of the flame column
   * @param height  how far the tongues climb before dying
   * @param flames  tongue count — the main quality/cost dial
   * @param embers  rising sparks
   * @param warm    true for a campfire's orange; wreck fires run hotter/whiter
   */
  constructor({
    radius = 0.4,
    height = 1.0,
    flames = 5,
    embers = 8,
    lightColor = 0xff7722,
    lightIntensity = 2.4,
    lightDistance = 16,
    seed = 0,
  } = {}) {
    this.radius = radius;
    this.height = height;
    this.baseIntensity = lightIntensity;
    this.seed = seed;
    this.t = seed * 7.13; // desyncs multiple fires that share a build frame

    this.group = new THREE.Group();

    // Ember bed — the dull red heart under the flames. Sits low and wide so
    // the fire looks like it's coming out of something.
    this.bed = makeGlowSprite(0xff4d10, radius * 2.4, 0.5);
    this.bed.position.y = radius * 0.15;
    this.group.add(this.bed);

    this.flames = [];
    for (let i = 0; i < flames; i++) {
      // Starts invisible: update() sets scale and opacity every frame, and
      // without this there's a single frame of full-size sprites before the
      // first update lands.
      const s = makeFireSprite(1, 0);
      // Tongues nearer the middle burn whiter, outer ones redder — the
      // colour gradient across the column is most of what sells depth.
      const outward = i / Math.max(1, flames - 1);
      s.material.color.setHSL(0.085 - outward * 0.05, 1, 0.62 - outward * 0.12);
      const a = (i / flames) * TAU + this._rand(i, 1) * 0.9;
      const r = radius * (0.1 + 0.8 * Math.sqrt(this._rand(i, 2)));
      this.flames.push({
        sprite: s,
        ox: Math.cos(a) * r,
        oz: Math.sin(a) * r,
        phase: i / flames + this._rand(i, 3) * 0.12,
        speed: 0.85 + this._rand(i, 4) * 0.6,
        width: 0.55 + this._rand(i, 5) * 0.55,
        sway: this._rand(i, 6) * TAU,
      });
      this.group.add(s);
    }

    this.embers = [];
    for (let i = 0; i < embers; i++) {
      const s = makeSparkSprite(0.05, 0); // as above: sized/faded in by update()
      this.embers.push({
        sprite: s,
        phase: this._rand(i, 11),
        speed: 0.22 + this._rand(i, 12) * 0.28,
        ox: (this._rand(i, 13) - 0.5) * radius,
        oz: (this._rand(i, 14) - 0.5) * radius,
        drift: this._rand(i, 15) * TAU,
        size: radius * (0.07 + this._rand(i, 16) * 0.1),
      });
      this.group.add(s);
    }

    // A light is optional. Every point light in the scene costs shading work
    // on every lit fragment, whether or not it reaches — so secondary seats
    // of fire on the same prop are lit by their neighbour and carry none of
    // their own.
    if (lightIntensity > 0) {
      this.light = new THREE.PointLight(lightColor, lightIntensity, lightDistance, 1.7);
      this.light.position.y = height * 0.5;
      this.group.add(this.light);
    } else {
      this.light = null;
    }
  }

  /** Deterministic per-index jitter, keyed off the immutable seed rather
   *  than the running clock — so a campfire rebuilt from a save comes back
   *  with the same flame layout it had, instead of a new random one. */
  _rand(i, salt) {
    const x = Math.sin(i * 12.9898 + salt * 78.233 + this.seed * 3.71) * 43758.5453;
    return x - Math.floor(x);
  }

  /** @param intensity 0..1 — campfires wind this down as they burn out. */
  update(dt, intensity = 1) {
    this.t += dt;
    const t = this.t;
    const I = Math.max(0, Math.min(1, intensity));

    for (const f of this.flames) {
      const cyc = (t * f.speed + f.phase) % 1;
      // Fast rise, slow taper: a tongue flares almost immediately and then
      // thins out, rather than growing and shrinking symmetrically.
      const grow = Math.sin(Math.min(1, cyc * 1.2) * Math.PI);
      const wob = Math.sin(t * 6.1 + f.sway) * 0.35 + Math.sin(t * 11.3 + f.sway * 2) * 0.15;

      const s = f.sprite;
      s.position.set(
        f.ox + wob * this.radius * 0.28,
        this.height * (0.15 + cyc * 0.6) * (0.55 + I * 0.45),
        f.oz + Math.cos(t * 5.2 + f.sway) * this.radius * 0.2
      );
      const w = this.radius * 1.85 * f.width * grow * (0.55 + I * 0.45);
      s.scale.set(w, w * (1.45 + cyc * 0.9), 1); // taller than wide, more so as it climbs
      s.material.opacity = grow * (1 - cyc * 0.3) * I;
      s.material.rotation = wob * 0.14;
    }

    for (const e of this.embers) {
      const cyc = (t * e.speed + e.phase) % 1;
      const spread = this.radius * (0.35 + cyc * 1.7);
      const s = e.sprite;
      s.position.set(
        e.ox + Math.sin(t * 1.6 + e.drift) * spread,
        this.height * (0.2 + cyc * 2.5) * I,
        e.oz + Math.cos(t * 1.25 + e.drift) * spread
      );
      const sz = e.size * (1 - cyc * 0.5);
      s.scale.set(sz, sz, 1);
      // Fade in and out so embers appear mid-air rather than popping in.
      s.material.opacity = Math.sin(cyc * Math.PI) * 0.9 * I;
    }

    // Three mismatched frequencies keeps the light from reading as a pulse.
    const flick =
      Math.sin(t * 13.1) * 0.17 + Math.sin(t * 27.7 + 1.3) * 0.09 + Math.sin(t * 5.3 + 2.1) * 0.08;
    if (this.light) this.light.intensity = this.baseIntensity * I * (1 + flick);
    this.bed.material.opacity = (0.3 + flick * 0.22) * I;
    const bs = this.radius * 2.4 * (0.85 + flick * 0.22);
    this.bed.scale.set(bs, bs, 1);
  }

  /** Snuffs it out — used when a campfire runs out of fuel. */
  extinguish() {
    this.group.visible = false;
    if (this.light) this.light.intensity = 0;
  }
}
