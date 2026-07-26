/* =========================================================================
   SUPPLY CATALOG — the item data behind physical supply staging.

   Pure data assembly: no THREE, no DOM, no randomness beyond the injected
   rng, so tests/staging.spec.js can build a catalog deterministically.

   Every entry describes ONE physical object the learner can pick up, turn
   over, read, and stage. `flaws` is what makes an item unusable; the learner
   is expected to DISCOVER those by inspecting the object, not by reading a
   label the game printed for them. `inspect` lines are only revealed after
   the player actually turns the item over (see stagingState.inspectItem).
   ========================================================================= */
import { TUBES } from "../../config.js";

export const CATEGORY = {
  GLOVES:     "gloves",
  TOURNIQUET: "tourniquet",
  ALCOHOL:    "alcohol",
  NEEDLE:     "needle",
  HOLDER:     "holder",
  GAUZE:      "gauze",
  BANDAGE:    "bandage",
  TUBE:       "tube",
  SHARPS:     "sharps",
  DECOY:      "decoy",       // things that belong to no required category at all
};

// Categories that must have exactly one usable item staged on the tray.
export const REQUIRED_TRAY_CATEGORIES = [
  CATEGORY.GLOVES, CATEGORY.TOURNIQUET, CATEGORY.ALCOHOL,
  CATEGORY.NEEDLE, CATEGORY.HOLDER, CATEGORY.GAUZE, CATEGORY.BANDAGE,
];

export const FLAW = {
  EXPIRED:      "expired",
  DAMAGED:      "damaged",
  WRONG_PATIENT:"wrongPatient",
  WRONG_GAUGE:  "wrongGauge",
  EMPTY:        "empty",
  CONTAMINATED: "contaminated",
  UNSTERILE:    "unsterile",
  CLOSED:       "closed",
  OVERFILLED:   "overfilled",
  WRONG_ITEM:   "wrongItem",
};

// Vacutainer needle gauge colour coding — the hub band is how you tell a
// 21G apart from a 25G across a drawer, so the 3D model paints this band.
export const GAUGE_COLORS = { 20:0xf3d34a, 21:0x2f9e5e, 22:0x2a2a2a, 23:0x4f7fd0, 25:0xe08a3c };
export const CORRECT_GAUGE = 21;

function two(n){ return String(n).padStart(2,"0"); }
// Encounter "today" is fixed to the game's in-world collection date so an
// expiry string is deterministic and testable.
export const TODAY = { y:2026, m:6, d:13 };
function fmtDate(y,m,d){ return `${two(m)}/${two(d)}/${y}`; }
const FUTURE = fmtDate(TODAY.y+1, 9, 30);
const PAST   = fmtDate(TODAY.y-1, 11, 30);

let uid = 0;
function item(def){
  return Object.assign({
    id: def.id || `item_${++uid}`,
    flaws: [],
    inspect: [],
    tubeKey: null,
    gauge: null,
    // `reason` is the corrective coaching shown when this item is staged and
    // turns out to be unusable. Written as a short clinical explanation, not
    // a scold.
    reason: "",
  }, def);
}

/* ---------- the required, correct equipment ------------------------------ */
function correctCore(){
  return [
    item({ id:"gloves_ok", modelId:"supply.gloveBox", category:CATEGORY.GLOVES,
      label:"Nitrile exam gloves", short:"Gloves",
      inspect:[`Nitrile, powder-free · size M`, `Exp ${FUTURE}`, `Box seal intact`] }),
    item({ id:"tourniquet_ok", modelId:"supply.tourniquet", category:CATEGORY.TOURNIQUET,
      label:"Latex-free tourniquet (blue)", short:"Tourniquet",
      inspect:[`Single-patient use, 1\" flat strap`, `Latex-free`, `No tears or stretch damage`] }),
    item({ id:"alcohol_ok", modelId:"supply.alcoholPad", category:CATEGORY.ALCOHOL,
      label:"70% isopropyl prep pad", short:"Alcohol pad",
      inspect:[`70% isopropyl alcohol`, `Exp ${FUTURE}`, `Sealed — pad feels wet inside`] }),
    item({ id:"needle_ok", modelId:"supply.needle", category:CATEGORY.NEEDLE, gauge:21,
      label:"21G multisample needle", short:"21G needle",
      inspect:[`21G × 1\" multisample`, `Green hub band = 21 gauge`, `Exp ${FUTURE}`, `Peel-pack sealed, sterile`] }),
    item({ id:"holder_ok", modelId:"supply.holder", category:CATEGORY.HOLDER,
      label:"Single-use tube holder", short:"Tube holder",
      inspect:[`Single-use holder`, `Threaded hub, clean`, `Disposed with the needle as one unit`] }),
    item({ id:"gauze_ok", modelId:"supply.gauze", category:CATEGORY.GAUZE,
      label:"2×2 sterile gauze", short:"Gauze",
      inspect:[`2×2 in, 8-ply`, `Sterile pouch sealed`, `Exp ${FUTURE}`] }),
    item({ id:"bandage_ok", modelId:"supply.bandage", category:CATEGORY.BANDAGE,
      label:"Adhesive bandage", short:"Bandage",
      inspect:[`Wrapper sealed`, `Latex-free adhesive`, `Exp ${FUTURE}`] }),
    item({ id:"sharps_ok", modelId:"supply.sharpsContainer", category:CATEGORY.SHARPS,
      label:"Sharps container — open, below fill line", short:"Sharps container",
      inspect:[`Lid open, aperture clear`, `Contents below the fill line`, `Biohazard labelled`] }),
  ];
}

