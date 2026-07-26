// A single localStorage slot, written at each quest beat (see Level.js's
// onQuestAdvance / Game.js#saveGame). Bumping SAVE_VERSION invalidates any
// save written by an older shape rather than risk feeding stale/mismatched
// fields into a newer Game.

const KEY = 'deepforest-save';
// v3: the world was regenerated from scratch (new terrain, new lake and
// pickup positions) and the quest chain lost its opening "find survivors"
// beat, so both saved coordinates and saved quest stages from older runs
// would land somewhere meaningless.
const SAVE_VERSION = 3;

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
