// Wind: one authority read by three very different consumers — the bullet
// solver, the grass shader, and the HUD gauge. Keeping it in one place is
// what makes the readout trustworthy: what the gauge says is literally the
// vector the bullet is pushed by, so a player who learns to read it can
// dial in a hold and be right.
//
// Modelled the way rifle games (Sniper Elite, Hunt) present it: a slowly
// wandering base direction and speed, plus faster gusting on top. It never
// jumps, so a shot lined up over a couple of seconds stays valid, but it
// drifts enough that a range session isn't one memorised correction.

const TAU = Math.PI * 2;

export class Wind {
  constructor({ baseSpeed = 4.5, gust = 2.6 } = {}) {
    this.dir = Math.random() * TAU;   // radians; direction the wind blows TOWARD
    this.speed = baseSpeed;
    this._baseSpeed = baseSpeed;
    this._gust = gust;
    this._t = Math.random() * 100;

    // Unit vector on the XZ plane, refreshed each update so consumers never
    // recompute trigonometry themselves.
    this.x = Math.cos(this.dir);
    this.z = Math.sin(this.dir);
  }

  update(dt) {
    this._t += dt;
    const t = this._t;

    // Two slow, mismatched oscillators per channel: no repeating period the
    // player could pattern-match, but nothing sudden either.
    this.dir += (Math.sin(t * 0.037) * 0.6 + Math.sin(t * 0.011 + 1.9) * 0.4) * dt * 0.35;
    const gust = Math.sin(t * 0.21) * 0.6 + Math.sin(t * 0.53 + 2.3) * 0.4;
    this.speed = Math.max(0, this._baseSpeed + gust * this._gust);

    this.x = Math.cos(this.dir);
    this.z = Math.sin(this.dir);
  }

  /** Compass bearing in degrees (0 = north/-Z), for the HUD. */
  get bearingDeg() {
    return ((Math.atan2(this.x, -this.z) * 180) / Math.PI + 360) % 360;
  }
}
