/* =========================================================================
   STAGING LAYOUT — the physical geometry of the work area, in metres.

   Handedness is implemented HERE, as real coordinates, not as a text label:
   a right-handed learner gets the tray and the tube rack on their left
   (non-dominant) side and the sharps reach zone beside their right hand;
   a left-handed learner gets the mirror image. Every drop position is
   classified by zoneAt(), so the same drop lands in different zones
   depending on which hand the learner said they use.

   Pure maths — no THREE, no DOM — so tests/staging.spec.js can assert the
   mirroring directly.

        z-  ┌──────────────── supply shelf (3 rows) ────────────────┐
            │                                                       │
            │   [sharps storage]                 [across the arm]   │
            │        tray + rack        [patient arm]               │
        z+  │                                    [ sharps reach ]   │
            └───────────────────── operator ────────────────────────┘
   ========================================================================= */
import { ZONE, HAND } from "./stagingState.js";

export const ORIENTATION = { LANDSCAPE:"landscape", PORTRAIT:"portrait" };

// A wide counter cannot be framed usefully on a tall phone screen: fitting
// 1.3 m of bench into a 414-px-wide viewport puts the camera so far back the
// props are a few pixels across. The portrait cart is the same work area
// rearranged — narrower and deeper — so every zone and every rule is
// identical and only the physical arrangement changes.
export const COUNTERS = {
  [ORIENTATION.LANDSCAPE]: { minX:-0.66, maxX:0.66, minZ:-0.42, maxZ:0.38 },
  [ORIENTATION.PORTRAIT]:  { minX:-0.44, maxX:0.44, minZ:-0.60, maxZ:0.52 },
};
export const COUNTER = COUNTERS[ORIENTATION.LANDSCAPE];

/** Chooses a cart shape from the viewport it has to be drawn into. */
export function orientationForAspect(aspect){
  return (aspect||1.6) < 1.0 ? ORIENTATION.PORTRAIT : ORIENTATION.LANDSCAPE;
}

function rect(cx, cz, w, d){
  return { cx, cz, w, d, minX:cx-w/2, maxX:cx+w/2, minZ:cz-d/2, maxZ:cz+d/2 };
}
function inRect(r, x, z){ return x>=r.minX && x<=r.maxX && z>=r.minZ && z<=r.maxZ; }

/**
 * @param {object} o {handedness, tubeCount, shelfCount, orientation}
 */
export function createLayout({ handedness, tubeCount, shelfCount, orientation }){
  const left = handedness===HAND.LEFT;
  // sign points toward the learner's NON-dominant side, where equipment goes.
  const sign = left ? +1 : -1;
  const n = Math.max(1, tubeCount||1);
  const orient = orientation===ORIENTATION.PORTRAIT ? ORIENTATION.PORTRAIT : ORIENTATION.LANDSCAPE;
  const counter = COUNTERS[orient];
  const portrait = orient===ORIENTATION.PORTRAIT;

  const tray   = portrait ? rect(sign*0.19,  0.26, 0.34, 0.20) : rect(sign*0.22,  0.06, 0.36, 0.24);
  const rack   = portrait ? rect(sign*0.19,  0.185, 0.026*n+0.03, 0.05)
                          : rect(sign*0.22, -0.005, 0.026*n+0.03, 0.05);   // along the tray's back edge
  const arm    = portrait ? rect(-sign*0.17, 0.10, 0.28, 0.18) : rect(-sign*0.17, 0.02, 0.28, 0.22);
  const reach  = portrait ? rect(-sign*0.26, 0.42, 0.24, 0.15) : rect(-sign*0.40, 0.26, 0.24, 0.18);
  const across = portrait ? rect(-sign*0.31,-0.04, 0.22, 0.16) : rect(-sign*0.46,-0.12, 0.26, 0.20);
  // Portrait keeps the sharps stock along the front edge: they are the
  // tallest objects on the cart, and anywhere further back they would hide
  // half the shelf from a near-overhead camera.
  const store  = portrait ? rect(sign*0.16, 0.455, 0.60, 0.16) : rect(sign*0.50, -0.13, 0.24, 0.46);

  const shelf = shelfSlots(shelfCount||24, orient);

  return {
    handedness: left?HAND.LEFT:HAND.RIGHT, sign, orientation:orient,
    tray, rack, arm, reach, across, store, shelf, counter,
    trayOffset: { x:0, z:0 },
  };
}

