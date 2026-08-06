/* =========================================================================
   COMPLICATIONS — the rules.

   Every branch before this one models what the learner DOES. This one models
   what the patient's body does back, while they are still doing it.

   The old game had `DRAW_EVENTS`: a bubble that appeared at a random moment
   during the draw, offered three sentences, and scored the one that was
   ticked. Nothing in the draw caused it and nothing in the draw changed
   because of it. That is a quiz about complications printed over a
   venipuncture, not a venipuncture that can go wrong.

   Here a complication is caused by measurements the steps already produce,
   announced by signs the learner has to actually notice, made worse by
   carrying on, and put right — or not — by a response that is itself a real
   action with real consequences:

     HEMATOMA        the far wall was pierced, or the band was still on when
                     the needle came out, or nobody pressed. Blood goes into
                     the tissue at a rate the post-draw branch already
                     computes, and the arm swells and bruises where it went.
     BLOWN VEIN      the tip was levered out of the lumen mid-collection. The
                     flow stops AND the site swells — the pair is what tells
                     it apart from a simple positional loss of flow.
     DRY STICK       the skin is broken, nothing is coming, and the clock is
                     running. Two attempts, no blind probing, then hand off.
     VEIN COLLAPSE   a full-draw vacuum on a narrow vein pulls the wall shut.
                     The collection branch already models it; here it becomes
                     something the patient's arm SAYS, with a technique to
                     answer it rather than a retry button.
     NERVE CONTACT   a steep entry over the medial fossa. Electric, shooting
                     pain down the forearm. Withdraw at once — never redirect
                     toward it, never "just try a bit deeper".
     ARTERIAL        bright red, pulsing, filling faster than a vein should.
                     Remove, five minutes of firm pressure, notify. Outside a
                     CPT I's scope to manage further.
     FLINCH          nobody told the patient the needle was coming. They move,
                     and the tip moves with them.
     SYNCOPE         the one that is dangerous AFTER the draw as well as
                     during it. It builds — pale, clammy, quiet, yawning —
                     for real seconds before anyone faints, which is exactly
                     why "watch the patient, not the tube" is taught.

   Pure maths and pure data. No THREE, no DOM, no clock of its own: every
   function that needs the time is passed it. tests/complications.spec.js
   asserts every threshold.
   ========================================================================= */

/* =========================================================================
   THE RESPONSES

   One shared table rather than per-complication option lists, because the
   whole point is that the same small set of professional actions applies
   across them and choosing between THOSE is the skill. `harm` is what the
   action does to the patient if it is taken when it is not the right one —
   it is why "probe around for it" is not merely a wrong answer.
   ========================================================================= */
export const RESPONSE = {
  STOP_AND_PRESSURE: "stopAndPressure",
  RELEASE_BAND_FIRST: "releaseBandFirst",
  WITHDRAW_NOW: "withdrawNow",
  ADJUST_ONCE: "adjustOnce",
  BREAK_VACUUM: "breakVacuum",
  SMALLER_TUBE: "smallerTube",
  PAUSE_AND_REASSURE: "pauseAndReassure",
  RECLINE_AND_STAY: "reclineAndStay",
  CALL_FOR_HELP: "callForHelp",
  HAND_OFF: "handOff",
  CONTINUE_ANYWAY: "continueAnyway",
  PROBE_AROUND: "probeAround",
  IGNORE: "ignore",
};

