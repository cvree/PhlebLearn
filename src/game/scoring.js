/* Encounter scoring — pure logic. Rendering the score screen lives in ui/panels.js;
   this module only decides pass/fail per category and the resulting payout. */
import { TUBES, TESTS, HANDLING, CARD_LINKS } from "../config.js";
import { arraysEqual } from "../utils.js";
import { ENC, SHIFT } from "./gameState.js";
import { addXP, addCoins, bumpMastery, awardBadge, coinPayout, difficultyName } from "./saveSystem.js";
import { upgradeBonusForEncounter, recordStickers } from "./progression.js";
import { saveSS } from "./gameState.js";

export const FEEDBACK = {
  patientId:{label:"Patient ID",why:"Wrong-patient errors are among the most serious in the lab.",tip:"Always match two+ identifiers (name + DOB), never the room."},
  requisition:{label:"Requisition",why:"A missing or mismatched order can make results wrong or unusable.",tip:"Scan every field; if something's off, hold and clarify before drawing."},
  tubeSelect:{label:"Tube selection",why:"Each test needs a specific additive/tube.",tip:"CBC→lavender, PT/INR→light blue, glucose→gray."},
  orderOfDraw:{label:"Order of draw",why:"The fixed order prevents additive carryover between tubes.",tip:"Cultures → light blue → red → SST → PST → green → lavender → gray."},
  siteSelect:{label:"Site selection",why:"The right site protects the patient and keeps the sample usable.",tip:"Median cubital (antecubital) first; avoid IV/mastectomy/fistula/hematoma/scarred/edematous areas."},
  supplyStaging:{label:"Work-area prep",why:"A tray you have to leave mid-draw is how needles get set down and tubes get grabbed in the wrong order.",tip:"Check every package before it goes on the tray, rack the tubes in order of draw, and put the sharps container in reach before you touch the patient."},
  labeling:{label:"Labeling",why:"Unlabeled/mislabeled specimens can harm patients.",tip:"Name, ID/DOB, date & time, your initials, at the bedside."},
  handling:{label:"Handling",why:"Some analytes need cold or light protection.",tip:"Most are routine; ammonia→chilled, bilirubin→protect from light."},
  professional:{label:"Professionalism",why:"Calm, clear communication builds trust.",tip:"Explain simply; reassure nervous patients."},
  specimenQuality:{label:"Specimen integrity",why:"A rejected specimen means the patient is stuck again for a result that was already in the tube.",tip:"Fill to the line, draw in order, mix gently and promptly, and keep the band under a minute."},
  complications:{label:"Complication response",why:"Complications are not failures — missing them is. Watch the patient as well as the tube.",tip:"Stop, remove, press. Never probe, never carry on through a hematoma, never leave a fainting patient."},
  safety:{label:"Safety",why:"Patient safety outranks speed every time.",tip:"Stop for faintness; never skip ID under pressure."}
};

export function fmtDuration(ms){
  if(!ms||ms<0) return ", ";
  const s=Math.round(ms/1000), m=Math.floor(s/60), r=s%60;
  return m? `${m}m ${r}s` : `${r}s`;
}

export function scoreDetailAnswer(c,ok){
  const A=ENC.answers||{}, p=ENC.p||{};
  let a=A[c];
  if(c==="safety") a=A.safety||a;
  if(c==="professional" && !a){
    a={ctx:"No special patient communication challenge happened in this encounter.", your:"Stayed calm and professional", correct:"Keep communication kind, clear, and within scope"};
  }
  if(c==="orderOfDraw" && !a){
    const req=p.reqSet||[];
    a={ctx:"Only one required tube, so there was no sequence to build.", your:req.map(k=>(TUBES[k]&&TUBES[k].name)||k).join(", ")||"(none)", correct:"One tube needed; order of draw is automatically OK"};
  }
  if(c==="handling" && !a && p.handling){
    a={ctx:(HANDLING[p.handling]&&HANDLING[p.handling].why)||"Specimen handling check", your:HANDLING[p.handling].label, correct:HANDLING[p.handling].label};
  }
  if(c==="safety" && !a){
    a={ctx:"Core safety checks were completed.", your:ok?"Safe choices this encounter":"A safety step needs review", correct:"Patient safety comes before speed"};
  }
  return a||null;
}

