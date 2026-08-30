/* =========================================================================
   ANCHOR + INSERT COACH — the DOM layer while the stick happens.

   The angle and the flash are visible on the arm; this reports what is not —
   the anchor's offset and pull in real units, the depth against the vessel's
   own depth, and the bevel inherited from uncap. Full re-renders are gated on
   a structural signature; the numbers that tick every frame are patched
   through [data-live] instead.

   The window this is judged against is not fixed: `o.angleBand`/`o.anchorBand`
   default to the antecubital numbers, but the butterfly/dorsal-hand procedure
   passes its own — a hand draw's controls offer 10°/2°/25°, not 20°/5°/45°.
   When `o.device === "butterfly"`, the wing/tubing status and controls from
   butterflyCoach.js are embedded here too: the wings ARE how the set is held
   during insertion, so their UI belongs in this coach, not a separate one.
   ========================================================================= */
import {
  nextIssue, nextAction, BEVEL_TOLERANCE_DEG,
  DEFAULT_ANGLE_BAND, DEFAULT_ANCHOR_BAND, anglePresetsFor, anchorPresetsFor,
} from "./insertRules.js";
import {
  wingStatusHTML, infiltrationBannerHTML, wingControlsHTML, postEntryControlsHTML, patchWingLive,
} from "../butterfly/butterflyCoach.js";
import { stepGuideHTML, stepHintHTML, guideSignature } from "../stepGuide.js";

/* How the gesture is performed — behind the step's disclosure now rather than
   printed under every frame of it. All three beats at once, because the
   disclosure is read once, before the hand is on the arm, rather than glanced
   at mid-gesture. See stepGuide.js. */
function howHTML(angleWindow){
  return `<p><b>Press below the marked site and drag further away from it</b> to pull the skin taut.
    Let go to lock the anchor in.</p>
    <p><b>Then bring the needle down onto the skin at a shallow angle.</b> ${angleWindow} is the window —
    much flatter skates over the vein, much steeper drives through it.</p>
    <p><b>Keep dragging the same way to advance; the other way to ease back.</b> The depth is what you
    cannot see from here either way — watch for the flash.</p>`;
}

function esc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }
function mm(m){ return Math.round((m || 0)*1000); }
function mmR(m){ return Math.round((m || 0)*1000*10)/10; }

function anchorRowsHTML(state, result, anchorBand){
  const band = anchorBand || DEFAULT_ANCHOR_BAND;
  const pullMm = mm(state.anchorPull);
  const offsetMm = result.anchorOffset == null ? null : mm(result.anchorOffset);
  return `<div class="asm-row">
      <span class="asm-lab">Anchor</span>
      <span class="asm-val ${state.anchorSet ? "good" : "wait"}" data-live="anchorState">${state.anchorSet ? "set" : "not set"}</span>
    </div>
    ${state.anchorSet ? `<div class="asm-row">
      <span class="asm-lab">Offset</span>
      <span class="asm-val ${offsetMm!=null && offsetMm>0 && offsetMm>=mm(band.distalMin) && offsetMm<=mm(band.distalMax) ? "good" : "bad"}" data-live="anchorOffset">${offsetMm==null?"—":offsetMm+"mm distal"}</span>
    </div>
    <div class="asm-row">
      <span class="asm-lab">Traction</span>
      <span class="asm-val ${pullMm>=mm(band.pullGood)?"good":(pullMm>=mm(band.pullMin)?"":"bad")}" data-live="anchorPull">${pullMm}mm</span>
    </div>` : ""}`;
}

