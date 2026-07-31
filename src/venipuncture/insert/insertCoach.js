/* =========================================================================
   ANCHOR + INSERT COACH — the DOM layer while the stick happens.

   The angle and the flash are visible on the arm; this reports what is not —
   the anchor's offset and pull in real units, the depth against the vessel's
   own depth, and the bevel inherited from uncap. Full re-renders are gated on
   a structural signature; the numbers that tick every frame are patched
   through [data-live] instead.
   ========================================================================= */
import {
  nextIssue, nextAction,
  ANGLE_IDEAL, BEVEL_TOLERANCE_DEG,
  ANCHOR_PULL_MIN, ANCHOR_PULL_GOOD, ANCHOR_DISTAL_MIN, ANCHOR_DISTAL_MAX,
} from "./insertRules.js";

function esc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }
function mm(m){ return Math.round((m || 0)*1000); }

function anchorRowsHTML(state, result){
  const pullMm = mm(state.anchorPull);
  const offsetMm = result.anchorOffset == null ? null : mm(result.anchorOffset);
  return `<div class="asm-row">
      <span class="asm-lab">Anchor</span>
      <span class="asm-val ${state.anchorSet ? "good" : "wait"}" data-live="anchorState">${state.anchorSet ? "set" : "not set"}</span>
    </div>
    ${state.anchorSet ? `<div class="asm-row">
      <span class="asm-lab">Offset</span>
      <span class="asm-val ${offsetMm!=null && offsetMm>0 && offsetMm>=mm(ANCHOR_DISTAL_MIN) && offsetMm<=mm(ANCHOR_DISTAL_MAX) ? "good" : "bad"}" data-live="anchorOffset">${offsetMm==null?"—":offsetMm+"mm distal"}</span>
    </div>
    <div class="asm-row">
      <span class="asm-lab">Traction</span>
      <span class="asm-val ${pullMm>=mm(ANCHOR_PULL_GOOD)?"good":(pullMm>=mm(ANCHOR_PULL_MIN)?"":"bad")}" data-live="anchorPull">${pullMm}mm</span>
    </div>` : ""}`;
}

function insertRowsHTML(state, result, bevelDeg){
  const bevelOk = bevelDeg == null ? null : Math.abs(bevelDeg) <= BEVEL_TOLERANCE_DEG;
  return `<div class="asm-row">
      <span class="asm-lab">Angle</span>
      <span class="asm-val ${state.angleDeg==null?"wait":(state.angleDeg>=ANGLE_IDEAL.min && state.angleDeg<=ANGLE_IDEAL.max?"good":"bad")}" data-live="angle">${state.angleDeg==null?"—":Math.round(state.angleDeg)+"°"}</span>
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

function anchorControlsHTML(){
  return `<div class="asm-controls"><fieldset>
    <legend>Anchor without dragging</legend>
    <div class="asm-actions">
      <button class="stg-mini" data-ins="anchor-ideal">Anchor an inch and a half below, firm pull</button>
      <button class="stg-mini" data-ins="anchor-close">Anchor right on top of the site</button>
      <button class="stg-mini" data-ins="anchor-far">Anchor three inches below</button>
      <button class="stg-mini" data-ins="anchor-wrongside">Pull toward the site instead of away</button>
      <button class="stg-mini" data-ins="anchor-weak">Anchor the right spot, barely pull</button>
    </div>
  </fieldset></div>`;
}

function insertControlsHTML(state, result){
  if(state.entryX == null && !result.inVein){
    return `<div class="asm-controls"><fieldset>
      <legend>Insert without dragging</legend>
      <div class="asm-actions">
        <button class="stg-mini" data-ins="redo-anchor">Redo the anchor</button>
        <button class="stg-mini" data-ins="insert-ideal">Go in at 20°</button>
        <button class="stg-mini" data-ins="insert-shallow">Go in nearly flat, 5°</button>
        <button class="stg-mini" data-ins="insert-steep">Go in steep, 45°</button>
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
  const issue = nextIssue(result);
  const ready = result.ready;
  const phase = state.anchorSet ? "insert" : "anchor";

  const signature = [
    listView, guided, ready, phase, state.anchorSet, state.entryX != null,
    result.inVein, result.through,
    issue ? issue.code : "-",
  ].join("|");

  if(host.dataset.insSig === signature){ patchLive(host, state, result, bevelDeg); return; }
  host.dataset.insSig = signature;

  host.innerHTML = `
    <div class="asm-coach">
      <div class="stg-topline">
        <span class="stg-mode">${listView ? "Controls" : (phase === "anchor" ? "Anchor the vein" : "Insert the needle")}</span>
        <div class="stg-toggles">
          ${o.canRender3d ? `<button class="stg-toggle" id="insView" aria-pressed="${listView}">${listView ? "Use the arm" : "Use controls"}</button>` : ""}
        </div>
      </div>

      <div class="asm-panel">
        ${anchorRowsHTML(state, result)}
        ${state.anchorSet ? insertRowsHTML(state, result, bevelDeg) : ""}
      </div>

      ${guided
        ? `<div class="stg-msg ${ready ? "ready" : (issue && issue.severity === "block" ? "block" : "warn")}" role="status" aria-live="polite">
            ${ready
              ? `<b>Flash confirmed.</b> The tip is inside the vein at a clean angle. Hold it steady.`
              : issue ? `<b>${issue.severity === "block" ? "Not yet." : "Worth fixing."}</b> ${esc(issue.message)}`
                      : esc(nextAction(state, result))}
          </div>
          <p class="tq-next">${esc(nextAction(state, result))}</p>`
        : `<div class="stg-msg neutral" role="status" aria-live="polite">
            ${o.hint ? `<b>Reminder.</b> ${esc(o.hint)}` : `Anchor, then go in. Your technique is assessed after the patient.`}
          </div>`}

      ${listView
        ? (phase === "anchor" ? anchorControlsHTML() : insertControlsHTML(state, result))
        : `<p class="stg-help">
            ${phase === "anchor"
              ? `<b>Press below the marked site and drag further away from it</b> to pull the skin taut — an inch or two below is the window. Let go to lock it in.`
              : state.entryX == null
                ? `<b>Bring the needle down onto the skin at a shallow angle.</b> ${ANGLE_IDEAL.min}–${ANGLE_IDEAL.max}° is the window — much flatter skates over the vein, much steeper drives through it.`
                : `<b>Keep dragging the same way to advance; the other way to ease back.</b> The depth is what you cannot see from here either way — watch for the flash.`}
          </p>`}

      <button class="btn vp-tap" id="insReady" ${(guided && !ready) ? "disabled" : ""} style="${(guided && !ready) ? "opacity:.5" : ""}">
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
}

function patchLive(host, state, result, bevelDeg){
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
}
