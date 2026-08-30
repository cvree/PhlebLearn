/* =========================================================================
   THE ARRIVAL ROOM — where you meet the patient.

   This replaces the introduction STEP. Not the competency: two-identifier
   patient identification is the most load-bearing rule in California
   phlebotomy practice, it is a rubric row, and a simulator that skips it
   teaches a habit that gets people hurt. What is deleted is the SCREEN.

   WHAT WAS WRONG WITH THE SCREEN. `introduce` was step 1 of 16, with a
   progress bar, a step counter, and five `<fieldset>`s holding thirteen
   written sentences the learner clicked. That is a multiple-choice question
   about a conversation. It is also, structurally, the exact thing
   ARCHITECTURE.md's own rule says to delete: *if the draw already makes the
   learner do the thing, the screen that asks them about it is deleted, and
   the score reads what they did instead.*

   WHAT IS HERE INSTEAD. A room with a person in it and things you can pick
   up, before any procedure has started and with no step number attached:

     the patient      who greets you, and answers. Two or three live things
                      to say at any moment, not thirteen — see liveActs().
     the requisition  a real sheet, read, and the thing identifiers are
                      checked AGAINST
     the wristband    the third identifier, and the mismatch case
     the sink         hand hygiene as a duration you hold, not a flag
     the glove box    latex and nitrile, and everything you touch after

   WHAT IS UNCHANGED. `introductionState.js`, `introductionRules.js` and
   `introductionScoring.js` are untouched. `say()` is still the one write
   path, so this and the accessible list land in identical states and the
   grader cannot tell them apart. The rubric row keeps its instrumentation.

   ONE GATE, AND ONLY ONE. You cannot start the draw until two identifiers
   match. Everything else here — the leading question, the missed allergy ask,
   the ungloved hands, the phone answered with gloves on — is recorded and
   reported, never blocked. The draw has to be able to go wrong for the report
   to mean anything.

   DOM only, like every other `*Coach.js`: it renders into a host it is given
   and calls pure helpers. It decides nothing.
   ========================================================================= */
import {
  ACT, ACT_DEFS, actDef, liveActs, mayStartDraw, nextAction, nextIssue,
  HYGIENE_GOOD_S, DRY_MIN_S, REQUIRED_IDENTIFIERS, identifiersObtained,
} from "./introductionRules.js";
import { stepGuideHTML, guideSignature } from "../stepGuide.js";

/* How this room is worked — behind the one disclosure now rather than spread
   across a teaching card on the panel and a paragraph under it. See
   stepGuide.js. */
const HOW = `<p><b>Ask them to state their name and date of birth</b> — ask, do not read it out for them to
  agree with. A patient will agree to a name that is not theirs.</p>
  <p><b>Check what they say against the requisition</b>, and read the whole order: name, DOB, tests, date,
  provider. If something is missing or does not match, hold the draw and clarify before drawing.</p>
  <p><b>Then wash your hands for the full ${HYGIENE_GOOD_S} seconds, let them dry, and glove.</b> Gloves
  over wet hands tear, and anything you touch after gloving — a phone, a curtain — contaminates them.</p>`;

function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"]/g,
    c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
}

/* ---------- the conversation ------------------------------------------------ */

/**
 * The last few things said, most recent last.
 *
 * Short on purpose. The old panel printed a running transcript of eight
 * exchanges, which turned a conversation into a document — and a document is
 * something you read rather than something you are having.
 */
function conversationHTML(state){
  const recent = state.transcript.slice(-3);
  if(!recent.length) return "";
  return `<div class="arr-said">${recent.map(t => `
    <p class="arr-you">${esc(t.said)}</p>
    ${t.reply ? `<p class="arr-them">${esc(t.reply)}</p>` : ""}`).join("")}</div>`;
}

/* ---------- the requisition and the band ------------------------------------ */

/**
 * The requisition, as a thing on the counter rather than a quiz about one.
 *
 * The old screen asked "is this requisition ready to use?" and offered three
 * sentences. The order is either complete or it is not, the learner can read
 * it, and the only decision that matters is whether they HOLD the draw — so
 * that is the only control.
 */
