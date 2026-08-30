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
import { toast, confetti } from "./notifications.js";
import { shuffle, pick } from "../utils.js";
import { TUBES, HANDLING, CARD_LINKS, BADGE_NAMES } from "../config.js";
import {
  SS, ENC, setEnc, SHIFT, setShift, state, setState, setMode, saveSS,
  MODE, MODES, MODE_NAMES, guided, playMode, reveal,
} from "../game/gameState.js";
import { summaryLine, recordAttempt, recordFor, weakestCategories } from "../game/modeProgress.js";
import { sectionForStep, endsSection, sectionMeasurements, resetFromSection } from "../venipuncture/sections.js";
import { MEASUREMENT_LABELS, CATEGORIES } from "../venipuncture/rubric/policy.js";
import { buildRubricReport } from "../venipuncture/rubric/rubricReport.js";
import { buildReplay } from "../venipuncture/rubric/replay.js";
import { renderPracticalReport, renderRubricSummary } from "./reportView.js";
import { awardBadge, difficultyName, addXP, addCoins, chosenChallenges } from "../game/saveSystem.js";
import { makePatient } from "../game/encounter.js";
import { scoreEncounter, scoreDetailAnswer, FEEDBACK, fmtDuration } from "../game/scoring.js";
import { getRoomLevel, canChooseProcedure, hasUpgrade } from "../game/progression.js";
import {
  STEP_XP, sectionScore, sectionReward, nextStreak, drawReward, SECTION_CLEAN,
} from "../game/rewards.js";
import { PROCEDURE, PROCEDURES, indicatedProcedure } from "../venipuncture/procedure.js";
import { runDialogue, optionStep, teach, says, DOT, pEmoji, showHint } from "../game/dialogue.js";
import { getScene } from "../rendering/scene.js";
import { spawnPatient, removePatient } from "../world/patient.js";
import { resetTubeSelection } from "../world/tubeRack.js";
import { createProcedureState, renderCurrentStep } from "../venipuncture/accessibilityFallback.js";
import { clearAutoAdvance } from "../venipuncture/autoAdvance.js";
import { ensureArmSession, runArrivalRoom } from "../venipuncture/physicalSteps.js";
import { closeBench } from "../bench/benchSession.js";
import { evaluateStaging } from "../venipuncture/staging/stagingRules.js";
import { measureStaging } from "../venipuncture/staging/stagingScoring.js";
import { VP_TIPS, VP_ICON } from "../venipuncture/questions.js";
import { setGuideStep, markStepTaught } from "../venipuncture/stepGuide.js";
import { startComplicationWatch, finishComplications } from "../venipuncture/complications/complicationRuntime.js";
import { assessSpecimens, applySpecimenOutcome } from "../venipuncture/specimen/specimenQuality.js";
import { fbCard } from "./coachLayer.js";
import { buildDebrief, sectionScores } from "../game/debrief.js";
import { normaliseMastery, applyDraw as applyMastery, weakestTrack, TRACKS } from "../game/mastery.js";
import { offerBests } from "../game/personalBests.js";
import { CHALLENGES, scoreChallenges } from "../game/challenges.js";
import { armChallenges, disarmChallenges, armedChallengeIds, lockLoadout, unlockLoadout } from "../game/activeChallenges.js";

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
/**
 * Re-renders the clock-in screen if that is what is showing, and does nothing
 * otherwise. Settings calls it on close: the loadout is chosen there now, and
 * the clock-in screen is where the shift's terms are stated.
 */
export function refreshIdle(){ if(state === "idle") render(); }

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
/* Learn is a short guided walk through every step. Play is a shift: patient
   after patient until you clock out, which is what the last screen of the
   debrief is for. The old Final Practical was one patient because "an examiner
   does not give you five goes at it" — but the report is per DRAW, so a longer
   shift does not dilute it, and stopping a learner after one draw was the game
   ending just as it started being a game. */
const SHIFT_LEN = { [MODES.LEARN]:3, [MODES.PLAY]:6 };

function renderIdle(){
  const line = m => summaryLine(SS.modeProgress, m);
  /* WHICH BUTTON GLOWS IS AN ANSWER TO A QUESTION THE PLAYER IS ASKING.

     Play used to be the pulsing one on every save, including a save that had
     never drawn anything. So the game's own emphasis walked a first-time
     learner into the mode that deliberately says NOTHING — no instruction, no
     hint, no verdict — where a beginner cannot tell a mistake from the design.
     On a save with nothing on it, Learn is the call to action; from the second
     visit onwards it is Play again, which is right for someone who has already
     been taught. */
  const fresh = !SS.shifts && !SS.xp;
  panel.innerHTML=`
    <h2>🩺 Clock in</h2>
    <div class="tubechips">
      <span class="pill">⭐ XP ${SS.xp}</span>
      <span class="pill">🪙 ${SS.coins}</span>
      <span class="pill">🎖️ ${SS.badges.length} badges</span>
      <span class="pill">📋 Shifts ${SS.shifts}</span>
      <span class="pill">🏠 ${getRoomLevel().name}</span>
      ${equipmentPills()}
    </div>

    <button class="btn ${fresh ? "cta-pulse starborder" : "alt"} modecard" id="modeLearn">
      <span class="mc-title">🎓 Learn</span>
      <span class="mc-sub">Talked through, step by step. Replay any section that went badly.</span>
      <span class="mc-stat">${SHIFT_LEN[MODES.LEARN]} patients · ${line(MODES.LEARN)}${fresh ? " · start here" : ""}</span>
    </button>

    <button class="btn ${fresh ? "alt" : "cta-pulse starborder"} modecard" id="modePlay">
      <span class="mc-title">🩸 Play</span>
      <span class="mc-sub">A real shift. Nothing is said until the report.</span>
      <span class="mc-stat">${line(MODES.PLAY)}</span>
    </button>
    <div class="mode-note">${masteryLine()}</div>
    ${SS.weak.length?`<div class="hint">Weak topics queued for Learn: ${SS.weak.length}</div>`:""}
    ${armedChallengesHTML()}
  `;
  blurText(panel.querySelector("h2"));
  $("modeLearn").onclick=()=>{ sfx("win"); startShift(MODES.LEARN); };
  $("modePlay").onclick=()=>{ sfx("win"); startShift(MODES.PLAY); };
}

