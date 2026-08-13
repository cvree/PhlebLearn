/* =========================================================================
   Screen-flow dispatcher: one render function per game-state screen, plus
   go()/render() that decide which one runs. This is the direct analog of
   the original monolith's render()/renderStep()/renderXxx() functions —
   intentionally the largest file in the app, since "which screen renders
   what" is one cohesive concern. See docs/ARCHITECTURE.md.
   ========================================================================= */
import { $, panel } from "../dom.js";
import { FX, fxPanelIn, countUp, blurText } from "../fx.js";
import { sfx } from "../audio/audioManager.js";
import { musicForState } from "../audio/audioManager.js";
import { toast, confetti, floatXP } from "./notifications.js";
import { shuffle, pick, arraysEqual } from "../utils.js";
import { TUBES, TESTS, HANDLING, CARD_LINKS, BADGE_NAMES, ALL_CATCHES } from "../config.js";
import {
  SS, ENC, setEnc, SHIFT, setShift, state, setState, setMode, saveSS,
  MODE, MODES, MODE_NAMES, guided, finalPractical, benchMode, reveal,
} from "../game/gameState.js";
import { summaryLine, recordAttempt, recordFor, weakestCategories } from "../game/modeProgress.js";
import { sectionForStep, endsSection, sectionMeasurements, resetFromSection } from "../venipuncture/sections.js";
import { MEASUREMENT_LABELS, CATEGORIES } from "../venipuncture/rubric/policy.js";
import { buildRubricReport } from "../venipuncture/rubric/rubricReport.js";
import { buildReplay } from "../venipuncture/rubric/replay.js";
import { renderPracticalReport, renderRubricSummary } from "./reportView.js";
import { awardBadge, difficultyName, addXP, addCoins } from "../game/saveSystem.js";
import { makePatient } from "../game/encounter.js";
import { scoreEncounter, scoreDetailAnswer, FEEDBACK, fmtDuration } from "../game/scoring.js";
import { getRoomLevel, canChooseProcedure, hasUpgrade } from "../game/progression.js";
import {
  STEP_XP, sectionScore, sectionReward, nextStreak, drawReward,
} from "../game/rewards.js";
import { PROCEDURE, PROCEDURES, indicatedProcedure } from "../venipuncture/procedure.js";
import { runDialogue, optionStep, teach, says, DOT, pEmoji, showHint, clearHint } from "../game/dialogue.js";
import { getScene } from "../rendering/scene.js";
import { spawnPatient, removePatient, reactMascot } from "../world/patient.js";
import { tubeMeshes, resetTubeSelection } from "../world/tubeRack.js";
import { createProcedureState, renderCurrentStep } from "../venipuncture/accessibilityFallback.js";
import { ensureArmSession } from "../venipuncture/physicalSteps.js";
import { closeBench } from "../bench/benchSession.js";
import { evaluateStaging } from "../venipuncture/staging/stagingRules.js";
import { measureStaging } from "../venipuncture/staging/stagingScoring.js";
import { VP_TIPS, VP_ICON } from "../venipuncture/questions.js";
import { startComplicationWatch, finishComplications } from "../venipuncture/complications/complicationRuntime.js";
import { complicationSummaryHTML } from "../venipuncture/complications/complicationCoach.js";
import { assessSpecimens, applySpecimenOutcome } from "../venipuncture/specimen/specimenQuality.js";
import { fbCard } from "./coachLayer.js";
import { buildDebrief, sectionScores } from "../game/debrief.js";
import { normaliseMastery, applyDraw as applyMastery, weakestTrack, TRACKS } from "../game/mastery.js";
import { offerBests } from "../game/personalBests.js";
import { CHALLENGES, scoreChallenges } from "../game/challenges.js";
import { armChallenges, disarmChallenges, armedChallengeIds } from "../game/activeChallenges.js";

/* ---------- top bar + panel entrance -------------------------------------- */
/**
 * The top bar. Inside an encounter it shows NO SCORE OF ANY KIND.
 *
 * A running XP counter is a score banner that happens to be small, and it is
 * on screen for every second of the four minutes the draw is meant to be
 * absorbing. The values are still being accumulated — they are simply not
 * shown until the debrief, which is the whole point of holding them back.
 */
export function syncTop(){
  const inEncounter = state !== "idle" && state !== "summary" && state !== "score";
  const xp = $("tXp"), coins = $("tCoins");
  if(inEncounter){
    if(xp) xp.textContent = "—";
    if(coins) coins.textContent = "—";
  }else{
    countUp(xp, SS.xp, { pop:true });
    countUp(coins, SS.coins, { pop:true });
  }
  $("tPatient").textContent="Patient "+Math.min(SHIFT.index+ (state==="idle"||state==="summary"?0:1), SHIFT.len)+"/"+SHIFT.len;
}
function animatePanelIn(){ if(!panel)return; panel.classList.remove("enter"); void panel.offsetWidth; panel.classList.add("enter"); fxPanelIn(); }

export function go(s){
  setState(s);
  render();
  syncTop();
}
export function render(){
  renderStep();
  animatePanelIn();
  musicForState();
}
/* THE SHAPE OF ONE PATIENT

   the patient arrives with their requisition → [site, if this patient's arms
   need a decision] → the draw → label and route → [respond, if they asked
   something] → score.

   Four screens that used to sit in front of the draw are gone, all for the
   same reason: the draw itself now does the thing they were asking about.
   Identity is the introduction step. Tube selection and order of draw are the
   supply cart. And the greeting was its own screen with one button on it,
   which is a click, not a decision — the patient now says hello on the
   requisition screen, and greeting them properly is an act inside the
   introduction. See game/scoring.js's deriveChoices(). */
function renderStep(){
  if(state==="idle")        return renderIdle();
  if(state==="review")      return renderReview();
  if(state==="site")        return renderSite();
  if(state==="collect")     return renderCollect();
  if(state==="drawresp")    return renderDrawResp();
  if(state==="label")       return renderLabel();
  if(state==="respond")     return renderRespond();
  if(state==="score")       return renderScore();
  if(state==="summary")     return renderSummary();
}

/* ---------- idle / clock in ------------------------------------------------ */
// Shift length per mode: Learn is a short guided walk, Practice is long
// enough to repeat what went badly, the Final Practical is one assessed
// attempt — an examiner does not give you five goes at it.
const SHIFT_LEN = { [MODES.LEARN]:3, [MODES.PRACTICE]:4, [MODES.FINAL]:1, [MODES.BENCH]:1 };

/** The beats a Bench session can jump straight to. */
const BENCH_BEATS = [
  { id: "tourniquet", label: "Band", step: "tourniquet" },
  { id: "palpation",  label: "Palpate", step: "palpate" },
  { id: "cleaning",   label: "Clean", step: "clean" },
  { id: "equipment",  label: "Assemble", step: "assemble" },
  { id: "insert",     label: "Stick", step: "insert" },
  { id: "collection", label: "Collect", step: "collect" },
];

function renderIdle(){
  const line = m => summaryLine(SS.modeProgress, m);
  panel.innerHTML=`
    <h2>🩺 Clock in</h2>
    <p class="sub">Four ways to work. <b>Learn</b> talks you through every step. <b>Practice</b> stays quiet until the end of each section, then lets you replay it. The <b>Final Practical</b> says nothing at all until the report. <b>The Bench</b> is not a shift — it is one arm, unlimited supplies, nothing scored, and a reset button.</p>
    <div class="tubechips">
      <span class="pill">⭐ XP ${SS.xp}</span>
      <span class="pill">🪙 ${SS.coins}</span>
      <span class="pill">🎖️ ${SS.badges.length} badges</span>
      <span class="pill">📋 Shifts ${SS.shifts}</span>
      <span class="pill">🏠 ${getRoomLevel().name}</span>
      ${equipmentPills()}
    </div>
    <button class="btn alt cta-pulse starborder" id="modeLearn">🎓 Learn (guided, ${SHIFT_LEN[MODES.LEARN]} patients)</button>
    <div class="mode-note">${line(MODES.LEARN)}</div>
    <button class="btn alt" id="modePractice">🔁 Practice (${SHIFT_LEN[MODES.PRACTICE]} patients, feedback per section)</button>
    <div class="mode-note">${line(MODES.PRACTICE)}</div>
    <button class="btn cta-pulse starborder" id="modeFinal">📋 Final Practical (1 patient, full rubric report)</button>
    <div class="mode-note">${line(MODES.FINAL)}</div>
    <button class="btn alt" id="modeBench">🔧 The Bench (rehearse one gesture, nothing scored)</button>
    <div class="mode-note">${masteryLine()}</div>
    ${SS.weak.length?`<div class="hint">Weak topics queued for Learn Mode: ${SS.weak.length}</div>`:""}
    ${challengePickerHTML()}
  `;
  blurText(panel.querySelector("h2"));
  $("modeLearn").onclick=()=>{ sfx("win"); startShift(MODES.LEARN); };
  $("modePractice").onclick=()=>{ sfx("win"); startShift(MODES.PRACTICE); };
  $("modeFinal").onclick=()=>{ sfx("win"); startShift(MODES.FINAL); };
  $("modeBench").onclick=()=>{ sfx("win"); startShift(MODES.BENCH); };
  wireChallengePicker();
}

/* ---------- technique challenges ---------------------------------------------
   The replay axis. Every entry takes something away — the coach, the
   magnetism, the hand you are used to — so the same clinical model produces a
   different game, and a run with two of them on is worth more than either
   alone. See game/challenges.js for why none of them can make a draw easier.

   Deliberately on the clock-in screen and nowhere else: the loadout is chosen
   before the shift, not adjusted mid-draw when it is losing. */

