/* =========================================================================
   PER-MODE PROGRESS — bests and improvement, tracked separately for Learn,
   Practice and Final Practical.

   A 19/20 scored with the coach naming every error is not the same
   achievement as a 19/20 scored in silence, so they are never pooled. Each
   mode keeps its own record:

     attempts        how many practicals have been completed in this mode
     bestTotal       highest rubric total, and the percent that produced it
     lastTotal       the most recent one, so the UI can say "up 3 from last"
     bestByCategory  the highest each rubric row has ever reached, which is
                     what "repeatable weak sections" needs to point at
     passes          how many attempts cleared the pass mark
     history         the last few totals, for an improvement line

   Pure: every function takes the progress object and returns a new one. The
   caller persists it (SS.modeProgress, via saveSS()).
   ========================================================================= */

const HISTORY_LIMIT = 10;

export function emptyModeRecord(){
  return {
    attempts: 0,
    passes: 0,
    bestTotal: null,
    bestPercent: null,
    bestAt: null,
    lastTotal: null,
    lastPercent: null,
    lastAt: null,
    bestByCategory: {},
    history: [],
  };
}

/** The record for one mode, defaulted rather than created, so reads are safe. */
export function recordFor(progress, mode){
  const p = progress || {};
  return Object.assign(emptyModeRecord(), p[mode] || {});
}

/**
 * Folds one finished practical into the mode's record.
 *
 * @param {object} progress  SS.modeProgress (may be undefined)
 * @param {string} mode      MODES.LEARN | PRACTICE | FINAL
 * @param {object} report    a rubricReport
 * @param {number} [now]     injectable clock
 * @returns {{progress:object, improved:boolean, newBest:boolean, delta:number|null}}
 */
export function recordAttempt(progress, mode, report, now){
  const at = now == null ? Date.now() : now;
  const prev = recordFor(progress, mode);
  const next = Object.assign({}, prev);

  next.attempts = prev.attempts + 1;
  if(report.passed) next.passes = prev.passes + 1;

  const delta = prev.lastTotal == null ? null : report.total - prev.lastTotal;
  next.lastTotal = report.total;
  next.lastPercent = report.percent;
  next.lastAt = at;

  const newBest = prev.bestTotal == null || report.total > prev.bestTotal;
  if(newBest){
    next.bestTotal = report.total;
    next.bestPercent = report.percent;
    next.bestAt = at;
  }

  next.bestByCategory = Object.assign({}, prev.bestByCategory);
  for(const c of report.categories){
    const was = next.bestByCategory[c.id];
    if(was == null || c.score > was) next.bestByCategory[c.id] = c.score;
  }

  next.history = prev.history.concat([{ at, total: report.total, max: report.maxTotal, passed: !!report.passed }])
    .slice(-HISTORY_LIMIT);

  return {
    progress: Object.assign({}, progress || {}, { [mode]: next }),
    improved: delta != null && delta > 0,
    newBest,
    delta,
  };
}

/**
 * The rows this learner is worst at IN THIS MODE, weakest first — what
 * Practice offers to replay. Uses the current attempt's scores, falling back
 * to the mode's historic bests when a row was not attempted this time.
 */
export function weakestCategories(progress, mode, report, limit){
  const rec = recordFor(progress, mode);
  const rows = (report ? report.categories : []).map(c => ({
    id: c.id,
    label: c.label,
    score: c.score,
    best: rec.bestByCategory[c.id] == null ? c.score : rec.bestByCategory[c.id],
  }));
  return rows
    .filter(r => r.score < 4)
    .sort((a, b) => (a.score - b.score) || (a.best - b.best))
    .slice(0, limit == null ? 3 : limit);
}

/** A one-line summary the idle screen can show per mode. */
export function summaryLine(progress, mode){
  const r = recordFor(progress, mode);
  if(!r.attempts) return "not attempted yet";
  const best = r.bestTotal == null ? "—" : `${r.bestTotal}/${r.history.length ? r.history[r.history.length - 1].max : 20}`;
  return `${r.attempts} attempt${r.attempts === 1 ? "" : "s"} · best ${best} · ${r.passes} passed`;
}
