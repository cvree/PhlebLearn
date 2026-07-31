/* =========================================================================
   RUBRIC RULES — turns the steps' own measurements into one rubric row.

   This layer sits ABOVE the per-step `*Scoring.js` modules. Those already do
   the hard part: real quantities, named mistakes, a 0–100 score and a
   narrative, at step scope. This file does exactly three things they cannot:

     1. maps several measurement keys onto one rubric category,
     2. converts 0–100-ish evidence into a 0–4 band, and
     3. decides whether the top band was actually EARNED — a category is only
        a 4 when it is complete, independent, in sequence, inside every
        configured tolerance and free of warnings. "Technically completed" is
        never automatically excellent.

   Pure functions. No DOM, no THREE, no clock, no policy numbers — every
   threshold arrives in the `policy` argument (see policy.js).
   ========================================================================= */
import { DEFAULT_POLICY, bandFor, criticalEventFor } from "./policy.js";

function round(v, dp){ const m = Math.pow(10, dp || 0); return Math.round(v * m) / m; }

/**
 * Whether a feed, sequence check, or range check applies to THIS attempt.
 * Two independent, deliberately asymmetric knobs:
 *
 *   proceduresOnly    opt IN. A brand-new entry (the winged set's feed, its
 *                     own sequence checks) that no caller before this one
 *                     ever expected to fire. With no `context.procedureId`
 *                     it is EXCLUDED — an old caller that never mentions a
 *                     procedure sees exactly the rows it always has.
 *
 *   excludeProcedures opt OUT. A PRE-EXISTING, previously-unconditional
 *                     check (the antecubital angle window) that now has to
 *                     stand down for one specific other procedure. With no
 *                     `context.procedureId` it stays INCLUDED — the default
 *                     is "this still means what it always meant."
 *
 * Never both on the same entry; each is applied only when present.
 */
function appliesToProcedure(opts, context){
  if(!opts) return true;
  const pid = context && context.procedureId;
  if(opts.proceduresOnly){
    if(!pid) return false;
    return opts.proceduresOnly.indexOf(pid) >= 0;
  }
  if(opts.excludeProcedures){
    if(!pid) return true;
    return opts.excludeProcedures.indexOf(pid) < 0;
  }
  return true;
}

/** A category's feeds, filtered to the ones this attempt's procedure has. */
export function activeFeeds(category, context){
  return category.feeds.filter(([, , opts]) => appliesToProcedure(opts, context));
}

/**
 * Pulls the measurement objects off a procedure state into the stable
 * key → object index the rest of this layer works from. Missing keys are
 * present as `null` so "never ran" and "ran badly" stay distinguishable.
 */
export function collectMeasurements(procedureState, policy){
  const p = policy || DEFAULT_POLICY;
  const c = procedureState || {};
  const out = {};
  for(const key of Object.keys(p.measurementSources)){
    const field = p.measurementSources[key];
    out[key] = c[field] || null;
  }
  return out;
}

/** Every mistake in the row, tagged with the measurement key it came from. */
export function mistakesFor(category, measurements, context){
  const out = [];
  for(const [key] of activeFeeds(category, context)){
    const m = measurements[key];
    if(!m || !m.mistakes) continue;
    for(const mistake of m.mistakes){
      out.push({
        key, code: mistake.code, item: mistake.item || null,
        message: mistake.message, critical: !!mistake.critical,
      });
    }
  }
  return out;
}

/**
 * The critical events in this row. A mistake is critical if the POLICY says
 * its qualified code is (`measurementKey.code`), or if the step module
 * flagged it `critical:true`. The second case is reported as `unclassified`
 * so a code the policy has not yet been taught about is visible rather than
 * silently downgraded.
 */
export function criticalEventsFor(category, measurements, policy, context){
  const p = policy || DEFAULT_POLICY;
  const out = [];
  for(const mistake of mistakesFor(category, measurements, context)){
    const entry = criticalEventFor(mistake.key, mistake.code, p);
    if(!entry && !mistake.critical) continue;
    out.push({
      key: mistake.key,
      code: mistake.code,
      qualified: `${mistake.key}.${mistake.code}`,
      item: mistake.item,
      label: entry ? entry.label : mistake.message,
      why: entry ? entry.why : null,
      automaticFailure: entry ? !!entry.automaticFailure : false,
      unclassified: !entry,
      message: mistake.message,
    });
  }
  return out;
}

