import * as THREE from 'three';
import {
  terrainHeight, fbm, smoothstep, forestDensity, raycastTerrain,
  WORLD, POND, POND_RADIUS,
} from './heightfield.js';

/**
 * Builds the terrain mesh from the shared heightfield, with vertex colors:
 * open meadow grass in the clearings, darker leaf-litter under the dense
 * forest (driven by the same `forestDensity` that decides where trees
 * actually go, so ground tint and canopy always agree), wet sand around the
 * lake, rock on steep slopes and snow on the high ridge.
 */
export function createTerrain() {
  // Segments follow the world's aspect rather than being square, so the
  // long northern arm holding the range lane keeps the same ~1.5m vertex
  // spacing as the basin instead of being stretched coarse.
  const spacing = 1.55;
  const segX = Math.round(WORLD.sizeX / spacing);
  const segZ = Math.round(WORLD.sizeZ / spacing);
  const geo = new THREE.PlaneGeometry(WORLD.sizeX, WORLD.sizeZ, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  geo.translate(WORLD.centerX, 0, WORLD.centerZ);

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();

  const nrm = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const meadowA = new THREE.Color(0x4a5f2a);   // sunlit open grass
  const meadowB = new THREE.Color(0x5b6d33);
  const forestFloor = new THREE.Color(0x2a3419); // shaded leaf litter
  const sand = new THREE.Color(0x6b5c40);
  const rock = new THREE.Color(0x63656a);
  const snow = new THREE.Color(0xdfe6ec);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);

    c.copy(meadowA).lerp(meadowB, fbm(x * 0.05, z * 0.05, 2, 7));
    c.lerp(forestFloor, forestDensity(x, z) * 0.85);

    // Damp sand ring at the waterline.
    const dpond = Math.hypot(x - POND.x, z - POND.z);
    c.lerp(sand, (1 - smoothstep(POND_RADIUS - 2, POND_RADIUS + 7, dpond)) * 0.75);

    const slope = 1 - nrm.getY(i);
    c.lerp(rock, smoothstep(0.14, 0.34, slope));
    c.lerp(snow, smoothstep(34, 48, y) * (1 - smoothstep(0.22, 0.42, slope)));

    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';

  // Range this against the heightfield, not against its own 319k triangles.
  // three.js has no BVH, so the stock raycast tests every triangle — 13.3ms
  // per ray, measured, which is the entire frame budget. The game fires rays
  // constantly (the scope rangefinder every frame while aiming, every bullet
  // in flight every frame), so this one override is the difference between
  // aiming being free and aiming costing more than everything else combined.
  //
  // Nothing reads `face`, `uv` or `normal` off a terrain hit, so distance,
  // point and object are the whole contract. The analytic surface differs
  // from the drawn mesh by at most 0.16m — its own tessellation error, and
  // if anything the more correct of the two.
  mesh.raycast = function (raycaster, intersects) {
    const { origin: o, direction: d } = raycaster.ray;
    const t = raycastTerrain(
      o.x, o.y, o.z, d.x, d.y, d.z, raycaster.near, raycaster.far
    );
    if (t < 0) return;
    intersects.push({
      distance: t,
      point: o.clone().addScaledVector(d, t),
      object: this,
    });
  };

  return mesh;
}
