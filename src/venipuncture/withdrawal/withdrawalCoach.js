/* =========================================================================
   WITHDRAW, SAFETY AND SHARPS COACH — the DOM layer for the end of the draw.

   The band, the needle, the gauze and the containers are all on screen, so
   this reports what is NOT visible from the bedside: the band's clock still
   running, how deep the tip still is, how far the shield has travelled, and
   how long a used needle has been exposed.

   Teaching mode names what is wrong the moment it goes wrong. A scored shift
   shows the arm and the clock and says nothing — the assessment arrives
   after the patient.

   Full re-renders are gated on a structural signature; the numbers that tick
   every frame are patched through [data-live], because re-rendering on a
   ticking clock would drop keyboard focus, re-announce the whole aria-live
   region, and destroy buttons out from under an in-flight click.
   ========================================================================= */
import {
  nextIssue, nextAction, modeReady, safetyActionFor, DEVICE,
} from "./withdrawalRules.js";
import { gauzeReady, exposedSeconds } from "./withdrawalState.js";
import { stepGuideHTML, stepHintHTML, guideSignature } from "../stepGuide.js";

/* How each of the four handling gestures is performed — behind that step's own
   disclosure now rather than printed under every frame of it. What used to be
   here restated `nextAction()` almost sentence for sentence. See stepGuide.js. */
const HOW = {
  release: `<p><b>Tell the patient to open their hand first</b>, then find the band's tucked tail and pull it
    free — one pull on the tucked loop is what the tuck was for.</p>
    <p>Steady the holder with your other hand while you reach: the needle is still in the vein, and a
    congested vein bleeds hard through a fresh puncture if the needle comes out under tension.</p>`,
  withdraw: `<p><b>Gauze first.</b> Drag the pad from the bench and rest it just above the puncture — close
    enough to press the instant the needle is out, but no pressure yet, because the needle is still in.</p>
    <p><b>Then draw the needle back along the line it went in.</b> Take hold of the holder and pull steadily
    outward — smooth, on the line, no sideways lever and no yank.</p>`,
  safety: `<p><b>Engage the device's own safety, one-handed, in the air</b> — never against the bench, never
    back into the cap. It clicks when it locks.</p>
    <p>Most needlestick injuries happen in the few seconds between the needle leaving the arm and the safety
    going on, which is why this comes before anything else you might want to do for the patient.</p>`,
  dispose: `<p><b>Straight into the sharps container, the whole unit.</b> Needle and holder together — taking
    them apart by hand is the other way people get stuck.</p>
    <p>Route around the patient, not over them, and do not put it down anywhere on the way.</p>`,
};

function esc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }
function mm(m){ return Math.round((m || 0)*1000*10)/10; }

const MODE_TITLES = {
  release: "Release the tourniquet",
  withdraw: "Withdraw the needle",
  safety: "Activate the safety",
  dispose: "Dispose of the sharp",
};

const READY_LABELS = {
  release: "Band is off ▶",
  withdraw: "Needle is out ▶",
  safety: "Safety locked ▶",
  dispose: "Sharp disposed ▶",
};

function bandText(o){
  if(!o.tourniquetOn) return "off";
  const s = o.tourniquetSeconds;
  return s == null ? "on" : `on — ${Math.round(s)}s`;
}

function depthText(state){
  if(state.withdrawnAt != null) return "out";
  return `${mm(state.depthM)}mm deep`;
}

function gauzeText(state){
  if(state.gauzeTakenAt == null) return "on the bench";
  if(state.gauzePlacedAt == null) return "in hand";
  if(gauzeReady(state)) return "ready above the site";
  return `${Math.round((state.gauzeOffsetM || 0)*1000)}mm from the site`;
}

function safetyText(state){
  if(state.safetyLockedAt != null) return state.surfaceActivated ? "locked (against the bench)" : "locked";
  if(state.withdrawnAt == null) return "—";
  return `${Math.round(state.safetyTravel*100)}% · exposed ${Math.round(exposedSeconds(state))}s`;
}