function requisitionHTML(p, held){
  const flaw = p.reqIssue && p.reqIssue.flaw;
  const missing = v => `<span class="arr-missing">(missing)</span>`;
  return `<div class="arr-card arr-req">
    <div class="arr-card-h">Requisition</div>
    <div class="arr-row"><span>Patient</span><b>${flaw === "name" ? esc(p.first + " " + p.decoyLast) : esc(p.name)}</b></div>
    <div class="arr-row"><span>DOB</span><b>${flaw === "dob" ? missing() : esc(p.dob)}</b></div>
    <div class="arr-row"><span>MRN</span><b>${esc(p.id)}</b></div>
    <div class="arr-row"><span>Collected</span><b>${flaw === "date" ? missing() : "today"}</b></div>
    <div class="arr-row"><span>Ordered by</span><b>${flaw === "prov" ? missing() : esc(p.provider)}</b></div>
    <div class="arr-row"><span>Tests</span><b>${(p.orders || []).map(esc).join(", ")}</b></div>
    <button class="stg-mini arr-hold${held ? " on" : ""}" id="arrHold">
      ${held ? "✓ Held — flagged for clarification" : "Hold this draw and clarify"}
    </button>
  </div>`;
}

/** The band on the wrist. Reading it is the third identifier. */
function wristbandHTML(p, read){
  if(!read){
    return `<button class="stg-mini arr-band" data-arr="${ACT.CHECK_WRISTBAND}">
      🏷️ Lean in and read their wristband
    </button>`;
  }
  const mismatch = p.reqIssue && p.reqIssue.flaw === "name";
  return `<div class="arr-card arr-bandcard${mismatch ? " bad" : ""}">
    <div class="arr-card-h">Wristband</div>
    <div class="arr-row"><span>Name</span><b>${esc(p.name)}</b></div>
    <div class="arr-row"><span>MRN</span><b>${esc(p.id)}</b></div>
    ${mismatch ? `<p class="arr-warn">This does not match the name on the requisition.</p>` : ""}
  </div>`;
}

/* ---------- what you are holding, and how clean it is ----------------------- */

function readinessHTML(state){
  const ids = identifiersObtained(state);
  const enough = ids.length >= REQUIRED_IDENTIFIERS;
  return `<div class="arr-state">
    <span class="arr-chip ${enough ? "good" : "bad"}" data-live="ids">
      ${enough
        ? `identified · ${ids.join(", ")}`
        : `${ids.length}/${REQUIRED_IDENTIFIERS} identifiers${ids.length ? ` · ${ids.join(", ")}` : ""}`}
    </span>
    <span class="arr-chip ${state.hygieneSeconds >= HYGIENE_GOOD_S ? "good" : (state.hygieneSeconds > 0 ? "wait" : "bad")}" data-live="hygiene">
      hands ${Math.round(state.hygieneSeconds)}s
    </span>
    <span class="arr-chip ${state.gloved && !state.gloveContaminated ? "good" : (state.gloveContaminated ? "bad" : "wait")}" data-live="gloves">
      ${state.gloveContaminated ? `gloves contaminated (${esc(state.contaminatedBy)})`
        : state.gloved ? `${esc(state.gloveMaterial)} gloves on`
        : `${esc(state.gloveMaterial)} gloves, off`}
    </span>
  </div>`;
}

/**
 * The sink and the glove box.
 *
 * Hand hygiene is a DURATION here, as it always was in the model — the button
 * is held, and the seconds accumulate for as long as it is. The two fixed-time
 * controls beside it are the accessible path to the same helper, which is why
 * both land in identical state.
 */
function sinkHTML(state){
  const other = state.gloveMaterial === "latex" ? "nitrile" : "latex";
  return `<div class="arr-kit">
    <button class="stg-mini" id="arrRub" data-hold="1">🚰 Hold to rub your hands</button>
    <button class="stg-mini" data-arr-scrub="20">Rub for a full ${HYGIENE_GOOD_S} seconds</button>
    ${state.gloved
      ? (state.gloveContaminated
          ? `<button class="stg-mini" id="arrReglove">🧤 Change to fresh gloves</button>`
          : "")
      : `<button class="stg-mini" data-arr="${ACT.GLOVE}">🧤 Put on ${esc(state.gloveMaterial)} gloves</button>
         <button class="stg-mini" data-arr-glove="${other}">Switch to ${esc(other)}</button>`}
    ${state.gloved ? `
      <button class="stg-mini ghost" data-arr="${ACT.TOUCH_PHONE}">📱 Answer your phone</button>
      <button class="stg-mini ghost" data-arr="${ACT.TOUCH_DOOR}">🪟 Pull the curtain across</button>` : ""}
  </div>`;
}

/* ---------- render ---------------------------------------------------------- */

/**
 * @param {HTMLElement} host
 * @param {object} o  {state, patient, result, guided, held, handlers}
 */
