/* =========================================================================
   TOURNIQUET COACH — the DOM layer while the band is being applied.

   Not where the procedure happens. It reports what the arm is doing (are the
   veins filling? is there still a pulse? how long has it been on?), coaches in
   teaching mode, and hosts the accessible control path.

   The accessible path is a real alternative input, not an easier game: its
   controls call the same applyBandProgrammatically/nudgeBand/adjustTension
   functions the drag gesture drives, so the same measurements come out and
   the same rules judge them.
   ========================================================================= */
import { metresToInches, TENSION } from "../arm/armAnatomy.js";
import { PHASE, WRAP, TUCK } from "./tourniquetState.js";
import { nextIssue, nextAction, TIME } from "./tourniquetRules.js";
import { stepGuideHTML, stepHintHTML, guideSignature } from "../stepGuide.js";

/* How the gesture is performed — behind the step's disclosure now rather than
   printed under every frame of it. See stepGuide.js. */
const HOW = `<p><b>Take an end of the tourniquet and drag it round the arm</b> — underneath and up the far
  side, about a hand's width above the bend.</p>
  <p>Then <b>pull that end away from the arm</b> to tighten it, <b>sweep it across</b> the other end, and
  <b>push a loop back under the band, pointing up the arm</b>. Let go before the loop is under and it will
  spring off.</p>
  <p>Watch the veins fill as you pull: enough to raise them, not so much that the hand goes pale.</p>`;

function esc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }
function inches(m){ return (Math.round(metresToInches(m)*10)/10) + "″"; }

/* ---------- what the arm is telling you ------------------------------------- */

/**
 * The observation panel. This is the readout a learner should be making with
 * their eyes on the arm, mirrored in text so it is also available to a screen
 * reader — never a score, and in a scored shift never a verdict.
 */
function observationHTML(state, result){
  const onPatient = state.phase !== PHASE.LOOSE && state.phase !== PHASE.RELEASED;
  if(!onPatient){
    return `<div class="tq-obs"><div class="tq-obsrow">
      <span class="tq-obslab">The arm</span>
      <span class="tq-obsval">Resting. Veins flat and hard to see.</span></div></div>`;
  }

  const o = observationValues(result);

  return `<div class="tq-obs">
    <div class="tq-obsrow">
      <span class="tq-obslab">Veins</span>
      <span class="tq-obsval"><span data-live="fillWord">${esc(o.fillWord)}</span>
        <span class="tq-meter" role="img" aria-label="${o.fill} percent filled" data-live="meter">
          <span class="tq-meterfill" style="width:${o.fill}%"></span></span></span>
    </div>
    <div class="tq-obsrow">
      <span class="tq-obslab">Radial pulse</span>
      <span class="tq-obsval ${result.pulse ? "" : "bad"}" data-live="pulse">${o.pulseWord}</span>
    </div>
    ${result.heightAboveSite != null ? `<div class="tq-obsrow">
      <span class="tq-obslab">Above the site</span>
      <span class="tq-obsval" data-live="height">${esc(inches(result.heightAboveSite))}</span></div>` : ""}
    ${state.phase === PHASE.SECURED ? `<div class="tq-obsrow">
      <span class="tq-obslab">On for</span>
      <span class="tq-obsval tq-clock ${o.clockClass}" data-live="clock">${o.secs}s</span></div>` : ""}
  </div>`;
}

function observationValues(result){
  const fill = Math.round(result.distension*100);
  const secs = Math.round(result.seconds);
  return {
    fill, secs,
    fillWord: fill >= 70 ? "standing out well" : fill >= 40 ? "beginning to fill"
            : fill >= 15 ? "barely raised" : "still flat",
    pulseWord: result.pulse ? "present" : "cannot be found — the hand is blanching",
    clockClass: secs > TIME.LIMIT_S ? "over" : secs > TIME.WARN_S ? "warn" : "",
  };
}

/**
 * Updates the numbers that tick while the band sits on the arm, without
 * rebuilding the panel around them.
 *
 * The clock and the vein meter change several times a second once the band is
 * holding. Re-rendering the whole coach at that rate throws away and recreates
 * every node in it — which drops keyboard focus, makes the text unselectable,
 * re-announces the whole live region on each tick, and leaves the continue
 * button being destroyed out from under a click that is already on its way to
 * it. Only these values actually changed, so only these get written.
 */