export const RESPONSES = {
  [RESPONSE.STOP_AND_PRESSURE]: {
    id: RESPONSE.STOP_AND_PRESSURE, label: "Stop, take the needle out, hold firm pressure",
    halts: true,
    harm: 0.0,
  },
  [RESPONSE.RELEASE_BAND_FIRST]: {
    id: RESPONSE.RELEASE_BAND_FIRST, label: "Release the tourniquet, then remove and press",
    halts: true,
    harm: 0.0,
  },
  [RESPONSE.WITHDRAW_NOW]: {
    id: RESPONSE.WITHDRAW_NOW, label: "Withdraw the needle immediately",
    halts: true,
    harm: 0.0,
  },
  [RESPONSE.ADJUST_ONCE]: {
    id: RESPONSE.ADJUST_ONCE, label: "One careful adjustment along the same line",
    // A single deliberate adjustment is correct for a dry stick and wrong —
    // actively harmful — for anything that has already breached a wall.
    harm: 0.35,
  },
  [RESPONSE.BREAK_VACUUM]: {
    id: RESPONSE.BREAK_VACUUM, label: "Back the tube off to the guideline, let the vein refill",
    harm: 0.05,
  },
  [RESPONSE.SMALLER_TUBE]: {
    id: RESPONSE.SMALLER_TUBE, label: "Change to a smaller-volume tube",
    harm: 0.05,
  },
  [RESPONSE.PAUSE_AND_REASSURE]: {
    id: RESPONSE.PAUSE_AND_REASSURE, label: "Pause, steady the arm, check the site, reassure them",
    harm: 0.05,
  },
  [RESPONSE.RECLINE_AND_STAY]: {
    id: RESPONSE.RECLINE_AND_STAY, label: "Stop, lie them back, cold cloth, stay with them",
    halts: true,
    harm: 0.0,
  },
  [RESPONSE.CALL_FOR_HELP]: {
    id: RESPONSE.CALL_FOR_HELP, label: "Call for help and stay with the patient",
    halts: true,
    harm: 0.0,
  },
  [RESPONSE.HAND_OFF]: {
    id: RESPONSE.HAND_OFF, label: "Stop after two attempts and hand off to a colleague",
    halts: true,
    harm: 0.0,
  },
  [RESPONSE.CONTINUE_ANYWAY]: {
    id: RESPONSE.CONTINUE_ANYWAY, label: "Carry on with the draw",
    harm: 0.9,
  },
  [RESPONSE.PROBE_AROUND]: {
    id: RESPONSE.PROBE_AROUND, label: "Probe around under the skin until it flows",
    harm: 1.0,
  },
  [RESPONSE.IGNORE]: {
    id: RESPONSE.IGNORE, label: "Say nothing and keep going",
    harm: 0.85,
  },
};

export function responseLabel(id){
  return RESPONSES[id] ? RESPONSES[id].label : id;
}

/**
 * Whether choosing this response ends the draw where it stands.
 *
 * It is not a UI flag. "Stop, take the needle out and hold pressure" is not a
 * sentence you say and then carry on collecting — it is the end of this
 * attempt, with however many tubes are already off the holder, and the report
 * has to be built from that. The learner who answers a blown vein correctly
 * really does walk away with two of the four tubes, and that is the lesson.
 */
export function haltsDraw(responseId){
  return !!(RESPONSES[responseId] && RESPONSES[responseId].halts);
}

/* =========================================================================
   THE COMPLICATIONS

   `cue` is what a learner who is watching the patient would see or hear;
   `hidden` is the same thing stated as a bare observation, for the Final
   Practical, where nobody narrates. `sign` drives the 3D arm.

   `options` are always offered in this order and shuffled by the caller; the
   correct ones are named explicitly rather than being "the first one".
   ========================================================================= */
export const COMPLICATION = {
  HEMATOMA: "hematoma",
  BLOWN_VEIN: "blownVein",
  DRY_STICK: "dryStick",
  VEIN_COLLAPSE: "veinCollapse",
  NERVE_CONTACT: "nerveContact",
  ARTERIAL: "arterialPuncture",
  FLINCH: "flinch",
  SYNCOPE: "syncope",
};

