/* =========================================================================
   STAGING SCORING — real measurements of how the work area was prepared,
   not a pass/fail stamp.

   Everything here is derived from the recorded event log and the final item
   placements, so the feedback can name the specific thing the learner did:
   which item was picked up and put back, whether the sharps container had
   to be repositioned, whether tubes went into the rack in order the first
   time, and whether packages were checked before they were committed.

   Pure logic — no DOM, no THREE.
   ========================================================================= */
import { TUBES } from "../../config.js";
import { CATEGORY, FLAW, catalogById, isUsable, hasFlaw } from "./supplyCatalog.js";
import { ZONE, elapsedMs } from "./stagingState.js";
import { ISSUE } from "./stagingRules.js";

const UNSAFE_FLAWS = [FLAW.WRONG_PATIENT, FLAW.DAMAGED, FLAW.OVERFILLED, FLAW.CLOSED, FLAW.UNSTERILE, FLAW.CONTAMINATED];

function tubeName(k){ return (TUBES[k] && TUBES[k].name) || k; }
function pct(n){ return Math.round(n*100); }
function list(arr){
  if(arr.length<=1) return arr.join("");
  if(arr.length===2) return `${arr[0]} and ${arr[1]}`;
  return `${arr.slice(0,-1).join(", ")}, and ${arr[arr.length-1]}`;
}

/**
 * @param {object} state    staging state at completion
 * @param {Array}  catalog
 * @param {object} evalResult  output of evaluateStaging()
 * @param {number} now
 */