function insertRowsHTML(state, result, bevelDeg, angleBand){
  const band = angleBand || DEFAULT_ANGLE_BAND;
  const bevelOk = bevelDeg == null ? null : Math.abs(bevelDeg) <= BEVEL_TOLERANCE_DEG;
  return `<div class="asm-row">
      <span class="asm-lab">Angle</span>
      <span class="asm-val ${state.angleDeg==null?"wait":(state.angleDeg>=band.ideal.min && state.angleDeg<=band.ideal.max?"good":"bad")}" data-live="angle">${state.angleDeg==null?"—":Math.round(state.angleDeg)+"°"}</span>
    </div>
    <div class="asm-row">
      <span class="asm-lab">Depth</span>
      <span class="asm-val ${result.inVein?"good":(result.through?"bad":"")}" data-live="depth">${mm(state.depthM)}mm${result.chosen?` / ${mm(result.chosen.depth)}mm`:""}</span>
    </div>
    <div class="asm-row">
      <span class="asm-lab">Bevel</span>
      <span class="asm-val ${bevelOk==null?"":(bevelOk?"good":"bad")}" data-live="bevel">${bevelOk==null?"—":(bevelOk?"up":"off vertical")}</span>
    </div>
    ${result.inVein ? `<div class="asm-row"><span class="ins-flash">🩸 Flash</span></div>` : ""}`;
}

function anchorControlsHTML(anchorBand){
  const p = anchorPresetsFor(anchorBand);
  return `<div class="asm-controls"><fieldset>
    <legend>Anchor without dragging</legend>
    <div class="asm-actions">
      <button class="stg-mini" data-ins="anchor-ideal">Anchor ${mmR(p.idealM)}mm below, firm pull</button>
      <button class="stg-mini" data-ins="anchor-close">Anchor right on top of the site</button>
      <button class="stg-mini" data-ins="anchor-far">Anchor ${mmR(p.farM)}mm below</button>
      <button class="stg-mini" data-ins="anchor-wrongside">Pull toward the site instead of away</button>
      <button class="stg-mini" data-ins="anchor-weak">Anchor the right spot, barely pull</button>
    </div>
  </fieldset></div>`;
}

function insertControlsHTML(state, result, angleBand){
  const p = anglePresetsFor(angleBand);
  if(state.entryX == null && !result.inVein){
    return `<div class="asm-controls"><fieldset>
      <legend>Insert without dragging</legend>
      <div class="asm-actions">
        <button class="stg-mini" data-ins="redo-anchor">Redo the anchor</button>
        <button class="stg-mini" data-ins="insert-ideal">Go in at ${p.ideal}°</button>
        <button class="stg-mini" data-ins="insert-shallow">Go in nearly flat, ${p.shallow}°</button>
        <button class="stg-mini" data-ins="insert-steep">Go in steep, ${p.steep}°</button>
      </div>
    </fieldset></div>`;
  }
  return `<div class="asm-controls"><fieldset>
    <legend>Advance without dragging</legend>
    <div class="asm-actions">
      <button class="stg-mini" data-ins="advance">Ease the needle further in</button>
      <button class="stg-mini" data-ins="retreat">Back off slightly</button>
      <button class="stg-mini" data-ins="pullout">Pull all the way out and try again</button>
    </div>
  </fieldset></div>`;
}

