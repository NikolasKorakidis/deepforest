import './style.css';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { loadGLTF } from '../core/assets.js';
import fpsHandsUrl from '../assets/models/fps_hands.glb?url';

// Standalone weapon-viewmodel tuner: white background, just the held
// hands+rifle model, camera-relative like in the real game (parented to
// the camera, so drag-to-look proves it stays glued to the screen the
// same way it does in Weapon.js), with live UI controls for every number
// that matters and a "copy settings" button that generates a ready-to-
// paste code block matching Weapon.js's format exactly.

// Defaults mirror the current values in src/player/Weapon.js — keep
// these in sync if you change the shipped defaults there.
const DEFAULTS = {
  scale: 0.42,
  mirrorX: true,
  rotYDeg: 180,
  hip: { x: 0.1, y: -0.15, z: -0.42 },
  aim: { x: 0, y: -0.05, z: -0.3 },
  flash: { x: -0.03, y: 0.04, z: -0.34 },
};

const state = JSON.parse(JSON.stringify(DEFAULTS));
state.mode = 'hip'; // 'hip' | 'aim' — which position set is being edited/previewed

// ---------------------------------------------------------------- scene
const container = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

// Same FOV/near-plane as the real game (Game.js) so scale/position tuned
// here transfers directly.
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.08, 100);
camera.rotation.order = 'YXZ';
scene.add(camera);

const ambient = new THREE.AmbientLight(0xffffff, 0.8);
scene.add(ambient);
const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(2, 3, 2);
scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.6);
fill.position.set(-2, 1, -1);
scene.add(fill);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------------------------------- drag-to-look
// No pointer lock needed for a static tuning scene — plain drag is enough
// to confirm the viewmodel stays glued to the screen as you look around,
// same as it does in-game (it's parented to the camera there too).
let dragging = false, lastX = 0, lastY = 0, yaw = 0, pitch = 0;
renderer.domElement.addEventListener('mousedown', (e) => {
  dragging = true; lastX = e.clientX; lastY = e.clientY;
});
window.addEventListener('mouseup', () => { dragging = false; });
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  yaw -= (e.clientX - lastX) * 0.005;
  pitch -= (e.clientY - lastY) * 0.005;
  pitch = Math.max(-1.5, Math.min(1.5, pitch));
  lastX = e.clientX; lastY = e.clientY;
  camera.rotation.set(pitch, yaw, 0);
});

const hint = document.createElement('div');
hint.id = 'viewport-hint';
hint.textContent = 'Drag to look around — the model should stay glued to the screen.';
document.body.appendChild(hint);

// ------------------------------------------------------------- weapon
const rifleGroup = new THREE.Group();
camera.add(rifleGroup);

let model = null;
let mixer = null;
let flashSprite = null;
let flashLight = null;

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

loadGLTF(fpsHandsUrl).then((gltf) => {
  model = cloneSkinned(gltf.scene);
  applyModelTransform();
  rifleGroup.add(model);

  mixer = new THREE.AnimationMixer(model);
  const idleClip = THREE.AnimationClip.findByName(gltf.animations, 'Rig|SRifle_Idle');
  if (idleClip) mixer.clipAction(idleClip).play();

  flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture(), color: 0xffcc77, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  flashSprite.scale.setScalar(0.4);
  flashSprite.visible = false;
  rifleGroup.add(flashSprite);

  flashLight = new THREE.PointLight(0xffaa55, 0, 8, 2);
  rifleGroup.add(flashLight);

  applyFlashTransform();
  applyPositionForMode();
}).catch((err) => {
  console.error('Failed to load fps_hands.glb:', err);
  hint.textContent = 'Failed to load model — see console.';
  hint.style.color = '#c00';
});

function applyModelTransform() {
  if (!model) return;
  const s = state.scale;
  model.scale.set(state.mirrorX ? -s : s, s, s);
  model.rotation.y = (state.rotYDeg * Math.PI) / 180;
}