export const COMPLICATIONS = {
  [COMPLICATION.HEMATOMA]: {
    id: COMPLICATION.HEMATOMA,
    label: "Hematoma forming",
    emoji: "🩸",
    severity: "urgent",
    /** seconds before failing to react counts as not having noticed it */
    noticeWindowS: 12,
    cue: ["A lump is rising under the skin at the site and the skin is darkening around it."],
    hidden: "The site looks fuller than it did a moment ago.",
    sign: { swelling: 0.7, bruise: 0.6 },
    options: [RESPONSE.RELEASE_BAND_FIRST, RESPONSE.STOP_AND_PRESSURE, RESPONSE.CONTINUE_ANYWAY, RESPONSE.IGNORE],
    correct: [RESPONSE.RELEASE_BAND_FIRST, RESPONSE.STOP_AND_PRESSURE],
    why: "Blood is leaving the vessel into the tissue. Everything that keeps it there — the tourniquet, the needle, the lack of pressure — has to come off, in that order.",
    teaching: "A rising lump under a tourniquet is a hematoma until proved otherwise. Release the band, remove the needle, and hold firm pressure for several minutes. Drawing through it makes the bruise and the patient's pain worse and can still fail.",
  },

  [COMPLICATION.BLOWN_VEIN]: {
    id: COMPLICATION.BLOWN_VEIN,
    label: "Vein blown",
    emoji: "💢",
    severity: "urgent",
    noticeWindowS: 10,
    cue: ["The flow has stopped and the site is puffing up around the needle."],
    hidden: "Nothing more is going into the tube.",
    sign: { swelling: 0.55, bruise: 0.45 },
    options: [RESPONSE.STOP_AND_PRESSURE, RESPONSE.ADJUST_ONCE, RESPONSE.PROBE_AROUND, RESPONSE.CONTINUE_ANYWAY],
    correct: [RESPONSE.STOP_AND_PRESSURE],
    why: "The wall is torn: there is no lumen left to sit in, so there is nothing to adjust toward.",
    teaching: "Flow stopping AND the site swelling together mean the vein has blown. Take the needle out and hold pressure. A new site — the other arm, or well away from this one — is the only way on. Redirecting inside a blown vein just enlarges the tear.",
  },

  [COMPLICATION.DRY_STICK]: {
    id: COMPLICATION.DRY_STICK,
    label: "No flash",
    emoji: "🫥",
    severity: "manage",
    noticeWindowS: 18,
    cue: ["The needle is in and nothing has flashed back."],
    hidden: "The flash chamber is still empty.",
    sign: {},
    options: [RESPONSE.ADJUST_ONCE, RESPONSE.HAND_OFF, RESPONSE.PROBE_AROUND, RESPONSE.CONTINUE_ANYWAY],
    correct: [RESPONSE.ADJUST_ONCE, RESPONSE.HAND_OFF],
    why: "One deliberate adjustment along the line you chose is technique. Anything past that is searching, and there are nerves and an artery in the search area.",
    teaching: "A dry stick gets one careful adjustment — a small advance or withdrawal along the SAME line, never a sweep. Two failed attempts is the limit: stop, apologise, and hand off. Blind probing is how median nerves get injured.",
  },

  [COMPLICATION.VEIN_COLLAPSE]: {
    id: COMPLICATION.VEIN_COLLAPSE,
    label: "Vein collapsing under the vacuum",
    emoji: "🫗",
    severity: "manage",
    noticeWindowS: 15,
    cue: ["The tube started filling and then slowed to nothing, with the needle still where it was."],
    hidden: "The flow into the tube has tailed off early.",
    sign: {},
    options: [RESPONSE.BREAK_VACUUM, RESPONSE.SMALLER_TUBE, RESPONSE.PROBE_AROUND, RESPONSE.CONTINUE_ANYWAY],
    correct: [RESPONSE.BREAK_VACUUM, RESPONSE.SMALLER_TUBE],
    why: "The tube's vacuum is stronger than the vein can supply, so the wall is being pulled against the bevel. Nothing is wrong with the needle's position.",
    teaching: "A vein that fills then stops, with the needle unmoved, has been pulled shut by the vacuum. Back the tube off to the guideline to break it, let the vein refill for a couple of seconds, and re-engage — or use a smaller tube or a winged set from the start on a vein you can see is narrow.",
  },

  [COMPLICATION.NERVE_CONTACT]: {
    id: COMPLICATION.NERVE_CONTACT,
    label: "Nerve contact",
    emoji: "⚡",
    severity: "urgent",
    noticeWindowS: 6,
    cue: ["\"Ow — that's electric, it's shooting into my hand!\""],
    hidden: "The patient's hand jerks and they gasp.",
    sign: { flinch: 1 },
    options: [RESPONSE.WITHDRAW_NOW, RESPONSE.ADJUST_ONCE, RESPONSE.CONTINUE_ANYWAY, RESPONSE.IGNORE],
    correct: [RESPONSE.WITHDRAW_NOW],
    why: "Shooting, electric or radiating pain is nerve involvement. Time under the needle is the thing that decides whether it is a bad memory or a lasting injury.",
    teaching: "Electric or radiating pain means withdraw immediately — the whole needle, at once, not a reposition. Then document it and report it. This is why the median side of the fossa is a last-resort site and why depth and angle are not a matter of taste.",
  },

  [COMPLICATION.ARTERIAL]: {
    id: COMPLICATION.ARTERIAL,
    label: "Arterial puncture",
    emoji: "🚨",
    severity: "urgent",
    noticeWindowS: 8,
    cue: ["The tube is filling fast with bright red blood, and it is pulsing."],
    hidden: "The blood coming into the tube is unusually bright and the flow is throbbing.",
    sign: { flush: 0.6 },
    options: [RESPONSE.STOP_AND_PRESSURE, RESPONSE.CALL_FOR_HELP, RESPONSE.CONTINUE_ANYWAY, RESPONSE.IGNORE],
    correct: [RESPONSE.STOP_AND_PRESSURE, RESPONSE.CALL_FOR_HELP],
    why: "An artery bleeds at arterial pressure. It stops when someone holds it, and not before.",
    teaching: "Bright red, pulsing, rapid filling is an arterial puncture. Remove the needle at once and hold firm pressure for at least five minutes, then have someone check it before the patient leaves, and notify. It is outside a CPT I's scope to do anything else with it.",
  },

  [COMPLICATION.FLINCH]: {
    id: COMPLICATION.FLINCH,
    label: "Patient flinched",
    emoji: "😣",
    severity: "manage",
    noticeWindowS: 8,
    cue: ["\"Sorry — I didn't know you were going in yet!\" Their arm pulled back as the needle went in."],
    hidden: "The arm moves under your hand.",
    sign: { flinch: 1 },
    options: [RESPONSE.PAUSE_AND_REASSURE, RESPONSE.CONTINUE_ANYWAY, RESPONSE.IGNORE, RESPONSE.PROBE_AROUND],
    correct: [RESPONSE.PAUSE_AND_REASSURE],
    why: "The needle moved with the arm. Whether it is still where it was is a thing to check, not to assume.",
    teaching: "Tell the patient before you go in — \"small sharp scratch now\" — and most of this never happens. If it does: pause, steady the arm, check the site and the flow, and reassure them. Never hold an arm down and keep going.",
  },

  [COMPLICATION.SYNCOPE]: {
    id: COMPLICATION.SYNCOPE,
    label: "Patient going faint",
    emoji: "😵‍💫",
    severity: "urgent",
    noticeWindowS: 14,
    cue: ["They have gone quiet and pale, there is sweat on their forehead, and they just yawned twice."],
    hidden: "They have stopped talking. Their face looks damp.",
    sign: { pallor: 0.8 },
    options: [RESPONSE.RECLINE_AND_STAY, RESPONSE.CALL_FOR_HELP, RESPONSE.CONTINUE_ANYWAY, RESPONSE.IGNORE],
    correct: [RESPONSE.RECLINE_AND_STAY, RESPONSE.CALL_FOR_HELP],
    why: "The faint is not the emergency. The fall is. Everything useful happens in the seconds before it, and they are visible.",
    teaching: "Pallor, sweating, yawning and going quiet are the prodrome of a vasovagal faint. Stop the draw, remove the needle, lie them back or lower their head, apply a cold cloth, and stay with them — never leave to fetch help from a patient who is about to fall.",
  },
};

