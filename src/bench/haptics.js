/* =========================================================================
   HAPTICS — the third feedback channel, where the device has one.

   Short and specific. A vibration that lasts long enough to notice consciously
   has already stopped being touch and started being an alarm, so every pattern
   here is measured in tens of milliseconds and shaped so that the IMPORTANT
   moments are the ones with structure: two beats for a give, a rising pair for
   the flashback.

   Respects reduced motion, because for some people this IS the motion setting.
   ========================================================================= */
import { SS, REDUCED } from "../game/gameState.js";

function can(){
  return !REDUCED && SS.haptics !== false &&
    typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

function buzz(pattern){
  if(!can()) return;
  try{ navigator.vibrate(pattern); }catch(_){}
}

/** Something touched something. The smallest tick the API can express. */
export function tapHaptic(){ buzz(8); }

/** A held object seated into a destination — a tube into a rack well. */
export function seatHaptic(){ buzz([12, 22, 8]); }

/** The tip meets skin: one small, dry contact. */
export function contactHaptic(){ buzz(10); }

/** The skin gives. The single sharpest event in the game. */
export function skinPopHaptic(){ buzz([26, 14, 10]); }

/** The vein wall gives, a moment later: softer, and lower. */
export function veinPopHaptic(){ buzz([16, 10, 22]); }

/**
 * Flashback. Deliberately the longest pattern in the file — it is the one
 * moment the player is meant to feel in their hand after the fact.
 */
export function flashHaptic(){ buzz([18, 30, 26, 40, 60]); }

/** The safety device closing: hard, single, definitive. */
export function clackHaptic(){ buzz(22); }

/** Something went wrong, and the patient felt it. */
export function winceHaptic(){ buzz([30, 60, 30]); }

/** The band setting under tension. */
export function setHaptic(){ buzz([10, 18, 16]); }