/** Chosen challenges, kept on the save so a loadout survives a reload. */
function chosenChallenges(){
  if(!Array.isArray(SS.challenges)) SS.challenges = [];
  const ids = new Set(CHALLENGES.map(c => c.id));
  SS.challenges = SS.challenges.filter(id => ids.has(id));
  return SS.challenges;
}

function challengePickerHTML(){
  const on = new Set(chosenChallenges());
  const chips = CHALLENGES.map(c => `
    <button class="chal-chip${on.has(c.id) ? " on" : ""}" data-chal="${c.id}"
            aria-pressed="${on.has(c.id)}" title="${c.blurb}">
      ${c.label} <span class="chal-mult">×${c.bonus.toFixed(2)}</span>
    </button>`).join("");
  const mult = [...on].reduce((m, id) => m*(CHALLENGES.find(c => c.id===id) || {bonus:1}).bonus, 1);
  return `
    <details class="challenges" id="chalBox"${on.size ? " open" : ""}>
      <summary>⚡ Make it harder ${on.size ? `<b>· ${on.size} on · ×${mult.toFixed(2)}</b>` : ""}</summary>
      <p class="sub">Every one of these takes something away. Nothing here makes a draw
         easier, so a challenge run is always worth more — and stacking them multiplies.</p>
      <div class="chal-chips">${chips}</div>
    </details>`;
}

function wireChallengePicker(){
  panel.querySelectorAll("[data-chal]").forEach(btn=>{
    btn.onclick = ()=>{
      const id = btn.dataset.chal;
      const list = chosenChallenges();
      const i = list.indexOf(id);
      if(i >= 0) list.splice(i, 1); else list.push(id);
      saveSS();
      sfx("click");
      // re-render just this block, so the multiplier in the summary keeps up
      const box = $("chalBox");
      const wasOpen = box ? box.open : true;
      if(box){
        box.outerHTML = challengePickerHTML();
        const fresh = $("chalBox");
        if(fresh) fresh.open = wasOpen;
        wireChallengePicker();
      }
    };
  });
}

/**
 * What the learner has actually demonstrated, as opposed to how long they
 * have played. Sits under the Bench because the Bench is how you move it.
 */
function masteryLine(){
  const m = normaliseMastery(SS.mastery);
  const worst = weakestTrack(m);
  const stars = TRACKS.map(t => `${t.label} ${"★".repeat(m[t.id].stars)}${"☆".repeat(5 - m[t.id].stars)}`);
  const head = worst && worst.rec.stars < 5
    ? `Weakest right now: <b>${worst.track.label}</b>.`
    : "Every technique at five stars.";
  return `${head} <span class="mastery-strip">${stars.join(" · ")}</span>`;
}
/* The kit the learner owns, shown on the clock-in screen because it changes
   what the next draw will be — a device choice, veins they can see, tubes a
   small vein can fill. Decor is not listed here; decor changes the room. */
function equipmentPills(){
  const kit = [
    ["butterflyKit", "🦋 Winged sets"],
    ["veinFinder", "🔦 Vein finder"],
    ["warmingPack", "♨️ Warming pack"],
    ["pediatricKit", "🧸 Paediatric tubes"],
  ].filter(([id]) => hasUpgrade(id));
  return kit.map(([, label]) => `<span class="pill">${label}</span>`).join("");
}

function startShift(mode){
  /* The loadout goes live BEFORE the first patient is rolled: "Deep vein"
     changes the arm the roll produces, and "Wrong hand" changes the bench it
     is laid out on. The Bench is a rehearsal room and never carries them. */
  armChallenges(mode === MODES.BENCH ? [] : chosenChallenges());
  setMode(mode);
  setShift({len:SHIFT_LEN[MODE]||1,index:0,patients:[],ratings:[],orderAllOk:true,safetyAllOk:true,coins:0,startMs:Date.now(),patientTimes:[],missed:[]});
  nextPatient();
}
function nextPatient(){
  // The previous patient's bench goes with them. This is the one place an
  // encounter's scene is torn down — every step in between leases it (see
  // bench/benchSession.js), which is what keeps the band tied and the swab
  // decal painted from one action to the next.
  closeBench();
  if(SHIFT.index>=SHIFT.len){ return endShift(); }
  const p=makePatient(); SHIFT.patients.push(p);
  setEnc({p, selected:[], ordered:[], idChoice:null, labelFields:{name:false,iddob:false,datetime:false,initials:false},
       handlingChoice:null, respondChoice:null, scores:{}, startedAt:Date.now()});
  spawnPatient(getScene(), p);
  resetTubeSelection();
  go("review");
}

/* ---------- review requisition ----------------------------------------------- */
function reqCardHTML(p){
  const fl=p.reqIssue&&p.reqIssue.flaw;
  const nameShown = fl==="name" ? p.first+" "+p.decoyLast : p.name;
  const dobShown  = fl==="dob"  ? '<span style="color:var(--bad)">(missing)</span>' : p.dob;
  const dateShown = fl==="date" ? '<span style="color:var(--bad)">(missing)</span>' : "06/13/2026";
  const provShown = fl==="prov" ? '<span style="color:var(--bad)">(missing)</span>' : p.provider;
  let orders=p.orders.slice();
  if(fl==="dup") orders=[orders[0],orders[0]].concat(orders.slice(1));
  const ordersHTML = orders.map((o,i)=> (fl==="test"&&i===0) ? '<span class="pill" style="color:var(--bad)">▒▒▒▒▒</span>' : `<span class="pill">${o}</span>`).join("");
  return `<div class="req">
      <div>Patient: <b>${nameShown}</b> • ${p.ageCat}</div>
      <div>DOB: <b>${dobShown}</b> &nbsp; ID: <b>${p.id}</b></div>
      <div>Collection date: <b>${dateShown}</b> &nbsp; Provider: <b>${provShown}</b></div>
      <div style="margin-top:6px">Tests ordered:</div>${ordersHTML}
    </div>`;
}
function renderReview(){
  const p=ENC.p;
  // The patient arrives here rather than on a screen of their own: saying
  // hello was never a decision, and the introduction step inside the draw is
  // where greeting them is actually performed and measured.
  const greet=pick(["Hi, I'm here for my blood draw.","Hello! Ready when you are.","Hi there. I've got my lab order right here.","Morning! Hope this is quick."]);
  let options;
  if(p.reqIssue){
    const other=pick(ALL_CATCHES.filter(c=>c!==p.reqIssue.catch));
    options=[
      {t:p.reqIssue.catch+" Hold and clarify before drawing.",ok:true,reply:"Good catch, flag it before we draw a drop."},
      {t:"Looks complete, go straight to the tubes.",ok:false,reply:"Look again, something's missing on there."},
      {t:other+" Hold and clarify.",ok:false,reply:"Not quite that, but you're right to scrutinize."}
    ];
  }else{
    const two=shuffle(ALL_CATCHES).slice(0,2);
    options=[
      {t:"Looks complete and matches, proceed to the tubes.",ok:true,reply:"Yep, it's all there. Let's grab tubes."},
      {t:two[0]+" Hold and clarify.",ok:false,reply:"Actually that's present, this one's clean."},
      {t:two[1]+" Hold and clarify.",ok:false,reply:"Take another look, that's filled in."}
    ];
  }
  const learn="Read every field, name, DOB, tests, date, provider. If anything's missing or mismatched, hold and clarify before drawing.";
  if(guided()){
    runDialogue("review",{
      head:`<h2>👋 Patient ${SHIFT.index+1} of ${SHIFT.len}</h2>${says(p.first,pEmoji(p),greet,p.mood)}${teach("review")}`,
      extra:reqCardHTML(p),
      who:DOT.name, emoji:DOT.emoji, sub:"your guide",
      lines:[pick(["Before we touch a tube, give the order a good scan.","Quick check of the requisition first. Anything off?","Let's read the whole order before we draw."])],
      prompt:"Is this requisition ready to use?", options,
      learn, teachWhy:"If something's missing or doesn't match, hold and clarify.",
      rerender: renderReview,
      onDone:(o)=>{ ENC.reqChoice=o.ok; (ENC.answers=ENC.answers||{}).requisition={your:o.t,correct:(options.find(x=>x.ok)||{}).t}; afterRequisition(); }
    });
  }else{
    panel.innerHTML=`<h2>👋 Patient ${SHIFT.index+1} of ${SHIFT.len}</h2>
      ${says(p.first,pEmoji(p),greet,p.mood)}
      ${reqCardHTML(p)}
      <p class="sub">${pick(["Anything missing or mismatched before you draw?","Scan it, is it ready to use?","Is the order complete and matching?"])}</p>
      <div id="opts"></div>`;
    optionStep(options,(o)=>{ ENC.reqChoice=o.ok; (ENC.answers=ENC.answers||{}).requisition={your:o.t,correct:(options.find(x=>x.ok)||{}).t}; afterRequisition(); }, "If something's missing or doesn't match, hold and clarify before drawing.");
  }
}

/* ---------- into the draw ------------------------------------------------------ */
/**
 * What happens once the requisition has been read.
 *
 * The site question is only asked when this patient's arms actually pose one;
 * everything else about the tubes is decided at the cart, in the draw itself.
 */
function afterRequisition(){
  if(ENC.p.site) return go("site");
  enterDraw();
}

