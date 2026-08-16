/* =========================================================================
   PRESSURE AND BANDAGE COACH — the DOM layer for the end of patient care.

   The pad sinking into the skin and the bruise spreading are both visible on
   the arm, so this reports what is NOT visible from the bedside: the force as
   a percentage against this site's own adequacy band, how many of the seconds
   held actually counted, and how much blood has gone into the tissue.

   Teaching mode names what is wrong the moment it goes wrong. A scored shift
   shows the arm and says nothing.

   Full re-renders are gated on a structural signature; everything that ticks
   while a pad is held is patched through [data-live], because re-rendering on
   a live force reading would drop keyboard focus, re-announce the whole
   aria-live region, and destroy buttons out from under an in-flight click.
   ========================================================================= */
import { nextIssue, nextAction, forceBandFor, SITE_KIND } from "./postDrawRules.js";
import { secondsRemaining, meanForce } from "./postDrawState.js";

function esc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }
function pct(v){ return Math.round((v || 0)*100); }

const MODE_TITLES = { pressure: "Apply pressure", bandage: "Dress the site" };
const READY_LABELS = { pressure: "Bleeding stopped ▶", bandage: "Site dressed ▶" };

function forceText(state){
  const band = forceBandFor(state.siteKind);
  if(state.padOffSite) return "not on the site";
  if(state.force <= 0.02) return "not pressing";
  const f = pct(state.force);
  if(state.force < band.min) return `${f}% — too light`;
  if(state.force > band.discomfort) return `${f}% — hurting`;
  return `${f}% — firm`;
}

function holdText(state){
  if(state.clotProgress >= 1) return "clot is holding";
  const left = secondsRemaining(state);
  return `${Math.round(state.effectiveSeconds)}s of ${Math.round(state.holdSeconds)}s · ${Math.round(left)}s to go`;
}

function siteText(state){
  if(state.clotProgress >= 1){
    return state.checkedAt != null && !state.bleedingAtCheck ? "checked — dry" : "stopped";
  }
  return state.extravasatedMl > 0.05
    ? `bleeding · ${state.extravasatedMl.toFixed(2)}mL into the tissue`
    : "bleeding";
}

function bruiseText(state){
  if(state.extravasatedMl >= 1.1) return "hematoma";
  if(state.extravasatedMl >= 0.35) return "bruising";
  return "none";
}

function bandageText(state){
  if(state.bandagedAt == null) return "not applied";
  return `${Math.round(state.bandageAlignM*1000)}mm off · ${pct(state.bandageTightness)}% tension`;
}

function rowsHTML(state, mode){
  const band = forceBandFor(state.siteKind);
  const rows = [
    ["Force", forceText(state),
      state.force <= 0.02 ? "" : (state.force < band.min || state.force > band.discomfort ? "bad" : "good"), "force"],
    ["Hold", holdText(state), state.clotProgress >= 1 ? "good" : "wait", "hold"],
    ["Site", siteText(state), state.clotProgress >= 1 ? "good" : "bad", "site"],
    ["Arm", state.armFlexed ? "bent at the elbow" : "straight", state.armFlexed ? "bad" : "good", "arm"],
    ["Bruising", bruiseText(state), state.extravasatedMl >= 0.35 ? "bad" : "good", "bruise"],
  ];
  if(mode === "bandage" || state.bandagedAt != null){
    rows.push(["Dressing", bandageText(state), state.bandagedAt != null ? "" : "wait", "bandage"]);
  }
  return rows.map(([lab, val, cls, live])=>`<div class="asm-row">
      <span class="asm-lab">${esc(lab)}</span>
      <span class="asm-val ${cls}" data-live="${live}">${esc(val)}</span>
    </div>`).join("");
}

/**
 * Built from the STATE of the arm rather than from which step is running — the
 * same rule the withdrawal branch settled on. A site that has started bleeding
 * again must be pressable from the bandage step.
 */
function controlsHTML(state){
  const sets = [];
  const holding = state.clotProgress >= 1;

  if(!holding || state.bleedingAtCheck){
    sets.push(`<fieldset>
      <legend>Pressure</legend>
      <div class="asm-actions">
        <button class="stg-mini" data-pd="hold">Hold firm pressure until it stops</button>
        <button class="stg-mini" data-pd="press">Press firmly for five seconds</button>
        <button class="stg-mini" data-pd="light">Rest the pad on lightly for five seconds</button>
        <button class="stg-mini" data-pd="hard">Press as hard as you can for five seconds</button>
        <button class="stg-mini" data-pd="beside">Press beside the puncture for five seconds</button>
      </div>
    </fieldset>`);
  }

  sets.push(`<fieldset>
    <legend>The patient's arm</legend>
    <div class="asm-actions">
      ${state.armFlexed
        ? `<button class="stg-mini" data-pd="straighten">Straighten the arm out again</button>`
        : `<button class="stg-mini" data-pd="flex">Bend their arm up over the site</button>`}
      <button class="stg-mini" data-pd="check">Lift the gauze and look at the site</button>
    </div>
  </fieldset>`);

  if(holding){
    sets.push(`<fieldset>
      <legend>The dressing</legend>
      <div class="asm-actions">
        ${state.bandagedAt == null ? `
          <button class="stg-mini" data-pd="bandage">Put it squarely over the puncture</button>
          <button class="stg-mini" data-pd="bandage-off">Put it on a little off to the side</button>
          <button class="stg-mini" data-pd="bandage-tight">Pull it on tight</button>
          <button class="stg-mini" data-pd="bandage-loose">Lay it on loosely</button>`
        : `<button class="stg-mini" data-pd="bandage-remove">Take it off and reapply it</button>`}
        ${state.bandagedAt != null && !state.aftercareGiven
          ? `<button class="stg-mini" data-pd="aftercare">“Keep it on about fifteen minutes.”</button>` : ""}
      </div>
    </fieldset>`);
  }

  return `<div class="asm-controls">${sets.join("")}</div>`;
}

