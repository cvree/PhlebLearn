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

/* Only shown once it has been felt, and only in teaching mode. Covers both
   vessel sets — the antecubital fossa's and the dorsal hand's — since which
   one is on the arm depends on the procedure, not on this file. */
const NAMES = {
  "median-cubital":       "the median cubital vein — first choice",
  "cephalic":             "the cephalic vein",
  "basilic":              "the basilic vein",
  "brachial-artery":      "the brachial artery",
  "biceps-tendon":        "the biceps tendon",
  "median-nerve":         "the median nerve",
  "dorsal-metacarpal-3":  "the 3rd dorsal metacarpal vein — first choice",
  "dorsal-metacarpal-4":  "the 4th dorsal metacarpal vein",
  "dorsal-venous-arch":   "the dorsal venous arch",
  "extensor-tendon":      "an extensor tendon",
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

/* Position descriptions, never the clinical name, for each vessel set the
   game has. Which list applies is decided from which ids are actually on
   this arm (`vessels`), not from a mode flag — the same principle as
   everything else procedure-aware in this app. */
const FOREARM_SPOTS = [
  { id:"median-cubital",  label:"across the bend of the elbow, centre" },
  { id:"cephalic",        label:"the thumb side of the forearm" },
  { id:"basilic",         label:"the little-finger side, inner edge" },
  { id:"brachial-artery", label:"deep on the inner edge, above the bend" },
  { id:"biceps-tendon",   label:"the firm ridge just inside the bend" },
];
const HAND_SPOTS = [
  { id:"dorsal-metacarpal-3", label:"the back of the hand, over the middle knuckle" },
  { id:"dorsal-metacarpal-4", label:"the back of the hand, over the ring-finger knuckle" },
  { id:"dorsal-venous-arch",  label:"across the back of the wrist" },
  { id:"extensor-tendon",     label:"the firm ridge along the back of the hand" },
];

/**
 * The same palpation, reachable without a pointer. Deliberately NOT a list of
 * named veins to pick from — that would be the old multiple-choice question
 * wearing a different hat. It presses unnamed places on the arm and reports
 * the same sensations; naming them is still the learner's call.
 */
function controlsHTML(state, guided, vessels){
  const isHand = (vessels || []).some(v => v.id === "dorsal-metacarpal-3");
  const spots = isHand ? HAND_SPOTS : FOREARM_SPOTS;
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
    ${tracesHTML(state)}
  </div>`;
}

/* =========================================================================
   WHAT THE LEARNER HAS FELT, AND WHERE — the accessible half of the traces.

   The pointer path draws the map on the skin; this is the same map as a list,
   built from the same `state.traces`, and choosing a site is an action on a
   ROW of it. Both paths therefore commit through `chooseVessel()` with a
   trace's own position, so the grader cannot tell them apart — which is the
   rule this codebase runs on.

   There is no "Mark this spot" button in either path any more. You choose
   from what you have already felt, because that is the only thing you have
   any basis for choosing.
   ========================================================================= */
const FEEL_SAID = {
  vein:      "gave, and came back",
  rolling:   "slid away under the finger",
  artery:    "pushed back, rhythmically",
  tendon:    "hard, and did not move",
  nerve:     "that hurt",
  flattened: "pressed flat — ease off",
  soft:      "nothing under here",
  nothing:   "nothing under here",
};
const CHOOSABLE = ["vein", "rolling", "flattened"];

function tracesHTML(state){
  const traces = state.traces || [];
  if(!traces.length){
    return `<div class="plp-traces"><p class="stg-help">Nothing felt yet. Press a spot above.</p></div>`;
  }
  return `<div class="plp-traces">
    <span class="plp-traces-lab">What you have felt, and where</span>
    <ul class="plp-tracelist">
      ${traces.map((t, i)=>{
        const chosen = state.chosenId === t.vesselId && state.mark
          && Math.abs(state.mark.x - t.x) < 0.001 && Math.abs(state.mark.z - t.z) < 0.001;
        const can = CHOOSABLE.indexOf(t.feel) >= 0 && t.vesselId;
        return `<li class="plp-trace ${chosen ? "on" : ""}">
          <span class="plp-trace-dot" data-feel="${t.feel}"></span>
          <span class="plp-trace-said">${esc(FEEL_SAID[t.feel] || t.feel)}</span>
          ${can
            ? `<button class="stg-mini" data-choose-trace="${i}">${chosen ? "✓ drawing from here" : "Draw from here"}</button>`
            : `<span class="plp-trace-no">not a draw site</span>`}
        </li>`;
      }).join("")}
    </ul>
    ${state.chosenId ? `<button class="stg-mini ghost" id="plpClear">Unmark</button>` : ""}
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
    (state.traces || []).length,
    (state.traces || []).map(t=>t.feel).join(""),
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
            ${o.hint ? `<b>Reminder.</b> ${esc(o.hint)}` : `Feel for the vein yourself. What you chose, and whether you actually palpated it, is assessed after the patient.`}
          </div>`}

      ${listView ? controlsHTML(state, guided, o.vessels) : `<p class="stg-help">
        <b>Press a fingertip into the arm and search.</b> Pressure builds while you keep still and eases off as you
        slide, so a sweep finds shallow veins and lingering reveals what is deeper. A vein gives and comes back.
        Something that pushes back rhythmically is an artery — never draw from it. Something hard that will not move
        is a tendon. <b>Every spot you press is marked on the skin.</b>
        <b>Hold on one of your own marks to draw from it.</b>
      </p>`}

      <button class="btn vp-tap" id="plpReady" ${(guided && !ready) ? "disabled" : ""} style="${(guided && !ready) ? "opacity:.5" : ""}">
        ${guided ? (ready ? "Site chosen — clean it ▶" : "Find a vein first") : "Carry on ▶"}
      </button>
    </div>`;

  const h = o.handlers || {};
  const bind = (id, fn)=>{ const el = host.querySelector("#"+id); if(el && fn) el.onclick = fn; };
  bind("plpView", h.onToggleView);
  bind("plpClear", h.onUnmark);
  host.querySelectorAll("[data-choose-trace]").forEach(b=>{
    b.onclick = ()=>h.onChooseTrace && h.onChooseTrace(Number(b.dataset.chooseTrace));
  });
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