/**
 * The weighted mean of the feeding measurements' own 0–100 scores. A missing
 * measurement scores 0 for the row: the step produced no evidence, and a
 * category cannot be carried by the steps that did run.
 */
export function categoryMean(category, measurements, context){
  let total = 0, weight = 0;
  for(const [key, w] of activeFeeds(category, context)){
    const m = measurements[key];
    total += (m && typeof m.score === "number" ? m.score : 0) * w;
    weight += w;
  }
  return weight ? total / weight : 0;
}

/* -------------------------------------------------------------------------
   The excellence gates. Each returns an array of `{reason, detail}` — empty
   means the gate passed. They are separate functions so the report can say
   WHICH gate stopped a 4, in the learner's own numbers.
   ------------------------------------------------------------------------- */

function gateCompleteness(category, measurements, context){
  if(!category.excellence || !category.excellence.requireAll) return [];
  const missing = activeFeeds(category, context)
    .map(([key]) => key)
    .filter(key => !measurements[key]);
  if(!missing.length) return [];
  return [{
    reason: "incomplete",
    detail: `No measurement was recorded for ${missing.join(", ")} — the step either never ran or was left unfinished.`,
    keys: missing,
  }];
}

function gateWarnings(category, measurements, mistakes){
  const max = category.excellence ? category.excellence.maxMistakes : 0;
  if(mistakes.length <= max) return [];
  const first = mistakes.slice(0, 3).map(m => m.message);
  return [{
    reason: "warnings",
    detail: `${mistakes.length} observation${mistakes.length === 1 ? "" : "s"} were recorded against this row; excellence allows ${max}. ${first.join(" ")}`,
    count: mistakes.length,
  }];
}

function gateSequence(category, measurements, context){
  const checks = (category.excellence && category.excellence.sequence) || [];
  const out = [];
  for(const check of checks){
    if(!appliesToProcedure(check, context)) continue;
    const m = measurements[check.key];
    if(!m) continue;                       // completeness gate already covers this
    const value = m[check.field];
    if(value === check.equals) continue;
    out.push({
      reason: "sequence",
      detail: `Out of sequence: ${check.label}. Recorded ${JSON.stringify(value)}, expected ${JSON.stringify(check.equals)}.`,
      key: check.key, field: check.field,
    });
  }
  return out;
}

function gateRanges(category, measurements, context){
  const ranges = (category.excellence && category.excellence.ranges) || [];
  const out = [];
  for(const range of ranges){
    if(!appliesToProcedure(range, context)) continue;
    const m = measurements[range.key];
    if(!m) continue;
    const value = m[range.field];
    if(value == null){
      out.push({
        reason: "noReading",
        detail: `No reading was recorded for ${range.label}.`,
        key: range.key, field: range.field,
      });
      continue;
    }
    if(value >= range.min && value <= range.max) continue;
    const unit = range.unit || "";
    const where = value > range.max ? "above" : "below";
    out.push({
      reason: "tolerance",
      detail: `${cap(range.label)} was ${round(value, 2)}${unit}, ${where} the configured excellent range of ${range.min}${unit}–${range.max}${unit}.`,
      key: range.key, field: range.field,
      value: round(value, 2), min: range.min, max: range.max, unit,
    });
  }
  return out;
}

function gateIndependence(category, context){
  const assists = (context && context.assists && context.assists[category.id]) || 0;
  if(!assists) return [];
  return [{
    reason: "assisted",
    detail: `${assists} coached correction${assists === 1 ? "" : "s"} were given during this row. An Excellent is for work done unaided.`,
    count: assists,
  }];
}

