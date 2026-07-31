/* =========================================================================
   ASSEMBLY COACH — the DOM layer while the unit is being built and uncapped.

   Everything the learner can SEE is on the bench: how far the pouch is
   peeled, how far the needle has gone in, whether it is canted, where the
   bevel points. This panel reports only what the bench cannot show — the
   turn count, the alignment in degrees, how much of the cap's travel was
   axial — and coaches in teaching mode. In a scored shift it reports the
   observations and no verdict at all until after the patient.

   Full re-renders are gated on a structural signature; anything that ticks
   is patched through [data-live], because re-rendering an aria-live region on
   a clock drops focus and destroys buttons under an in-flight click.
   ========================================================================= */
import {
  nextIssue, nextAssemblyAction, nextUncapAction,
  SNUG_TURNS, SECURE_TURNS, CROSS_THREAD_DEG, BEVEL_TOLERANCE_DEG, AXIAL_GOOD, bevelFromTurns,
} from "./assemblyRules.js";

function esc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }

function msgBlock(guided, ready, issue, action, readyText, hint){
  if(!guided){
    return `<div class="stg-msg neutral" role="status" aria-live="polite">
      ${hint ? `<b>Reminder.</b> ${esc(hint)}` : `Build the unit and carry on when you judge it right. Your technique is assessed after the patient.`}
    </div>`;
  }
  return `<div class="stg-msg ${ready ? "ready" : (issue && issue.severity === "block" ? "block" : "warn")}" role="status" aria-live="polite">
      ${ready ? readyText
              : issue ? `<b>${issue.severity === "block" ? "Not yet." : "Worth fixing."}</b> ${esc(issue.message)}`
                      : esc(action)}
    </div>
    <p class="tq-next">${esc(action)}</p>`;
}

/* =========================================================================
   ASSEMBLE
   ========================================================================= */

function threadHTML(state, unit){
  const turns = state.turns;
  const pct = Math.max(0, Math.min(100, Math.round(turns/SNUG_TURNS*100)));
  return `<div class="asm-panel">
    <div class="asm-row">
      <span class="asm-lab">Pouch</span>
      <span class="asm-val" data-live="peel">${state.pouchOpen ? (state.pouchTorn ? "torn open" : "peeled open") : `${Math.round(state.peel*100)}% peeled`}</span>
    </div>
    <div class="asm-row">
      <span class="asm-lab">Turns</span>
      <span class="asm-val ${turns >= SECURE_TURNS ? "good" : "wait"}" data-live="turns">${turns.toFixed(1)}</span>
      <span class="asm-bar" role="img" aria-label="${turns.toFixed(1)} of about ${SNUG_TURNS} turns" data-live="turnbar">
        <span class="asm-fill" style="width:${pct}%"></span>
        <span class="asm-mark" style="left:${Math.round(SECURE_TURNS/SNUG_TURNS*100)}%"></span>
      </span>
    </div>
    ${state.engaged ? `<div class="asm-row">
      <span class="asm-lab">Went on at</span>
      <span class="asm-val ${state.crossThreaded ? "bad" : "good"}" data-live="align">${Math.round(state.engageMisalignDeg)}° off axis</span>
    </div>` : ""}
    ${unit && unit.dryingSeconds != null ? `<div class="asm-row">
      <span class="asm-lab">Site drying</span>
      <span class="asm-val" data-live="drysecs">${Math.round(unit.dryingSeconds)}s</span>
    </div>` : ""}
  </div>`;
}