/* ---------- site selection ----------------------------------------------------- */
function enterDraw(){
  if(ENC.p.event.type==="respond" && ENC.p.eventWhen==="pre" && !ENC.preRespondDone){ ENC.respondReturn="collect"; go("respond"); }
  else go("collect");
}
function renderSite(){
  const sc=ENC.p.site;
  if(!sc) return enterDraw();
  const proceed=(o)=>{ ENC.siteChoice=o.ok; (ENC.answers=ENC.answers||{}).siteSelect={your:o.t,correct:(sc.options.find(x=>x.ok)||{}).t}; enterDraw(); };
  if(guided()){
    runDialogue("site",{
      head:`<h2>💉 Site selection</h2>${teach("site")}`,
      extra:`<div class="req">${sc.desc}</div>`,
      who:DOT.name, emoji:DOT.emoji, sub:"your guide",
      lines:[pick(["Let's check both arms before we pick a site.","Look the arms over, where's it safe to draw?","Vein assessment time. Which site is the right call?"])],
      prompt:"Which site do you choose?", options:sc.options,
      learn:sc.learn, teachWhy:sc.why,
      rerender: renderSite,
      onDone:proceed
    });
  }else{
    panel.innerHTML=`<h2>💉 Site selection</h2>
      <div class="req">${sc.desc}</div>
      <p class="sub">${pick(["Which site do you choose?","Where will you draw, and from which arm?","Pick the safest site."])}</p>
      <div id="opts"></div>`;
    optionStep(sc.options, proceed, sc.why);
  }
}

/* ---------- collect: the venipuncture procedure (2D fallback) ------------------ */
function renderCollect(){
  // The tubes this draw NEEDS come from the requisition. Which tubes the
  // learner actually picks up, and the order they rack them in, is the supply
  // cart's job — it is the one place that question is asked now.
  if(!ENC.collect){ ENC.collect = createProcedureState(ENC.p.reqSet, { patient: ENC.p, handedness: SS.handedness }); }
  const c=ENC.collect;
  // A complication the learner answered by stopping really did stop the
  // draw: there is no next step to render, and the report is built from what
  // was actually collected before it.
  if(c.complicationHalt){ return vpFinish(); }
  if(c.step>=c.steps.length){ return vpFinish(); }
  // Owning the winged-set kit turns the device from something the patient's
  // arms dictate into something the learner picks — including picking wrong.
  if(canChooseProcedure() && !c.chosenProcedure && !c.forcedProcedure && c.step===0 && !c.arm){
    return renderProcedureChoice(c);
  }
  watchComplications(c);
  const id=c.steps[c.step];
  const info=VP_TIPS[id];
  const done=c.step, total=c.steps.length;
  // One bar and the name of the piece of technique you are inside, rather
  // than seventeen pips to count. The section is what the learner is actually
  // being paid and graded on, so it is what the progress is labelled with.
  const section = sectionForStep(id);
  const pctDone = Math.round(done/total*100);
  const r = reveal();
  // Learn teaches the step. Practice is reminded what the step is FOR.
  // The Final Practical is told the step's name and nothing else — the
  // examiner does not read you the tip sheet.
  const lesson = r.instruction
    ? `<div class="lesson"><span class="modetag">🎓 TEACHING</span><span class="lh">${VP_ICON[id]} ${info.t}</span>${info.tip}<br><span class="why">Why it matters: ${info.why}</span></div>`
    : r.hints
      ? `<div class="vp-hint">${VP_ICON[id]} <b>${info.t}.</b> ${info.tip}</div>`
      : `<div class="vp-hint">${VP_ICON[id]} <b>${info.t}.</b></div>`;
  panel.innerHTML=`
    <h2>🩸 ${section ? section.label : "Venipuncture"} <span class="vp-count">step ${done+1}/${total}</span></h2>
    <div class="vp-bar"><div class="vp-bar-fill" style="width:${pctDone}%"></div></div>
    <div class="vp-bar-lab"><span>${VP_ICON[id]} ${info.t}</span><span>${pctDone}%</span></div>
    ${lesson}
    <div class="vp-stage" id="vpStage" data-reveal="${MODE}" data-verdicts="${r.verdicts?1:0}"></div>
    ${benchMode() ? benchControlsHTML(section) : ""}
    <button class="btn ghost vp-leave" id="vpLeave">${benchMode() ? "Leave the bench" : "Leave this draw"}</button>`;
  const stage=$("vpStage");
  wireLeaveDraw();
  if(benchMode()) wireBenchControls(c);
  renderCurrentStep(c, stage, {
    rerender: renderCollect,
    onComplete: vpFinish,
    hasMidDrawEvent: ()=> !!(ENC.p.drawEvent && ENC.p.drawEvent.when==="mid" && !ENC.drawEventHandled),
    onMidDrawEvent: (resumeStep)=>{ ENC.drawResumeBeat=resumeStep; go("drawresp"); },
    setCleanup: (fn)=>{ ENC._collectCleanup=fn; },
    onStepFinished: (finishedId, nextId)=> rewardStep(c, finishedId, nextId),
    onCleanup: ()=>{ if(ENC._collectCleanup) ENC._collectCleanup(); },
    // Practice mode only. The driver asks; the mode decision lives here.
    sectionFeedbackFor: (finishedId, nextId)=>{
      if(!reveal().sectionFeedback) return null;
      if(!endsSection(finishedId, nextId)) return null;
      const section = sectionForStep(finishedId);
      const readings = sectionMeasurements(c, section);
      if(!readings.length) return null;
      return { section, readings, done: !nextId };
    },
    onSectionFeedback: renderSectionFeedback,
  });
  if(FX.gsap && !SS.reduceMotion){ FX.gsap.from(stage,{opacity:0,y:12,duration:.3,ease:"power2.out"}); }
}
/* ---------- Practice mode: feedback at the end of each section --------------
   The brief puts Practice's feedback here rather than after every screen, and
   makes the section repeatable. Both are the same data the rubric will use
   later — this is the step's own measurement object, shown early, not a
   second opinion invented for the practice loop.

   Repeating clears this section AND everything downstream of it, because the
   later sessions are built from the earlier ones: a re-done insertion with a
   stale collection session would draw from a puncture that no longer exists.
   ------------------------------------------------------------------------- */
function renderSectionFeedback({ section, readings, done }){
  const cards = readings.map(({ key, measurement:m })=>`
    <div class="sec-card">
      <div class="sec-head">
        <span class="sec-title">${MEASUREMENT_LABELS[key]||key}</span>
        <span class="sec-score">${m.score}/100</span>
      </div>
      <p class="sec-narrative">${m.narrative}</p>
      ${m.mistakes && m.mistakes.length
        ? `<ul class="sec-mistakes">${m.mistakes.slice(0,5).map(x=>`<li>${x.item?`<b>${x.item}</b> — `:""}${x.message}</li>`).join("")}</ul>`
        : `<p class="sec-narrative"><b>Nothing was recorded against this section.</b></p>`}
    </div>`).join("");
  panel.innerHTML=`
    <h2>🔁 ${section.label}</h2>
    <p class="sub">Section finished. This is what was measured — the same numbers the report is built from.</p>
    ${cards}
    <div class="sec-actions">
      <button class="btn" id="secOn">${done?"Finish the draw ▶":"Carry on ▶"}</button>
      <button class="btn ghost" id="secAgain">↺ Repeat this section</button>
    </div>
    <div class="hint">Repeating replays from the start of this section. Everything after it is cleared too, so nothing downstream is left describing work you have just redone.</div>`;
  $("secOn").onclick=()=>{ sfx("tap"); renderCollect(); };
  $("secAgain").onclick=()=>{
    sfx("click");
    const c=ENC.collect;
    if(ENC._collectCleanup) ENC._collectCleanup();
    const index = resetFromSection(c, section.id);
    if(index < 0){ renderCollect(); return; }
    c.step = index;
    c.sectionRepeats = (c.sectionRepeats||0) + 1;
    (c.repeatedSections = c.repeatedSections || []).push(section.id);
    renderCollect();
  };
}

/* ---------- choosing the device ----------------------------------------------
   Only reachable once the winged-set kit is stocked. Before that the arm
   decides, exactly as it always has — which is the honest default, because a
   clinic that has no butterfly sets does not offer you one.

   The choice is a real clinical judgement with a real consequence: a winged
   set on a good antecubital vein is slower and wastes a more expensive
   device; a 21G straight needle on a flat hand vein goes through it. Neither
   is blocked. What the choice costs or earns turns up in the report, because
   the rest of the draw is genuinely different afterwards.
   ---------------------------------------------------------------------------- */
function renderProcedureChoice(c){
  const p = ENC.p;
  const indicated = indicatedProcedure(p);
  const opt = id => {
    const d = PROCEDURES[id];
    return `<button class="btn alt proc-opt" data-proc="${id}">
      <b>${id === PROCEDURE.BUTTERFLY_HAND ? "🦋" : "💉"} ${d.label}</b>
      <span class="proc-note">${d.gauge}G · entry ${d.angle.ideal.min}–${d.angle.ideal.max}° · ${d.short}</span>
    </button>`;
  };
  panel.innerHTML=`
    <h2>🧰 Choose your device</h2>
    <p class="sub">You stock winged sets, so this is your call. Look at the patient before you answer: age, build, and what you were told about their veins.</p>
    ${says(p.first, pEmoji(p), pick([
      "Whatever's easiest for you.",
      "People usually say my veins are tricky.",
      "Last time they used a little one on my hand.",
    ]), p.mood)}
    ${opt(PROCEDURE.STRAIGHT_ANTECUBITAL)}
    ${opt(PROCEDURE.BUTTERFLY_HAND)}
    ${guided()?`<div class="lesson"><span class="lh">How to choose</span>A straight multisample needle in the antecubital fossa is first choice whenever there is a vein there that will take it — it is faster, cheaper and haemolyses less. A winged set on the back of the hand is for when there is not: flat or fragile veins, a small child, a fossa you cannot find anything in. It is a different procedure, not a smaller needle: 23G, a 5–15° entry over bone, tubing that transmits every tug to the tip.</div>`:""}`;
  panel.querySelectorAll(".proc-opt").forEach(b=>{
    b.onclick=()=>{
      sfx("tap");
      c.chosenProcedure = b.dataset.proc;
      c.procedureChosenByLearner = true;
      c.procedureMatchedIndication = (b.dataset.proc === indicated);
      // Commit it now rather than at whichever later step first needs an arm:
      // the device decides the site, the gauge, the entry window and the
      // vessel set, and all of those are properties of THIS decision, made
      // here. ensureArmSession is idempotent.
      ensureArmSession(c);
      renderCollect();
    };
  });
}

