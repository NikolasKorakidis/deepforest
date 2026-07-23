import * as THREE from 'three';
import smokeUrl from '../assets/textures/particles/smoke.png?url';

// Sprite textures for fire/spark billboards, drawn procedurally on canvas
// (same technique as glow.js's radial gradient and Environment.js's moon —
// no baked image asset needed, and it keeps the flame/ember shape tunable).
// The smoke puff is the one real photographed/painted texture in the game,
// dropped in by the user; everything else here matches its style rather
// than trying to hand-author more raster art.

let _fireTex = null;
let _sparkTex = null;
let _smokeTex = null;

export function fireTexture() {
  if (_fireTex) return _fireTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const cx = 64, cy = 78;

  // Flame silhouette: a teardrop built from two bezier lobes, narrowing to
  // a flickering tip near the top of the canvas.
  ctx.beginPath();
  ctx.moveTo(cx, 6);
  ctx.bezierCurveTo(cx + 34, 40, cx + 30, 76, cx + 22, 100);
  ctx.bezierCurveTo(cx + 14, 118, cx - 14, 118, cx - 22, 100);
  ctx.bezierCurveTo(cx - 30, 76, cx - 34, 40, cx, 6);
  ctx.closePath();
  ctx.clip();

  const g = ctx.createRadialGradient(cx, cy + 10, 2, cx, cy - 4, 74);
  g.addColorStop(0, 'rgba(255,250,220,1)');
  g.addColorStop(0.28, 'rgba(255,214,120,0.95)');
  g.addColorStop(0.55, 'rgba(255,140,40,0.85)');
  g.addColorStop(0.8, 'rgba(220,60,20,0.5)');
  g.addColorStop(1, 'rgba(180,30,10,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);

  _fireTex = new THREE.CanvasTexture(c);
  return _fireTex;
}

export function sparkTexture() {
  if (_sparkTex) return _sparkTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,240,1)');
  g.addColorStop(0.3, 'rgba(255,210,120,0.95)');
  g.addColorStop(0.7, 'rgba(255,120,40,0.4)');
  g.addColorStop(1, 'rgba(255,80,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  _sparkTex = new THREE.CanvasTexture(c);
  return _sparkTex;
}

export function smokeTexture() {
  if (_smokeTex) return _smokeTex;
  _smokeTex = new THREE.TextureLoader().load(smokeUrl);
  return _smokeTex;
}

export function makeFireSprite(scale, opacity = 1) {
  const mat = new THREE.SpriteMaterial({
    map: fireTexture(), color: 0xffffff, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(scale);
  return s;
}

export function makeSparkSprite(scale, opacity = 1) {
  const mat = new THREE.SpriteMaterial({
    map: sparkTexture(), color: 0xffffff, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(scale);
  return s;
}

export function makeSmokeSprite(color, scale, opacity = 0.35) {
  const mat = new THREE.SpriteMaterial({
    map: smokeTexture(), color, transparent: true, opacity,
    blending: THREE.NormalBlending, depthWrite: false, fog: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(scale);
  return s;
}
