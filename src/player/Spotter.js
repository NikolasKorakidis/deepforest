import * as THREE from 'three';
import { CONFIG } from '../core/config.js';

/**
 * Calls your misses, the way a spotter does on a real firing line.
 *
 * This exists because of a specific failure in the game's difficulty curve.
 * At 25m you can see your own dust and correct by eye; at 400m a miss is
 * simply nothing — no splash you can resolve, no idea whether you were high,
 * low, or a metre into the wind. The round vanishes and you learn nothing, so
 * the long plates stop being hard and start being arbitrary, which is the
 * point where people put a game down.
 *
 * A spotter converts that dead end into information: "1.2m LOW, 0.8m RIGHT"
 * is a correction you can dial on the very next shot. The 700m plate stays
 * just as difficult, but it becomes a problem you can work rather than a
 * coin flip, and that difference is the whole mastery loop.
 *
 * Deliberately reports the *miss*, not the correction, which is the
 * convention every real spotter uses ("low left") — the shooter inverts it.
 * Handing over a pre-inverted answer would do the one piece of thinking
 * that's actually worth learning here.
 */

const _v = new THREE.Vector3();
const _c = new THREE.Vector3();
const _cross = new THREE.Vector3();
const _flat = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

// Below this there's nothing to spot: you can see your own impact, and a
// callout would be noise on top of information you already have.
const MIN_DISTANCE = 60;

// How far off the aim line, *in azimuth only*, a target can be and still
// count as the one you meant. Grows with range because a fixed angle doesn't:
// the plate lanes are 2.2° apart, which is ~27m at 700m, so this stays under
// half that to avoid crediting the shot to a neighbouring lane.
function aimTolerance(dist) {
  return Math.min(12, 4 + dist * 0.014);
}

export class Spotter {
  constructor({ getTargets }) {
    this.getTargets = getTargets;
  }

  /**
   * Which target this shot was meant for, described in the flat terms the
   * crossing maths needs. Null when the shot wasn't aimed at anything —
   * plinking at the hillside earns no callout.
   *
   * Selection deliberately ignores elevation and looks only at where the
   * barrel points on the compass. The obvious alternative — nearest target to
   * the aim ray in 3D — is quietly wrong here, because a correct hold isn't
   * pointed at the plate at all: with this gravity a 700m shot has to be held
   * 44m high, so the shot the spotter most needs to grade is the one that
   * test rejects hardest. Azimuth is immune to holdover, and a shooter who
   * has the wrong lane has a problem no callout is going to fix.
   */
  planFor(origin, dir, speed, wind) {
    const targets = this.getTargets?.() ?? [];
    const flat = _flat.set(dir.x, 0, dir.z);
    if (flat.lengthSq() < 1e-9) return null; // straight up or down
    flat.normalize();

    let best = null;
    let bestMiss = Infinity;

    for (const t of targets) {
      const info = t.spotterInfo?.();
      if (!info || !info.live || info.dist < MIN_DISTANCE) continue;

      // Azimuth gate: horizontal offset from the target to the horizontal
      // aim line. Behind the shooter doesn't count.
      _v.subVectors(info.centre, origin).setY(0);
      const along = _v.dot(flat);
      if (along <= 0) continue;
      const perp = Math.sqrt(Math.max(0, _v.lengthSq() - along * along));
      if (perp > aimTolerance(info.dist)) continue;

      // Two plates can share a lane, so break the tie on where this shot is
      // actually going to pass — the one it comes nearest to is the one that
      // was meant.
      const miss = this._predictMiss(origin, dir, speed, wind, info);
      if (miss === null || miss >= bestMiss) continue;
      best = info;
      bestMiss = miss;
    }
    if (!best) return null;

    // A frame of reference fixed at the trigger, not recomputed later: the
    // plate the round is judged against must be the one that was standing
    // when it was fired, at the position it was fired at. Balloons move, and
    // grading a shot against where its target drifted to two seconds later
    // would report an error the shooter never made.
    const fwd = new THREE.Vector3().subVectors(best.centre, origin).setY(0).normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    return {
      centre: best.centre.clone(),
      dist: best.dist,
      half: best.half,
      origin: origin.clone(),
      fwd,
      right,
      plane: _c.subVectors(best.centre, origin).dot(fwd),
    };
  }

