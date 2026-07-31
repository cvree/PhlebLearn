/* =========================================================================
   RUBRIC POLICY — every threshold the practical is graded against, in one
   editable file.

   WHY THIS FILE EXISTS, AND WHAT IT IS NOT
   ----------------------------------------
   The brief is explicit on two points:

     1. Grading thresholds and automatic-failure rules must be configurable,
        not buried in runtime code. So they live here, as plain data, and
        `rubricRules.js` / `rubricReport.js` contain no numbers of their own.

     2. The school's real automatic-failure policy must NOT be invented. So
        every entry below is a DOCUMENTED DEFAULT — a defensible starting
        point drawn from what the simulation can actually measure, marked
        with the reasoning that produced it. Where a real programme's policy
        differs, change the data here; nothing else needs to move.

   Anything in this file marked `default:` is our choice, not a citation.

   THE SHAPE
   ---------
     CATEGORIES        the rubric rows, and which measurement keys feed each
     BANDS             the 0–4 cut points, applied to a category's 0–100 mean
     EXCELLENCE        what a category must clear to be allowed a 4 at all
     CRITICAL_EVENTS   qualified mistake codes that are reportable events,
                       and whether each is an automatic failure
     PASS              the pass mark for the whole practical

   MEASUREMENT KEYS are the eleven (twelve with `introduction`) stable names
   every converted step already writes. `MEASUREMENT_SOURCES` maps each to
   the field it currently lives under on the procedure state, so the rubric
   never reaches into a step module directly.
   ========================================================================= */

/** key → the procedure-state field the step's own scoring module writes. */
export const MEASUREMENT_SOURCES = {
  introduction: "introductionMeasurements",
  supplyStaging: "stagingMeasurements",
  tourniquet: "tourniquetMeasurements",
  palpation: "palpationMeasurements",
  cleaning: "cleaningMeasurements",
  assembly: "assemblyMeasurements",
  uncap: "uncapMeasurements",
  insert: "insertMeasurements",
  collection: "collectionMeasurements",
  withdrawal: "withdrawalMeasurements",
  postDraw: "postDrawMeasurements",
  inversion: "inversionMeasurements",
  butterfly: "butterflyMeasurements",
};

export const MEASUREMENT_LABELS = {
  introduction: "Introduction and identification",
  supplyStaging: "Work-area preparation",
  tourniquet: "Tourniquet",
  palpation: "Vein selection",
  cleaning: "Site antisepsis",
  assembly: "Needle assembly",
  uncap: "Uncapping",
  insert: "Anchor and insertion",
  collection: "Tube collection",
  withdrawal: "Withdrawal, safety and sharps",
  postDraw: "Pressure and bandaging",
  inversion: "Specimen mixing",
  butterfly: "Winged set handling",
};

/* =========================================================================
   THE 0–4 BANDS

   Applied to a category's weighted mean of its feeding 0–100 measurement
   scores. A band is the CEILING a category can reach on numbers alone;
   EXCELLENCE below decides whether the top band is actually awarded.

   default: the cut points are set so that "did the thing, with a couple of
   measurable imperfections" lands on 3 rather than 4 — the brief is explicit
   that technically-completed must not automatically be excellent.
   ========================================================================= */
export const BANDS = [
  { score: 4, min: 90, label: "Excellent",   meaning: "Independent, in sequence, inside every tolerance, no warnings." },
  { score: 3, min: 78, label: "Proficient",  meaning: "Complete and safe, with measurable deviations that did not affect the patient or the specimen." },
  { score: 2, min: 60, label: "Developing",  meaning: "Completed, but with errors that would degrade the specimen or the patient's experience." },
  { score: 1, min: 35, label: "Beginning",   meaning: "Attempted; the clinical intent of the step was not achieved." },
  { score: 0, min: 0,  label: "Not performed", meaning: "Absent, or performed in a way that undid the step." },
];

/* =========================================================================
   THE CATEGORIES

   `feeds` is [measurementKey, weight]. Weights are relative within the row.

   `excellence` is what blocks a 4 even when the arithmetic allows one:
     requireAll      every feeding measurement must be present
     maxMistakes     total mistakes across the row (0 = "free of warnings")
     sequence        [{key, field, equals, label}] — real ordering fields
     ranges          [{key, field, min, max, unit, label}] — real tolerances

   Every `field` named below exists on the measurement object the step's own
   *Scoring.js already returns. Nothing here invents a number.
   ========================================================================= */