/* ---------- technique challenges ---------------------------------------------
   The replay axis. Every entry takes something away — the coach, the
   magnetism, the hand you are used to — so the same clinical model produces a
   different game, and a run with two of them on is worth more than either
   alone. See game/challenges.js for why none of them can make a draw easier.

   THE PICKER LIVES IN SETTINGS NOW (ui/settings.js). All that is left here is
   a line saying what is armed, so the clock-in screen states the terms of the
   shift about to start without also being the place they are negotiated. */

/** A quiet line on the clock-in screen, only when something is actually on. */
function armedChallengesHTML(){
  const on = chosenChallenges();
  if(!on.length) return "";
  const mult = on.reduce((m, id) => m*(CHALLENGES.find(c => c.id===id) || {bonus:1}).bonus, 1);
  const names = on.map(id => (CHALLENGES.find(c => c.id===id)||{}).label).filter(Boolean);
  return `<div class="hint chal-armed">⚡ ${names.join(" · ")} <b>×${mult.toFixed(2)}</b>
    <span class="sub">Change these in Settings.</span></div>`;
}

/**
 * What the learner has actually demonstrated, as opposed to how long they
 * have played.
 */
function masteryLine(){
  const m = normaliseMastery(SS.mastery);
  const worst = weakestTrack(m);
  const stars = TRACKS.map(t => `${t.label} ${"★".repeat(m[t.id].stars)}${"☆".repeat(5 - m[t.id].stars)}`);
  /* On a save with no draws behind it every track is at zero, so "weakest
     right now" would pick one arbitrarily and present a tie as a verdict. */
  const anyEarned = TRACKS.some(t => m[t.id].stars > 0);
  const head = !anyEarned
    ? "Nothing recorded yet — every technique starts at zero stars."
    : worst && worst.rec.stars < 5
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

/* =========================================================================
   THE HUD — what replaces the coaching panel in Play.

   Four values, no words, no verdicts, no buttons: who this is, how many tubes
   are done, whichever clock is clinically live right now, and what is
   currently flowing. It shows a value only while that value MEANS something —
   the band clock exists while a band is on and not before, the volume exists
   while a tube is filling — so the strip is a readout of the procedure rather
   than a dashboard of everything the simulation happens to know.

   Everything the coaching panels print in Learn still exists; in Play it is
   held back to the debrief, which is where this game already decided feedback
   belongs.

   No verdict colours here, deliberately. Every judgement in this app is
   expressed as colour and Play withholds judgement, so the HUD is
   monochrome by construction and there is nothing for modes.css to suppress.
   ========================================================================= */
function esc(s){
  return String(s == null ? "" : s)
    .replace(/[&<>"]/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[ch]));
}

function hudHTML(c){
  const p = ENC.p;
  const tubes = c.tubes || [];
  const collected = c.collection
    ? tubes.filter(k => c.collection.tubes[k] && c.collection.tubes[k].removedAt).length
    : 0;
  const pips = tubes.map((k, i) => `<span class="hud-pip${i < collected ? " on" : ""}"></span>`).join("");

  // The one clock that is live. A band that is on is the only thing in a draw
  // with a clinical deadline the learner is expected to be watching.
  const tq = c.tourniquet;
  const bandOn = tq && tq.securedAt && !tq.releasedAt;
  const bandS = bandOn ? Math.floor((Date.now() - tq.securedAt)/1000) : 0;

  const cur = c.collection && c.collection.currentKey;
  const filling = cur && c.collection.tubes[cur];
  const ml = filling && filling.drawnMl > 0 ? filling.drawnMl : null;

  return `<div class="hud" data-live="hud">
    <span class="hud-who">${p ? esc(p.last) + ", " + esc(p.first[0]) + "." : ""}</span>
    ${tubes.length ? `<span class="hud-tubes" title="tubes collected">${pips}<b>${collected}/${tubes.length}</b></span>` : ""}
    ${bandOn ? `<span class="hud-clock">band ${Math.floor(bandS/60)}:${String(bandS%60).padStart(2,"0")}</span>` : ""}
    ${ml != null ? `<span class="hud-vol">${ml.toFixed(1)} mL</span>` : ""}
  </div>`;
}

function startShift(mode){
  /* The loadout goes live BEFORE the first patient is rolled: "Deep vein"
     changes the arm the roll produces, and "Wrong hand" changes the bench it
     is laid out on. This is the ONE transfer point from the chosen loadout to
     the armed one — and the moment the loadout locks, so that opening Settings
     mid-draw cannot change the draw that is already running. */
  armChallenges(chosenChallenges());
  lockLoadout();
  setMode(mode);
  // `tray:null` — a new shift starts at an empty cart, whatever the last one
  // ended with. See venipuncture/staging/trayCarryover.js.
  setShift({len:SHIFT_LEN[MODE]||1,index:0,patients:[],ratings:[],orderAllOk:true,safetyAllOk:true,coins:0,startMs:Date.now(),patientTimes:[],missed:[],tray:null});
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

/* =========================================================================
   THE ARRIVAL ROOM — where the patient is met.

   This used to be a multiple-choice question about the requisition, followed
   by an `introduce` STEP inside the draw that offered thirteen written
   sentences to click. Both are gone, and the reason is the rule
   ARCHITECTURE.md already sets: *if the draw already makes the learner do the
   thing, the screen that asks them about it is deleted, and the score reads
   what they did instead.*

   So there is one room, before the procedure, with a person in it and things
   you can pick up — the requisition, the wristband, the sink, the gloves —
   and no step number attached to any of it. The competency is untouched: two
   identifiers, from the patient's own mouth or their band, before anything is
   collected, and the draw cannot be entered without them.

   venipuncture/physicalSteps.js's runArrivalRoom owns the session and the two
   clocks; this only says where it goes and what happens when it ends.
   ========================================================================= */
function renderReview(){
  const p = ENC.p;
  /* The encounter's procedure state is built HERE now, not on the first frame
     of the draw. The arrival room writes the introduction session into it, and
     the whole point is that the introduction happens before the procedure —
     so the thing that carries it has to exist before the procedure too. */
  const c = ensureProcedureState();
  const greet = pick([
    "Hi, I'm here for my blood draw.",
    "Hello! Ready when you are.",
    "Hi there. I've got my lab order right here.",
    "Morning! Hope this is quick.",
  ]);

  /* The teaching card that used to sit here said the same three things the
     room's own guidance says — ask rather than read, check against the
     requisition, hold a flawed order. It is the body of the room's one
     disclosure now. See venipuncture/stepGuide.js. */
  setGuideStep("introduce");
  panel.innerHTML = `
    <h2>👋 Patient ${SHIFT.index+1} of ${SHIFT.len}</h2>
    ${says(p.first, pEmoji(p), greet, p.mood)}
    <div class="vp-stage" id="arrivalStage" data-reveal="${MODE}"></div>`;

  // The room runs its own frame loop for the hygiene clock, so its cleanup
  // has to go with the encounter's — same slot renderCollect uses.
  releaseStepLease();
  const stop = runArrivalRoom(c, $("arrivalStage"), ()=>{
    releaseStepLease();
    /* `reqChoice` used to be the answer to a quiz. It is now what the learner
       actually DID about a flawed order: held it, or did not. deriveChoices()
       reads it for the score screen's "your answer / best answer" card, which
       therefore contains a decision rather than a guess. */
    markStepTaught("introduce");
    ENC.reqChoice = p.reqIssue ? !!c.reqHeld : !c.reqHeld;
    (ENC.answers = ENC.answers || {}).requisition = {
      your: c.reqHeld ? "Held the draw to clarify the order." : "Read the order and proceeded.",
      correct: p.reqIssue
        ? `${p.reqIssue.catch} Hold and clarify before drawing.`
        : "The order is complete and matches — proceed.",
    };
    afterRequisition();
  });
  ENC._collectCleanup = stop;
}

/**
 * Tears down whatever the current step is holding open, and forgets it.
 *
 * RELEASED AND FORGOTTEN, always both. A step's cleanup is stored in one slot
 * that the next step overwrites, so a cleanup that has been run but not
 * cleared is still reachable — the next screen to reach for the slot calls a
 * teardown a second time on a session that no longer exists. The mirror of
 * that mistake, leaving a lease live because nothing released it, is what let
 * the supply cart swallow every bench gesture aimed at a later step; see
 * main.js's gotoProcedureStep. One helper, so no call site can do half of it.
 */
function releaseStepLease(){
  if(!ENC || !ENC._collectCleanup) return;
  const stop = ENC._collectCleanup;
  ENC._collectCleanup = null;
  try{ stop(); }catch(e){ console.warn("step cleanup failed", e); }
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

/**
 * The encounter's procedure state, built once.
 *
 * The tubes this draw NEEDS come from the requisition. Which tubes the learner
 * actually picks up, and the order they rack them in, is the supply cart's job
 * — it is the one place that question is asked now.
 */
function ensureProcedureState(){
  if(!ENC.collect){
    ENC.collect = createProcedureState(ENC.p.reqSet, { patient: ENC.p, handedness: SS.handedness });
  }
  return ENC.collect;
}

/* ---------- collect: the venipuncture procedure (2D fallback) ------------------ */
function renderCollect(){
  const c = ensureProcedureState();
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
  /* THE TEACHING CARD IS GONE FROM HERE.

     It used to print the step's tip and its "why it matters" above the coach,
     permanently, on every frame of every step — and the coach underneath it
     then said the same thing again as a verdict, again as a next action, and
     again as a how-to paragraph. Four voices, one instruction.

     The same content is now the body of the step's own disclosure (see
     venipuncture/stepGuide.js), which opens itself the first time a learner
     meets a step and is shut after that. Nothing was deleted; it is spent
     once instead of shouted forever. */
  setGuideStep(id);

  /* THE CHROME IS THE MODE.

     Learn gets the heading, the step counter, the progress bar and the tip —
     it is a lesson, and a lesson says where you are in it. Play gets a HUD:
     the patient, the tubes, and whichever clock is clinically live right now.
     No step number, no percentage, no prose. A draw is not seventeen screens
     with a progress bar over them, and a trained phlebotomist counting down
     "step 9 of 16" is being reminded they are in a piece of software.

     It is also what gives the millimetre work its screen back. The panel was
     eating 40% of the viewport, measureObstruction() was dutifully pushing
     the camera back to compensate, and the arm ended up small and far away. */
  panel.innerHTML = r.stepChrome ? `
    <h2>🩸 ${section ? section.label : "Venipuncture"} <span class="vp-count">step ${done+1}/${total}</span></h2>
    <div class="vp-bar"><div class="vp-bar-fill" style="width:${pctDone}%"></div></div>
    <div class="vp-bar-lab"><span>${VP_ICON[id]} ${info.t}</span><span>${pctDone}%</span></div>
    <div class="vp-stage" id="vpStage" data-reveal="${MODE}" data-verdicts="${r.verdicts?1:0}"></div>
    <button class="btn ghost vp-leave" id="vpLeave">Leave this draw</button>`
  : `
    ${hudHTML(c)}
    <div class="vp-stage" id="vpStage" data-reveal="${MODE}" data-verdicts="0"></div>
    <button class="btn ghost vp-leave" id="vpLeave">Leave this draw</button>`;
  panel.dataset.chrome = r.stepChrome ? "full" : "hud";
  const stage=$("vpStage");
  wireLeaveDraw();
  renderCurrentStep(c, stage, {
    rerender: renderCollect,
    onComplete: vpFinish,
    hasMidDrawEvent: ()=> !!(ENC.p.drawEvent && ENC.p.drawEvent.when==="mid" && !ENC.drawEventHandled),
    onMidDrawEvent: (resumeStep)=>{ ENC.drawResumeBeat=resumeStep; go("drawresp"); },
    setCleanup: (fn)=>{ ENC._collectCleanup=fn; },
    onStepFinished: (finishedId, nextId)=>{
      /* Taught on the way OUT, so the disclosure stays open for the whole of
         the first attempt — including the part where the learner is stuck,
         which is when they would actually want it. */
      markStepTaught(finishedId);
      rewardStep(c, finishedId, nextId);
    },
    onCleanup: releaseStepLease,
    /* Learn only. The driver asks; the mode decision lives here.

       AND IT ONLY STOPS FOR WORK THAT IS WORTH STOPPING FOR.

       Every section used to end on a full screen: the measurement cards, a
       "Carry on ▶", and a "↺ Repeat this section". Eleven of them in a draw.
       On a good draw that is eleven modal interruptions telling the learner
       that the thing they just did well went well, each one costing a click,
       and each one offering to replay a section there is no reason to replay.

       The screen exists to offer the replay. Offering it for work that was
       good is the redundancy — so a section at or above the "clean" bar, with
       nothing recorded against it, says so in a line and the draw carries on.
       A section below it stops, exactly as before, which is the only time the
       replay was ever the point. */
    sectionFeedbackFor: (finishedId, nextId)=>{
      if(!reveal().sectionFeedback) return null;
      if(!endsSection(finishedId, nextId)) return null;
      const section = sectionForStep(finishedId);
      const readings = sectionMeasurements(c, section);
      if(!readings.length) return null;
      const score = sectionScore(readings);
      const mistakes = readings.reduce((n, r)=>n + ((r.measurement.mistakes||[]).length), 0);
      if(score >= SECTION_CLEAN && !mistakes && nextId){
        /* Said, not staged. The number is the same one the card would have
           shown, and the draw does not stop to show it.

           The streak goes with it. It has been accumulating in `c.streak`
           since the beginning and was invisible until the debrief, which is
           right for a scored shift — nothing is said there at all — and a
           waste in a lesson, where three clean sections in a row is the
           thing that makes the fourth one feel worth doing well. */
        /* Already incremented: the driver runs onStepFinished (which pays the
           section and advances the streak) before it asks for feedback. */
        const run = c.streak || 0;
        toast(`${section.label} · ${score}/100 ✓${run >= 3 ? `  🔥 ${run} clean in a row` : ""}`);
        return null;
      }
      return { section, readings, done: !nextId, score };
    },
    onSectionFeedback: renderSectionFeedback,
  });
  if(FX.gsap && !SS.reduceMotion){ FX.gsap.from(stage,{opacity:0,y:12,duration:.3,ease:"power2.out"}); }
}
/* ---------- Learn: feedback at the end of each section ----------------------
   Feedback belongs at the end of a piece of TECHNIQUE rather than after every
   screen, and the section is repeatable. Both are the same data the rubric
   will use later — this is the step's own measurement object, shown early,
   not a second opinion invented for a practice loop.

   These two ideas were the whole of the old Practice mode, and they are
   teaching rather than testing, so they live in Learn now. Play shows none of
   it: nothing is said until the report.

   Repeating clears this section AND everything downstream of it, because the
   later sessions are built from the earlier ones: a re-done insertion with a
   stale collection session would draw from a puncture that no longer exists.
   ------------------------------------------------------------------------- */
/* Reached only when a section is worth stopping for — below the clean bar,
   or with something recorded against it, or because the draw has ended. See
   sectionFeedbackFor above. */
function renderSectionFeedback({ section, readings, done, score }){
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
    <h2>🔁 ${section.label}${score!=null?` <span class="vp-count">${score}/100</span>`:""}</h2>
    <p class="sub">${done
      ? "The draw is finished. This is what the last piece of it measured."
      : "This one is worth another look — here is what it measured, and you can do it again."}</p>
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
    releaseStepLease();
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
      releaseStepLease();
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
    clearAutoAdvance();
    releaseStepLease();
    ENC.drawAbandoned=true;
    // capture whatever preparation was done before they walked away
    captureStagingIfUnmeasured();
    finishComplications(ENC.collect);
    runScoreEncounter();
  };
}

/* =========================================================================
   THE DRAW ENDS. THERE IS NO SCREEN FOR IT.

   There used to be: "Draw complete", with the recap chips, the laboratory's
   verdict on every tube, the work-area card, the rubric summary and the
   payout line — and a button to carry on to labelling. Two clicks later the
   debrief said all of it again, better, paced as four acts, which is where
   this game already decided its feedback belongs.

   That is two verdicts on one encounter, the first of them delivered in the
   middle of the job, with the tubes still unlabelled in your hand. The
   comment on the old function said so out loud — "THE REPORT COMES AT THE
   END, NOT HERE" — and then printed the report anyway.

   So this is a function and not a screen now. Everything it COMPUTES is
   untouched and still happens exactly here, at the moment the attempt
   genuinely ended: the complication watch closes, the laboratory looks at the
   specimens, the lump sum is added to what the sections accrued, and the
   rubric grades the attempt. What is gone is the page it printed.

   Where the recap went: the lab is act 2 of the debrief, the technique
   numbers are act 3, the payout is act 4, and the rubric report and the
   per-category tiles are behind the debrief's own breakdown — in BOTH modes
   now, because Learn's copy of the rubric used to live only on this screen.
   ========================================================================= */
function vpFinish(){
  clearAutoAdvance();
  const c=ENC.collect;
  // The draw is over: close the complication watch and let the laboratory
  // look at what came out of it. Both are idempotent — vpFinish() is
  // reachable more than once.
  finishComplications(c);
  if(!c.specimenQuality) applySpecimenOutcome(c, assessSpecimens(c, { orders: ENC.p.orders }));

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
  // Graded HERE, because this is the moment the attempt genuinely ended —
  // before the tubes are labelled and before the patient is answered. Only
  // the reporting of it moved.
  gradeAttempt(c);

  const hasPostDraw = !!ENC.p.drawEvent && ENC.p.drawEvent.when!=="mid" && !ENC.drawEventHandled;
  sfx("good");
  go(hasPostDraw ? "drawresp" : "label");
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

/* =========================================================================
   LABELLING: ONE CHECK, NOT FOUR RUBBER STAMPS.

   This screen used to be four checkboxes — patient name, ID/DOB, date and
   time, your initials — each of which the learner ticked, none of which had a
   wrong answer, and all four of which had to be ticked before the button
   would work. Four clicks with one possible outcome is not a decision; it is
   a form, and a form does not teach the thing this screen exists for.

   What it exists for is the single most consequential error in the whole job:
   a tube that leaves the chair carrying the wrong information. So the label
   is PRINTED now, filled in from the order, and the learner does what they
   would actually do — read it against the patient in front of them and say
   what is wrong with it, if anything.

   One tap. Either you saw it or you did not. A label that goes out wrong goes
   out wrong, and the score reads the label rather than the ticking.

   Routing travels with it, unchanged: labelling at the bedside and deciding
   how the batch travels are the same moment of work, and splitting them cost
   a screen and a click without teaching anything.
   ========================================================================= */

/** Two digits. */
function two(n){ return String(n).padStart(2, "0"); }

/**
 * The label as the printer produced it, and what — if anything — is wrong
 * with it.
 *
 * Rolled once per encounter and kept, because re-rolling it on every
 * re-render would move the error under the learner's finger.
 */
function labelDraft(){
  if(ENC.labelDraft) return ENC.labelDraft;
  const p = ENC.p;
  const now = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  const stamp = d => `${two(d.getMonth()+1)}/${two(d.getDate())}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`;
  const initials = `${(p.first||"A")[0]}${(p.last||"P")[0]}`.toUpperCase();

  /* A label goes out wrong more often than anyone would like, which is why
     checking it is a competency. Rather more than half of them here are
     clean — a screen where something is always wrong teaches "tap the odd
     one out", not "read the label". */
  const FLAWS = [
    { field:"name",     why:`The order is for ${p.name}. This label is somebody else's.` },
    { field:"iddob",    why:"A label with no date of birth is a label with one identifier on it." },
    { field:"datetime", why:"That is yesterday's date — this was pre-labelled, or the clock is wrong. Either way the lab cannot tell when the sample was taken." },
    { field:"initials", why:"Nobody has signed for this collection. The lab cannot ask who drew it." },
  ];
  const flaw = Math.random() < 0.55 ? pick(FLAWS) : null;
  const bad = f => flaw && flaw.field === f;

  ENC.labelDraft = {
    flaw,
    fields: [
      { key:"name",     label:"Patient",  value: bad("name") ? `${p.first} ${p.decoyLast}` : p.name },
      { key:"iddob",    label:"DOB · ID", value: bad("iddob") ? `— · ${p.id}` : `${p.dob} · ${p.id}` },
      { key:"datetime", label:"Collected",value: bad("datetime") ? stamp(yesterday) : stamp(now) },
      { key:"initials", label:"Drawn by", value: bad("initials") ? "—" : initials },
    ],
  };
  return ENC.labelDraft;
}

function renderLabel(){
  const p=ENC.p, ev=p.event;
  const note = ev.type==="label" ? `<div class="fb no"><b>Heads up:</b> ${ev.prompt} ${ev.why}</div>`:"";
  const draft = labelDraft();
  if(!ENC.handlingOptions){
    ENC.handlingOptions = shuffle([
      {key:"routine",t:pick(HANDLING.routine.labels),ok:p.handling==="routine"},
      {key:"chilled",t:pick(HANDLING.chilled.labels),ok:p.handling==="chilled"},
      {key:"light",t:pick(HANDLING.light.labels),ok:p.handling==="light"},
    ]);
  }
  const opts = ENC.handlingOptions;
  const chosen = ENC.handlingChoice;
  const checked = !!ENC.labelChecked;
  const verdict = ENC.labelVerdict || null;

  panel.innerHTML=`
    <h2>🏷️ Label and route</h2>
    ${/* Picked once per patient, not once per render: this screen re-renders
         on every tap, and a coach whose sentence changes each time reads as
         a different coach each time. */
      guided()?says(DOT.name,DOT.emoji,(ENC.labelCoachLine = ENC.labelCoachLine || pick([
        "Read it against the person in front of you, not against what you expect.",
        "Last thing at the bedside: check the label, then decide how they travel.",
        "Never leave the chair with a label you have not read.",
      ])),"your guide"):""}
    ${note}

    <div class="lbl-card${checked ? " done" : ""}">
      <div class="lbl-head">Printed label · ${(ENC.collect && ENC.collect.tubes ? ENC.collect.tubes.length : 1)} tube(s)</div>
      ${draft.fields.map(f=>{
        const isFlaw = !!(draft.flaw && draft.flaw.field === f.key);
        /* Corrected only if it was actually CAUGHT. A line the learner walked
           past still says what it said — the tube went to the lab like that,
           and a label that quietly fixed itself would be the game lying about
           the one thing this screen exists to teach. */
        /* And in a scored shift the card does not mark itself up either:
           "corrected" and a struck-through line are both verdicts. */
        const caught = guided() && checked && isFlaw && verdict && verdict.ok;
        const missed = guided() && checked && isFlaw && !(verdict && verdict.ok);
        return `
        <button class="lbl-row${caught ? " fixed" : ""}${missed ? " missed" : ""}"
                data-field="${f.key}" ${checked ? "disabled" : ""}>
          <span class="lbl-lab">${f.label}</span>
          <span class="lbl-val">${esc(caught ? "corrected" : f.value)}</span>
        </button>`;
      }).join("")}
      <div class="lbl-band">${esc(p.name)} · ${esc(p.dob)} · ${esc(p.id)}<span class="lbl-bandlab">wristband</span></div>
    </div>

    ${checked
      ? /* THE VERDICT IS LEARN'S. A scored shift says nothing here for the
           same reason it says nothing anywhere else: the label went to the
           lab as you sent it, and the debrief is where that is answered. */
        (guided()
          ? `<div class="stg-msg ${verdict && verdict.ok ? "ready" : "block"}">${verdict ? verdict.text : ""}</div>`
          : `<p class="sub lbl-hint">Label printed.</p>`)
      : `<button class="btn alt" id="lblMatch">✓ Everything on it matches — print it</button>
         <p class="sub lbl-hint">…or tap the line that does not match the wristband.</p>`}

    <div class="route-head">📦 How does this batch travel to the lab?</div>
    <div id="routeOpts">${opts.map(o=>`<button class="opt${chosen===o.key?" good":""}" data-route="${o.key}">${o.t}</button>`).join("")}</div>
    ${checked ? `<button class="btn gold" id="print">🖨️ Send to the lab ▶</button>` : ""}
  `;

  /* One decision, made once. `labelFields` is still the four booleans the
     score reads — what changed is that they now describe the LABEL rather
     than describing which boxes got ticked. */
  const settle = (calledField)=>{
    const flaw = draft.flaw;
    const right = flaw ? calledField === flaw.field : calledField === null;
    ENC.labelChecked = true;
    ENC.labelFields = { name:true, iddob:true, datetime:true, initials:true };
    /* Whatever is wrong with the label as it LEAVES: the flaw they walked
       past, or the correct line they "fixed" on a label that had nothing
       wrong with it. Either way one field is not what the patient says. */
    if(!right) ENC.labelFields[flaw ? flaw.field : calledField] = false;
    ENC.labelVerdict = right
      ? { ok:true, text: flaw
          ? `<b>Caught it.</b> ${flaw.why} Corrected before it left the chair.`
          : "<b>Checked and correct.</b> Name, date of birth, collection time and your initials all match." }
      : { ok:false, text: flaw
          ? `<b>That one was fine.</b> ${flaw.why} It went to the lab as printed.`
          : "<b>That line was correct.</b> The whole label matched — and it has been altered on the way out." };
    (ENC.answers=ENC.answers||{}).labeling = {
      your: flaw ? (right ? `Caught the ${flaw.field} on the label` : `Sent a label with the ${flaw.field} wrong`)
                 : (right ? "Checked the label and found nothing wrong" : "Altered a line that was already correct"),
      correct: flaw ? `The ${flaw.field} on this label did not match the patient` : "Every field on this label matched",
    };
    sfx(right ? "good" : "bad");
    renderLabel();
  };

  panel.querySelectorAll("[data-field]").forEach(b=>{
    b.onclick=()=>{ if(!ENC.labelChecked) settle(b.dataset.field); };
  });
  const match = $("lblMatch");
  if(match) match.onclick=()=>settle(null);

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
  const print = $("print");
  if(print) print.onclick=()=>{
    if(!ENC.handlingChoice){ toast("Choose how these specimens travel to the lab."); sfx("bad"); return; }
    sfx("tap");
    if(p.event.type==="respond" && p.eventWhen==="post"){ ENC.respondReturn="score"; go("respond"); }
    else runScoreEncounter();
  };
}

/* =========================================================================
   THE PATIENT SAYS SOMETHING, AND YOU ANSWER. ONE SCREEN.

   This was three, in sequence: a bubble with one line and a "▶ …" button, for
   as many lines as the event had; then the same bubble again with the options
   under it; then the reply and the lesson, with a Continue. Five clicks, on a
   good day, around ONE decision.

   Clicking "▶ …" to hear the second half of a sentence is not pacing, it is a
   turnstile. So the exchange is on screen at once — which is how you would
   actually hear it, because a patient does not pause for your input between
   clauses — the options sit under it, and answering reveals the reply and
   what it taught in place. One decision, one confirmation.
   ========================================================================= */
function renderRespond(){
  const ev=ENC.p.event;
  if(!ENC.convo) ENC.convo={chosen:null};
  const c=ENC.convo;
  const who=ENC.p.first, ava=ev.emoji||"🙂";
  const lines=ev.lines||[ev.prompt||"…"];
  renderExchange({
    head:`<h2>💬 ${who} says…</h2>${guided()?teach("respond"):""}`,
    who, ava, mood: ENC.p.mood, lines, ev, convo: c,
    rerender: renderRespond,
    onChoose:(o)=>{
      ENC.respondChoice=o.ok;
      (ENC.answers=ENC.answers||{}).professional={your:o.t,correct:(ev.options.find(x=>x.ok)||{}).t};
    },
    onDone:()=>{
      ENC.convo=null;
      if(ENC.respondReturn==="collect"){ ENC.preRespondDone=true; go("collect"); }
      else { runScoreEncounter(); }
    },
  });
}

/**
 * One exchange: everything they said, the options, and — once answered — the
 * reply and the lesson, without changing screens.
 *
 * Shared by the two places a patient says something the learner has to
 * answer, because they were the same three-phase machine written twice.
 */
function renderExchange(o){
  const { ev, convo, lines } = o;
  const bubble=(txt,sub)=>`<div class="dlg"><div class="ava${o.dotAva?" dot":""}">${o.ava}</div>
    <div class="bubble"><div class="who">${o.who}${sub?` • ${sub}`:""}</div>${txt}</div></div>`;
  const said = lines.map((l,i)=>bubble(l, i===0 && o.mood ? o.mood : "")).join("");

  if(!convo.chosen){
    panel.innerHTML=`${o.head}${said}
      <p class="sub">${o.prompt || "How do you respond?"}</p><div id="opts"></div>`;
    const box=$("opts");
    shuffle(ev.options).forEach((opt,i)=>{
      const b=document.createElement("button"); b.className="opt"; b.textContent=opt.t;
      b.style.animationDelay=(i*55)+"ms";
      b.onclick=()=>{
        if(guided() && !opt.ok){
          b.classList.add("bad"); sfx("bad");
          showHint(box, (opt.reply?(`They'd react: "${opt.reply}", `):"")+(o.wrongWhy || ev.why || "Try a kinder, safer response."));
          return;
        }
        b.classList.add(opt.ok?"good":"bad"); sfx(opt.ok?"good":"bad");
        if(o.onChoose) o.onChoose(opt);
        convo.chosen=opt;
        setTimeout(o.rerender, 280);
      };
      box.appendChild(b);
    });
    return;
  }

  const chosen = convo.chosen;
  panel.innerHTML=`${o.head}${said}
    <div class="dlg dlg-you"><div class="bubble you"><div class="who">You</div>${esc(chosen.t)}</div></div>
    ${bubble(chosen.reply || (chosen.ok ? "Thank you." : "Hmm, okay."))}
    <div class="learn"><b>📚 You learned:</b> ${ev.learn||ev.why||""}</div>
    <button class="btn" id="exDone">${o.doneLabel || "Continue ▶"}</button>`;
  $("exDone").onclick=()=>{ sfx("tap"); o.onDone(); };
}

/* ---------- draw complication (recognition + high-level response) ------------------
   The same one-screen exchange as renderRespond, for the same reason: this
   one interrupts a needle that is IN a vein, and making the learner click
   "▶ …" twice to hear the end of "I feel a bit funny" while it is in there is
   the worst possible place for a turnstile.
   ---------------------------------------------------------------------------------- */
function renderDrawResp(){
  const ev=ENC.p.drawEvent;
  if(!ev){ return go(ENC.drawResumeBeat!=null?"collect":"label"); }
  if(!ENC.dconvo) ENC.dconvo={chosen:null};
  const patient = ev.who==="patient";
  const resuming = ENC.drawResumeBeat!=null;
  renderExchange({
    head:`<h2>🩺 During the draw…</h2>`,
    who: patient ? ENC.p.first : (ev.who||"⚠️ Heads up"),
    ava: patient ? (ev.emoji||pEmoji(ENC.p)) : (ev.emoji||"⚠️"),
    dotAva: !patient,
    lines: ev.lines||["…"],
    ev, convo: ENC.dconvo,
    prompt: "What do you do?",
    wrongWhy: ev.learn || "Choose the safest response.",
    doneLabel: resuming ? "🩹 Back to the draw ▶" : "🏷️ Continue to labeling ▶",
    rerender: renderDrawResp,
    onChoose:(o)=>{
      ENC.drawChoice=o.ok;
      (ENC.answers=ENC.answers||{}).draw={your:o.t,correct:(ev.options.find(x=>x.ok)||{}).t};
    },
    onDone:()=>{
      ENC.drawEventHandled=true; ENC.dconvo=null;
      if(ENC.drawResumeBeat!=null){
        if(ENC.collect) ENC.collect.step=ENC.drawResumeBeat;
        ENC.drawResumeBeat=null;
        go("collect");
      } else {
        go("label");
      }
    },
  });
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
/**
 * The work-area card, which used to be printed in Learn on the "Draw
 * complete" screen and nowhere else.
 *
 * It is in the debrief's breakdown now, in both modes, because it is the same
 * kind of thing as every other row down there: the measurement, its narrative
 * and what it caught. Nothing here is new — this is the block that screen
 * printed, moved to where the rest of the reference lives.
 */
function stagingBreakdown(sm){
  if(!sm) return "";
  return `
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
    </div>`;
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
  /* THE RUBRIC, IN BOTH MODES. Learn's copy of it used to live on the
     "Draw complete" screen, which no longer exists — and it was never right
     for it to be somewhere else anyway. Play gets the full practical report
     with its replay; Learn gets the compact summary it always had. Both are
     behind the breakdown, because the four acts are the debrief and this is
     the reference underneath it. */
  const practical = !c.report ? ""
    : playMode()
      ? `<h3 class="rep-sec rep-title">📋 Practical report</h3>${renderPracticalReport(c.report, c.replay, { progress: c.progressLine })}`
      : `<h3 class="rep-sec rep-title">📋 Rubric</h3>${renderRubricSummary(c.report)}
         ${c.progressLine ? `<div class="rep-policy">${c.progressLine}</div>` : ""}`;

  /* Stopping a draw is often the right answer, and it really does stop it —
     so the debrief has to say that the specimens below are what was actually
     collected, not what was ordered. It used to say so on the screen that
     went; it belongs here, above the acts, where the verdict is. */
  const haltNote = c.complicationHalt ? `
    <div class="db-halt"><b>You stopped the draw.</b> That was the right call for a
    ${(c.complicationMeasurements && (c.complicationMeasurements.events.find(e=>e.id===c.complicationHalt.id)||{}).label) || "complication"},
    and everything below is built from what was actually collected before it.</div>` : "";

  const lab = debrief.acts[1], tech = debrief.acts[2];
  const lastLabel = SHIFT.index+1 >= SHIFT.len;

  panel.innerHTML = `
    <div class="debrief" id="debrief">
      ${haltNote}
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
        ${stagingBreakdown(c.stagingMeasurements)}
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
  // the loadout does not outlive the shift it was chosen for, and it can be
  // edited again the moment there is no draw for an edit to reach
  disarmChallenges();
  unlockLoadout();
  removePatient(getScene());
  go("summary");
}
function renderSummary(){
  // endShift() never changes the mode, so this is still the shift that just
  // finished — which is the one "Same again" has to reproduce.
  const lastMode = MODE;
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
    <div class="req"><b>Badges</b><br>${newBadges.length?newBadges.map(b=>`<span class="pill">${b}</span>`).join(""):`<span class="sub">None yet — they arrive as you finish shifts cleanly.</span>`}</div>
    ${SHIFT.missed&&SHIFT.missed.length?`<div class="req"><b>📚 Queued for Learn Mode (${SHIFT.missed.length})</b><br><span class="sub">These are the steps you missed this shift, now lined up for review: ${SHIFT.missed.join(", ")}</span></div>`:""}
    ${sameAgainHTML(lastMode)}
    <button class="btn alt" id="again">🚪 Back to clock-in</button>
  `;
  /* The fastest path out of a finished shift is into another one. "Same
     again" keeps the mode AND the loadout, so a player who has just found a
     combination they like never has to reassemble it — and the challenge
     chips are re-armed from the save, not from a stale copy. */
  const same = $("sameAgain");
  if(same) same.onclick = ()=>{ sfx("win"); startShift(lastMode); };
  $("again").onclick=()=>{ sfx("win"); go("idle"); };
  confetti(70); sfx("win");
}

/** The one-click repeat, named after what it will actually give you. */
function sameAgainHTML(mode){
  const label = mode === MODES.LEARN ? "🎓 Another guided shift" : "🩸 Another shift";
  const on = chosenChallenges();
  const note = on.length
    ? `<div class="mode-note">Same loadout: ${on.map(id=>{
        const c = CHALLENGES.find(x=>x.id===id);
        return c ? c.label : id;
      }).join(" · ")}</div>`
    : "";
  return `<button class="btn cta-pulse starborder" id="sameAgain">${label}</button>${note}`;
}
