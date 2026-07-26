/* =========================================================================
   STAGING RULES — the single source of truth for "is this work area safe to
   start a draw from?".

   Same contract as clinicalRules.js: named state fields in, plain data out.
   No text matching, no DOM, no THREE. Both the 3D staging view and the
   accessible list view call this, so they can never disagree about whether
   the tray is ready.

   evaluateStaging() returns:
     { ready, issues:[{code,severity,message,itemId,category}], checks:{...} }
   `issues` is ordered most-serious first; `checks` drives the coach's
   checklist without the UI having to re-derive anything.
   ========================================================================= */
import { TUBES } from "../../config.js";
import { CATEGORY, FLAW, REQUIRED_TRAY_CATEGORIES, catalogById, isUsable, hasFlaw } from "./supplyCatalog.js";
import { ZONE, stagedIds } from "./stagingState.js";

export const ISSUE = {
  MISSING:            "missing",
  NOT_ON_TRAY:        "notOnTray",
  UNUSABLE:           "unusable",
  CONTAMINATED:       "contaminated",
  UNSAFE_ITEM:        "unsafeItem",
  DUPLICATE:          "duplicate",
  TUBE_MISSING:       "tubeMissing",
  TUBE_EXTRA:         "tubeExtra",
  TUBE_NOT_RACKED:    "tubeNotRacked",
  TUBE_ORDER:         "tubeOrder",
  TUBE_WRONG_PATIENT: "tubeWrongPatient",
  SHARPS_MISSING:     "sharpsMissing",
  SHARPS_UNUSABLE:    "sharpsUnusable",
  SHARPS_OUT_OF_REACH:"sharpsOutOfReach",
  SHARPS_ACROSS_FIELD:"sharpsAcrossField",
};

const CATEGORY_LABEL = {
  [CATEGORY.GLOVES]:"gloves",
  [CATEGORY.TOURNIQUET]:"a tourniquet",
  [CATEGORY.ALCOHOL]:"an alcohol prep pad",
  [CATEGORY.NEEDLE]:"a multisample needle",
  [CATEGORY.HOLDER]:"a tube holder",
  [CATEGORY.GAUZE]:"sterile gauze",
  [CATEGORY.BANDAGE]:"a bandage",
  [CATEGORY.TUBE]:"collection tubes",
  [CATEGORY.SHARPS]:"a sharps container",
};

const USABLE_ZONES = [ZONE.TRAY, ZONE.RACK, ZONE.REACH];
const PRESENT_BUT_UNUSABLE_ZONES = [ZONE.COUNTER, ZONE.ACROSS, ZONE.FLOOR];

function flawMessage(def){
  if(def.reason) return def.reason;
  if(hasFlaw(def, FLAW.EXPIRED)) return "That item is past its expiry date.";
  if(hasFlaw(def, FLAW.DAMAGED)) return "That package is damaged — sterility is lost.";
  return "That item can't be used for this draw.";
}

function tubeName(k){ return (TUBES[k] && TUBES[k].name) || k; }

/**
 * @param {object} state    from createStagingState()
 * @param {Array}  catalog  from buildSupplyCatalog()
 */