export const CATEGORIES = [
  {
    id: "introduction",
    label: "Introduction and identification",
    feeds: [["introduction", 1]],
    excellence: {
      requireAll: true,
      maxMistakes: 0,
      sequence: [
        { key: "introduction", field: "identifiedBeforeTouching", equals: true,
          label: "identity confirmed before anything was touched" },
        { key: "introduction", field: "gloveAfterHygiene", equals: true,
          label: "gloves went on after hand hygiene, not before" },
      ],
      ranges: [
        { key: "introduction", field: "handHygieneSeconds", min: 20, max: 60, unit: "s",
          label: "hand-hygiene duration" },
      ],
    },
  },
  {
    id: "preparation",
    label: "Patient preparation",
    feeds: [["tourniquet", 1], ["palpation", 1], ["cleaning", 1]],
    excellence: {
      requireAll: true,
      maxMistakes: 0,
      sequence: [
        { key: "palpation", field: "feltChosen", equals: true,
          label: "the chosen vein was palpated before it was chosen" },
        { key: "cleaning", field: "retouched", equals: false,
          label: "the cleaned field was not touched again" },
      ],
      ranges: [
        { key: "tourniquet", field: "secondsOn", min: 0, max: 60, unit: "s",
          label: "tourniquet time" },
        { key: "tourniquet", field: "heightAboveSiteInches", min: 3, max: 4, unit: "″",
          label: "band height above the site" },
        { key: "cleaning", field: "coveragePct", min: 90, max: 100, unit: "%",
          label: "prep-field coverage" },
        { key: "cleaning", field: "dryingSeconds", min: 30, max: 120, unit: "s",
          label: "air-drying time" },
      ],
    },
  },
  {
    id: "equipment",
    label: "Equipment and supplies",
    feeds: [["supplyStaging", 1], ["assembly", 1], ["uncap", 1]],
    excellence: {
      requireAll: true,
      maxMistakes: 0,
      sequence: [
        { key: "supplyStaging", field: "ready", equals: true,
          label: "the draw began from a work area that was actually ready" },
        { key: "uncap", field: "recapped", equals: false,
          label: "no sheath went back on by hand" },
      ],
      ranges: [
        { key: "supplyStaging", field: "inspectionRate", min: 0.6, max: 1, unit: "",
          label: "packages checked before staging" },
        { key: "assembly", field: "turns", min: 1.5, max: 3, unit: " turns",
          label: "needle-to-holder engagement" },
        { key: "uncap", field: "axialPct", min: 90, max: 100, unit: "%",
          label: "sheath pulled along the needle's axis" },
        { key: "uncap", field: "bevelDeg", min: 0, max: 10, unit: "°",
          label: "bevel orientation" },
      ],
    },
  },
  {
    id: "technique",
    label: "Venipuncture technique",
    // `butterfly` only applies to the dorsal-hand procedure. A straight
    // draw's attempt never produces that measurement, and `proceduresOnly`
    // means it is correctly EXCLUDED from the row's mean rather than scored
    // as a 0 for something that was never applicable in the first place.
    feeds: [
      ["insert", 1.25], ["collection", 1], ["withdrawal", 0.75],
      ["butterfly", 0.75, { proceduresOnly: ["butterfly-hand"] }],
    ],
    excellence: {
      requireAll: true,
      maxMistakes: 0,
      sequence: [
        { key: "insert", field: "anchored", equals: true,
          label: "the vein was anchored before the stick" },
        { key: "collection", field: "orderAccuracy", equals: 1,
          label: "tubes came off in the order of draw" },
        { key: "butterfly", field: "carriedByWings", equals: true,
          label: "the set was carried by its wings, not its tubing",
          proceduresOnly: ["butterfly-hand"] },
        { key: "butterfly", field: "wingsSecured", equals: true,
          label: "the wings were taped down before the tubes were touched",
          proceduresOnly: ["butterfly-hand"] },
      ],
      // The entry-angle window is the whole reason this is a second
      // procedure rather than a reskin: 15-30° for the antecubital, 5-15°
      // for the dorsal hand. Each range is scoped to its own procedure so
      // neither draw is ever judged against the other's window.
      ranges: [
        // The antecubital window: unconditional, exactly as it always was,
        // for every attempt except the one procedure that needs its own.
        { key: "insert", field: "angleDeg", min: 15, max: 30, unit: "°",
          label: "entry angle", excludeProcedures: ["butterfly-hand"] },
        { key: "insert", field: "angleDeg", min: 5, max: 15, unit: "°",
          label: "entry angle", proceduresOnly: ["butterfly-hand"] },
        { key: "insert", field: "reapproaches", min: 0, max: 0, unit: "",
          label: "re-approaches" },
        { key: "collection", field: "peakNeedleShiftMm", min: 0, max: 1, unit: "mm",
          label: "needle movement during tube changes" },
        { key: "withdrawal", field: "exitDeviationDeg", min: 0, max: 6, unit: "°",
          label: "exit path against the entry line" },
      ],
    },
  },
  {
    id: "postDraw",
    label: "Post-draw protocol",
    feeds: [["withdrawal", 1], ["postDraw", 1.25], ["inversion", 1]],
    excellence: {
      requireAll: true,
      maxMistakes: 0,
      sequence: [
        { key: "withdrawal", field: "releasedBeforeWithdraw", equals: true,
          label: "the band came off before the needle did" },
        { key: "postDraw", field: "bandagedWhileBleeding", equals: false,
          label: "the dressing went on a site that had stopped bleeding" },
      ],
      ranges: [
        { key: "withdrawal", field: "exposedSeconds", min: 0, max: 3, unit: "s",
          label: "time the used needle stayed exposed" },
        { key: "postDraw", field: "timeToPressureS", min: 0, max: 2, unit: "s",
          label: "delay before pressure went on" },
        { key: "postDraw", field: "consistencyPercent", min: 75, max: 100, unit: "%",
          label: "steadiness of the pressure held" },
        { key: "postDraw", field: "bandageAlignMm", min: 0, max: 4, unit: "mm",
          label: "dressing alignment over the puncture" },
      ],
    },
  },
];

