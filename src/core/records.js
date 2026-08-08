// Personal bests, kept in their own localStorage slot rather than the save.
//
// Deliberately separate: a record is something you set, not something you
// carry. Starting a New Game wipes the run — position, score, which plates
// are down — but should never wipe the best you've ever shot, or the number
// stops meaning anything the moment you want a fresh start.

const KEY = 'deepforest-best';

// An accuracy record off a two-shot run would be 100% forever and could never
// be beaten honestly, so a run has to be long enough to mean something.
const MIN_SHOTS_FOR_ACCURACY = 8;

export function loadBest() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error('Failed to read personal best:', err);
    return null;
  }
}

/**
 * Files a finished run and reports what it beat.
 *
 * Two different things are stored. `run` is the best-scoring run as a whole —
 * that's the number the scorecard compares against. `records` holds each
 * category's all-time maximum, tracked independently, because your best
 * accuracy and your longest hit generally don't happen on your highest
 * scoring run; scoring them against that run's figures would call an
 * ordinary shot a record and a genuine record nothing at all.
 */
export function submitRun(run) {
  const stored = loadBest();
  const prevRun = stored?.run ?? null;
  const prevRecords = stored?.records ?? { accuracy: 0, bestShot: 0, longestStreak: 0 };

  const accuracyEligible = run.shots >= MIN_SHOTS_FOR_ACCURACY;
  const beaten = {
    score: !prevRun || run.score > prevRun.score,
    accuracy: accuracyEligible && run.accuracy > prevRecords.accuracy,
    bestShot: run.bestShot > prevRecords.bestShot,
    longestStreak: run.longestStreak > prevRecords.longestStreak,
  };

  try {
    localStorage.setItem(KEY, JSON.stringify({
      run: beaten.score ? { ...run, at: Date.now() } : prevRun,
      records: {
        accuracy: accuracyEligible
          ? Math.max(prevRecords.accuracy, run.accuracy) : prevRecords.accuracy,
        bestShot: Math.max(prevRecords.bestShot, run.bestShot),
        longestStreak: Math.max(prevRecords.longestStreak, run.longestStreak),
      },
    }));
  } catch (err) {
    console.error('Failed to save personal best:', err);
  }

  return { best: prevRun, beaten };
}