export function complicationFor(id){ return COMPLICATIONS[id] || null; }
export function allComplicationIds(){ return Object.keys(COMPLICATIONS); }

/** True when this response is one of the right answers for this complication. */
export function isCorrectResponse(complicationId, responseId){
  const c = complicationFor(complicationId);
  if(!c) return false;
  return c.correct.indexOf(responseId) >= 0;
}

/** What a wrong answer does to the patient, 0..1. */
export function harmOf(responseId){
  const r = RESPONSES[responseId];
  return r ? r.harm : 0.5;
}

/* =========================================================================
   THE TRIGGERS

   Every threshold below is read off a measurement some earlier branch already
   produces. Nothing here rolls a die except the two that genuinely are
   probabilistic in life — a patient's own vasovagal tendency, and whether an
   unannounced needle makes THIS person jump — and both of those are seeded
   from explicit trigger data on the patient, never inferred from prose.
   ========================================================================= */

/** Seconds with a broken skin and no flash before it is a dry stick. */
export const DRY_STICK_AFTER_S = 11;
/** Millilitres into the tissue before a hematoma is visible. */
export const HEMATOMA_VISIBLE_ML = 0.35;
/** ...and the volume at which it is the bruise the patient rings up about. */
export const HEMATOMA_LARGE_ML = 1.4;
/** Metres of lateral tip excursion that tears the wall rather than exiting it. */
export const BLOWN_SHEAR_M = 0.0022;
/** Seconds of unaddressed prodrome before the patient actually faints. */
export const SYNCOPE_FAINT_AFTER_S = 16;

