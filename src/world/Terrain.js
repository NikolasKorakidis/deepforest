import * as THREE from 'three';
import { terrainHeight, pathX, fbm, smoothstep, WORLD } from './heightfield.js';

/**
 * Builds the terrain mesh from the shared heightfield, with vertex colors:
 * grass in the valley, dirt on the path, rock on slopes, snow up high.
 */
export function createTerrain() {
  const segs = 220;
  const geo = new THREE.PlaneGeometry(WORLD.sizeX, WORLD.sizeZ, segs, segs);
  geo.rotateX(-Math.PI / 2);
  geo.translate(WORLD.centerX, 0, WORLD.centerZ);

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();

  const nrm = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const grassA = new THREE.Color(0x2d4020);
  const grassB = new THREE.Color(0x3a4d24);
  const dirt = new THREE.Color(0x5a4a33);
  const rock = new THREE.Color(0x63656a);
  const snow = new THREE.Color(0xdfe6ec);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    c.copy(grassA).lerp(grassB, fbm(x * 0.05, z * 0.05, 2, 7));
    const slope = 1 - nrm.getY(i);
    c.lerp(rock, smoothstep(0.12, 0.3, slope));
    c.lerp(snow, smoothstep(17, 24, y) * (1 - smoothstep(0.2, 0.4, slope)));
    const dp = Math.abs(x - pathX(z));
    c.lerp(dirt, (1 - smoothstep(1.6, 4.5, dp)) * 0.8);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}
