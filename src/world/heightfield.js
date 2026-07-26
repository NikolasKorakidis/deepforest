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

export const WORLD = {
  minX: -200, maxX: 200,
  minZ: -200, maxZ: 200,
  sizeX: 400, sizeZ: 400,
  centerX: 0, centerZ: 0,
};

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

  return h;
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