/* ---------- believable wrong / unsafe items ------------------------------ */
function decoys({ requiredTubes, patientName, otherPatientName }){
  const spareKey = Object.keys(TUBES).find(k=>!requiredTubes.includes(k)) || "green";
  const dupKey = requiredTubes[0] || "red";
  const out = [
    item({ id:"needle_wrong_gauge", modelId:"supply.needle", category:CATEGORY.NEEDLE, gauge:25,
      flaws:[FLAW.WRONG_GAUGE], label:"25G needle", short:"25G needle",
      inspect:[`25G × 1\" multisample`, `Orange hub band = 25 gauge`, `Peel-pack sealed`],
      reason:"25G is too fine for a routine antecubital draw — the narrow lumen shears red cells and hemolyses the sample. 21G is the standard multisample gauge." }),
    item({ id:"needle_damaged_pack", modelId:"supply.needle", category:CATEGORY.NEEDLE, gauge:21,
      flaws:[FLAW.DAMAGED], label:"21G needle — torn pouch", short:"21G needle",
      inspect:[`21G × 1\" multisample`, `Peel-pack seal split along the edge`, `Sterility cannot be assumed`],
      reason:"The sterile barrier is broken. A compromised peel-pack means the needle is no longer sterile — it goes in the sharps container, not on the tray." }),
    item({ id:"alcohol_empty", modelId:"supply.alcoholPad", category:CATEGORY.ALCOHOL,
      flaws:[FLAW.EMPTY], label:"Alcohol wrapper — empty", short:"Empty wrapper",
      inspect:[`Wrapper already torn open`, `No pad inside`, `Dry`],
      reason:"The wrapper is empty — someone already used this one. An empty wrapper can't disinfect anything." }),
    item({ id:"gauze_cotton", modelId:"supply.cottonBall", category:CATEGORY.DECOY,
      flaws:[FLAW.WRONG_ITEM], label:"Cotton balls", short:"Cotton balls",
      inspect:[`Loose cotton`, `Fibres shed easily`],
      reason:"Cotton fibres stick into the forming clot and pull it off when the ball is lifted, restarting the bleed. Use flat gauze." }),
    item({ id:"gauze_open", modelId:"supply.gauze", category:CATEGORY.GAUZE,
      flaws:[FLAW.UNSTERILE], label:"Gauze — pouch already open", short:"Open gauze",
      inspect:[`Pouch torn open`, `Pad has been sitting on the counter`, `No longer sterile`],
      reason:"This pouch is already open, so the pad has been exposed to the counter. It can't go over a fresh puncture site." }),
    item({ id:"syringe_decoy", modelId:"supply.syringe", category:CATEGORY.DECOY,
      flaws:[FLAW.WRONG_ITEM], label:"10 mL syringe", short:"Syringe",
      inspect:[`10 mL Luer-lock syringe`, `No transfer device attached`],
      inspectHint:"A syringe draw needs a transfer device to fill tubes safely.",
      reason:"This order is a routine evacuated-tube draw. A syringe adds a transfer step and a needlestick risk for no benefit here." }),
    item({ id:"urine_cup_decoy", modelId:"supply.urineCup", category:CATEGORY.DECOY,
      flaws:[FLAW.WRONG_ITEM], label:"Urine specimen container", short:"Urine cup",
      inspect:[`Sterile urine container`, `Not part of a blood collection`],
      reason:"Wrong specimen type entirely — nothing on this requisition is a urine test." }),
    item({ id:"sharps_closed", modelId:"supply.sharpsContainer", category:CATEGORY.SHARPS,
      flaws:[FLAW.CLOSED], label:"Sharps container — lid locked", short:"Sharps (locked)",
      inspect:[`Lid rotated to the locked position`, `Aperture sealed`, `Ready for pickup, not for use`],
      reason:"This one is closed for disposal pickup. A locked lid means you'd be holding an exposed needle with nowhere to put it." }),
    item({ id:"sharps_overfull", modelId:"supply.sharpsContainer", category:CATEGORY.SHARPS,
      flaws:[FLAW.OVERFILLED], label:"Sharps container — above fill line", short:"Sharps (full)",
      inspect:[`Contents above the fill line`, `Needles visible at the aperture`, `Tagged for replacement`],
      reason:"Above the fill line, sharps can rebound out of the aperture. An overfilled container is a needlestick waiting to happen — swap it out." }),
    // --- tubes ---
    item({ id:`tube_wrong_${spareKey}`, modelId:"supply.tube", category:CATEGORY.TUBE, tubeKey:spareKey,
      flaws:[FLAW.WRONG_ITEM], label:`${TUBES[spareKey].name} tube`, short:TUBES[spareKey].name,
      inspect:[`${TUBES[spareKey].additive}`, `Exp ${FUTURE}`, `Not on this requisition`],
      reason:`Nothing on this order needs a ${TUBES[spareKey].name.toLowerCase()} tube. Extra tubes mean extra blood drawn for no result.` }),
    item({ id:`tube_expired_${dupKey}`, modelId:"supply.tube", category:CATEGORY.TUBE, tubeKey:dupKey,
      flaws:[FLAW.EXPIRED], label:`${TUBES[dupKey].name} tube — expired`, short:TUBES[dupKey].name,
      inspect:[`${TUBES[dupKey].additive}`, `Exp ${PAST}`, `Vacuum may be lost`],
      reason:`This ${TUBES[dupKey].name.toLowerCase()} tube expired ${PAST}. Past expiry the vacuum and the additive are both unreliable — check the date, not just the cap colour.` }),
    item({ id:`tube_damaged_${dupKey}`, modelId:"supply.tube", category:CATEGORY.TUBE, tubeKey:dupKey,
      flaws:[FLAW.DAMAGED], label:`${TUBES[dupKey].name} tube — cracked`, short:TUBES[dupKey].name,
      inspect:[`${TUBES[dupKey].additive}`, `Hairline crack down the body`, `Vacuum already lost`],
      reason:"A cracked tube has no vacuum left, and it can shear or leak during the draw. Discard it." }),
    item({ id:`tube_wrongpatient_${dupKey}`, modelId:"supply.tube", category:CATEGORY.TUBE, tubeKey:dupKey,
      flaws:[FLAW.WRONG_PATIENT], label:`${TUBES[dupKey].name} tube — pre-labelled`, short:TUBES[dupKey].name,
      labelName: otherPatientName,
      inspect:[`${TUBES[dupKey].additive}`, `Label already applied: ${otherPatientName}`, `Not your patient`],
      reason:`This tube is already labelled for ${otherPatientName}. Pre-labelled tubes belonging to another patient are the classic wrong-patient specimen error — never stage one, and never relabel it.` }),
  ];
  out.forEach(i=>{ if(i.category===CATEGORY.TUBE && !i.labelName) i.labelName = patientName; });
  return out;
}