export function evaluateStaging(state, catalog){
  const map = catalogById(catalog);
  const issues = [];
  const checks = {};
  const add = (code, severity, message, extra)=>issues.push(Object.assign({ code, severity, message }, extra||{}));

  const zoneOf = id => (state.items[id] ? state.items[id].zone : null);
  const isStaged = id => USABLE_ZONES.includes(zoneOf(id));
  const inCategory = cat => catalog.filter(d=>d.category===cat);

  /* ---- 1. the seven single-item categories ------------------------------ */
  for(const cat of REQUIRED_TRAY_CATEGORIES){
    const defs = inCategory(cat);
    const staged = defs.filter(d=>isStaged(d.id));
    const usableStaged = staged.filter(d=>isUsable(d) && !state.items[d.id].contaminated);
    const badStaged = staged.filter(d=>!isUsable(d) || state.items[d.id].contaminated);

    badStaged.forEach(d=>{
      if(state.items[d.id].contaminated && isUsable(d)){
        add(ISSUE.CONTAMINATED, "block",
          `The ${d.label.toLowerCase()} hit the floor. Once a sterile item is contaminated it can't go back on the tray — discard it and open a fresh one.`,
          { itemId:d.id, category:cat });
      }else{
        add(ISSUE.UNUSABLE, "block", flawMessage(d), { itemId:d.id, category:cat });
      }
    });

    if(usableStaged.length===0){
      const nearby = defs.find(d=>isUsable(d) && PRESENT_BUT_UNUSABLE_ZONES.includes(zoneOf(d.id)) && !state.items[d.id].contaminated);
      if(nearby){
        add(ISSUE.NOT_ON_TRAY, "block",
          `The ${nearby.label.toLowerCase()} is out on the counter rather than on the tray. Anything you'll need mid-draw has to be inside arm's reach of the chair.`,
          { itemId:nearby.id, category:cat });
      }else if(badStaged.length===0){
        add(ISSUE.MISSING, "block", `You still need ${CATEGORY_LABEL[cat]} on the tray.`, { category:cat });
      }
    }else if(usableStaged.length>1){
      add(ISSUE.DUPLICATE, "warn",
        `Two of the same item are staged (${CATEGORY_LABEL[cat]}). Extra stock on the tray is wasted once the tray leaves the room.`,
        { category:cat, itemId:usableStaged[1].id });
    }

    checks[cat] = {
      ok: usableStaged.length===1 && badStaged.length===0,
      staged: staged.map(d=>d.id),
      label: CATEGORY_LABEL[cat],
    };
  }

  /* ---- 2. unsafe / irrelevant equipment --------------------------------- */
  inCategory(CATEGORY.DECOY).filter(d=>isStaged(d.id)).forEach(d=>{
    add(ISSUE.UNSAFE_ITEM, "block", flawMessage(d), { itemId:d.id, category:CATEGORY.DECOY });
  });

  /* ---- 3. tubes: identity, integrity, and order of draw ----------------- */
  const required = state.requiredTubes;
  const tubeDefs = inCategory(CATEGORY.TUBE);
  const stagedTubes = tubeDefs.filter(d=>isStaged(d.id));

  stagedTubes.filter(d=>hasFlaw(d, FLAW.WRONG_PATIENT)).forEach(d=>{
    add(ISSUE.TUBE_WRONG_PATIENT, "block", flawMessage(d), { itemId:d.id, category:CATEGORY.TUBE, safety:true });
  });
  stagedTubes.filter(d=>!isUsable(d) && !hasFlaw(d, FLAW.WRONG_PATIENT)).forEach(d=>{
    const code = hasFlaw(d, FLAW.WRONG_ITEM) ? ISSUE.TUBE_EXTRA : ISSUE.UNUSABLE;
    add(code, "block", flawMessage(d), { itemId:d.id, category:CATEGORY.TUBE });
  });
  stagedTubes.filter(d=>isUsable(d) && state.items[d.id].contaminated).forEach(d=>{
    add(ISSUE.CONTAMINATED, "block",
      `That ${tubeName(d.tubeKey).toLowerCase()} tube went on the floor. Cracks aren't always visible — get a fresh one.`,
      { itemId:d.id, category:CATEGORY.TUBE });
  });

  const goodTubes = stagedTubes.filter(d=>isUsable(d) && !state.items[d.id].contaminated);
  required.forEach(k=>{
    if(!goodTubes.some(d=>d.tubeKey===k)){
      add(ISSUE.TUBE_MISSING, "block", `The order needs a ${tubeName(k).toLowerCase()} tube and there isn't a usable one staged.`,
        { category:CATEGORY.TUBE, tubeKey:k });
    }
  });
  goodTubes.filter(d=>zoneOf(d.id)!==ZONE.RACK).forEach(d=>{
    add(ISSUE.TUBE_NOT_RACKED, "block",
      `The ${tubeName(d.tubeKey).toLowerCase()} tube is loose on the tray. Seat it in the rack so the draw order is set before you ever pick up the needle.`,
      { itemId:d.id, category:CATEGORY.TUBE });
  });

  const rackKeys = state.rackSlots.map(id=>{
    const d = id ? map.get(id) : null;
    return d && isUsable(d) ? d.tubeKey : null;
  });
  const rackFull = rackKeys.length===required.length && rackKeys.every(k=>k!=null);
  const orderOk = rackFull && rackKeys.every((k,i)=>k===required[i]);
  if(rackFull && !orderOk){
    const expected = required.map(tubeName).join(" → ");
    add(ISSUE.TUBE_ORDER, "block",
      `The rack is out of order of draw. For this requisition it should read ${expected}.`,
      { category:CATEGORY.TUBE });
  }
  checks[CATEGORY.TUBE] = {
    ok: orderOk && goodTubes.length===required.length &&
        !stagedTubes.some(d=>!isUsable(d) || state.items[d.id].contaminated),
    order: rackKeys,
    expected: required.slice(),
    label: CATEGORY_LABEL[CATEGORY.TUBE],
  };

  /* ---- 4. sharps container placement ------------------------------------ */
  const sharpsDefs = inCategory(CATEGORY.SHARPS);
  const inReach = sharpsDefs.filter(d=>zoneOf(d.id)===ZONE.REACH);
  const acrossField = sharpsDefs.filter(d=>zoneOf(d.id)===ZONE.ACROSS);
  const elsewhere = sharpsDefs.filter(d=>zoneOf(d.id)===ZONE.COUNTER || zoneOf(d.id)===ZONE.TRAY);
  const usableInReach = inReach.filter(isUsable);

  inReach.filter(d=>!isUsable(d)).forEach(d=>{
    add(ISSUE.SHARPS_UNUSABLE, "block", flawMessage(d), { itemId:d.id, category:CATEGORY.SHARPS });
  });
  acrossField.forEach(d=>{
    add(ISSUE.SHARPS_ACROSS_FIELD, "block",
      `The sharps container is sitting past the patient's arm. Reaching over a prepared site with an exposed needle is how sticks happen — bring it to your ${state.handedness===
        "left" ? "left" : "right"} side, beside the chair.`,
      { itemId:d.id, category:CATEGORY.SHARPS });
  });
  if(usableInReach.length===0 && acrossField.length===0){
    if(elsewhere.length){
      add(ISSUE.SHARPS_OUT_OF_REACH, "block",
        "The sharps container is on the counter instead of the reach zone beside the chair. After withdrawal the needle has to go straight in — no walking, no setting it down.",
        { itemId:elsewhere[0].id, category:CATEGORY.SHARPS });
    }else if(inReach.length===0){
      add(ISSUE.SHARPS_MISSING, "block",
        "No sharps container is within immediate reach of the chair yet.",
        { category:CATEGORY.SHARPS });
    }
  }
  checks[CATEGORY.SHARPS] = {
    ok: usableInReach.length===1 && acrossField.length===0,
    staged: inReach.map(d=>d.id),
    label: CATEGORY_LABEL[CATEGORY.SHARPS],
  };

  /* ---- 5. anything contaminated left in a usable zone -------------------- */
  stagedIds(state).forEach(id=>{
    const st = state.items[id], def = map.get(id);
    if(!st.contaminated || !def) return;
    const already = issues.some(i=>i.itemId===id && i.code===ISSUE.CONTAMINATED);
    if(!already){
      add(ISSUE.CONTAMINATED, "block",
        `The ${def.label.toLowerCase()} is contaminated and can't be staged.`, { itemId:id, category:def.category });
    }
  });

  const blocking = issues.filter(i=>i.severity==="block");
  issues.sort((a,b)=>{
    const sev = (a.severity==="block"?0:1) - (b.severity==="block"?0:1);
    if(sev) return sev;
    return priorityOf(a) - priorityOf(b);
  });

  return { ready: blocking.length===0, issues, checks, blockingCount:blocking.length };
}

/* Something the learner just DID outranks something they haven't done yet.
   Without this, staging an expired tube gets silently queued behind "you
   still need gloves", and the correction never reaches them at the moment
   it would teach anything. */
const PRIORITY = [
  ISSUE.TUBE_WRONG_PATIENT, ISSUE.UNSAFE_ITEM, ISSUE.UNUSABLE, ISSUE.CONTAMINATED,
  ISSUE.SHARPS_ACROSS_FIELD, ISSUE.SHARPS_UNUSABLE, ISSUE.TUBE_EXTRA,
  ISSUE.TUBE_ORDER, ISSUE.TUBE_NOT_RACKED, ISSUE.SHARPS_OUT_OF_REACH, ISSUE.NOT_ON_TRAY,
  ISSUE.TUBE_MISSING, ISSUE.SHARPS_MISSING, ISSUE.MISSING, ISSUE.DUPLICATE,
];
function priorityOf(issue){
  const i = PRIORITY.indexOf(issue.code);
  return i<0 ? PRIORITY.length : i;
}

/** Convenience for the coach layer: the single most useful thing to fix next. */
export function nextIssue(result){
  return result.issues.find(i=>i.severity==="block") || result.issues[0] || null;
}
