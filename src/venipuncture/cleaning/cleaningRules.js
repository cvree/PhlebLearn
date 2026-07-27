/* =========================================================================
   ASEPTIC SITE CLEANING — the rules.

   The old step measured how far a 🧽 had been dragged. Distance is not the
   skill. What actually decides whether a site is clean is:

     COVERAGE   the whole area the needle and your fingers will touch, not a
                dab in the middle
     DIRECTION  concentric circles working OUTWARD from the puncture point.
                Scrubbing back inward drags skin flora from the dirty edge
                onto the spot you just cleaned
     FRICTION   alcohol needs mechanical scrubbing, not painting
     DRY TIME   ~30 seconds. Wet alcohol is not disinfected, it stings, and it
                haemolyses the sample
     NO RETOUCH once it is clean it stays untouched — re-palpating the site
                with an ungloved fingertip undoes all of it

   Pure maths. tests/cleaning.spec.js asserts every threshold.
   ========================================================================= */
import { clamp01, smoothstep } from "../arm/armAnatomy.js";

/** The prep field: alcohol has to cover this radius around the puncture point. */
export const FIELD_RADIUS = 0.025;        // 5 cm across, the usual teaching figure
/** Coverage below this leaves skin the needle will touch undisinfected. */
export const COVERAGE_TARGET = 0.80;
/** Alcohol has to be scrubbed, not painted: strokes below this do nothing. */
export const FRICTION_MIN = 0.18;
/** Seconds of air drying before the site counts as dry. */
export const DRY_SECONDS = 30;
/** Under this it is still visibly wet and nothing may touch it. */
export const WET_SECONDS = 8;

/**
 * The grid the swab paints into. Coarse on purpose — this is a coverage
 * measure, not a texture, and 24×24 over a 5 cm field is ~2 mm cells.
 */
export const GRID = 24;

/** Cell index for a point in the field, or null when outside it. */
export function cellFor(dx, dz){
  const r = Math.hypot(dx, dz);
  if(r > FIELD_RADIUS) return null;
  const gx = Math.floor(((dx + FIELD_RADIUS)/(2*FIELD_RADIUS))*GRID);
  const gz = Math.floor(((dz + FIELD_RADIUS)/(2*FIELD_RADIUS))*GRID);
  if(gx < 0 || gx >= GRID || gz < 0 || gz >= GRID) return null;
  return gz*GRID + gx;
}

/** How many cells of the grid actually lie inside the circular field. */
export function cellsInField(){
  let n = 0;
  const step = (2*FIELD_RADIUS)/GRID;
  for(let gz = 0; gz < GRID; gz++){
    for(let gx = 0; gx < GRID; gx++){
      const dx = -FIELD_RADIUS + (gx + 0.5)*step;
      const dz = -FIELD_RADIUS + (gz + 0.5)*step;
      if(Math.hypot(dx, dz) <= FIELD_RADIUS) n++;
    }
  }
  return n;
}

/** Fraction of the field that has been scrubbed. */
export function coverageOf(painted){
  const total = cellsInField();
  return total ? clamp01(painted.size/total) : 0;
}

/**
 * Was the scrubbing worked outward, the way it should be?
 *
 * Scored as the fraction of travel that moved AWAY from the puncture point.
 * A true spiral is close to 1; scrubbing back and forth across the site sits
 * near 0.5; working inward from the edge tends below it.
 */
export function outwardFraction(outwardTravel, totalTravel){
  if(!totalTravel) return 0;
  return clamp01(outwardTravel/totalTravel);
}
export const OUTWARD_GOOD = 0.60;

/** How dry the site is, 0 (soaking) … 1 (ready). */
export function dryness(secondsSinceLastStroke){
  return smoothstep(0, DRY_SECONDS, secondsSinceLastStroke || 0);
}

/* ---------- judgement --------------------------------------------------------- */

function issue(code, severity, message, data){
  return { code, severity, message, data: data || null };
}

/**
 * @param {object} state cleaningState
 * @param {number} [now] injectable clock
 */
export function evaluateCleaning(state, now){
  const issues = [];
  const coverage = coverageOf(state.painted);
  const secs = secondsDrying(state, now);
  const dry = dryness(secs);
  const outward = outwardFraction(state.outwardTravel, state.totalTravel);

  if(!state.strokes){
    issues.push(issue("notCleaned", "block",
      "The site has not been cleaned. Scrub it with the alcohol pad before anything touches it."));
  }else{
    if(coverage < COVERAGE_TARGET){
      issues.push(issue("underCovered", "block",
        `Only ${Math.round(coverage*100)}% of the field has been scrubbed. Cover the whole area the needle and your fingers will touch, not just the puncture point.`,
        { coverage }));
    }
    if(state.totalTravel > 0 && outward < OUTWARD_GOOD){
      issues.push(issue("scrubbedInward", "warn",
        "You worked back over skin you had already cleaned. Start at the puncture point and spiral outward, so you are never dragging the dirty edge back into the middle.",
        { outward }));
    }
    if(state.lightStrokes > state.strokes*0.5){
      issues.push(issue("noFriction", "warn",
        "That was painting, not scrubbing. Alcohol disinfects by friction — press and work it into the skin."));
    }
  }

  if(state.retouchedAfterClean){
    issues.push(issue("retouched", "block",
      "The site was touched again after it was cleaned. That undoes it — clean it again, and this time do not go back to it."));
  }

  if(state.strokes && coverage >= COVERAGE_TARGET){
    if(secs < WET_SECONDS){
      issues.push(issue("stillWet", "block",
        "It is still visibly wet. Puncturing through wet alcohol stings, and it haemolyses the sample. Let it air-dry.",
        { seconds: secs }));
    }else if(dry < 1){
      issues.push(issue("notDryYet", "warn",
        `Give it the full ${DRY_SECONDS} seconds to air-dry — ${Math.round(secs)}s so far. Do not fan it or blot it.`,
        { seconds: secs }));
    }
  }

  if(state.blottedOrFanned){
    issues.push(issue("blotted", "warn",
      "Fanning or blotting the site re-contaminates it and defeats the point of the alcohol. Let it dry on its own."));
  }

  const order = ["block", "warn", "note"];
  issues.sort((a,b)=>order.indexOf(a.severity) - order.indexOf(b.severity));
  const blocking = issues.filter(i=>i.severity === "block");

  return {
    ready: blocking.length === 0 && !!state.strokes && coverage >= COVERAGE_TARGET && dry >= 1,
    issues, blocking,
    coverage, outward, dryness: dry, secondsDrying: secs,
  };
}

/** Seconds since the last time the swab touched the skin. */
export function secondsDrying(state, now){
  if(!state.lastStrokeAt) return 0;
  return ((now == null ? Date.now() : now) - state.lastStrokeAt)/1000;
}

export function nextIssue(result){
  return result && result.issues.length ? result.issues[0] : null;
}

export function nextAction(state, result){
  if(!state.swabOpen) return "Open the alcohol pad.";
  if(!state.strokes) return "Scrub the site — start on the puncture point and work outward in circles.";
  if(result.coverage < COVERAGE_TARGET) return "Keep going — widen the circles until the whole field is covered.";
  if(result.dryness < 1) return "Hands off now. Let it air-dry — do not fan it, blot it, or touch it.";
  return "Dry and clean. Do not touch the site again.";
}