export function measureStaging(state, catalog, evalResult, now){
  const map = catalogById(catalog);
  const required = state.requiredTubes;

  // Every item that was ever committed to a usable zone, in the order it
  // first got there.
  const everStaged = [];
  const seen = new Set();
  state.events.forEach(e=>{
    if(e.type!=="place") return;
    if(e.to!==ZONE.TRAY && e.to!==ZONE.RACK && e.to!==ZONE.REACH) return;
    if(seen.has(e.id)) return;
    seen.add(e.id); everStaged.push(e.id);
  });

  const stagedDefs = everStaged.map(id=>map.get(id)).filter(Boolean);
  const correctItems = stagedDefs.filter(isUsable);
  const incorrectItems = stagedDefs.filter(d=>!isUsable(d));
  const unsafeItems = incorrectItems.filter(d=>(d.flaws||[]).some(f=>UNSAFE_FLAWS.includes(f)));

  // Tube order: how many rack slots hold the tube the requisition expects.
  const rackKeys = state.rackSlots.map(id=>{ const d = id?map.get(id):null; return d?d.tubeKey:null; });
  const orderMatches = required.reduce((n,k,i)=>n+(rackKeys[i]===k?1:0), 0);
  const tubeOrderAccuracy = required.length ? orderMatches/required.length : 1;

  // Did any tube ever get seated in a slot that wasn't its final, correct one?
  const rackEvents = state.events.filter(e=>e.type==="place" && e.to===ZONE.RACK);
  const misseats = rackEvents.filter(e=>{
    const d = map.get(e.id);
    if(!d || !d.tubeKey) return false;
    return required[e.slot] !== d.tubeKey;
  }).length;

  // Sharps: where it went first vs. where it ended up.
  const sharpsEvents = state.events.filter(e=>{
    const d = map.get(e.id); return e.type==="place" && d && d.category===CATEGORY.SHARPS;
  });
  const sharpsFirstPlacement = sharpsEvents.find(e=>e.to!==ZONE.SHELF) || null;
  const sharpsCorrected = !!(sharpsFirstPlacement &&
    (sharpsFirstPlacement.to===ZONE.ACROSS || sharpsFirstPlacement.to===ZONE.COUNTER) &&
    evalResult.checks[CATEGORY.SHARPS] && evalResult.checks[CATEGORY.SHARPS].ok);
  const sharpsAccessible = !!(evalResult.checks[CATEGORY.SHARPS] && evalResult.checks[CATEGORY.SHARPS].ok);

  // Placement efficiency: the fewest possible pick-ups vs. what actually happened.
  const minimumMoves = 8 + required.length;   // 7 tray categories + sharps + one per tube
  const actualMoves = state.events.filter(e=>e.type==="place").length;
  const placementEfficiency = actualMoves ? Math.min(1, minimumMoves/actualMoves) : 0;

  // Inspection: did the learner turn a package over BEFORE committing it?
  const inspectedBefore = everStaged.filter(id=>state.items[id].inspectedBeforeStaging).length;
  const inspectionRate = everStaged.length ? inspectedBefore/everStaged.length : 0;

  const contaminatedCount = Object.keys(state.items).filter(id=>state.items[id].contaminated).length;
  const sterilityMistakes = contaminatedCount +
    stagedDefs.filter(d=>hasFlaw(d, FLAW.UNSTERILE) || hasFlaw(d, FLAW.DAMAGED)).length;

  const totalStagedNow = Object.keys(state.items).filter(id=>{
    const z = state.items[id].zone; return z===ZONE.TRAY||z===ZONE.RACK||z===ZONE.REACH;
  }).length;
  const handednessCompliance = totalStagedNow
    ? Math.max(0, 1 - state.reachedAcrossField/totalStagedNow)
    : 1;

  const wrongPatientCaught = stagedDefs.some(d=>hasFlaw(d, FLAW.WRONG_PATIENT));

  const m = {
    handedness: state.handedness,
    correctItems: correctItems.length,
    incorrectItems: incorrectItems.length,
    unsafeItems: unsafeItems.length,
    incorrectItemIds: incorrectItems.map(d=>d.id),
    timeMs: elapsedMs(state, now),
    replacements: state.replacements,
    tubeOrderAccuracy,
    tubeOrderFirstTry: misseats===0,
    tubeMisseats: misseats,
    sharpsAccessible,
    sharpsCorrected,
    sharpsFirstZone: sharpsFirstPlacement ? sharpsFirstPlacement.to : null,
    placementEfficiency,
    minimumMoves, actualMoves,
    handednessCompliance,
    reachedAcrossField: state.reachedAcrossField,
    inspectionRate,
    stagedCount: everStaged.length,
    inspectionsBeforeStaging: inspectedBefore,
    inspectionsTotal: Object.keys(state.items).filter(id=>state.items[id].inspected).length,
    sterilityMistakes,
    contaminatedCount,
    wrongPatientStaged: wrongPatientCaught,
    trayUsableWithoutCrossing: state.reachedAcrossField===0 && sharpsAccessible,
    ready: evalResult.ready,
    // What was still wrong at the moment the learner chose to begin the draw.
    // In a scored shift nothing stops them proceeding, so this is the report.
    mistakes: evalResult.issues
      .filter(i=>i.severity==="block")
      .map(i=>({ code:i.code, message:i.message, item:i.itemId ? (map.get(i.itemId)||{}).label : null })),
  };
  m.score = stagingScore(m);
  m.narrative = stagingNarrative(state, catalog, evalResult, m);
  return m;
}

/**
 * 0–100, weighted toward the things that actually hurt a patient.
 * The base is 94, not 100: the last six marks are only available to a
 * learner who actually read the packages before committing them, so a
 * flawless-looking tray assembled without checking anything can't score
 * full marks.
 */
export function stagingScore(m){
  let s = 94;
  s -= m.unsafeItems * 22;
  s -= (m.incorrectItems - m.unsafeItems) * 9;
  s -= m.sterilityMistakes * 12;
  s -= Math.round((1 - m.tubeOrderAccuracy) * 20);
  if(!m.sharpsAccessible) s -= 18;
  else if(m.sharpsCorrected) s -= 4;      // corrected before starting: small ding, not a failure
  s -= Math.round((1 - m.handednessCompliance) * 8);
  s -= Math.round((1 - m.placementEfficiency) * 8);
  // beginning a draw from a work area that isn't ready is its own failure,
  // separate from whatever specific items were wrong
  if(!m.ready) s -= Math.min(24, 6 + (m.mistakes ? m.mistakes.length : 1) * 6);
  s += Math.round(m.inspectionRate * 6);  // checking packages earns back a little
  return Math.max(0, Math.min(100, Math.round(s)));
}

/**
 * The specific, behaviour-citing paragraph the encounter summary shows.
 * Every sentence is conditional on something the learner actually did.
 */