/**
 * A patient's own likelihood of a vasovagal reaction, 0..1, from explicit
 * trigger data only: a stated history, an age band, and the mood the
 * encounter generator gave them. A draw that runs long adds to it, because
 * it genuinely does.
 */
export function syncopeRiskFor(patient){
  const p = patient || {};
  const h = p.history || {};
  let risk = 0.06;
  if(h.faintHistory) risk += 0.45;
  if(p.ageCat === "Teen") risk += 0.12;
  if(p.ageCat === "Child") risk += 0.10;
  if(["Nervous", "Anxious", "Shy"].indexOf(p.mood) >= 0) risk += 0.18;
  if(p.event && p.event.type === "respond" && p.event.safety
     && /faint|pass out/i.test((p.event.lines || []).join(" "))) risk += 0.25;
  return Math.max(0, Math.min(1, risk));
}

/**
 * The state of the draw, as the small set of numbers the triggers below
 * actually read. Built from the live procedure state, so a complication is
 * caused by the work rather than scheduled alongside it.
 *
 * Deliberately tolerant of missing sessions: the learner may be three steps
 * in, and every field a step has not reached yet is simply absent.
 */
export function snapshotDraw(c, now){
  const t = now == null ? Date.now() : now;
  const ins = c.insert || null;
  const col = c.collection || null;
  const post = c.postDraw || null;
  const tq = c.tourniquet || null;
  const unit = c.needleUnit || null;
  const vessels = c.armVessels || [];
  const chosen = ins ? vessels.find(v => v.id === ins.chosenId) || null : null;
  const current = col && col.currentKey ? col.tubes[col.currentKey] : null;

  return {
    now: t,
    /* --- the needle ------------------------------------------------------- */
    inSkin: !!(ins && ins.entryX != null),
    secondsSinceEntry: ins && ins.entryX != null && ins.events.length
      ? secondsSinceEntry(ins, t) : 0,
    flashed: !!(ins && ins.flashAt),
    reapproaches: ins ? ins.reapproaches : 0,
    angleDeg: ins ? ins.angleDeg : null,
    peakDepthM: ins ? ins.peakDepthM : 0,
    throughAndThrough: !!(ins && chosen && ins.peakDepthM > chosen.depth + chosen.calibre + 0.0018),
    entryX: ins ? ins.entryX : null,
    entryZ: ins ? ins.entryZ : null,
    chosenVessel: chosen,
    vessels,
    patientWarned: !!(unit && unit.warnedAt),

    /* --- the tubes -------------------------------------------------------- */
    collecting: !!col,
    needleOut: !!(col && col.needleOut),
    lateralShiftM: col ? col.needleLateralM : 0,
    collapsedTube: !!(current && current.collapsed),
    tubesRemaining: col ? col.order.filter(k => !col.tubes[k] || !col.tubes[k].removedAt).length : 0,

    /* --- the band and the aftercare --------------------------------------- */
    bandOn: !!(tq && tq.securedAt && !tq.releasedAt),
    extravasatedMl: post ? post.extravasatedMl : 0,
    pressureForce: post ? post.force : 0,
    clotProgress: post ? post.clotProgress : 0,

    /* --- the person ------------------------------------------------------- */
    elapsedS: c.encounter && c.encounter.startedAt ? (t - c.encounter.startedAt)/1000 : 0,
  };
}

