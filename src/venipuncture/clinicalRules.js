/* =========================================================================
   Explicit sequencing gates for the venipuncture procedure. These exist so
   that "is X allowed right now" is answered by checking named boolean state
   fields — never by matching words in a question's text (the Phase 0
   requirement is explicit: "Do not rely on text matching such as checking
   whether a question includes words like 'flip,' 'tube,' or 'inversion.'
   Use explicit trigger data.").

   Each function takes the current procedure state (the same shape as the
   old ENC.collect object, extended with the fields below) and returns a
   plain boolean. venipuncture/steps.js calls these before allowing a step's
   action to complete; tests/procedure.spec.js exercises them directly.
   ========================================================================= */

// Tourniquet may only be released once blood flash has actually been
// confirmed at insertion — never on a timer alone.
export function canReleaseTourniquet(state){
  return !!state.insertOk;
}

// The needle may only be withdrawn after the LAST tube has been taken off
// the holder — never before.
export function canWithdrawNeedle(state){
  return !!state.lastTubeRemoved;
}

// The safety shield is engaged only once the needle is actually out.
export function canActivateSafety(state){
  return !!state.withdrawOk;
}

// The whole needle-and-holder assembly must reach the sharps container
// immediately after the safety device is engaged — before pressure/bandage,
// matching real "point of use" disposal.
export function canDisposeSharps(state){
  return !!state.safetyOk;
}

// Pressure (and bandaging, gated on pressure below) may only start after the
// sharps unit has actually been disposed of.
export function canApplyPressure(state){
  return !!state.disposeOk;
}
export function canApplyBandage(state){
  return !!state.pressureOk;
}

// A tube may only be inverted once it has been filled AND removed from the
// holder — inverting while still attached to the patient is meaningless and
// must never be offered, regardless of what array position a tube happens
// to occupy.
export function canInvertTube(state, tubeKey){
  const filled = !!(state.filled && state.filled.includes(tubeKey));
  const removedFromPatient = !!state.withdrawOk; // the draw itself is over
  return filled && removedFromPatient;
}