export function renderInsertCoach(host, o){
  const { state, result } = o;
  const guided = !!o.guided;
  const listView = !!o.listView;
  const bevelDeg = o.bevelDeg == null ? null : o.bevelDeg;
  const angleBand = o.angleBand || DEFAULT_ANGLE_BAND;
  const anchorBand = o.anchorBand || DEFAULT_ANCHOR_BAND;
  const isButterfly = o.device === "butterfly";
  const bf = o.butterfly || null;
  const issue = nextIssue(result);
  const ready = result.ready;
  const phase = state.anchorSet ? "insert" : "anchor";

  const signature = [
    listView, guided, ready, phase, state.anchorSet, state.entryX != null,
    result.inVein, result.through, isButterfly,
    bf ? bf.wings : "-", bf ? bf.secured : "-", bf ? (bf.infiltratedMl > 0) : "-", bf ? bf.infiltrationNoticed : "-",
    issue ? issue.code : "-",
    guideSignature(),
  ].join("|");

  if(host.dataset.insSig === signature){ patchLive(host, state, result, bevelDeg, bf); return; }
  host.dataset.insSig = signature;

  const angleWindow = `${angleBand.ideal.min}–${angleBand.ideal.max}°`;

  host.innerHTML = `
    <div class="asm-coach">
      <div class="stg-topline">
        <span class="stg-mode">${listView ? "Controls" : (phase === "anchor" ? "Anchor the vein" : "Insert the needle")}</span>
        <div class="stg-toggles">
          ${o.canRender3d ? `<button class="stg-toggle" id="insView" aria-pressed="${listView}">${listView ? "Use the arm" : "Use controls"}</button>` : ""}
        </div>
      </div>

      <div class="asm-panel">
        ${anchorRowsHTML(state, result, anchorBand)}
        ${state.anchorSet ? insertRowsHTML(state, result, bevelDeg, angleBand) : ""}
        ${isButterfly && bf ? wingStatusHTML(bf) : ""}
      </div>

      ${isButterfly && bf ? infiltrationBannerHTML(bf) : ""}

      ${guided
        ? stepGuideHTML({
            tone: ready ? "ready" : (issue && issue.severity === "block" ? "block" : "warn"),
            lead: ready ? "Flash confirmed."
                        : (issue ? (issue.severity === "block" ? "Not yet." : "Worth fixing.") : ""),
            line: ready ? "The tip is inside the vein at a clean angle. Hold it steady."
                        : (issue ? issue.message : nextAction(state, result)),
            how: howHTML(angleWindow),
          })
        : stepHintHTML(o.hint)}

      ${isButterfly && bf ? wingControlsHTML(bf) : ""}

      ${listView
        ? (phase === "anchor" ? anchorControlsHTML(anchorBand) : insertControlsHTML(state, result, angleBand))
        : ""}

      ${isButterfly && bf ? postEntryControlsHTML(bf) : ""}

      <button class="btn vp-tap${guided ? "" : " quiet"}" id="insReady" ${(guided && !ready) ? "disabled" : ""} style="${(guided && !ready) ? "opacity:.5" : ""}">
        ${guided ? (ready ? "In the vein — hold ▶" : "Not ready yet") : "Carry on ▶"}
      </button>
    </div>`;

  const h = o.handlers || {};
  const bind = (id, fn)=>{ const el = host.querySelector("#"+id); if(el && fn) el.onclick = fn; };
  bind("insView", h.onToggleView);
  bind("insReady", ()=>{ if((!guided || ready) && h.onReady) h.onReady(); });
  host.querySelectorAll("[data-ins]").forEach(b=>{
    b.onclick = ()=>h.onAction && h.onAction(b.dataset.ins);
  });
  host.querySelectorAll("[data-wing]").forEach(b=>{
    b.onclick = ()=>h.onWing && h.onWing(b.dataset.wing);
  });
}

function patchLive(host, state, result, bevelDeg, bf){
  const set = (name, text)=>{
    const el = host.querySelector(`[data-live="${name}"]`);
    if(el && el.textContent !== text) el.textContent = text;
  };
  set("anchorState", state.anchorSet ? "set" : "not set");
  if(state.anchorSet){
    const offsetMm = result.anchorOffset == null ? null : mm(result.anchorOffset);
    set("anchorOffset", offsetMm == null ? "—" : offsetMm + "mm distal");
    set("anchorPull", mm(state.anchorPull) + "mm");
    set("angle", state.angleDeg == null ? "—" : Math.round(state.angleDeg) + "°");
    set("depth", mm(state.depthM) + "mm" + (result.chosen ? ` / ${mm(result.chosen.depth)}mm` : ""));
    const bevelOk = bevelDeg == null ? null : Math.abs(bevelDeg) <= 25;
    set("bevel", bevelOk == null ? "—" : (bevelOk ? "up" : "off vertical"));
  }
  patchWingLive(host, bf);
}
