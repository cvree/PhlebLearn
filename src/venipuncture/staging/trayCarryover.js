/* =========================================================================
   THE TRAY GOES WITH YOU TO THE NEXT PATIENT.

   A shift is six patients. Preparing the work area is twenty-three objects on
   a cart, of which nine have to end up staged: gloves, tourniquet, alcohol,
   needle, holder, gauze, bandage, the sharps container, and this order's
   tubes. Every one of those was rebuilt from an empty tray for every patient
   — fifty-odd identical drags across a shift, and fifty-odd identical taps
   turning the same packages over to read the same labels.

   That is not what happens between two patients in a draw room. You restock
   from the cart you have already been through, and the tray comes back the
   way you left it. What is different for the next patient is the ORDER: their
   tubes, their draw sequence, and whatever the cart hands you this time.

   SO WHAT CARRIES, AND WHAT DOES NOT.

     carries    the consumable categories you staged and the zone your sharps
                container ended up in, plus where you pushed the tray to —
                that is your work area, and it is still yours

     does not   the tubes. They are this patient's requisition, they are the
                order of draw, and they are the graded half of this step.

   AND THE CATCH, WHICH IS THE POINT.

   A restock is not a guarantee. One patient in three, roughly, what comes
   back onto the tray is something that should not be on it — an expired pad,
   a split needle pouch, a sharps container that has gone past its fill line
   since you last looked. Nothing announces it. It is on the tray, staged,
   looking exactly like the good one, and the only way to find it is the thing
   this step exists to teach: turn the package over and read it.

   So the step gets shorter and harder at the same time. Patient one teaches
   you to build a tray. Patients two to six ask you what changed.

   Pure data: no DOM, no THREE, no game state. `physicalSteps.js` holds the
   record on the shift and applies what this returns.
   ========================================================================= */
import { CATEGORY, REQUIRED_TRAY_CATEGORIES, isUsable } from "./supplyCatalog.js";
import { ZONE, stagedIds } from "./stagingState.js";

/** Categories a restock will put back. Tubes are deliberately not among them. */
export const RESTOCKED_CATEGORIES = REQUIRED_TRAY_CATEGORIES.concat([CATEGORY.SHARPS]);

/**
 * What this patient's finished tray says about how the next one should start.
 *
 * Recorded from the state at the moment the learner said the tray was ready,
 * so a tray they never finished carries nothing — you cannot restock from a
 * cart you never worked through.
 *
 * @param {object} state    staging state
 * @param {Array}  catalog  the catalog that state indexes
 * @returns {object|null}
 */
export function captureTray(state, catalog){
  if(!state) return null;
  const byId = new Map(catalog.map(d => [d.id, d]));
  const categories = [];
  let sharpsZone = null;
  for(const id of stagedIds(state)){
    const def = byId.get(id);
    if(!def) continue;
    // A flawed item is not something you restock — you would have taken it
    // off the tray, and carrying it forward would punish the same mistake
    // twice without ever being asked about again.
    if(!isUsable(def)) continue;
    if(def.category === CATEGORY.SHARPS){
      /* Only a container that ended up genuinely in reach comes back there.
         A sharps bin left across the patient's arm is the mistake this step
         exists to catch, and restocking it into the same bad spot would repeat
         the mistake without ever asking the learner about it again — the same
         reason a flawed item does not carry. Get it wrong and you place it
         yourself next time. */
      if(state.items[id].zone === ZONE.REACH) sharpsZone = ZONE.REACH;
      continue;
    }
    if(RESTOCKED_CATEGORIES.indexOf(def.category) < 0) continue;
    if(categories.indexOf(def.category) < 0) categories.push(def.category);
  }
  if(!categories.length && !sharpsZone) return null;
  return {
    categories,
    sharpsZone: sharpsZone || null,
    trayOffset: state.trayOffset ? { x: state.trayOffset.x, z: state.trayOffset.z } : { x:0, z:0 },
    handedness: state.handedness,
  };
}

/**
 * Which item from THIS patient's cart comes back for each carried category,
 * and whether the learner has any reason to believe it is sound.
 *
 * @param {object} o
 * @param {Array}  o.catalog
 * @param {object} o.tray     from captureTray()
 * @param {number} [o.flawChance]  probability that one restocked item is bad
 * @param {function} [o.rng]  injectable 0..1 source
 * @returns {{items: Array<{id:string, zone:string, inspected:boolean}>,
 *            trayOffset: {x:number,z:number}, plantedId: (string|null)}}
 */
export function restockPlan({ catalog, tray, flawChance, rng }){
  const rand = rng || Math.random;
  const empty = { items: [], trayOffset: { x:0, z:0 }, plantedId: null };
  if(!tray || !tray.categories) return empty;

  const wanted = tray.categories.slice();
  if(tray.sharpsZone) wanted.push(CATEGORY.SHARPS);

  /* Which category, if any, the cart lets down this time. Only categories the
     cart actually stocks a believable bad version of can be chosen — planting
     "a flawed pair of gloves" that does not exist would silently do nothing. */
  const spoilable = wanted.filter(cat => catalog.some(d => d.category === cat && !isUsable(d)));
  const chance = flawChance == null ? 0.34 : flawChance;
  const planted = (spoilable.length && rand() < chance)
    ? spoilable[Math.floor(rand()*spoilable.length) % spoilable.length]
    : null;

  const items = [];
  let plantedId = null;
  for(const cat of wanted){
    const pool = catalog.filter(d => d.category === cat);
    if(!pool.length) continue;
    const spoiled = cat === planted;
    const candidates = pool.filter(d => spoiled ? !isUsable(d) : isUsable(d));
    const def = candidates.length ? candidates[Math.floor(rand()*candidates.length) % candidates.length] : null;
    if(!def) continue;
    const zone = cat === CATEGORY.SHARPS ? (tray.sharpsZone || ZONE.REACH) : ZONE.TRAY;
    /* Inspected, for everything you already went through on this shift: the
       restock is drawn from stock you turned over yourself. Not the planted
       one — nobody has looked at that, which is the whole point of it. */
    items.push({ id: def.id, zone, inspected: !spoiled });
    if(spoiled){ plantedId = def.id; }
  }
  return {
    items,
    trayOffset: tray.trayOffset || { x:0, z:0 },
    plantedId,
  };
}