function patchObservations(host, state, result, gesture){
  const o = observationValues(result);
  if(gesture && gesture.kind === "route"){
    const pct = host.querySelector('[data-live="wrapPct"]');
    const v = String(Math.round(gesture.progress*100));
    if(pct && pct.textContent !== v) pct.textContent = v;
  }
  const set = (name, text)=>{
    const el = host.querySelector(`[data-live="${name}"]`);
    if(el && el.textContent !== text) el.textContent = text;
  };
  set("fillWord", o.fillWord);
  set("pulse", o.pulseWord);
  if(state.phase === PHASE.SECURED) set("clock", `${o.secs}s`);

  const meter = host.querySelector('[data-live="meter"]');
  if(meter){
    meter.setAttribute("aria-label", `${o.fill} percent filled`);
    const bar = meter.firstElementChild;
    if(bar) bar.style.width = `${o.fill}%`;
  }
  const pulse = host.querySelector('[data-live="pulse"]');
  if(pulse) pulse.classList.toggle("bad", !result.pulse);
  const clock = host.querySelector('[data-live="clock"]');
  if(clock){
    clock.classList.toggle("warn", o.clockClass === "warn");
    clock.classList.toggle("over", o.clockClass === "over");
  }
}

/* ---------- live gesture feedback --------------------------------------------- */

/**
 * Named while it is happening, because the whole point of the gesture is that
 * the learner knows WHICH physical thing they are doing wrong mid-motion.
 */
function gestureHTML(gesture, guided){
  if(!gesture) return "";
  if(gesture.kind === "route"){
    const pct = Math.round(gesture.progress*100);
    const dir = gesture.direction === WRAP.UNDER ? "under the arm" :
                gesture.direction === WRAP.OVER ? "over the top of the arm" : "—";
    const warn = guided && gesture.direction === WRAP.OVER
      ? `<em>That is going over the top. Come back and take it underneath.</em>` : "";
    return `<div class="tq-gesture" role="status" aria-live="polite">
      <b>Passing it ${esc(dir)}</b> — <span data-live="wrapPct">${pct}</span>% of the way round. ${warn}</div>`;
  }
  if(gesture.kind === "tension"){
    if(gesture.tuckReady){
      const side = gesture.tuckSide === TUCK.PROXIMAL ? "up the arm" : "down toward the site";
      return `<div class="tq-gesture ready" role="status" aria-live="polite">
        <b>Loop is under the band, pointing ${esc(side)}.</b> Let go to set it.</div>`;
    }
    if(gesture.crossed){
      return `<div class="tq-gesture" role="status" aria-live="polite">
        <b>Crossed.</b> Now push a loop back under the band — let go before you do and it will spring off.</div>`;
    }
    return `<div class="tq-gesture" role="status" aria-live="polite">
      <b>Tensioning.</b> Sweep this end across the other one, still pulling.</div>`;
  }
  if(gesture.kind === "pullTail"){
    return `<div class="tq-gesture" role="status" aria-live="polite">Pull the tail to take the band off.</div>`;
  }
  return "";
}

/* ---------- accessible control path -------------------------------------------- */

/**
 * Five preset heights above THIS site, close/low/ideal/high/far — the same
 * five steps in the antecubital's own terms (1.5″/2.5″/3.5″/4.5″/5.5″) always
 * used, just measured from wherever the site actually is. `site.x` defaults
 * to 0 (the fossa), so the straight-needle draw sees the exact numbers it
 * always has; a hand draw's band sits nearer, as its own ideal window says.
 */
function heightPresets(siteX){
  const x = siteX == null ? 0 : siteX;
  return [0.038, 0.064, 0.089, 0.114, 0.140].map(off => x + off);
}

function controlsHTML(state, siteX, siteIdeal){
  const on = state.phase === PHASE.SECURED;
  const presets = heightPresets(siteX);
  const ideal = siteIdeal || { min: 0.076, max: 0.102 };
  const idealMid = (ideal.min + ideal.max)/2;
  // whichever preset lands closest to this site's own ideal midpoint is the
  // one pre-selected, so opening the dropdown for a hand draw does not
  // default to a height that was only ever right for the fossa
  const closest = presets.reduce((best, x, i) =>
    Math.abs(x - (siteX == null ? 0 : siteX) - idealMid) < Math.abs(presets[best] - (siteX == null ? 0 : siteX) - idealMid) ? i : best, 0);
  const labels = ["1.5″ — close to the site", "2.5″", "3.5″", "4.5″", "5.5″ — high on the upper arm"];
  return `<div class="tq-controls">
    <fieldset>
      <legend>Apply the band without dragging</legend>
      <label class="tq-field">
        <span>Distance above the site</span>
        <select id="tqHeight">
          ${presets.map((x, i) => `<option value="${x.toFixed(3)}" ${i === closest ? "selected" : ""}>${labels[i]}</option>`).join("")}
        </select>
      </label>
      <label class="tq-field">
        <span>Pass it</span>
        <select id="tqWrap">
          <option value="${WRAP.UNDER}" selected>Under the arm, ends up</option>
          <option value="${WRAP.OVER}">Over the top of the arm</option>
        </select>
      </label>
      <label class="tq-field">
        <span>Tension</span>
        <select id="tqTension">
          <option value="0.18">Barely snug</option>
          <option value="0.38">Light</option>
          <option value="0.56" selected>Firm — two fingers slide under</option>
          <option value="0.76">Tight</option>
          <option value="0.90">Very tight</option>
        </select>
      </label>
      <label class="tq-field">
        <span>Tuck the loop</span>
        <select id="tqTuck">
          <option value="${TUCK.PROXIMAL}" selected>Pointing up the arm</option>
          <option value="${TUCK.DISTAL}">Pointing down toward the site</option>
        </select>
      </label>
      <button class="stg-mini" id="tqApply">${on ? "Re-apply" : "Apply the band"}</button>
      ${on ? `<button class="stg-mini ghost" id="tqRemove">Take it off</button>` : ""}
    </fieldset>
    ${on ? `<div class="tq-adjust">
      <span>Adjust without re-applying:</span>
      <button class="stg-mini" id="tqDown" aria-label="Move the band closer to the site">↓ closer</button>
      <button class="stg-mini" id="tqUp" aria-label="Move the band further up the arm">↑ higher</button>
      <button class="stg-mini" id="tqLoose" aria-label="Loosen the band">− looser</button>
      <button class="stg-mini" id="tqTight" aria-label="Tighten the band">+ tighter</button>
    </div>` : ""}
  </div>`;
}

