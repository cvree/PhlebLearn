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
