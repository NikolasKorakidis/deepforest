import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { terrainHeight } from './heightfield.js';

// The lake surface: three.js's own `Water` object (the classic mirror-
// reflection + normal-mapped ripple shader from the official ocean demo) —
// a real render-to-texture reflection of the sky, trees and shore, not a
// tinted static material. The normal map it distorts the reflection with is
// generated procedurally on a canvas (sum of a few tileable sine waves,
// same technique as the old per-vertex ripple this replaces) rather than a
// downloaded texture, keeping with the rest of the world (heightfield.js,
// glow.js, particleTextures.js) having no external image assets.
//
// A separate "shore blend" ring — vertices sampled straight from
// terrainHeight so it hugs the actual slope — sits just outside the water
// and fades a dark wet-sand tint into the dry ground, so the lake doesn't
// read as a flat disc dropped onto the terrain.

function makeWaterNormalTexture(size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);

  // Height field as a sum of sine waves with integer-cycle frequencies (so
  // it tiles seamlessly at the canvas edges), then finite-differenced into
  // a tangent-space normal map. Several non-aligned frequencies/directions
  // keep it from reading as a repeating grid.
  const waves = [
    { fx: 3, fy: 5, amp: 1.0, phase: 0.4 },
    { fx: -6, fy: 2, amp: 0.55, phase: 2.1 },
    { fx: 8, fy: -7, amp: 0.35, phase: 1.0 },
    { fx: -4, fy: -9, amp: 0.25, phase: 3.4 },
    { fx: 13, fy: 4, amp: 0.15, phase: 0.9 },
  ];
  const height = (u, v) => {
    let h = 0;
    for (const w of waves) {
      h += w.amp * Math.sin(2 * Math.PI * (w.fx * u + w.fy * v) + w.phase);
    }
    return h;
  };

  const eps = 1 / size;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const hL = height(u - eps, v), hR = height(u + eps, v);
      const hD = height(u, v - eps), hU = height(u, v + eps);
      const dx = (hR - hL) / (2 * eps);
      const dy = (hU - hD) / (2 * eps);
      // Tangent-space normal from the height gradient; z dominates (mostly
      // flat, gently perturbed) for a calm lake rather than choppy water.
      const n = new THREE.Vector3(-dx * 0.06, -dy * 0.06, 1).normalize();
      const i = (y * size + x) * 4;
      img.data[i] = (n.x * 0.5 + 0.5) * 255;
      img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeShoreGradientTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(36,30,22,0.6)');   // dark wet sand/mud, right at the water
  g.addColorStop(0.45, 'rgba(58,50,36,0.3)');
  g.addColorStop(1, 'rgba(58,50,36,0)');     // fully faded into dry ground
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/** Ring geometry whose vertices sample real terrain height, so the shore
 *  decal hugs the actual (sloped) basin instead of floating flat. */
function makeShoreRingGeometry(cx, cz, innerR, outerR, segments = 64) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const cos = Math.cos(a), sin = Math.sin(a);
    for (const [r, v] of [[innerR, 0], [outerR, 1]]) {
      const x = cx + cos * r;
      const z = cz + sin * r;
      positions.push(x, terrainHeight(x, z) + 0.04, z);
      uvs.push(i / segments, v);
    }
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    indices.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * @param x,z      lake center
 * @param waterY   flat water-surface height
 * @param flatRadius   radius of the flat lake bottom (matches terrainHeight's
 *   own basin-carve falloff start) — the water plane's edge sits exactly
 *   here, so it can't ever poke out over dry land.
 */
export function createWaterSurface({ x, z, waterY, flatRadius }) {
  const geometry = new THREE.CircleGeometry(flatRadius, 64);
  const normalMap = makeWaterNormalTexture();

  const water = new Water(geometry, {
    textureWidth: 1024,
    textureHeight: 1024,
    waterNormals: normalMap,
    sunDirection: new THREE.Vector3(0, 1, 0),
    sunColor: 0xffffff,
    waterColor: 0x0c3542,
    distortionScale: 2.2, // a calm lake, not an ocean swell (default is 20)
    fog: true,
  });
  water.material.uniforms.size.value = 3.2; // tiles the ripple normal map to a lake-appropriate scale
  water.rotation.x = -Math.PI / 2;
  water.position.set(x, waterY, z);
  water.receiveShadow = true;

  return water;
}

/** Called every frame: advances the ripple animation and keeps the specular
 *  highlight tracking wherever the sun/moon actually is. */
export function updateWaterSurface(water, dt, sun) {
  water.material.uniforms['time'].value += dt;
  const u = water.material.uniforms;
  u['sunDirection'].value.subVectors(sun.position, sun.target.position).normalize();
  u['sunColor'].value.copy(sun.color);
}

/** The soft wet-sand ring bridging the water's edge into dry terrain. */
export function createShoreBlend({ x, z, innerRadius, outerRadius }) {
  const geometry = makeShoreRingGeometry(x, z, innerRadius, outerRadius);
  const material = new THREE.MeshStandardMaterial({
    map: makeShoreGradientTexture(),
    transparent: true,
    roughness: 0.85,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}
