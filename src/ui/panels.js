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
import { TUBES, TESTS, HANDLING, CARD_LINKS, BADGE_NAMES, VERIFY_CORRECT, VERIFY_WRONG, NICK_CORRECT, NICK_WRONG, ALL_CATCHES } from "../config.js";
import {
  SS, ENC, setEnc, SHIFT, setShift, state, setState, setMode, saveSS,
  MODE, MODES, MODE_NAMES, guided, finalPractical, reveal,
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
import { getRoomLevel } from "../game/progression.js";
import { runDialogue, optionStep, teach, says, DOT, pEmoji, showHint, clearHint } from "../game/dialogue.js";
import { getScene } from "../rendering/scene.js";
import { spawnPatient, removePatient, reactMascot } from "../world/patient.js";
import { tubeMeshes, resetTubeSelection, toggleTubeMesh } from "../world/tubeRack.js";
import { createProcedureState, renderCurrentStep } from "../venipuncture/accessibilityFallback.js";
import { evaluateStaging } from "../venipuncture/staging/stagingRules.js";
import { measureStaging } from "../venipuncture/staging/stagingScoring.js";
import { VP_TIPS, VP_ICON } from "../venipuncture/questions.js";
import { startComplicationWatch, finishComplications } from "../venipuncture/complications/complicationRuntime.js";
import { complicationSummaryHTML } from "../venipuncture/complications/complicationCoach.js";
import { assessSpecimens, applySpecimenOutcome } from "../venipuncture/specimen/specimenQuality.js";
import { fbCard } from "./coachLayer.js";

/* ---------- top bar + panel entrance -------------------------------------- */
export function syncTop(){
  countUp($("tXp"),SS.xp,{pop:true}); countUp($("tCoins"),SS.coins,{pop:true});
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
function renderStep(){
  if(state==="idle")        return renderIdle();
  if(state==="arrive")      return renderArrive();
  if(state==="verify")      return renderVerify();
  if(state==="review")      return renderReview();
  if(state==="select")      return renderSelect();
  if(state==="order")       return renderOrder();
  if(state==="site")        return renderSite();
  if(state==="collect")     return renderCollect();
  if(state==="drawresp")    return renderDrawResp();
  if(state==="label")       return renderLabel();
  if(state==="handle")      return renderHandle();
  if(state==="respond")     return renderRespond();
  if(state==="score")       return renderScore();
  if(state==="summary")     return renderSummary();
}

/* ---------- idle / clock in ------------------------------------------------ */
// Shift length per mode: Learn is a short guided walk, Practice is long
// enough to repeat what went badly, the Final Practical is one assessed
// attempt — an examiner does not give you five goes at it.
const SHIFT_LEN = { [MODES.LEARN]:3, [MODES.PRACTICE]:4, [MODES.FINAL]:1 };

function renderIdle(){
  const line = m => summaryLine(SS.modeProgress, m);
  panel.innerHTML=`
    <h2>🩺 Clock in</h2>
    <p class="sub">Three ways to work. <b>Learn</b> talks you through every step. <b>Practice</b> stays quiet until the end of each section, then lets you replay it. The <b>Final Practical</b> says nothing at all until the report.</p>
    <div class="tubechips">
      <span class="pill">⭐ XP ${SS.xp}</span>
      <span class="pill">🪙 ${SS.coins}</span>
      <span class="pill">🎖️ ${SS.badges.length} badges</span>
      <span class="pill">📋 Shifts ${SS.shifts}</span>
      <span class="pill">🏠 ${getRoomLevel().name}</span>
    </div>
    <button class="btn alt cta-pulse starborder" id="modeLearn">🎓 Learn (guided, ${SHIFT_LEN[MODES.LEARN]} patients)</button>
    <div class="mode-note">${line(MODES.LEARN)}</div>
    <button class="btn alt" id="modePractice">🔁 Practice (${SHIFT_LEN[MODES.PRACTICE]} patients, feedback per section)</button>
    <div class="mode-note">${line(MODES.PRACTICE)}</div>
    <button class="btn cta-pulse starborder" id="modeFinal">📋 Final Practical (1 patient, full rubric report)</button>
    <div class="mode-note">${line(MODES.FINAL)}</div>
    ${SS.weak.length?`<div class="hint">Weak topics queued for Learn Mode: ${SS.weak.length}</div>`:""}
  `;
  blurText(panel.querySelector("h2"));
  $("modeLearn").onclick=()=>{ sfx("win"); startShift(MODES.LEARN); };
  $("modePractice").onclick=()=>{ sfx("win"); startShift(MODES.PRACTICE); };
  $("modeFinal").onclick=()=>{ sfx("win"); startShift(MODES.FINAL); };
}
function startShift(mode){
  setMode(mode);
  setShift({len:SHIFT_LEN[MODE]||1,index:0,patients:[],ratings:[],orderAllOk:true,safetyAllOk:true,coins:0,startMs:Date.now(),patientTimes:[],missed:[]});
  nextPatient();
}
function nextPatient(){
  if(SHIFT.index>=SHIFT.len){ return endShift(); }
  const p=makePatient(); SHIFT.patients.push(p);
  setEnc({p, selected:[], ordered:[], idChoice:null, labelFields:{name:false,iddob:false,datetime:false,initials:false},
       handlingChoice:null, respondChoice:null, scores:{}, startedAt:Date.now()});
  spawnPatient(getScene(), p);
  resetTubeSelection();
  go("arrive");
}

/* ---------- arrive ---------------------------------------------------------- */
function renderArrive(){
  const p=ENC.p;
  const greet=pick(["Hi, I'm here for my blood draw.","Hello! Ready when you are.","Hi there. I've got my lab order right here.","Morning! Hope this is quick."]);
  panel.innerHTML=`
    <h2>👋 Patient ${SHIFT.index+1} of ${SHIFT.len}</h2>
    ${guided()&&SHIFT.index===0?teach("arrive"):""}
    ${says(p.first,pEmoji(p),greet,p.mood)}
    <button class="btn" id="greet">🙋 Greet & begin</button>
  `;
  $("greet").onclick=()=>{ sfx("tap"); go("verify"); };
}

/* ---------- verify identity -------------------------------------------------- */
function renderVerify(){
  const p=ENC.p, ev=p.event;
  const nickname = ev.type==="verify" && ev.nickname;
  const nick = p.first[0]==='A'?'AJ':p.first.slice(0,3);
  const lines = nickname
    ? ["Hi!", `Oh, my name? Just call me "${nick}".`]
    : [`Hi, I'm ${p.name}.`, "Here for my labs."];
  const options = nickname
    ? [{t:pick(NICK_CORRECT),ok:true,reply:`Oh, of course, ${p.name}, born ${p.dob}.`},
       ...shuffle(NICK_WRONG).slice(0,2).map(t=>({t,ok:false,reply:"Are you sure a nickname is enough to go on?"}))]
    : [{t:pick(VERIFY_CORRECT),ok:true,reply:`That's me, ${p.name}, ${p.dob}.`},
       ...shuffle(VERIFY_WRONG).slice(0,2).map(t=>({t,ok:false,reply:"Wait, shouldn't you double-check that?"}))];
  runDialogue("verify",{
    head:`<h2>🪪 Verify identity</h2>${teach("verify")}`,
    extra:`<div class="req">Requisition: <b>${p.name}</b> &nbsp;•&nbsp; DOB <b>${p.dob}</b> &nbsp;•&nbsp; ID <b>${p.id}</b></div>`,
    who:p.first, emoji:pEmoji(p), sub:p.mood,
    lines, prompt:"How do you confirm who they are?", options,
    learn:"Match two identifiers, full name and date of birth, against the requisition. Never use the room, chair, or a nickname.",
    teachWhy:"Match name and DOB against the requisition.",
    rerender: renderVerify,
    onDone:(o)=>{ ENC.idChoice=o.ok; (ENC.answers=ENC.answers||{}).patientId={your:o.t,correct:(options.find(x=>x.ok)||{}).t}; go("review"); }
  });
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
      head:`<h2>🖥️ Check the requisition</h2>${teach("review")}`,
      extra:reqCardHTML(p),
      who:DOT.name, emoji:DOT.emoji, sub:"your guide",
      lines:[pick(["Before we touch a tube, give the order a good scan.","Quick check of the requisition first. Anything off?","Let's read the whole order before we draw."])],
      prompt:"Is this requisition ready to use?", options,
      learn, teachWhy:"If something's missing or doesn't match, hold and clarify.",
      rerender: renderReview,
      onDone:(o)=>{ ENC.reqChoice=o.ok; (ENC.answers=ENC.answers||{}).requisition={your:o.t,correct:(options.find(x=>x.ok)||{}).t}; go("select"); }
    });
  }else{
    panel.innerHTML=`<h2>🖥️ Check the requisition</h2>${reqCardHTML(p)}
      <p class="sub">${pick(["Anything missing or mismatched before you draw?","Scan it, is it ready to use?","Is the order complete and matching?"])}</p>
      <div id="opts"></div>`;
    optionStep(options,(o)=>{ ENC.reqChoice=o.ok; (ENC.answers=ENC.answers||{}).requisition={your:o.t,correct:(options.find(x=>x.ok)||{}).t}; go("select"); }, "If something's missing or doesn't match, hold and clarify before drawing.");
  }
}

