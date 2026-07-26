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
