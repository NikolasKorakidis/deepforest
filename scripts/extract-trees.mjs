// One-off build tool: strips the 42MB source tree diorama (kept outside
// src/ in asset-sources/, not shipped) down to just the handful of nodes
// Deep Forest actually uses (two tree species, one dead snag, the lake
// water mesh), discarding the ~2700 grass clumps and the diorama's own
// ground plane. Re-run this if asset-sources/tree_scene.glb ever changes:
//   node scripts/extract-trees.mjs
//
// Each tree instance is one top-level "Bark.NNN_XXXX" node (a direct child
// of GLTF_SceneRootNode) that already contains everything needed: its bark
// mesh as a direct child, and — for leafy variants — a nested
// "Leaves.NNN_YYYY" child one level deeper holding the leaves mesh. So we
// don't need to reassemble anything; we just find the right whole subtree
// per species (by vertex-count signature, not by name — glTF node names in
// this file are non-unique, and three.js's GLTFLoader silently strips dots
// from them on load, so names that look distinct in the browser console
// aren't reliable identifiers against the raw file) and keep it intact.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup } from '@gltf-transform/functions';

const VCOUNTS = { bigBark: 2286, bigLeaves: 3648, smallBark: 279, smallLeaves: 3060, water: 94 };

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read('asset-sources/tree_scene.glb');
const root = doc.getRoot();

const scene = root.listScenes()[0];
const topLevelGroup = scene.listChildren()[0].listChildren()[0].listChildren()[0]; // GLTF_SceneRootNode
const instances = topLevelGroup.listChildren(); // ~2700 Bark.N / Grass_* / Water / Ground siblings

function subtreeVcounts(node) {
  const counts = [];
  (function walk(n) {
    const mesh = n.getMesh();
    if (mesh) {
      const prim = mesh.listPrimitives()[0];
      if (prim) counts.push(prim.getAttribute('POSITION').getCount());
    }
    for (const c of n.listChildren()) walk(c);
  })(node);
  return counts;
}

function findInstance(matchFn) {
  const found = instances.find((node) => matchFn(subtreeVcounts(node)));
  if (!found) throw new Error(`No instance matched: ${matchFn}`);
  return found;
}

const setEq = (a, b) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

const big = findInstance((vc) => setEq(vc, [VCOUNTS.bigBark, VCOUNTS.bigLeaves]));
const small = findInstance((vc) => setEq(vc, [VCOUNTS.smallBark, VCOUNTS.smallLeaves]));
const dead = findInstance((vc) => setEq(vc, [VCOUNTS.smallBark]));
const water = findInstance((vc) => setEq(vc, [VCOUNTS.water]));

big.setName('Big');
small.setName('Small');
dead.setName('Dead');
water.setName('Water');

const keep = new Set([big, small, dead, water]);

// listChildren() is a live array — snapshot before disposing, or removing
// one entry shifts the rest and a plain for..of silently skips siblings.
for (const node of [...instances]) {
  if (!keep.has(node)) node.dispose();
}

await doc.transform(prune(), dedup());

await io.write('src/assets/models/tree_assets.glb', doc);
console.log('Wrote src/assets/models/tree_assets.glb');