/* ---------- paying as you go, without saying so -------------------------------
   The arithmetic here is unchanged and lives, as it always did, in
   `rewards.js`: every step ticks, every finished SECTION pays according to
   its own 0-100 measurement, and a streak of clean sections multiplies the
   section bonus only.

   What changed is WHEN it is shown. The draw used to fire eleven graded
   banners — "Clean · Tourniquet 92/100 +14 XP" — plus a floating +2 XP per
   step, which told the learner their score before they had finished the
   patient. Now every payout accrues to `c.held` in silence and is released as
   one act of the debrief. Nothing during an encounter shows a number, a
   grade, a coin, a chip or a banner.

   The only feedback during the draw is diegetic: the vein filling, the hand
   pinking or blanching, the patient's face, the flash of blood, the vacuum's
   decay, the click of the safety.
   ---------------------------------------------------------------------------- */
function heldFor(c){
  if(!c.held) c.held = { xp:0, coins:0, sections:[], streakPeak:0 };
  return c.held;
}

function rewardStep(c, finishedId, nextId){
  // The Bench pays nothing and grades nothing. That is not a limitation, it
  // is the mode: a rehearsal room where a bad attempt costs you nothing but
  // the six seconds it takes to press "Again".
  if(benchMode()) return;
  const held = heldFor(c);
  held.xp += STEP_XP;

  if(!endsSection(finishedId, nextId)) return;
  const section = sectionForStep(finishedId);
  if(!section) return;

  const score = sectionScore(sectionMeasurements(c, section));
  const streak = c.streak || 0;
  const r = sectionReward(score, streak);
  c.streak = nextStreak(streak, score);
  c.sectionsDone = (c.sectionsDone || 0) + 1;
  if(r.clean) c.cleanSections = (c.cleanSections || 0) + 1;

  held.xp += r.xp || 0;
  held.coins += r.coins || 0;
  held.streakPeak = Math.max(held.streakPeak, c.streak);
  held.sections.push({ id: section.id, label: section.label, score, xp: r.xp || 0, coins: r.coins || 0, clean: !!r.clean });
}

/* =========================================================================
   THE BENCH'S OWN CONTROLS

   Two of them, and they are the whole mode: jump to any beat, and start this
   one again. Mastery needs cheap repetition, and before this every practice
   stick cost a four-minute patient — so the gesture a learner was worst at
   was the one they practised least, which is exactly backwards.

   `resetFromSection` already existed for Practice mode's replay, and it does
   the right thing here for the right reason: it clears the section's sessions
   and measurements and LEAVES THE ARM ALONE, so you are rehearsing on the
   same vein you just missed rather than on a freshly rolled one.
   ========================================================================= */
function benchControlsHTML(section){
  return `<div class="bench-bar">
    <span class="bench-lab">Bench</span>
    ${BENCH_BEATS.map(b => `<button type="button" class="bench-jump${section && section.id===b.id ? " on" : ""}" data-beat="${b.id}">${b.label}</button>`).join("")}
    <button type="button" class="bench-reset" id="benchReset">↻ Again</button>
  </div>`;
}

function wireBenchControls(c){
  const jump = (sectionId)=>{
    const at = resetFromSection(c, sectionId);
    if(at < 0) return;
    if(ENC._collectCleanup){ ENC._collectCleanup(); ENC._collectCleanup = null; }
    c.step = at;
    // Nothing is scored on the bench, so nothing carries: a run that went
    // badly must not follow you into the next rehearsal of it.
    c.held = null; c.streak = 0; c.sectionsDone = 0; c.cleanSections = 0;
    tapHapticSafe();
    renderCollect();
  };
  panel.querySelectorAll(".bench-jump").forEach(b=>{
    b.onclick = ()=>{ sfx("tap"); jump(b.dataset.beat); };
  });
  const reset = $("benchReset");
  if(reset) reset.onclick = ()=>{
    sfx("tap");
    const here = sectionForStep(c.steps[c.step]);
    if(here) jump(here.id);
  };
}

function tapHapticSafe(){
  try{ if(navigator.vibrate) navigator.vibrate(8); }catch(_){}
}

/* ---------- complications ---------------------------------------------------
   The watch is opened here rather than inside any one step, because a
   complication outlives every step: it is the draw that has one, not the
   screen. `main.js` ticks it; this is only the wiring that tells it which
   mode the learner is in and what to do when their answer ends the draw.
   -------------------------------------------------------------------------- */
function watchComplications(c){
  startComplicationWatch(c, {
    reveal: () => reveal(),
    sfx,
    onChange: () => { if(state==="collect") renderCollect(); },
    onHalt: () => {
      // Everything the current step was holding open goes, exactly as it does
      // when a draw is abandoned — the difference is that this one was the
      // right call, and the report says so.
      if(ENC._collectCleanup) ENC._collectCleanup();
      captureStagingIfUnmeasured();
      go("collect");
    },
  });
}

/** The preparation the learner did before walking away from a draw. */
function captureStagingIfUnmeasured(){
  const c = ENC.collect;
  if(!c || !c.supplies || c.supplies.measurements) return;
  const s = c.supplies;
  s.state.completedAt = Date.now();
  const r = evaluateStaging(s.state, s.catalog);
  s.measurements = measureStaging(s.state, s.catalog, r);
  c.stagingMeasurements = s.measurements;
}

/* Ends the venipuncture early. Two-step so a mis-tap can't abandon a patient:
   the button asks for confirmation before it does anything. The encounter is
   then scored on what was actually completed — nothing is faked as done. */
function wireLeaveDraw(){
  const b=$("vpLeave"); if(!b) return;
  b.onclick=()=>{
    if(b.dataset.armed!=="1"){
      b.dataset.armed="1";
      b.classList.add("armed");
      b.textContent="Leave without finishing the draw?";
      sfx("click");
      setTimeout(()=>{ if(b.dataset.armed==="1"){ b.dataset.armed=""; b.classList.remove("armed"); b.textContent="Leave this draw"; } }, 4000);
      return;
    }
    sfx("bad");
    if(ENC._collectCleanup) ENC._collectCleanup();
    ENC.drawAbandoned=true;
    // capture whatever preparation was done before they walked away
    captureStagingIfUnmeasured();
    finishComplications(ENC.collect);
    runScoreEncounter();
  };
}

/* ---------- the recap chips ------------------------------------------------
   Phase 3b's brief: the chips report REAL MEASUREMENTS, not booleans. Every
   value below is read off the step's own measurement object — the same number
   the rubric is graded from — so "Tourniquet timing ✓" becomes "Tourniquet
   38s", which is a thing a learner can actually act on next time.

   A chip with no measurement behind it (the step never ran) says so rather
   than showing a zero it did not earn.
   -------------------------------------------------------------------------- */
function recapChips(c){
  const n = (v, unit, dp) => v == null ? null : `${dp ? Number(v).toFixed(dp) : Math.round(v)}${unit || ""}`;
  const ins = c.insertMeasurements, tq = c.tourniquetMeasurements, col = c.collectionMeasurements;
  const cl = c.cleaningMeasurements, pd = c.postDrawMeasurements, wd = c.withdrawalMeasurements;
  const inv = c.inversionMeasurements, sm = c.stagingMeasurements, cx = c.complicationMeasurements;

  return [
    { label: "Supplies staged", ok: c.gatherOk, value: sm ? `${sm.correctItems} right / ${sm.incorrectItems} wrong` : null },
    { label: "Tourniquet", ok: c.tqGood, value: tq ? `${n(tq.secondsOn, "s")} · ${n(tq.heightAboveSiteInches, "″", 1)} above` : null },
    { label: "Vein selected", ok: c.veinOk, value: c.site && c.site.vesselLabel ? c.site.vesselLabel : null },
    { label: "Site antisepsis", ok: c.cleanOk, value: cl ? `${n(cl.coveragePct, "%")} covered · dried ${n(cl.dryingSeconds, "s")}` : null },
    { label: "Insertion angle", ok: c.insertOk, value: ins ? `${n(ins.angleDeg, "°")} · ${n(ins.depthMm, "mm", 1)} deep` : null },
    { label: "Re-approaches", ok: ins ? ins.reapproaches === 0 : false, value: ins ? String(ins.reapproaches) : null },
    { label: "Order of draw", ok: c.tubeOrderOk, value: col ? `${n(col.orderAccuracy*100, "%")}` : null },
    { label: "Blood collected", ok: c.fillGood, value: col ? `${n(col.totalDrawnMl, " mL", 1)}` : null },
    { label: "Needle movement", ok: col ? col.peakNeedleShiftMm <= 1 : false, value: col ? `${n(col.peakNeedleShiftMm, "mm", 1)}` : null },
    { label: "Sharp exposed", ok: c.safetyOk, value: wd ? `${n(wd.exposedSeconds, "s", 1)}` : null },
    { label: "Pressure held", ok: c.pressureOk, value: pd ? `${n(pd.effectiveSeconds, "s")} of ${n(pd.requiredSeconds, "s")}` : null },
    { label: "Tubes mixed", ok: c.mixOk, value: inv ? `${inv.tubesUsable}/${inv.tubesRequired} usable` : null },
    { label: "Complications", ok: c.complicationsOk !== false, value: cx ? (cx.total ? `${cx.managedCount}/${cx.total} handled` : "none") : null },
  ];
}

