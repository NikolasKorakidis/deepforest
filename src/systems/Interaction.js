import { CONFIG } from '../core/config.js';

// Proximity-based interactions: registered entries show an "[E] label"
// prompt when the player is within radius; E triggers the closest one.

export class InteractionSystem {
  constructor(input, hud) {
    this.hud = hud;
    this.list = [];
    this.current = null;
    input.onPress('KeyE', () => {
      if (this.current && !this.current.disabled) this.current.onUse(this.current);
    });
  }

  /**
   * @param entry { position: Vector3, radius, label, onUse(entry) }
   * Set entry.disabled = true inside onUse for one-shot pickups.
   */
  add(entry) {
    this.list.push(entry);
    return entry;
  }

  update(playerPos) {
    let best = null;
    let bestD = Infinity;
    for (const e of this.list) {
      if (e.disabled) continue;
      const d = e.position.distanceTo(playerPos);
      if (d < e.radius && d < bestD) {
        best = e;
        bestD = d;
      }
    }
    this.current = best;
    this.hud.setPrompt(best ? `[E] ${best.label}` : null);
  }
}
