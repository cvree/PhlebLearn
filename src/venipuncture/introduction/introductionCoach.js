/* =========================================================================
   INTRODUCTION COACH — the DOM layer for the one step that is conducted in
   speech rather than in objects.

   NOTE ON THE FIVE-FILE PATTERN. Every other step has a `*Runtime.js`
   because it has a scene: a band on a limb, a needle at a bench, tubes on a
   rack. This one has none — what the learner manipulates is a conversation
   and a sink, and there is no third-person view of that to raycast against.
   So this branch ships four files, not five, and the interaction lives here.
   The rule that matters is unchanged: every technique is a pure helper in
   `introductionState.js`, and this file only calls it.

   Full re-renders are gated on a structural signature; the hand-hygiene
   clock, which ticks every frame, is patched through `[data-live]` instead —
   otherwise a held button is destroyed underneath the hand holding it.
   ========================================================================= */
import {
  ACT, ACT_DEFS, nextAction, nextIssue,
  HYGIENE_GOOD_S, DRY_MIN_S, REQUIRED_IDENTIFIERS, identifiersObtained,
} from "./introductionRules.js";
import { stepGuideHTML, stepHintHTML } from "../stepGuide.js";

function esc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }

/* The interview, grouped the way it is actually conducted. Leading variants
   sit beside their open counterparts on purpose: the learner has to choose,
   and choosing wrongly has to be as easy as choosing rightly or the step
   teaches nothing. */
const GROUPS = [
  { title:"Say hello", acts:[ACT.GREET] },
  { title:"Establish who this is", acts:[
    ACT.ASK_NAME_OPEN, ACT.ASK_NAME_LEADING,
    ACT.ASK_DOB_OPEN, ACT.ASK_DOB_LEADING,
    ACT.CHECK_WRISTBAND,
  ] },
  { title:"Set them up", acts:[ACT.CONFIRM_ORDER, ACT.EXPLAIN, ACT.ASK_ALLERGIES, ACT.ASK_FAINTING, ACT.POSITION] },
  { title:"Prepare yourself", acts:[ACT.GLOVE] },
  { title:"Other things you could do", acts:[ACT.TOUCH_PHONE, ACT.TOUCH_DOOR] },
];

function transcriptHTML(state){
  if(!state.transcript.length){
    return `<p class="intro-empty">Nothing has been said yet.</p>`;
  }
  return `<ol class="intro-script">${state.transcript.slice(-8).map(t=>`
    <li>
      <span class="intro-you">${esc(t.said)}</span>
      ${t.reply ? `<span class="intro-them">${esc(t.reply)}</span>` : ""}
    </li>`).join("")}</ol>`;
}

function idHTML(state){
  const ids = identifiersObtained(state);
  return `<div class="asm-row">
      <span class="asm-lab">Identifiers</span>
      <span class="asm-val ${ids.length >= REQUIRED_IDENTIFIERS ? "good" : "bad"}" data-live="ids">${ids.length}/${REQUIRED_IDENTIFIERS}${ids.length?` (${ids.join(", ")})`:""}</span>
    </div>
    ${state.leadingAsks ? `<div class="asm-row">
      <span class="asm-lab">Read out for them</span>
      <span class="asm-val bad" data-live="leading">${state.leadingAsks}</span>
    </div>` : ""}
    <div class="asm-row">
      <span class="asm-lab">Hand hygiene</span>
      <span class="asm-val ${state.hygieneSeconds >= HYGIENE_GOOD_S ? "good" : (state.hygieneSeconds > 0 ? "wait" : "bad")}" data-live="hygiene">${Math.round(state.hygieneSeconds)}s</span>
    </div>
    <div class="asm-row">
      <span class="asm-lab">Hands dry</span>
      <span class="asm-val ${state.dryingSeconds >= DRY_MIN_S ? "good" : "wait"}" data-live="drying">${state.gloved ? (state.dryingSeconds >= DRY_MIN_S ? "yes" : "no") : `${Math.round(state.dryingSeconds)}s`}</span>
    </div>
    <div class="asm-row">
      <span class="asm-lab">Gloves</span>
      <span class="asm-val ${state.gloved && !state.gloveContaminated ? "good" : (state.gloveContaminated ? "bad" : "wait")}" data-live="gloves">${
        state.gloveContaminated ? `contaminated (${esc(state.contaminatedBy)})` : (state.gloved ? `${state.gloveMaterial} on` : `${state.gloveMaterial}, off`)
      }</span>
    </div>`;
}

function actsHTML(state){
  return GROUPS.map(g=>`<fieldset class="intro-group">
    <legend>${esc(g.title)}</legend>
    <div class="asm-actions">
      ${g.acts.map(id=>{
        const def = ACT_DEFS.find(a=>a.id === id);
        if(!def) return "";
        const used = state.done[id] ? " used" : "";
        return `<button class="stg-mini${used}" data-intro="${id}">${esc(def.label)}</button>`;
      }).join("")}
    </div>
  </fieldset>`).join("");
}