function disposeText(state){
  if(state.disposedAt == null) return state.setDownAfterSafety || state.exposedSetDown ? "SET DOWN" : "in hand";
  return state.disposedFully ? "in the container" : "in the aperture";
}

function rowsHTML(state, o, mode){
  const rows = [
    ["Band", bandText(o), o.tourniquetOn && (o.tourniquetSeconds || 0) > 60 ? "bad" : (o.tourniquetOn ? "" : "good"), "band"],
    ["Needle", depthText(state), state.withdrawnAt != null ? "good" : "", "depth"],
    ["Gauze", gauzeText(state), gauzeReady(state) ? "good" : "", "gauze"],
  ];
  if(mode === "safety" || mode === "dispose" || state.withdrawnAt != null){
    rows.push(["Safety", safetyText(state), state.safetyLockedAt != null ? (state.surfaceActivated ? "bad" : "good") : "wait", "safety"]);
  }
  if(mode === "dispose"){
    rows.push(["Sharp", disposeText(state), state.disposedAt != null && state.disposedFully ? "good" : "", "sharp"]);
  }
  return rows.map(([lab, val, cls, live])=>`<div class="asm-row">
      <span class="asm-lab">${esc(lab)}</span>
      <span class="asm-val ${cls}" data-live="${live}">${esc(val)}</span>
    </div>`).join("");
}

/**
 * The controls are built from the STATE of the arm, not from which of the four
 * step ids is running — the same rule the gesture path's own hit-testing uses.
 * A band still on the patient can still be taken off from the withdraw step; a
 * needle still in the vein can still be withdrawn from the safety step.
 * Anything else would leave a learner who got the order wrong with no way back.
 */
function controlsHTML(state, o){
  const sets = [];

  if(!o.tourniquetReleased){
    sets.push(`<fieldset>
      <legend>Release the band</legend>
      <div class="asm-actions">
        ${state.fistRelaxed ? "" : `<button class="stg-mini" data-wd="fist">“You can open your hand now.”</button>`}
        <button class="stg-mini" data-wd="release">Pull the band's tail free</button>
      </div>
    </fieldset>`);
  }

  if(state.withdrawnAt == null){
    sets.push(`<fieldset>
      <legend>Gauze, then the needle</legend>
      <div class="asm-actions">
        ${state.gauzeTakenAt == null ? `<button class="stg-mini" data-wd="gauze-take">Pick up the gauze</button>` : ""}
        ${state.gauzeTakenAt != null ? `<button class="stg-mini" data-wd="gauze-place">Rest it just above the site</button>
        <button class="stg-mini" data-wd="gauze-press">Press it down now</button>` : ""}
        <button class="stg-mini" data-wd="withdraw-smooth">Withdraw smoothly along the line</button>
        <button class="stg-mini" data-wd="withdraw-rough">Pull it out in one fast yank</button>
      </div>
    </fieldset>`);
  }

  if(state.withdrawnAt != null && state.safetyLockedAt == null){
    const action = safetyActionFor(state.device);
    sets.push(`<fieldset>
      <legend>${esc(state.device === DEVICE.BUTTERFLY ? "Retract the needle" : "Shield the needle")}</legend>
      <div class="asm-actions">
        <button class="stg-mini" data-wd="safety-hand">${esc(action.description)}</button>
        <button class="stg-mini" data-wd="safety-partial">Slide it part-way and stop</button>
        <button class="stg-mini" data-wd="safety-surface">Press it against the bench instead</button>
        <button class="stg-mini" data-wd="recap">Put the cap back on by hand</button>
        <button class="stg-mini" data-wd="setdown">Set the unit down for a moment</button>
      </div>
    </fieldset>`);
  }

  if(state.withdrawnAt != null && !(state.disposedAt != null && state.disposedFully)){
    sets.push(`<fieldset>
      <legend>Where does it go?</legend>
      <div class="asm-actions">
        <button class="stg-mini" data-wd="dispose-sharps">Drop the whole unit into the sharps container</button>
        <button class="stg-mini" data-wd="dispose-crossed">Carry it over the patient to the container</button>
        <button class="stg-mini" data-wd="dispose-trash">Drop it in the ordinary waste</button>
        ${state.safetyLockedAt != null ? `<button class="stg-mini" data-wd="setdown">Set it down on the bench</button>` : ""}
      </div>
    </fieldset>`);
  }

  return sets.length ? `<div class="asm-controls">${sets.join("")}</div>` : "";
}

