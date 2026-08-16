/* =========================================================================
   TUBE INVERSION COACH — the DOM layer while the tubes are mixed.

   The tube turning and the blood slumping to whichever end is down are both
   visible, so this reports what is not: how many inversions THIS additive
   needs, how many have actually counted, how fast the tube has been swung
   against the threshold that shears cells, and how long it sat before anyone
   picked it up.

   Teaching mode names the count and says what went wrong as it goes. A scored
   shift shows an inventory and stays quiet.

   Full re-renders are gated on a structural signature; the values that tick as
   a tube turns are patched through [data-live].
   ========================================================================= */
import {
  nextIssue, nextAction, inversionsFor, mustNotMix, requiresMixing,
  tubeName, additiveOf, haemolysisGrade, SHAKE_DEG_PER_S, OVER_AT,
} from "./inversionRules.js";

function esc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }

function countText(state, result){
  const held = result.held;
  if(!held) return "—";
  if(mustNotMix(held.key)) return "must not be mixed";
  return `${held.inversions} of ${inversionsFor(held.key).ideal}`;
}

function tiltText(result){
  const held = result.held;
  if(!held) return "—";
  return `${Math.round(held.tilt)}° · peak ${Math.round(held.peakTilt)}°`;
}

function speedText(result){
  const held = result.held;
  if(!held) return "—";
  if(held.peakDegPerS === 0) return "still";
  return held.peakDegPerS > SHAKE_DEG_PER_S
    ? `${Math.round(held.peakDegPerS)}°/s — shaking`
    : `${Math.round(held.peakDegPerS)}°/s — gentle`;
}

function specimenText(result){
  const held = result.held;
  if(!held) return "—";
  if(haemolysisGrade(held.haemolysis) === "rejected") return "haemolysed";
  if(haemolysisGrade(held.haemolysis) === "visible") return "haemolysing";
  if(held.clotting === "clotted") return "clotted";
  if(held.clotting === "microclots") return "micro-clots";
  return "good";
}

function rackedText(state){
  const done = state.order.filter(k => state.tubes[k] && state.tubes[k].rackedAt != null);
  if(!done.length) return "none yet";
  return done.map(k => `${tubeName(k)} ${state.tubes[k].inversions}×`).join(" · ");
}

function rowsHTML(state, result){
  const held = result.held;
  const rows = [
    ["Tube", held ? `${tubeName(held.key)} — ${additiveOf(held.key)}` : "none in hand", "", "tube"],
    ["Inversions", countText(state, result),
      held && !mustNotMix(held.key) && held.inversions >= inversionsFor(held.key).min ? "good" : "wait", "count"],
    ["Turn", tiltText(result), held && held.tilt >= OVER_AT ? "good" : "", "tilt"],
    ["Speed", speedText(result),
      held && held.peakDegPerS > SHAKE_DEG_PER_S ? "bad" : (held && held.peakDegPerS > 0 ? "good" : ""), "speed"],
    ["Specimen", specimenText(result), specimenText(result) === "good" ? "good" : "bad", "specimen"],
    ["Racked", rackedText(state), "", "racked"],
  ];
  return rows.map(([lab, val, cls, live])=>`<div class="asm-row">
      <span class="asm-lab">${esc(lab)}</span>
      <span class="asm-val ${cls}" data-live="${live}">${esc(val)}</span>
    </div>`).join("");
}

function controlsHTML(state, result){
  const held = result.held;
  if(!held){
    const pickable = state.order.filter(k => state.tubes[k]);
    return `<div class="asm-controls"><fieldset>
      <legend>Pick a tube up</legend>
      <div class="asm-actions">
        ${pickable.map(k=>`<button class="stg-mini" data-inv="pick:${esc(k)}">Pick up the ${esc(tubeName(k))} tube${state.tubes[k].rackedAt != null ? " again" : ""}</button>`).join("")}
      </div>
    </fieldset></div>`;
  }
  return `<div class="asm-controls"><fieldset>
    <legend>${esc(tubeName(held.key))} — ${esc(additiveOf(held.key))}</legend>
    <div class="asm-actions">
      ${requiresMixing(held.key) ? `
        <button class="stg-mini" data-inv="mix">Invert it gently to the full count</button>
        <button class="stg-mini" data-inv="one">Invert it once</button>
        <button class="stg-mini" data-inv="rock">Rock it back and forth a few times</button>
        <button class="stg-mini" data-inv="slow">Turn it over very slowly</button>
        <button class="stg-mini" data-inv="shake">Shake it up and down</button>` : ""}
      <button class="stg-mini" data-inv="rack">Stand it back in the rack</button>
    </div>
  </fieldset></div>`;
}