/* ---------- main render --------------------------------------------------------- */

/**
 * @param {HTMLElement} host
 * @param {object} o {state, result, gesture, guided, listView, canRender3d, handlers}
 */
export function renderTourniquetCoach(host, o){
  const { state, result, gesture } = o;
  const guided = !!o.guided;
  const listView = !!o.listView;
  const issue = nextIssue(result);
  const ready = result.ready;
  const secured = state.phase === PHASE.SECURED;

  // Everything that changes the panel's STRUCTURE or its wording — but not the
  // clock or the vein meter, which tick continuously and are patched in place.
  const signature = [
    state.phase, listView, guided, ready, secured,
    issue ? issue.code : "-", result.pulse,
    result.heightAboveSite != null ? inches(result.heightAboveSite) : "-",
    gesture ? `${gesture.kind}:${gesture.direction || ""}:${!!gesture.crossed}:${!!gesture.tuckReady}:${gesture.tuckSide || ""}` : "-",
    guideSignature(),
  ].join("|");

  if(host.dataset.tqSig === signature){
    patchObservations(host, state, result, gesture);
    return;
  }
  host.dataset.tqSig = signature;

  host.innerHTML = `
    <div class="tq-coach">
      <div class="stg-topline">
        <span class="stg-mode">${listView ? "Controls" : "The patient's arm"}</span>
        <div class="stg-toggles">
          ${o.canRender3d ? `<button class="stg-toggle" id="tqView" aria-pressed="${listView}">${listView ? "Use the arm" : "Use controls"}</button>` : ""}
        </div>
      </div>

      ${observationHTML(state, result)}
      ${gestureHTML(gesture, guided)}

      ${guided
        ? stepGuideHTML({
            ready: ready,
            tone: ready ? "ready" : (issue && issue.severity === "block" ? "block" : "warn"),
            lead: ready ? "That is a good tourniquet."
                        : (issue ? (issue.severity === "block" ? "Not right yet." : "Worth fixing.") : ""),
            line: ready
              ? "Veins filled, pulse intact, tail clear of the field. The clock is running — keep it under a minute."
              : (issue ? issue.message : nextAction(state)),
            how: HOW,
          })
        : stepHintHTML(o.hint, ready)}

      ${listView ? controlsHTML(state, o.site && o.site.x, o.site && o.site.ideal) : ""}

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
        guided ? "" : `<button class="btn vp-tap quiet" id="tqReady">Carry on ▶</button>`}

    </div>`;

  const h = o.handlers || {};
  const bind = (id, fn)=>{ const el = host.querySelector("#"+id); if(el && fn) el.onclick = fn; };
  bind("tqView", h.onToggleView);
  bind("tqReady", ()=>{ if((!guided || ready) && h.onReady) h.onReady(); });

  bind("tqApply", ()=>{
    if(!h.onApply) return;
    const val = id=>{ const el = host.querySelector("#"+id); return el ? el.value : null; };
    h.onApply({
      bandX: parseFloat(val("tqHeight")),
      wrap: val("tqWrap"),
      tension: parseFloat(val("tqTension")),
      tuck: val("tqTuck"),
      skew: 0,
    });
  });
  bind("tqRemove", h.onRemove);
  bind("tqDown", ()=>h.onNudge && h.onNudge(-0.012));
  bind("tqUp", ()=>h.onNudge && h.onNudge(+0.012));
  bind("tqLoose", ()=>h.onTension && h.onTension(-0.09));
  bind("tqTight", ()=>h.onTension && h.onTension(+0.09));
}

export { TENSION };
