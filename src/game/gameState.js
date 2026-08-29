/* =========================================================================
   Owns every piece of mutable game state: the persistent save (SS), the
   current encounter (ENC), the shift in progress (SHIFT), and the small
   session flags (state, MODE, ARRANGE, DARK, REDUCED).

   These are exported as live `let` bindings — ES modules give importers a
   read-only *live* view of them, so `import { state } from '.../gameState.js'`
   always sees the current value without polling. The only way to WRITE any
   of them is through the exported setter functions below; nothing outside
   this file should ever reassign them directly. That is the module boundary
   that keeps this from turning back into ad-hoc globals.
   ========================================================================= */
import { KEY } from "../config.js";
import { challengeSetup } from "./activeChallenges.js";

export function defaultSS(){
  return {xp:0,coins:0,earned:0,badges:[],mastery:{},weak:[],shifts:0,bestRating:0,reduceMotion:false,music:true,musicVol:0.55,ownedUpgrades:[],placements:{},wallPlace:{},rotations:{},wallRot:{},stickers:{},stickerClaimed:{},dark:false,
    // physical-interaction preferences (branch: physical supply staging)
    handedness:"right", assistedSnapping:false, stagingListView:false,
    // "How this works" opens once, on a save that has never played, and is in
    // Settings from then on. See ui/settings.js's maybeOpenHelp().
    seenHelp:false,
    // per-mode progress: Learn, Practice and Final Practical are tracked
    // separately, because a best set with the coach talking is not the same
    // achievement as one set in silence. See game/modeProgress.js.
    modeProgress:{}};
}
function loadSS(){
  try{ const r=localStorage.getItem(KEY); if(r) return Object.assign(defaultSS(),JSON.parse(r)); }catch(e){}
  return defaultSS();
}

export let SS = loadSS();
export function saveSS(){ try{ localStorage.setItem(KEY, JSON.stringify(SS)); }catch(e){} }

// current screen state machine ("idle" | "arrive" | "verify" | ... | "score" | "summary")
export let state = "idle";
export function setState(s){ state = s; }

/* =========================================================================
   TWO MODES

   The game used to have four — Learn, Practice, Final Practical and the
   Bench — which is four answers to the two questions a learner actually
   arrives with: TEACH ME and TEST ME. Every extra card on the clock-in screen
   was a decision taken before any blood was drawn, by someone with no basis
   yet for taking it.

   So there are two, and they differ in exactly one thing: WHAT THE LEARNER IS
   TOLD WHILE THEY WORK. One boolean could not express that, so `reveal()` is
   the single descriptor every coach and panel reads instead of re-deriving it.

     instruction      full teaching prose, the specific error, the correct
                      next action, and a Continue button gated on being right
     hints            a standing reminder of what this step is for — never
                      what is currently wrong with it
     verdicts         may colour a measured value good/bad, or say "ready"
     liveNumbers      may show the measured value at all
     gateContinue     may refuse to advance until the step is correct
     sectionFeedback  shows the section's own measurements when it ends
     repeatSections   may offer to replay a section that went badly
     highlights       may highlight anatomy and tool regions in the scene
     stepChrome       a step counter, a progress bar, and a button that has to
                      be pressed before the next step will start

   WHAT HAPPENED TO PRACTICE AND THE BENCH.

   Practice's two genuinely good ideas — feedback at the end of a section, and
   being able to replay that section — are TEACHING, not testing, so they moved
   into Learn, which is where a learner who wants to be shown their mistakes
   already is. Nothing was deleted except the card.

   The Bench was a rehearsal room with no scoring and an instant reset. What it
   was really compensating for is that a draw used to be a sixteen-screen form
   you could not get through quickly; Play is continuous now, so "one more go"
   is just the next patient.

   NOTE FOR ANYONE DELETING THINGS: `src/bench/` is NOT the Bench. That
   directory is the scene-lease layer (`benchSession.js`) and the feel layer
   (`assist`, `motion`, `haptics`) that one-scene-per-encounter is built on.
   Removing it would rebuild the patient's arm between every step again, which
   is the exact architectural problem the redesign exists to have fixed.

   The legacy strings still map in, because saved games, saved links and the
   ?e2e=1 seam all pass them.
   ========================================================================= */
