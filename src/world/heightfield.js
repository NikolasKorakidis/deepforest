// Pure, deterministic terrain math. This is the single source of truth for
// ground height — shared by the terrain mesh, player grounding, AI, item
// placement and vegetation scattering. No three.js imports on purpose.

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;

export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Deterministic integer-lattice hash -> [0,1). */
export function hash2(ix, iz, seed = 0) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 144665);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x, z, seed = 0) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

/** Fractal value noise, roughly in [0,1]. */
export function fbm(x, z, octaves = 4, seed = 0) {
  let sum = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, z * freq, seed + i * 31);
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum;
}

// ---------------------------------------------------------------------------
// World layout: an open wilderness basin rather than the old scripted valley
// corridor. Rolling forested hills in every direction, a lake off to the
// north-east, and a ring of steep ridges at the edge that fences the play
// area in naturally (no invisible walls — the slope itself reads as "not
// that way"). Everything is a pure function of (x, z), so the same layout
// is regenerated identically on every load with nothing to store.
// ---------------------------------------------------------------------------

// The basin is 400 wide but runs long to the north, because the shooting
// range shares this map and a 500m lane simply does not fit in a 400m box —
// the diagonal would have to run through the crash site to be long enough.
export const WORLD = {
  minX: -200, maxX: 200,
  minZ: -760, maxZ: 200,
  sizeX: 400, sizeZ: 960,
  centerX: 0, centerZ: -280,
};

/**
 * The shooting range: a cleared lane running north from a firing line near
 * the crash site. Placed off to the west of the spawn clearing and well
 * clear of the lake, so it's a short walk from where you wake up rather
 * than a separate place you teleport to.
 */
export const RANGE = {
  laneX: -40,
  firingZ: 30,
  maxDist: 700,
  halfWidth: 32,   // cleared ground either side of the centre line
  shoulder: 26,    // blend distance back out to natural terrain
  laneY: 1.4,
};

/**
 * Target layout, shared so terrain, vegetation and Range.js can't disagree
 * about where the plates are.
 *
 * Each target gets its own *angular* lane rather than sharing a centreline:
 * a plate at 150m would otherwise sit exactly on the line of sight to the
 * plate at 500m. The farthest takes the centre lane and the nearest the
 * outermost, because a 25m plate subtends the most angle but converting
 * that to metres at 25m costs almost nothing.
 */
export const RANGE_DISTANCES = [25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 600, 700];
// 2.2° rather than 3°: with twelve targets the outermost lane is now six
// steps out, and a wider step would fling the 400m plate past the cleared
// ground. Still far more than the ~0.2° a distant plate subtends, so
// nothing occludes anything.
const LANE_STEP_DEG = 2.2;

/** Distances whose plate stands on a rise rather than the lane floor. */
const HILL_TARGETS = new Set([150, 300, 500]);

// Past this the lane stops being a valley floor and climbs the mountain, so
// the longest shots are also uphill shots onto a shelf high above the firing
// line. Ramped with a smoothstep so the ground never rises faster than the
// sightline to whatever stands on it — see the range verification.
const CLIMB_START = 520;
const CLIMB_END = 700;
const CLIMB_HEIGHT = 42;

export function rangeTargetSpots() {
  const byDistance = [...RANGE_DISTANCES].sort((a, b) => b - a);
  return byDistance.map((dist, j) => {
    const lane = Math.ceil(j / 2) * (j % 2 === 1 ? -1 : 1);
    const x = RANGE.laneX + dist * Math.tan((lane * LANE_STEP_DEG * Math.PI) / 180);
    return { dist, x, z: RANGE.firingZ - dist, onHill: HILL_TARGETS.has(dist) };
  });
}

// Mounds under the hill targets, as pure geometry so terrainHeight stays a
// function of position alone. Raising a far plate onto a rise also makes it
// *easier* to see — it breaks the silhouette off the ground behind it.
const MOUNDS = rangeTargetSpots()
  .filter((t) => t.onHill)
  // 14m rather than 26m. A wide mound spills sideways into the *next*
  // lane's sightline — the 150m rise was standing 0.5m proud of the line to
  // the 250m plate, hiding it completely. Lane separation is only ~6m at
  // 150m, so a mound has to stay tight to be a hill rather than a wall.
  .map((t) => ({ x: t.x, z: t.z, radius: 14, height: 5.5 }));

const RANGE_END_Z = RANGE.firingZ - RANGE.maxDist - 45;

/** 0..1 — how much (x, z) is inside the cleared lane. Vegetation uses this
 *  to keep the lane open, and terrainHeight to flatten it. */
export function rangeCorridor(x, z) {
  if (z > RANGE.firingZ + 25 || z < RANGE_END_Z) return 0;
  const across = 1 - smoothstep(RANGE.halfWidth, RANGE.halfWidth + RANGE.shoulder, Math.abs(x - RANGE.laneX));
  if (across <= 0) return 0;
  const ends = smoothstep(RANGE_END_Z, RANGE_END_Z + 35, z)
    * (1 - smoothstep(RANGE.firingZ + 6, RANGE.firingZ + 25, z));
  return across * ends;
}

