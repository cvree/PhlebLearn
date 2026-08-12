/* =========================================================================
   Shared viewport measurement for the physical step runtimes.

   Every converted step renders a close-up into the same canvas, and every one
   of them needs the same two numbers before it can frame its camera: the
   canvas aspect, and how much of the canvas the coaching panel is currently
   sitting on top of. Ten runtimes had a byte-identical private copy of
   `measureObstruction` and its own `renderer.getSize(new THREE.Vector2())`
   per frame; both live here now, so a change to how the panel is measured
   happens once instead of ten times.

   Both are called from inside render loops, so neither allocates.
   ========================================================================= */
import * as THREE from "three";

// One scratch vector, reused. Only one step scene renders per frame and the
// value is consumed before the next call, so sharing it is safe.
const _size = new THREE.Vector2();

const NO_OBSTRUCTION = Object.freeze({ rightFrac: 0, bottomFrac: 0 });

/** Canvas aspect ratio, clamped so a zero-height canvas can't divide by zero. */
export function viewportAspect(renderer){
  const size = renderer.getSize(_size);
  return size.x / Math.max(1, size.y);
}

/**
 * How much of the canvas the coaching panel covers, as fractions the camera
 * framing can subtract. The panel is a side sheet on a wide viewport and a
 * bottom sheet on a narrow one, so it eats a different edge in each case.
 */
export function measureObstruction(renderer){
  const canvas = renderer.domElement;
  const panel = typeof document !== "undefined" ? document.getElementById("panel") : null;
  if(!canvas || !panel) return NO_OBSTRUCTION;
  const c = canvas.getBoundingClientRect();
  const p = panel.getBoundingClientRect();
  if(!c.width || !c.height || !p.width) return NO_OBSTRUCTION;
  const sideSheet = p.width < c.width*0.75;
  if(sideSheet) return { rightFrac: Math.min(0.45, (c.right - p.left)/c.width), bottomFrac: 0 };
  return { rightFrac: 0, bottomFrac: Math.min(0.6, (c.bottom - p.top)/c.height) };
}
