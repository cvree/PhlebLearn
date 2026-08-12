/* =========================================================================
   TOURNIQUET RUNTIME — applying a real band to a real arm.

   One continuous gesture, four things it measures, none of them a hit test on
   a glowing rectangle:

     1  ROUTE    drag an end around the limb. Which WAY round you go is the
                 sign of the swept angle: under the arm and up (correct), or
                 laid across the top (wrong). WHERE along the arm you cross is
                 the band's position, measured in metres from the fossa. How
                 much you drift along the arm mid-sweep is the skew, which is
                 what turns a flat band into a pinching cord.

     2  TENSION  pull the free end away from the limb. Tension is the real
                 pull distance, and the learner judges it by watching the
                 veins fill — not by reading a meter. Overshoot and the hand
                 blanches and the veins collapse again.

     3  CROSS    sweep the held end past the other one, keeping the tension.
                 Let go here and the band springs off, exactly as it would.

     4  TUCK     push a loop back under the band. Which side of the band you
                 push it through decides whether the tail points up the arm
                 (correct) or lies across the site you are about to clean.

   Then it stays on. The strap persists in the scene and on the encounter, and
   the clock it starts runs through every step that follows.

   Owns interaction. It writes tourniquetState and asks tourniquetRules; it
   never decides correctness itself.
   ========================================================================= */
import * as THREE from "three";
import { sfx } from "../../audio/audioManager.js";
import { leaseBenchView } from "../../bench/benchSession.js";
import { ARM_Y } from "../arm/armMesh.js";
import { SITE, distalPallor, radiusAt } from "../arm/armAnatomy.js";
import { buildStrap, contactArc, freeTail, STRAP_WIDTH } from "./strapMesh.js";
import {
  PHASE, WRAP, TUCK,
  createTourniquetState, markRouted, setTension, markCrossed,
  markSecured, markUnravelled, markReleased, secondsOn, isSecured,
} from "./tourniquetState.js";
import { evaluateTourniquet } from "./tourniquetRules.js";
import { measureObstruction, viewportAspect } from "../viewport.js";

/* ---------- gesture constants ---------------------------------------------- */

const TAP_PX = 7;
/* Half a turn is what actually gets a band round a limb: from the bench in
   front of the arm, down past the near edge, under, and up the far side. The
   threshold sits just under π so a genuine pass completes, while a wiggle
   back and forth over the near edge does not. It also has to stay well clear
   of a SECOND turning point some way round the circle — where the same
   flattened-derivative problem recurs and direction tracking needs room to
   settle — so this is deliberately not pushed any lower. */
const WRAP_COMPLETE = 1.75;
/* How far clear of the arm the hand may stray, as a fraction of the limb's
   silhouette, and still count as having passed the band UNDERNEATH rather
   than laid it across the top. Anything on the skin measures at most 1. */
const LIFT_LIMIT = 1.12;
/** how far the band's contact arc stops short of the top, each side */
const END_GAP = 0.30*Math.PI;
/** pull clear of the limb, in metres, that corresponds to full tension */
const PULL_FULL = 0.085;
/** the held end must come back within this of the limb's silhouette to tuck */
const TUCK_CLEARANCE = 0.014;
/** and be offset at least this far along the arm for the tuck to have a side */
const TUCK_OFFSET = 0.016;
/** how far the band sinks into the limb at full tension */
const MAX_BITE = 0.008;
/** how far along the arm the band may be placed at all */
// Wide enough to cover both procedures' ideal windows: the antecubital draw
// never went past -0.06, and a hand draw's band sits as far down as -0.237.
// Widening a MINIMUM only adds reachable positions — it cannot change where
// an existing antecubital placement lands.
const BAND_RANGE = { min: -0.26, max: 0.185 };

let ctx = null;

/* ---------- lifecycle -------------------------------------------------------- */