function applyPositionForMode() {
  const p = state.mode === 'hip' ? state.hip : state.aim;
  rifleGroup.position.set(p.x, p.y, p.z);
}

function applyFlashTransform() {
  if (!flashSprite) return;
  flashSprite.position.set(state.flash.x, state.flash.y, state.flash.z);
  flashLight.position.copy(flashSprite.position);
}

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  if (mixer) mixer.update(dt);
  renderer.render(scene, camera);
});

// ------------------------------------------------------------- panel UI
const panel = document.createElement('div');
panel.id = 'panel';
panel.innerHTML = `
  <h1>Weapon Viewmodel Tuner</h1>
  <p class="sub">White background, camera-relative viewmodel — drag the
  canvas to look around. Adjust below, then copy the settings into
  <code>src/player/Weapon.js</code>.</p>

  <h2>Editing position for</h2>
  <div class="mode-toggle">
    <label><input type="radio" name="mode" value="hip" checked><span>Hip (HIP_POS)</span></label>
    <label><input type="radio" name="mode" value="aim"><span>Aim (AIM_POS)</span></label>
  </div>

  <h2>Position (x, y, z)</h2>
  ${row('pos-x', 'X', -1, 1, 0.005)}
  ${row('pos-y', 'Y', -1, 1, 0.005)}
  ${row('pos-z', 'Z', -1.5, 0, 0.005)}

  <h2>Model</h2>
  ${row('scale', 'Scale', 0.1, 1.2, 0.005)}
  <div class="checkbox-row"><input type="checkbox" id="mirror-x" checked><label for="mirror-x">Mirror X (fixes left-handed grip)</label></div>
  ${row('rot-y', 'Rotation Y (deg)', -180, 180, 1)}

  <h2>Muzzle flash</h2>
  ${row('flash-x', 'X', -0.3, 0.3, 0.005)}
  ${row('flash-y', 'Y', -0.3, 0.3, 0.005)}
  ${row('flash-z', 'Z', -0.6, 0.1, 0.005)}
  <button class="secondary" id="test-fire">Test Fire (flash preview)</button>

  <h2>Export</h2>
  <button id="copy-btn">Copy settings for Weapon.js</button>
  <div id="copy-status"></div>
  <textarea id="code-output" readonly spellcheck="false"></textarea>
  <button class="secondary" id="reset-btn">Reset to current game defaults</button>
`;
document.body.appendChild(panel);

function row(id, label, min, max, step) {
  return `
    <div class="row">
      <label>${label}</label>
      <input type="range" id="${id}-range" min="${min}" max="${max}" step="${step}">
      <input type="number" id="${id}-num" min="${min}" max="${max}" step="${step}">
    </div>`;
}

// Wire a range+number pair together, both driving the same getter/setter.
function bindPair(id, get, set) {
  const rangeEl = document.getElementById(`${id}-range`);
  const numEl = document.getElementById(`${id}-num`);
  rangeEl.value = get();
  numEl.value = get();
  const onChange = (v) => {
    set(v);
    rangeEl.value = v;
    numEl.value = v;
  };
  rangeEl.addEventListener('input', () => onChange(+rangeEl.value));
  numEl.addEventListener('input', () => onChange(+numEl.value));
}

function currentPos() { return state.mode === 'hip' ? state.hip : state.aim; }

function refreshPositionInputs() {
  const p = currentPos();
  document.getElementById('pos-x-range').value = p.x;
  document.getElementById('pos-x-num').value = p.x;
  document.getElementById('pos-y-range').value = p.y;
  document.getElementById('pos-y-num').value = p.y;
  document.getElementById('pos-z-range').value = p.z;
  document.getElementById('pos-z-num').value = p.z;
}

bindPair('pos-x', () => currentPos().x, (v) => { currentPos().x = v; applyPositionForMode(); });
bindPair('pos-y', () => currentPos().y, (v) => { currentPos().y = v; applyPositionForMode(); });
bindPair('pos-z', () => currentPos().z, (v) => { currentPos().z = v; applyPositionForMode(); });

