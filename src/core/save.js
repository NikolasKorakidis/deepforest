// A single localStorage slot, written at each quest beat (see Level.js's
// onQuestAdvance / Game.js#saveGame). Bumping SAVE_VERSION invalidates any
// save written by an older shape rather than risk feeding stale/mismatched
// fields into a newer Game.

const KEY = 'deepforest-save';
const SAVE_VERSION = 1;

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