function assembleControlsHTML(state){
  if(!state.pouchOpen){
    return `<div class="asm-controls"><fieldset>
      <legend>Build the unit without dragging</legend>
      <div class="asm-actions">
        <button class="stg-mini" data-asm="peel">Peel the pouch open at the seam</button>
        <button class="stg-mini" data-asm="tear">Tear the pouch open across the film</button>
      </div>
    </fieldset></div>`;
  }
  if(!state.needleInHand){
    return `<div class="asm-controls"><fieldset>
      <legend>Take the needle out</legend>
      <div class="asm-actions">
        <button class="stg-mini" data-asm="lift-sheath">Lift it out by the coloured sheath</button>
        <button class="stg-mini" data-asm="lift-thread">Lift it out by the grey sleeved end</button>
      </div>
    </fieldset></div>`;
  }
  return `<div class="asm-controls"><fieldset>
    <legend>Thread it into the holder</legend>
    <div class="asm-actions">
      <button class="stg-mini" data-asm="thread-snug">Line it up and turn it to finger-tight</button>
      <button class="stg-mini" data-asm="thread-light">Line it up and give it a turn and a half</button>
      <button class="stg-mini" data-asm="thread-hard">Line it up and keep turning past tight</button>
      <button class="stg-mini" data-asm="thread-cross">Start it at an angle</button>
      ${state.engaged ? `<button class="stg-mini" data-asm="backout">Back it right off and start again</button>` : ""}
      ${state.contaminated || state.pouchCompromised ? `<button class="stg-mini" data-asm="fresh">Bin it and open a fresh needle</button>` : ""}
    </div>
  </fieldset></div>`;
}

export function renderAssemblyCoach(host, o){
  const { state, result } = o;
  const guided = !!o.guided;
  const listView = !!o.listView;
  const issue = nextIssue(result);
  const ready = result.ready;

  const signature = [
    "asm", listView, guided, ready, state.pouchOpen, state.needleInHand, state.engaged,
    state.crossThreaded, state.contaminated, state.turns >= SECURE_TURNS,
    issue ? issue.code : "-",
  ].join("|");

  if(host.dataset.asmSig === signature){ patchAssembly(host, state, o.unit); return; }
  host.dataset.asmSig = signature;

  host.innerHTML = `
    <div class="asm-coach">
      <div class="stg-topline">
        <span class="stg-mode">${listView ? "Controls" : "Build the unit"}</span>
        <div class="stg-toggles">
          ${o.canRender3d ? `<button class="stg-toggle" id="asmView" aria-pressed="${listView}">${listView ? "Use the bench" : "Use controls"}</button>` : ""}
        </div>
      </div>

      ${threadHTML(state, o.unit)}

      ${msgBlock(guided, ready, issue, nextAssemblyAction(state),
        `<b>Threaded and finger-tight.</b> ${state.turns.toFixed(1)} turns, square on the hub. Leave the sheath on until you are ready to stick.`, o.hint)}

      ${listView ? assembleControlsHTML(state) : `<p class="stg-help">
        ${!state.pouchOpen
          ? `<b>Peel the pouch open along its seam.</b> Drag from the notch and stay on the seam — tearing across the film sheds onto the needle you are about to pull through it.`
          : !state.needleInHand
            ? `<b>Take the needle out by its coloured sheath.</b> The grey sleeved end is what goes inside the holder and into every tube — fingers do not go on it.`
            : `<b>Bring the needle onto the hub along the hub's own axis, then turn it in.</b> More than ${CROSS_THREAD_DEG}° off and it cross-threads: it will feel like it is going on, bind, and never seat. Finger-tight is about ${SNUG_TURNS} turns — circle the pointer round the hub to turn it.`}
      </p>`}

      <button class="btn vp-tap" id="asmReady" ${(guided && !ready) ? "disabled" : ""} style="${(guided && !ready) ? "opacity:.5" : ""}">
        ${guided ? (ready ? "Unit built — uncap it ▶" : "Not ready yet") : "Carry on ▶"}
      </button>
    </div>`;

  const h = o.handlers || {};
  const bind = (id, fn)=>{ const el = host.querySelector("#"+id); if(el && fn) el.onclick = fn; };
  bind("asmView", h.onToggleView);
  bind("asmReady", ()=>{ if((!guided || ready) && h.onReady) h.onReady(); });
  host.querySelectorAll("[data-asm]").forEach(b=>{
    b.onclick = ()=>h.onAction && h.onAction(b.dataset.asm);
  });
}

