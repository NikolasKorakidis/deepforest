// Player preferences, in their own localStorage slot.
//
// Kept apart from the save for the same reason personal bests are: a setting
// is about the person, not the run. Starting a New Game should never hand
// someone back a mouse that no longer feels like theirs.

const KEY = 'deepforest-settings';

// Multiplier on CONFIG.player.lookSensitivity, so 1.00 is exactly the tuning
// the game shipped with and the slider reads as a factor either side of it.
export const SENSITIVITY = { min: 0.25, max: 3, step: 0.05, default: 1 };

const DEFAULTS = { sensitivity: SENSITIVITY.default };

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function loadSettings() {
  let stored = null;
  try {
    const raw = localStorage.getItem(KEY);
    stored = raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error('Failed to read settings:', err);
  }
  // Sanitised on the way in rather than trusted: this is user-editable
  // storage, and a sensitivity of 0 or NaN would leave the player unable to
  // turn around with no obvious way to discover why.
  const n = Number(stored?.sensitivity);
  return {
    ...DEFAULTS,
    sensitivity: Number.isFinite(n)
      ? clamp(n, SENSITIVITY.min, SENSITIVITY.max)
      : DEFAULTS.sensitivity,
  };
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}
