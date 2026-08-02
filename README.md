# Deep Forest

A browser-based first-person **long-range shooting** game built with
**Three.js** and **Vite**. You wake beside a crashed helicopter in a forested
wilderness basin; west of the wreck, a firing lane has been cut into the
hillside with pop-up steel from 25 to 500 metres. Range them, read the wind,
and score. The survival layer — fire, food, water, the wolves that hold the
lake — is still there around the edges, but the rifle is the game.

The world is generated procedurally from a single deterministic height
function: rolling forested hills, meadows and dense woodland, a lake off to
the north-east, and a ring of steep ridges that fences the play area in
without invisible walls. Nothing about the layout is stored — the same
wilderness regenerates identically on every load.

Terrain, grass, water and every texture in the world are generated at
runtime — there are no external image assets. The models are the exception:
in `src/assets/models/`, loaded with three.js's `GLTFLoader`, are the
crashed-helicopter, an animated first-person hands+rifle rig (the held
viewmodel), a simpler rifle for the ground pickup, the animated wolf, the
low-poly trees the forest instances, a wood pile for gatherable firewood,
and a pair of binoculars used both as the ground pickup and the held
viewmodel. Two 2D textures (`src/assets/textures/`) — a sniper crosshair and
a binoculars mask — are composited into the HUD rather than the scene; see
the aiming note below.

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
| Shift | Sprint (drains energy; forces you up out of crouch/prone) |
| C (toggle) / Ctrl (hold) | Crouch — slower, lower camera, narrows wolf detection range |
| Z (toggle) | Prone — slower still, lowest profile, narrows wolf detection range the most |
| E | Interact / pick up |
| LMB | Fire rifle (hip or aimed, animated) |
| RMB (toggle) | Aim down the scope (crosshair + rangefinder once zoomed in, with sway — steadier crouched or prone); with binoculars equipped, long-range zoom |
| R | Reload (quick or full, depending on how empty the mag is; drops you out of the scope so you can see it) |
| 1 / 2 | Equip rifle / binoculars |
| F | Eat a ration |
| T | Build a campfire (costs 3 wood) |
| E (at a lit fire) | Open the cook/sleep wheel |
| Esc | Pause (releases the mouse) |

## Gameplay loop

1. **The range** — 40m west of the wreck, a cleared lane with ten pop-up
   plates at 25, 50, 75, 100, 150, 200, 250, 300, 400 and 500m, fanned ~47m
   across the lane so no two share a sightline. Three of them (150m, 300m,
   500m) stand on rises, which varies the shot and lifts those plates clear
   of the ground behind them. Plates rise, wait, and drop again, so there's
   a reason to stay on the glass and a reason to hurry. It's daylight when
   you start.
2. **Range it, then hold** — RMB scopes in; the rangefinder reads the
   distance to whatever is centred. Hold the matching BDC mark (mark 3 at
   300m, half-step ticks for 150m and 250m) and the shot lands on the plate.
   Under 100m the drop is small enough to ignore.
3. **Read the wind** — the dial top-right shows wind *relative to where
   you're looking*: straight up means it's blowing away from you, right
   means it will carry the bullet right. The windsocks down the lane say the
   same thing in the world. Under 200m wind is negligible; at 400m and 500m
   ignoring it is a clean miss.
4. **Score** — each plate is worth `10 + distance/10`, so the 500m plate pays
   about five times the 25m one. Chained hits build a multiplier up to x5;
   let six seconds lapse without a hit and it resets.
5. **The wilderness is still there** — gather wood (E at any tree), build a
   fire (T), cook and sleep at it, drink at the lake. Six wolves hold the
   water and the ridge above it; a headshot drops one instantly, a body shot
   wounds and slows it.

## Saving