/**
 * @param {object} opts
 *   state          an existing tourniquetState to resume, or null for a new one
 *   arm            {skin, build, armSide, scenarioKeys, vigour, shirt}
 *   guided         teaching mode shows the site marker and the band's target zone
 *   onChange(result)
 *   onOrientationChange(orientation)
 */
export function startTourniquet(opts){
  const o = opts || {};
  const view = leaseBenchView({ mode: "tourniquet", arm: o.arm || {} });
  const state = o.state || createTourniquetState({
    itemId: o.itemId,
    armSide: (o.arm && o.arm.armSide) || "right",
    vigour: (o.arm && o.arm.vigour) || 1,
  });

  const strap = buildStrap({ color: o.strapColor });
  view.root.add(strap.group);

  // Teaching mode shows where the ideal window actually is, as a band on the
  // skin — centred on THIS procedure's site, not always the fossa's.
  const siteMid = (o.arm && o.arm.site)
    ? o.arm.site.x + (o.arm.site.ideal.min + o.arm.site.ideal.max)/2
    : 0.089;
  const zone = buildTargetZone(o.arm && o.arm.build, siteMid);
  zone.visible = !!o.guided;
  view.root.add(zone);

  ctx = {
    ...o,
    view, state, strap, zone,
    raycaster: new THREE.Raycaster(),
    ndc: new THREE.Vector2(),
    drag: null,
    lastAspect: 0,
    frame: 0,
    active: true,
    /** live geometry the ribbon is drawn from, rebuilt every change */
    geom: {
      bandX: 0.088,
      thetaA: END_GAP,            // anchored end leaves the limb here
      thetaB: -END_GAP,           // held end leaves the limb here
      heldPoint: null,
      anchorPoint: null,
      bite: 0,
      twist: 0,
    },
  };

  view.setSiteVisible(!!o.guided);
  layoutLoose();
  refreshStrap();
  notify();
  return ctx;
}

export function stopTourniquet(){
  if(!ctx) return;
  ctx.strap.dispose();
  ctx.view.dispose();
  ctx = null;
}

export function isTourniquetActive(){ return !!(ctx && ctx.active); }
export function getTourniquetContext(){ return ctx; }

function notify(){
  if(!ctx) return null;
  const result = evaluateTourniquet(ctx.state, {
    vessels: ctx.view.arm.vessels,
    vigour: (ctx.arm && ctx.arm.vigour) || 1,
    site: ctx.arm && ctx.arm.site,
  });
  applyPhysiology(result);
  if(ctx.onChange) ctx.onChange(result);
  return result;
}

/** The arm's response to whatever the band is currently doing. */
function applyPhysiology(result){
  ctx.view.arm.setDistension(result.distension);
  const t = isSecured(ctx.state) ? ctx.state.heldTension : ctx.state.tension;
  ctx.view.arm.setPallor(distalPallor(t));
  ctx.strap.setStretch(t);
}

/* ---------- teaching-mode target zone ---------------------------------------- */

function buildTargetZone(build, siteMid){
  const x = siteMid == null ? 0.089 : siteMid;
  const g = new THREE.Group();
  g.name = "bandZone";
  const r = radiusAt(x, build) + 0.0016;
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, 0.026, 24, 1, true, Math.PI*0.15, Math.PI*0.7),
    new THREE.MeshBasicMaterial({ color: 0x3f8f6d, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })
  );
  band.rotation.z = Math.PI/2;
  band.position.set(x, ARM_Y, 0);
  g.add(band);
  return g;
}

/* ---------- geometry ---------------------------------------------------------- */

/**
 * The strap coiled on the bench, before it is picked up. Kept close to the
 * arm and well inside the ~0.20 m of depth the camera actually frames (see
 * fitCamera's spanZ below) — coiled further out than that renders the strap
 * partly or wholly below the visible canvas, which made it ungrabbable, not
 * just hard to see.
 */
