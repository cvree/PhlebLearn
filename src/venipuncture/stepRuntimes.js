/* =========================================================================
   The physical step runtimes, as one ordered table.

   Ten converted steps each own the canvas outright while they are running,
   and each exposes the identical five hooks: is it active, render a frame,
   and the three pointer phases (plus cancel). The composition root used to
   carry five hand-maintained ten-branch if-chains over those hooks — fifty
   lines that all had to be edited together, and that silently dropped a step
   from one chain if a branch was ever added to only four of them.

   The table below is the single ordered list. `activeStepRuntime()` answers
   "whose canvas is it right now?" once, and main.js reads the hooks off the
   winner. Adding a converted step is one entry here and nothing in main.js.

   Order is significant only in that it is the same first-match-wins order the
   if-chains had: the steps are mutually exclusive in practice, so the first
   match IS the only match, and preserving the order keeps that guarantee
   identical if two ever overlap.

   ---------------------------------------------------------------------------
   WHICH RUNTIME GETS THE POINTER.

   The table is also the priority order the pointer is offered in. A draw is
   still a relay — one step holds the bench, hands over, and the next takes it
   — but the dispatch no longer ASSUMES that, because assuming it is what makes
   the draw feel like a slideshow: you cannot reach for the alcohol until the
   band's step has agreed to end.

       before:  active step      ->  runtime  ->  what you can touch
       after:   what you touched ->  runtime  ->  active step

   The rules are general, so they live in bench/gestureDispatch.js and are
   tested there against stub rows. Two things are worth knowing here:

     · A gesture belongs to whoever took the DOWN, for its whole life. That is
       a bug fix as much as a feature — a step that ends mid-gesture used to
       leave its own pointerup with nobody to deliver it to.

     · The claim IS each runtime's `down` return value. Every runtime already
       hit-tests its own objects and returns false on a miss; a separate
       `claims(pick)` would be a second copy of that test, outside the state it
       needs, and the two would drift.

   `reach` — offering the pointer to every live runtime rather than only the
   first — is Play's. Learn is offered one runtime at a time, permanently.
   ========================================================================= */
import {
  isStagingActive, renderStaging,
  stagingPointerDown, stagingPointerMove, stagingPointerUp, stagingPointerCancel,
} from "./staging/stagingRuntime.js";
import {
  isTourniquetActive, renderTourniquet,
  tourniquetPointerDown, tourniquetPointerMove, tourniquetPointerUp, tourniquetPointerCancel,
} from "./tourniquet/tourniquetRuntime.js";
import {
  isPalpationActive, renderPalpation,
  palpationPointerDown, palpationPointerMove, palpationPointerUp, palpationPointerCancel,
} from "./palpation/palpationRuntime.js";
import {
  isCleaningActive, renderCleaning,
  cleaningPointerDown, cleaningPointerMove, cleaningPointerUp, cleaningPointerCancel,
} from "./cleaning/cleaningRuntime.js";
import {
  isAssemblyActive, renderAssembly,
  assemblyPointerDown, assemblyPointerMove, assemblyPointerUp, assemblyPointerCancel,
} from "./assembly/assemblyRuntime.js";
import {
  isInsertActive, renderInsert,
  insertPointerDown, insertPointerMove, insertPointerUp, insertPointerCancel,
} from "./insert/insertRuntime.js";
import {
  isCollectionActive, renderCollection,
  collectionPointerDown, collectionPointerMove, collectionPointerUp, collectionPointerCancel,
} from "./collection/collectionRuntime.js";
import {
  isWithdrawalActive, renderWithdrawal,
  withdrawalPointerDown, withdrawalPointerMove, withdrawalPointerUp, withdrawalPointerCancel,
} from "./withdrawal/withdrawalRuntime.js";
import {
  isPostDrawActive, renderPostDraw,
  postDrawPointerDown, postDrawPointerMove, postDrawPointerUp, postDrawPointerCancel,
} from "./postdraw/postDrawRuntime.js";
import {
  isInversionActive, renderInversion,
  inversionPointerDown, inversionPointerMove, inversionPointerUp, inversionPointerCancel,
} from "./inversion/inversionRuntime.js";
import { createGestureDispatch } from "../bench/gestureDispatch.js";