function helpHTML(state, mode){
  const band = forceBandFor(state.siteKind);
  const holding = state.clotProgress >= 1;
  if(!holding){
    if(state.armFlexed){
      return `<b>Straighten the arm first.</b> Drag their hand back down — a bent elbow feels like it helps and does not: the fascia takes the pressure and the puncture stays open underneath it.`;
    }
    if(state.padOffSite){
      return `<b>The pad is not on the puncture.</b> Drag it back over the site — pressure beside a hole does nothing at all.`;
    }
    if(state.force <= 0.02){
      return `<b>Press the gauze down onto the puncture.</b> Drag downward INTO the arm — how far you push is how hard you are pressing, and you need at least ${pct(band.min)}% for the vein to actually close.${state.siteKind === SITE_KIND.HAND ? " Support the hand from underneath; there is only bone under that vein." : ""}`;
    }
    if(state.force < band.min){
      return `<b>Harder.</b> At ${pct(state.force)}% the vein is not closed, so the clock is running with nothing happening. Push further in.`;
    }
    if(state.force > band.discomfort){
      return `<b>Ease off a little.</b> That is past firm and into painful, and it does not clot any faster.`;
    }
    return `<b>Hold it there.</b> Keep the pressure steady and do not lift it to peek — letting go early undoes some of the clot.`;
  }
  if(state.checkedAt == null || state.bleedingAtCheck){
    return `<b>Lift the gauze and look.</b> Let go of the pad to check the site — that is the only way you actually know it has stopped.`;
  }
  if(state.bandagedAt == null){
    return `<b>Dress it.</b> Drag the bandage from the bench squarely over the puncture, then press it down — how far you pull it onto the arm is how tight it ends up.`;
  }
  return `<b>Tell them how long to keep it on</b> and what to watch for.`;
}

export function renderPostDrawCoach(host, o){
  const { state, result, mode } = o;
  const guided = !!o.guided;
  const listView = !!o.listView;
  const issue = nextIssue(result);
  const ready = !!o.ready;
  const clean = ready && !(issue && issue.severity === "block");

  const signature = [
    mode, listView, guided, ready, o.hint || "-",
    state.clotProgress >= 1,
    state.pressureStartedAt != null,
    state.padOffSite,
    state.armFlexed,
    state.checkedAt != null, state.bleedingAtCheck,
    state.bandagedAt != null, state.aftercareGiven,
    bruiseText(state),
    issue ? issue.code : "-",
  ].join("|");

  if(host.dataset.pdSig === signature){ patchLive(host, state, mode); return; }
  host.dataset.pdSig = signature;

  host.innerHTML = `
    <div class="asm-coach">
      <div class="stg-topline">
        <span class="stg-mode">${esc(MODE_TITLES[mode] || mode)}</span>
        <div class="stg-toggles">
          ${o.canRender3d ? `<button class="stg-toggle" id="pdView" aria-pressed="${listView}">${listView ? "Use the arm" : "Use controls"}</button>` : ""}
        </div>
      </div>

      <div class="asm-panel">
        ${rowsHTML(state, mode)}
      </div>

      ${guided
        ? `<div class="stg-msg ${clean ? "ready" : (issue && issue.severity === "block" ? "block" : "warn")}" role="status" aria-live="polite">
            ${clean
              ? `<b>${esc(nextAction(state, mode))}</b>`
              : issue ? `<b>${issue.severity === "block" ? "Not yet." : issue.severity === "warn" ? "Worth fixing." : "Now."}</b> ${esc(issue.message)}`
                      : esc(nextAction(state, mode))}
          </div>
          ${state.anticoagulated ? `<p class="tq-next">This patient is on anticoagulants — this puncture needs about ${Math.round(state.holdSeconds)}s of firm pressure, not the usual half-minute.</p>` : ""}`
        : (o.hint ? `<div class="stg-msg neutral" role="status" aria-live="polite"><b>Reminder.</b> ${esc(o.hint)}</div>` : "")}

      ${listView
        ? controlsHTML(state)
        : `${guided ? `<p class="stg-help">${helpHTML(state, mode)}</p>` : ""}`}

      <button class="btn vp-tap${guided ? "" : " quiet"}" id="pdReady" ${(guided && !ready) ? "disabled" : ""} style="${(guided && !ready) ? "opacity:.5" : ""}">
        ${guided ? (ready ? esc(READY_LABELS[mode] || "Continue ▶") : "Not finished yet") : "Carry on ▶"}
      </button>
    </div>`;

  const h = o.handlers || {};
  const bind = (id, fn)=>{ const el = host.querySelector("#"+id); if(el && fn) el.onclick = fn; };
  bind("pdView", h.onToggleView);
  bind("pdReady", ()=>{ if((!guided || ready) && h.onReady) h.onReady(); });
  host.querySelectorAll("[data-pd]").forEach(b=>{
    b.onclick = ()=>h.onAction && h.onAction(b.dataset.pd);
  });
}

function patchLive(host, state, mode){
  const set = (name, text)=>{
    const el = host.querySelector(`[data-live="${name}"]`);
    if(el && el.textContent !== text) el.textContent = text;
  };
  set("force", forceText(state));
  set("hold", holdText(state));
  set("site", siteText(state));
  set("arm", state.armFlexed ? "bent at the elbow" : "straight");
  set("bruise", bruiseText(state));
  if(mode === "bandage" || state.bandagedAt != null) set("bandage", bandageText(state));
}