/**
 * Prompts the next thing that actually needs doing on this arm, in clinical
 * order — state-driven for the same reason the controls are.
 */

export function renderWithdrawalCoach(host, o){
  const { state, result, mode } = o;
  const guided = !!o.guided;
  const listView = !!o.listView;
  const issue = nextIssue(result);
  const ready = !!o.ready;
  const clean = ready && !(issue && issue.severity === "block");

  const signature = [
    mode, listView, guided, ready, o.hint || "-",
    o.live ? o.live.tourniquetOn : "-",
    state.fistRelaxed,
    state.releasedAt != null,
    state.gauzeTakenAt != null,
    state.gauzePlacedAt != null,
    state.gauzePressedEarly,
    state.withdrawnAt != null,
    state.safetyLockedAt != null,
    state.surfaceActivated, state.recapAttempted, state.exposedSetDown,
    state.disposedAt != null, state.disposedFully, state.trashAttempts,
    issue ? issue.code : "-",
    guideSignature(),
  ].join("|");

  const live = o.live || { tourniquetOn: false, tourniquetSeconds: null, tourniquetReleased: true };

  if(host.dataset.wdSig === signature){ patchLive(host, state, live); return; }
  host.dataset.wdSig = signature;

  host.innerHTML = `
    <div class="asm-coach">
      <div class="stg-topline">
        <span class="stg-mode">${esc(MODE_TITLES[mode] || mode)}</span>
        <div class="stg-toggles">
          ${o.canRender3d ? `<button class="stg-toggle" id="wdView" aria-pressed="${listView}">${listView ? "Use the arm" : "Use controls"}</button>` : ""}
        </div>
      </div>

      <div class="asm-panel">
        ${rowsHTML(state, Object.assign({ tourniquetReleased: live.tourniquetReleased }, live), mode)}
      </div>

      ${guided
        ? stepGuideHTML({
            /* `clean` is ready AND unblocked; readiness itself is the coarser
               `ready`, which is what ends the step. */
            ready,
            tone: clean ? "ready" : (issue && issue.severity === "block" ? "block" : "warn"),
            lead: clean ? "" : (issue ? (issue.severity === "block" ? "Not yet." : issue.severity === "warn" ? "Worth fixing." : "Now.") : ""),
            line: clean || !issue
              ? nextAction(state, { tourniquetReleased: live.tourniquetReleased }, mode)
              : issue.message,
            how: HOW[mode] || "",
          })
        : stepHintHTML(o.hint, ready)}

      ${listView ? controlsHTML(state, { tourniquetReleased: live.tourniquetReleased }) : ""}


      ${/* PLAY'S ESCAPE HATCH, AND ONLY PLAY'S — see cleaningCoach.js for why. */
        guided ? "" : `<button class="btn vp-tap quiet" id="wdReady">Carry on ▶</button>`}

    </div>`;

  const h = o.handlers || {};
  const bind = (id, fn)=>{ const el = host.querySelector("#"+id); if(el && fn) el.onclick = fn; };
  bind("wdView", h.onToggleView);
  bind("wdReady", ()=>{ if((!guided || ready) && h.onReady) h.onReady(); });
  host.querySelectorAll("[data-wd]").forEach(b=>{
    b.onclick = ()=>h.onAction && h.onAction(b.dataset.wd);
  });
}

function patchLive(host, state, live){
  const set = (name, text)=>{
    const el = host.querySelector(`[data-live="${name}"]`);
    if(el && el.textContent !== text) el.textContent = text;
  };
  set("band", bandText(live));
  set("depth", depthText(state));
  set("gauze", gauzeText(state));
  set("safety", safetyText(state));
  set("sharp", disposeText(state));
}
