// Central tuning knobs. Balance the run length here.

export const CONFIG = {
  dayLengthSec: 720,        // one full day-night cycle = 12 real minutes
  startTimeOfDay: 0.02,     // ~00:29, deep night — the crash just happened

  player: {
    walkSpeed: 4.3,
    sprintSpeed: 6.6,
    crouchSpeed: 2.1,
    proneSpeed: 1.0,
    radius: 0.45,
    eyeHeight: 1.62,
    eyeHeightCrouch: 0.95,
    eyeHeightProne: 0.42,
    lookSensitivity: 0.0021,
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
  },

  wolf: {
    health: 3,
    chaseSpeed: 6.1,
    wanderSpeed: 1.7,
    detectRadiusDay: 24,
    detectRadiusNight: 30,
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