function helpHTML(state, result){
  const held = result.held;
  if(!held){
    return `<b>Pick a tube up off the rack.</b> Drag it out and up to your hand. Each additive needs its own number of inversions — the count is not the same for every cap colour.`;
  }
  if(mustNotMix(held.key)){
    return `<b>${esc(tubeName(held.key))} has no additive.</b> It has to sit still and clot undisturbed, so put it straight back in the rack — this is the one tube you do NOT invert.`;
  }
  const spec = inversionsFor(held.key);
  if(held.inversions < spec.min){
    return `<b>Turn it all the way over and back.</b> Drag in an arc around your hand: past ${OVER_AT}° is over, and back upright completes one. ${esc(additiveOf(held.key))} needs ${spec.ideal}. Watch the blood travel the length of the tube — if it does not, the additive at the bottom is not being reached. Gently: shaking it bursts red cells.`;
  }
  return `<b>That one is mixed.</b> Drag it back to the rack and stand it up.`;
}

export function renderInversionCoach(host, o){
  const { state, result } = o;
  const guided = !!o.guided;
  const listView = !!o.listView;
  const issue = nextIssue(result);
  const ready = result.allHandled;
  const clean = ready && !(issue && issue.severity === "block");
  const held = result.held;

  const signature = [
    listView, guided, ready,
    state.heldKey || "-",
    held ? held.inversions : "-",
    held ? (held.tilt >= OVER_AT) : "-",
    held ? haemolysisGrade(held.haemolysis) : "-",
    held ? held.clotting : "-",
    result.pending.length,
    result.racked.length,
    issue ? issue.code : "-",
  ].join("|");

  if(host.dataset.invSig === signature){ patchLive(host, state, result); return; }
  host.dataset.invSig = signature;

  host.innerHTML = `
    <div class="asm-coach">
      <div class="stg-topline">
        <span class="stg-mode">${held ? `Mixing ${esc(tubeName(held.key))}` : "Mix the tubes"}</span>
        <div class="stg-toggles">
          ${o.canRender3d ? `<button class="stg-toggle" id="invView" aria-pressed="${listView}">${listView ? "Use the bench" : "Use controls"}</button>` : ""}
        </div>
      </div>

      <div class="asm-panel">
        ${rowsHTML(state, result)}
      </div>

      ${guided
        ? `<div class="stg-msg ${clean ? "ready" : (issue && issue.severity === "block" ? "block" : "warn")}" role="status" aria-live="polite">
            ${clean
              ? `<b>${esc(nextAction(state, result))}</b>`
              : issue ? `<b>${issue.severity === "block" ? "Not yet." : issue.severity === "warn" ? "Worth fixing." : "Now."}</b> ${esc(issue.message)}`
                      : esc(nextAction(state, result))}
          </div>
          <p class="tq-next">Required: ${state.order.map(k=>{
            const spec = inversionsFor(k);
            return `${esc(tubeName(k))} ${spec.mustNotMix ? "none" : spec.ideal + "×"}`;
          }).join(" · ")}</p>`
        : (o.hint ? `<div class="stg-msg neutral" role="status" aria-live="polite"><b>Reminder.</b> ${esc(o.hint)}</div>` : "")}

      ${listView
        ? controlsHTML(state, result)
        : `${guided ? `<p class="stg-help">${helpHTML(state, result)}</p>` : ""}`}

      <button class="btn vp-tap${guided ? "" : " quiet"}" id="invReady" ${(guided && !ready) ? "disabled" : ""} style="${(guided && !ready) ? "opacity:.5" : ""}">
        ${guided ? (ready ? "Specimens mixed ▶" : "Not finished yet") : "Carry on ▶"}
      </button>
    </div>`;

  const h = o.handlers || {};
  const bind = (id, fn)=>{ const el = host.querySelector("#"+id); if(el && fn) el.onclick = fn; };
  bind("invView", h.onToggleView);
  bind("invReady", ()=>{ if((!guided || ready) && h.onReady) h.onReady(); });
  host.querySelectorAll("[data-inv]").forEach(b=>{
    b.onclick = ()=>h.onAction && h.onAction(b.dataset.inv);
  });
}

function patchLive(host, state, result){
  const set = (name, text)=>{
    const el = host.querySelector(`[data-live="${name}"]`);
    if(el && el.textContent !== text) el.textContent = text;
  };
  const held = result.held;
  set("tube", held ? `${tubeName(held.key)} — ${additiveOf(held.key)}` : "none in hand");
  set("count", countText(state, result));
  set("tilt", tiltText(result));
  set("speed", speedText(result));
  set("specimen", specimenText(result));
  set("racked", rackedText(state));
}
