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

export function defaultSS(){
  return {xp:0,coins:0,earned:0,badges:[],mastery:{},weak:[],shifts:0,bestRating:0,reduceMotion:false,music:true,musicVol:0.55,ownedUpgrades:[],placements:{},wallPlace:{},rotations:{},wallRot:{},stickers:{},stickerClaimed:{},dark:false,
    // physical-interaction preferences (branch: physical supply staging)
    handedness:"right", assistedSnapping:false, stagingListView:false,
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
   THE THREE MODES

   Learn, Practice and Final Practical are not difficulty settings — they
   differ in WHAT THE LEARNER IS TOLD WHILE THEY WORK. One boolean could not
   express that, so `MODE` is a three-way value and `reveal()` is the single
   descriptor every coach and panel reads instead of re-deriving it.

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

   The legacy strings "teach" and "play" still map in, because the ?e2e=1
   seam and saved links pass them.
   ========================================================================= */
export const MODES = { LEARN:"learn", PRACTICE:"practice", FINAL:"final" };

const LEGACY_MODES = { teach:MODES.LEARN, play:MODES.FINAL };

export function normaliseMode(m){
  if(LEGACY_MODES[m]) return LEGACY_MODES[m];
  return (m===MODES.LEARN || m===MODES.PRACTICE || m===MODES.FINAL) ? m : MODES.FINAL;
}

export const MODE_REVEAL = {
  [MODES.LEARN]: {
    instruction:true, hints:true, verdicts:true, liveNumbers:true,
    gateContinue:true, sectionFeedback:false, repeatSections:false, highlights:true,
  },
  [MODES.PRACTICE]: {
    // No immediate answers: the hint says what the step is for, the verdict
    // waits for the end of the section, and nothing blocks the learner from
    // finishing a step badly — that is the thing being practised.
    instruction:false, hints:true, verdicts:false, liveNumbers:true,
    gateContinue:false, sectionFeedback:true, repeatSections:true, highlights:false,
  },
  [MODES.FINAL]: {
    instruction:false, hints:false, verdicts:false, liveNumbers:true,
    gateContinue:false, sectionFeedback:false, repeatSections:false, highlights:false,
  },
};

export const MODE_NAMES = {
  [MODES.LEARN]:"Learn", [MODES.PRACTICE]:"Practice", [MODES.FINAL]:"Final Practical",
};

export let MODE = MODES.FINAL;
export function setMode(m){ MODE = normaliseMode(m); }
export function guided(){ return MODE===MODES.LEARN; }
export function practiceMode(){ return MODE===MODES.PRACTICE; }
export function finalPractical(){ return MODE===MODES.FINAL; }
/** The descriptor above for the current mode. Never mutate the result. */
export function reveal(){ return MODE_REVEAL[MODE] || MODE_REVEAL[MODES.FINAL]; }

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