function layoutLoose(){
  const pts = [];
  const n = 26;
  for(let i=0;i<n;i++){
    const t = i/(n-1);
    pts.push(new THREE.Vector3(
      -0.035 + t*0.165,
      0.004 + Math.sin(t*Math.PI)*0.002,
      0.058 + Math.sin(t*Math.PI*1.6)*0.010
    ));
  }
  ctx.geom.loose = pts;
}

/** The radius the wrap gesture is measured against: the limb plus the band. */
function limbRadius(x){ return ctx.view.arm.radiusAt(x) + STRAP_WIDTH*0.10; }
export function trackRadiusAt(x){ return ctx ? limbRadius(x) : null; }

/**
 * Rebuilds the ribbon from whatever the band is currently doing. Every phase
 * produces its centreline the same way — a contact arc on the limb plus up to
 * two free tails — so there is no separate "animation" that could disagree
 * with the state.
 */
function refreshStrap(){
  const s = ctx.state, g = ctx.geom;

  if(s.phase === PHASE.LOOSE && !ctx.drag){
    ctx.strap.setCenterline(g.loose, { twist: 0 });
    return;
  }

  // --- mid-route: the band is being carried round the limb -----------------
  if(ctx.drag && ctx.drag.kind === "route"){
    const d = ctx.drag;
    const r = limbRadius(d.bandX);
    const arc = contactArc({
      bandX: d.bandX, radius: r, armY: ARM_Y,
      from: d.thetaStart, to: d.thetaNow,
      skew: d.skew, bite: 0, segments: 34,
    });
    const tailStart = arc[0].clone();
    const anchor = new THREE.Vector3(d.bandX - 0.02, 0.004, 0.118);
    const lead = d.heldPoint || arc[arc.length-1];
    const pts = freeTail(tailStart, anchor, 0.5, 8).reverse()
      .concat(arc, freeTail(arc[arc.length-1], lead, 0.15, 6));
    ctx.strap.setCenterline(pts, { twist: Math.min(1.1, Math.abs(d.skew)*22) });
    return;
  }

  // --- wrapped: a contact arc plus two tails --------------------------------
  const r = limbRadius(g.bandX);
  const bite = g.bite;
  const under = s.wrap !== WRAP.OVER;
  // Under-wrapped, the band hugs the bottom and the ends emerge near the top.
  // Laid over the top, it does the opposite and the ends finish underneath —
  // which is exactly why it cannot be tensioned properly.
  const from = under ? END_GAP : -(2*Math.PI - END_GAP);
  const to   = under ? (2*Math.PI - END_GAP) : END_GAP;

  const arc = contactArc({
    bandX: g.bandX, radius: r, armY: ARM_Y,
    from, to, skew: s.skew * (under ? 1 : -1), bite, segments: 44,
  });

  const anchorEnd = g.anchorPoint || defaultAnchorPoint();
  const heldEnd = g.heldPoint || defaultHeldPoint();
  const slack = 1 - Math.min(1, s.tension*1.4);

  const head = freeTail(arc[0], anchorEnd, slack*0.6, 8).reverse();
  const tail = freeTail(arc[arc.length-1], heldEnd, slack*0.6, 10);

  ctx.strap.setCenterline(head.concat(arc, tail), { twist: g.twist });
}

function defaultAnchorPoint(){
  const g = ctx.geom;
  const r = limbRadius(g.bandX);
  return new THREE.Vector3(g.bandX, ARM_Y + Math.cos(END_GAP)*(r + 0.030), Math.sin(END_GAP)*(r + 0.030));
}
function defaultHeldPoint(){
  const g = ctx.geom, s = ctx.state;
  const r = limbRadius(g.bandX);
  if(s.phase === PHASE.SECURED){
    // the tucked loop: a short tail lying along the arm, pointing whichever
    // way the learner actually tucked it
    const dir = s.tuck === TUCK.DISTAL ? -1 : 1;
    return new THREE.Vector3(g.bandX + dir*0.052, ARM_Y + r*0.86, 0.012);
  }
  return new THREE.Vector3(g.bandX, ARM_Y + Math.cos(-END_GAP)*(r + 0.030), Math.sin(-END_GAP)*(r + 0.030));
}

