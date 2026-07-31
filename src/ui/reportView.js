/* =========================================================================
   THE PRACTICAL REPORT, RENDERED.

   `rubricReport.js` decides everything; this file only turns that plain
   object into HTML. Keeping the two apart is what lets the report be
   asserted on in a unit test without a browser, and what stops grading
   thresholds leaking into a template.

   Every number printed here came out of a measurement. There is no sentence
   in this file that says "be more careful".
   ========================================================================= */
import { stamp, labelFor } from "../venipuncture/rubric/replay.js";
import { MEASUREMENT_LABELS } from "../venipuncture/rubric/policy.js";
import { fmtDuration } from "../game/scoring.js";

function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
}
function pct(v){ return Math.round((v || 0)*100); }

/* ---------- header ---------------------------------------------------------- */
function headHTML(report){
  const verdict = report.passed ? "PASS" : "FAIL";
  return `<div class="rep-head">
    <div class="rep-proc">${esc(report.procedure.label)}</div>
    <div class="rep-total">
      <span class="rep-score">${report.total}</span>
      <span class="rep-outof">/ ${report.maxTotal} &nbsp;·&nbsp; ${pct(report.percent)}%</span>
      <span class="rep-verdict ${report.passed?"pass":"fail"}">${verdict}</span>
    </div>
    ${report.failedBy.length
      ? `<ul class="rep-why">${report.failedBy.map(f=>`<li>${esc(f.detail)}</li>`).join("")}</ul>`
      : `<ul class="rep-why"><li>Cleared the ${pct(report.passMark)}% pass mark with every row at or above ${report.categories.length ? 2 : 2}/4, and no automatic-failure event.</li></ul>`}
    <div class="rep-policy">Graded against <b>${esc(report.policy.id)} ${esc(report.policy.version)}</b>. ${esc(report.policy.note)}</div>
  </div>`;
}

/* ---------- critical events -------------------------------------------------- */
function alarmHTML(report){
  if(!report.criticalEvents.length) return "";
  return `<div class="rep-alarm">
    <h3>Critical events (${report.criticalEvents.length})</h3>
    <ul>${report.criticalEvents.map(e=>`<li>
      <span class="${e.automaticFailure?"rep-auto":""}">${esc(e.label)}${e.automaticFailure?" — automatic failure":""}</span>
      ${e.item?` <b>(${esc(e.item)})</b>`:""}
      <br><span class="rep-detail">${esc(e.message)}${e.why?` ${esc(e.why)}`:""}</span>
      ${e.unclassified?`<br><span class="rep-detail">This code is not classified in the policy file; it is reported as critical because the step flagged it.</span>`:""}
    </li>`).join("")}</ul>
  </div>`;
}

/* ---------- one rubric row ---------------------------------------------------- */
function rowHTML(cat){
  return `<div class="rep-row">
    <div class="rep-rowhead">
      <span class="rep-rowname"><span class="rep-chip" data-score="${cat.score}">${cat.score}</span>${esc(cat.label)}</span>
      <span class="rep-band">${esc(cat.band.label)} · ${cat.mean}/100</span>
    </div>
    <ul class="rep-evidence">
      ${cat.evidence.map(e=>`<li><span class="rep-evkey">${esc(e.label)}${e.score==null?"":` (${e.score}/100)`}:</span> ${esc(e.narrative)}</li>`).join("")}
    </ul>
    ${cat.preventedExcellence.length
      ? `<ul class="rep-blocked">${cat.preventedExcellence.map(g=>`<li>${esc(g.detail)}</li>`).join("")}</ul>`
      : ""}
    ${cat.commendations.length
      ? `<ul class="rep-commend">${cat.commendations.map(t=>`<li>${esc(t)}</li>`).join("")}</ul>`
      : ""}
  </div>`;
}

/* ---------- specimens ---------------------------------------------------------- */
function specimenHTML(report){
  const s = report.specimen;
  if(!s.total) return `<p class="sub">No specimen was collected.</p>`;
  return `<table class="rep-table">
    <thead><tr><th>Tube</th><th>Drawn</th><th>Fill</th><th>Inversions</th><th>Result</th></tr></thead>
    <tbody>${s.tubes.map(t=>`<tr>
      <td>${esc(t.name)}</td>
      <td>${t.drawnMl == null ? "—" : `${t.drawnMl} / ${t.volumeMl} mL`}</td>
      <td>${t.fillPercent == null ? "—" : `${t.fillPercent}%`}${t.requiredPercent!=null?` <span class="rep-detail">(needs ${t.requiredPercent}%)</span>`:""}</td>
      <td>${t.inversions == null ? "—" : `${t.inversions}${t.required!=null?` / ${t.required}`:""}`}</td>
      <td class="rep-usable">${t.usable ? "usable" : `rejected${t.reason?` — ${esc(t.reason)}`:""}`}</td>
    </tr>`).join("")}</tbody>
  </table>
  <p class="sub">${s.usableCount} of ${s.total} usable.${s.redrawRequired?" A redraw is required.":""}</p>`;
}