export function renderArrivalRoom(host, o){
  const { state, result } = o;
  const p = o.patient || {};
  const guided = !!o.guided;
  const issue = nextIssue(result);
  const canStart = mayStartDraw(state);

  const acts = liveActs(state, 3);

  /* Re-rendering wholesale would destroy a button while a hand is holding it
     down, and the hygiene clock ticks every frame. Same signature-and-patch
     shape the other coaches use. */
  const signature = [
    guided, canStart, state.transcript.length, state.gloved, state.gloveContaminated,
    state.gloveMaterial, state.positioned, !!o.held,
    state.done[ACT.CHECK_WRISTBAND] ? 1 : 0,
    identifiersObtained(state).join(","), acts.join(","),
    issue ? issue.code : "-",
    guideSignature(),
  ].join("|");
  if(host.dataset.arrSig === signature){ patchLive(host, state); return; }
  host.dataset.arrSig = signature;

  host.innerHTML = `
    <div class="arrival">
      ${conversationHTML(state)}
      ${readinessHTML(state)}

      ${guided ? stepGuideHTML({
          id: "introduce",
          ready: canStart,
          tone: canStart ? "ready" : (issue && issue.severity === "block" ? "block" : "warn"),
          lead: canStart ? "You know who this is." : "Not yet.",
          line: canStart ? nextAction(state) : (issue ? issue.message : nextAction(state)),
          how: HOW,
        }) : ""}

      ${acts.length ? `<div class="arr-acts">
        ${acts.map(id => {
          const def = actDef(id);
          if(!def) return "";
          return `<button class="stg-mini arr-act${def.leading ? " leading" : ""}" data-arr="${id}">${esc(def.label)}</button>`;
        }).join("")}
      </div>` : ""}

      <div class="arr-things">
        ${requisitionHTML(p, o.held)}
        ${wristbandHTML(p, !!state.done[ACT.CHECK_WRISTBAND])}
      </div>

      ${sinkHTML(state)}

      ${/* Same rule as the supply cart's: the button is here when there is
           something to press it for. Before two identifiers match there is
           nothing to press, and a disabled bar reading "Identify them first
           (0/2)" was a third copy of what the readiness chips and the
           guidance line both already say. */
        canStart ? `<button class="btn vp-tap" id="arrStart">Prepare your work area ▶</button>` : ""}
    </div>`;

  const h = o.handlers || {};
  host.querySelectorAll("[data-arr]").forEach(b => {
    b.onclick = () => h.onAct && h.onAct(b.dataset.arr);
  });
  host.querySelectorAll("[data-arr-scrub]").forEach(b => {
    b.onclick = () => h.onScrub && h.onScrub(Number(b.dataset.arrScrub));
  });
  host.querySelectorAll("[data-arr-glove]").forEach(b => {
    b.onclick = () => h.onGloveMaterial && h.onGloveMaterial(b.dataset.arrGlove);
  });
  const rub = host.querySelector("#arrRub");
  if(rub && h.onRubStart){
    rub.onpointerdown = e => { e.preventDefault(); try{ rub.setPointerCapture(e.pointerId); }catch(_){} h.onRubStart(); };
    rub.onpointerup = () => h.onRubEnd && h.onRubEnd();
    rub.onpointercancel = () => h.onRubEnd && h.onRubEnd();
    rub.onpointerleave = () => h.onRubEnd && h.onRubEnd();
  }
  const re = host.querySelector("#arrReglove");
  if(re) re.onclick = () => h.onReglove && h.onReglove();
  const hold = host.querySelector("#arrHold");
  if(hold) hold.onclick = () => h.onHold && h.onHold();
  const start = host.querySelector("#arrStart");
  if(start) start.onclick = () => { if(canStart && h.onStart) h.onStart(); };
}

/** The hygiene clock moves every frame; the room around it does not. */
function patchLive(host, state){
  const set = (name, text, cls) => {
    const el = host.querySelector(`[data-live="${name}"]`);
    if(!el) return;
    if(el.textContent.trim() !== text) el.textContent = text;
    if(cls){ el.classList.remove("good", "bad", "wait"); el.classList.add(cls); }
  };
  set("hygiene", `hands ${Math.round(state.hygieneSeconds)}s`,
    state.hygieneSeconds >= HYGIENE_GOOD_S ? "good" : (state.hygieneSeconds > 0 ? "wait" : "bad"));
}

export { ACT_DEFS, DRY_MIN_S };