/* ---------- picking ----------------------------------------------------------- */

function setNdc(e, canvasEl){
  const rect = canvasEl.getBoundingClientRect();
  ctx.ndc.x = ((e.clientX - rect.left)/rect.width)*2 - 1;
  ctx.ndc.y = -((e.clientY - rect.top)/rect.height)*2 + 1;
  ctx.raycaster.setFromCamera(ctx.ndc, ctx.view.camera);
}

/** The limb reading under the pointer: metres along, metres off. */
function limbAt(e, canvasEl, axisX){
  const rect = canvasEl.getBoundingClientRect();
  return ctx.view.pointerToLimb(
    { x: e.clientX, y: e.clientY }, rect, axisX, limbRadius(axisX)
  );
}

/** Which end of the strap, if any, is under the pointer. */
function pickStrapEnd(e, canvasEl){
  setNdc(e, canvasEl);
  const hits = ctx.raycaster.intersectObjects(ctx.strap.group.children, true);
  for(const h of hits){
    let obj = h.object;
    while(obj && obj.userData.strapEnd === undefined) obj = obj.parent;
    if(obj && obj.userData.strapEnd !== undefined) return obj.userData.strapEnd;
  }
  // A 25 mm ribbon is a small target on a phone: allow a generous screen-space
  // grab around either end before giving up.
  return nearestEndWithin(e, canvasEl, 46);
}

function nearestEndWithin(e, canvasEl, px){
  const rect = canvasEl.getBoundingClientRect();
  let best = null, bestD = px;
  ctx.strap.ends.forEach((end, i)=>{
    const v = end.position.clone().project(ctx.view.camera);
    const sx = rect.left + (v.x*0.5 + 0.5)*rect.width;
    const sy = rect.top + (-v.y*0.5 + 0.5)*rect.height;
    const d = Math.hypot(e.clientX - sx, e.clientY - sy);
    if(d < bestD){ bestD = d; best = i; }
  });
  return best;
}

/* ---------- the gesture -------------------------------------------------------- */

export function tourniquetPointerDown(e, canvasEl){
  if(!isTourniquetActive()) return false;
  const s = ctx.state;
  const endIndex = pickStrapEnd(e, canvasEl);
  if(endIndex == null) return false;

  const anchorX = s.bandX == null ? ctx.geom.bandX : s.bandX;
  const limb = limbAt(e, canvasEl, anchorX);
  if(!limb) return false;

  try{ canvasEl.setPointerCapture(e.pointerId); }catch(_){}
  if(canvasEl.style) canvasEl.style.cursor = "grabbing";

  if(s.phase === PHASE.LOOSE){
    // Seed from the strap end's REAL position. It is a mesh sitting somewhere
    // definite, so its angle round the limb is known exactly — which gives the
    // surface solve an unambiguous branch to start from, rather than one
    // inferred from the pixel the pointer happens to be over.
    const endMesh = ctx.strap.ends[endIndex];
    const seedTheta = Math.atan2(endMesh.position.z, endMesh.position.y - ARM_Y);
    ctx.drag = {
      kind: "route",
      downX: e.clientX, downY: e.clientY, moved: false,
      end: endIndex,
      bandX: clampBandX(limb.x),
      onLimb: false,
      minX: null, maxX: null,
      // theta is read exactly every frame; only the TURN COUNT has to be
      // carried, so the sweep keeps accumulating past ±180° instead of
      // wrapping back round to zero.
      thetaRaw: seedTheta,
      thetaNow: seedTheta,
      thetaStart: seedTheta,
      swept: 0,
      skew: 0,
    };
    sfx("tap");
    return true;
  }

  if(s.phase === PHASE.ROUTED || s.phase === PHASE.TENSIONING || s.phase === PHASE.CROSSED){
    ctx.drag = {
      kind: "tension",
      downX: e.clientX, downY: e.clientY, moved: false,
      end: endIndex,
      startSide: sideOf(limb.theta),
      side: sideOf(limb.theta),
      crossed: s.phase === PHASE.CROSSED,
      tuckReady: false,
      tuckSide: null,
    };
    sfx("tap");
    return true;
  }

  if(s.phase === PHASE.SECURED){
    // Grabbing the tail of a secured band is how you take it off — the same
    // gesture the release step will use, available here as error recovery.
    ctx.drag = { kind: "pullTail", downX: e.clientX, downY: e.clientY, moved: false, travel: 0 };
    return true;
  }

  return false;
}