function cap(s){ return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

/* -------------------------------------------------------------------------
   Evidence — what the learner actually did, in their own numbers. The step
   modules already wrote the sentence; this assembles them in row order and
   attaches the measured deviations that mattered.
   ------------------------------------------------------------------------- */
function evidenceFor(category, measurements, policy, context){
  const labels = (policy || DEFAULT_POLICY).measurementLabels || {};
  return activeFeeds(category, context).map(([key, weight]) => {
    const m = measurements[key];
    return {
      key,
      label: labels[key] || key,
      weight,
      present: !!m,
      score: m && typeof m.score === "number" ? m.score : null,
      narrative: m ? m.narrative : `No evidence was recorded for ${labels[key] || key}.`,
    };
  });
}

/** The above-and-beyond observations in this row. These carry NO score. */
export function commendationsFor(category, measurements, policy, context){
  const p = policy || DEFAULT_POLICY;
  const keys = activeFeeds(category, context).map(([key]) => key);
  return (p.commendations || [])
    .filter(c => keys.indexOf(c.key) >= 0)
    .filter(c => {
      const m = measurements[c.key];
      if(!m) return false;
      const v = m[c.field];
      if(v == null) return false;
      if(c.test === "gte") return v >= c.value;
      if(c.test === "lte") return v <= c.value;
      return v === c.value;
    })
    .map(c => c.label);
}

/**
 * Scores ONE rubric category.
 *
 * @param {object} category      an entry from policy.categories
 * @param {object} measurements  key → measurement object (or null), from collectMeasurements()
 * @param {object} [policy]      defaults to DEFAULT_POLICY
 * @param {object} [context]     { assists:{categoryId:count} } — populated by the mode layer
 * @returns {{score:number, evidence:Array, preventedExcellence:Array, criticalEvents:Array}}
 */
export function scoreCategory(category, measurements, policy, context){
  const p = policy || DEFAULT_POLICY;
  // Every feed-iterating helper below filters by `context.procedureId`
  // itself (via `activeFeeds()`), so a feed restricted to a different
  // procedure than this attempt's is excluded consistently everywhere —
  // the mean, the evidence list, the mistakes, the missing/present arrays —
  // whether reached through here or called directly, as the unit tests do.
  const mistakes = mistakesFor(category, measurements, context);
  const criticalEvents = criticalEventsFor(category, measurements, p, context);
  const mean = categoryMean(category, measurements, context);
  const ceiling = bandFor(mean, p);

  const gates = [].concat(
    gateCompleteness(category, measurements, context),
    gateWarnings(category, measurements, mistakes),
    gateSequence(category, measurements, context),
    gateRanges(category, measurements, context),
    gateIndependence(category, context),
  );

  // The arithmetic sets the ceiling; the gates decide whether the top band is
  // earned. A gate can only ever cost the 4 — it never promotes, and it never
  // pushes a row below what its measurements already said.
  let score = ceiling.score;
  if(score === p.maxCategoryScore && gates.length) score = p.maxCategoryScore - 1;

  const preventedExcellence = gates.slice();
  if(score < p.maxCategoryScore && !gates.length){
    const top = p.bands[0];
    preventedExcellence.push({
      reason: "measured",
      detail: `The measurements in this row averaged ${Math.round(mean)}/100; an Excellent needs ${top.min}.`,
      mean: Math.round(mean),
    });
  }

  const band = p.bands.find(b => b.score === score) || ceiling;

  return {
    id: category.id,
    label: category.label,
    score,
    max: p.maxCategoryScore,
    band: { label: band.label, meaning: band.meaning },
    mean: Math.round(mean),
    ceiling: ceiling.score,
    evidence: evidenceFor(category, measurements, p, context),
    mistakes,
    criticalEvents,
    preventedExcellence: score === p.maxCategoryScore ? [] : preventedExcellence,
    commendations: commendationsFor(category, measurements, p, context),
    present: activeFeeds(category, context).map(([k]) => k).filter(k => !!measurements[k]),
    missing: activeFeeds(category, context).map(([k]) => k).filter(k => !measurements[k]),
  };
}

/** Every category, in policy order. */
export function scoreAllCategories(measurements, policy, context){
  const p = policy || DEFAULT_POLICY;
  return p.categories.map(cat => scoreCategory(cat, measurements, p, context));
}
