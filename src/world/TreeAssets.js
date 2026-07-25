import * as THREE from 'three';
import { loadGLTF } from '../core/assets.js';
import treeSceneUrl from '../assets/models/tree_assets.glb?url';

// tree_assets.glb is a pre-trimmed asset: the original source is one
// hand-built 42MB diorama (lake + ~2700 grass clumps + 23 tree instances,
// kept in asset-sources/ outside the shipped bundle), not a modular kit.
// scripts/extract-trees.mjs strips that down to four named subtrees — two
// tree species, a leafless "dead tree" variant, and the lake's water mesh —
// discarding the grass clumps and the diorama's own ground plane (our own
// terrain and instancing already cover that). Of those four, only the three
// tree species are actually used here; the water subtree is still present
// in the trimmed GLB (harmless, just unused) but the lake surface itself is
// a fully procedural reflective Water object instead — see Water.js.
//
// The raw meshes are authored lying flat (long axis along Z) and stood
// upright per-instance via a 90°-around-X rotation on the parent node; we
// bake that same rotation in once here, then recenter so the trunk base
// sits at local y=0 — matching the convention our own procedural trees
// used, so the existing placement/instancing code needs no changes.

// Names assigned by scripts/extract-trees.mjs when it trimmed the source
// file — the raw glTF node names are non-unique and unreliable to look up
// directly (see that script for why).
const NODE_NAMES = { big: 'Big', small: 'Small', dead: 'Dead' };

function findMeshes(node) {
  let bark = null, leaves = null;
  node.traverse((o) => {
    if (!o.isMesh) return;
    if (o.material.name === 'Bark') bark = o;
    else if (o.material.name === 'Leaves') leaves = o;
  });
  return { bark, leaves };
}

function standAndRecenter(...geometries) {
  for (const g of geometries) g.rotateX(Math.PI / 2);
  const box = new THREE.Box3();
  for (const g of geometries) {
    g.computeBoundingBox();
    box.union(g.boundingBox);
  }
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  for (const g of geometries) g.translate(-cx, -box.min.y, -cz);
  return box.max.y - box.min.y;
}

function extractSpecies(root, nodeName) {
  const node = root.getObjectByName(nodeName);
  const { bark, leaves } = findMeshes(node);
  const barkGeo = bark.geometry.clone();
  const leavesGeo = leaves ? leaves.geometry.clone() : null;
  const naturalHeight = leavesGeo
    ? standAndRecenter(barkGeo, leavesGeo)
    : standAndRecenter(barkGeo);
  return {
    barkGeo, leavesGeo,
    barkMat: bark.material, leavesMat: leaves ? leaves.material : null,
    naturalHeight,
  };
}

let cached = null;

/** Loads (once) and returns { big, small, dead }. The diorama's own water
 *  mesh (still present in the source GLB) isn't extracted — the lake
 *  surface is a fully procedural reflective Water object (see Water.js). */
export function loadTreeAssets() {
  if (!cached) {
    cached = loadGLTF(treeSceneUrl).then((gltf) => {
      const root = gltf.scene;
      const big = extractSpecies(root, NODE_NAMES.big);
      const small = extractSpecies(root, NODE_NAMES.small);
      const dead = extractSpecies(root, NODE_NAMES.dead);

      return { big, small, dead };
    });
  }
  return cached;
}
