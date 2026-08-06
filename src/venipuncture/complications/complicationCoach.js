/* =========================================================================
   COMPLICATION COACH — the alert the learner has to notice, and the choice
   it demands.

   Deliberately NOT rendered into the current step's panel. A complication
   arrives while the learner's hands are in the middle of something, and it
   has to be visible over whatever that is — the supply cart, the arm, the
   accessible controls, all of which own their own DOM. So this is one fixed
   layer over the app, created on demand and removed the moment it is
   answered, exactly as `ui/notifications.js`'s toast is.

   What the alert SAYS depends on the mode, and that is the whole difference
   between the three:

     Learn      the sign, named, plus what it means and what it will do if it
                is left; the options are labelled and the teaching follows the
                answer.
     Practice   the sign, named. No explanation, no teaching until the section
                feedback.
     Final      the observation only — "they have stopped talking, their face
                looks damp" — with no label on it at all. Recognising it IS
                the assessment.

   DOM only. Decides nothing: `complicationRules.js` says what is correct and
   `complicationState.js` records it.
   ========================================================================= */
import { complicationFor, responseLabel, RESPONSES } from "./complicationRules.js";

const LAYER_ID = "complicationLayer";

function layer(){
  let el = document.getElementById(LAYER_ID);
  if(el) return el;
  el = document.createElement("div");
  el.id = LAYER_ID;
  el.className = "cx-layer";
  const app = document.getElementById("app") || document.body;
  app.appendChild(el);
  return el;
}

export function clearComplicationAlert(){
  const el = document.getElementById(LAYER_ID);
  if(el) el.remove();
}

/**
 * Shows one complication and waits for an answer.
 *
 * @param {object} o
 *   id          the complication
 *   reveal      the mode descriptor from gameState.reveal()
 *   options     response ids, already in the order they should appear
 *   onRespond(responseId)
 */
export function showComplicationAlert(o){
  const opt = o || {};
  const def = complicationFor(opt.id);
  if(!def) return;
  const r = opt.reveal || {};
  const el = layer();
  if(el.dataset.showing === opt.id) return;   // already up, do not restart it
  el.dataset.showing = opt.id;

  // Learn names it and explains; Practice names it; the Final Practical
  // describes what is in front of them and nothing more.
  const named = !!r.hints;
  const explained = !!r.instruction;
  const headline = named ? `${def.emoji} ${def.label}` : "👁️ Something has changed";
  const body = named ? def.cue.join(" ") : def.hidden;

  el.innerHTML = `
    <div class="cx-card cx-${def.severity}" role="alertdialog" aria-live="assertive">
      <div class="cx-head"><span class="cx-title">${headline}</span><span class="cx-sev">${def.severity === "urgent" ? "act now" : "attend to it"}</span></div>
      <p class="cx-cue">${body}</p>
      ${explained ? `<p class="cx-why">${def.why}</p>` : ""}
      <div class="cx-options">
        ${(opt.options || def.options).map(id => `<button class="cx-opt" data-r="${id}">${responseLabel(id)}</button>`).join("")}
      </div>
    </div>`;

  el.querySelectorAll(".cx-opt").forEach(btn => {
    btn.onclick = () => {
      const responseId = btn.dataset.r;
      el.querySelectorAll(".cx-opt").forEach(b => { b.disabled = true; });
      if(opt.onRespond) opt.onRespond(responseId);
    };
  });
}

/**
 * The verdict shown after an answer. Learn and Practice get the teaching;
 * the Final Practical is told only that it was noted, because an examiner
 * does not tell you how you did halfway through.
 */
export function showComplicationVerdict(o){
  const opt = o || {};
  const def = complicationFor(opt.id);
  const el = document.getElementById(LAYER_ID);
  if(!el || !def) return;
  const r = opt.reveal || {};
  delete el.dataset.showing;

  if(!r.verdicts && !r.sectionFeedback){
    // Final Practical: acknowledge and get out of the way.
    el.innerHTML = `<div class="cx-card cx-noted"><p class="cx-cue">Noted: ${responseLabel(opt.responseId)}.</p></div>`;
    setTimeout(clearComplicationAlert, 1400);
    return;
  }

  const ok = !!opt.correct;
  el.innerHTML = `
    <div class="cx-card ${ok ? "cx-right" : "cx-wrong"}">
      <div class="cx-head"><span class="cx-title">${ok ? "✓" : "✗"} ${def.label}</span></div>
      <p class="cx-cue"><b>You chose:</b> ${responseLabel(opt.responseId)}</p>
      ${opt.consequence ? `<p class="cx-consequence">${opt.consequence}</p>` : ""}
      <p class="cx-why">${def.teaching}</p>
      <button class="cx-opt cx-dismiss">Carry on</button>
    </div>`;
  const btn = el.querySelector(".cx-dismiss");
  if(btn) btn.onclick = () => { clearComplicationAlert(); if(opt.onDismiss) opt.onDismiss(); };
}

/** The one-line summary the report and the section feedback use. */
export function complicationSummaryHTML(measurements){
  const m = measurements;
  if(!m || !m.total) return "";
  const rows = m.events.map(e => `
    <li class="cx-row ${e.correct ? "ok" : "bad"}">
      <b>${e.emoji} ${e.label}</b> — ${e.response ? `"${e.response}"` : "never acted on"}
      ${e.reactionS != null ? `<span class="cx-t">${e.reactionS}s</span>` : ""}
    </li>`).join("");
  return `<div class="cx-summary"><b>Complications</b><ul>${rows}</ul>
    <div class="cx-metrics">
      <span>Recognised <b>${m.managedCount}/${m.total}</b></span>
      ${m.meanReactionS != null ? `<span>Mean reaction <b>${m.meanReactionS}s</b></span>` : ""}
      <span>Bruise <b>${m.hematomaMl} mL</b></span>
      ${m.fainted ? "<span><b>Patient fainted</b></span>" : ""}
    </div></div>`;
}

export { RESPONSES };