function handsHTML(state){
  return `<fieldset class="intro-group">
    <legend>At the sink</legend>
    <div class="asm-actions">
      <button class="stg-mini" id="introRub" data-hold="1">Hold to rub your hands</button>
      <button class="stg-mini" data-intro-scrub="5">Rub for 5 seconds</button>
      <button class="stg-mini" data-intro-scrub="20">Rub for a full 20 seconds</button>
      <button class="stg-mini" data-intro-glovemat="${state.gloveMaterial === "latex" ? "nitrile" : "latex"}">
        Switch to ${state.gloveMaterial === "latex" ? "nitrile" : "latex"} gloves
      </button>
      ${state.gloveContaminated ? `<button class="stg-mini" id="introReglove">Change to fresh gloves</button>` : ""}
    </div>
  </fieldset>`;
}

export function renderIntroductionCoach(host, o){
  const { state, result } = o;
  const guided = !!o.guided;
  const issue = nextIssue(result);
  const ready = result.ready;

  const signature = [
    guided, ready, state.transcript.length, state.gloved, state.gloveContaminated,
    state.gloveMaterial, state.positioned, identifiersObtained(state).join(","),
    o.hint || "-", issue ? issue.code : "-",
  ].join("|");

  if(host.dataset.introSig === signature){ patchLive(host, state); return; }
  host.dataset.introSig = signature;

  host.innerHTML = `
    <div class="asm-coach intro-coach">
      <div class="stg-topline">
        <span class="stg-mode">Meet the patient</span>
      </div>

      <div class="intro-convo">${transcriptHTML(state)}</div>

      <div class="asm-panel">${idHTML(state)}</div>

      ${guided
        ? stepGuideHTML({
            id: "introduce",
            ready,
            tone: ready ? "ready" : (issue && issue.severity === "block" ? "block" : "warn"),
            lead: ready ? "Identified, informed and gloved."
                        : (issue ? (issue.severity === "block" ? "Not yet." : "Worth fixing.") : ""),
            line: ready
              ? "You know who this is, they know what is about to happen, and your hands are clean."
              : (issue ? issue.message : nextAction(state)),
          })
        : stepHintHTML(o.hint, ready)}

      ${actsHTML(state)}
      ${handsHTML(state)}

      ${/* Meeting a patient is one of the two steps that ends on a judgement
           rather than an action, so this button is real in both modes. What
           went is its disabled state: a full-width bar reading "Not ready
           yet" is not a control, and the guidance line above already says
           exactly which identifier is missing. */
        (o.gate && !ready) ? "" : `
        <button class="btn vp-tap${guided ? "" : " quiet"}" id="introReady">
          ${guided ? "Ready — prepare your tray ▶" : "Carry on ▶"}
        </button>`}
    </div>`;

  const h = o.handlers || {};
  host.querySelectorAll("[data-intro]").forEach(b=>{
    b.onclick = ()=>h.onAct && h.onAct(b.dataset.intro);
  });
  host.querySelectorAll("[data-intro-scrub]").forEach(b=>{
    b.onclick = ()=>h.onScrub && h.onScrub(Number(b.dataset.introScrub));
  });
  host.querySelectorAll("[data-intro-glovemat]").forEach(b=>{
    b.onclick = ()=>h.onGloveMaterial && h.onGloveMaterial(b.dataset.introGlovemat);
  });
  const rub = host.querySelector("#introRub");
  if(rub && h.onRubStart){
    rub.onpointerdown = (e)=>{ e.preventDefault(); rub.setPointerCapture && rub.setPointerCapture(e.pointerId); h.onRubStart(); };
    rub.onpointerup = ()=>h.onRubEnd && h.onRubEnd();
    rub.onpointercancel = ()=>h.onRubEnd && h.onRubEnd();
    rub.onpointerleave = ()=>h.onRubEnd && h.onRubEnd();
  }
  const re = host.querySelector("#introReglove");
  if(re) re.onclick = ()=>h.onReglove && h.onReglove();
  const ready$ = host.querySelector("#introReady");
  if(ready$) ready$.onclick = ()=>{ if((!o.gate || ready) && h.onReady) h.onReady(); };
}

function patchLive(host, state){
  const set = (name, text, cls)=>{
    const el = host.querySelector(`[data-live="${name}"]`);
    if(!el) return;
    if(el.textContent !== text) el.textContent = text;
    if(cls){ el.classList.remove("good","bad","wait"); el.classList.add(cls); }
  };
  set("hygiene", `${Math.round(state.hygieneSeconds)}s`,
    state.hygieneSeconds >= HYGIENE_GOOD_S ? "good" : (state.hygieneSeconds > 0 ? "wait" : "bad"));
  set("drying", state.gloved ? (state.dryingSeconds >= DRY_MIN_S ? "yes" : "no") : `${Math.round(state.dryingSeconds)}s`,
    state.dryingSeconds >= DRY_MIN_S ? "good" : "wait");
}