function vpFinish(){
  const c=ENC.collect;
  /* The Bench has no end. Finishing a draw there loops straight back to the
     first beat with the same arm, because "one more go" is the entire mode
     and a results screen in the middle of it would be a wall across it. */
  if(benchMode()){
    const at = resetFromSection(c, "tourniquet");
    if(at >= 0){
      if(ENC._collectCleanup){ ENC._collectCleanup(); ENC._collectCleanup = null; }
      c.step = at;
      c.held = null; c.streak = 0; c.sectionsDone = 0; c.cleanSections = 0;
      c.awarded = false; c.specimenQuality = null;
      return renderCollect();
    }
  }
  // The draw is over: close the complication watch and let the laboratory
  // look at what came out of it. Both are idempotent — vpFinish() is
  // reachable more than once.
  finishComplications(c);
  if(!c.specimenQuality) applySpecimenOutcome(c, assessSpecimens(c, { orders: ENC.p.orders }));
  const chips = recapChips(c);
  const items=[["gatherOk","Supplies gathered"],["veinOk","Vein selected"],["cleanOk","Site cleaned"],["assembleOk","Needle assembled"],["uncapOk","Uncapped"],
    ["insertOk","Clean insertion"],["fillGood","Filled to line"],["tqGood","Tourniquet timing"],["tubeOrderOk","Order of draw"],
    ["pressureOk","Pressure held"],["disposeOk","Sharps disposed"],["mixOk","Tubes inverted"]];
  // The steps and sections have been paying as they went, so this is the
  // small end-of-draw part: how much got finished, and the three outcomes a
  // lump sum is actually good at recognising. See game/rewards.js.
  const q = c.specimenQuality;
  const cx = c.complicationMeasurements;
  const payout = drawReward({
    stepsDone: Math.min(c.step, c.steps.length), stepsTotal: c.steps.length,
    cleanSections: c.cleanSections || 0, sectionsDone: c.sectionsDone || 0,
    specimensAccepted: q ? q.acceptedCount : 0, specimensTotal: q ? q.total : 0,
    complicationsHandled: !!(cx && cx.missedCount === 0 && cx.worsenedCount === 0 && !cx.fainted),
  });
  /* HELD, not paid. The lump sum is computed here, exactly as it always was,
     and then joins everything the sections accrued in `c.held` — so the
     encounter is still over before the learner sees a single number. It is
     released in act 4 of the debrief. */
  if(!c.awarded){
    const held = heldFor(c);
    held.xp += payout.xp;
    held.coins += payout.coins;
    held.notes = payout.notes;
    c.awarded = true;
  }
  const hasPostDraw = !!ENC.p.drawEvent && ENC.p.drawEvent.when!=="mid" && !ENC.drawEventHandled;
  const sm = c.stagingMeasurements;
  // Teaching mode reports technique immediately; a scored shift holds it back
  // to the encounter score, after the patient interaction is over.
  const stagingBlock = (sm && guided()) ? `
    <div class="vp-technique">
      <div class="vt-head"><span class="vt-title">🧺 Work-area preparation</span><span class="vt-score">${sm.score}/100</span></div>
      <p class="vt-narrative">${sm.narrative}</p>
      ${sm.mistakes && sm.mistakes.length ? `<ul class="vt-mistakes">${sm.mistakes.map(m=>`<li>${m.item?`<b>${m.item}</b> — `:""}${m.message}</li>`).join("")}</ul>` : ""}
      <div class="vt-metrics">
        <span>Correct items <b>${sm.correctItems}</b></span>
        <span>Wrong items <b>${sm.incorrectItems}</b></span>
        <span>Unsafe items <b>${sm.unsafeItems}</b></span>
        <span>Order of draw <b>${Math.round(sm.tubeOrderAccuracy*100)}%</b></span>
        <span>Packages checked <b>${sm.inspectionsBeforeStaging}/${sm.stagedCount}</b></span>
        <span>Replacements <b>${sm.replacements}</b></span>
        <span>Sharps reachable <b>${sm.sharpsAccessible?"yes":"no"}</b></span>
        <span>Staging time <b>${fmtDuration(sm.timeMs)}</b></span>
      </div>
    </div>` : "";
  // The rubric is built for EVERY mode, because per-mode bests need it — but
  // only the Final Practical is shown the full report. Learn and Practice keep
  // the chips they have always had, with a compact rubric line under them;
  // the report is the Final Practical's output, not a replacement for
  // in-line coaching.
  const { report, replay, progressLine } = gradeAttempt(c);
  const haltNote = c.complicationHalt ? `
    <div class="fb no"><b>You stopped the draw.</b> That was the right call for a
    ${(c.complicationMeasurements && (c.complicationMeasurements.events.find(e=>e.id===c.complicationHalt.id)||{}).label) || "complication"},
    and the report below is built from what was actually collected before it — not from what was ordered.</div>` : "";
  // THE REPORT COMES AT THE END, NOT HERE.
  //
  // The Final Practical used to print its whole rubric report the moment the
  // needle was out — before the tubes were labelled, before the patient had
  // been answered, and then followed it two clicks later with a second
  // grading screen. That is two verdicts on one encounter, delivered in the
  // middle of the job. The draw now ends with a recap of what it measured,
  // and every judgement lands together on the score screen once the patient
  // is finished with. `gradeAttempt()` still runs here, because this is the
  // moment the attempt genuinely ended.
  const body = finalPractical()
    ? `${haltNote}
       <div class="fb"><b>Draw complete.</b> Your practical report follows once you have finished with the patient.</div>
       <div class="vp-scorewrap">${chips.filter(ch=>ch.ok || ch.value).map(ch=>`<span class="vp-chip ${ch.ok?'ok':'mid'}">${ch.ok?'✓':'•'} ${ch.label}${ch.value?` <b>${ch.value}</b>`:""}</span>`).join("")}</div>
       ${labReceivingHTML(c.specimenQuality)}`
    : `${haltNote}
       <div class="fb"><b>Nicely done.</b> +${payout.xp} XP · +${payout.coins} 🪙 for a ${payout.completion}% complete draw${payout.notes.length?` — ${payout.notes.join(", ")}`:""}.</div>
       ${c.cleanSections?`<div class="hint">${c.cleanSections} of ${c.sectionsDone} sections were clean, and they paid as you went.</div>`:""}
       ${stagingBlock}
       <div class="vp-scorewrap">${chips.filter(ch=>ch.ok || ch.value).map(ch=>`<span class="vp-chip ${ch.ok?'ok':'mid'}">${ch.ok?'✓':'•'} ${ch.label}${ch.value?` <b>${ch.value}</b>`:""}</span>`).join("")}</div>
       ${complicationSummaryHTML(c.complicationMeasurements)}
       ${labReceivingHTML(c.specimenQuality)}
       ${renderRubricSummary(report)}
       ${progressLine?`<div class="rep-policy">${progressLine}</div>`:""}
       ${guided()?`<div class="lesson"><span class="lh">You ran the full venipuncture sequence!</span>Hygiene → gather → tourniquet → palpate → clean → assemble (while it dries) → uncap → insert → fill &amp; switch in order of draw → release → withdraw → safety → sharps → pressure → bandage → invert. Every step protects the patient and the specimen.</div>`:""}`;
  panel.innerHTML=`
    <h2>${finalPractical()?`📋 Practical report — ${ENC.p.first}`:`✅ Draw complete — ${ENC.p.first}`}</h2>
    ${body}
    <button class="btn vp-tap" id="vpToLabel">${hasPostDraw?"⚠️ Something needs attention ▶":"🏷️ Continue to labeling ▶"}</button>`;
  $("vpToLabel").onclick=()=>{ sfx("tap"); go(hasPostDraw?"drawresp":"label"); };
}

/* ---------- the laboratory's own verdict -------------------------------------
   Shown in every mode, unlike the coaching, because it is not feedback about
   the learner — it is what happened to the specimens. A rejected tube means a
   real person gets stuck again tomorrow, and that is the part of the job the
   patient actually experiences.
   ---------------------------------------------------------------------------- */
function labReceivingHTML(q){
  if(!q || !q.total) return "";
  // A clean delivery is one line. There is nothing to read tube by tube when
  // every tube was accepted as drawn, and making the learner scroll past it
  // to reach the next button is friction with no lesson in it.
  if(!q.rejectedCount && !q.flaggedCount){
    return `<div class="lab-receiving lab-clean">
      <div class="lab-head"><span class="lab-title">🧫 Specimen receiving</span><span class="lab-score">${q.score}/100</span></div>
      <p class="vt-narrative">All ${q.total} tube${q.total===1?"":"s"} accepted as drawn. ${q.testsOrdered.length?`${q.testsOrdered.join(", ")} can be reported.`:""}</p>
    </div>`;
  }
  const rows = q.tubes.map(t=>`
    <li class="lab-row lab-${t.verdict}">
      <span class="lab-tube">${t.name}</span>
      <span class="lab-verdict">${t.verdict === "accepted" ? "✓ accepted" : t.verdict === "flagged" ? "⚠ accepted with comment" : "✗ rejected"}</span>
      <span class="lab-fill">${Math.round(t.fillFraction*100)}% full</span>
      <span class="lab-why">${t.headline}</span>
    </li>`).join("");
  return `<div class="lab-receiving">
    <div class="lab-head"><span class="lab-title">🧫 Specimen receiving</span><span class="lab-score">${q.score}/100</span></div>
    <p class="vt-narrative">${q.narrative}</p>
    <ul class="lab-list">${rows}</ul>
    ${q.redrawRequired?`<div class="fb no"><b>Redraw required.</b> ${q.lostTests.join(", ")} cannot be reported from this collection.</div>`:""}
  </div>`;
}