/* ---------- assembly ------------------------------------------------------ */
/**
 * Builds the full pool of objects on the supply cart for one encounter.
 * @param {object} o
 * @param {string[]} o.requiredTubes  tube keys already sorted into order of draw
 * @param {string}   o.patientName
 * @param {string}   o.otherPatientName  a different, plausible patient name
 * @param {function} o.rng  optional deterministic 0..1 source (defaults Math.random)
 */
export function buildSupplyCatalog({ requiredTubes, patientName, otherPatientName, rng }){
  const rand = rng || Math.random;
  const tubes = (requiredTubes && requiredTubes.length ? requiredTubes : ["red"]).slice();
  const correctTubes = tubes.map(k=>item({
    id:`tube_ok_${k}`, modelId:"supply.tube", category:CATEGORY.TUBE, tubeKey:k,
    label:`${TUBES[k].name} tube`, short:TUBES[k].name, labelName:patientName,
    inspect:[`${TUBES[k].additive}`, `Exp ${FUTURE}`, `Draw order #${TUBES[k].order}`, `Unlabelled — label at the bedside`],
  }));
  const pool = [...correctCore(), ...correctTubes, ...decoys({ requiredTubes:tubes, patientName, otherPatientName })];
  // Stable-but-varied shelf ordering: shuffle with the injected rng so the
  // correct item is never in the same drawer position twice.
  for(let i=pool.length-1;i>0;i--){
    const j=Math.floor(rand()*(i+1));
    [pool[i],pool[j]]=[pool[j],pool[i]];
  }
  return pool;
}

export function catalogById(catalog){
  const map = new Map();
  catalog.forEach(it=>map.set(it.id, it));
  return map;
}

export function isUsable(it){ return !it.flaws || it.flaws.length===0; }
export function hasFlaw(it, flaw){ return !!(it.flaws && it.flaws.includes(flaw)); }