The game autosaves to `localStorage` every 30 seconds — no manual save
action. Reloading the page offers **Continue** (restores position,
stats, inventory, ammo, score, day/time, and any campfires still
burning — collected pickups stay collected) or **New Game** (discards the
save). The save is cleared on death, since that isn't a state worth
continuing from.

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
    particleTextures.js   fire/spark/smoke sprite textures for fires and flares
    assets.js             async GLTF loader + model normalize (scale/ground/shadows)
    save.js               localStorage read/write for the autosave slot
    PerfScaler.js         adaptive render-resolution scaling to hold 60fps
  assets/
    models/               .glb models (helicopter, rifle, binoculars, wolf, tree_assets, wood_pile)
  world/
    heightfield.js        the terrain function — single source of truth for ground height
    Terrain.js            terrain mesh + vertex-color painting
    Vegetation.js         instanced trees/grass/rocks; trees+rocks are colliders
    TreeAssets.js         extracts tree species from tree_assets.glb
    Water.js              reflective lake surface + shoreline blend (see design note below)
    Fire.js               shared flame/ember/firelight effect (campfires + the wreck)
    Environment.js        day-night cycle: sun/moon, sky, fog, stars
    Level.js              hand-placed content: wreck, loot, lake, checkpoint
    Range.js              the shooting range: pop-up plates, scoring, windsocks
    Wind.js               wind vector — read by ballistics, grass and the HUD dial
  player/
    PlayerController.js   FPS movement, collision, head bob
    PlayerStats.js        health/hunger/thirst/warmth/energy simulation
    Weapon.js             animated hands+rifle viewmodel, binoculars, ballistic projectiles, ammo
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

## Performance

The expensive frame is the one where you crest a ridge and the whole basin
comes into frustum at once. Four things keep that at 60fps, in rough order
of how much they bought:

- **Chunked vegetation.** Trees and grass are built as one `InstancedMesh`
  per *spatial chunk* rather than one per species spanning the map. A
  world-spanning instanced mesh has a world-spanning bounding sphere, so it
  is never frustum-culled, never shadow-frustum-culled and never culled out
  of the water's reflection pass — every tree in the world was being
  processed three times a frame regardless of where you stood or looked.
  Chunked, the sun's shadow pass went from 2.50M to ~0.45M triangles.
  The two grids are sized differently on purpose: grass uses small chunks
  (25 units — one cheap draw call each, culled hard by distance), trees use
  coarse ones (70 units) because each chunk is up to six draw calls and
  small chunks just trade a geometry problem for a draw-call problem.
- **Grass distance LOD.** A vertex-shader term shrinks each clump to nothing
  between 40m and 55m, then the chunk switches off past 62m — so the pop is
  invisible, and the overdraw that alpha-tested grass generates is bounded
  to a 55m bubble instead of the whole 125m field. Drawn clumps drop from
  38,000 to roughly 5,000–18,000 depending on where you stand.
- **Throttled water reflection.** The reflection is a second full render of
  the scene, and it's nearly all waste when the lake is a distant patch, so
  it re-renders every frame within 45m, every second frame within 120m, and
  every fourth beyond, reusing the previous target in between — water is
  diffuse enough that a frame or three of staleness doesn't read. Target
  resolution also dropped from 1024² to 512², which the ripple distortion
  smears over anyway.
- **Adaptive resolution** (`core/PerfScaler.js`). The safety net: it watches
  a rolling median of frame time (median, so one GC pause doesn't drag
  quality down) and trades render scale between 0.6x and 1.5x to hold the
  target, with hysteresis and a cooldown so it can't oscillate. It also
  caps the starting pixel ratio at 1.5 rather than the device's own — on a
  2x display that was rendering four times the pixels, the cheapest thing
  in the whole frame to give up.

Smaller: the shadow camera tightened from ±60 to ±42 units, which makes
shadows simultaneously cheaper (fewer casters re-rendered) and sharper (more
texels each); and the camera's far plane came down from 900 to 420, which
spans the basin corner-to-corner and stops wasting depth precision.

One trap worth knowing if you add scenery: **three.js raycasting tests
layers but not `visible`**, so a culled chunk is still a raycast target, and
anything you add to the scene becomes something bullets and the scope
rangefinder can hit. Grass sets `mesh.raycast = () => {}` for exactly this
reason — without it a shot across a meadow stops on the first blade in front
of the muzzle and the rangefinder reads one metre instead of the hillside.

Design notes:

- Fire (`world/Fire.js`) is one effect shared by campfires and the wreck.
  What makes it read as fire rather than as a glowing sprite is that each
  flame tongue runs its own birth-to-death cycle on its own phase and speed
  — something is always flaring up while something else thins out, so the
  silhouette never repeats. The previous version scaled two fixed sprites
  with a sine wave, which reads as breathing. Tongues nearer the middle of
  the column are tinted whiter and outer ones redder, which is most of what
  gives the flame depth; embers rise and fade on their own slower cycles,
  and the light flickers on three mismatched frequencies so it doesn't
  pulse. Campfires drive the whole thing with an `intensity` that follows
  remaining fuel, so a fire running low visibly shortens and dims instead
  of snapping out. Per-fire jitter is seeded from position rather than
  `Math.random`, so a campfire restored from a save comes back with the
  flame layout it had.
- A burning wreck is three separate seats of fire rather than one big
  column, because several things alight at once is what a crash reads as —
  but only the main one carries a point light. Every point light costs
  shading work on every lit fragment in the scene whether or not it
  reaches, so the two smaller fires are lit by their neighbour and add
  none of their own; the crash site's light count is what it was when it
  was a single fake "flare" light with no flames at all. The wreck burns
  for `CONFIG.fire.wreckBurnHours` (6) in-game hours, guttering out over
  the last one and leaving the smoke column behind for the rest of the
  run. That's driven off the world clock rather than accumulated real
  seconds, because sleeping jumps the clock — measured in real time the
  wreck would still be blazing after a night had passed. Elapsed is taken
  against the fixed start of the run, so it needs no saved state of its
  own and restores correctly for free.
- Two sizing traps in the flame effect, both found by replaying the maths
  rather than by eye. Tongue *count* and tongue *lifetime* interact: an
  earlier version held each tongue at zero size for the last 17% of its
  cycle, which is invisible with seven tongues but means a three-tongue
  fire blinks out entirely whenever their dead periods coincide — so the
  cycle now swells and dies with no dead tail. And because opacity is
  driven by the same curve, a tongue spends most of its life
  part-transparent; `pow(grow, 0.55)` pulls it up to full opacity early,
  without which a whole cluster of tongues still reads dimmer than the
  single always-on sprite this replaced.
- The range lives in the main world rather than a scene of its own. A 500m
  lane does not fit in a 400m basin — the diagonal is barely long enough and
  would run straight through the crash site — so the world grew a long
  northern arm, and `heightfield.rangeCorridor` carves a dead-flat lane
  through it, cutting clean through the ridge ring that would otherwise rear
  up 60m across the far half. The ridge is left standing either side, which
  frames the lane and gives long shots a backstop. Vegetation reads the same
  corridor function, so nothing grows in the firing line — plus an explicit
  22m clearing around every target, because outer-lane plates sit out on the
  shoulder where the flattening has faded and trees are allowed again. The
  lane floor rolls gently and carries a few mounds rather than being a
  runway; the mound profile is a cosine falloff so it meets the surrounding
  floor with zero gradient instead of a crease.
- Target visibility is a light face inside a dark backing board, not just a
  pale plate — a pale plate against a pale hillside disappears, whereas the
  border silhouettes against any background. Both face and bullseye carry a
  little emissive so a plate in the ridge's shadow reads the same as one in
  full sun; without it legibility swung with the time of day.
- Fog had to be thinned hard (0.0065 to 0.0014 by day). `FogExp2` falls off
  with the *square* of distance, so the old value left a 500m plate at about
  3% visibility — the far end of the range was quite literally not there.
- Two range-geometry problems, both found by working the numbers rather than
  by looking:
  - Ten targets on one centreline meant **five of them were invisible** —
    the plate at 150m sits exactly on the line of sight to the plate at
    500m. Each target now gets its own *angular* lane, which separates them
    at any distance. The farthest target takes the centre lane and the
    nearest the outermost, which is the cheap way round: a 25m plate
    subtends ~1.3° and needs the most angular room, but converting that to
    metres at 25m costs almost nothing, whereas giving the 500m plate an
    outer lane would fling it 60m sideways. The range stays 48m wide.
  - Close plates were **unhittable**. This rifle's drop is exaggerated ~12x,
    so at 75m a shot placed dead on the aiming mark lands half a metre low —
    below a plate sized for realism, and the reticle has no mark that fine.
    Plates got a bigger base size so short range is a warm-up rather than a
    puzzle. Verified end to end by integrating the real trajectory: every
    target from 25m to 500m lands inside its plate, and 100m–500m land
    within 2cm of plate centre.