/**
 * Grades the attempt once and folds it into this mode's own record.
 *
 * Idempotent: `vpFinish()` is reachable more than once (a post-draw
 * complication returns to it), and a second visit must not count a second
 * attempt or claim a second personal best.
 */
function gradeAttempt(c){
  if(c.report) return { report:c.report, replay:c.replay, progressLine:c.progressLine };
  const report = buildRubricReport(c, {
    mode: MODE,
    patient: ENC.p ? ENC.p.name : null,
    attemptedAt: Date.now(),
    elapsedMs: ENC.startedAt ? Date.now()-ENC.startedAt : null,
    // Coached corrections cost the top band. Learn mode names the specific
    // error and refuses to advance until it is fixed, so BY DEFINITION no row
    // in a Learn attempt was done unaided — that is what Learn mode is. The
    // rubric says so out loud rather than quietly awarding an Excellent for
    // work the coach talked the learner through.
    context: { assists: guided()
      ? Object.fromEntries(CATEGORIES.map(x=>[x.id, 1]))
      : {} },
  });
  const replay = buildReplay(c, { startedAt: ENC.startedAt });
  const outcome = recordAttempt(SS.modeProgress, MODE, report);
  SS.modeProgress = outcome.progress;
  saveSS();

  const weak = weakestCategories(SS.modeProgress, MODE, report, 2);
  const bits = [`${MODE_NAMES[MODE]}: attempt ${recordFor(SS.modeProgress, MODE).attempts}`];
  if(outcome.newBest) bits.push(`new best ${report.total}/${report.maxTotal}`);
  else if(outcome.delta != null) bits.push(`${outcome.delta>=0?"+":""}${outcome.delta} on your last attempt`);
  if(weak.length) bits.push(`weakest: ${weak.map(w=>w.label).join(", ")}`);

  c.report = report;
  c.replay = replay;
  c.progressLine = bits.join(" · ");
  return { report, replay, progressLine:c.progressLine };
}

/* ---------- labeling and routing ------------------------------------------------
   One screen, not two. Labeling at the bedside and deciding how the batch
   travels are the same moment of work — you are standing at the chair with the
   tubes in your hand — and splitting them cost a screen and a click without
   teaching anything the second half did not already teach.
   ------------------------------------------------------------------------------ */
function renderLabel(){
  const p=ENC.p, ev=p.event;
  const note = ev.type==="label" ? `<div class="fb no"><b>Heads up:</b> ${ev.prompt} ${ev.why}</div>`:"";
  const f=ENC.labelFields;
  if(!ENC.handlingOptions){
    ENC.handlingOptions = shuffle([
      {key:"routine",t:pick(HANDLING.routine.labels),ok:p.handling==="routine"},
      {key:"chilled",t:pick(HANDLING.chilled.labels),ok:p.handling==="chilled"},
      {key:"light",t:pick(HANDLING.light.labels),ok:p.handling==="light"},
    ]);
  }
  const opts = ENC.handlingOptions;
  const chosen = ENC.handlingChoice;
  panel.innerHTML=`
    <h2>🏷️ Label and route</h2>
    ${teach("label")}
    ${guided()?says(DOT.name,DOT.emoji,pick(["Label right here at the chair, before we go anywhere.","Last thing at the bedside: label every tube fully, then decide how they travel.","Don't leave the chair unlabeled! Check each field, then pick the transport."]),"your guide"):""}
    ${note}
    <div id="fields">
      ${labelRow("name","Patient full name",f.name)}
      ${labelRow("iddob","ID number / DOB",f.iddob)}
      ${labelRow("datetime","Date & time of collection",f.datetime)}
      ${labelRow("initials","Your (phlebotomist) initials",f.initials)}
    </div>
    <div class="route-head">📦 How does this batch travel to the lab?</div>
    <div id="routeOpts">${opts.map(o=>`<button class="opt${chosen===o.key?" good":""}" data-route="${o.key}">${o.t}</button>`).join("")}</div>
    <button class="btn gold" id="print">🖨️ Print labels &amp; send ▶</button>
  `;
  ["name","iddob","datetime","initials"].forEach(k=>{
    $("lr-"+k).onclick=()=>{ ENC.labelFields[k]=!ENC.labelFields[k]; sfx("click"); renderLabel(); };
  });
  panel.querySelectorAll("[data-route]").forEach(b=>{
    b.onclick=()=>{
      const o = opts.find(x=>x.key===b.dataset.route);
      if(guided() && !o.ok){
        sfx("bad");
        showHint($("routeOpts"), HANDLING[p.handling].why);
        return;
      }
      sfx("click");
      ENC.handlingChoice=o.key;
      (ENC.answers=ENC.answers||{}).handling={your:o.t,correct:(opts.find(x=>x.ok)||{}).t};
      renderLabel();
    };
  });
  $("print").onclick=()=>{
    const f2=ENC.labelFields, miss=[];
    if(guided()){
      if(!f2.name)miss.push("full name"); if(!f2.iddob)miss.push("ID/DOB");
      if(!f2.datetime)miss.push("date & time"); if(!f2.initials)miss.push("your initials");
      if(miss.length){ toast("A complete label still needs: "+miss.join(", ")+"."); sfx("bad"); return; }
    }
    if(!ENC.handlingChoice){ toast("Choose how these specimens travel to the lab."); sfx("bad"); return; }
    sfx("tap");
    if(p.event.type==="respond" && p.eventWhen==="post"){ ENC.respondReturn="score"; go("respond"); }
    else runScoreEncounter();
  };
}
function labelRow(k,label,on){return `<div class="chk ${on?'on':''}" id="lr-${k}"><div class="box">${on?'✓':''}</div>${label}</div>`;}

/* ---------- professional response (event) ---------------------------------------- */
function renderRespond(){
  const ev=ENC.p.event;
  if(!ENC.convo) ENC.convo={phase:"lines",idx:0,chosen:null};
  const c=ENC.convo;
  const who=ENC.p.first, ava=ev.emoji||"🙂";
  const lines=ev.lines||[ev.prompt||"…"];
  const head=`<h2>💬 ${who} says…</h2>${guided()?teach("respond"):""}`;
  const bubble=(txt,sub)=>`<div class="dlg"><div class="ava">${ava}</div><div class="bubble"><div class="who">${who}${sub?` • ${sub}`:""}</div>${txt}</div></div>`;

  if(c.phase==="lines"){
    panel.innerHTML=head+bubble(lines[c.idx], c.idx===0?ENC.p.mood:"")+
      `<button class="btn alt" id="next">${c.idx<lines.length-1?"▶ …":"💬 Respond"}</button>`;
    $("next").onclick=()=>{ sfx("tap"); if(c.idx<lines.length-1){c.idx++;} else {c.phase="choose";} renderRespond(); };
    return;
  }
  if(c.phase==="choose"){
    panel.innerHTML=head+bubble(lines[lines.length-1])+
      `<p class="sub">How do you respond?</p><div id="opts"></div>`;
    const box=$("opts");
    shuffle(ev.options).forEach((o,i)=>{
      const b=document.createElement("button"); b.className="opt"; b.textContent=o.t; b.style.animationDelay=(i*55)+"ms";
      b.onclick=()=>{
        if(guided() && !o.ok){ b.classList.add("bad"); sfx("bad");
          showHint(box, (o.reply?('They\'d react: "'+o.reply+'", '):"")+(ev.why||"Try a kinder, safer response.")); return; }
        b.classList.add(o.ok?"good":"bad"); sfx(o.ok?"good":"bad");
        ENC.respondChoice=o.ok; (ENC.answers=ENC.answers||{}).professional={your:o.t,correct:(ev.options.find(x=>x.ok)||{}).t}; c.chosen=o; c.phase="reaction"; setTimeout(()=>renderRespond(),280);
      };
      box.appendChild(b);
    });
    return;
  }
  const o=c.chosen;
  panel.innerHTML=head+bubble(o.reply||(o.ok?"Thank you.":"Hmm, okay."))+
    `<div class="learn"><b>📚 You learned:</b> ${ev.learn||ev.why||""}</div>
     <button class="btn" id="doneR">Continue ▶</button>`;
  $("doneR").onclick=()=>{ sfx("tap"); ENC.convo=null; if(ENC.respondReturn==="collect"){ ENC.preRespondDone=true; go("collect"); } else { runScoreEncounter(); } };
}