/** Grid positions for the supply shelf at the back of the counter. */
export function shelfSlots(count, orientation){
  const portrait = orientation===ORIENTATION.PORTRAIT;
  const cols = portrait ? 5 : 8;
  const rowZ = portrait ? [-0.555, -0.475, -0.395, -0.315] : [-0.365, -0.265, -0.165];
  const x0 = portrait ? -0.30 : -0.30;
  const dx = portrait ? 0.15 : 0.0857;
  const out = [];
  for(let i=0;i<count;i++){
    const r = Math.floor(i/cols) % rowZ.length;
    const c = i%cols;
    out.push({ x: x0 + c*dx, z: rowZ[r] });
  }
  return out;
}

/**
 * Slides the tray (and the tube rack that sits on it) to a new position on the
 * counter. The learner can shove the whole work area to wherever they actually
 * want to work, so the tray's zone has to move with the object rather than
 * being a fixed region the tray happens to start in.
 *
 * Mutates `layout` in place and returns the clamped offset actually applied.
 */
export function applyTrayOffset(layout, offset){
  const off = offset || { x:0, z:0 };
  const base = layout.trayBase || (layout.trayBase = {
    tray:{ cx:layout.tray.cx, cz:layout.tray.cz },
    rack:{ cx:layout.rack.cx, cz:layout.rack.cz },
  });
  const c = layout.counter;
  const halfW = layout.tray.w/2, halfD = layout.tray.d/2;
  const clampX = v=>Math.max(c.minX+halfW, Math.min(c.maxX-halfW, v));
  const clampZ = v=>Math.max(c.minZ+halfD, Math.min(c.maxZ-halfD, v));
  let targetX = clampX(base.tray.cx + off.x);
  let targetZ = clampZ(base.tray.cz + off.z);

  // You cannot put a tray down on top of the patient's arm. Without this the
  // tray slides under the arm mesh and everything staged on it disappears from
  // view — the player can bury their own work area.
  const a = layout.arm;
  for(let pass=0; pass<2; pass++){
    const overX = Math.min(targetX+halfW, a.maxX) - Math.max(targetX-halfW, a.minX);
    const overZ = Math.min(targetZ+halfD, a.maxZ) - Math.max(targetZ-halfD, a.minZ);
    if(overX<=0 || overZ<=0) break;
    if(overX <= overZ) targetX = clampX(targetX + (targetX < a.cx ? -overX : overX));
    else               targetZ = clampZ(targetZ + (targetZ < a.cz ? -overZ : overZ));
  }

  const dx = targetX - base.tray.cx, dz = targetZ - base.tray.cz;

  const move = (r, cx, cz)=>{
    r.cx = cx; r.cz = cz;
    r.minX = cx - r.w/2; r.maxX = cx + r.w/2;
    r.minZ = cz - r.d/2; r.maxZ = cz + r.d/2;
  };
  move(layout.tray, base.tray.cx + dx, base.tray.cz + dz);
  move(layout.rack, base.rack.cx + dx, base.rack.cz + dz);
  layout.trayOffset = { x:dx, z:dz };
  return layout.trayOffset;
}

/** Where the three sharps containers stand before the learner moves one. */
export function storeSlot(layout, index){
  if(layout.orientation===ORIENTATION.PORTRAIT){
    return { x: layout.store.cx + (index-1)*0.19, z: layout.store.cz };
  }
  return { x: layout.store.cx, z: layout.store.minZ + 0.085 + index*0.150 };
}

/**
 * Which zone does a world position fall into?
 * Order matters: the specific target zones win over the generic counter.
 */
export function zoneAt(layout, x, z){
  const COUNTER = layout.counter || COUNTERS[ORIENTATION.LANDSCAPE];
  if(x<COUNTER.minX || x>COUNTER.maxX || z<COUNTER.minZ || z>COUNTER.maxZ) return ZONE.FLOOR;
  if(inRect(layout.reach, x, z))  return ZONE.REACH;
  if(inRect(layout.across, x, z)) return ZONE.ACROSS;
  if(inRect(layout.rack, x, z))   return ZONE.RACK;
  if(inRect(layout.tray, x, z))   return ZONE.TRAY;
  return ZONE.COUNTER;
}

