/* =========================================================================
   STAGING COACH — the DOM layer during physical supply staging.

   Deliberately NOT where the procedure happens. It shows status (what the
   tray still needs), coaching (why the thing you just staged is wrong), and
   what a turned-over package says. The staging itself happens on the cart.

   It also hosts the accessible list view: the same objects, the same rules,
   the same measurements, reachable with a keyboard and a screen reader. The
   list view is an ALTERNATIVE input path, not an easier game — it writes
   through the identical stageItemTo() calls the 3D drag uses.
   ========================================================================= */
import { TUBES } from "../../config.js";
import { CATEGORY, REQUIRED_TRAY_CATEGORIES, isUsable } from "./supplyCatalog.js";
import { ZONE, HAND } from "./stagingState.js";
import { nextIssue } from "./stagingRules.js";

const CATEGORY_TITLE = {
  [CATEGORY.GLOVES]:"Gloves",
  [CATEGORY.TOURNIQUET]:"Tourniquet",
  [CATEGORY.ALCOHOL]:"Alcohol pad",
  [CATEGORY.NEEDLE]:"Needle",
  [CATEGORY.HOLDER]:"Holder",
  [CATEGORY.GAUZE]:"Gauze",
  [CATEGORY.BANDAGE]:"Bandage",
  [CATEGORY.TUBE]:"Tubes in order",
  [CATEGORY.SHARPS]:"Sharps in reach",
};
const ORDER = [...REQUIRED_TRAY_CATEGORIES, CATEGORY.TUBE, CATEGORY.SHARPS];

function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }
function tubeName(k){ return (TUBES[k] && TUBES[k].name) || k; }

/* ---------- checklist ------------------------------------------------------ */
function checklistHTML(result){
  return `<div class="stg-checks" role="list" aria-label="Tray readiness">${
    ORDER.map(cat=>{
      const c = result.checks[cat] || { ok:false };
      // status is carried by the glyph and the text, never by colour alone
      return `<span class="stg-chk ${c.ok?'ok':'todo'}" role="listitem">
        <span class="stg-glyph" aria-hidden="true">${c.ok?'✓':'○'}</span>${esc(CATEGORY_TITLE[cat])}
        <span class="sr-only">${c.ok?'ready':'not ready'}</span></span>`;
    }).join("")
  }</div>`;
}

function tubeOrderHTML(state, result){
  if(!state.requiredTubes.length) return "";
  const c = result.checks[CATEGORY.TUBE] || {};
  const order = c.order || [];
  return `<div class="stg-order">
    <span class="stg-order-lab">Order of draw</span>
    ${state.requiredTubes.map((k,i)=>{
      const got = order[i];
      const ok = got===k;
      return `<span class="stg-slot ${ok?'ok':(got?'wrong':'empty')}">
        <span class="stg-slotn">${i+1}</span>
        <span class="stg-dot" style="background:#${(TUBES[k]?TUBES[k].color:0x888888).toString(16).padStart(6,'0')}"></span>
        <span class="stg-slotname">${esc(tubeName(k))}</span>
        <span class="stg-slotstate" aria-hidden="true">${ok?'✓':(got?'✗':'·')}</span>
      </span>`;
    }).join("")}
  </div>`;
}

/* ---------- inspection readout --------------------------------------------- */
function inspectHTML(inspecting){
  if(!inspecting || !inspecting.def) return "";
  const { def, revealed } = inspecting;
  if(!revealed){
    return `<div class="stg-inspect turning">
      <b>${esc(def.label)}</b>
      <p>Turn it over — drag to rotate. Expiry dates, gauge bands and patient labels are printed on the back.</p>
    </div>`;
  }
  const flawed = !isUsable(def);
  return `<div class="stg-inspect ${flawed?'flagged':'clear'}">
    <b>${esc(def.label)}</b>
    <ul>${(def.inspect||[]).map(l=>`<li>${esc(l)}</li>`).join("")}</ul>
    ${flawed?`<p class="stg-why">${esc(def.reason)}</p>`:`<p class="stg-ok">Checks out — safe to stage.</p>`}
  </div>`;
}

/* ---------- accessible list view -------------------------------------------- */
function zoneLabel(state, id){
  const z = state.items[id].zone;
  if(z===ZONE.RACK) return `rack slot ${state.items[id].slot+1}`;
  if(z===ZONE.TRAY) return "on the tray";
  if(z===ZONE.REACH) return "in the reach zone";
  if(z===ZONE.ACROSS) return "past the arm";
  if(z===ZONE.COUNTER) return "on the counter";
  if(z===ZONE.FLOOR) return "on the floor";
  return "in the cart";
}

