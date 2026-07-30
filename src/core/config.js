// Central tuning knobs. Balance the run length here.

export const CONFIG = {
  dayLengthSec: 720,        // one full day-night cycle = 12 real minutes
  startTimeOfDay: 0.02,     // ~00:29, deep night — the crash just happened

  player: {
    walkSpeed: 4.3,
    sprintSpeed: 6.6,
    crouchSpeed: 2.4,
    proneSpeed: 1.0,
    radius: 0.45,
    eyeHeight: 1.62,
    crouchEyeHeight: 1.05,
    proneEyeHeight: 0.45,
    lookSensitivity: 0.0021,
  },

  // Aim sway while aiming down the rifle scope or through binoculars: a real
  // camera-rotation drift (not cosmetic — it moves where a fired bullet
  // actually goes), damped by a steadier stance and worsened by fatigue.
  // See Weapon.js's sway block.
  aim: {
    swayMaxDeg: 0.65,       // peak wander at full energy, standing
    swayRampRate: 6,        // how fast sway fades in/out when aiming starts/stops
    stanceMult: { stand: 1, crouch: 0.55, prone: 0.22 },
    energySwayMax: 3,       // sway multiplier at 0 energy (1x at 100 energy, linear between)
  },

  stats: {
    hungerRate: 0.085,      // per second -> empty in ~20 min
    thirstRate: 0.12,       // per second -> empty in ~14 min
    energyRate: 0.05,       // passive drain
    sprintEnergyRate: 0.45, // additional drain while sprinting
    fireWarmthRate: 9,      // warmth gain per second near a fire
    warmthBaseGain: 0.5,    // daytime recovery
    chillNightFactor: 1.35, // how hard night cold hits
    chillAltitudeFactor: 0.5,
    freezeDps: 1.1,
    starveDps: 0.5,
    dehydrateDps: 0.8,
    regenHps: 0.35,         // passive regen when well fed / warm
  },

  rifle: {
    magSize: 5,
    reloadTimeFallback: 2.0, // used only if the reload clip failed to load
    fireCooldown: 0.85,      // paced to the viewmodel's shot-recoil animation
    range: 150,
    // Bullet drop physics (see Weapon.js's _updateBullets). muzzleVelocity is
    // a real researched figure (168gr .308 Win Federal Gold Medal Match,
    // 2650 fps). bulletGravity is NOT real gravity — a real .308 drops only
    // ~7cm over 100m, which is 0.04° of holdover: invisible on any reticle
    // at any sane magnification. It's instead solved backward from the
    // scope-reticle.svg BDC ladder's drawn geometry, so holding mark N on a
    // target the scope ranges at 100·N metres lands the shot dead-on:
    //
    //   angle per reticle unit = (66/200 reticle-to-vmin) · (26°/100 FOV-per-vh)
    //                          = 0.0858°            [vmin ≈ vh in landscape]
    //   ladder spacing         = 6 units per 100 m  = 0.5148° at 100 m
    //   small-angle drop       = tan θ = ½·g·R/v²
    //   ⇒ g = 2·v²·tan θ / R  = 2·808²·0.0089852 / 100 ≈ 117
    //
    // At 12x real gravity that's still exaggerated, but it's a third of the
    // 36x the old coarse 18-unit ladder forced — tightening the ladder is
    // what bought the realism. Recompute this if the ladder spacing, the
    // reticle's on-screen size, the scope FOV or muzzleVelocity change.
    muzzleVelocity: 808,
    bulletGravity: 117,
    bulletLifetime: 4, // seconds before an unresolved shot is given up on
  },

  wolf: {
    health: 2,              // body shots: two hits down. Headshots always instakill regardless.
    headshotRadius: 0.35,    // world units around the head bone counted as a headshot
    chaseSpeed: 6.1,
    wanderSpeed: 1.7,
    // 20m aggro. Night is unchanged rather than longer: the wolves guard a
    // fixed spot (the lake) now, so a wider night radius would just mean
    // being ambushed before the lake is even visible.
    detectRadiusDay: 20,
    detectRadiusNight: 20,
    crouchDetectMult: 0.65, // sneaking narrows how far a wolf notices you
    proneDetectMult: 0.4,
    giveUpRadius: 55,
    attackRange: 2.4,
    attackCooldown: 1.5,
    damage: 14,
    woundedSpeedMult: 0.45, // after surviving a body shot, until finished off
    // Death throw. There's no death clip in the wolf GLB, so rather than a
    // bad imitation of one the corpse gets launched along the bullet's path
    // and tumbles away.
    ragdoll: {
      launchSpeed: 24,  // along the shot direction
      launchUp: 15,
      gravity: 26,      // heavier than real, so the arc stays readable
      bounce: 0.55,
      despawnSec: 12,
    },
  },

  fire: {
    woodCost: 3,
    burnTimeSec: 300,       // one fire covers roughly one night
    dieDownSec: 45,         // over the last N seconds of fuel, flames visibly shrink
    wreckBurnHours: 6,      // in-game hours before the helicopter fire burns out, leaving smoke
    warmRadius: 5.5,
  },
};