/* ---------- draw complication (recognition + high-level response) ------------------ */
function renderDrawResp(){
  const ev=ENC.p.drawEvent;
  if(!ev){ return go(ENC.drawResumeBeat!=null?"collect":"label"); }
  if(!ENC.dconvo) ENC.dconvo={phase:"lines",idx:0,chosen:null};
  const c=ENC.dconvo;
  const patient = ev.who==="patient";
  const who = patient ? ENC.p.first : (ev.who||"⚠️ Heads up");
  const ava = patient ? (ev.emoji||pEmoji(ENC.p)) : (ev.emoji||"⚠️");
  const lines=ev.lines||["…"];
  const head=`<h2>🩺 During the draw…</h2>`;
  const dotCls = patient ? "" : " dot";
  const bubble=(txt)=>`<div class="dlg"><div class="ava${dotCls}">${ava}</div><div class="bubble"><div class="who">${who}</div>${txt}</div></div>`;

  if(c.phase==="lines"){
    panel.innerHTML=head+bubble(lines[c.idx])+
      `<button class="btn alt" id="next">${c.idx<lines.length-1?"▶ …":"💬 Respond"}</button>`;
    $("next").onclick=()=>{ sfx("tap"); if(c.idx<lines.length-1){c.idx++;} else {c.phase="choose";} renderDrawResp(); };
    return;
  }
  if(c.phase==="choose"){
    panel.innerHTML=head+bubble(lines[lines.length-1])+
      `<p class="sub">What do you do?</p><div id="opts"></div>`;
    const box=$("opts");
    shuffle(ev.options).forEach((o,i)=>{
      const b=document.createElement("button"); b.className="opt"; b.textContent=o.t; b.style.animationDelay=(i*55)+"ms";
      b.onclick=()=>{
        if(guided() && !o.ok){ b.classList.add("bad"); sfx("bad");
          showHint(box, (o.reply?('"'+o.reply+'", '):"")+(ev.learn||"Choose the safest response.")); return; }
        b.classList.add(o.ok?"good":"bad"); sfx(o.ok?"good":"bad");
        ENC.drawChoice=o.ok; (ENC.answers=ENC.answers||{}).draw={your:o.t,correct:(ev.options.find(x=>x.ok)||{}).t}; c.chosen=o; c.phase="reaction"; setTimeout(()=>renderDrawResp(),280);
      };
      box.appendChild(b);
    });
    return;
  }
  const o=c.chosen;
  const resuming = ENC.drawResumeBeat!=null;
  panel.innerHTML=head+bubble(o.reply||(o.ok?"Handled well.":"Let's reconsider that."))+
    `<div class="learn"><b>📚 You learned:</b> ${ev.learn||""}</div>
     <button class="btn" id="doneD">${resuming?"🩹 Back to the draw ▶":"🏷️ Continue to labeling ▶"}</button>`;
  $("doneD").onclick=()=>{
    sfx("tap"); ENC.drawEventHandled=true; ENC.dconvo=null;
    if(ENC.drawResumeBeat!=null){
      if(ENC.collect) ENC.collect.step=ENC.drawResumeBeat;
      ENC.drawResumeBeat=null;
      go("collect");
    } else {
      go("label");
    }
  };
}

/* ---------- scoring screen ----------------------------------------------------------- */
function runScoreEncounter(){
  const { stickerWins } = scoreEncounter();
  if(stickerWins && stickerWins.length) celebrateStickers(stickerWins);
  go("score");
}
function celebrateStickers(wins){
  sfx("win"); confetti(54);
  wins.slice(0,3).forEach((w,i)=>{
    setTimeout(()=>{ sfx("coin"); toast(`${w.st.emoji} ${w.st.name} ×${w.m}!  +${w.coins}🪙`); }, 360+i*900);
  });
  if(wins.length>3) setTimeout(()=>toast(`…and ${wins.length-3} more sticker milestone${wins.length-3>1?"s":""}! 🎉`), 360+3*900);
}
function starHTML(stars){
  let s='<div class="stars">';
  for(let i=0;i<5;i++){ s+=`<span style="animation-delay:${i*90}ms">${i<stars?'⭐':'☆'}</span>`; }
  return s+'</div>';
}
/* =========================================================================
   THE DEBRIEF, AS FOUR ACTS

   Everything the encounter withheld arrives here, paced. The old screen put
   stars, a percentage, a coin count and twelve tiles on the page at once —
   after eleven in-draw banners had already given the game away — so it landed
   as a summary of things you had been told rather than as a verdict.

   Now: the patient leaves, then the lab speaks, then the numbers, then the
   payout. Each act waits for the one before it. Clicking anywhere skips
   ahead, because a player who has seen it fifty times should never be made to
   sit through it, and "Next patient" is the largest control on the screen
   because the fastest path out of a debrief should be into another draw.
   ========================================================================= */
function renderScore(){
  const c = ENC.collect || {};
  const teaching = guided();

  /* --- everything held back during the draw, settled now ------------------ */
  const held = (c.held) || { xp:0, coins:0, sections:[], streakPeak:0 };
  const scores = sectionScores(c);
  SS.mastery = normaliseMastery(SS.mastery);
  const starsGained = c.masteryApplied ? (c.masteryGained || []) : applyMastery(SS.mastery, scores);
  c.masteryGained = starsGained;
  c.masteryApplied = true;

  const q = c.specimenQuality;
  const ins = c.insertMeasurements;
  const tq = c.tourniquetMeasurements;
  const cl = c.cleaningMeasurements;
  const cx = c.complicationMeasurements;
  const allAccepted = !!(q && q.total > 0 && q.acceptedCount === q.total);
  const oneStick = !!(ins && ins.inVein && !ins.reapproaches);
  SS.bests = SS.bests || {};
  const streak = allAccepted && oneStick ? (SS.flawlessRun = (SS.flawlessRun || 0) + 1) : (SS.flawlessRun = 0);
  const bestsBeaten = c.bestsApplied ? (c.bestsBeaten || []) : offerBests(SS.bests, {
    cleanDrawMs: ENC.elapsedMs,
    entryAngleErr: ins && ins.angleDeg != null ? Math.abs(ins.angleDeg - 22) : undefined,
    coverage: cl ? cl.coveragePct : undefined,
    flawlessStreak: streak,
    acceptedStreak: allAccepted ? (SS.acceptedRun = (SS.acceptedRun || 0) + (q ? q.total : 0)) : (SS.acceptedRun = 0),
    bandSeconds: tq ? tq.secondsOn : undefined,
  }, {
    oneStick, allAccepted, flashed: !!(ins && ins.inVein),
    noMissedComplications: !cx || (cx.missedCount === 0 && !cx.fainted),
  });
  c.bestsBeaten = bestsBeaten;
  c.bestsApplied = true;

  /* --- what the challenges came to --------------------------------------
     Scored here rather than inside rewards.js: the payout arithmetic is a
     protected part of the clinical model and stays exactly as it was. A
     challenge multiplies what that arithmetic produced, and only when the
     draw actually satisfied it — a "One stick" run that took three is worth
     the ordinary amount, not a penalty and not a bonus. */
  const chal = c.challengeResult || scoreChallenges(armedChallengeIds(), c);
  c.challengeResult = chal;
  if(!c.paidOut){
    const m = chal.multiplier;
    held.xp = Math.round(held.xp*m);
    held.coins = Math.round(held.coins*m);
    addXP(held.xp); addCoins(held.coins);
    c.paidOut = true;
  }
  saveSS();

  const debrief = buildDebrief({
    collect: c, patient: ENC.p, held, specimens: q,
    bests: bestsBeaten, mastery: starsGained, elapsedMs: ENC.elapsedMs,
  });

  /* --- the practical report and the per-category tiles stay available, but
         they are now BELOW the four acts rather than instead of them ------- */
  const s = ENC.scores, cats = Object.keys(s);
  const correct = cats.filter(k => s[k]).length;
  const pct = Math.round(correct/cats.length*100);
  const practical = (finalPractical() && c.report)
    ? `<h3 class="rep-sec rep-title">📋 Practical report</h3>${renderPracticalReport(c.report, c.replay, { progress: c.progressLine })}`
    : "";

  const lab = debrief.acts[1], tech = debrief.acts[2];
  const lastLabel = SHIFT.index+1 >= SHIFT.len;

  panel.innerHTML = `
    <div class="debrief" id="debrief">
      <section class="db-act db-patient" data-act="0">
        <p class="db-verdict">${debrief.acts[0].line}</p>
      </section>

      <section class="db-act db-lab" data-act="1">
        <h3 class="db-head">The lab</h3>
        <ul class="db-specimens">
          ${lab.specimens.map((t,i)=>`
            <li class="db-spec ${t.verdict}" data-i="${i}">
              <span class="db-spec-key">${TUBES[t.key] ? TUBES[t.key].name : t.key}</span>
              <span class="db-spec-verdict">${t.verdict === "accepted" ? "accepted" : t.verdict === "flagged" ? "flagged" : "rejected"}</span>
              <span class="db-spec-why">${t.why || ""}</span>
            </li>`).join("")}
        </ul>
        ${lab.total ? `<p class="db-lab-tally">${lab.accepted} of ${lab.total} accepted</p>` : `<p class="db-lab-tally">No specimens reached the lab.</p>`}
      </section>

      <section class="db-act db-tech" data-act="2">
        <h3 class="db-head">Technique</h3>
        <dl class="db-metrics">
          ${tech.lines.map(l=>`<div class="db-metric ${l.ok ? "ok" : "off"}"><dt>${l.label}</dt><dd>${l.value}</dd></div>`).join("")}
          <div class="db-metric ok"><dt>patient time</dt><dd>${fmtDuration(ENC.elapsedMs)}</dd></div>
        </dl>
        ${tech.fix ? `<p class="db-fix">${tech.fix}</p>` : `<p class="db-fix db-fix-none">Nothing to fix. That was a clean draw.</p>`}
        ${tech.bests.length ? `<ul class="db-bests">${tech.bests.map(b=>`<li>🥇 <b>${b.label}</b> — new personal best</li>`).join("")}</ul>` : ""}
        ${tech.mastery.length ? `<ul class="db-mastery">${tech.mastery.map(m=>`<li>⭐ <b>${m.label}</b> — ${m.stars} star${m.stars===1?"":"s"}</li>`).join("")}</ul>` : ""}
      </section>

      <section class="db-act db-rewards" data-act="3">
        <div class="db-payout">
          <span class="db-xp">+${held.xp} XP</span>
          <span class="db-coins">+${held.coins} 🪙</span>
          ${held.streakPeak >= 2 ? `<span class="db-streak">🔥 ${held.streakPeak} clean sections</span>` : ""}
          ${chal.multiplier > 1 ? `<span class="db-chal-mult">×${chal.multiplier.toFixed(2)} challenge</span>` : ""}
        </div>
        ${chal.met.length || chal.missed.length ? `<ul class="db-challenges">
          ${chal.met.map(ch=>`<li class="met">⚡ <b>${ch.label}</b> — held</li>`).join("")}
          ${chal.missed.map(ch=>`<li class="missed">⚡ <b>${ch.label}</b> — not this time</li>`).join("")}
        </ul>` : ""}
        ${held.notes && held.notes.length ? `<ul class="db-notes">${held.notes.map(n=>`<li>${n}</li>`).join("")}</ul>` : ""}
        <button class="btn db-next" id="cont">${lastLabel ? (teaching ? "🎓 Finish lesson" : "🏁 Finish shift") : "▶ Next patient"}</button>
        <button class="btn ghost db-detail-toggle" id="dbDetails">Show the full breakdown</button>
      </section>

      <div class="db-details" id="dbDetailsBody" hidden>
        ${teaching ? "" : `<div class="sub" style="text-align:center">${correct}/${cats.length} correct • ${pct}%</div>`}
        <div class="scoregrid">
          ${cats.map((k,i)=>`<button type="button" class="scorecell ${s[k]?'ok':'no'}" data-cat="${k}" style="animation-delay:${i*60}ms"><div class="lab">${FEEDBACK[k].label}</div>${s[k]?'✓ Good':'✗ Review'}<span class="more">Tap for details</span></button>`).join("")}
        </div>
        ${practical}
        <div id="fbs"></div>
      </div>
    </div>`;

  panel.querySelectorAll(".scorecell[data-cat]").forEach(b=>{
    b.onclick = ()=> showScoreDetail(b.dataset.cat);
  });
  const toggle = $("dbDetails"), body = $("dbDetailsBody");
  if(toggle && body){
    toggle.onclick = ()=>{
      const open = !body.hidden;
      body.hidden = open;
      toggle.textContent = open ? "Show the full breakdown" : "Hide the breakdown";
      if(!open){
        const sm = c.stagingMeasurements;
        showScoreDetail((sm && !sm.ready) ? "supplyStaging" : (cats.find(k=>!s[k]) || cats[0]), true);
      }
      sfx("tap");
    };
  }
  $("cont").onclick = ()=>{ sfx("tap"); SHIFT.index++; removePatient(getScene()); nextPatient(); };

  playDebrief(debrief);
}

