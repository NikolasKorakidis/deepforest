import * as THREE from 'three';
import {
  terrainHeight, hash2, forestDensity, POND, POND_RADIUS, WORLD,
  SPAWN_CLEARING_RADIUS,
} from './heightfield.js';
import { loadTreeAssets } from './TreeAssets.js';

// Deterministic scatter of trees, grass and rocks. Positions and colliders
// are computed synchronously (so collision and gameplay never wait on an
// asset load); the real tree meshes pop in once the shared GLB (see
// TreeAssets.js) resolves, matching the pattern used for the wolves.
//
// Everything is placed from hash2/fbm of the world position, so the same
// forest regenerates identically every load with nothing to store.

const BASE_TREE_HEIGHT = 6.5; // world units at scale=1, before per-instance variance

// Grass is the expensive one — a fixed budget of billboard clumps spread
// over the area the player actually roams, rather than the whole 400x400
// map (most of which is behind the ridge). Tuned for a dense look up close
// without pushing instance count into the hundreds of thousands.
const GRASS_BUDGET = 38000;
const GRASS_RADIUS = 125;

function slopeAt(x, z) {
  const h1 = terrainHeight(x + 1, z) - terrainHeight(x - 1, z);
  const h2 = terrainHeight(x, z + 1) - terrainHeight(x, z - 1);
  return Math.hypot(h1, h2) / 2;
}

/** Inside the lake (plus a shore margin) — nothing is planted here. */
function inLake(x, z, margin = 1) {
  return Math.hypot(x - POND.x, z - POND.z) < POND_RADIUS + margin;
}

export function scatterVegetation(scene, grid) {
  scatterTrees(scene, grid);
  scatterGrass(scene);
  scatterRocks(scene, grid);
}

// ------------------------------------------------------------------- trees

/** Picks a species per spot: mostly the two leafy variants, a rare dead snag. */
function pickSpecies(ix, iz) {
  const roll = hash2(ix, iz, 7);
  if (roll < 0.06) return 'dead';
  return roll < 0.56 ? 'small' : 'big';
}