/* ---------- the rest ------------------------------------------------------------ */
function outcomesHTML(report){
  if(!report.patientOutcomes.length) return "";
  return `<ul class="rep-outcomes">${report.patientOutcomes.map(o=>`<li data-good="${o.good?1:0}">${esc(o.text)}</li>`).join("")}</ul>`;
}
function strongestHTML(report){
  if(!report.strongest.length) return `<p class="sub">Nothing in this attempt reached the top two bands.</p>`;
  return `<ul class="rep-outcomes">${report.strongest.map(s=>`<li data-good="1">${esc(s.text)}</li>`).join("")}</ul>`;
}
function planHTML(report){
  if(!report.practicePlan.length) return `<p class="sub">Nothing to prioritise — every row was inside its tolerances.</p>`;
  return `<ol class="rep-plan">${report.practicePlan.map(p=>`<li data-priority="${p.priority}">
    <span class="rep-action">${esc(p.action)}</span>
    <span class="rep-whyplan">${esc(p.why)}</span>
  </li>`).join("")}</ol>`;
}

/* ---------- session replay ------------------------------------------------------ */
function detailText(data){
  if(data == null) return "";
  if(typeof data !== "object") return String(data);
  const parts = Object.entries(data)
    .filter(([, v]) => v != null && typeof v !== "object")
    .slice(0, 4)
    .map(([k, v]) => `${k} ${typeof v === "number" ? Math.round(v*1000)/1000 : v}`);
  return parts.join(", ");
}
function replayHTML(replay){
  if(!replay || !replay.count) return "";
  return `<details class="rep-replay">
    <summary>Session replay — ${replay.count} recorded actions over ${fmtDuration(replay.durationMs)}</summary>
    ${replay.groups.map(g=>`<div class="rep-rgroup">
      <div class="rep-rghead">
        <span>${esc(g.label)}</span>
        <span class="rep-rgscore">${g.score == null ? "not measured" : `${g.score}/100`}</span>
      </div>
      ${g.readings.map(r=>`<p class="rep-rgnarr"><b>${esc(MEASUREMENT_LABELS[r.key]||r.key)}:</b> ${esc(r.measurement.narrative)}</p>`).join("")}
      ${g.events.length
        ? `<ul class="rep-timeline">${g.events.map(e=>`<li>
            <span class="rep-at">${stamp(e.offsetMs)}</span>
            <span class="rep-what">${esc(labelFor(e.type))}<span class="rep-detail">${e.data?` — ${esc(detailText(e.data))}`:""}</span></span>
          </li>`).join("")}</ul>`
        : `<p class="rep-rgnarr">Nothing was recorded in this section.</p>`}
    </div>`).join("")}
  </details>`;
}

/* ---------- the whole thing ------------------------------------------------------ */
export function renderPracticalReport(report, replay, extras){
  const x = extras || {};
  return `
    ${headHTML(report)}
    ${alarmHTML(report)}
    ${x.progress ? `<div class="rep-policy">${esc(x.progress)}</div>` : ""}
    <div class="rep-sec">Rubric</div>
    ${report.categories.map(rowHTML).join("")}
    <div class="rep-sec">Specimen</div>
    ${specimenHTML(report)}
    <div class="rep-sec">The patient</div>
    ${outcomesHTML(report)}
    <div class="rep-sec">Strongest actions</div>
    ${strongestHTML(report)}
    <div class="rep-sec">Practice plan</div>
    ${planHTML(report)}
    <div class="rep-sec">Replay</div>
    ${replayHTML(replay)}`;
}

/** The compact version Learn and Practice see instead of the full report. */
export function renderRubricSummary(report){
  return `<div class="rep-head">
    <div class="rep-proc">${esc(report.procedure.label)}</div>
    <div class="rep-total">
      <span class="rep-score">${report.total}</span>
      <span class="rep-outof">/ ${report.maxTotal} on the practical rubric</span>
    </div>
    <ul class="rep-why">${report.categories.map(c=>
      `<li><span class="rep-chip" data-score="${c.score}">${c.score}</span> ${esc(c.label)} — ${esc(c.band.label)}</li>`).join("")}</ul>
    <div class="rep-policy">The Final Practical turns this into the full report, with evidence, specimen results and a practice plan.</div>
  </div>`;
}