function secondsSinceEntry(ins, t){
  for(let i = ins.events.length - 1; i >= 0; i--){
    if(ins.events[i].type === "entry") return Math.max(0, (t - ins.events[i].t)/1000);
  }
  return 0;
}

/**
 * Whether the entry point sits close enough to a hazard structure for the
 * needle to have found it. Uses the vessel's own path, not a name: the
 * brachial artery and the median nerve are geometry in this arm like
 * everything else.
 */
export function nearHazard(snapshot, kind, withinM){
  if(snapshot.entryX == null) return null;
  const reach = withinM == null ? 0.006 : withinM;
  let best = null;
  for(const v of snapshot.vessels || []){
    if(v.kind !== kind) continue;
    const d = distanceToPath(v, snapshot.entryX, snapshot.entryZ);
    if(d <= reach + v.calibre && (!best || d < best.distance)) best = { vessel: v, distance: d };
  }
  return best;
}

function distanceToPath(vessel, x, z){
  const path = vessel.path || [];
  let best = Infinity;
  for(let i = 0; i < path.length - 1; i++){
    const a = path[i], b = path[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len2 = dx*dx + dz*dz;
    let t = len2 ? ((x - a.x)*dx + (z - a.z)*dz)/len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (a.x + dx*t), z - (a.z + dz*t));
    if(d < best) best = d;
  }
  return best;
}

/**
 * Which complications this draw has just produced.
 *
 * @param {object} snapshot  snapshotDraw()'s return
 * @param {object} state     complicationState — so nothing fires twice
 * @returns {Array<{id:string, data:object}>}
 */
