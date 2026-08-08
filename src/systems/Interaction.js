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
   * @param entry { position: Vector3, radius, label, onUse(entry), priority? }
   * Set entry.disabled = true inside onUse for one-shot pickups.
   *
   * `priority` (default 0) breaks ties before distance does. Ambient,
   * everywhere-at-once interactions use a negative priority so they can
   * never mask a deliberate one: gathering wood is offered at every tree in
   * the forest, and without this a trunk half a metre nearer than the
   * campfire you're standing at would steal the prompt and lock you out of
   * the cook/sleep menu.
   */
  add(entry) {
    this.list.push(entry);
    return entry;
  }

  update(playerPos) {
    let best = null;
    let bestPriority = -Infinity;
    let bestD = Infinity;
    for (const e of this.list) {
      if (e.disabled) continue;
      const d = e.position.distanceTo(playerPos);
      if (d >= e.radius) continue;
      const priority = e.priority ?? 0;
      if (priority > bestPriority || (priority === bestPriority && d < bestD)) {
        best = e;
        bestPriority = priority;
        bestD = d;
      }
    }
    this.current = best;
    this.hud.setPrompt(best ? `[E] ${best.label}` : null);
  }
}