function listHTML(state, catalog){
  const rows = catalog.map(def=>{
    const st = state.items[def.id];
    const isTube = def.category===CATEGORY.TUBE;
    const isSharps = def.category===CATEGORY.SHARPS;
    const staged = st.zone===ZONE.TRAY || st.zone===ZONE.RACK || st.zone===ZONE.REACH;
    const slotBtns = isTube
      ? state.requiredTubes.map((k,i)=>`<button class="stg-mini" data-stage="${def.id}" data-zone="rack" data-slot="${i}" aria-label="Seat ${esc(def.label)} in rack slot ${i+1}">${i+1}</button>`).join("")
      : "";
    return `<tr class="${st.contaminated?'contam':''}">
      <th scope="row">
        <span class="stg-dot" style="background:${isTube&&TUBES[def.tubeKey]?'#'+TUBES[def.tubeKey].color.toString(16).padStart(6,'0'):'#c8cdd6'}"></span>
        ${esc(def.label)}
        ${st.inspected?`<span class="stg-tag">checked</span>`:""}
        ${st.contaminated?`<span class="stg-tag bad">contaminated</span>`:""}
      </th>
      <td class="stg-where">${esc(zoneLabel(state, def.id))}</td>
      <td class="stg-actions">
        <button class="stg-mini" data-inspect="${def.id}">${st.inspected?"Re-read":"Inspect"}</button>
        ${isSharps
          ? `<button class="stg-mini" data-stage="${def.id}" data-zone="reach">Reach zone</button>
             <button class="stg-mini" data-stage="${def.id}" data-zone="across">Past the arm</button>`
          : isTube ? slotBtns + `<button class="stg-mini" data-stage="${def.id}" data-zone="tray">Tray</button>`
                   : `<button class="stg-mini" data-stage="${def.id}" data-zone="tray">Tray</button>`}
        ${staged||st.zone!==ZONE.SHELF?`<button class="stg-mini ghost" data-return="${def.id}">Put back</button>`:""}
      </td>
    </tr>`;
  }).join("");
  return `<div class="stg-list">
    <table>
      <caption class="sr-only">Supply cart contents — inspect an item, then stage it</caption>
      <thead><tr><th scope="col">Item</th><th scope="col">Where</th><th scope="col">Actions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

/* ---------- main render ------------------------------------------------------ */
/**
 * @param {HTMLElement} host
 * @param {object} o {state, catalog, result, inspecting, listView, canRender3d, handlers}
 */
export function renderStagingCoach(host, o){
  const { state, catalog, result, inspecting, listView } = o;
  const issue = nextIssue(result);
  const ready = result.ready;

  host.innerHTML = `
    <div class="stg-coach">
      <div class="stg-topline">
        <span class="stg-mode">${listView ? "List view" : "Supply cart"}</span>
        <div class="stg-toggles">
          <button class="stg-toggle" id="stgHand" aria-pressed="${state.handedness===HAND.LEFT}">
            ${state.handedness===HAND.LEFT?"Left-handed":"Right-handed"}
          </button>
          ${o.canRender3d?`<button class="stg-toggle" id="stgView" aria-pressed="${!!listView}">${listView?"Use the cart":"Use a list"}</button>`:""}
        </div>
      </div>

      ${checklistHTML(result)}
      ${tubeOrderHTML(state, result)}
      ${inspectHTML(inspecting)}

      <div class="stg-msg ${ready?'ready':(issue&&issue.severity==='block'?'block':'warn')}" role="status" aria-live="polite">
        ${ready
          ? "<b>Work area ready.</b> Everything you need is on the tray, the tubes are in order of draw, and the sharps container is beside the chair."
          : issue ? `<b>${issue.severity==='block'?'Not ready yet.':'Worth fixing.'}</b> ${esc(issue.message)}`
                  : "Stage the equipment this draw needs."}
      </div>

      ${listView ? listHTML(state, catalog) : `<p class="stg-help">
        Drag an item from the cart onto the tray. <b>Tap an item to turn it over</b> and read its label before you commit to it.
        Tubes seat into the numbered rack in order of draw. The sharps container goes on the marked pad beside the chair.
      </p>`}

      <button class="btn vp-tap" id="stgReady" ${ready?"":"disabled"} style="${ready?"":"opacity:.5"}">
        ${ready?"Tray ready ▶":"Tray not ready yet"}
      </button>
    </div>`;

  const h = o.handlers || {};
  const bind = (id, fn)=>{ const el = host.querySelector("#"+id); if(el && fn) el.onclick = fn; };
  bind("stgHand", h.onToggleHandedness);
  bind("stgView", h.onToggleView);
  bind("stgReady", ()=>{ if(result.ready && h.onReady) h.onReady(); });

  host.querySelectorAll("[data-inspect]").forEach(b=>{
    b.onclick = ()=>h.onInspect && h.onInspect(b.dataset.inspect);
  });
  host.querySelectorAll("[data-stage]").forEach(b=>{
    b.onclick = ()=>h.onStage && h.onStage(b.dataset.stage, b.dataset.zone, b.dataset.slot==null?null:+b.dataset.slot);
  });
  host.querySelectorAll("[data-return]").forEach(b=>{
    b.onclick = ()=>h.onReturn && h.onReturn(b.dataset.return);
  });
}
