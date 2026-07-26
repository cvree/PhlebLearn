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
  labeling:{label:"Labeling",why:"Unlabeled/mislabeled specimens can harm patients.",tip:"Name, ID/DOB, date & time, your initials, at the bedside."},
  handling:{label:"Handling",why:"Some analytes need cold or light protection.",tip:"Most are routine; ammonia→chilled, bilirubin→protect from light."},
  professional:{label:"Professionalism",why:"Calm, clear communication builds trust.",tip:"Explain simply; reassure nervous patients."},
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
export function scoreEncounter(){
  const p=ENC.p, s={};
  if(ENC.startedAt && !ENC.elapsedMs) ENC.elapsedMs = Date.now()-ENC.startedAt;
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
  let safetyOk = s.patientId;
  if(p.event.type==="respond" && p.event.safety) safetyOk = safetyOk && !!ENC.respondChoice;
  if(p.drawEvent) safetyOk = safetyOk && !!ENC.drawChoice;
  s.safety = safetyOk;

  ENC.scores=s;
  ENC.answers = ENC.answers || {};
  const A = ENC.answers;
  if(A.patientId && !A.patientId.ctx) A.patientId.ctx = `Patient: ${p.name} • DOB ${p.dob} • ID ${p.id}`;
  if(A.requisition && !A.requisition.ctx) A.requisition.ctx = p.reqIssue ? p.reqIssue.catch : "Requisition matched the patient and had the needed fields.";
  if(A.siteSelect && !A.siteSelect.ctx && p.site) A.siteSelect.ctx = "Site scenario: " + p.site.desc.replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, "");
  if(A.professional && !A.professional.ctx && p.event && p.event.type==="respond") A.professional.ctx = (p.eventWhen==="post"?"Post-draw":"Pre-draw") + " patient question: " + (p.event.lines||[]).join(" " );
  if(A.draw && !A.draw.ctx && p.drawEvent) A.draw.ctx = "During the draw: " + (p.drawEvent.lines||[]).join(" " );
  const tn = arr => (arr&&arr.length) ? arr.map(k=>TUBES[k].name).join(", ") : "(none)";
  const testList = p.orders.map(o=>`${o} (${TUBES[TESTS[o].tube].name})`).join(", ");
  A.tubeSelect = {your: tn(ENC.selected), correct: tn([...p.reqSet]), ctx:"Tests ordered: "+testList};
  if(p.reqSet.length>=2) A.orderOfDraw = {your: tn(ENC.ordered), correct: tn(correctOrder), ctx:"Tests ordered: "+testList};
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
