/* =========================================================================
   THE WINGED SET, IN THE COACH — fragment helpers, not a step coach.

   There is no separate "butterfly step": the wings are how the set is held
   during insertion, and the tubing's consequences happen during tube
   changes, so their UI lives INSIDE insertCoach.js and collectionCoach.js —
   these functions return HTML fragments those two coaches embed, and a
   `data-wing`/`data-tube` attribute set those coaches wire the same way
   they already wire their own controls.

   Nothing here decides anything; `butterflyRules.js` does that. This file
   only renders what the state already says.
   ========================================================================= */
import { WINGS } from "./butterflyRules.js";

function esc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }
function mm(m){ return Math.round((m || 0)*1000*10)/10; }

/** The wing/tubing status rows — shown wherever the butterfly is in play. */
export function wingStatusHTML(state){
  if(!state) return "";
  const wingsCls = state.wings === WINGS.FLAT ? "good" : (state.wings === WINGS.PINCHED ? "wait" : "bad");
  return `<div class="asm-row">
      <span class="asm-lab">Wings</span>
      <span class="asm-val ${wingsCls}" data-live="wings">${
        state.wings === WINGS.FLAT ? "laid flat" : state.wings === WINGS.PINCHED ? "pinched (carrying grip)" : "released"
      }</span>
    </div>
    <div class="asm-row">
      <span class="asm-lab">Tubing</span>
      <span class="asm-val ${state.secured ? "good" : "wait"}" data-live="tubing">${
        state.secured ? "taped down" : `${mm(state.tubing.slackM)}mm slack, not taped`
      }</span>
    </div>
    ${state.entered ? `<div class="asm-row">
      <span class="asm-lab">Tip drift</span>
      <span class="asm-val ${state.peakTipOffsetM > state.calibreM*0.5 ? "bad" : "good"}" data-live="tipdrift">${mm(state.tipOffsetM)}mm</span>
    </div>` : ""}`;
}

/** The infiltration banner — only appears once there is something to notice. */
export function infiltrationBannerHTML(state){
  if(!state || state.infiltratedMl <= 0) return "";
  const seen = state.infiltrationNoticed;
  return `<div class="stg-msg ${seen ? "warn" : "block"}" role="status" aria-live="assertive" data-live="infiltration">
    ${seen
      ? `<b>Swelling noticed.</b> ${(Math.round(state.infiltratedMl*100)/100)} mL has gone into the tissue. Stop the draw.`
      : `<b>Something is wrong at the site.</b> Look at it.`}
  </div>`;
}

/** Controls for the wing grip — shown during insertion, before entry. */
export function wingControlsHTML(state){
  if(state.entered) return "";
  return `<div class="asm-controls"><fieldset>
    <legend>Pick the set up</legend>
    <div class="asm-actions">
      <button class="stg-mini" data-wing="pinch">Pinch the wings and carry it by them</button>
      <button class="stg-mini" data-wing="tubing">Carry it by the tubing instead</button>
    </div>
  </fieldset></div>`;
}

/** Controls for after entry: lay the wings flat, tape the line down. */
export function postEntryControlsHTML(state){
  if(!state.entered) return "";
  const out = [];
  if(state.wings !== WINGS.FLAT) out.push(`<button class="stg-mini" data-wing="flat">Lay the wings flat on the skin</button>`);
  if(!state.secured) out.push(`<button class="stg-mini" data-wing="secure">Tape the wings down</button>`);
  if(state.infiltratedMl > 0 && !state.infiltrationNoticed) out.push(`<button class="stg-mini" data-wing="notice">Look at the site</button>`);
  if(state.infiltrationNoticed && !state.stoppedOnInfiltration) out.push(`<button class="stg-mini" data-wing="stop">Stop the draw</button>`);
  if(!out.length) return "";
  return `<div class="asm-controls"><fieldset>
    <legend>The winged set</legend>
    <div class="asm-actions">${out.join("")}</div>
  </fieldset></div>`;
}

export function patchWingLive(host, state){
  const set = (name, text, cls)=>{
    const el = host.querySelector(`[data-live="${name}"]`);
    if(!el) return;
    if(el.textContent !== text) el.textContent = text;
    if(cls){ el.classList.remove("good","bad","wait"); el.classList.add(cls); }
  };
  if(!state) return;
  set("wings", state.wings === WINGS.FLAT ? "laid flat" : state.wings === WINGS.PINCHED ? "pinched (carrying grip)" : "released",
    state.wings === WINGS.FLAT ? "good" : state.wings === WINGS.PINCHED ? "wait" : "bad");
  set("tubing", state.secured ? "taped down" : `${mm(state.tubing.slackM)}mm slack, not taped`, state.secured ? "good" : "wait");
  if(state.entered) set("tipdrift", `${mm(state.tipOffsetM)}mm`, state.peakTipOffsetM > state.calibreM*0.5 ? "bad" : "good");
}

export { esc };