export function detectOnsets(snapshot, state){
  const out = [];
  const already = id => !!(state && state.active[id]);
  const done = id => !!(state && state.resolved.indexOf(id) >= 0);
  const fresh = id => !already(id) && !done(id);

  /* --- the needle went somewhere it should not have --------------------- */
  if(fresh(COMPLICATION.ARTERIAL) && snapshot.inSkin && snapshot.flashed){
    const artery = nearHazard(snapshot, "artery", 0.004);
    // A deep, steep entry over the artery, or a stick that chose it outright.
    const chose = snapshot.chosenVessel && snapshot.chosenVessel.kind === "artery";
    if(chose || (artery && snapshot.peakDepthM >= artery.vessel.depth*0.92)){
      out.push({ id: COMPLICATION.ARTERIAL, data: { vessel: artery ? artery.vessel.id : "brachial-artery" } });
    }
  }

  if(fresh(COMPLICATION.NERVE_CONTACT) && snapshot.inSkin){
    const nerve = nearHazard(snapshot, "nerve", 0.005);
    if(nerve && snapshot.peakDepthM >= nerve.vessel.depth*0.85){
      out.push({ id: COMPLICATION.NERVE_CONTACT, data: { vessel: nerve.vessel.id, depthM: snapshot.peakDepthM } });
    }
  }

  /* --- nobody said anything and the arm moved --------------------------- */
  if(fresh(COMPLICATION.FLINCH) && snapshot.inSkin && !snapshot.patientWarned
     && state && state.flinchRoll < state.flinchChance){
    out.push({ id: COMPLICATION.FLINCH, data: null });
  }

  /* --- the stick that never landed -------------------------------------- */
  if(fresh(COMPLICATION.DRY_STICK) && snapshot.inSkin && !snapshot.flashed
     && snapshot.secondsSinceEntry >= DRY_STICK_AFTER_S){
    out.push({ id: COMPLICATION.DRY_STICK, data: { seconds: Math.round(snapshot.secondsSinceEntry) } });
  }

  /* --- the wall gave way ------------------------------------------------ */
  if(fresh(COMPLICATION.BLOWN_VEIN) && snapshot.collecting
     && (snapshot.lateralShiftM >= BLOWN_SHEAR_M || (snapshot.needleOut && snapshot.throughAndThrough))){
    out.push({ id: COMPLICATION.BLOWN_VEIN, data: { lateralMm: Math.round(snapshot.lateralShiftM*1000*10)/10 } });
  }

  if(fresh(COMPLICATION.VEIN_COLLAPSE) && snapshot.collapsedTube){
    out.push({ id: COMPLICATION.VEIN_COLLAPSE, data: null });
  }

  /* --- blood where it should not be ------------------------------------- */
  if(fresh(COMPLICATION.HEMATOMA)){
    const leaked = snapshot.extravasatedMl >= HEMATOMA_VISIBLE_ML;
    const throughUnderBand = snapshot.throughAndThrough && snapshot.bandOn && snapshot.inSkin;
    if(leaked || throughUnderBand){
      out.push({ id: COMPLICATION.HEMATOMA, data: { ml: snapshot.extravasatedMl, underBand: throughUnderBand } });
    }
  }

  /* --- the patient ------------------------------------------------------- */
  if(fresh(COMPLICATION.SYNCOPE) && state){
    // The prodrome starts once this draw has been going long enough for the
    // reaction to build, scaled by the patient's own risk. A calm patient with
    // no history reaches it only on a very long draw, and often not at all.
    const pressure = state.distress + Math.min(1, snapshot.elapsedS/240);
    if(snapshot.inSkin && state.syncopeRisk*pressure >= state.syncopeThreshold){
      out.push({ id: COMPLICATION.SYNCOPE, data: { risk: state.syncopeRisk } });
    }
  }

  return out;
}

/* =========================================================================
   JUDGEMENT
   ========================================================================= */

function issue(code, severity, message, data){
  return { code, severity, message, data: data == null ? null : data };
}

/**
 * What is outstanding right now: anything unanswered, and anything answered
 * badly. Same shape as every other branch's evaluate*(), so the coach layer
 * and the tests read it the same way.
 */
export function evaluateComplications(state, now){
  const t = now == null ? Date.now() : now;
  const issues = [];
  const pending = [];

  for(const id of state.order){
    const rec = state.active[id];
    if(!rec) continue;
    const def = complicationFor(id);
    const waited = (t - rec.onsetAt)/1000;
    if(!rec.respondedAt){
      pending.push({ id, waited, def });
      issues.push(issue(id, def.severity === "urgent" ? "block" : "warn",
        `${def.label}. ${def.why}`, { waited }));
    }
  }

  for(const rec of state.history){
    if(rec.correct === false){
      const def = complicationFor(rec.id);
      issues.push(issue(`${rec.id}.wrong`, "block",
        `${def.label} was answered with "${responseLabel(rec.responseId)}". ${def.teaching}`, rec));
    }
  }

  const order = ["block", "warn", "note"];
  issues.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));

  return {
    issues,
    pending,
    blocking: issues.filter(i => i.severity === "block"),
    /** nothing is waiting on the learner right now */
    clear: pending.length === 0,
    ready: pending.length === 0,
  };
}

export function nextAction(state){
  const first = state.order.map(id => state.active[id]).find(r => r && !r.respondedAt);
  if(!first) return "Keep watching the patient as well as the tube.";
  const def = complicationFor(first.id);
  return `${def.emoji} ${def.label} — decide what to do about it.`;
}