  /**
   * How far this shot will pass from a target's centre, solved rather than
   * flown. Used only to pick between candidates, so it can afford to ignore
   * the terrain the real round might bury itself in first — that's the
   * flight's business, and `fellShort` reports it truthfully.
   *
   * In the target's own frame the along-range motion is
   * `s(t) = v·t + ½·a·t²`, so the crossing time is a quadratic in t.
   */
  _predictMiss(origin, dir, speed, wind, info) {
    const fwd = _fwd.subVectors(info.centre, origin).setY(0);
    const range = fwd.length();
    if (range < 1e-6) return null;
    fwd.divideScalar(range);
    const right = _right.set(-fwd.z, 0, fwd.x);

    const ax = wind ? wind.x * wind.speed * CONFIG.rifle.windDrift : 0;
    const az = wind ? wind.z * wind.speed * CONFIG.rifle.windDrift : 0;
    const aFwd = ax * fwd.x + az * fwd.z;
    const aRight = ax * right.x + az * right.z;
    const vFwd = (dir.x * fwd.x + dir.z * fwd.z) * speed;

    const t = solvePositive(0.5 * aFwd, vFwd, -range);
    if (t === null) return null;

    const g = CONFIG.rifle.bulletGravity;
    const dy = (origin.y + dir.y * speed * t - 0.5 * g * t * t) - info.centre.y;
    const dx = (dir.x * right.x + dir.z * right.z) * speed * t + 0.5 * aRight * t * t;
    return Math.hypot(dy, dx);
  }

  /**
   * Did the round cross the target's plane on this step? If so, report where
   * it went through relative to the centre.
   *
   * Linear interpolation across the step is fine here: at 808 m/s a 50ms
   * frame covers 40m, and the arc's sag away from that chord is g·dt²/8 ≈
   * 3.7cm — two orders of magnitude under the metre-scale misses being
   * reported.
   */
  crossing(plan, prevPos, pos) {
    const along = _v.subVectors(pos, plan.origin).dot(plan.fwd);
    const prevAlong = _c.subVectors(prevPos, plan.origin).dot(plan.fwd);
    if (prevAlong > plan.plane || along < plan.plane) return null;

    const span = along - prevAlong;
    const u = span > 1e-6 ? (plan.plane - prevAlong) / span : 0;
    _cross.lerpVectors(prevPos, pos, u);
    return this._call(plan, {
      vertical: _cross.y - plan.centre.y,
      lateral: _v.subVectors(_cross, plan.centre).dot(plan.right),
    });
  }

  /**
   * The round stopped before it ever reached the plane — it hit the ground
   * short, or clipped the mound in front. This is the most important call of
   * the lot and the easiest to drop: a shot that lands 40m short produces no
   * plane crossing at all, so without this the worst misses would be the
   * only ones that got no feedback.
   */
  fellShort(plan, impact) {
    const along = _v.subVectors(impact, plan.origin).dot(plan.fwd);
    const short = plan.plane - along;
    if (short < 1) return null;
    return this._call(plan, {
      short,
      lateral: _c.subVectors(impact, plan.centre).dot(plan.right),
    });
  }

  _call(plan, miss) {
    return { dist: plan.dist, half: plan.half, ...miss };
  }
}

/** Human-readable spotter call, e.g. "1.2m LOW · 0.8m RIGHT". */
export function formatCall(call) {
  const parts = [];
  if (call.short != null) {
    parts.push(`${Math.round(call.short)}m SHORT`);
  } else {
    parts.push(`${fmt(Math.abs(call.vertical))} ${call.vertical < 0 ? 'LOW' : 'HIGH'}`);
  }
  // A lateral error under a plate half-width isn't a wind read worth
  // correcting — reporting it would send shooters chasing their own group.
  if (Math.abs(call.lateral) > call.half) {
    parts.push(`${fmt(Math.abs(call.lateral))} ${call.lateral < 0 ? 'LEFT' : 'RIGHT'}`);
  }
  return parts.join('   ');
}

/** Smallest positive root of at² + bt + c, or null. Linear when a is 0 — the
 *  no-wind case, which is most of them. */
function solvePositive(a, b, c) {
  if (Math.abs(a) < 1e-9) return b > 1e-9 ? -c / b : null;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const t1 = (-b - root) / (2 * a);
  const t2 = (-b + root) / (2 * a);
  const lo = Math.min(t1, t2);
  const hi = Math.max(t1, t2);
  if (lo > 1e-6) return lo;
  return hi > 1e-6 ? hi : null;
}

function fmt(m) {
  return m < 10 ? `${m.toFixed(1)}m` : `${Math.round(m)}m`;
}
