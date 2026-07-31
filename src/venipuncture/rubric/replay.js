/* =========================================================================
   SESSION REPLAY — one timeline, merged from the event logs every step
   module already keeps.

   Nothing new is recorded for this. Each `*State.js` has kept an `events[]`
   since it was written; the report needs them in one order, on one clock,
   attributed to the section they came from and shown against the
   measurement that graded that section.

   TWO CLOCKS, AND WHY THAT MATTERS
   --------------------------------
   Staging logs `t` RELATIVE to its own `startedAt`; every other module logs
   an absolute `Date.now()`. Merging them naïvely puts the whole supply-cart
   phase in 1970. `normaliseEvents()` is where that is fixed, once, rather
   than in whatever renders the list.

   Pure. No DOM.
   ========================================================================= */
import { SECTIONS, measurementField } from "../sections.js";

/**
 * Where each section's event log lives, and how its `t` is expressed.
 * `relative:true` means `t` is milliseconds since the session's own
 * `startedAt` rather than a wall clock.
 */
export const EVENT_SOURCES = [
  { section:"introduction", session:"introduction" },
  { section:"prep",       session:"supplies",  path:["state"], relative:true },
  { section:"tourniquet", session:"tourniquet" },
  { section:"palpation",  session:"palpation" },
  { section:"cleaning",   session:"cleaning" },
  { section:"equipment",  session:"needleUnit" },
  { section:"insert",     session:"insert" },
  { section:"collection", session:"collection" },
  { section:"withdrawal", session:"withdrawal" },
  { section:"postDraw",   session:"postDraw" },
  { section:"inversion",  session:"inversion" },
];

function sessionOf(c, source){
  let obj = c ? c[source.session] : null;
  for(const key of (source.path || [])) obj = obj ? obj[key] : null;
  return obj;
}

/** Every event from one session, on the wall clock, tagged with its section. */
export function normaliseEvents(session, source){
  if(!session || !Array.isArray(session.events)) return [];
  const base = source.relative ? (session.startedAt || 0) : 0;
  return session.events.map(e => ({
    at: base + e.t,
    section: source.section,
    type: e.type,
    // staging spreads its detail onto the event; everything else nests it
    // under `data`. Normalised here so the renderer sees one shape.
    data: Object.prototype.hasOwnProperty.call(e, "data")
      ? e.data
      : omit(e, ["t", "type"]),
  }));
}

function omit(obj, keys){
  const out = {};
  for(const k of Object.keys(obj)){ if(keys.indexOf(k) < 0) out[k] = obj[k]; }
  return Object.keys(out).length ? out : null;
}

/**
 * The whole attempt as one ordered timeline, grouped by section, with each
 * group carrying the measurement that graded it.
 *
 * @param {object} procedureState  ENC.collect
 * @param {object} [o]             { startedAt } — the encounter's own start
 */
export function buildReplay(procedureState, o){
  const c = procedureState || {};
  const opt = o || {};

  let events = [];
  for(const source of EVENT_SOURCES){
    events = events.concat(normaliseEvents(sessionOf(c, source), source));
  }
  events.sort((a, b) => a.at - b.at);

  const startedAt = opt.startedAt != null
    ? opt.startedAt
    : (events.length ? events[0].at : null);

  for(const e of events) e.offsetMs = startedAt == null ? 0 : Math.max(0, e.at - startedAt);

  const groups = SECTIONS
    .map(section => {
      const own = events.filter(e => e.section === section.id);
      const readings = section.measurements
        .map(key => ({ key, measurement: c[measurementField(key)] || null }))
        .filter(x => !!x.measurement);
      if(!own.length && !readings.length) return null;
      return {
        id: section.id,
        label: section.label,
        events: own,
        readings,
        startedAt: own.length ? own[0].at : null,
        endedAt: own.length ? own[own.length - 1].at : null,
        durationMs: own.length ? own[own.length - 1].at - own[0].at : 0,
        score: readings.length
          ? Math.round(readings.reduce((s, r) => s + (r.measurement.score || 0), 0) / readings.length)
          : null,
      };
    })
    .filter(Boolean);

  return {
    startedAt,
    endedAt: events.length ? events[events.length - 1].at : null,
    durationMs: events.length && startedAt != null ? events[events.length - 1].at - startedAt : 0,
    count: events.length,
    events,
    groups,
  };
}