export const STEP_RUNTIMES = [
  { id: "staging",    isActive: isStagingActive,    render: renderStaging,    down: stagingPointerDown,    move: stagingPointerMove,    up: stagingPointerUp,    cancel: stagingPointerCancel },
  { id: "tourniquet", isActive: isTourniquetActive, render: renderTourniquet, down: tourniquetPointerDown, move: tourniquetPointerMove, up: tourniquetPointerUp, cancel: tourniquetPointerCancel },
  { id: "palpation",  isActive: isPalpationActive,  render: renderPalpation,  down: palpationPointerDown,  move: palpationPointerMove,  up: palpationPointerUp,  cancel: palpationPointerCancel },
  { id: "cleaning",   isActive: isCleaningActive,   render: renderCleaning,   down: cleaningPointerDown,   move: cleaningPointerMove,   up: cleaningPointerUp,   cancel: cleaningPointerCancel },
  { id: "assembly",   isActive: isAssemblyActive,   render: renderAssembly,   down: assemblyPointerDown,   move: assemblyPointerMove,   up: assemblyPointerUp,   cancel: assemblyPointerCancel },
  { id: "insert",     isActive: isInsertActive,     render: renderInsert,     down: insertPointerDown,     move: insertPointerMove,     up: insertPointerUp,     cancel: insertPointerCancel },
  { id: "collection", isActive: isCollectionActive, render: renderCollection, down: collectionPointerDown, move: collectionPointerMove, up: collectionPointerUp, cancel: collectionPointerCancel },
  { id: "withdrawal", isActive: isWithdrawalActive, render: renderWithdrawal, down: withdrawalPointerDown, move: withdrawalPointerMove, up: withdrawalPointerUp, cancel: withdrawalPointerCancel },
  { id: "postdraw",   isActive: isPostDrawActive,   render: renderPostDraw,   down: postDrawPointerDown,   move: postDrawPointerMove,   up: postDrawPointerUp,   cancel: postDrawPointerCancel },
  { id: "inversion",  isActive: isInversionActive,  render: renderInversion,  down: inversionPointerDown,  move: inversionPointerMove,  up: inversionPointerUp,  cancel: inversionPointerCancel },
];

/** The step that owns the canvas right now, or null if the room does. */
export function activeStepRuntime(){
  for(let i = 0; i < STEP_RUNTIMES.length; i++){
    if(STEP_RUNTIMES[i].isActive()) return STEP_RUNTIMES[i];
  }
  return null;
}

/**
 * Every runtime live right now, in table order.
 *
 * One entry today, because a draw is still a relay. The list is what the
 * pointer is offered to, so the day two modes hold the bench at once this is
 * the only thing that has to be true for reaching to work.
 */
export function activeStepRuntimes(){
  return STEP_RUNTIMES.filter(r => r.isActive());
}

/* ---------- the gesture in progress ---------------------------------------
   One dispatcher for the application, because there is one canvas and one
   pointer on it. The rules it enforces are general and are tested on their
   own against stub rows — see bench/gestureDispatch.js and
   tests/gestureDispatch.spec.js. This file only supplies the table. */
const dispatch = createGestureDispatch(activeStepRuntimes);

/**
 * Offers a pointerdown to the live runtimes and latches whoever takes it.
 *
 * @param {PointerEvent} e
 * @param {HTMLCanvasElement} canvasEl
 * @param {{reach?: boolean}} [o]  `reach` offers the event to every live
 *   runtime rather than only the first — Play's behaviour. Learn passes it
 *   false and keeps one-runtime-at-a-time dispatch permanently.
 * @returns the runtime now holding the gesture, or null if the bench is not
 *   up. A non-null answer means orbit must not see this event.
 */
export function beginGesture(e, canvasEl, o){ return dispatch.down(e, canvasEl, o); }

/** The runtime holding the gesture, or null between gestures. */
export function gestureOwner(){ return dispatch.owner; }

/** Routes a move to whoever took the down. @returns true when consumed. */
export function gestureMove(e, canvasEl){ return dispatch.move(e, canvasEl); }

/**
 * Ends the gesture at whoever took it, however the step machine has moved on
 * in the meantime.
 * @param {"up"|"cancel"} phase
 * @returns true when the bench consumed it.
 */
export function endGesture(phase, e, canvasEl){ return dispatch.end(phase, e, canvasEl); }

/** Drops the latch without telling anybody — for a scene torn down mid-gesture. */
export function forgetGesture(){ dispatch.forget(); }
