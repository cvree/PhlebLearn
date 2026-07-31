/* =========================================================================
   RUBRIC REPORT — the Final Practical's whole result, as one plain object.

   Nothing here renders. `ui/panels.js` turns this into HTML; the report is
   deliberately serialisable so it can also be logged, diffed between
   attempts, or asserted on in a unit test without a browser.

   What the brief asks the report to contain, and where each comes from:

     procedure type ............ the device and site actually used
     total / pass .............. policy.pass, applied to the summed categories
     per-category .............. rubricRules.scoreCategory()
     exact measured deviations . the `tolerance` entries in preventedExcellence
     critical events ........... policy.criticalEvents, qualified codes
     specimen results .......... collection + inversion, per tube
     patient outcomes .......... postDraw, palpation, insert, uncap
     strongest actions ......... the highest-scoring rows and commendations
     what prevented Excellent .. every gate that fired, in the learner's numbers
     practice plan ............. prioritised, one action per weakness

   Pure. Every number arrives from a measurement or the policy.
   ========================================================================= */
import { DEFAULT_POLICY } from "./policy.js";
import { collectMeasurements, scoreAllCategories } from "./rubricRules.js";

function round(v, dp){ const m = Math.pow(10, dp || 0); return Math.round(v * m) / m; }

/* -------------------------------------------------------------------------
   Which procedure this was. Read from what the steps recorded, not from a
   mode flag — a learner who ran the butterfly draw gets the butterfly
   report even if they got there sideways.
   ------------------------------------------------------------------------- */
export function describeProcedure(measurements){
  const wd = measurements.withdrawal;
  const pd = measurements.postDraw;
  const device = wd && wd.device ? wd.device : "straight";
  const site = pd && pd.siteKind ? pd.siteKind : "antecubital";
  const deviceLabel = device === "butterfly" ? "Butterfly (winged) set" : "Straight multisample needle";
  const siteLabel = site === "hand" ? "dorsal hand" : "antecubital fossa";
  return { device, site, deviceLabel, siteLabel, label: `${deviceLabel}, ${siteLabel}` };
}

/* -------------------------------------------------------------------------
   Specimen results. Collection knows what went into each tube; inversion
   knows whether it survived handling. Merged per tube key so the report can
   say "lavender: 4.0 mL, drawn in order, mixed 8×, usable".
   ------------------------------------------------------------------------- */
export function specimenResults(measurements){
  const col = measurements.collection;
  const inv = measurements.inversion;
  const byKey = new Map();

  if(col && col.tubes){
    for(const t of col.tubes){
      byKey.set(t.key, {
        key: t.key, name: t.name,
        drawnMl: t.drawnMl, volumeMl: t.volumeMl,
        fillPercent: t.fillPercent, requiredPercent: t.requiredPercent,
        collected: t.collected, ratioValid: t.ratioValid,
        carryoverFrom: t.carryoverFrom,
        inversions: null, required: null, haemolysis: null,
        usable: t.collected && t.ratioValid, reason: null,
      });
    }
  }
  if(inv && inv.tubes){
    for(const t of inv.tubes){
      const row = byKey.get(t.key) || { key: t.key, name: t.name, collected: true };
      row.inversions = t.inversions;
      row.required = t.required;
      row.haemolysis = t.haemolysisGrade;
      row.delaySeconds = t.delaySeconds;
      row.racked = t.racked;
      // The inversion verdict is the later one and supersedes the collection
      // guess, except that a tube never collected can never become usable.
      row.usable = row.collected === false ? false : t.usable;
      row.reason = t.reason;
      byKey.set(t.key, row);
    }
  }

  const tubes = [...byKey.values()];
  const usable = tubes.filter(t => t.usable);
  const rejected = tubes.filter(t => !t.usable);
  return {
    tubes,
    usableCount: usable.length,
    rejectedCount: rejected.length,
    total: tubes.length,
    redrawRequired: rejected.length > 0,
    rejectedReasons: rejected.map(t => ({ name: t.name, reason: t.reason || (t.collected ? "ratio" : "notCollected") })),
  };
}

/* -------------------------------------------------------------------------
   What happened to the patient. Deliberately separate from the score: a
   learner can pass the rubric and still have hurt someone, and the report
   must say so plainly.
   ------------------------------------------------------------------------- */
