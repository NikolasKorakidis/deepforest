# Audio assets

Drop sound files in here and let me know — I'll wire them into
`src/core/sfx.js` (currently 100% procedural WebAudio, no files) and/or
`Environment.js`/`Game.js` for ambience and music.

Formats: `.mp3` or `.ogg` for anything long (ambience, music — smaller
files, streams fine); `.wav` is fine too for short one-shots if that's
what you have. Keep individual one-shot SFX short and dry (no baked-in
reverb) — the game is fully 3D, so positional effects (gunshots,
footsteps) get their sense of space from the scene, not the recording.

## sfx/ — one-shot effects

Name a file after the action it replaces and I'll match it up
automatically. Current procedural sounds, all in `src/core/sfx.js`,
that a matching file would replace:

| Filename (any ext) | Replaces | Used for |
| --- | --- | --- |
| `shot` | `SFX.shot()` | rifle firing |
| `dry` | `SFX.dry()` | trigger click, empty mag |
| `reload` | `SFX.reload()` | reloading the rifle |
| `pickup` | `SFX.pickup()` | picking up an item |
| `eat` | `SFX.eat()` | eating a raw ration |
| `build` | `SFX.build()` | building a campfire |
| `drink` | `SFX.drink()` | drinking from the lake |

Not currently wired to anything (left over from a removed wolf encounter,
harmless): `bite`, `growl`.

New sounds that don't map to an existing method (e.g. a footstep set, a
distinct "cook" sound for the campfire menu, UI click/hover for the
radial menu) are just as easy to add — say what each one is for.

## ambience/ — looping environmental beds

Wind, night ambience, water/lake lapping, fire crackle, etc. Loops need
to be seamless (no click/pop at the loop point) since they'll be played
with `loop = true`.

## music/ — non-diegetic background music

Not used yet. If you add something here, say whether you want it always
on, tied to specific areas/moments (e.g. the beacon, the checkpoint), or
adaptive to danger/calm.