function scatterTrees(scene, grid) {
  const spots = [];
  for (let gx = WORLD.minX + 6; gx < WORLD.maxX - 6; gx += 5.5) {
    for (let gz = WORLD.minZ + 6; gz < WORLD.maxZ - 6; gz += 5.5) {
      const ix = Math.round(gx * 10), iz = Math.round(gz * 10);
      const x = gx + (hash2(ix, iz, 1) - 0.5) * 5;
      const z = gz + (hash2(ix, iz, 2) - 0.5) * 5;

      // The same density field the ground tint uses, so dense woodland
      // reads as dense from both the canopy and the forest floor.
      const density = forestDensity(x, z);
      if (hash2(ix, iz, 3) > density * 0.97) continue;

      if (Math.hypot(x, z) < SPAWN_CLEARING_RADIUS) continue; // keep spawn open
      if (inLake(x, z, 4)) continue;

      const y = terrainHeight(x, z);
      if (y > 30) continue;                 // treeline on the ridge
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

// ------------------------------------------------------------------- grass

// Wind time, shared by every grass instance. Advanced by updateVegetation().
const grassUniforms = { uTime: { value: 0 } };

/**
 * "Paper" grass: a clump of flat cards, alpha-cut to blade silhouettes.
 * Three quads at 0/60/120 degrees so the clump still reads as volume from
 * any angle (a single card visibly vanishes edge-on). Origin sits at the
 * base so instances can be dropped straight onto terrain height, and UV.y
 * runs 0 at the root to 1 at the tip — the wind shader keys off that so
 * blades bend from the base instead of sliding sideways as a whole.
 */
function makeGrassClumpGeometry(blades = 3) {
  const positions = [], uvs = [], normals = [], indices = [];
  const corners = [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]];
  const cornerUvs = [[0, 0], [1, 0], [1, 1], [0, 1]];

  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI;
    const cos = Math.cos(a), sin = Math.sin(a);
    const base = positions.length / 3;
    for (let i = 0; i < 4; i++) {
      const [px, py] = corners[i];
      positions.push(px * cos, py, px * sin);
      uvs.push(cornerUvs[i][0], cornerUvs[i][1]);
      // Straight-up normals rather than true card normals: grass then
      // catches sky/sun light like the ground it grows out of, instead of
      // half the cards rendering nearly black when they face away.
      normals.push(0, 1, 0);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

/** Procedural blade-silhouette texture — no external image assets, same as
 *  the rest of the world (glow.js, particleTextures.js, Water.js). */
function makeGrassTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  const blades = 11;
  for (let i = 0; i < blades; i++) {
    const r1 = hash2(i, 0, 91), r2 = hash2(i, 1, 92), r3 = hash2(i, 2, 93), r4 = hash2(i, 3, 94);
    const x0 = size * (0.08 + 0.84 * (i + 0.5) / blades) + (r1 - 0.5) * size * 0.06;
    const w = size * (0.028 + r2 * 0.028);
    const h = size * (0.42 + r3 * 0.55);
    const bend = (r4 - 0.5) * size * 0.3;

    const g = ctx.createLinearGradient(0, size, 0, size - h);
    g.addColorStop(0, '#1f2d0d');    // dark at the root, in shadow
    g.addColorStop(0.55, '#4d6d21');
    g.addColorStop(1, '#8fac52');     // sun-bleached tip
    ctx.fillStyle = g;

    ctx.beginPath();
    ctx.moveTo(x0 - w, size);
    ctx.quadraticCurveTo(x0 - w * 0.5 + bend * 0.5, size - h * 0.55, x0 + bend, size - h);
    ctx.quadraticCurveTo(x0 + w * 0.5 + bend * 0.5, size - h * 0.55, x0 + w, size);
    ctx.closePath();
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGrassMaterial() {
  const material = new THREE.MeshStandardMaterial({
    map: makeGrassTexture(),
    // Alpha *test*, not blending: grass cards overlap constantly, and
    // blended transparency would need per-frame depth sorting that
    // InstancedMesh can't do (and would z-fight regardless).
    alphaTest: 0.42,
    transparent: false,
    side: THREE.DoubleSide,
    roughness: 1,
    metalness: 0,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = grassUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n uniform float uTime;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          // Instance origin straight out of the instance matrix — gives each
          // clump its own wind phase so the field ripples instead of every
          // blade swaying in lockstep.
          vec3 iPos = instanceMatrix[3].xyz;
          float phase = iPos.x * 0.28 + iPos.z * 0.21;
          float gust = sin(uTime * 1.5 + phase) * 0.55
                     + sin(uTime * 2.7 + phase * 1.7) * 0.25;
          // uv.y^2 keeps the root planted and lets the tip travel furthest.
          float bend = gust * uv.y * uv.y;
          transformed.x += bend * 0.3;
          transformed.z += bend * 0.17;
        }`
      );
  };

  return material;
}

function scatterGrass(scene) {
  const geo = makeGrassClumpGeometry();
  const mat = makeGrassMaterial();
  const mesh = new THREE.InstancedMesh(geo, mat, GRASS_BUDGET);

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let n = 0;

  for (let i = 0; i < GRASS_BUDGET * 3 && n < GRASS_BUDGET; i++) {
    // sqrt on the radius keeps the disc evenly covered instead of bunching
    // everything around the origin.
    const r = Math.sqrt(hash2(i, 0, 41)) * GRASS_RADIUS;
    const a = hash2(i, 1, 42) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;

    // Filters ordered cheapest-first — this loop runs tens of thousands of
    // times at startup and slopeAt() alone costs four terrainHeight()
    // evaluations, so it goes last, after the cheap rejections have
    // already thrown most candidates out.
    if (inLake(x, z, 1.5)) continue;

    // Thick in the open, sparse under a closed canopy — the inverse of the
    // tree scatter, from the same density field.
    const density = forestDensity(x, z);
    if (hash2(i, 2, 43) > 1 - density * 0.62) continue;

    const y = terrainHeight(x, z);
    if (y > 26) continue; // above the treeline it's rock and snow
    if (slopeAt(x, z) > 0.75) continue; // bare rock, not meadow

    const h = 0.55 + hash2(i, 3, 44) * 0.75;
    const w = 0.9 + hash2(i, 4, 45) * 0.8;
    dummy.position.set(x, y - 0.05, z); // sunk slightly so cards never float
    dummy.rotation.set(0, hash2(i, 5, 46) * Math.PI * 2, 0);
    dummy.scale.set(w, h, w);
    dummy.updateMatrix();
    mesh.setMatrixAt(n, dummy.matrix);

    // Slight per-clump tint: yellower in the open, deeper green in shade.
    const tint = 0.82 + hash2(i, 6, 47) * 0.36;
    color.setRGB(tint * (1.05 - density * 0.25), tint, tint * (0.9 + density * 0.1));
    mesh.setColorAt(n, color);
    n++;
  }

  // Only `n` of the budget survived the terrain/density filters — tell
  // three.js to draw exactly that many rather than leaving the tail of the
  // buffer as garbage instances at the origin.
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false;   // 17k shadow casters is not worth it
  mesh.receiveShadow = true;
  mesh.name = 'grass';
  scene.add(mesh);
}

/** Advances the grass wind animation. Called once per frame from Game. */
export function updateVegetation(dt) {
  grassUniforms.uTime.value += dt;
}

// ------------------------------------------------------------------- rocks

function scatterRocks(scene, grid) {
  const spots = [];
  for (let gx = WORLD.minX + 8; gx < WORLD.maxX - 8; gx += 17) {
    for (let gz = WORLD.minZ + 8; gz < WORLD.maxZ - 8; gz += 17) {
      const ix = Math.round(gx * 3), iz = Math.round(gz * 3);
      const x = gx + (hash2(ix, iz, 11) - 0.5) * 15;
      const z = gz + (hash2(ix, iz, 12) - 0.5) * 15;
      if (hash2(ix, iz, 13) > 0.45) continue;
      if (Math.hypot(x, z) < SPAWN_CLEARING_RADIUS * 0.7) continue;
      if (inLake(x, z, 2)) continue;
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