/** Where the player starts — a small natural clearing at the origin. */
export const SPAWN_CLEARING_RADIUS = 16;

export const POND = { x: 52, z: -64 };
/** Radius of the visible water surface — and, by construction below, exactly
 *  where the lake bed crosses the waterline. */
export const POND_RADIUS = 17;

// The lake bed is an analytic bowl that *overrides* the terrain noise near
// the lake rather than being subtracted from it. That's what guarantees a
// clean shoreline: with a noisy bed, the ground wanders above and below the
// water level at the rim, so the water plane's edge ends up hanging over
// ground that is still below it (a visible floating-disc seam) in some
// directions and buried in others. Here the bed is a pure function of
// distance from the lake center, so `terrainHeight == POND_WATER_Y` holds
// *exactly* at POND_RADIUS in every direction.
const LAKE_FLOOR = -3.6;
const LAKE_RISE = 7.5;
const lakeBed = (d) => LAKE_FLOOR + LAKE_RISE * smoothstep(POND_RADIUS - 8, POND_RADIUS + 10, d);

// The encircling ridge: ground climbs hard between these radii.
const RIM_INNER = 145;
const RIM_OUTER = 205;

export function terrainHeight(x, z) {
  const broad = fbm(x * 0.0072, z * 0.0072, 4, 11) * 2 - 1;  // big rolling hills
  const mid = fbm(x * 0.029 + 100, z * 0.029, 3, 5) * 2 - 1; // hummocks
  const fine = fbm(x * 0.105 + 50, z * 0.105, 2, 3) * 2 - 1; // surface roughness
  let h = broad * 11 + mid * 2.4 + fine * 0.5;

  // Ridge ring — rises steeply toward the world edge, with noise so it
  // reads as ragged hills rather than a bowl.
  const d = Math.hypot(x, z);
  h += smoothstep(RIM_INNER, RIM_OUTER, d) * (48 + 22 * fbm(x * 0.01, z * 0.01, 3, 21));

  // Spawn clearing: flatten a gentle, obviously-walkable patch at the origin.
  h = lerp(h, 1.1 + fine * 0.35, 1 - smoothstep(SPAWN_CLEARING_RADIUS * 0.65, SPAWN_CLEARING_RADIUS, d));

  // Lake basin: blend fully over to the analytic bed near the water, then
  // back out to natural terrain well beyond the shore. The inner blend
  // reaching 1 before POND_RADIUS is what makes the exact-waterline
  // guarantee hold.
  const dpond = Math.hypot(x - POND.x, z - POND.z);
  if (dpond < POND_RADIUS + 20) {
    const toBed = 1 - smoothstep(POND_RADIUS + 6, POND_RADIUS + 20, dpond);
    h = lerp(h, lakeBed(dpond), toBed);
  }

  // Range lane, applied last so it wins: a dead-flat firing lane is the
  // whole point, and it has to cut straight through the ridge ring that
  // would otherwise rear up 60m across the far half of it. The ridge is
  // left standing either side, which frames the lane like a cutting and
  // gives long shots a backstop.
  const lane = rangeCorridor(x, z);
  if (lane > 0) h = lerp(h, rangeFloor(x, z), lane);

  return h;
}

/**
 * The lane's own ground: a gently rolling floor rather than a runway, plus
 * the mounds the hill targets stand on. Kept low-frequency and shallow so
 * it reads as ground without ever rising into a sightline — see the LOS
 * check in the range verification.
 */
function rangeFloor(x, z) {
  const along = RANGE.firingZ - z;
  let y = RANGE.laneY
    + 1.15 * Math.sin(z * 0.017 + 0.6)
    + 0.7 * Math.sin(x * 0.035 + z * 0.008)
    + CLIMB_HEIGHT * smoothstep(CLIMB_START, CLIMB_END, along);

  for (const m of MOUNDS) {
    const d = Math.hypot(x - m.x, z - m.z);
    // cos falloff: flat-topped enough to stand a target on, and it meets
    // the surrounding floor with zero gradient rather than a crease.
    if (d < m.radius) y += m.height * 0.5 * (1 + Math.cos((d / m.radius) * Math.PI));
  }
  return y;
}

/** Water surface height. Defined as the bed height exactly at POND_RADIUS,
 *  so the waterline lands precisely on the shore in every direction. */
export const POND_WATER_Y = lakeBed(POND_RADIUS);

/**
 * How thick the forest is at (x, z), 0..1. Drives both where trees are
 * scattered and how the ground is tinted, so the two always agree: 1 is
 * deep dense woodland, 0 is open meadow/clearing. Deliberately a different
 * noise seed/frequency from the height field so groves don't just mirror
 * the hills.
 */
export function forestDensity(x, z) {
  const n = fbm(x * 0.0105 + 300, z * 0.0105, 3, 77);
  return clamp(n * 2.35 - 0.52, 0, 1);
}

/** A rise on the far side of the forest that ends the slice. Kept inside
 *  the vegetated play area (well within the ridge ring) so the walk there
 *  is through forest rather than up bare rock. */
export const CHECKPOINT = { x: -78, z: -90 };
