/* =========================================================================
   PALPATION COACH — the DOM layer while the learner is feeling the arm.

   The rule this file exists to keep: it reports the SENSATION, and it never
   names the structure before the learner has felt it. "Something is pushing
   back against your finger, in time" is the observation; "that is the
   brachial artery" is the conclusion, and the conclusion is the learner's
   job. Teaching mode names it once they have moved off it; a scored shift
   never names it at all.
   ========================================================================= */
import { FEEL, nextIssue, nextAction, OCCLUDE_PRESS } from "./palpationRules.js";

function esc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }

/* ---------- what the fingertip is reporting --------------------------------- */

const SENSATION = {
  [FEEL.NOTHING]:   "Nothing yet — your hand is off the arm.",
  [FEEL.SOFT]:      "Soft tissue. Nothing distinct under the fingertip.",
  [FEEL.VEIN]:      "It gives under the finger and springs back — bouncy, and it stays put.",
  [FEEL.ROLLING]:   "It gives, but it slides sideways out from under you as you press.",
  [FEEL.ARTERY]:    "It is pushing back against your finger, in time, over and over.",
  [FEEL.TENDON]:    "Hard. It does not give at all.",
  [FEEL.NERVE]:     "The patient flinches — a sharp, shooting feeling down the arm.",
  [FEEL.FLATTENED]: "You had something, then it went. You are pressing hard enough to squash it flat.",
};

/* Only shown once it has been felt, and only in teaching mode. */
const NAMES = {
  "median-cubital":  "the median cubital vein — first choice",
  "cephalic":        "the cephalic vein",
  "basilic":         "the basilic vein",
  "brachial-artery": "the brachial artery",
  "biceps-tendon":   "the biceps tendon",
  "median-nerve":    "the median nerve",
};

function touchHTML(touch, state, guided){
  if(!touch) return "";
  const pressPct = Math.round(touch.press*100);
  const named = guided && touch.vesselId && state.felt[touch.vesselId] && NAMES[touch.vesselId];
  return `<div class="plp-touch">
    <div class="plp-feel ${touch.feel === FEEL.NERVE ? "hurt" : ""} ${touch.occluding ? "occluding" : ""}"
         role="status" aria-live="polite" data-live="feel">${esc(SENSATION[touch.feel] || SENSATION[FEEL.NOTHING])}</div>
    ${named ? `<div class="plp-named" data-live="named">That is ${esc(named)}.</div>` : `<div class="plp-named" data-live="named"></div>`}
    <div class="plp-pressrow">
      <span class="plp-presslab">Pressure</span>
      <span class="plp-press" role="img" aria-label="${pressPct} percent" data-live="pressmeter">
        <span class="plp-pressfill" style="width:${pressPct}%"></span>
        <span class="plp-pressmark" style="left:${Math.round(OCCLUDE_PRESS*100)}%"></span>
      </span>
    </div>
    <p class="plp-hint">Hold still to press harder; slide the finger and the pressure eases off.</p>
  </div>`;
}

/* ---------- accessible path -------------------------------------------------- */

/**
 * The same palpation, reachable without a pointer. Deliberately NOT a list of
 * named veins to pick from — that would be the old multiple-choice question
 * wearing a different hat. It presses unnamed places on the arm and reports
 * the same sensations; naming them is still the learner's call.
 */
function controlsHTML(state, guided){
  const spots = [
    { id:"median-cubital",  label:"across the bend of the elbow, centre" },
    { id:"cephalic",        label:"the thumb side of the forearm" },
    { id:"basilic",         label:"the little-finger side, inner edge" },
    { id:"brachial-artery", label:"deep on the inner edge, above the bend" },
    { id:"biceps-tendon",   label:"the firm ridge just inside the bend" },
  ];
  return `<div class="plp-controls">
    <fieldset>
      <legend>Press a spot on the arm</legend>
      <div class="plp-spots">
        ${spots.map(s=>`<button class="stg-mini" data-press="${s.id}">${esc(s.label)}
          ${state.felt[s.id] ? `<span class="plp-tag">felt</span>` : ""}</button>`).join("")}
      </div>
      <label class="tq-field">
        <span>How hard</span>
        <select id="plpPress">
          <option value="0.25">Lightly</option>
          <option value="0.62" selected>Firmly — the way you palpate</option>
          <option value="0.95">Hard</option>
        </select>
      </label>
    </fieldset>
    <div class="plp-commit">
      <span>Mark the one you will draw from:</span>
      ${spots.map(s=>`<button class="stg-mini ${state.chosenId === s.id ? "on" : ""}" data-choose="${s.id}"
        ${state.felt[s.id] ? "" : "disabled title='Press it first'"}>${esc(s.label.split(",")[0])}</button>`).join("")}
      ${state.chosenId ? `<button class="stg-mini ghost" id="plpClear">Unmark</button>` : ""}
    </div>
  </div>`;
}