/**
 * Runs the acts. One timer chain, cancelled and fast-forwarded by any click,
 * so nobody is ever held hostage by an animation they have seen before.
 */
let debriefTimers = [];
function playDebrief(debrief){
  debriefTimers.forEach(clearTimeout);
  debriefTimers = [];
  const host = $("debrief");
  if(!host) return;
  const acts = [...host.querySelectorAll(".db-act")];
  acts.forEach(a => a.classList.remove("in"));

  const at = (ms, fn)=> debriefTimers.push(setTimeout(fn, ms));
  let t = 120;

  // Act 1 — the patient leaves. No numbers. Two seconds of just this.
  at(t, ()=> acts[0] && acts[0].classList.add("in"));
  t += debrief.acts[0].holdMs;

  // Act 2 — the lab, one specimen at a time, each with its own sound.
  at(t, ()=>{
    if(acts[1]) acts[1].classList.add("in");
  });
  const specs = [...host.querySelectorAll(".db-spec")];
  specs.forEach((el, i)=>{
    at(t + 180 + i*debrief.acts[1].stepMs, ()=>{
      el.classList.add("in");
      sfx(el.classList.contains("accepted") ? "good" : el.classList.contains("flagged") ? "click" : "bad");
    });
  });
  t += 180 + specs.length*debrief.acts[1].stepMs + 420;

  // Act 3 — the numbers, and the records lighting up as they are beaten.
  at(t, ()=> acts[2] && acts[2].classList.add("in"));
  const wins = [...host.querySelectorAll(".db-bests li"), ...host.querySelectorAll(".db-mastery li")];
  wins.forEach((el, i)=> at(t + 500 + i*420, ()=>{ el.classList.add("in"); sfx("coin"); }));
  t += 700 + wins.length*420;

  // Act 4 — everything earned, at once, loud.
  at(t, ()=>{
    if(acts[3]) acts[3].classList.add("in");
    sfx("win");
    confetti(debrief.acts[3].held.coins > 6 ? 44 : 20);
  });

  const skip = ()=>{
    debriefTimers.forEach(clearTimeout);
    debriefTimers = [];
    acts.forEach(a => a.classList.add("in"));
    specs.forEach(el => el.classList.add("in"));
    wins.forEach(el => el.classList.add("in"));
    host.removeEventListener("click", onClick, true);
  };
  const onClick = (e)=>{
    if(e.target.closest("button")) return;   // let the real controls work
    skip();
  };
  host.addEventListener("click", onClick, true);
}

function showScoreDetail(c,silent){
  if(!ENC.scores || !FEEDBACK[c]) return;
  document.querySelectorAll(".scorecell[data-cat]").forEach(b=>b.classList.toggle("active", b.dataset.cat===c));
  const fbs=$("fbs"); if(!fbs) return;
  fbs.innerHTML="";
  fbs.appendChild(fbCard(c, !!ENC.scores[c], scoreDetailAnswer, ()=>{
    const link=CARD_LINKS[c];
    toast("Would open Learn Mode: "+link.topic+(link.cardId?(" • "+link.cardId):""));
  }));
  if(!silent){ sfx("click"); fbs.scrollIntoView({behavior:"smooth",block:"nearest"}); }
}

/* ---------- shift summary --------------------------------------------------------------- */
function endShift(){
  SS.shifts++;
  if(guided()){
    awardBadge("trainee");
  }else{
    awardBadge("shift-done");
    if(SHIFT.orderAllOk)awardBadge("order-master");
    if(SHIFT.safetyAllOk)awardBadge("safety-star");
    const avg=Math.round(SHIFT.ratings.reduce((a,b)=>a+b,0)/(SHIFT.ratings.length||1));
    if(avg>SS.bestRating)SS.bestRating=avg;
  }
  saveSS();
  // the loadout does not outlive the shift it was chosen for
  disarmChallenges();
  removePatient(getScene());
  go("summary");
}
function renderSummary(){
  const avg=Math.round(SHIFT.ratings.reduce((a,b)=>a+b,0)/(SHIFT.ratings.length||1));
  const stars = avg>=95?5:avg>=80?4:avg>=65?3:avg>=45?2:1;
  const newBadges=SS.badges.map(b=>BADGE_NAMES[b]||b);
  const teaching = guided();
  const shiftTAT = fmtDuration(Date.now()-(SHIFT.startMs||Date.now()));
  const times=SHIFT.patientTimes||[];
  const avgDrawTAT = fmtDuration(times.length? times.reduce((a,b)=>a+b,0)/times.length : 0);
  panel.innerHTML=`
    <h2>${teaching?"🎓 Lesson complete!":"🏁 Shift complete!"}</h2>
    ${teaching?`<div class="lesson"><span class="lh">You've learned the full shift flow!</span>You walked through verifying patients, choosing tubes, the order of draw, labeling, handling, and professional responses. When you're ready to test yourself, try a scored shift.</div>`
      :`${starHTML(stars)}
    <p class="sub" style="text-align:center">Average rating ${avg}% across ${SHIFT.len} patients.</p>`}
    <div class="tubechips">
      ${teaching?"":`<span class="pill">🪙 +${SHIFT.coins||0} this shift</span>`}
      <span class="pill">⭐ XP ${SS.xp}</span>
      <span class="pill">🪙 ${SS.coins} total</span>
      <span class="pill">🏆 Best ${SS.bestRating}%</span>
      <span class="pill">🔥 Pace: ${difficultyName()}</span>
    </div>
    ${teaching?"":`<div class="req"><b>🕒 Turnaround Time (TAT)</b><br>
      <span class="sub">Shift TAT, clock-in to clock-out: ${shiftTAT}</span><br>
      <span class="sub">Avg per-draw TAT, bedside collection to dispatch: ${avgDrawTAT}</span></div>`}
    <div class="req"><b>Badges</b><br>${newBadges.length?newBadges.map(b=>`<span class="pill">${b}</span>`).join(""):", "}</div>
    ${SHIFT.missed&&SHIFT.missed.length?`<div class="req"><b>📚 Queued for Learn Mode (${SHIFT.missed.length})</b><br><span class="sub">These are the steps you missed this shift, now lined up for review: ${SHIFT.missed.join(", ")}</span></div>`:""}
    <button class="btn" id="again">🔁 Clock in again</button>
    <div class="hint">Designed to merge into the main Phleb Learn app later.</div>
  `;
  $("again").onclick=()=>{ sfx("win"); go("idle"); };
  confetti(70); sfx("win");
}