function patchAssembly(host, state, unit){
  const set = (name, text)=>{
    const el = host.querySelector(`[data-live="${name}"]`);
    if(el && el.textContent !== text) el.textContent = text;
  };
  set("peel", state.pouchOpen ? (state.pouchTorn ? "torn open" : "peeled open") : `${Math.round(state.peel*100)}% peeled`);
  set("turns", state.turns.toFixed(1));
  if(state.engaged) set("align", `${Math.round(state.engageMisalignDeg)}° off axis`);
  if(unit && unit.dryingSeconds != null) set("drysecs", `${Math.round(unit.dryingSeconds)}s`);
  const bar = host.querySelector('[data-live="turnbar"]');
  if(bar){
    const pct = Math.max(0, Math.min(100, Math.round(state.turns/SNUG_TURNS*100)));
    bar.setAttribute("aria-label", `${state.turns.toFixed(1)} of about ${SNUG_TURNS} turns`);
    const f = bar.firstElementChild; if(f) f.style.width = `${pct}%`;
  }
}

/* =========================================================================
   UNCAP
   ========================================================================= */

function bevelOf(state){
  return state.bevelDeg == null ? bevelFromTurns(state.turns) : state.bevelDeg;
}

function uncapHTML(state){
  const bevel = bevelOf(state);
  const up = Math.abs(bevel) <= BEVEL_TOLERANCE_DEG;
  return `<div class="asm-panel">
    <div class="asm-row">
      <span class="asm-lab">Sheath</span>
      <span class="asm-val" data-live="cap">${state.capOn ? "on" : (state.capPlacedOn ? `off, on the ${state.capPlacedOn}` : "off, in your hand")}</span>
    </div>
    ${!state.capOn ? `<div class="asm-row">
      <span class="asm-lab">Pull</span>
      <span class="asm-val ${state.capAxialFraction < AXIAL_GOOD ? "bad" : "good"}" data-live="axial">${Math.round(state.capAxialFraction*100)}% along the needle</span>
    </div>` : ""}
    <div class="asm-row">
      <span class="asm-lab">Bevel</span>
      <span class="asm-val ${up ? "good" : "bad"}" data-live="bevel">${Math.round(Math.abs(bevel))}° ${up ? "— up" : "off vertical"}</span>
      <span class="asm-dial" role="img" aria-label="bevel ${Math.round(Math.abs(bevel))} degrees off vertical" data-live="dial">
        <span class="asm-needleline" style="transform:rotate(${Math.round(bevel)}deg)"></span>
      </span>
    </div>
    <div class="asm-row">
      <span class="asm-lab">Checked</span>
      <span class="asm-val ${state.bevelInspected ? "good" : "wait"}" data-live="checked">${state.bevelInspected ? (state.needleDamaged ? "yes — barbed" : "yes — intact") : "not looked at"}</span>
    </div>
  </div>`;
}

function uncapControlsHTML(state){
  return `<div class="asm-controls"><fieldset>
    <legend>Uncap without dragging</legend>
    <div class="asm-actions">
      ${state.capOn ? `
        <button class="stg-mini" data-unc="pull">Pull the sheath straight off</button>
        <button class="stg-mini" data-unc="wiggle">Wiggle the sheath off side to side</button>
        <button class="stg-mini" data-unc="twist">Twist the sheath off</button>
      ` : `
        <div class="asm-roll">
          <span>Roll the holder</span>
          <button class="stg-mini" data-unc="roll-15">↺ 15°</button>
          <button class="stg-mini" data-unc="roll+15">↻ 15°</button>
          <button class="stg-mini" data-unc="roll-45">↺ 45°</button>
          <button class="stg-mini" data-unc="roll+45">↻ 45°</button>
        </div>
        <button class="stg-mini" data-unc="look">Look closely at the bevel</button>
        ${!state.capPlacedOn ? `
          <button class="stg-mini" data-unc="cap-tray">Put the sheath on the tray</button>
          <button class="stg-mini" data-unc="cap-site">Put the sheath down on the arm</button>
          <button class="stg-mini" data-unc="recap">Put the sheath back on the needle</button>` : ""}
        <button class="stg-mini" data-unc="setdown">Set the bare unit down on the bench</button>
        ${state.needleDamaged || state.needleContaminated || state.recapped
          ? `<button class="stg-mini" data-unc="discard">Bin this unit and take a fresh one</button>` : ""}
      `}
      <button class="stg-mini ${state.warnedAt ? "on" : ""}" data-unc="warn">Tell the patient: “small poke coming”</button>
    </div>
  </fieldset></div>`;
}