export function tourniquetPointerMove(e, canvasEl){
  if(!isTourniquetActive()) return false;
  const d = ctx.drag;
  if(!d){
    const over = pickStrapEnd(e, canvasEl);
    if(canvasEl.style) canvasEl.style.cursor = over == null ? "default" : "grab";
    return false;
  }
  if(Math.hypot(e.clientX - d.downX, e.clientY - d.downY) > TAP_PX) d.moved = true;

  const s = ctx.state;
  if(d.kind === "route"){
    const rect = canvasEl.getBoundingClientRect();
    const pt = { x: e.clientX, y: e.clientY };
    // The limb tapers, so the silhouette the hand is judged against has to be
    // the one where the hand actually IS. Measuring it at the band's starting
    // x instead makes a wrap that drifts up the arm read as though it had been
    // lifted clear of a thinner limb than it was.
    let ax = ctx.view.pointerToAxis(pt, rect, d.bandX, limbRadius(d.bandX));
    ax = ctx.view.pointerToAxis(pt, rect, ax.x, limbRadius(ax.x));
    return moveRoute(ax);
  }

  const anchorX = s.bandX == null ? ctx.geom.bandX : s.bandX;
  const limb = limbAt(e, canvasEl, anchorX);
  if(!limb) return true;

  if(d.kind === "tension"){
    // The tuck slides the loop ALONG the arm, and the cross-section solve
    // above cannot see that motion — it has to assume a slice and folds any
    // sideways travel into the radius instead, so the hand appears to barely
    // move. The loop ends up against the skin though, and "which slice puts
    // this on the surface" is a question that CAN be answered, so the tuck's
    // position is read that way.
    const rect = canvasEl.getBoundingClientRect();
    const surf = ctx.view.pointerToLimbSurface(
      { x: e.clientX, y: e.clientY }, rect, anchorX, limbRadius, limb.theta
    );
    return moveTension(limb, surf, anchorX);
  }

  if(d.kind === "tension") return moveTension(limb);
  if(d.kind === "pullTail") return movePullTail(e, limb);
  return true;
}

function clampBandX(x){
  return Math.max(BAND_RANGE.min, Math.min(BAND_RANGE.max, x));
}
/** The same limits, for the paths that adjust a band with no scene running. */
export function clampBandPosition(x){ return clampBandX(x); }

