/* =========================================================================
   TUBE COLLECTION COACH — the DOM layer while the tubes go on and off.

   The tube itself is on screen and visibly filling, so this reports what is
   NOT visible from the bedside: the volume against this tube's own draw
   volume, the ratio its additive actually needs, how far the needle has been
   moved in the vein, and the band's clock still running underneath all of it.

   Teaching mode names the order of draw and says what went wrong the moment
   it goes wrong. A scored shift shows an inventory and says nothing — the
   assessment arrives after the patient.

   Full re-renders are gated on a structural signature; the numbers that tick
   every frame are patched through [data-live], because re-rendering on a
   ticking fill would drop keyboard focus, re-announce the whole aria-live
   region, and destroy buttons out from under an in-flight click.
   ========================================================================= */
import {
  nextIssue, nextAction, tubeName, requiredFraction, ratioCritical,
  expectedOrder, lumenToleranceM, SEAT_GUIDELINE, SEAT_ENGAGE,
} from "./collectionRules.js";
import { current } from "./collectionState.js";
import { wingStatusHTML, infiltrationBannerHTML, postEntryControlsHTML, patchWingLive } from "../butterfly/butterflyCoach.js";
import { stepGuideHTML, stepHintHTML, guideSignature } from "../stepGuide.js";

/* How the gesture is performed — behind the step's disclosure now rather than
   printed under every frame of it. What used to be here was a per-state
   paragraph that restated `nextAction()` sentence for sentence, in bold, four
   lines below it. See stepGuide.js. */
const HOW = `<p><b>Drag the next tube off the rack and into the holder.</b> Which one you reach for is the
  order of draw — the last tube's additive goes through the same needle into this one.</p>
  <p><b>Push it on by dragging along the holder, pressing on the flange</b>, not the tube: the fingers
  hooked behind the flange are what stop the push going into the patient's arm. Nothing is pierced until
  it passes the guideline.</p>
  <p><b>Then wait.</b> The vacuum stops on its own when the tube is full — that is the thing to watch for.
  Pulling it off early leaves it short. If the flow stops before then the vein has collapsed onto the tip:
  back the tube off to the guideline to break the vacuum, let the vein refill, and push it back on.</p>`;

function esc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }
function mm(m){ return Math.round((m || 0)*1000); }
function pct(f){ return Math.round((f || 0)*100); }

function fillText(t){
  if(!t) return "—";
  return `${t.drawnMl.toFixed(1)} / ${t.volumeMl.toFixed(1)} mL`;
}

function seatText(state){
  const d = state.seatDepth;
  if(!state.currentKey) return "no tube";
  if(d >= SEAT_ENGAGE) return "engaged";
  if(d >= SEAT_GUIDELINE) return "at the guideline";
  if(d > 0) return "in the mouth";
  return "resting";
}

function tubeRowsHTML(state, result){
  const cur = result.current;
  const shiftMm = mm(state.needleShiftM);
  const tolMm = mm(lumenToleranceM(state.vessel));
  return `<div class="asm-row">
      <span class="asm-lab">Tube</span>
      <span class="asm-val" data-live="tubeName">${cur ? esc(tubeName(cur.key)) : "—"}</span>
    </div>
    <div class="asm-row">
      <span class="asm-lab">Seated</span>
      <span class="asm-val ${cur && cur.pierced ? "good" : "wait"}" data-live="seat">${esc(seatText(state))}</span>
    </div>
    <div class="asm-row">
      <span class="asm-lab">Drawn</span>
      <span class="asm-val ${cur && cur.drawnMl >= cur.volumeMl ? "good" : ""}" data-live="fill">${fillText(cur)}</span>
    </div>
    ${cur ? `<div class="asm-row">
      <span class="asm-lab">Ratio needs</span>
      <span class="asm-val ${cur.drawnMl/cur.volumeMl >= requiredFraction(cur.key) ? "good" : "bad"}" data-live="ratio">${pct(requiredFraction(cur.key))}%${ratioCritical(cur.key) ? " (fixed)" : ""}</span>
    </div>` : ""}
    <div class="asm-row">
      <span class="asm-lab">Needle</span>
      <span class="asm-val ${state.needleOut ? "bad" : (shiftMm > tolMm*0.55 ? "" : "good")}" data-live="shift">${state.needleOut ? "out of the vein" : `${shiftMm}mm moved`}</span>
    </div>`;
}