- Wind is one object read by three unrelated consumers — the bullet solver,
  the grass shader and the HUD dial. That sharing is the whole design: what
  the dial shows *is* the vector that pushes the bullet, so a player who
  learns to read it is actually right, and the grass leaning downwind is a
  second opinion on the same number rather than decoration. The dial shows
  wind relative to where you're looking rather than as a compass bearing,
  because what a shooter needs is whether it pushes left or right across
  their own sightline.
- Drift is modelled as a constant sideways acceleration, so it grows with
  the square of time of flight exactly as drop does — negligible up close,
  decisive far out. The strength was tuned against plate sizes rather than
  picked: at 5 m/s a 500m shot moves 2.5m against a 1.75m plate half-width
  (a clean miss if ignored) while a 100m shot moves 10cm. The first value
  tried drifted less than a plate half-width at *every* range, which made
  wind purely decorative — the gauge would have been lying about mattering.
- Objective text is regenerated from live state every time
  (`Level.refreshObjective`) rather than written once at each transition.
  That's what lets a counter tick as you pick things up, and it means a
  restored save shows the right line — including the right counter — without
  having to persist the text or replay the transition messages. The counters
  themselves are derived, not stored: "investigate the crash" counts how many
  of `CRASH_ITEMS` are in `takenPickups` (already saved for respawn
  suppression), so there's no second copy of that state to drift.
- Getting the player to actually *see* the wolf in that sighting took two
  changes, because the forest is dense enough that a wolf at its den is
  usually behind a trunk. First, the wolf is staged on the far shore
  directly along the player's own sightline to the lake — straight over open
  water is the one direction guaranteed to have no forest in it, so instead
  of fighting the occlusion the shot is placed where occlusion can't happen
  (and "across the water" is what the moment wants to say anyway). Second,
  the trigger is a *request*, not an event: `Level` asks every 0.3s while
  the player is near the lake and only marks it done when `Game` reports it
  actually played, which it declines to do unless a raycast confirms a clear
  line of sight. The wolf chosen to be moved is preferentially one the
  player currently *can't* see, so nobody catches it teleporting.
- The wolf sighting is a `state = 'cutscene'` the main loop drives, not a
  timeline or promise chain. Everything else in the game already keys off
  `state !== 'playing'` to freeze — the player can't move, wolves can't
  close in, stats stop ticking, menus won't open — so a cutscene gets all of
  that for free. It writes the *controller's* yaw/pitch rather than the
  camera's rotation, so when control returns the player is simply looking
  where the camera ended up with no snap, and it drains
  `input.consumeMouseDelta()` every frame — pointer lock stays on, so
  otherwise a scene's worth of unread mouse movement lands in one jolt the
  instant it ends.

- `heightfield.js` is pure math (no three.js). The mesh, the player, the
  wolves, item placement and vegetation all sample the same function, so
  nothing ever floats or sinks.
- The world is one deterministic function of `(x, z)` — three octaves of
  value-noise for the landforms, plus analytic features layered on top (the
  ridge ring that fences the basin, the flattened spawn clearing, the lake
  bed). A second, independently-seeded noise field, `forestDensity(x, z)`,
  decides how thick the woods are, and *both* the tree scatter and the
  ground tint read from it — so dense woodland genuinely looks dense from
  the canopy and from the forest floor, and clearings are real clearings
  rather than a coincidence of two unrelated random fields.
- The lake bed is deliberately **not** noise minus a bowl — it's an analytic
  bowl that overrides the terrain near the water. With a noisy bed the
  ground wanders above and below the water level around the rim, so the
  water plane's edge ends up hanging over ground that's still below it in
  some directions and buried in others — the classic "lake is a disc
  floating on the map" seam. Here `POND_WATER_Y` is *defined* as the bed
  height at exactly `POND_RADIUS`, which makes `terrainHeight == waterY`
  hold to the millimetre all the way around the shore. (Verified
  numerically rather than by eye: sampling 64 points around the waterline
  gives min == max == `POND_WATER_Y`.)
