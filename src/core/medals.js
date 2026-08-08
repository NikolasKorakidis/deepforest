/**
 * Named goals, earned once and kept.
 *
 * A single score is a poor goal on its own: it tells you that you did worse
 * than last time without ever suggesting what to try instead, and it rewards
 * exactly one strategy — farm whatever is easiest. These name six different
 * ways to be good, several of which actively conflict with a high score. You
 * cannot chase Clean Sweep and Quick Work in the same run: one wants every
 * shot placed, the other wants the clock beaten. That tension is the point,
 * because it makes the same twelve plates into several different problems.
 *
 * Each is deliberately reachable but specific enough to change how you shoot
 * for a whole run, rather than something you collect by accident.
 */
export const MEDALS = [
  {
    id: 'reach',
    name: 'Reach Out',
    desc: 'Hit the 700m plate',
    won: (r) => r.bestShot >= 700,
  },
  {
    id: 'chain',
    name: 'Unbroken',
    desc: 'Run the multiplier to x5',
    won: (r) => r.longestStreak >= 5,
  },
  {
    id: 'marksman',
    name: 'Marksman',
    desc: '90% accuracy over a full run',
    won: (r) => r.shots >= 15 && r.accuracy >= 0.9,
  },
  {
    id: 'centre',
    name: 'Dead Centre',
    desc: 'Five bullseyes in one run',
    won: (r) => r.bulls >= 5,
  },
  {
    id: 'quick',
    name: 'Quick Work',
    desc: 'Clear the range with a minute to spare',
    won: (r) => r.cleared && r.secondsLeft >= 60,
  },
  {
    id: 'sweep',
    name: 'Clean Sweep',
    desc: 'Clear the range without a single miss',
    won: (r) => r.cleared && r.shots > 0 && r.hits === r.shots,
  },
];

export function medalById(id) {
  return MEDALS.find((m) => m.id === id) ?? null;
}
