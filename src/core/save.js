// A single localStorage slot, written at each quest beat (see Level.js's
// onQuestAdvance / Game.js#saveGame). Bumping SAVE_VERSION invalidates any
// save written by an older shape rather than risk feeding stale/mismatched
// fields into a newer Game.

const KEY = 'deepforest-save';
// v4: quest chain reordered and renumbered (investigate the crash -> fire
// -> sleep -> water), and the separate ammo pickup was folded into the
// rifle — so an old save's questStage means something different and its
// takenPickups can name an item that no longer exists.
const SAVE_VERSION = 4;

export function saveGame(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...data, version: SAVE_VERSION }));
  } catch (err) {
    console.error('Failed to save game:', err);
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data.version === SAVE_VERSION ? data : null;
  } catch (err) {
    console.error('Failed to load save:', err);
    return null;
  }
}

export function clearSave() {
  localStorage.removeItem(KEY);
}
