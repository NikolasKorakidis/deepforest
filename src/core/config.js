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
    // 2650 fps). bulletGravity is NOT real gravity (9.81) — a real .308 only
    // drops a few centimeters over 100-400m, far too subtle to read on a
    // scope reticle at any sane magnification. Instead it's solved backward
    // from the scope-reticle.svg BDC ladder's actual drawn geometry (mark
    // N sits at angle θ_N = markOffsetUnits(N) * (66/200 reticle-to-vmin
    // scale) * (26°/100 FOV-per-vh) above center, using vmin≈vh in
    // landscape) via the small-angle drop relation θ(R) = 0.5·g·R/v², so
    // that holding mark N on a target ranged at exactly 100·N meters (via
    // the scope's own rangefinder) lands the shot dead-on. Recompute this
    // if the reticle geometry, scope FOV, or muzzleVelocity ever changes.
    muzzleVelocity: 808,
    bulletGravity: 352,
    bulletLifetime: 4, // seconds before an unresolved shot is given up on
  },

  wolf: {
    health: 2,              // body shots: two hits down. Headshots always instakill regardless.
    headshotRadius: 0.35,    // world units around the head bone counted as a headshot
    chaseSpeed: 6.1,
    wanderSpeed: 1.7,
    detectRadiusDay: 24,
    detectRadiusNight: 30,
    crouchDetectMult: 0.65, // sneaking narrows how far a wolf notices you
    proneDetectMult: 0.4,
    giveUpRadius: 55,
    attackRange: 2.4,
    attackCooldown: 1.5,
    damage: 14,
  },

  fire: {
    woodCost: 3,
    burnTimeSec: 300,       // one fire covers roughly one night
    warmRadius: 5.5,
  },
};