export function stagingNarrative(state, catalog, evalResult, m){
  const map = catalogById(catalog);
  const parts = [];

  /* what the learner began the draw without — stated first, because it is the
     thing they most need to know and they were never told at the time */
  if(!evalResult.ready){
    const blocking = evalResult.issues.filter(i=>i.severity==="block");
    parts.push(`You began the draw with ${blocking.length===1?"one problem":`${blocking.length} problems`} on the work area. ${blocking.slice(0,3).map(i=>i.message).join(" ")}`);
  }

  /* what went right */
  if(m.incorrectItems===0){
    parts.push("You selected every required item and nothing extra.");
  }else{
    const names = m.incorrectItemIds.map(id=>(map.get(id)||{}).short).filter(Boolean);
    parts.push(`You staged ${list(names)} before catching ${names.length>1?"them":"it"}.`);
  }

  /* inspection behaviour */
  if(m.inspectionsTotal===0){
    parts.push("You didn't turn any package over before staging it — expiry dates, gauge bands and patient labels are only visible on the back.");
  }else if(m.inspectionRate>=0.6){
    parts.push(`You turned ${m.inspectionsBeforeStaging} of ${m.stagedCount} items over before committing them to the tray.`);
  }else{
    parts.push(`Only ${m.inspectionsBeforeStaging} of the ${m.stagedCount} items you staged were checked first — read the label before it goes on the tray, not after.`);
  }

  /* wrong-patient specimen */
  if(m.wrongPatientStaged){
    parts.push("A tube already labelled for another patient reached your tray. That is the single most serious pre-analytical error there is — pre-labelled tubes from another draw never get reused.");
  }

  /* tube order */
  if(state.requiredTubes.length<2){
    parts.push("Only one tube was ordered, so there was no draw sequence to build.");
  }else if(m.tubeOrderAccuracy===1 && m.tubeOrderFirstTry){
    parts.push(`The tubes went into the rack in order of draw first time: ${state.requiredTubes.map(tubeName).join(" → ")}.`);
  }else if(m.tubeOrderAccuracy===1){
    parts.push(`You re-seated ${m.tubeMisseats===1?"a tube":"tubes"} and finished with the correct order of draw: ${state.requiredTubes.map(tubeName).join(" → ")}.`);
  }else{
    parts.push(`The rack ended ${pct(m.tubeOrderAccuracy)}% in order of draw; it should read ${state.requiredTubes.map(tubeName).join(" → ")}.`);
  }

  /* sharps */
  if(m.sharpsCorrected && m.sharpsFirstZone===ZONE.ACROSS){
    parts.push("The sharps container was initially placed past the patient's arm, which would have meant reaching across the prepared site with an exposed needle. You corrected its placement before beginning.");
  }else if(m.sharpsCorrected){
    parts.push("The sharps container started out on the counter rather than beside the chair; you moved it into immediate reach before beginning.");
  }else if(m.sharpsAccessible){
    parts.push("The sharps container went straight into the reach zone beside the chair, so the used needle has somewhere to go the moment it comes out.");
  }else{
    parts.push("The sharps container never reached a usable position beside the chair.");
  }

  /* contamination + recovery */
  if(m.contaminatedCount>0){
    parts.push(`${m.contaminatedCount===1?"An item":`${m.contaminatedCount} items`} went on the floor and had to be replaced — once a sterile barrier is on the floor it's done.`);
  }
  if(m.replacements>0 && m.contaminatedCount===0){
    parts.push(`You pulled ${m.replacements===1?"one item":`${m.replacements} items`} back off the tray after a second look, which is exactly the right instinct.`);
  }

  /* handedness / layout */
  if(m.reachedAcrossField>0){
    parts.push(`${m.reachedAcrossField===1?"One item was":`${m.reachedAcrossField} items were`} staged on your dominant side, so you'd be reaching over the arm mid-draw. For a ${m.handedness}-handed draw the tray belongs on your ${m.handedness==="right"?"left":"right"}.`);
  }else if(m.trayUsableWithoutCrossing){
    parts.push(`The finished tray can be worked entirely from your ${m.handedness==="right"?"left":"right"} without reaching across the site.`);
  }

  return parts.join(" ");
}

export { ISSUE };