// Scores the current ENC, writes ENC.scores / ENC.answers / ENC.coinsEarned / ENC.coinBreakdown,
// updates SS (XP, coins, mastery, badges) and SHIFT tallies, and returns any sticker wins so the
// UI layer can decide how to celebrate them (confetti/toast) before moving to the score screen.
/* =========================================================================
   WHERE THE ANSWERS COME FROM

   Identity, tube selection and order of draw used to be three multiple-choice
   screens asked BEFORE the learner reached the cart — and then asked again,
   physically, at it: the introduction step makes them obtain two identifiers
   from the patient's own mouth, and the supply cart makes them choose real
   tubes and seat them in a numbered rack in order of draw.

   Asking twice taught nothing the second time and cost the learner three
   screens per patient, so the quiz screens are gone and these three
   categories are scored from what was actually DONE. `deriveChoices()` is
   where that happens, and it also fills in ENC.selected / ENC.ordered so the
   score screen's "your answer / best answer" cards keep working — with the
   learner's real tubes and their real draw sequence in them.
   ========================================================================= */
export function deriveChoices(){
  const c = ENC.collect || {};
  const intro = c.introductionMeasurements;
  const sm = c.stagingMeasurements;
  const col = c.collectionMeasurements;

  // Identity: two identifiers, obtained before anything was touched. A
  // leading question ("you're Mr Adams?") still produced an identifier, which
  // is exactly why it is recorded and does not count as a clean check.
  if(intro && ENC.idChoice == null){
    ENC.idChoice = intro.identifiersUsed >= intro.identifiersRequired
      && intro.identifiedBeforeTouching
      && intro.leadingQuestions === 0;
  }
  // Tube selection: what actually went on the tray and into the rack.
  if(sm && !ENC.selected.length) ENC.selected = (sm.stagedTubeKeys || []).slice();
  // Order of draw: the sequence the tubes genuinely came off the holder in,
  // falling back to the rack they were seated in when the draw stopped early.
  if(!ENC.ordered.length){
    if(col && col.drawnSequence && col.drawnSequence.length) ENC.ordered = col.drawnSequence.slice();
    else if(sm && sm.rackedTubeKeys) ENC.ordered = sm.rackedTubeKeys.slice();
  }
  return ENC;
}

