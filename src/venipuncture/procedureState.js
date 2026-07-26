/* =========================================================================
   Typed venipuncture procedure state — the data model requirement #7 asks
   for. Every step has a stable id, a clinical phase, and a trigger
   describing when it's clinically valid, e.g.:

     {
       id: "invert-collected-tube",
       phase: "postDraw",
       trigger: "afterTubeRemoved",
       interaction: "tubeInversion",
       requiredState: { tubeFilled: true, tubeRemoved: true }
     }

   Rendering (venipuncture/steps.js, the 2D fallback) reads this list to know
   what to show next; it must never invent its own ordering or gating logic.
   Sequencing is enforced by venipuncture/clinicalRules.js, not by whatever
   step happens to render next — that's the fix for the "urgent sequencing
   bugs" called out in the Phase 0 requirements (see clinicalRules.js).
   ========================================================================= */

export const PHASES = {
  PREP: "prep",
  ACCESS: "access",
  COLLECTION: "collection",
  POST_DRAW: "postDraw",
};

// The canonical clinical order. NOTE the fix here vs. the original monolith:
// "dispose" now comes immediately after "safety" and BEFORE "pressure"/"bandage" —
// the original had dispose last (after pressure+bandage), which contradicts
// "point of use" disposal and the explicit Phase 0 requirement that pressure
// and bandaging happen *after* sharps disposal.
export const VP_STEP_DEFS = [
  { id:"hygiene",    phase:PHASES.PREP,      trigger:"start",              interaction:"tap-sequence",  requiredState:{} },
  { id:"gather",     phase:PHASES.PREP,      trigger:"afterHygiene",       interaction:"tap-collect",   requiredState:{hygieneOk:true} },
  { id:"tourniquet", phase:PHASES.ACCESS,    trigger:"afterGather",        interaction:"drag",          requiredState:{gatherOk:true} },
  { id:"palpate",    phase:PHASES.ACCESS,    trigger:"afterTourniquet",    interaction:"tap-choice",    requiredState:{tourniquetOn:true} },
  { id:"clean",      phase:PHASES.ACCESS,    trigger:"afterPalpate",       interaction:"drag-scrub",    requiredState:{veinOk:true} },
  { id:"assemble",   phase:PHASES.ACCESS,    trigger:"duringCleanDry",     interaction:"drag",          requiredState:{cleanOk:true} },
  { id:"uncap",      phase:PHASES.ACCESS,    trigger:"afterAssemble",      interaction:"drag",          requiredState:{assembleOk:true} },
  { id:"insert",     phase:PHASES.ACCESS,    trigger:"afterUncap",         interaction:"drag-angle",    requiredState:{uncapOk:true} },
  { id:"fill",       phase:PHASES.COLLECTION,trigger:"afterBloodFlash",    interaction:"hold-timing",   requiredState:{insertOk:true} },
  { id:"switch",     phase:PHASES.COLLECTION,trigger:"afterTubeFilled",    interaction:"drag-order",    requiredState:{fillGood:null} },
  { id:"release",    phase:PHASES.POST_DRAW, trigger:"afterBloodFlash",    interaction:"tap-timing",    requiredState:{insertOk:true} },
  { id:"withdraw",   phase:PHASES.POST_DRAW, trigger:"afterLastTubeOff",   interaction:"tap-sequence",  requiredState:{tqGood:null} },
  { id:"safety",     phase:PHASES.POST_DRAW, trigger:"afterWithdraw",      interaction:"tap",           requiredState:{withdrawOk:true} },
  { id:"dispose",    phase:PHASES.POST_DRAW, trigger:"afterSafety",        interaction:"drag",          requiredState:{safetyOk:true} },
  { id:"pressure",   phase:PHASES.POST_DRAW, trigger:"afterDispose",       interaction:"hold",          requiredState:{disposeOk:true} },
  { id:"bandage",    phase:PHASES.POST_DRAW, trigger:"afterPressure",      interaction:"tap",           requiredState:{pressureOk:true} },
  { id:"invert",     phase:PHASES.POST_DRAW, trigger:"afterTubeRemoved",   interaction:"tubeInversion", requiredState:{tubeFilled:true,tubeRemoved:true} },
];

// Builds the ordered step-id list for one encounter. `switch` only applies
// when more than one tube is ordered (unchanged from the original vpBuild()).
export function buildStepSequence(tubeCount){
  const ids = VP_STEP_DEFS.map(d=>d.id).filter(id=>id!=="switch" || tubeCount>1);
  return ids;
}

export function getStepDef(id){ return VP_STEP_DEFS.find(d=>d.id===id)||null; }
