# Deep Forest

A browser-based first-person survival slice built with **Three.js** and **Vite**.
You wake beside a crashed helicopter in a remote valley — injured, cold and
hungry — and must follow the valley north to a trail marker while managing
survival stats, building fires to get through the freezing nights, and
surviving the wolves.

The world is procedural or primitive-based and there are no audio files
(sound effects are synthesized with WebAudio). Five external assets are used —
the crashed-helicopter model, an animated first-person hands+rifle rig (the
held viewmodel), a simpler rifle model for the ground pickup only, the
animated wolf, and a real low-poly tree model (forest + lake) — all in
`src/assets/models/`, loaded at runtime with three.js's `GLTFLoader`.

## Run it

```bash
npm install
npm run dev        # then open http://localhost:5173
```

`npm run build` produces a static bundle in `dist/`.

`asset-sources/` and `scripts/extract-trees.mjs` are asset-pipeline tooling,
not part of the running game — see the tree/lake design note below.

## Controls

| Key | Action |
| --- | --- |
| WASD / Mouse | Move / look (click to capture the mouse) |
| Shift | Sprint (drains energy) |
| E | Interact / pick up |
| LMB | Fire rifle (hip or aimed, animated) |
| RMB (hold) | Aim down the scope; with binoculars equipped, long-range zoom |
| R | Reload (quick or full, depending on how empty the mag is) |
| 1 / 2 | Equip rifle / binoculars |
| F | Eat a ration |
| T | Build a campfire (costs 3 wood) |
| E (at a lit fire) | Open the cook/sleep wheel |
| Esc | Pause (releases the mouse) |

## Gameplay loop

1. **Crash site** — scavenge the wreck: rifle + 2 magazines, compass,
   binoculars, and a ration pack.
2. **Head north** — the dirt path winds up the valley. Gather fallen branches
   (firewood) as you go.
3. **Stats tick down** — hunger, thirst and energy drain over time; warmth
   drops hard at night and at altitude. Empty bars bleed health. Eat rations
   (F), drink at the lake halfway up the valley, and build a campfire (T)
   before dark. Press E beside a lit fire to open a cook/sleep wheel: Cook
   (eat a ration for a bigger restore than raw, if you have one) or Sleep
   (skips to first light — only available once it's dim enough out; burns
   the fire down to embers).
4. **Wolves** — three dens sit along the route. Wolves wander/sit near home,
   detect you at range (farther at night — watch for the eyes), close in at
   a run, then drop to a stalking creep right before lunging. Three rifle
   hits put one down. You can also just outrun them.
5. **The trail marker** — an orange flag at the head of the valley ends the
   slice (~15–25 minutes for a focused run; slower if you explore).

## Code layout

```
src/
  main.js                 entry point
  core/
    Game.js               orchestrator: renderer, loop, meta state machine
    config.js             all tuning knobs (day length, stat rates, wolf, fire)
    Input.js              keyboard/mouse + pointer lock
    SpatialGrid.js        static circle colliders (trees/rocks/wreck)
    sfx.js                procedural WebAudio sound effects
    glow.js               shared glow-sprite texture helper
    assets.js             async GLTF loader + model normalize (scale/ground/shadows)
  assets/
    models/               .glb models (crashed helicopter, rifle, wolf, tree_assets)
  world/
    heightfield.js        the terrain function — single source of truth for ground height
    Terrain.js            terrain mesh + vertex-color painting
    Vegetation.js         instanced trees/rocks, registered as colliders
    TreeAssets.js         extracts tree species + lake water mesh from tree_assets.glb
    Environment.js        day-night cycle: sun/moon, sky, fog, stars
    Level.js              hand-placed content: wreck, loot, lake, signs, checkpoint
  player/
    PlayerController.js   FPS movement, collision, head bob
    PlayerStats.js        health/hunger/thirst/warmth/energy simulation
    Weapon.js             animated hands+rifle viewmodel, binoculars, hitscan, ammo
  entities/
    Wolf.js               animated wolf model (GLTF skeletal anims) + state-machine AI
  systems/
    Interaction.js        proximity "[E] do thing" prompts
    Campfire.js           fire building, warmth radius, burn-down
  items/
    Inventory.js          wood/rations counts + equipment flags
  ui/
    HUD.js + style.css    DOM HUD: bars, compass, toasts, overlays, menus
```

Design notes:

- `heightfield.js` is pure math (no three.js). The mesh, the player, the
  wolves, item placement and vegetation all sample the same function, so
  nothing ever floats or sinks.
- Collision is 2D circle push-out against a spatial hash of static obstacles —
  no physics engine needed at this scope.
- All balance lives in `core/config.js`.
- The wolf GLB ships 5 clips (`01_Run`, `02_walk`, `03_creep`, `04_Idle`,
  `05_site`) with no root motion (position tracks are all per-bone, not on a
  moving root), so they layer cleanly on top of our own position/facing code.
  Each wolf instance clones the shared skeleton via three's `SkeletonUtils`
  (a plain clone would make all wolves share — and fight over — one
  skeleton) and picks a clip per AI state: walk while wandering/returning,
  run while closing distance in a chase, and creep once within lunging
  range for a stalking beat before the bite; idle alternates with an
  occasional sit for variety. The model's real "eyes" material drives the
  night-glow effect instead of a bolted-on glow sprite.