/* ---------- main render ------------------------------------------------------ */

export function renderPalpationCoach(host, o){
  const { state, result, touch } = o;
  const guided = !!o.guided;
  const listView = !!o.listView;
  const issue = nextIssue(result);
  const ready = result.ready;

  const signature = [
    listView, guided, ready, state.chosenId || "-",
    issue ? issue.code : "-",
    touch ? `${touch.feel}:${touch.vesselId || "-"}:${touch.markable}:${touch.occluding}` : "-",
    Object.keys(state.felt).sort().join(","),
  ].join("|");

  if(host.dataset.plpSig === signature){
    patchLive(host, touch);
    return;
  }
  host.dataset.plpSig = signature;

  host.innerHTML = `
    <div class="plp-coach">
      <div class="stg-topline">
        <span class="stg-mode">${listView ? "Controls" : "Palpate the arm"}</span>
        <div class="stg-toggles">
          ${o.canRender3d ? `<button class="stg-toggle" id="plpView" aria-pressed="${listView}">${listView ? "Use the arm" : "Use controls"}</button>` : ""}
        </div>
      </div>

      ${touchHTML(touch, state, guided)}

      ${guided
        ? `<div class="stg-msg ${ready ? "ready" : (issue && issue.severity === "block" ? "block" : "warn")}" role="status" aria-live="polite">
            ${ready
              ? `<b>Good vein.</b> You felt it, it springs back, and it is well anchored. Clean it next.`
              : issue ? `<b>${issue.severity === "block" ? "Not that one." : "Worth knowing."}</b> ${esc(issue.message)}`
                      : esc(nextAction(state))}
          </div>
          <p class="tq-next">${esc(nextAction(state))}</p>`
        : `<div class="stg-msg neutral" role="status" aria-live="polite">
            Feel for the vein yourself. What you chose, and whether you actually palpated it, is assessed after the patient.
          </div>`}

      ${listView ? controlsHTML(state, guided) : `<p class="stg-help">
        <b>Press a fingertip into the arm and hold.</b> Pressure builds while you keep still and eases off as you slide,
        so feel one spot at a time. A vein gives and comes back. Something that pushes back rhythmically is an artery —
        never draw from it. Something hard that will not move is a tendon.
        When you find the one you want, <b>mark it</b>.
      </p>`}

      ${!listView ? `<button class="btn ghost vp-tap" id="plpMark" ${touch && touch.markable ? "" : "disabled style='opacity:.5'"}>
        ${state.chosenId ? "Mark here instead" : "Mark this spot"}
      </button>` : ""}

      <button class="btn vp-tap" id="plpReady" ${(guided && !ready) ? "disabled" : ""} style="${(guided && !ready) ? "opacity:.5" : ""}">
        ${guided ? (ready ? "Site chosen — clean it ▶" : "Find a vein first") : "Carry on ▶"}
      </button>
    </div>`;

  const h = o.handlers || {};
  const bind = (id, fn)=>{ const el = host.querySelector("#"+id); if(el && fn) el.onclick = fn; };
  bind("plpView", h.onToggleView);
  bind("plpMark", h.onMark);
  bind("plpClear", h.onUnmark);
  bind("plpReady", ()=>{ if((!guided || ready) && h.onReady) h.onReady(); });

  const pressVal = ()=>{
    const el = host.querySelector("#plpPress");
    return el ? parseFloat(el.value) : 0.62;
  };
  host.querySelectorAll("[data-press]").forEach(b=>{
    b.onclick = ()=>h.onPress && h.onPress(b.dataset.press, pressVal());
  });
  host.querySelectorAll("[data-choose]").forEach(b=>{
    b.onclick = ()=>{ if(!b.disabled && h.onChoose) h.onChoose(b.dataset.choose); };
  });
}

/** The pressure meter moves continuously; the panel around it does not. */
function patchLive(host, touch){
  if(!touch) return;
  const feel = host.querySelector('[data-live="feel"]');
  const text = SENSATION[touch.feel] || SENSATION[FEEL.NOTHING];
  if(feel && feel.textContent !== text) feel.textContent = text;
  const meter = host.querySelector('[data-live="pressmeter"]');
  if(meter){
    const pct = Math.round(touch.press*100);
    meter.setAttribute("aria-label", `${pct} percent`);
    const fill = meter.firstElementChild;
    if(fill) fill.style.width = `${pct}%`;
  }
}