/* ---------- select tubes (3D clickable) -------------------------------------- */
export function onTubePicked(tubeMeshObj){
  const key=tubeMeshObj.userData.tubeKey;
  const selected=toggleTubeMesh(tubeMeshObj);
  if(selected){ if(!ENC.selected.includes(key))ENC.selected.push(key); }
  else ENC.selected=ENC.selected.filter(k=>k!==key);
  sfx("click"); renderSelect();
}
function renderSelect(){
  const p=ENC.p;
  const hint = guided()
    ? `<div class="lesson"><span class="lh">Which tube for each test?</span>${p.orders.map(o=>`${o} → <b>${TUBES[TESTS[o].tube].name}</b>`).join("<br>")}</div>`
    : "";
  panel.innerHTML=`
    <h2>🧪 Select the tubes</h2>
    ${teach("select")}
    ${guided()?says(DOT.name,DOT.emoji,pick(["Order checks out, grab the tubes it needs off the rack.","Now the fun part. Tap the right tubes on the rack, exactly what's ordered.","Tube time! Pick what this order calls for, nothing extra."]),"your guide"):""}
    <div class="req">Order: ${p.orders.map(o=>`<span class="pill">${o}</span>`).join("")}</div>
    ${hint}
    <div class="tubechips" id="selChips">${
      ENC.selected.length? ENC.selected.map(k=>`<span class="tubechip"><i style="background:#${TUBES[k].color.toString(16).padStart(6,'0')}"></i>${TUBES[k].name}</span>`).join("")
      : `<span class="sub">No tubes selected yet, click the rack.</span>`
    }</div>
    <button class="btn ${ENC.selected.length?'':'ghost'}" id="confirmTubes">Confirm tubes ▶</button>
    <div class="hint">Tip: tap a tube again to put it back.</div>
  `;
  $("confirmTubes").onclick=()=>{
    if(!ENC.selected.length){toast("Pick at least one tube from the rack.");return;}
    if(guided()){
      const sel=[...ENC.selected].sort(), req=[...p.reqSet].sort();
      if(!arraysEqual(sel,req)){
        const missing=req.filter(k=>!sel.includes(k)).map(k=>TUBES[k].name);
        const extra=sel.filter(k=>!req.includes(k)).map(k=>TUBES[k].name);
        let msg="Not quite. ";
        if(missing.length)msg+="Still need: "+missing.join(", ")+". ";
        if(extra.length)msg+="Remove: "+extra.join(", ")+".";
        toast(msg.trim()); sfx("bad"); return;
      }
    }
    sfx("tap");
    if(ENC.selected.length>=2){ ENC.ordered=[]; go("order"); }
    else { ENC.ordered=ENC.selected.slice(); ENC.p.site?go("site"):enterDraw(); }
  };
}