/** Which side of the limb an angle is on: +1 the near half, -1 the far half. */
function sideOf(theta){
  const t = ((theta % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI);
  return t < Math.PI ? 1 : -1;
}

/**
 * The wrap, read as the SHAPE OF THE STROKE rather than as an angle.
 *
 * The underside of the arm is hidden behind the arm, so once the strap end
 * goes round the back there is no angle to recover from the screen — the
 * information genuinely is not there. What IS unambiguous is whether the hand
 * stayed against the skin:
 *
 *   passing UNDER  the end is dragged round in contact with the limb the
 *                  whole way, so it never leaves the arm's silhouette
 *   laying it OVER the end is carried clear of the arm and draped across the
 *                  top of it, so it rides outside that silhouette
 *
 * That contact is the whole difference, in the hand as much as on the screen,
 * so it is what gets measured. Progress round the limb is the perpendicular
 * distance travelled, in silhouette half-widths.
 */
function moveRoute(ax){
  const d = ctx.drag;

  // Measured from where the strap first MEETS THE ARM, not from where it was
  // picked up off the bench, so carrying it across doesn't count as turning.
  if(!d.onLimb){
    d.onLimb = true;
    d.pPrev = ax.p;
    d.lift = Math.abs(ax.p)/ax.pMax;
    d.bandX = clampBandX(ax.x);
    d.minX = d.maxX = ax.x;
    d.travel = 0;
    d.swept = 0;
    refreshStrap();
    return true;
  }

  const dp = ax.p - d.pPrev;
  d.pPrev = ax.p;
  // distance travelled round the limb, in silhouette half-widths: a half turn
  // carries the hand from one edge to the other, i.e. two of them
  d.travel += Math.abs(dp)/ax.pMax;

  // Did the strap stay against the skin the whole way round, or was it carried
  // clear of the arm? That is the difference between passing a band UNDER a
  // limb and laying it across the top, and it is the one depth cue this view
  // really has.
  d.lift = Math.max(d.lift, Math.abs(ax.p)/ax.pMax);
  const under = d.lift <= LIFT_LIMIT;
  d.swept = (under ? 1 : -1) * d.travel;

  d.bandX = clampBandX(ax.x);
  // Skew is the drift ALONG the arm DURING THE WRAP — wrap square to the limb
  // and it stays near zero; spiral round it and the band goes on as a cord.
  d.minX = Math.min(d.minX, ax.x);
  d.maxX = Math.max(d.maxX, ax.x);
  d.skew = (d.maxX - d.minX) * Math.min(1, d.travel/WRAP_COMPLETE);
  d.heldPoint = ctx.view.limbToWorld(
    d.bandX, d.swept, limbRadius(d.bandX) + Math.max(0, ax.p/ax.pMax - 1)*0.01
  );

  refreshStrap();

  if(d.travel >= WRAP_COMPLETE){
    const wrap = under ? WRAP.UNDER : WRAP.OVER;
    ctx.geom.bandX = d.bandX;
    ctx.geom.twist = Math.min(1.1, d.skew*22);
    markRouted(ctx.state, { bandX: d.bandX, wrap, skew: d.skew });
    ctx.drag = null;
    sfx(wrap === WRAP.UNDER ? "good" : "click");
    refreshStrap();
    notify();
  }
  return true;
}

/**
 * Tensioning, crossing and tucking.
 *
 * Unlike the wrap, this half of the gesture knows WHERE the band is, so the
 * cross-section solve is exact here and gets used directly. Two things it
 * cannot be asked, though:
 *
 *   - it folds motion ALONG the arm into the radius, so once the hand slides
 *     sideways to tuck, the pull reads as far bigger than it was. The tension
 *     is therefore FROZEN at the moment the ends cross — which is also what
 *     happens physically: crossing them is what holds the tension, and the
 *     tuck that follows does not tighten or slacken it.
 *   - absolute position along the arm carries a small bias, so the tuck is
 *     measured as movement SINCE the cross, where that bias cancels.
 */
function moveTension(limb, surf, anchorX){
  const d = ctx.drag, s = ctx.state, g = ctx.geom;
  // Only trust the along-arm reading while the hand is actually against the
  // skin. Mid-pull it is held clear of the arm, where no cross-section puts it
  // on the surface and that reading wanders — enough, unchecked, to look like
  // a tuck that never happened.
  const onSkin = !!surf && surf.residual < TUCK_CLEARANCE;
  const alongX = onSkin ? surf.x : anchorX;

  // How far the end has been pulled clear of the limb. Inside the surface
  // there is nothing to pull against; past it, every extra centimetre is
  // tension the patient feels.
  const rest = limbRadius(g.bandX);
  const tension = Math.min(1, Math.max(0, limb.rho - rest)/PULL_FULL);
  if(!d.crossed) setTension(s, tension);
  g.bite = MAX_BITE*s.tension;
  g.heldPoint = heldWorldPointFromLimb(limb);

  // Crossing: the held end carried over to the other side of the limb — which
  // is what crossing the ends physically is.
  const side = sideOf(limb.theta);
  if(!d.crossed && side !== d.startSide && s.tension > 0.16){
    d.crossed = true;
    markCrossed(s);
    sfx("click");
  }
  d.side = side;

  // Tucking: pushing the loop along the arm. Which way it is pushed is the
  // clinical point — a tail left pointing at the site lies across the skin
  // that is about to be cleaned and punctured.
  // Where the loop ended up relative to the band itself — up the arm, or back
  // down toward the site the band is there to serve.
  const offset = alongX - g.bandX;
  d.tuckReady = d.crossed && onSkin && Math.abs(offset) > TUCK_OFFSET && s.peakTension > 0.16;
  if(d.tuckReady) d.tuckSide = offset > 0 ? TUCK.PROXIMAL : TUCK.DISTAL;

  refreshStrap();
  notify();
  return true;
}

/** Where the held end actually is in the world, for drawing the free tail. */
function heldWorldPointFromLimb(limb){
  const g = ctx.geom;
  return ctx.view.limbToWorld(limb.x, limb.theta, Math.max(limb.rho, limbRadius(g.bandX)*0.9));
}

function movePullTail(e, limb){
  const d = ctx.drag;
  d.travel = Math.hypot(e.clientX - d.downX, e.clientY - d.downY);
  ctx.geom.heldPoint = heldWorldPointFromLimb(limb);
  refreshStrap();
  return true;
}

export function tourniquetPointerUp(e, canvasEl){
  if(!isTourniquetActive()) return false;
  try{ canvasEl.releasePointerCapture(e.pointerId); }catch(_){}
  if(canvasEl.style) canvasEl.style.cursor = "grab";

  const d = ctx.drag;
  if(!d) return false;
  ctx.drag = null;
  const s = ctx.state;

  if(d.kind === "route"){
    // Let go part-way round and the band simply drops. Nothing has happened
    // to the patient, and nothing is scored — but nothing snaps into place
    // either.
    ctx.geom.heldPoint = null;
    refreshStrap();
    return true;
  }

  if(d.kind === "tension"){
    if(d.tuckReady){
      ctx.geom.heldPoint = null;
      markSecured(s, { tuck: d.tuckSide, tuckedUnder: true });
      sfx("good");
      refreshStrap();
      notify();
      return true;
    }
    // Released without a tuck: the band was only being held by the hand, so
    // it comes off. This is the consequence that makes the tuck mean something.
    ctx.geom.bite = 0;
    ctx.geom.heldPoint = null;
    ctx.geom.twist = 0;
    markUnravelled(s);
    layoutLoose();
    sfx("bad");
    refreshStrap();
    notify();
    return true;
  }

  if(d.kind === "pullTail"){
    if(d.travel > 40){
      ctx.geom.bite = 0;
      ctx.geom.heldPoint = null;
      ctx.geom.twist = 0;
      markUnravelled(s);
      layoutLoose();
      sfx("click");
      refreshStrap();
      notify();
    }else{
      ctx.geom.heldPoint = null;
      refreshStrap();
    }
    return true;
  }

  return true;
}

export function tourniquetPointerCancel(){
  if(!isTourniquetActive()) return false;
  if(ctx.drag && ctx.drag.kind === "tension"){
    markUnravelled(ctx.state);
    layoutLoose();
  }
  ctx.drag = null;
  ctx.geom.heldPoint = null;
  refreshStrap();
  notify();
  return true;
}

/* ---------- programmatic actions (list view + tests) --------------------------- */

/**
 * The accessible path and the automated tests apply the band through these,
 * so every input route writes the same state and is measured the same way.
 * There is no simplified rule set behind the list view.
 */
export function applyBandProgrammatically({ bandX, wrap, skew, tension, tuck }){
  if(!ctx) return null;
  const s = ctx.state;
  markRouted(s, { bandX, wrap: wrap || WRAP.UNDER, skew: skew || 0 });
  ctx.geom.bandX = bandX;
  ctx.geom.twist = Math.min(1.1, (skew || 0)*22);
  setTension(s, tension == null ? 0.55 : tension);
  ctx.geom.bite = MAX_BITE*s.tension;
  markCrossed(s);
  markSecured(s, { tuck: tuck || TUCK.PROXIMAL, tuckedUnder: true });
  refreshStrap();
  return notify();
}

export function releaseBandProgrammatically(){
  if(!ctx) return null;
  ctx.geom.bite = 0;
  ctx.geom.twist = 0;
  markUnravelled(ctx.state);
  layoutLoose();
  refreshStrap();
  return notify();
}

/** Nudges the band along the arm without re-wrapping — keyboard adjustment. */
export function nudgeBand(metres){
  if(!ctx || ctx.state.bandX == null) return null;
  const s = ctx.state;
  s.bandX = clampBandX(s.bandX + metres);
  ctx.geom.bandX = s.bandX;
  refreshStrap();
  return notify();
}

/** Adjusts held tension without re-applying — keyboard adjustment. */
export function adjustTension(delta){
  if(!ctx || !isSecured(ctx.state)) return null;
  const s = ctx.state;
  setTension(s, s.heldTension + delta);
  s.heldTension = s.tension;
  ctx.geom.bite = MAX_BITE*s.heldTension;
  refreshStrap();
  return notify();
}

/* ---------- rendering ---------------------------------------------------------- */

export function renderTourniquet(renderer, dt){
  if(!ctx) return false;
  const aspect = viewportAspect(renderer);
  ctx.frame++;

  if(Math.abs(aspect - ctx.lastAspect) > 0.01 || ctx.frame % 30 === 0){
    const ob = measureObstruction(renderer);
    if(Math.abs(aspect - ctx.lastAspect) > 0.01 ||
       Math.abs(ob.rightFrac - (ctx.lastOb ? ctx.lastOb.rightFrac : -1)) > 0.01 ||
       Math.abs(ob.bottomFrac - (ctx.lastOb ? ctx.lastOb.bottomFrac : -1)) > 0.01){
      ctx.view.fitCamera(aspect, ob);
      ctx.lastAspect = aspect;
      ctx.lastOb = ob;
    }
  }

  ctx.view.tick(dt || 0.016);

  // The clock is the only thing that changes on its own once the band holds,
  // and it changes the arm: distension decays as the sample hemoconcentrates.
  if(isSecured(ctx.state) && ctx.frame % 12 === 0) notify();

  renderer.render(ctx.view.scene, ctx.view.camera);
  return true;
}

/** Live gesture feedback for the coach panel, so it can name what is happening. */
export function currentGesture(){
  if(!ctx || !ctx.drag) return null;
  const d = ctx.drag;
  if(d.kind === "route"){
    return {
      kind: "route",
      swept: d.swept,
      progress: Math.min(1, Math.abs(d.swept)/WRAP_COMPLETE),
      direction: d.swept > 0.15 ? WRAP.UNDER : (d.swept < -0.15 ? WRAP.OVER : null),
      bandX: d.bandX,
      skew: d.skew,
    };
  }
  if(d.kind === "tension"){
    return {
      kind: "tension",
      tension: ctx.state.tension,
      crossed: d.crossed,
      tuckReady: d.tuckReady,
      tuckSide: d.tuckSide,
    };
  }
  return { kind: d.kind };
}

export { WRAP, TUCK, PHASE, secondsOn };
