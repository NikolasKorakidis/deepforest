// Uniform XZ grid of static circle colliders (trees, rocks, wreckage, the
// lake). Cheap push-out resolution for the player capsule footprint.

export class SpatialGrid {
  constructor(cellSize = 8) {
    this.cell = cellSize;
    this.map = new Map();
  }

  /** Inserted into every cell its bounding box overlaps, not just the one
   *  its center falls in — a collider wider than one cell (e.g. the lake,
   *  radius 10 vs. the default 8-unit cell) would otherwise be invisible to
   *  resolveCircle() queries made from a nearby-but-different cell. */
  insert(x, z, r) {
    const collider = { x, z, r };
    const minCx = Math.floor((x - r) / this.cell);
    const maxCx = Math.floor((x + r) / this.cell);
    const minCz = Math.floor((z - r) / this.cell);
    const maxCz = Math.floor((z + r) / this.cell);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const key = `${cx},${cz}`;
        if (!this.map.has(key)) this.map.set(key, []);
        this.map.get(key).push(collider);
      }
    }
  }

  /** Pushes (x, z) out of any overlapping colliders. Returns [x, z]. */
  resolveCircle(x, z, r) {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    // A collider spanning multiple cells (see insert()) can turn up more
    // than once in this 3x3 sweep — dedupe by reference so it isn't
    // pushed-out against twice in the same call.
    const seen = new Set();
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const arr = this.map.get(`${cx + i},${cz + j}`);
        if (!arr) continue;
        for (const c of arr) {
          if (seen.has(c)) continue;
          seen.add(c);
          const dx = x - c.x, dz = z - c.z;
          const min = r + c.r;
          const d2 = dx * dx + dz * dz;
          if (d2 < min * min && d2 > 1e-8) {
            const d = Math.sqrt(d2);
            const push = (min - d) / d;
            x += dx * push;
            z += dz * push;
          }
        }
      }
    }
    return [x, z];
  }
}
