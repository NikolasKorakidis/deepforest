import * as THREE from 'three';

// The lake's water surface: a MeshStandardMaterial (so it still picks up
// sun/hemi lighting, shadows and scene fog like everything else) extended
// via onBeforeCompile with a cheap animated ripple and a Fresnel rim, so the
// lake reads as moving water instead of a static tinted disc. No textures —
// kept procedural, same as the rest of the world (heightfield.js, glow.js).
//
// Displacement/slope are computed from world-space XZ (via modelMatrix)
// rather than local mesh coordinates, so the same wave frequencies look
// right whether they're driving the tiny placeholder circle or the loaded
// lake-shore mesh, whatever its own local coordinate scale happens to be.

export function createWaterMaterial() {
  const uniforms = { uTime: { value: 0 } };

  const material = new THREE.MeshStandardMaterial({
    color: 0x1f4f63,
    roughness: 0.07,
    metalness: 0.05,
    transparent: true,
    opacity: 0.87,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        varying float vWave;`
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        {
          vec3 wPos = (modelMatrix * vec4(position, 1.0)).xyz;
          float dWdx = cos(wPos.x * 0.9 + uTime * 1.4) * 0.9 * 0.05
                     + cos(wPos.x * 0.4 + wPos.z * 1.3 - uTime * 1.8) * 0.4 * 0.035;
          float dWdz = cos(wPos.z * 1.3 - uTime * 1.8 + wPos.x * 0.4) * 1.3 * 0.035;
          objectNormal = normalize(objectNormal + vec3(-dWdx, 0.0, -dWdz));
        }`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 wPos = (modelMatrix * vec4(position, 1.0)).xyz;
          float wave1 = sin(wPos.x * 0.9 + uTime * 1.4) * 0.05;
          float wave2 = sin(wPos.z * 1.3 - uTime * 1.8 + wPos.x * 0.4) * 0.035;
          transformed.y += wave1 + wave2;
          vWave = wave1 + wave2;
        }`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vWave;`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float fresnel = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 3.0);
          totalEmissiveRadiance += fresnel * vec3(0.55, 0.7, 0.75) * 0.55;
          totalEmissiveRadiance += smoothstep(0.055, 0.09, vWave) * vec3(0.5, 0.55, 0.5) * 0.4;
        }`
      );
  };

  material.userData.uniforms = uniforms;
  return material;
}

export function updateWaterMaterial(material, t) {
  material.userData.uniforms.uTime.value = t;
}