/** Nearest rack slot index for an x position, or null when out of the rack. */
export function rackSlotAt(layout, x, z, slotCount){
  if(!inRect(layout.rack, x, z)) return null;
  const n = Math.max(1, slotCount);
  const width = 0.026*n;
  const startX = layout.rack.cx - width/2 + 0.013;
  let best = 0, bestD = Infinity;
  for(let i=0;i<n;i++){
    const sx = startX + i*0.026;
    const d = Math.abs(x - sx);
    if(d<bestD){ bestD=d; best=i; }
  }
  return best;
}

export function rackSlotPosition(layout, index, slotCount){
  const n = Math.max(1, slotCount);
  const width = 0.026*n;
  const startX = layout.rack.cx - width/2 + 0.013;
  return { x: startX + index*0.026, z: layout.rack.cz };
}

/**
 * True when staging at this position would put equipment on the learner's
 * DOMINANT side, i.e. they'd be working across the patient's arm.
 */
export function crossesField(layout, x){
  return layout.sign>0 ? x < -0.02 : x > 0.02;
}

/* =========================================================================
   SUPPORT HEIGHTS — the top surface of whatever a zone's objects rest ON.

   This table is the fix for the bug that made staged items disappear. Every
   placement path used to write `y = COUNTER_Y` (0), which is the counter, not
   the tray: `buildTray()` builds a floor whose top surface is 12 mm up, so an
   item "on the tray" was positioned 12 mm INSIDE the tray floor. Anything
   shorter than 12 mm — the alcohol pad, the gauze, the bandage — was entirely
   swallowed, which is why the coach could list four items on a tray that
   looked empty.

   The rack escaped the bug only because ONE of the four write paths hardcoded
   `y: 0.018` for it. That is the shape of the defect: four write paths, one of
   which knew about one surface. There is now one table, and every path reads it.

   Kept in this file (pure maths, no THREE) so the property "nothing ever rests
   below the thing holding it" is unit-testable without a browser.
   ========================================================================= */
export const COUNTER_TOP = 0;
/** buildTray(): floor box of height 0.012 centred at 0.006 → top at 0.012. */
export const TRAY_FLOOR_TOP = 0.012;
/** buildTubeRack(): the floor a tube bottoms out on inside its well. */
export const RACK_SEAT_TOP = 0.0115;
/** The marked pad the sharps container stands on. */
export const PAD_TOP = 0.002;

export function supportHeight(zone){
  switch(zone){
    case ZONE.TRAY:   return TRAY_FLOOR_TOP;
    case ZONE.RACK:   return RACK_SEAT_TOP;
    case ZONE.REACH:
    case ZONE.ACROSS: return PAD_TOP;
    /* ZONE.FLOOR is "this hit the floor", not "this is on the floor". The drop
       handler deliberately arcs it back onto the counter — an object that
       leaves the world can leave a player unable to finish a draw, which is a
       dead end rather than a difficulty setting. It rests on the counter,
       marked and unusable. The reconciler used to disagree with that and drop
       it to y=-0.30, so a recovered item vanished the next time state was
       pushed back onto the meshes. */
    default:          return COUNTER_TOP;
  }
}

/**
 * The y an item's ORIGIN must sit at to rest on its zone's surface.
 *
 * `restOffset` is the model's own distance from origin down to its lowest
 * point, measured from the built mesh at registration time — see
 * `rendering/modelRegistry.js`. Passing 0 degrades to "origin on the surface",
 * which is exactly the old behaviour and is correct for a model already
 * authored with its base at y=0.
 */
export function restingY(zone, restOffset){
  return supportHeight(zone) + (restOffset || 0);
}

/** A free position inside the tray that isn't already occupied. */
export function trayRestingSpot(layout, index){
  // Two rows in front of the tube rack, inset far enough that a wide item
  // (the glove box) still sits fully inside the tray rim.
  const cols = 4;
  const c = index%cols, r = Math.floor(index/cols)%2;
  return {
    x: layout.tray.minX + 0.072 + c*0.072,
    z: layout.tray.cz + 0.020 + r*0.060,
  };
}

export { inRect };
