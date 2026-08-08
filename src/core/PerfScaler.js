// Adaptive resolution scaling: keeps the frame rate at target by trading
// render resolution, which is the one quality knob that can be moved every
// frame without popping geometry in and out of the world.
//
// Culling and LOD (see Vegetation.js's chunking, Water.js's reflection
// throttle) cut the *average* cost; this is the safety net for the peaks —
// cresting a ridge where suddenly the whole basin is in frustum at once.

const SAMPLE_FRAMES = 30;   // ~half a second of history before reacting
const STEP = 0.1;           // resolution change per adjustment
const COOLDOWN = 0.5;       // seconds between adjustments, so it can't oscillate

export class PerfScaler {
  /**
   * @param minScale hard floor — below this the image gets too soft to be
   *   worth the frames.
   * @param maxScale ceiling, as a multiple of the device pixel ratio.
   */
  constructor(renderer, { targetFps = 60, minScale = 0.6, maxScale = 1.5 } = {}) {
    this.renderer = renderer;
    this.targetFrame = 1 / targetFps;
    this.minScale = minScale;
    this.maxScale = Math.min(maxScale, window.devicePixelRatio || 1);
    this.scale = this.maxScale;
    this.samples = [];
    this.cooldown = 0;
    this.renderer.setPixelRatio(this.scale);
  }

  update(dt) {
    // A single stalled frame (asset decode, tab refocus, GC) isn't a
    // signal about steady-state cost — ignore obvious outliers rather than
    // letting them drag the resolution down.
    if (dt < 0.25) this.samples.push(dt);
    if (this.samples.length > SAMPLE_FRAMES) this.samples.shift();

    this.cooldown -= dt;
    if (this.cooldown > 0 || this.samples.length < SAMPLE_FRAMES) return;

    // Median, not mean: robust to the occasional spike without needing to
    // special-case it.
    const sorted = [...this.samples].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];

    let next = this.scale;
    if (median > this.targetFrame * 1.15) {
      next = Math.max(this.minScale, this.scale - STEP);
    } else if (median < this.targetFrame * 0.75) {
      // Only climb back up with real headroom, so we don't sit on the
      // boundary flipping between two resolutions.
      next = Math.min(this.maxScale, this.scale + STEP);
    }

    if (next !== this.scale) {
      this.scale = next;
      this.renderer.setPixelRatio(next);
      this.samples.length = 0;
      this.cooldown = COOLDOWN;
    }
  }
}