/* ---------- order of draw ----------------------------------------------------- */
function renderOrder(){
  const remaining=ENC.selected.filter(k=>!ENC.ordered.includes(k));
  const correctSeq=[...ENC.selected].sort((a,b)=>TUBES[a].order-TUBES[b].order);
  const nextCorrect=correctSeq[ENC.ordered.length];
  panel.innerHTML=`
    <h2>🔢 Order of draw</h2>
    ${teach("order")}
    ${ENC.ordered.length===0&&guided()?says(DOT.name,DOT.emoji,pick(["Nice picks! Now line them up in the order of draw.","Two or more tubes, they go in a set order. Build it.","Order matters here. Tap them in the right sequence."]),"your guide"):""}
    <div class="req"><b>Your order so far:</b><br>${
      ENC.ordered.length? ENC.ordered.map((k,i)=>`<span class="pill">${i+1}. ${TUBES[k].name}</span>`).join("") : `<span class="sub">, none yet, </span>`
    }</div>
    <div id="opts"></div>
    ${ENC.ordered.length?`<button class="btn ghost" id="resetOrder">↺ Reset order</button>`:""}
    ${remaining.length===0?`<button class="btn" id="confirmOrder">Confirm order ▶</button>`:""}
  `;
  const optsBox=$("opts");
  remaining.forEach(k=>{
    const b=document.createElement("button"); b.className="opt";
    b.innerHTML=`<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#${TUBES[k].color.toString(16).padStart(6,'0')};margin-right:8px;vertical-align:middle"></span>${TUBES[k].name}`;
    b.onclick=()=>{
      if(guided() && k!==nextCorrect){
        sfx("bad"); showHint(optsBox, `In the order of draw, <b>${TUBES[nextCorrect].name}</b> comes next.`); return;
      }
      ENC.ordered.push(k); sfx("click"); renderOrder();
    };
    optsBox.appendChild(b);
  });
  if($("resetOrder"))$("resetOrder").onclick=()=>{ENC.ordered=[];sfx("tap");renderOrder();};
  if($("confirmOrder"))$("confirmOrder").onclick=()=>{sfx("tap");ENC.p.site?go("site"):enterDraw();};
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
  if(!ENC.collect){ ENC.collect = createProcedureState(ENC.selected, { patient: ENC.p, handedness: SS.handedness }); }
  const c=ENC.collect;
  // A complication the learner answered by stopping really did stop the
  // draw: there is no next step to render, and the report is built from what
  // was actually collected before it.
  if(c.complicationHalt){ return vpFinish(); }
  if(c.step>=c.steps.length){ return vpFinish(); }
  watchComplications(c);
  const id=c.steps[c.step];
  const info=VP_TIPS[id];
  const done=c.step, total=c.steps.length;
  const dots=c.steps.map((s,i)=>`<span class="vp-pip ${i<done?'done':i===done?'now':''}" title="${VP_TIPS[s].t}">${VP_ICON[s]}</span>`).join("");
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
    <h2>🩸 Venipuncture <span class="vp-count">step ${done+1}/${total}</span></h2>
    <div class="vp-progress">${dots}</div>
    ${lesson}
    <div class="vp-stage" id="vpStage" data-reveal="${MODE}" data-verdicts="${r.verdicts?1:0}"></div>
    <button class="btn ghost vp-leave" id="vpLeave">Leave this draw</button>`;
  const stage=$("vpStage");
  wireLeaveDraw();
  renderCurrentStep(c, stage, {
    rerender: renderCollect,
    onComplete: vpFinish,
    hasMidDrawEvent: ()=> !!(ENC.p.drawEvent && ENC.p.drawEvent.when==="mid" && !ENC.drawEventHandled),
    onMidDrawEvent: (resumeStep)=>{ ENC.drawResumeBeat=resumeStep; go("drawresp"); },
    setCleanup: (fn)=>{ ENC._collectCleanup=fn; },
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
  // The draw is over: close the complication watch and let the laboratory
  // look at what came out of it. Both are idempotent — vpFinish() is
  // reachable more than once.
  finishComplications(c);
  if(!c.specimenQuality) applySpecimenOutcome(c, assessSpecimens(c, { orders: ENC.p.orders }));
  const chips = recapChips(c);
  const items=[["gatherOk","Supplies gathered"],["veinOk","Vein selected"],["cleanOk","Site cleaned"],["assembleOk","Needle assembled"],["uncapOk","Uncapped"],
    ["insertOk","Clean insertion"],["fillGood","Filled to line"],["tqGood","Tourniquet timing"],["tubeOrderOk","Order of draw"],
    ["pressureOk","Pressure held"],["disposeOk","Sharps disposed"],["mixOk","Tubes inverted"]];
  const got=items.filter(([k])=>c[k]);
  const bonus=Math.max(2, got.length*1);
  if(!c.awarded){ addXP(bonus*2); addCoins(bonus); c.awarded=true; saveSS(); syncTop();
    floatXP("+"+(bonus*2)+" XP"); if(got.length>=9){ sfx("win"); confetti(40); } else sfx("coin"); }
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
  const body = finalPractical()
    ? `${haltNote}${renderPracticalReport(report, replay, { progress: progressLine })}${labReceivingHTML(c.specimenQuality)}`
    : `${haltNote}
       <div class="fb"><b>Nicely done.</b> +${bonus*2} XP · +${bonus} 🪙 for a smooth, safe collection.</div>
       ${stagingBlock}
       <div class="vp-scorewrap">${chips.map(ch=>`<span class="vp-chip ${ch.ok?'ok':'mid'}">${ch.ok?'✓':'•'} ${ch.label}${ch.value?` <b>${ch.value}</b>`:""}</span>`).join("")}</div>
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

/* ---------- labeling ------------------------------------------------------------ */
function renderLabel(){
  const ev=ENC.p.event;
  const note = ev.type==="label" ? `<div class="fb no"><b>Heads up:</b> ${ev.prompt} ${ev.why}</div>`:"";
  const f=ENC.labelFields;
  panel.innerHTML=`
    <h2>🏷️ Label the tubes</h2>
    ${teach("label")}
    ${guided()?says(DOT.name,DOT.emoji,pick(["Label right here at the chair, before we go anywhere.","Last thing at the bedside: label every tube fully.","Don't leave the chair unlabeled! Check each field."]),"your guide"):""}
    ${note}
    <div id="fields">
      ${labelRow("name","Patient full name",f.name)}
      ${labelRow("iddob","ID number / DOB",f.iddob)}
      ${labelRow("datetime","Date & time of collection",f.datetime)}
      ${labelRow("initials","Your (phlebotomist) initials",f.initials)}
    </div>
    <button class="btn gold" id="print">🖨️ Print & apply labels</button>
  `;
  ["name","iddob","datetime","initials"].forEach(k=>{
    $("lr-"+k).onclick=()=>{ ENC.labelFields[k]=!ENC.labelFields[k]; sfx("click"); renderLabel(); };
  });
  $("print").onclick=()=>{
    if(guided()){
      const f2=ENC.labelFields, miss=[];
      if(!f2.name)miss.push("full name"); if(!f2.iddob)miss.push("ID/DOB");
      if(!f2.datetime)miss.push("date & time"); if(!f2.initials)miss.push("your initials");
      if(miss.length){ toast("A complete label still needs: "+miss.join(", ")+"."); sfx("bad"); return; }
    }
    sfx("tap"); go("handle");
  };
}
function labelRow(k,label,on){return `<div class="chk ${on?'on':''}" id="lr-${k}"><div class="box">${on?'✓':''}</div>${label}</div>`;}

/* ---------- handling / transport -------------------------------------------------- */
function renderHandle(){
  const p=ENC.p;
  const opts=[
    {key:"routine",t:pick(HANDLING.routine.labels),ok:p.handling==="routine",reply:p.handling==="routine"?"Room temp, deliver soon, perfect.":"Hmm, these don't need that."},
    {key:"chilled",t:pick(HANDLING.chilled.labels),ok:p.handling==="chilled",reply:p.handling==="chilled"?"On ice it goes. Nice.":"Hmm, these don't need that."},
    {key:"light",t:pick(HANDLING.light.labels),ok:p.handling==="light",reply:p.handling==="light"?"Keep it covered, good call.":"Hmm, these don't need that."}
  ];
  const proceed=(o)=>{ ENC.handlingChoice=o.key; (ENC.answers=ENC.answers||{}).handling={your:o.t,correct:(opts.find(x=>x.ok)||{}).t}; if(ENC.p.event.type==="respond" && ENC.p.eventWhen==="post"){ ENC.respondReturn="score"; go("respond"); } else { runScoreEncounter(); } };
  if(guided()){
    runDialogue("handle",{
      head:`<h2>📦 Specimen handling</h2>${teach("handle")}`,
      who:DOT.name, emoji:DOT.emoji, sub:"your guide",
      lines:[pick(["Filled and labeled, how do these travel to the lab?","Transport time. What does this batch need?","Last call: how should these get to the lab?"])],
      prompt:"Choose the handling.", options:opts,
      learn:HANDLING[p.handling].why, teachWhy:HANDLING[p.handling].why,
      rerender: renderHandle,
      onDone:proceed
    });
  }else{
    panel.innerHTML=`<h2>📦 Specimen handling</h2>
      <p class="sub">${pick(["How should these travel to the lab?","Pick the right transport for this batch.","Choose handling for these specimens."])}</p>
      <div id="opts"></div>`;
    optionStep(opts,proceed,HANDLING[p.handling].why);
  }
}

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
function renderScore(){
  const s=ENC.scores, cats=Object.keys(s);
  const correct=cats.filter(c=>s[c]).length, pct=Math.round(correct/cats.length*100);
  const stars = pct>=95?5:pct>=80?4:pct>=65?3:pct>=45?2:1;
  const teaching = guided();
  const timeStr = fmtDuration(ENC.elapsedMs);
  panel.innerHTML=`
    <h2>${teaching?"🎓 Lesson complete":"📊 Encounter score"}, ${ENC.p.name}</h2>
    ${teaching?`<div class="lesson"><span class="lh">Nicely done!</span>You completed every step correctly. Here's a recap of what each step protects.</div>`:`${starHTML(stars)}
    <div class="sub" style="text-align:center">${correct}/${cats.length} correct • ${pct}%</div>`}
    <div class="tubechips" style="justify-content:center"><span class="pill">🪙 +${ENC.coinsEarned||0} coins</span><span class="pill">⏱️ Patient time: ${timeStr}</span>${ENC.coinBreakdown&&ENC.coinBreakdown.speed?`<span class="pill">⚡ Speed +${ENC.coinBreakdown.speed}</span>`:""}${ENC.upgradeBonus&&ENC.upgradeBonus.coins?`<span class="pill">🏠 Upgrade +${ENC.upgradeBonus.coins} 🪙</span>`:""}</div>
    ${ENC.coinBreakdown?`<div class="detailhint" style="margin-top:-2px">Score +${ENC.coinBreakdown.score}${ENC.coinBreakdown.speed?` · Speed +${ENC.coinBreakdown.speed}`:""}${ENC.coinBreakdown.perfect?` · Perfect +${ENC.coinBreakdown.perfect}`:""}${ENC.coinBreakdown.upgrade?` · Upgrades +${ENC.coinBreakdown.upgrade}`:""} &nbsp;•&nbsp; pace: ${ENC.coinBreakdown.diff}</div>`:""}
    <div class="detailhint">Tap any green or red score tile for the encounter details, your answer, and the quick lesson.</div>
    <div class="scoregrid">
      ${cats.map((c,i)=>`<button type="button" class="scorecell ${s[c]?'ok':'no'}" data-cat="${c}" style="animation-delay:${i*60}ms"><div class="lab">${FEEDBACK[c].label}</div>${s[c]?'✓ Good':'✗ Review'}<span class="more">Tap for details</span></button>`).join("")}
    </div>
    <div id="fbs"></div>
    <button class="btn" id="cont">${SHIFT.index+1>=SHIFT.len?(teaching?'🎓 Finish lesson':'🏁 Finish shift'):'➡️ Next patient'}</button>
  `;
  // Bug fix (regression from the Phase 0 ESM migration): these buttons used to
  // be wired via an inline onclick="showScoreDetail(...)" HTML attribute, which
  // silently breaks under module scope (top-level module functions are not
  // implicitly global). Wired the same way as every other button in this file.
  panel.querySelectorAll(".scorecell[data-cat]").forEach(b=>{
    b.onclick=()=>showScoreDetail(b.dataset.cat);
  });
  if(!teaching && pct===100){ confetti(50); floatXP("Perfect! ✨"); sfx("win"); }
  else if(!teaching && pct>=80){ confetti(24); }
  const missed=cats.filter(c=>!s[c]);
  // If the learner walked away mid-draw or prepared badly, the staging report
  // is the most useful tile to land on — it's the one they were never shown
  // during a scored shift.
  const sm = ENC.collect && ENC.collect.stagingMeasurements;
  const openFirst = (sm && !sm.ready) ? "supplyStaging" : (missed[0]||cats[0]);
  showScoreDetail(openFirst, true);
  $("cont").onclick=()=>{ sfx("tap"); SHIFT.index++; removePatient(getScene()); nextPatient(); };
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
