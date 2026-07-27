/* =========================================================================
   PALPATION SCORING — what the learner's fingers found, in numbers.

   Pure maths.
   ========================================================================= */
import { VESSEL_KIND, isDrawableVein } from "../arm/armAnatomy.js";
import { feltCount } from "./palpationState.js";

function round(v, dp){ const m = Math.pow(10, dp || 0); return Math.round(v*m)/m; }

export function measurePalpation(state, result, vessels){
  const chosen = result ? result.chosen : null;
  const all = vessels || [];
  const hazards = all.filter(v=>v.kind !== VESSEL_KIND.VEIN).map(v=>v.id);

  const choseVein = !!chosen && chosen.kind === VESSEL_KIND.VEIN;
  const choseIdeal = !!chosen && chosen.id === "median-cubital";
  const feltChosen = !!chosen && !!state.felt[chosen.id];
  const hazardsFound = hazards.filter(id=>state.felt[id]);

  const mistakes = [];
  if(!chosen) mistakes.push({ code:"noChoice", message:"No vein was ever chosen." });
  else if(!choseVein) mistakes.push({ code:"notAVein", message:`The site chosen was not a vein — it was ${chosen.label}.` });
  else if(!isDrawableVein(chosen)) mistakes.push({ code:"tooDeep", message:"The vein chosen sits too deep to reach safely from the surface." });
  if(chosen && !feltChosen) mistakes.push({ code:"neverFelt", message:"The site was picked by eye — that vein was never actually palpated." });
  if(state.arteryPressed && !state.arteryRecognised) mistakes.push({ code:"missedArtery", message:"A pulsing structure was pressed and not recognised as the artery." });
  if(state.nerveHurt) mistakes.push({ code:"hurtPatient", message:"The median nerve was pressed hard enough for the patient to feel it." });
  if(chosen && chosen.id === "basilic") mistakes.push({ code:"basilic", message:"The basilic was chosen, which runs over the brachial artery and the median nerve." });

  let score = 100;
  if(!chosen) score -= 55;
  else if(!choseVein) score -= 45;
  else if(!isDrawableVein(chosen)) score -= 30;
  else if(chosen.id === "basilic") score -= 16;
  else if(!choseIdeal) score -= 6;
  if(chosen && !feltChosen) score -= 20;
  if(state.arteryPressed && !state.arteryRecognised) score -= 12;
  if(state.nerveHurt) score -= 10;
  // credit for actually exploring rather than jabbing one spot
  if(feltCount(state) >= 3) score += 4;
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    chosenId: chosen ? chosen.id : null,
    chosenLabel: chosen ? chosen.label : null,
    choseVein, choseIdeal, feltChosen,
    structuresFelt: feltCount(state),
    hazardsIdentified: hazardsFound.length,
    arteryRecognised: !!state.arteryRecognised,
    hurtPatient: !!state.nerveHurt,
    peakPress: round(state.peakPress, 3),
    contactSeconds: round(state.contactMs/1000, 1),
    mistakes,
    narrative: narrate({ chosen, choseIdeal, feltChosen, state, felt: feltCount(state) }),
  };
}

function narrate(m){
  if(!m.chosen) return "No vein was chosen — the site was never settled by feel.";
  const bits = [];
  bits.push(m.choseIdeal
    ? "Chose the median cubital, the first-choice vein"
    : `Chose ${m.chosen.label}`);
  bits.push(m.feltChosen ? "having actually palpated it" : "without palpating it first");
  bits.push(`${m.felt} structure${m.felt === 1 ? "" : "s"} felt`);
  if(m.state.arteryPressed) bits.push(m.state.arteryRecognised ? "artery found and left alone" : "pressed the artery without recognising it");
  if(m.state.nerveHurt) bits.push("pressed hard enough to hurt");
  return bits.join(", ") + ".";
}

/** Fold into the encounter's existing chips. */
export function applyPalpationOutcome(procedureState, measurements){
  if(!procedureState || !measurements) return procedureState;
  procedureState.veinOk = measurements.choseVein && measurements.feltChosen;
  procedureState.palpationMeasurements = measurements;
  return procedureState;
}