bindPair('scale', () => state.scale, (v) => { state.scale = v; applyModelTransform(); });
bindPair('rot-y', () => state.rotYDeg, (v) => { state.rotYDeg = v; applyModelTransform(); });

document.getElementById('mirror-x').addEventListener('change', (e) => {
  state.mirrorX = e.target.checked;
  applyModelTransform();
});

bindPair('flash-x', () => state.flash.x, (v) => { state.flash.x = v; applyFlashTransform(); });
bindPair('flash-y', () => state.flash.y, (v) => { state.flash.y = v; applyFlashTransform(); });
bindPair('flash-z', () => state.flash.z, (v) => { state.flash.z = v; applyFlashTransform(); });

for (const radio of document.querySelectorAll('input[name="mode"]')) {
  radio.addEventListener('change', (e) => {
    state.mode = e.target.value;
    refreshPositionInputs();
    applyPositionForMode();
  });
}

let fireTimeout = null;
document.getElementById('test-fire').addEventListener('click', () => {
  if (!flashSprite) return;
  flashSprite.visible = true;
  flashLight.intensity = 14;
  clearTimeout(fireTimeout);
  fireTimeout = setTimeout(() => {
    flashSprite.visible = false;
    flashLight.intensity = 0;
  }, 120);
});

function generateCode() {
  const r3 = (n) => Math.round(n * 1000) / 1000;
  return `const MODEL_SCALE = ${r3(state.scale)};
const HIP_POS = new THREE.Vector3(${r3(state.hip.x)}, ${r3(state.hip.y)}, ${r3(state.hip.z)});
const AIM_POS = new THREE.Vector3(${r3(state.aim.x)}, ${r3(state.aim.y)}, ${r3(state.aim.z)});

// inside _buildViewmodels(), on the loaded model:
model.scale.set(${state.mirrorX ? `-MODEL_SCALE` : `MODEL_SCALE`}, MODEL_SCALE, MODEL_SCALE);
model.rotation.y = ${state.rotYDeg === 180 ? 'Math.PI' : state.rotYDeg === 0 ? '0' : `${r3((state.rotYDeg * Math.PI) / 180)} // ${state.rotYDeg}°`};

// muzzle flash + light position:
this.flash.position.set(${r3(state.flash.x)}, ${r3(state.flash.y)}, ${r3(state.flash.z)});
this.flashLight.position.set(${r3(state.flash.x)}, ${r3(state.flash.y)}, ${r3(state.flash.z + 0.02)});
`;
}

const output = document.getElementById('code-output');
const status = document.getElementById('copy-status');
document.getElementById('copy-btn').addEventListener('click', async () => {
  const code = generateCode();
  output.value = code;
  try {
    await navigator.clipboard.writeText(code);
    status.textContent = 'Copied to clipboard ✓';
  } catch {
    status.textContent = 'Could not access clipboard — select the text below and copy manually.';
  }
  setTimeout(() => { status.textContent = ''; }, 4000);
});

document.getElementById('reset-btn').addEventListener('click', () => {
  Object.assign(state, JSON.parse(JSON.stringify(DEFAULTS)));
  state.mode = document.querySelector('input[name="mode"]:checked')?.value ?? 'hip';
  document.getElementById('mirror-x').checked = state.mirrorX;
  refreshPositionInputs();
  bindAllDisplays();
  applyModelTransform();
  applyPositionForMode();
  applyFlashTransform();
});

// Re-sync every range/number pair's displayed value (used after Reset).
function bindAllDisplays() {
  const set = (id, v) => {
    document.getElementById(`${id}-range`).value = v;
    document.getElementById(`${id}-num`).value = v;
  };
  set('scale', state.scale);
  set('rot-y', state.rotYDeg);
  set('flash-x', state.flash.x);
  set('flash-y', state.flash.y);
  set('flash-z', state.flash.z);
}

// Initial code preview.
output.value = generateCode();
setInterval(() => { output.value = generateCode(); }, 500);
