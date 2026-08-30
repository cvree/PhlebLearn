/* =========================================================================
   CLEANING COACH — the DOM layer while the site is being prepped.

   The coverage is visible on the arm itself; this reports the numbers that
   are not (how much of the field, which way it was worked, how long it has
   been drying) and coaches in teaching mode.
   ========================================================================= */
import {
  nextIssue, nextAction, COVERAGE_TARGET, OUTWARD_GOOD, DRY_SECONDS,
} from "./cleaningRules.js";
import { stepGuideHTML, stepHintHTML, guideSignature } from "../stepGuide.js";

/* How the gesture is performed — behind the step's disclosure now rather than
   printed under every frame of it. See stepGuide.js. */
const HOW = `<p><b>Open the alcohol pad</b>, then <b>scrub from the puncture point outward, in widening
  circles.</b> The wet patch on the arm is exactly the skin you have disinfected — cover the whole marked
  field. Going back inward drags the dirty edge over skin you just cleaned.</p>
  <p>Then <b>take your hands off and let it air-dry</b> for the full ${DRY_SECONDS} seconds: do not fan it,
  blot it, or re-palpate it. Build the needle while it dries.</p>`;

function esc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }

function fieldHTML(state, result){
  const cov = Math.round(result.coverage*100);
  const secs = Math.round(result.secondsDrying);
  const dry = Math.round(result.dryness*100);
  const drying = state.strokes && result.coverage >= COVERAGE_TARGET;
  return `<div class="cln-field">
    <div class="cln-row">
      <span class="cln-lab">Field covered</span>
      <span class="cln-val" data-live="cov">${cov}%</span>
      <span class="cln-bar" role="img" aria-label="${cov} percent of the prep field covered" data-live="covbar">
        <span class="cln-fill" style="width:${cov}%"></span>
        <span class="cln-mark" style="left:${Math.round(COVERAGE_TARGET*100)}%"></span>
      </span>
    </div>
    <div class="cln-row">
      <span class="cln-lab">Worked outward</span>
      <span class="cln-val ${result.outward < OUTWARD_GOOD ? "bad" : ""}" data-live="out">${Math.round(result.outward*100)}%</span>
    </div>
    ${drying ? `<div class="cln-row">
      <span class="cln-lab">Air-drying</span>
      <span class="cln-val ${dry >= 100 ? "good" : "wait"}" data-live="dry">${secs}s / ${DRY_SECONDS}s</span>
      <span class="cln-bar" role="img" aria-label="${dry} percent dry" data-live="drybar">
        <span class="cln-fill dry" style="width:${dry}%"></span>
      </span>
    </div>` : ""}
  </div>`;
}

function controlsHTML(state){
  return `<div class="cln-controls">
    <fieldset>
      <legend>Prep the site without dragging</legend>
      ${!state.swabOpen ? `<button class="stg-mini" id="clnOpen">Open the alcohol pad</button>` : `
      <div class="cln-actions">
        <button class="stg-mini" data-scrub="spiral-full">Scrub outward in circles, whole field</button>
        <button class="stg-mini" data-scrub="spiral-small">Scrub outward, but only the middle</button>
        <button class="stg-mini" data-scrub="backforth">Scrub back and forth across it</button>
      </div>
      <p class="cln-note">Then take your hands off it and let it air-dry — the clock above is real.</p>`}
    </fieldset>
  </div>`;
}

export function renderCleaningCoach(host, o){
  const { state, result } = o;
  const guided = !!o.guided;
  const listView = !!o.listView;
  const issue = nextIssue(result);
  const ready = result.ready;

  const signature = [
    listView, guided, ready, state.swabOpen, !!state.strokes,
    issue ? issue.code : "-",
    result.coverage >= COVERAGE_TARGET,
    result.dryness >= 1,
    guideSignature(),
  ].join("|");

  if(host.dataset.clnSig === signature){ patchLive(host, state, result); return; }
  host.dataset.clnSig = signature;

  host.innerHTML = `
    <div class="cln-coach">
      <div class="stg-topline">
        <span class="stg-mode">${listView ? "Controls" : "Prep the site"}</span>
        <div class="stg-toggles">
          ${o.canRender3d ? `<button class="stg-toggle" id="clnView" aria-pressed="${listView}">${listView ? "Use the arm" : "Use controls"}</button>` : ""}
        </div>
      </div>

      ${fieldHTML(state, result)}

      ${guided
        ? stepGuideHTML({
            ready: ready,
            tone: ready ? "ready" : (issue && issue.severity === "block" ? "block" : "warn"),
            lead: ready ? "Clean and dry."
                        : (issue ? (issue.severity === "block" ? "Not yet." : "Worth fixing.") : ""),
            line: ready
              ? `The whole field was scrubbed, worked outward, and left the full ${DRY_SECONDS} seconds. Do not touch it again.`
              : (issue ? issue.message : nextAction(state, result)),
            how: HOW,
          })
        : stepHintHTML(o.hint, ready)}

      ${listView ? controlsHTML(state) : ""}

      ${/* PLAY'S ESCAPE HATCH, AND ONLY PLAY'S.

           A scored shift has to let the learner move on from work that is not
           right — a band too close to the site, a site half-scrubbed — and
           carry the mistake forward to the report. Nothing else can end those
           steps, because implicit advancement asks whether the step is DONE
           and a bad band is not.

           Learn has no button at all now. It is gated on being right by
           design, and the step ends itself the moment it is — so the control
           that used to sit here was a full-width primary bar reading "Not
           ready yet" for the whole of the step, and nothing else, ever. */
        guided ? "" : `<button class="btn vp-tap quiet" id="clnReady">Carry on ▶</button>`}

      ${!listView && !state.swabOpen ? `<button class="btn ghost vp-tap" id="clnOpen">Open the alcohol pad</button>` : ""}

    </div>`;

  const h = o.handlers || {};
  const bind = (id, fn)=>{ const el = host.querySelector("#"+id); if(el && fn) el.onclick = fn; };
  bind("clnView", h.onToggleView);
  bind("clnOpen", h.onOpen);
  bind("clnReady", ()=>{ if((!guided || ready) && h.onReady) h.onReady(); });
  host.querySelectorAll("[data-scrub]").forEach(b=>{
    b.onclick = ()=>h.onScrub && h.onScrub(b.dataset.scrub);
  });
}

/** Coverage and the drying clock move continuously; the panel does not. */
function patchLive(host, state, result){
  const set = (name, text)=>{
    const el = host.querySelector(`[data-live="${name}"]`);
    if(el && el.textContent !== text) el.textContent = text;
  };
  const cov = Math.round(result.coverage*100);
  set("cov", `${cov}%`);
  set("out", `${Math.round(result.outward*100)}%`);
  const covbar = host.querySelector('[data-live="covbar"]');
  if(covbar){
    covbar.setAttribute("aria-label", `${cov} percent of the prep field covered`);
    const f = covbar.firstElementChild; if(f) f.style.width = `${cov}%`;
  }
  if(state.strokes && result.coverage >= COVERAGE_TARGET){
    set("dry", `${Math.round(result.secondsDrying)}s / ${DRY_SECONDS}s`);
    const drybar = host.querySelector('[data-live="drybar"]');
    if(drybar){
      const pct = Math.round(result.dryness*100);
      drybar.setAttribute("aria-label", `${pct} percent dry`);
      const f = drybar.firstElementChild; if(f) f.style.width = `${pct}%`;
    }
  }
}