function collectedHTML(state){
  const done = state.order.filter(k => state.tubes[k] && state.tubes[k].removedAt);
  if(!done.length) return "";
  return `<div class="asm-row">
      <span class="asm-lab">Collected</span>
      <span class="asm-val" data-live="collected">${done.map(k=>{
        const t = state.tubes[k];
        return `${esc(tubeName(k))} ${pct(t.drawnMl/t.volumeMl)}%`;
      }).join(" · ")}</span>
    </div>`;
}

function controlsHTML(state, result){
  const cur = result.current;
  if(!cur){
    const remaining = result.remaining || [];
    const redrawable = result.redrawable || [];
    if(!remaining.length && !redrawable.length) return "";
    return `<div class="asm-controls"><fieldset>
      <legend>Take a tube off the rack</legend>
      <div class="asm-actions">
        ${remaining.map(k=>`<button class="stg-mini" data-col="take:${esc(k)}">Take the ${esc(tubeName(k))} tube</button>`).join("")}
        ${redrawable.map(k=>`<button class="stg-mini" data-col="take:${esc(k)}">Take another ${esc(tubeName(k))} tube and draw it again</button>`).join("")}
      </div>
    </fieldset></div>`;
  }
  if(!cur.pierced){
    return `<div class="asm-controls"><fieldset>
      <legend>Seat the tube</legend>
      <div class="asm-actions">
        <button class="stg-mini" data-col="push-braced">Push it on holding the flange</button>
        <button class="stg-mini" data-col="push-unbraced">Push it on by the tube alone</button>
        <button class="stg-mini" data-col="return">Put it back on the rack</button>
      </div>
    </fieldset></div>`;
  }
  return `<div class="asm-controls"><fieldset>
    <legend>While it fills</legend>
    <div class="asm-actions">
      <button class="stg-mini" data-col="wait">Wait five seconds</button>
      <button class="stg-mini" data-col="backoff">Back it off to the guideline</button>
      <button class="stg-mini" data-col="remove-braced">Pull it off, flange held</button>
      <button class="stg-mini" data-col="remove-unbraced">Pull it off by the tube alone</button>
      ${cur.deadOnAir ? `<button class="stg-mini" data-col="discard">Bin it and take a fresh one</button>` : ""}
    </div>
  </fieldset></div>`;
}


