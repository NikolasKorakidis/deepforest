import * as THREE from 'three';
import { terrainHeight, pathX, fbm, hash2, POND, POND_RADIUS, WORLD } from './heightfield.js';
import { loadTreeAssets } from './TreeAssets.js';

// Deterministic scatter of trees and rocks. Tree/rock positions and their
// colliders are computed synchronously (so collision and gameplay never
// wait on an asset load); the real tree meshes pop in once the shared GLB
// (see TreeAssets.js) resolves, matching the pattern used for the wreck,
// rifle and wolves.

const BASE_TREE_HEIGHT = 6.5; // world units at scale=1, before per-instance variance

function slopeAt(x, z) {
  const h1 = terrainHeight(x + 1, z) - terrainHeight(x - 1, z);
  const h2 = terrainHeight(x, z + 1) - terrainHeight(x, z - 1);
  return Math.hypot(h1, h2) / 2;
}

function excluded(x, z, pathMargin) {
  if (Math.abs(x - pathX(z)) < pathMargin) return true;              // keep path clear
  if (Math.hypot(x, z) < 20) return true;                             // crash clearing
  if (Math.hypot(x - POND.x, z - POND.z) < POND_RADIUS + 3) return true; // lake
  return false;
}

export function scatterVegetation(scene, grid) {
  scatterTrees(scene, grid);
  scatterRocks(scene, grid);
}

/** Picks a species per spot: mostly the two leafy variants, a rare dead snag. */
function pickSpecies(ix, iz) {
  const roll = hash2(ix, iz, 7);
  if (roll < 0.06) return 'dead';
  return roll < 0.56 ? 'small' : 'big';
}

function scatterTrees(scene, grid) {
  const spots = [];
  for (let gx = WORLD.minX + 6; gx < WORLD.maxX - 6; gx += 6) {
    for (let gz = WORLD.minZ + 6; gz < WORLD.maxZ - 6; gz += 6) {
      const ix = Math.round(gx * 10), iz = Math.round(gz * 10);
      const x = gx + (hash2(ix, iz, 1) - 0.5) * 5.5;
      const z = gz + (hash2(ix, iz, 2) - 0.5) * 5.5;
      const density = fbm(x * 0.02, z * 0.02, 3, 99); // groves, not uniform
      if (hash2(ix, iz, 3) > density * 0.94) continue;
      if (excluded(x, z, 7.5)) continue;
      const y = terrainHeight(x, z);
      if (y > 18) continue;                 // treeline
      if (slopeAt(x, z) > 0.85) continue;   // cliffs
      const scale = 0.75 + hash2(ix, iz, 4) * 0.8;
      spots.push({
        x, z, y,
        scale,
        rot: hash2(ix, iz, 5) * Math.PI * 2,
        shade: 0.85 + hash2(ix, iz, 6) * 0.3,
        species: pickSpecies(ix, iz),
      });
      // Collider registers immediately — collision doesn't wait on the GLB.
      grid.insert(x, z, 0.5 * scale);
    }
  }

  loadTreeAssets()
    .then((assets) => {
      buildSpeciesInstances(scene, spots.filter((s) => s.species === 'big'), assets.big);
      buildSpeciesInstances(scene, spots.filter((s) => s.species === 'small'), assets.small);
      buildSpeciesInstances(scene, spots.filter((s) => s.species === 'dead'), assets.dead);
    })
    .catch((err) => console.error('Failed to load tree assets:', err));
}

function buildSpeciesInstances(scene, spots, species) {
  if (spots.length === 0) return;

  const parts = [new THREE.InstancedMesh(species.barkGeo, species.barkMat, spots.length)];
  if (species.leavesGeo) {
    parts.push(new THREE.InstancedMesh(species.leavesGeo, species.leavesMat, spots.length));
  }

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  spots.forEach((s, i) => {
    const worldScale = (BASE_TREE_HEIGHT * s.scale) / species.naturalHeight;
    dummy.position.set(s.x, s.y, s.z);
    dummy.rotation.set(0, s.rot, 0);
    dummy.scale.setScalar(worldScale);
    dummy.updateMatrix();
    for (const p of parts) p.setMatrixAt(i, dummy.matrix);
    color.setScalar(s.shade); // subtle per-tree brightness variation
    for (const p of parts) p.setColorAt(i, color);
  });

  for (const p of parts) {
    p.castShadow = true;
    p.receiveShadow = true;
    if (p.instanceColor) p.instanceColor.needsUpdate = true;
    scene.add(p);
  }
}

function scatterRocks(scene, grid) {
  const spots = [];
  for (let gx = WORLD.minX + 8; gx < WORLD.maxX - 8; gx += 17) {
    for (let gz = WORLD.minZ + 8; gz < WORLD.maxZ - 8; gz += 17) {
      const ix = Math.round(gx * 3), iz = Math.round(gz * 3);
      const x = gx + (hash2(ix, iz, 11) - 0.5) * 15;
      const z = gz + (hash2(ix, iz, 12) - 0.5) * 15;
      if (hash2(ix, iz, 13) > 0.45) continue;
      if (excluded(x, z, 4)) continue;
      spots.push({
        x, z, y: terrainHeight(x, z) - 0.35,
        scale: 0.5 + hash2(ix, iz, 14) * 1.4,
        rot: hash2(ix, iz, 15) * Math.PI * 2,
      });
    }
  }

  const geo = new THREE.DodecahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x707278, roughness: 0.95 });
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  const dummy = new THREE.Object3D();
  spots.forEach((s, i) => {
    dummy.position.set(s.x, s.y, s.z);
    dummy.rotation.set(0, s.rot, 0);
    dummy.scale.set(s.scale, s.scale * 0.7, s.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    if (s.scale > 0.7) grid.insert(s.x, s.z, s.scale * 0.85);
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}