/* =========================================================================
   CRITICAL EVENTS

   Keyed by QUALIFIED mistake code — `measurementKey.code` — because codes
   are only unique within a step module.

   `automaticFailure: true` means the practical is failed regardless of the
   points scored. These defaults are deliberately narrow: the four sharps
   handling errors that put a second person at risk, plus the two that
   guarantee the specimen is wrong about the wrong patient.

   default: every other critical event is reported prominently and costs
   points through its own step's score, but does not end the attempt.
   ========================================================================= */
export const CRITICAL_EVENTS = {
  /* --- sharps handling: risk to the phlebotomist and to whoever empties the bin */
  "withdrawal.recapAttempted": { label: "Recapped a used needle by hand", automaticFailure: true,
    why: "Two-handed recapping is the classic needlestick mechanism." },
  "withdrawal.trashAttempted": { label: "Used sharp offered to normal waste", automaticFailure: true,
    why: "It moves the injury to someone who cannot see it coming." },
  "withdrawal.disposedExposed": { label: "Carried an unshielded sharp to the container", automaticFailure: true,
    why: "The safety exists to be engaged at the point of use." },
  "withdrawal.exposedSetDown": { label: "Set down an exposed used sharp", automaticFailure: true,
    why: "An unattended exposed needle is a hazard to everyone in the room." },
  "withdrawal.struckOnSurface": { label: "Safety activated against a surface", automaticFailure: false,
    why: "Striking the device can miss the lock and springs the needle back." },

  /* --- wrong patient / wrong specimen */
  "supplyStaging.tubeWrongPatient": { label: "Tube labelled for another patient staged", automaticFailure: true,
    why: "Misidentification is the most serious pre-analytical error there is." },
  "introduction.oneIdentifier": { label: "Fewer than two identifiers used", automaticFailure: true,
    why: "One identifier cannot distinguish two patients with the same name." },
  "introduction.leadingQuestion": { label: "Identity confirmed with a leading question", automaticFailure: false,
    why: "\"You're Mr Adams?\" invites a yes from anyone." },

  /* --- patient harm */
  "postDraw.noPressure": { label: "No pressure applied to the puncture", automaticFailure: false,
    why: "It is the one thing that stops the bleeding." },
  "postDraw.hematoma": { label: "Hematoma formed", automaticFailure: false,
    why: "The measurable consequence of pressure that was late, light or brief." },
  "postDraw.bandagedBleeding": { label: "Dressed a bleeding puncture", automaticFailure: false,
    why: "The dressing hides continued bleeding rather than stopping it." },
  "postDraw.bandageUnsterile": { label: "Unclean dressing on an open puncture", automaticFailure: false,
    why: "The puncture is an open wound for several minutes." },
  "palpation.hurtPatient": { label: "Pressed the median nerve hard enough to hurt", automaticFailure: false,
    why: "Nerve involvement is the injury patients remember and report." },

  /* --- specimen integrity */
  "inversion.underMixed": { label: "Additive tube under-mixed", automaticFailure: false,
    why: "An unmixed anticoagulant tube is not anticoagulated." },
  "inversion.mixedPlainTube": { label: "Mixed a tube that must clot undisturbed", automaticFailure: false,
    why: "It breaks up the forming clot." },
  "inversion.haemolysed": { label: "Specimen haemolysed by shaking", automaticFailure: false,
    why: "False potassium and false LDH; the specimen is rejected." },
  "inversion.clotted": { label: "Specimen clotted before mixing", automaticFailure: false,
    why: "Needs a redraw — the patient is stuck twice." },
  "collection.ratioInvalid": { label: "Tube off at an invalid additive ratio", automaticFailure: false,
    why: "A fixed-ratio tube's result is wrong, not merely imprecise." },
  "insert.throughAndThrough": { label: "Needle passed through the far wall", automaticFailure: false,
    why: "It is how a hematoma starts under a tourniquet." },
  "uncap.needleTouched": { label: "Bare needle contaminated before entry", automaticFailure: false,
    why: "It goes straight into the bloodstream." },

  /* --- the winged set: only reachable on the dorsal-hand procedure */
  "butterfly.carriedByTubing": { label: "Winged set carried by its tubing", automaticFailure: true,
    why: "The needle then goes in at whatever angle the line happens to hang at, not a chosen one." },
  "butterfly.tubingTaut": { label: "Tubing pulled taut against the needle", automaticFailure: false,
    why: "A taut line is holding the set up — the needle is anchoring it, not the hand." },
  "butterfly.infiltrationMissed": { label: "Infiltration never noticed", automaticFailure: true,
    why: "Fluid kept going into the tissue with nobody watching for it." },
  "butterfly.infiltrationNotActedOn": { label: "Infiltration recognised and ignored", automaticFailure: true,
    why: "Seeing the swelling and continuing the draw anyway." },
  "assembly.contaminated": { label: "Contaminated needle used anyway", automaticFailure: false,
    why: "The sterile barrier was already lost." },
};

