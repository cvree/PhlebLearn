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
import { stepGuideHTML, stepHintHTML, guideSignature } from "../stepGuide.js";

/* =========================================================================
   WHAT THE PATIENT SAYS WHILE YOU HOLD.

   Haemostasis is thirty real seconds, and fifty-five for someone on
   anticoagulants. That is the one genuinely still stretch in the whole draw:
   a hand on a gauze pad, a countdown, and nothing to do but not let go —
   which is exactly right clinically and, on its own, half a minute of
   watching a bar.

   It is also, in a real room, the half minute where the patient talks to you.
   So they do. These change every ten seconds or so of held pressure, they say
   nothing about technique, and they never ask for an answer — lifting your
   hand to reply is the one thing this step is teaching you not to do.
   ========================================================================= */
const SMALL_TALK = [
  "That was better than last time, honestly.",
  "How long do I keep this on for?",
  "I always look away. Every single time.",
  "My mum faints at these. I get it from her.",
  "Is that a lot of blood? It looks like a lot.",
  "You're quicker than the machine at the pharmacy.",
  "I've got the whole afternoon off after this.",
  "It's the little plaster I like. Small victories.",
  "Do you do this all day? I couldn't.",
  "That's the arm I sleep on, too.",
];
/** Which line, from how long they have been sitting there. Stable per bucket. */
function smallTalkFor(state){
  if(state.clotProgress >= 1 || state.pressureStartedAt == null) return null;
  const bucket = Math.floor((state.heldSeconds || 0)/10);
  if(bucket < 1) return null;         // the first ten seconds are just the hold
  return SMALL_TALK[bucket % SMALL_TALK.length];
}

/* How each gesture is performed — behind that step's own disclosure now rather
   than printed under every frame of it. See stepGuide.js. */
const HOW = {
  pressure: `<p><b>Press the gauze down onto the puncture and drag downward INTO the arm</b> — how far you
    push is how hard you are pressing. Keep the arm straight: a bent elbow feels like it helps and does not,
    because the fascia takes the pressure and the puncture stays open underneath it.</p>
    <p><b>Then hold it there.</b> Do not lift it to peek — letting go early undoes part of the clot and costs
    you real seconds. When the time is up, lift the gauze and look: that is the only way you actually know
    it has stopped.</p>`,
  bandage: `<p><b>Drag the bandage from the bench squarely over the puncture, then press it down</b> — how far
    you pull it onto the arm is how tight it ends up.</p>
    <p>Then tell them how long to keep it on and what to watch for. Aftercare advice is what catches the rare
    complication early.</p>`,
};

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

/**
 * The two numbers this particular puncture turns on: the force that actually
 * closes a vein at this site, and how long this patient's blood needs. Both
 * are properties of the patient and the site rather than restatements of the
 * instruction, which is why they stay on screen when the prose does not.
 */
function noteHTML(state){
  const band = forceBandFor(state.siteKind);
  const bits = [];
  /* Deliberately not gated on the live force: that ticks every frame, and a
     note that appears and vanishes under the learner's own hand is worse than
     one that simply states the target. The target is a property of the site. */
  if(state.clotProgress < 1){
    bits.push(`Firm enough here is about ${pct(band.min)}% — below that the vein is not closed and the clock runs with nothing happening.`);
  }
  if(state.anticoagulated){
    bits.push(`This patient is on anticoagulants: about ${Math.round(state.holdSeconds)}s of firm pressure, not the usual half-minute.`);
  }
  return bits.join(" ");
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
    guideSignature(),
    smallTalkFor(state) || "-",
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

      ${smallTalkFor(state) ? `<p class="pd-chat">“${esc(smallTalkFor(state))}”</p>` : ""}

      ${guided
        ? stepGuideHTML({
            /* `clean` is ready AND unblocked; readiness itself is the coarser
               `ready`, which is what ends the step. */
            ready,
            tone: clean ? "ready" : (issue && issue.severity === "block" ? "block" : "warn"),
            lead: clean ? "" : (issue ? (issue.severity === "block" ? "Not yet." : issue.severity === "warn" ? "Worth fixing." : "Now.") : ""),
            line: clean || !issue ? nextAction(state, mode) : issue.message,
            /* Facts about THIS puncture that the instruction cannot carry: how
               hard is hard enough on this site, and how long this patient's
               blood actually takes. Not a second phrasing of anything. */
            note: noteHTML(state),
            how: HOW[mode] || "",
          })
        : stepHintHTML(o.hint, ready)}

      ${listView ? controlsHTML(state) : ""}


      ${/* PLAY'S ESCAPE HATCH, AND ONLY PLAY'S — see cleaningCoach.js for why. */
        guided ? "" : `<button class="btn vp-tap quiet" id="pdReady">Carry on ▶</button>`}

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
