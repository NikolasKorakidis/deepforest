import { CONFIG } from '../core/config.js';
import { clamp, smoothstep } from '../world/heightfield.js';

// Survival stats, all 0..100 where 100 is good. Hunger/thirst/energy drain
// over time; warmth follows time of day, altitude and campfires; empty bars
// bleed health.

export class PlayerStats {
  constructor() {
    this.health = 85; // wounded in the crash
    this.hunger = 80;
    this.thirst = 75;
    this.warmth = 90;
    this.energy = 90;
    this.lastCause = null;
    this.onDamaged = null;
  }

  get alive() {
    return this.health > 0;
  }

  damage(amount, cause = 'injuries') {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - amount);
    this.lastCause = cause;
    if (this.onDamaged) this.onDamaged(amount, cause);
  }

  eat() {
    this.hunger = clamp(this.hunger + 45, 0, 100);
    this.health = clamp(this.health + 4, 0, 100);
  }

  /** A ration cooked over a fire rather than eaten raw — bigger payoff. */
  cookedMeal() {
    this.hunger = clamp(this.hunger + 60, 0, 100);
    this.health = clamp(this.health + 8, 0, 100);
    this.warmth = clamp(this.warmth + 10, 0, 100);
  }

  drink() {
    this.thirst = 100;
  }

  applySleep() {
    this.energy = Math.max(this.energy, 90);
    this.health = clamp(this.health + 12, 0, 100);
    this.hunger = Math.max(0, this.hunger - 14);
    this.thirst = Math.max(0, this.thirst - 18);
    this.warmth = Math.max(this.warmth, 75);
  }

  /**
   * @param dt seconds
   * @param ctx { daylight: 0..1, nearFire: bool, sprinting: bool, altitude: meters }
   */
  update(dt, ctx) {
    if (!this.alive) return; // dead men don't regen
    const S = CONFIG.stats;

    this.hunger = clamp(this.hunger - S.hungerRate * dt, 0, 100);
    this.thirst = clamp(this.thirst - S.thirstRate * dt, 0, 100);
    const energyDrain = S.energyRate + (ctx.sprinting ? S.sprintEnergyRate : 0);
    this.energy = clamp(this.energy - energyDrain * dt, 0, 100);

    // Warmth: fires trump everything; otherwise daylight warms, night and
    // altitude chill.
    let warmthDelta;
    if (ctx.nearFire) {
      warmthDelta = S.fireWarmthRate;
    } else {
      const exposure = smoothstep(10, 22, ctx.altitude);
      const chill = (1 - ctx.daylight) * S.chillNightFactor + exposure * S.chillAltitudeFactor;
      warmthDelta = S.warmthBaseGain - chill;
    }
    this.warmth = clamp(this.warmth + warmthDelta * dt, 0, 100);

    // Empty bars hurt.
    let dps = 0;
    let cause = null;
    if (this.warmth <= 0) { dps += S.freezeDps; cause = 'the cold'; }
    if (this.thirst <= 0) { dps += S.dehydrateDps; cause = cause || 'dehydration'; }
    if (this.hunger <= 0) { dps += S.starveDps; cause = cause || 'starvation'; }

    if (dps > 0) {
      this.health = Math.max(0, this.health - dps * dt);
      this.lastCause = cause;
    } else if (this.hunger > 50 && this.thirst > 50 && this.warmth > 30) {
      this.health = clamp(this.health + S.regenHps * dt, 0, 100);
    }
  }
}
