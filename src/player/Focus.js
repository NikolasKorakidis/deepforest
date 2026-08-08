import { CONFIG } from '../core/config.js';

// Hold-breath focus: with the scope up, holding Shift steadies the rifle and
// slows the world for a few seconds, then needs time to recover.
//
// The point isn't the slow motion by itself — it's that a wandering reticle
// suddenly settles, so the hard shot becomes takeable for a moment. Slowing
// time is what buys you the chance to use that window on a plate that's
// about to drop or a balloon swinging on its tether.
//
// Every timer here runs on *real* time, not the scaled clock. Five seconds
// has to mean five seconds to the player; measured on the slowed clock the
// hold would silently last two and a half times longer than advertised, and
// the cooldown likewise.

const READY = 'ready';
const HOLDING = 'holding';
const RECOVERING = 'recovering';

export class Focus {
  constructor({ input }) {
    this.input = input;
    this.state = READY;
    this.remaining = CONFIG.focus.holdSeconds;
    this.recovery = 0;
  }

  get active() {
    return this.state === HOLDING;
  }

  /** Time multiplier the world should run at. */
  get timeScale() {
    return this.active ? CONFIG.focus.timeScale : 1;
  }

  /** Multiplier applied to aim sway — the actual reward for holding. */
  get swayMult() {
    return this.active ? CONFIG.focus.swayMult : 1;
  }

  /** 0..1 for the HUD: breath left while holding, recovery progress after. */
  get fraction() {
    if (this.state === HOLDING) return this.remaining / CONFIG.focus.holdSeconds;
    if (this.state === RECOVERING) return 1 - this.recovery / CONFIG.focus.cooldownSeconds;
    return 1;
  }

  /** @param scoped true only once the scope has actually settled, so the
   *   breath can't be spent during the zoom-in animation. */
  update(realDt, scoped) {
    const held = this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight');

    if (this.state === RECOVERING) {
      this.recovery -= realDt;
      if (this.recovery <= 0) {
        this.state = READY;
        this.remaining = CONFIG.focus.holdSeconds;
      }
      return;
    }

    if (this.state === HOLDING) {
      this.remaining -= realDt;
      // Ends on running out, letting go, or lowering the scope. Releasing
      // early still costs the full recovery: banking half a breath to spend
      // later would make the cooldown meaningless.
      if (this.remaining <= 0 || !held || !scoped) this._spend();
      return;
    }

    if (held && scoped) this.state = HOLDING;
  }

  _spend() {
    this.state = RECOVERING;
    this.recovery = CONFIG.focus.cooldownSeconds;
    this.remaining = 0;
  }
}
