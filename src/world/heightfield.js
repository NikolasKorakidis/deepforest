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
// World layout. The playable route runs from the crash clearing at the origin
// north (-Z) along a winding valley path to the checkpoint at END_Z.
// ---------------------------------------------------------------------------

export const WORLD = {
  minX: -210, maxX: 210,
  minZ: -345, maxZ: 75,
  sizeX: 420, sizeZ: 420,
  centerX: 0, centerZ: -135,
};

export const END_Z = -290;

/** Centerline of the valley path as a function of z. */
export function pathX(z) {
  return 10 * Math.sin(z * 0.023) + 7 * Math.sin(z * 0.0095 + 1.7);
}

// Pushed well off the path so a proper lake-sized basin doesn't flood the
// walkable corridor (valley walls start rising at dp > 22).
export const POND = { x: pathX(-150) + 27, z: -150 };
export const POND_RADIUS = 13;

/** Smooth elevation gain heading north toward the mountain pass. */
function climb(z) {
  return 16 * smoothstep(0, 280, -z) + 30 * smoothstep(280, 340, -z);
}

/** Height along the path centerline (gentle, always walkable). */
function pathHeight(z) {
  return climb(z) + 1.6 * Math.sin(z * 0.05) + 0.8 * Math.sin(z * 0.021 + 3);
}

export function terrainHeight(x, z) {
  const n1 = fbm(x * 0.016, z * 0.016, 4) * 2 - 1;       // rolling hills
  const n2 = fbm(x * 0.06 + 100, z * 0.06, 3) * 2 - 1;   // small detail
  let h = n1 * 8 + n2 * 1.2 + climb(z);

  // Valley walls rise away from the path so the route reads as a corridor.
  const dp = Math.abs(x - pathX(z));
  h += smoothstep(22, 85, dp) * (14 + 10 * fbm(x * 0.01 + 50, z * 0.01, 3));

  // A wall behind the start so the player heads north.
  h += 20 * smoothstep(30, 80, z);

  // Flatten a walkable corridor along the path.
  const f = 1 - smoothstep(2.8, 11, dp);
  h = lerp(h, pathHeight(z), f * 0.92);

  // Crash-site clearing around the origin.
  const dc = Math.hypot(x, z);
  h = lerp(h, 0.4 + n2 * 0.3, 1 - smoothstep(9, 22, dc));

  // Lake basin — wide and flat-bottomed, with a gentle shore slope.
  const dpond = Math.hypot(x - POND.x, z - POND.z);
  h -= 4.5 * (1 - smoothstep(POND_RADIUS - 3, POND_RADIUS + 4, dpond));

  return h;
}

/** Water surface height for the lake (sits below the basin rim, above the floor). */
export const POND_WATER_Y = terrainHeight(POND.x, POND.z) + 2.3;

export const CHECKPOINT = { x: pathX(END_Z), z: END_Z };
