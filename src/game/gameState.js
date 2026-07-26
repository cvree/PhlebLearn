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
    handedness:"right", assistedSnapping:false, stagingListView:false};
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

// "play" = scored shift | "teach" = guided learning
export let MODE = "play";
export function setMode(m){ MODE = m; }
export function guided(){ return MODE==="teach"; }

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
