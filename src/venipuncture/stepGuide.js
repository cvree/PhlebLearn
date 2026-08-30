/* =========================================================================
   ONE VOICE PER STEP.

   Every guided step used to talk four times at once. On the insertion step,
   in this order, top to bottom:

     1. a TEACHING card   "Anchor the vein by pulling the skin taut with your
                           thumb 1-2 inches below…"
     2. a verdict         "Not yet. Anchor the vein first — pull the skin
                           taut with your thumb before you go in."
     3. a next action     "Press below the site and pull the skin taut to
                           anchor the vein."
     4. a how-to          "Press below the marked site and drag further away
                           from it to pull the skin taut. Let go to lock it in."

   Four ways of saying pull the skin taut, stacked, every frame, on a panel
   the learner is meant to be looking away from. Whatever the fifth-best
   phrasing of an instruction is worth, it is not worth being the reason
   somebody reads the panel instead of the arm.

   So: ONE LINE, live, saying the single most useful thing right now — the
   correction if there is one to make, the confirmation if the step is done,
   the next action otherwise. Everything else — why this matters clinically,
   and how the gesture is performed — goes behind one disclosure, which opens
   by itself the FIRST time a learner meets a step and stays shut after that.

   That last part is the whole trick. The teaching is not deleted, it is spent
   once. A learner on their first tourniquet gets the paragraph; a learner on
   their fourth gets an arm and a sentence, which is what they came for.
   ========================================================================= */
import { SS, saveSS } from "../game/gameState.js";
import { VP_TIPS, VP_ICON } from "./questions.js";

function esc(s){
  return String(s == null ? "" : s)
    .replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
}

/* ---------- which step is on screen ------------------------------------------
   Set by the screen that renders the step, read by the coach inside it. The
   coaches are handed an options bag by their runtimes and none of them
   carries a step id; threading one through eleven runtimes to reach eleven
   render functions would be a lot of parameters to express "the thing that is
   currently happening", which the composition already knows.
   ---------------------------------------------------------------------------- */
let currentStep = null;
export function setGuideStep(id){ currentStep = id || null; }
export function guideStep(){ return currentStep; }

/* ---------- what has been taught already -------------------------------------
   Per save, not per shift: the second time you ever tie a tourniquet you do
   not need the paragraph again, and you certainly do not need it on patient
   six of the same shift.

   Written when a step FINISHES rather than when it opens, so the disclosure
   stays open for the whole of the first attempt — including the part of it
   where the learner is stuck, which is exactly when they would want it.
   ---------------------------------------------------------------------------- */
function taught(){
  if(!SS.taught || typeof SS.taught !== "object") SS.taught = {};
  return SS.taught;
}
export function hasSeenStep(id){ return !!(id && taught()[id]); }
export function markStepTaught(id){
  if(!id || hasSeenStep(id)) return;
  taught()[id] = 1;
  saveSS();
}

/* ---------- the disclosure ---------------------------------------------------- */
/**
 * The step's clinical reason, from the same VP_TIPS table the old TEACHING
 * card was built from. Nothing here is new writing — it is the same content,
 * spent once instead of printed forever.
 */
function whyHTML(id){
  const info = id ? VP_TIPS[id] : null;
  if(!info) return "";
  return `<p class="sg-why"><b>${esc(info.t)}.</b> ${info.tip}
    <span class="sg-mat">Why it matters: ${info.why}</span></p>`;
}

/**
 * The single guidance line, plus the one place the step explains itself.
 *
 * @param {object} o
 * @param {"ready"|"block"|"warn"|"neutral"} o.tone
 * @param {string} [o.lead]  the bold half of the line ("Not yet.", "Good vein.")
 * @param {string} o.line    the sentence itself — escaped here, so pass text
 * @param {string} [o.note]  HTML: a FACT this step needs on screen — the order
 *   of draw, the inversion counts, this patient's clotting time. Not a second
 *   phrasing of the instruction; those are what this module exists to delete.
 * @param {string} [o.how]   HTML: how the gesture is performed on this step
 * @param {boolean} [o.forceOpen]  keep the disclosure open regardless
 * @param {boolean} [o.ready]  whether this step's completing action has
 *   happened. Not shown — the line already says so in words — but published
 *   on the wrapper so the browser tests have one handle for "is this step
 *   finished?" now that there is no confirm button to read it off.
 */
export function stepGuideHTML(o){
  const opt = o || {};
  const id = opt.id || currentStep;
  const tone = opt.tone || "warn";
  const line = `${opt.lead ? `<b>${esc(opt.lead)}</b> ` : ""}${esc(opt.line || "")}`;
  const why = whyHTML(id);
  const how = opt.how || "";
  const body = `${why}${how ? `<div class="sg-do">${how}</div>` : ""}`;
  const open = body && (opt.forceOpen || !hasSeenStep(id));
  return `<div class="sg" data-step="${esc(id || "")}" data-ready="${(opt.ready != null ? opt.ready : tone === "ready") ? 1 : 0}">
    <div class="stg-msg ${tone}" role="status" aria-live="polite">${line}</div>
    ${opt.note ? `<p class="sg-note">${opt.note}</p>` : ""}
    ${body ? `<details class="sg-how"${open ? " open" : ""}>
      <summary>${VP_ICON[id] || "📘"} How this step works</summary>
      ${body}
    </details>` : ""}
  </div>`;
}

/**
 * Play's version: no verdict, no teaching, and only the standing reminder the
 * mode already allowed itself. Kept here so a coach has one import and one
 * shape to render either way.
 */
export function stepHintHTML(hint, ready){
  return `<div class="sg" data-step="${esc(currentStep || "")}" data-ready="${ready ? 1 : 0}">${
    hint ? `<div class="stg-msg neutral" role="status" aria-live="polite">
      <b>Reminder.</b> ${esc(hint)}</div>` : ""}</div>`;
}

/**
 * The signature fragment a coach folds into its own re-render check.
 *
 * The disclosure's open/closed state is derived from the save rather than
 * from the DOM, so a coach that re-renders on an unchanged signature would
 * otherwise never notice the step becoming "taught" mid-draw.
 */
export function guideSignature(){
  return `${currentStep || "-"}:${hasSeenStep(currentStep) ? 1 : 0}`;
}