- Grass is "paper" grass: instanced clumps of three alpha-cut cards at
  0/60/120°, so a clump still reads as volume from any angle instead of
  vanishing edge-on. The blade silhouette is drawn procedurally to a canvas
  at startup (no external image assets, same as `glow.js`, `Water.js` and
  `particleTextures.js`). It uses `alphaTest` rather than blending on
  purpose — overlapping blended cards would need per-frame depth sorting
  that `InstancedMesh` can't do. Wind sway is a vertex-shader offset keyed
  off `uv.y²` (so blades bend from the root, not slide sideways) with the
  phase derived from each instance's own position out of `instanceMatrix`,
  which makes the field ripple instead of swaying in lockstep. Normals
  point straight up rather than out of the card, so grass is lit like the
  ground it grows from instead of half the cards going black. The scatter
  filters are ordered cheapest-first — `slopeAt()` costs four
  `terrainHeight()` evaluations, so it runs last, after the cheap
  rejections; the whole 38k-clump scatter measures ~20ms at startup.
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
  trimmed `tree_assets.glb` (~5MB) with just those four subtrees — though
  only the three tree species are actually loaded at runtime now (see the
  water design note below for why). `world/TreeAssets.js` loads that trimmed
  file once, bakes in the 90°-around-X rotation the raw meshes need to stand
  upright, and recenters each species so its trunk base sits at local origin
  — matching the convention the old procedural trees used, so
  `Vegetation.js`'s placement/instancing code didn't need to change, just
  what geometry it instances. The lake itself replaced the old small
  circular pond: the basin in `heightfield.js` was widened and pushed
  further off the path, and a hand-placed ring of real trees
  (`Level.js#_buildLakeTrees`) surrounds it for a set-piece look distinct
  from the ambient forest.
- The lake surface (`world/Water.js`) is three.js's own `Water` object (the
  reflection + normal-mapped ripple shader from the official ocean demo,
  `three/addons/objects/Water.js`) — a real render-to-texture reflection of
  the sky, trees and shore each frame, not a flat tinted material. Its
  distortion normal map is generated on a canvas at startup (sum of a few
  tileable sine waves, finite-differenced into a tangent-space normal map)
  rather than a downloaded texture, keeping with the rest of the world
  (heightfield.js, glow.js, particleTextures.js) having no external image
  assets. The water plane's radius exactly matches `terrainHeight`'s own
  basin-carve falloff start (`POND_RADIUS - 3`) so it can never poke out
  over dry land regardless of tuning; a second mesh, `createShoreBlend`,
  bridges the gap out to the actual shore — a ring whose vertices sample
  real terrain height (so it hugs the slope) and fades a dark wet-sand tint
  into the dry ground via a small gradient texture, rather than leaving a
  hard seam where the water meets the terrain. The specular highlight
  tracks the actual sun/moon direction each frame (`updateWaterSurface`), so
  it repositions correctly through the day-night cycle. The old approach
  (a `MeshStandardMaterial` with a hand-rolled vertex-displacement ripple
  and Fresnel rim, no real reflection) is gone entirely. One trade-off:
  the mirror reflection re-renders the whole scene from a second camera
  every frame the lake is visible, roughly doubling draw calls for that
  frame — `textureWidth`/`textureHeight` (currently 1024) in
  `createWaterSurface` is the first knob to turn down if that's ever a
  problem on lower-end hardware.
- Walking "into" the lake used to just walk the player along the dry basin
  floor underneath the water plane, with no acknowledgment anything was
  wrong. Simplest fix: you can't — the water radius is now a solid
  collider (`this.grid.insert(POND.x, POND.z, flatRadius)` in
  `Level.js#_buildPond`). That surfaced a real latent bug in
  `SpatialGrid`: it only ever stored a collider under the single grid cell
  its center fell in, which silently worked for every existing collider
  (trees, rocks, the wreck — all well under the 8-unit cell size) but broke
  for the lake, whose 10-unit radius exceeds the cell size, meaning a
  player standing well within collision range could be in a cell outside
  `resolveCircle`'s 3x3 search neighborhood and pass straight through.
  Fixed by having `insert()` register the collider in every cell its
  bounding box overlaps, with `resolveCircle()` deduping by reference so a
  multi-cell collider isn't pushed-out against twice in one call.