export const MODES = { LEARN:"learn", PLAY:"play" };

/* "final" was the old name for Play. "practice" and "bench" were modes whose
   worthwhile parts are now inside Learn, so that is where their saved progress
   goes — a learner who put twenty draws through Practice must not open the new
   build to a blank record. See saveSystem.js's migration for the other half. */
const LEGACY_MODES = {
  teach: MODES.LEARN,
  practice: MODES.LEARN,
  bench: MODES.LEARN,
  final: MODES.PLAY,
};

export function normaliseMode(m){
  if(LEGACY_MODES[m]) return LEGACY_MODES[m];
  return (m===MODES.LEARN || m===MODES.PLAY) ? m : MODES.PLAY;
}

export const MODE_REVEAL = {
  [MODES.LEARN]: {
    instruction:true, hints:true, verdicts:true, liveNumbers:true,
    gateContinue:true, sectionFeedback:true, repeatSections:true, highlights:true,
    stepChrome:true,
  },
  /* Nothing is said until the report. No instruction, no hint, no verdict, no
     step counter, and no button between one step and the next — the action
     itself is what advances the draw. A trained phlebotomist should be able to
     work through this without reading anything at all, which is only true if
     there is nothing to read. */
  [MODES.PLAY]: {
    instruction:false, hints:false, verdicts:false, liveNumbers:false,
    gateContinue:false, sectionFeedback:false, repeatSections:false, highlights:false,
    stepChrome:false,
  },
};

export const MODE_NAMES = {
  [MODES.LEARN]:"Learn", [MODES.PLAY]:"Play",
};

export let MODE = MODES.PLAY;
export function setMode(m){ MODE = normaliseMode(m); }
export function guided(){ return MODE===MODES.LEARN; }
/** A scored shift. Nothing is revealed until the debrief. */
export function playMode(){ return MODE===MODES.PLAY; }
/** The descriptor above for the current mode. Never mutate the result. */
/**
 * What the learner is told while they work.
 *
 * The "No coach" challenge closes the four telling channels on top of
 * whatever the mode already allows — it can only ever take things away, never
 * hand Learn Mode's instructions to a Final Practical. `gateContinue` goes
 * with them: a gate that refuses to advance until the step is right IS an
 * instruction, just one delivered as a locked button.
 */
export function reveal(){
  const base = MODE_REVEAL[MODE] || MODE_REVEAL[MODES.PLAY];
  if(!challengeSetup().silence) return base;
  return Object.assign({}, base, {
    instruction:false, hints:false, verdicts:false, gateContinue:false, highlights:false,
  });
}

/* =========================================================================
   DIRECT MANIPULATION, OR BUTTONS FOR EVERYTHING.

   One accessibility preference, read by all eleven physical steps.

   It replaces eleven SEPARATE per-step flags — `SS.collectionListView`,
   `SS.tourniquetListView`, and nine more — each of which was written to the
   SAVE the moment a learner tapped that step's "Use controls" toggle. So one
   tap during one tube made every future tube in every future draw a list of
   buttons, permanently and invisibly, and the 3D bench this entire game is
   built around was simply never seen again. That is the direct cause of the
   report that tube collection "becomes a 2D thing".

   An access need is a property of the PERSON, not of a step, and it belongs
   in Settings where it can be found and undone. The in-step toggle survives
   as a per-draw preference that does not outlive the encounter.
   ========================================================================= */
export function buttonControls(){ return !!SS.buttonControls; }

export let SHIFT = {len:5,index:0,patients:[],ratings:[],orderAllOk:true,safetyAllOk:true};
export function setShift(next){ SHIFT = next; }

// current encounter (patient, in-progress choices, venipuncture procedure state)
export let ENC = null;
export function setEnc(next){ ENC = next; }

// in-room drag/arrange mode
export let ARRANGE = false;
export function setArrange(v){ ARRANGE = v; }

// theme + motion, persisted on SS but read hot-path by rendering, so mirrored here as flags
export let DARK = !!SS.dark;
export function setDark(v){ DARK = v; SS.dark = v; saveSS(); }

export let REDUCED = !!SS.reduceMotion;
export function setReduced(v){ REDUCED = v; SS.reduceMotion = v; saveSS(); }