/* =========================================================================
   THE PASS MARK

   default: 80% of the available points, AND no automatic-failure event, AND
   no rubric row below 2. The third condition exists because an average can
   hide one abandoned category behind four good ones.
   ========================================================================= */
export const PASS = {
  percent: 0.8,
  minCategoryScore: 2,
  automaticFailureEnds: true,
};

/* =========================================================================
   ABOVE AND BEYOND

   Observations that JUSTIFY a 4 and drive qualitative feedback. The brief
   warns explicitly against hidden bonus points that distort the rubric, so
   these carry NO score — `rubricRules.js` may read them for commentary and
   may not add them to any total. `tests/rubric.spec.js` asserts that.

   Each is {key, field, test, above?, label}. `test` is one of:
     "gte" | "lte" | "eq"
   ========================================================================= */
export const COMMENDATIONS = [
  { key: "palpation", field: "structuresFelt", test: "gte", value: 4,
    label: "Explored the whole fossa by feel rather than settling for the first vein seen." },
  { key: "palpation", field: "arteryRecognised", test: "eq", value: true,
    label: "Found the brachial pulse and left it alone." },
  { key: "supplyStaging", field: "inspectionRate", test: "gte", value: 0.95,
    label: "Read every package before it went on the tray." },
  { key: "supplyStaging", field: "trayUsableWithoutCrossing", test: "eq", value: true,
    label: "Laid the tray out so nothing had to be reached for across the prepared site." },
  { key: "uncap", field: "bevelInspected", test: "eq", value: true,
    label: "Looked at the bevel after uncapping instead of assuming it." },
  { key: "withdrawal", field: "exposedSeconds", test: "lte", value: 1.5,
    label: "The safety was locked almost the instant the needle cleared the skin." },
  { key: "postDraw", field: "aftercareGiven", test: "eq", value: true,
    label: "Told the patient how long to keep the dressing on and what to watch for." },
  { key: "inversion", field: "clottedCount", test: "eq", value: 0,
    label: "Every tube was mixed inside its window." },
];

/* =========================================================================
   THE POLICY OBJECT

   Everything above, assembled. Pass a modified copy to any rubric function
   to grade against a different programme's policy; nothing reads the module
   bindings directly.
   ========================================================================= */
export const DEFAULT_POLICY = {
  id: "documented-defaults",
  version: "2026-07",
  note: "Documented defaults, not any particular programme's published policy. Edit this file to match yours.",
  measurementSources: MEASUREMENT_SOURCES,
  measurementLabels: MEASUREMENT_LABELS,
  categories: CATEGORIES,
  bands: BANDS,
  criticalEvents: CRITICAL_EVENTS,
  commendations: COMMENDATIONS,
  pass: PASS,
  maxCategoryScore: 4,
};

/** The band a 0–100 mean falls in. Bands are ordered high → low. */
export function bandFor(mean, policy){
  const bands = (policy || DEFAULT_POLICY).bands;
  for(const b of bands){ if(mean >= b.min) return b; }
  return bands[bands.length - 1];
}

/** Looks up a qualified mistake code (`key.code`) in the policy. */
export function criticalEventFor(key, code, policy){
  const table = (policy || DEFAULT_POLICY).criticalEvents || {};
  return table[`${key}.${code}`] || null;
}