export function renderCollectionCoach(host, o){
  const { state, result } = o;
  const guided = !!o.guided;
  const listView = !!o.listView;
  const cur = result.current;
  const issue = nextIssue(result);
  // `fill` finishes on the first tube and `switch` on the last, so the step
  // decides what "done" means here; the RULES stay the same either way.
  const ready = o.ready == null ? result.ready : !!o.ready;
  // Finished is not the same as done well. Some of what can go wrong here is
  // irreversible — additive already carried through the needle cannot be
  // un-carried — so the step can be over while the specimen is still wrong,
  // and saying "filled to its draw volume" over the top of that would be a
  // lie the learner would believe.
  const clean = ready && !(issue && issue.severity === "block");

  const bf = o.butterfly || null;
  const signature = [
    listView, guided, ready, o.hint || "-",
    cur ? cur.key : "-",
    cur ? cur.pierced : "-",
    cur ? cur.collapsed : "-",
    cur ? cur.deadOnAir : "-",
    cur ? (cur.drawnMl >= cur.volumeMl) : "-",
    state.needleOut,
    result.remaining.length,
    result.redrawable.length,
    issue ? issue.code : "-",
    bf ? bf.secured : "-", bf ? (bf.infiltratedMl > 0) : "-", bf ? bf.infiltrationNoticed : "-",
    guideSignature(),
  ].join("|");

  if(host.dataset.colSig === signature){ patchLive(host, state, result, bf); return; }
  host.dataset.colSig = signature;

  const order = expectedOrder(state.order);

  host.innerHTML = `
    <div class="asm-coach">
      <div class="stg-topline">
        <span class="stg-mode">${listView ? "Controls" : (cur ? `Filling ${esc(tubeName(cur.key))}` : "Next tube")}</span>
        <div class="stg-toggles">
          ${o.canRender3d ? `<button class="stg-toggle" id="colView" aria-pressed="${listView}">${listView ? "Use the arm" : "Use controls"}</button>` : ""}
        </div>
      </div>

      <div class="asm-panel">
        ${tubeRowsHTML(state, result)}
        ${collectedHTML(state)}
        ${bf ? wingStatusHTML(bf) : ""}
      </div>

      ${bf ? infiltrationBannerHTML(bf) : ""}

      ${guided
        ? stepGuideHTML({
            tone: clean ? "ready" : (issue && issue.severity === "block" ? "block" : "warn"),
            lead: clean ? "" : (issue ? (issue.severity === "block" ? "Not yet." : issue.severity === "warn" ? "Worth fixing." : "Going on now.") : ""),
            line: clean
              ? (o.readyMessage || "Every tube is filled to its draw volume, in order. The band comes off next.")
              : (issue ? issue.message : nextAction(state, result)),
            /* The order of draw is a FACT this step needs on screen, not a
               second phrasing of the instruction — so it stays visible. */
            note: `Order of draw: ${order.map(k=>esc(tubeName(k))).join(" → ")}`,
            how: HOW,
          })
        : stepHintHTML(o.hint)}

      ${listView ? controlsHTML(state, result) : ""}

      ${bf ? postEntryControlsHTML(bf) : ""}

      <button class="btn vp-tap${guided ? "" : " quiet"}" id="colReady" ${(guided && !ready) ? "disabled" : ""} style="${(guided && !ready) ? "opacity:.5" : ""}">
        ${guided ? (ready ? esc(o.readyLabel || "All tubes collected ▶") : "Not finished yet") : "Carry on ▶"}
      </button>
    </div>`;

  const h = o.handlers || {};
  const bind = (id, fn)=>{ const el = host.querySelector("#"+id); if(el && fn) el.onclick = fn; };
  bind("colView", h.onToggleView);
  bind("colReady", ()=>{ if((!guided || ready) && h.onReady) h.onReady(); });
  host.querySelectorAll("[data-col]").forEach(b=>{
    b.onclick = ()=>h.onAction && h.onAction(b.dataset.col);
  });
  host.querySelectorAll("[data-wing]").forEach(b=>{
    b.onclick = ()=>h.onWing && h.onWing(b.dataset.wing);
  });
}

function patchLive(host, state, result, bf){
  const set = (name, text)=>{
    const el = host.querySelector(`[data-live="${name}"]`);
    if(el && el.textContent !== text) el.textContent = text;
  };
  const cur = current(state);
  set("tubeName", cur ? tubeName(cur.key) : "—");
  set("seat", seatText(state));
  set("fill", fillText(cur));
  if(cur) set("ratio", `${pct(requiredFraction(cur.key))}%${ratioCritical(cur.key) ? " (fixed)" : ""}`);
  set("shift", state.needleOut ? "out of the vein" : `${mm(state.needleShiftM)}mm moved`);
  const done = state.order.filter(k => state.tubes[k] && state.tubes[k].removedAt);
  if(done.length) set("collected", done.map(k=>{
    const t = state.tubes[k];
    return `${tubeName(k)} ${pct(t.drawnMl/t.volumeMl)}%`;
  }).join(" · "));
  patchWingLive(host, bf);
}