- The tree/lake source is one 42MB hand-built diorama (kept outside the repo
  bundle in `asset-sources/`, not shipped), not a modular kit — there's no
  "Tree" prefab to just drop in, and it also carries ~2700 individually
  placed grass clumps we don't use. `scripts/extract-trees.mjs`
  (`node scripts/extract-trees.mjs`, uses `@gltf-transform/*`) identifies the
  two tree species, a leafless "dead tree" variant, and the lake's water
  mesh by vertex-count signature (glTF node names in this file are
  non-unique, and three.js silently disambiguates/strips them on load, so
  they aren't a reliable way to find things in the raw file) and writes a
  trimmed `tree_assets.glb` (~5MB) with just those four subtrees.
  `world/TreeAssets.js` loads that trimmed file once, bakes in the
  90°-around-X rotation the raw meshes need to stand upright, and recenters
  each species so its trunk base sits at local origin — matching the
  convention the old procedural trees used, so `Vegetation.js`'s
  placement/instancing code didn't need to change, just what geometry it
  instances. The lake itself replaced the old small circular pond: the
  basin in `heightfield.js` was widened and pushed further off the path, and
  a hand-placed ring of real trees (`Level.js#_buildLakeTrees`) surrounds it
  for a set-piece look distinct from the ambient forest.
- The held rifle viewmodel is a rigged hands+weapon GLB with six authored
  clips (`SRifle_Idle`, `SRifle_Walk`, `SRifle_Shot_nosight`,
  `SRifle_Shot_sight`, `SRifle_Reload`, `SRifle_Reload_Full`) driving the
  motion, replacing the old hand-rolled sway/bob/recoil math — `Weapon.js`
  picks a clip by state: idle when still, walk when moving (its
  `timeScale` scales with actual speed, so sprinting plays the same clip
  faster rather than needing a separate run clip), the hip- or
  scope-aimed shot clip depending on whether RMB is held, and — reading
  the two reload clips' actual intent — a quick tactical `Reload` when the
  mag still has rounds vs. the longer `Reload_Full` (with more bolt-work)
  when it's run completely dry; `reloadT` is set directly from whichever
  clip's own duration, not a separate tuned number, so gameplay and
  animation can't drift out of sync. `fireCooldown` in `config.js` was
  bumped from 0.55s to 0.85s to feel deliberate rather than sluggish
  against the shot clips' recoil timing. The model is authored at
  real-world (forearm) scale, ~40× too large for a viewmodel at the
  distance we render it — `MODEL_SCALE` in `Weapon.js` corrects for that.
  Getting the orientation right took two separate fixes, diagnosed with
  the model temporarily detached into world space and viewed from a
  distant free camera (much easier to read than the tight first-person
  framing): the source rig is left-handed (the left hand sits on the
  trigger, the right on the forestock — confirmed by comparing
  `Hand_L`/`Hand_R` bone world positions), fixed by mirroring on X rather
  than rotating, since a rotation can't fix handedness and a 180° attempt
  visibly broke the hand pose; separately, the barrel points along the
  model's local +X rather than the camera's forward -Z, so the muzzle
  aimed back at the player until a 90° yaw (not 180° — verified by
  scanning multiple angles from the detached view before committing)
  brought it around to point into the world. The muzzle flash position
  was found by bounding-box probing rather than guesswork (the source
  mesh has no named "muzzle" socket), redone after the 90° yaw since it
  moved the barrel tip's local coordinates. The ground-lying pickup prop
  still uses the old, simpler standalone rifle model — a full arms rig
  doesn't make sense lying in the grass with no
  body attached.

## Known limitations

- Wolves ignore obstacles (they can walk through trees) and have no
  line-of-sight check — detection is radius-based.
- Terrain collision is "walk anywhere" — steep slopes slow you down only
  visually; there is no cliff blocking beyond the valley walls being tall.
- Campfires can be built on any ground, including steep or wet spots.
- The pond is the only water source; no waterborne risk, no bottles.
- Post-processing is fog + CSS vignette/color overlays rather than a full
  EffectComposer chain (cheap and good enough at this scope).
- Sleeping doesn't check for nearby threats — wolves politely wait.
- The wolf GLB uses the legacy `KHR_materials_pbrSpecularGlossiness`
  extension, which three.js's `GLTFLoader` doesn't support — it logs a
  console warning and falls back to the base PBR values, so the model
  renders correctly but not with the exact specular look the source file
  intended.
- No death animation clip — a killed wolf just tips over (Z-axis rotation)
  and freezes rather than ragdolling or playing a proper death pose.
- Only 2 tree species + 1 dead variant come from the source diorama, reused
  everywhere — real-world forests have more variety, and up close the
  repetition is a bit more noticeable than with the old fully-procedural
  (randomly proportioned) trees.
- The rifle's scope is a solid modeled prop, not a functional see-through
  lens (that would need a separate render-to-texture pass) — the HUD
  crosshair dot is what you actually aim with, even while aiming down the
  scope.

## Suggested next steps

- **World**: extend past the marker — mountain pass (exposure/wind), second
  forest, abandoned village, extraction. The path/heightfield approach
  extends by adding segments to `pathX`/`climb`.
- **Wildlife**: birds (ambience), foxes (flee/steal), and a bear miniboss
  (see the TODO in `entities/Wolf.js` — the state machine generalizes).
- **Weather**: snow/rain fronts driving warmth and visibility.
- **Inventory UI**: a real grid, item weights, water bottles, meat + cooking
  on campfires.
- **Multiplayer**: the sim is already deterministic-terrain + explicit
  systems; a co-op layer would sync player transforms, stats events, wolf
  state and fire placement (e.g. via WebRTC or a small WebSocket server).
  Keeping game logic out of rendering code (as structured) is the main prep.