/** mm:ss.s from the start of the attempt. */
export function stamp(offsetMs){
  const s = Math.max(0, offsetMs || 0) / 1000;
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest < 10 ? "0" : ""}${rest.toFixed(1)}`;
}

/**
 * A readable label for an event type. Deliberately falls back to the raw
 * type rather than inventing prose for a code it does not know — an
 * unrecognised event should look unrecognised, not plausible.
 */
export const EVENT_LABELS = {
  /* introduction — every act is its own event type */
  greet: "introduced yourself",
  askNameOpen: "asked them to state their name",
  askNameLeading: "read the name out for them to agree with",
  askDobOpen: "asked them to state their date of birth",
  askDobLeading: "read the date of birth out for them to agree with",
  checkWristband: "read the wristband",
  confirmOrder: "confirmed the order",
  explain: "explained what was about to happen",
  askAllergies: "asked about allergies",
  askFainting: "asked about fainting",
  position: "seated them and supported the arm",
  handHygiene: "went to the sink",
  glove: "put gloves on",
  touchPhone: "answered the phone",
  touchDoor: "pulled the curtain",
  scrub: "rubbed your hands",
  chooseGloves: "changed which gloves were on the tray",
  reglove: "changed to fresh gloves",
  /* staging */
  place: "moved an item",
  inspect: "turned a package over",
  contaminate: "an item went on the floor",
  handedness: "switched working side",
  /* tourniquet */
  route: "passed the band round the arm",
  cross: "crossed the band over",
  secure: "secured the band",
  release: "released the band",
  unravel: "the band came undone",
  /* palpation */
  felt: "felt a structure",
  choose: "chose a vein",
  clearChoice: "un-chose the vein",
  nerveHurt: "pressed hard enough to hurt",
  /* cleaning */
  openSwab: "opened the alcohol pad",
  retouched: "touched the cleaned site",
  blotted: "fanned or blotted the site",
  reset: "started the site again",
  /* assembly and uncapping */
  pouchOpen: "opened the needle pouch",
  lift: "lifted the needle out",
  engage: "started threading",
  backOut: "backed the needle out",
  freshNeedle: "took a fresh needle",
  contaminated: "contaminated the needle",
  touchNeedle: "touched the bare needle",
  capOff: "pulled the sheath off",
  placeCap: "put the sheath down",
  recap: "recapped by hand",
  inspectBevel: "looked at the bevel",
  warnPatient: "warned the patient",
  /* insertion */
  anchor: "anchored the vein",
  resetAnchor: "redid the anchor",
  entry: "broke the skin",
  flash: "flash of blood",
  withdrawnFully: "pulled the needle back out",
  /* collection */
  takeTube: "took a tube",
  pierce: "pierced the stopper",
  breakVacuum: "broke the vacuum",
  collapsed: "the vein collapsed",
  deadOnAir: "the tube drew nothing",
  removeTube: "removed the tube",
  returnTube: "put the tube back",
  discardTube: "binned a tube",
  redrawTube: "took a replacement tube",
  needleOut: "the needle came out of the lumen",
  /* withdrawal, safety, sharps */
  fistRelaxed: "asked the patient to open their hand",
  // distinct from the tourniquet section's own `release`: this is the band
  // coming off as part of finishing the draw, and the two must not read
  // identically in a merged timeline
  bandReleased: "released the band before withdrawing",
  gauzeTaken: "took the gauze",
  gauzePlaced: "laid the gauze over the site",
  pressedEarly: "pressed while the needle was still in",
  withdrawn: "withdrew the needle",
  safetyLocked: "engaged the safety",
  surfaceActivation: "struck the safety against a surface",
  recapAttempted: "tried to recap the used needle",
  exposedSetDown: "set an exposed sharp down",
  shieldedSetDown: "parked the shielded unit",
  crossedPatient: "carried the sharp across the patient",
  trashAttempted: "offered the sharp to normal waste",
  disposed: "into the sharps container",
  /* pressure and bandaging */
  pressureStarted: "pressure on the site",
  releasedEarly: "let the pressure off early",
  checked: "uncovered and checked the site",
  bandaged: "dressed the site",
  bandageRemoved: "took the dressing off again",
  aftercare: "gave aftercare instructions",
  /* mixing */
  pickUp: "picked a tube up",
  inversion: "inverted the tube",
  firstMixed: "first mix of this tube",
  rock: "rocked the tube without inverting it",
  rack: "stood the tube back in the rack",
};

export function labelFor(type){
  return EVENT_LABELS[type] || type;
}