- The held rifle viewmodel is a rigged hands+weapon GLB with six authored
  clips (`SRifle_Idle`, `SRifle_Walk`, `SRifle_Shot_nosight`,
  `SRifle_Shot_sight`, `SRifle_Reload`, `SRifle_Reload_Full`) driving the
  motion, replacing the old hand-rolled sway/bob/recoil math — `Weapon.js`
  picks a clip by state: idle when still, walk when moving (its
  `timeScale` scales with actual speed, so sprinting plays the same clip
  faster rather than needing a separate run clip), the hip- or
  scope-aimed shot clip depending on whether aiming is toggled on, and — reading
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
  line-of-sight check — detection is radius-based. The lake is the one
  exception: it's a hole in their walkable space that they steer around
  (`avoidLake` in `Wolf.js`), because "shoot a wolf, watch it swim at you"
  was too conspicuous to leave. Everything else they walk through.
- Terrain collision is "walk anywhere" — steep slopes slow you down only
  visually; nothing stops you climbing the ridge ring except how tall it is.
- Firewood (~125 piles, one under every tenth tree) shares a single
  `InstancedMesh` per sub-mesh of the wood-pile GLB — three draw calls for
  the lot. Building them the way the handful of crash-site pickups are
  built (a `Group` plus a glow sprite each) would have been close to a
  thousand draw calls for firewood alone; collecting one zeroes its
  instance matrix instead of removing an object, and they deliberately skip
  the loot pickups' glow sprite since the `[E]` prompt is discovery enough
  for something this common.
- Gathering wood from a tree is one `InteractionSystem` entry per tree
  (~1250 of them) rather than a per-frame search for the nearest trunk.
  That reuses the prompt and closest-wins behaviour already in the system
  instead of duplicating it, and costs a few hundred extra distance checks
  a frame — measured at ~0.2% of the frame budget, next to nothing beside
  the raycasts already running. The list also shrinks as trees are used up.
  It forced one change though: an interaction offered at *every tree in the
  forest* will regularly sit closer to you than the campfire you're
  standing at, which would silently lock you out of the cook/sleep menu. So
  entries now carry an optional `priority` that breaks ties before distance
  does, and tree gathering sits below everything else.
- Stripped trees are deliberately not persisted in `takenPickups` — a flag
  per tree would bloat the save for a resource the player can't meaningfully
  exhaust, so trees come back on reload. Fallen piles, being finite and
  hand-countable, are persisted.
- Vegetation LOD is distance-based only — there are no lower-poly tree
  models, so a distant tree costs the same ~2000 triangles as a near one.
  Real impostors/billboards for far chunks would be the next step.
- Campfires can be built on any ground, including steep or wet spots.
- The pond is the only water source; no waterborne risk, no bottles. It's
  solid rather than swimmable — there's no underwater world/effect, so
  walking toward it stops at the shore instead.
- Post-processing is fog + CSS vignette/color overlays rather than a full
  EffectComposer chain (cheap and good enough at this scope).
- Sleeping doesn't check for nearby threats — wolves politely wait.
- The wolf GLB uses the legacy `KHR_materials_pbrSpecularGlossiness`
  extension, which three.js's `GLTFLoader` doesn't support — it logs a
  console warning and falls back to the base PBR values, so the model
  renders correctly but not with the exact specular look the source file
  intended.
- There's no death clip in the wolf GLB. Rather than imitate one badly (it
  used to just tip over on its side and freeze), a killed wolf is launched
  along the bullet's path and tumbles away, bouncing off the terrain, before
  despawning — a deliberate swing to slapstick, since the honest options
  were "bad" or "silly". Tuned in `CONFIG.wolf.ragdoll`; it's a single rigid
  body keeping its last animated pose, not a real jointed ragdoll.
- Only 2 tree species + 1 dead variant come from the source diorama, reused
  everywhere — real-world forests have more variety, and up close the
  repetition is a bit more noticeable than with the old fully-procedural
  (randomly proportioned) trees.
