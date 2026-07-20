// Uniform XZ grid of static circle colliders (trees, rocks, wreckage).
// Cheap push-out resolution for the player capsule footprint.

export class SpatialGrid {
  constructor(cellSize = 8) {
    this.cell = cellSize;
    this.map = new Map();
  }

  insert(x, z, r) {
    const key = `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
    if (!this.map.has(key)) this.map.set(key, []);
    this.map.get(key).push({ x, z, r });
  }

  /** Pushes (x, z) out of any overlapping colliders. Returns [x, z]. */
  resolveCircle(x, z, r) {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const arr = this.map.get(`${cx + i},${cz + j}`);
        if (!arr) continue;
        for (const c of arr) {
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