export function scoreEncounter(){
  const p=ENC.p, s={};
  if(ENC.startedAt && !ENC.elapsedMs) ENC.elapsedMs = Date.now()-ENC.startedAt;
  deriveChoices();
  s.patientId = !!ENC.idChoice;
  s.requisition = !!ENC.reqChoice;
  const sel=[...ENC.selected].sort(), req=[...p.reqSet].sort();
  s.tubeSelect = arraysEqual(sel,req);
  const correctOrder=[...p.reqSet];
  s.orderOfDraw = (p.reqSet.length<2) ? true : arraysEqual(ENC.ordered,correctOrder);
  if(ENC.p.site) s.siteSelect = !!ENC.siteChoice;
  const lf=ENC.labelFields; s.labeling = lf.name&&lf.iddob&&lf.datetime&&lf.initials;
  s.handling = (ENC.handlingChoice===p.handling);
  s.professional = (p.event.type==="respond") ? !!ENC.respondChoice : true;
  // Work-area preparation is scored from what the learner physically did on
  // the supply cart, not from whether a checklist got ticked.
  const sm = ENC.collect && ENC.collect.stagingMeasurements;
  if(sm) s.supplyStaging = sm.unsafeItems===0 && sm.score>=75;
  // What the laboratory did with the tubes, and what the patient's body did
  // during the draw. Both are only scored when the draw actually happened —
  // an encounter abandoned before the first tube has neither.
  const sq = ENC.collect && ENC.collect.specimenQuality;
  if(sq && sq.total) s.specimenQuality = sq.rejectedCount===0;
  const cx = ENC.collect && ENC.collect.complicationMeasurements;
  if(cx && cx.total) s.complications = cx.missedCount===0 && cx.worsenedCount===0;
  let safetyOk = s.patientId;
  if(sm && sm.unsafeItems>0) safetyOk = false;
  // Probing blindly, carrying on through a complication, or leaving a patient
  // who is going out is a safety failure whatever else went right.
  if(cx && (cx.missedCount>0 || cx.worsenedCount>0 || cx.fainted)) safetyOk = false;
  if(p.event.type==="respond" && p.event.safety) safetyOk = safetyOk && !!ENC.respondChoice;
  if(p.drawEvent) safetyOk = safetyOk && !!ENC.drawChoice;
  s.safety = safetyOk;

  ENC.scores=s;
  ENC.answers = ENC.answers || {};
  const A = ENC.answers;
  // The identity answer is now the introduction step's own transcript rather
  // than a multiple-choice pick, so it is assembled here when that step ran.
  const introM = ENC.collect && ENC.collect.introductionMeasurements;
  if(introM && !A.patientId){
    A.patientId = {
      your: `${introM.identifiersUsed} identifier(s) obtained${introM.leadingQuestions ? `, ${introM.leadingQuestions} of them by leading question` : ""}${introM.identifiedBeforeTouching ? "" : ", after the patient had already been touched"}`,
      correct: "Two identifiers — full name and date of birth — asked openly, before anything is touched",
    };
  }
  if(A.patientId && !A.patientId.ctx) A.patientId.ctx = `Patient: ${p.name} • DOB ${p.dob} • ID ${p.id}`;
  if(A.requisition && !A.requisition.ctx) A.requisition.ctx = p.reqIssue ? p.reqIssue.catch : "Requisition matched the patient and had the needed fields.";
  if(A.siteSelect && !A.siteSelect.ctx && p.site) A.siteSelect.ctx = "Site scenario: " + p.site.desc.replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, "");
  if(A.professional && !A.professional.ctx && p.event && p.event.type==="respond") A.professional.ctx = (p.eventWhen==="post"?"Post-draw":"Pre-draw") + " patient question: " + (p.event.lines||[]).join(" " );
  if(A.draw && !A.draw.ctx && p.drawEvent) A.draw.ctx = "During the draw: " + (p.drawEvent.lines||[]).join(" " );
  const tn = arr => (arr&&arr.length) ? arr.map(k=>TUBES[k].name).join(", ") : "(none)";
  const testList = p.orders.map(o=>`${o} (${TUBES[TESTS[o].tube].name})`).join(", ");
  A.tubeSelect = {your: tn(ENC.selected), correct: tn([...p.reqSet]), ctx:"Tests ordered: "+testList};
  if(p.reqSet.length>=2) A.orderOfDraw = {your: tn(ENC.ordered), correct: tn(correctOrder), ctx:"Tests ordered: "+testList};
  if(sm){
    A.supplyStaging = {
      ctx: `Staged in ${fmtDuration(sm.timeMs)} · ${sm.correctItems} correct, ${sm.incorrectItems} wrong (${sm.unsafeItems} unsafe) · order of draw ${Math.round(sm.tubeOrderAccuracy*100)}% · ${sm.inspectionsBeforeStaging}/${sm.stagedCount} packages checked before staging`,
      your: sm.narrative,
      correct: "Every required item checked and staged, tubes racked in order of draw, sharps container within immediate reach on your dominant side.",
    };
  }
  if(sq && sq.total){
    A.specimenQuality = {
      ctx: `${sq.acceptedCount} accepted · ${sq.flaggedCount} accepted with a comment · ${sq.rejectedCount} rejected`,
      your: sq.narrative,
      correct: "Every tube filled to its line, drawn in order, mixed to its own count within a minute, and delivered without haemolysis.",
    };
  }
  if(cx && cx.total){
    A.complications = {
      ctx: cx.events.map(e=>`${e.emoji} ${e.label}`).join(" · "),
      your: cx.narrative,
      correct: "Recognise it from the first sign, stop what is causing it, and do the one thing that treats it.",
    };
  }
  const lfds=[["name","Patient name"],["iddob","ID / DOB"],["datetime","Date and time"],["initials","Your initials"]];
  A.labeling = {your:(lfds.filter(([k])=>lf[k]).map(f=>f[1]).join(", ")||"(none checked)"), correct:"Patient name, ID / DOB, Date and time, Your initials"};
  if(A.handling){
    const driver = p.orders.find(o=>TESTS[o].handling===p.handling);
    A.handling.ctx = (driver ? driver+": " : "") + (HANDLING[p.handling]?HANDLING[p.handling].why:"");
  }
  if(!s.safety){
    if(!s.patientId && A.patientId) A.safety={ctx:"Identity check", your:A.patientId.your, correct:A.patientId.correct};
    else if(p.event.type==="respond" && p.event.safety && !ENC.respondChoice && A.professional) A.safety={ctx:"Patient safety", your:A.professional.your, correct:A.professional.correct};
    else if(p.drawEvent && !ENC.drawChoice && A.draw) A.safety={ctx:"During the draw", your:A.draw.your, correct:A.draw.correct};
  }else{
    if(p.drawEvent && A.draw) A.safety={ctx:A.draw.ctx||"During the draw", your:A.draw.your, correct:A.draw.correct};
    else if(p.event.type==="respond" && p.event.safety && A.professional) A.safety={ctx:A.professional.ctx||"Safety-critical patient info", your:A.professional.your, correct:A.professional.correct};
    else if(A.patientId) A.safety={ctx:"Core safety check passed: verified the patient before collection.", your:A.patientId.your, correct:A.patientId.correct};
  }

  const cats=Object.keys(s);
  let correct=0;
  cats.forEach(c=>{
    const ok=s[c]; if(ok)correct++;
    if(ok) addXP(10);
    bumpMastery(CARD_LINKS[c], ok);
  });
  const pct=Math.round(correct/cats.length*100);
  const upgradeBonus=upgradeBonusForEncounter(p,s);
  ENC.upgradeBonus=upgradeBonus;
  const pay=coinPayout(pct, cats.length, ENC.elapsedMs, upgradeBonus.coins);
  ENC.coinsEarned=pay.total;
  ENC.coinBreakdown={score:pay.score,speed:pay.speed,perfect:pay.perfect,upgrade:pay.upgrade,par:pay.par,sec:pay.sec,pct,diff:difficultyName()};
  addCoins(pay.total);
  SHIFT.coins=(SHIFT.coins||0)+pay.total;
  if(pct===100){addXP(20);awardBadge("perfect");}
  // Phase 4 badges: earned for what the draw actually did, not for what was
  // bought. Each reads a measurement the draw produced, so none is reachable
  // by an encounter that never got that far.
  if(cx && cx.total>0 && cx.missedCount===0 && cx.worsenedCount===0){ addXP(15); awardBadge("quick-eyes"); }
  if(sq && sq.total>=2 && sq.rejectedCount===0 && sq.flaggedCount===0){ addXP(15); awardBadge("clean-lab"); }
  if(ENC.collect && ENC.collect.procedureId==="butterfly-hand"){ awardBadge("winged"); }
  if(cx && cx.hematomaGrade==="none" && ENC.collect && ENC.collect.postDrawMeasurements){ awardBadge("gentle-hands"); }
  if(!s.orderOfDraw)SHIFT.orderAllOk=false;
  if(!s.safety)SHIFT.safetyAllOk=false;
  SHIFT.ratings.push(pct);
  SHIFT.patientTimes=SHIFT.patientTimes||[];
  SHIFT.patientTimes.push(ENC.elapsedMs||0);
  SHIFT.missed=SHIFT.missed||[];
  cats.forEach(c=>{ if(!s[c]){ const lbl=FEEDBACK[c].label; if(!SHIFT.missed.includes(lbl))SHIFT.missed.push(lbl); } });

  const stickerWins=recordStickers(p,s,pct,ENC);
  if(stickerWins.length){ SHIFT.coins=(SHIFT.coins||0)+stickerWins.reduce((sum,w)=>sum+w.coins,0); }
  ENC.stickerWins=stickerWins;
  saveSS();
  return {pct, stickerWins};
}