- The rifle's scope is a solid modeled prop, not a functional see-through
  lens (that would need a separate render-to-texture pass). What sells the
  aiming is a 2D HUD layer: RMB toggles `aiming` (no need to hold it down),
  and once the resulting zoom-in tweens the camera to its aimed FOV — 26°,
  roughly 2x the magnification of hip-fire — (`Weapon.js`'s `scopeView` flag,
  gated on the FOV having actually settled, not on the toggle firing, so the
  reticle doesn't pop in mid-animation), a crosshair overlay fades in with a
  rangefinder readout in meters (its own raycast against the whole scene) and
  a bullet-drop-compensation ladder that's for real: firing launches an
  actual projectile (`Weapon.js`'s `_updateBullets`) with a real researched
  muzzle velocity (808 m/s — 168gr .308 Win Federal Gold Medal Match) that
  falls under gravity and is swept-raycast each frame so it can't tunnel
  through a wolf or the terrain between steps; a spark burst
  (`_spawnImpact`) marks wherever it actually lands. The gravity used isn't
  real, though — a real .308 drops ~7cm over 100m, which is 0.04° of
  holdover and invisible on any reticle — so `CONFIG.rifle.bulletGravity` is
  solved backward from the reticle's own drawn geometry (the BDC ladder's
  spacing, given the scope FOV and reticle-to-viewport scale) so that
  ranging a target with the scope and holding the matching mark (mark 1 at
  100m, 2 at 200m …) lands the shot exactly on target. Tightening that
  ladder from 18 to 6 units per step cut the exaggeration from 36x real
  gravity to 12x — the reticle's resolution is what caps how realistic the
  drop can be while staying aimable, so the two are tuned together; see the
  derivation above `CONFIG.rifle`.
- The projectile step is the closed form for constant acceleration
  (`x += v·dt + ½·g·dt²`, then `v += g·dt`) rather than plain Euler
  (`v += g·dt` first, then `x += v·dt`). Euler biases the drop by `½·g·dt·t`,
  which measured 0.12m low at 60fps and **0.25m low at 30fps** on a 100m
  shot — the same hold landing somewhere else on a slower machine. The
  closed form is exact for constant acceleration, so impact is
  framerate-independent (verified: ≤2cm residual at both 30 and 60fps
  across the whole ladder).
- That crosshair (`scope-reticle.svg`) is a
  hand-authored vector reticle, not a stock asset — a real stock crosshair
  was tried first but its own baked-in vignette fought with the HUD's, so
  it was redrawn from scratch. The binoculars' vignette mask
  (`binoculars-mask.png`) is real stock vector art; its source only ever
  encoded transparency as a baked-in checkerboard placeholder graphic (a
  stock-preview convention, not real alpha), so it was reprocessed offline
  (Ghostscript rasterize → numpy luminance-keyed alpha) to get a real
  transparent PNG.
- Aim sway (`Weapon.js`, gated by `this.aiming`, tuned in `CONFIG.aim`) is a
  real camera-rotation drift, not cosmetic — it's applied directly to
  `camera.rotation` after `PlayerController` sets it for the frame, so it
  genuinely moves where a fired bullet goes. Two sine waves per axis at
  non-matching frequencies/phases (rather than one) keep the motion from
  reading as a metronome; amplitude ramps in/out smoothly with `aiming`
  rather than snapping, and is scaled by `CONFIG.aim.stanceMult` — standing
  sways the most, crouching less, prone least — so a steadier stance is a
  real accuracy trade-off against the wolf-detection stealth bonus that
  same stance already gives (see `PlayerController.stance`). It also scales
  with `PlayerStats.energy` (`CONFIG.aim.energySwayMax`) — a winded shooter
  (low energy from sprinting/hunger/cold) shakes up to 3x worse than a
  fresh one at full energy, on top of the stance multiplier.

## Suggested next steps

- **World**: more biomes inside (or beyond) the ridge ring — a marsh, a
  burnt-out stand, an abandoned village. `heightfield.js` composes the
  terrain from independent analytic features layered onto the noise (the
  ridge ring, the spawn clearing, the lake bed), so a new landmark is
  another such term plus a matching `forestDensity` carve-out.
- **Wildlife**: birds (ambience), foxes (flee/steal), and a bear miniboss
  (see the TODO in `entities/Wolf.js` — the state machine generalizes).
- **Weather**: snow/rain fronts driving warmth and visibility.
- **Inventory UI**: a real grid, item weights, water bottles, meat + cooking
  on campfires.
- **Multiplayer**: the sim is already deterministic-terrain + explicit
  systems; a co-op layer would sync player transforms, stats events, wolf
  state and fire placement (e.g. via WebRTC or a small WebSocket server).
  Keeping game logic out of rendering code (as structured) is the main prep.