export function patientOutcomes(measurements){
  const pd = measurements.postDraw;
  const pal = measurements.palpation;
  const ins = measurements.insert;
  const unc = measurements.uncap;
  const tq = measurements.tourniquet;
  const out = [];

  if(ins){
    const sticks = 1 + (ins.reapproaches || 0);
    out.push({
      code: "sticks",
      text: sticks === 1
        ? "One skin puncture."
        : `${sticks} skin punctures — the needle was re-approached ${ins.reapproaches} time${ins.reapproaches === 1 ? "" : "s"}.`,
      good: sticks === 1,
    });
    if(ins.throughAndThrough) out.push({ code: "throughAndThrough", text: "The needle passed through the far wall of the vein.", good: false });
  }
  if(unc) out.push({
    code: "warned",
    text: unc.patientWarned ? "The patient was told before the needle went in." : "The needle went in without warning the patient.",
    good: !!unc.patientWarned,
  });
  if(pal && pal.hurtPatient) out.push({ code: "nerve", text: "The median nerve was pressed hard enough for the patient to feel it.", good: false });
  if(tq && tq.secondsOn != null) out.push({
    code: "tourniquetTime",
    text: `The band was on the arm for ${tq.secondsOn}s.`,
    good: tq.secondsOn <= 60,
  });
  if(pd){
    if(pd.hematomaGrade === "hematoma") out.push({ code: "hematoma", text: `A hematoma formed — ${pd.extravasatedMl} mL of blood into the tissue.`, good: false });
    else if(pd.hematomaGrade === "bruise") out.push({ code: "bruise", text: `The site bruised — ${pd.extravasatedMl} mL leaked before bleeding was controlled.`, good: false });
    else out.push({ code: "noBruise", text: "No bruising or hematoma at the site.", good: true });
    if(pd.discomfortSeconds > 3) out.push({ code: "discomfort", text: `Pressure stayed above the comfort threshold for ${pd.discomfortSeconds}s.`, good: false });
    out.push({
      code: "haemostasis",
      text: pd.haemostatic ? "The puncture had stopped bleeding before the dressing went on." : "The bleeding was never confirmed stopped.",
      good: !!pd.haemostatic,
    });
    if(pd.aftercareGiven != null) out.push({
      code: "aftercare",
      text: pd.aftercareGiven ? "Aftercare instructions were given." : "The patient left without aftercare instructions.",
      good: !!pd.aftercareGiven,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------
   Strongest actions. The rows that scored highest, plus every commendation
   that fired. Commendations carry no points — they explain a 4, they do not
   create one.
   ------------------------------------------------------------------------- */
export function strongestActions(categories){
  const best = categories
    .filter(c => c.score >= 3)
    .sort((a, b) => (b.score - a.score) || (b.mean - a.mean));
  const out = best.slice(0, 3).map(c => ({
    category: c.id, label: c.label, score: c.score,
    text: `${c.label} — ${c.band.label} (${c.score}/${c.max}). ${firstNarrative(c)}`,
  }));
  for(const c of categories){
    for(const text of c.commendations) out.push({ category: c.id, label: c.label, score: null, text, commendation: true });
  }
  return out;
}

function firstNarrative(category){
  const withEvidence = category.evidence.filter(e => e.present && e.narrative);
  if(!withEvidence.length) return "";
  return withEvidence.sort((a, b) => (b.score || 0) - (a.score || 0))[0].narrative;
}

/* -------------------------------------------------------------------------
   The practice plan. Prioritised, so the learner reads the thing that would
   have hurt someone before the thing that cost two points.

   Priority 1  automatic-failure events
   Priority 2  other critical events
   Priority 3  categories below the pass floor
   Priority 4  the widest measured deviation in each remaining row
   ------------------------------------------------------------------------- */
export function practicePlan(categories, policy){
  const p = policy || DEFAULT_POLICY;
  const plan = [];
  const seen = new Set();
  // Keyed on the action alone, not on the category: `withdrawal` feeds two
  // rows, and telling the learner to practise the same thing twice under two
  // headings is noise, not emphasis.
  const push = (priority, category, action, why, evidence)=>{
    if(seen.has(action)) return;
    seen.add(action);
    plan.push({ priority, category, action, why, evidence: evidence || null });
  };

  for(const c of categories){
    for(const e of c.criticalEvents){
      if(!e.automaticFailure) continue;
      push(1, c.id, e.label, e.why || e.message, e.message);
    }
  }
  for(const c of categories){
    for(const e of c.criticalEvents){
      if(e.automaticFailure) continue;
      push(2, c.id, e.label, e.why || e.message, e.message);
    }
  }
  for(const c of categories){
    if(c.score >= p.pass.minCategoryScore) continue;
    const worst = c.evidence.filter(e => e.present).sort((a, b) => (a.score || 0) - (b.score || 0))[0];
    push(3, c.id,
      `Rebuild ${c.label.toLowerCase()}`,
      `This row scored ${c.score}/${c.max}, below the ${p.pass.minCategoryScore} every row has to clear.`,
      worst ? worst.narrative : (c.missing.length ? `No evidence recorded for ${c.missing.join(", ")}.` : null));
  }
  for(const c of categories){
    const tolerance = c.preventedExcellence.filter(g => g.reason === "tolerance");
    if(!tolerance.length) continue;
    const widest = tolerance
      .map(g => Object.assign({ over: g.value > g.max ? g.value - g.max : g.min - g.value }, g))
      .sort((a, b) => b.over - a.over)[0];
    push(4, c.id, `Tighten ${widest.field.replace(/([A-Z])/g, " $1").toLowerCase().trim()}`, widest.detail, widest.detail);
  }

  return plan.sort((a, b) => a.priority - b.priority);
}

/** One entry per distinct event, keeping the first row that reported it. */
function dedupeEvents(events){
  const seen = new Set();
  return events.filter(e => {
    const id = `${e.qualified}|${e.item || ""}|${e.message}`;
    if(seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/* -------------------------------------------------------------------------
   The whole report.
   ------------------------------------------------------------------------- */

/**
 * @param {object} procedureState  ENC.collect — the object the steps write to
 * @param {object} [options]       { policy, context, mode, elapsedMs, patient, attemptedAt }
 */
export function buildRubricReport(procedureState, options){
  const o = options || {};
  const policy = o.policy || DEFAULT_POLICY;
  const measurements = collectMeasurements(procedureState, policy);
  // The procedure is read off the attempt itself — `ensureArmSession()` sets
  // `c.procedureId` once, at the start of the draw — so a caller never has
  // to remember to pass it, and a category's procedure-restricted feeds
  // (the winged set's, so far) resolve correctly with no extra wiring.
  const context = Object.assign(
    { procedureId: procedureState && procedureState.procedureId },
    o.context,
  );
  const categories = scoreAllCategories(measurements, policy, context);

  const total = categories.reduce((s, c) => s + c.score, 0);
  const maxTotal = categories.length * policy.maxCategoryScore;
  const percent = maxTotal ? total / maxTotal : 0;

  // A measurement can feed two rows (withdrawal feeds both technique and
  // post-draw), so the same event legitimately appears in both category
  // lists. At report scope it is ONE event and must be counted once.
  const criticalEvents = dedupeEvents(categories.reduce((acc, c) => acc.concat(c.criticalEvents), []));
  const automaticFailures = criticalEvents.filter(e => e.automaticFailure);
  const belowFloor = categories.filter(c => c.score < policy.pass.minCategoryScore);

  const failedBy = [];
  if(policy.pass.automaticFailureEnds && automaticFailures.length){
    failedBy.push({
      reason: "automaticFailure",
      detail: `${automaticFailures.length} automatic-failure event${automaticFailures.length === 1 ? "" : "s"}: ${automaticFailures.map(e => e.label).join("; ")}.`,
    });
  }
  if(percent < policy.pass.percent){
    failedBy.push({
      reason: "belowPassMark",
      detail: `Scored ${total}/${maxTotal} (${Math.round(percent * 100)}%), below the ${Math.round(policy.pass.percent * 100)}% pass mark.`,
    });
  }
  if(belowFloor.length){
    failedBy.push({
      reason: "categoryFloor",
      detail: `${belowFloor.map(c => c.label).join(", ")} scored below ${policy.pass.minCategoryScore}/${policy.maxCategoryScore}; every row has to clear it.`,
    });
  }

  return {
    kind: "practicalReport",
    policy: { id: policy.id, version: policy.version, note: policy.note },
    mode: o.mode || null,
    patient: o.patient || (procedureState && procedureState.patientName) || null,
    attemptedAt: o.attemptedAt == null ? null : o.attemptedAt,
    elapsedMs: o.elapsedMs == null ? null : o.elapsedMs,

    procedure: describeProcedure(measurements),

    total, maxTotal,
    percent: round(percent, 3),
    passMark: policy.pass.percent,
    passed: failedBy.length === 0,
    failedBy,

    categories,
    criticalEvents,
    automaticFailures,

    specimen: specimenResults(measurements),
    patientOutcomes: patientOutcomes(measurements),
    strongest: strongestActions(categories),
    preventedExcellence: categories
      .filter(c => c.score < policy.maxCategoryScore)
      .map(c => ({ category: c.id, label: c.label, score: c.score, reasons: c.preventedExcellence })),
    practicePlan: practicePlan(categories, policy),

    // Kept so a caller can show a step's own narrative without re-deriving it.
    measurements,
  };
}
