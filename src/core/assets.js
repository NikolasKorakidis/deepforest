import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Thin async wrapper around GLTFLoader plus a helper to normalize a loaded
// model: recenters on its footprint, drops it onto y=0, uniformly scales it
// to a target longest-side size, and enables shadows. Returns a fresh Group
// so the caller can position/rotate it freely.

const loader = new GLTFLoader();
const cache = new Map();

export function loadGLTF(url) {
  if (!cache.has(url)) {
    cache.set(url, new Promise((resolve, reject) => {
      loader.load(url, resolve, undefined, reject);
    }));
  }
  return cache.get(url);
}

/**
 * @param scene        model root (gltf.scene)
 * @param targetSize   desired longest bounding-box dimension, in world units
 * @param opts.ground  true (default): sit the base on y=0 (world props).
 *                     false: center on all axes (viewmodels held in hand).
 * @param opts.shadows enable shadow casting/receiving (default true)
 * @returns Group scaled to targetSize, shadow-casting
 */
export function normalizeModel(scene, targetSize, { ground = true, shadows = true } = {}) {
  const wrapper = new THREE.Group();
  wrapper.add(scene);

  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const longest = Math.max(size.x, size.y, size.z) || 1;
  const scale = targetSize / longest;

  // Recenter horizontally; either drop the base to y=0 or center vertically.
  scene.position.set(-center.x, ground ? -box.min.y : -center.y, -center.z);
  wrapper.scale.setScalar(scale);

  if (shadows) {
    wrapper.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }

  return wrapper;
}