export function renderUncapCoach(host, o){
  const { state, result } = o;
  const guided = !!o.guided;
  const listView = !!o.listView;
  const issue = nextIssue(result);
  const ready = result.ready;
  const bevel = bevelOf(state);

  const signature = [
    "unc", listView, guided, ready, state.capOn, state.capPlacedOn, state.bevelInspected,
    state.needleDamaged, state.needleContaminated, state.recapped, !!state.warnedAt,
    Math.abs(bevel) <= BEVEL_TOLERANCE_DEG,
    issue ? issue.code : "-",
  ].join("|");

  if(host.dataset.uncSig === signature){ patchUncap(host, state); return; }
  host.dataset.uncSig = signature;

  host.innerHTML = `
    <div class="asm-coach">
      <div class="stg-topline">
        <span class="stg-mode">${listView ? "Controls" : "Uncap"}</span>
        <div class="stg-toggles">
          ${o.canRender3d ? `<button class="stg-toggle" id="uncView" aria-pressed="${listView}">${listView ? "Use the bench" : "Use controls"}</button>` : ""}
        </div>
      </div>

      ${uncapHTML(state)}

      ${msgBlock(guided, ready, issue, nextUncapAction(state),
        `<b>Bevel up, needle intact.</b> The sheath is clear of the field and the patient has been told. Go in.`, o.hint)}

      ${listView ? uncapControlsHTML(state) : `<p class="stg-help">
        ${state.capOn
          ? `<b>Pull the sheath straight off, along the needle.</b> Levering it sideways bends the shaft and rolls the cutting edge over — and a barbed needle drags going in and shreds the sample.`
          : `<b>Where the bevel points was decided by where your threading stopped.</b> Drag the holder toward or away from you to roll it until the opening faces straight up. Hold still on the holder to lean in and check the edge. Then put the sheath down clear of the prepped field — never back on the needle.`}
      </p>`}

      ${!listView ? `<div class="asm-inline">
        <button class="btn ghost vp-tap ${state.warnedAt ? "on" : ""}" id="uncWarn">${state.warnedAt ? "✔ Patient warned" : "Tell the patient: “small poke coming”"}</button>
      </div>` : ""}

      <button class="btn vp-tap" id="uncReady" ${(guided && !ready) ? "disabled" : ""} style="${(guided && !ready) ? "opacity:.5" : ""}">
        ${guided ? (ready ? "Ready — go in ▶" : "Not ready yet") : "Carry on ▶"}
      </button>
    </div>`;

  const h = o.handlers || {};
  const bind = (id, fn)=>{ const el = host.querySelector("#"+id); if(el && fn) el.onclick = fn; };
  bind("uncView", h.onToggleView);
  bind("uncWarn", ()=>h.onAction && h.onAction("warn"));
  bind("uncReady", ()=>{ if((!guided || ready) && h.onReady) h.onReady(); });
  host.querySelectorAll("[data-unc]").forEach(b=>{
    b.onclick = ()=>h.onAction && h.onAction(b.dataset.unc);
  });
}

function patchUncap(host, state){
  const set = (name, text)=>{
    const el = host.querySelector(`[data-live="${name}"]`);
    if(el && el.textContent !== text) el.textContent = text;
  };
  const bevel = bevelOf(state);
  const up = Math.abs(bevel) <= BEVEL_TOLERANCE_DEG;
  set("cap", state.capOn ? "on" : (state.capPlacedOn ? `off, on the ${state.capPlacedOn}` : "off, in your hand"));
  if(!state.capOn) set("axial", `${Math.round(state.capAxialFraction*100)}% along the needle`);
  set("bevel", `${Math.round(Math.abs(bevel))}° ${up ? "— up" : "off vertical"}`);
  const dial = host.querySelector('[data-live="dial"]');
  if(dial){
    dial.setAttribute("aria-label", `bevel ${Math.round(Math.abs(bevel))} degrees off vertical`);
    const n = dial.firstElementChild; if(n) n.style.transform = `rotate(${Math.round(bevel)}deg)`;
  }
}
