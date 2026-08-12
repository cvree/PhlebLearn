/* =========================================================================
   TOURNIQUET RUNTIME — putting a real band on a real arm.

   THE OLD MODEL asked for four separate failable gestures on a strap you
   could only hold by its tip: grab a specific END, sweep 1.75 radians of
   accumulated perpendicular travel while never once exceeding 1.12 silhouette
   half-widths of lift, then tension, then cross, then tuck. Every one of
   those measurements was honest — the underside of an arm genuinely is not
   visible, so contact really is the only depth cue this view has — but the
   result was a precision gauntlet. All of the difficulty sat in OPERATING THE
   STRAP, and none of it in reading the arm.

   THE NEW MODEL keeps every measurement and moves all of the difficulty:

     GRAB ANYWHERE     the whole length of the strap is a target. Where you
                       grabbed decides which end is free. It never decides
                       whether you can pick it up.

     ONE GESTURE       drag it across the arm. As soon as the stroke crosses
                       the limb with a plausible direction, the band WRAPS
                       ITSELF — round, under and up — and lands flat. Route
                       direction is inferred from the shape of the stroke, not
                       survived across a radian budget. Laying it over the top
                       is still detected and still scored, but now it takes
                       actually holding the strap clear of the arm the whole
                       way: bad intent rather than bad luck.

     TENSION IS THE SKILL   this is the one thing worth making demanding,
                       because it has a beautiful visible readout. Pull, and
                       the veins rise. Pull further and the hand blanches and
                       the veins collapse again. There is no meter: you judge
                       it with your eyes, and the elastic pitches up in your
                       ears while you do. Hold the good zone and it sets with
                       a creak and a soft thud.

     THE TUCK IS AUTOMATIC   it was never a skill, it was a fiddle. It tucks
                       itself, tail up-arm. The direction is only graded when
                       the learner actively drags the tail down toward the
                       site they are about to clean.

     REMOVAL IS ONE YANK   downward, with a snap and real recoil.

   Owns interaction. It writes tourniquetState and asks tourniquetRules; it
   never decides correctness itself, and the rules are unchanged.
   ========================================================================= */
import * as THREE from "three";
import { leaseBenchView } from "../../bench/benchSession.js";
import { ARM_Y } from "../arm/armMesh.js";
import { distalPallor, radiusAt, TENSION } from "../arm/armAnatomy.js";
import { buildStrap, contactArc, freeTail, STRAP_WIDTH } from "./strapMesh.js";
import {
  PHASE, WRAP, TUCK,
  createTourniquetState, markRouted, setTension, markCrossed,
  markSecured, markUnravelled, markReleased, secondsOn, isSecured,
} from "./tourniquetState.js";
import { evaluateTourniquet } from "./tourniquetRules.js";
import { measureObstruction, viewportAspect } from "../viewport.js";
import { elasticVoice, strapDrag, strapSet, strapSnap } from "../../audio/procedural.js";
import { assistLevel, radiusPx, createVelocity } from "../../bench/assist.js";
import { tapHaptic, setHaptic } from "../../bench/haptics.js";

/* ---------- gesture constants ---------------------------------------------- */

/**
 * Silhouette half-widths of perpendicular travel that count as a stroke ACROSS
 * the arm.
 *
 * The old threshold was 1.75 radians of accumulated angle, chosen to survive a
 * second turning point in a direction-tracking scheme that no longer exists. A
 * stroke from one edge of the limb to the other is two half-widths, so 0.85 is
 * comfortably a real crossing and comfortably more than a wiggle.
 */
const WRAP_STROKE = 0.85;
/**
 * How far clear of the arm the hand must average, across the whole stroke, for
 * the band to count as having been LAID OVER the top rather than passed under.
 *
 * Anything actually touching the skin measures at most 1.0. The old limit was
 * a PEAK of 1.12, so one frame of overshoot mid-drag scored the wrap as wrong;
 * this is a MEAN of 1.5, which you only reach by genuinely carrying the strap
 * across the top of the limb.
 */
const OVER_LIFT = 1.50;
/** how far the band's contact arc stops short of the top, each side */
const END_GAP = 0.30*Math.PI;
/** pull clear of the limb, in metres, that corresponds to full tension */
const PULL_FULL = 0.085;
/** how far the band sinks into the limb at full tension */
const MAX_BITE = 0.008;
/** below this the band is not holding anything and simply sits there */
const HOLD_MIN = 0.16;
/** pixels of downward yank that takes a secured band off */
const YANK_PX = 52;
/** how long the band takes to wrap itself, in seconds */
const WRAP_ANIM = 0.42;
/** how far along the arm the band may be placed at all */
const BAND_RANGE = { min: -0.26, max: 0.185 };

let ctx = null;

/* ---------- lifecycle -------------------------------------------------------- */

/**
 * @param {object} opts
 *   state          an existing tourniquetState to resume, or null for a new one
 *   arm            {skin, build, armSide, scenarioKeys, vigour, shirt}
 *   guided         teaching mode shows the site marker and the band's target zone
 *   onChange(result)
 */
export function startTourniquet(opts){
  const o = opts || {};
  const view = leaseBenchView({ mode: "tourniquet", arm: o.arm || {} });
  const state = o.state || createTourniquetState({
    itemId: o.itemId,
    armSide: (o.arm && o.arm.armSide) || "right",
    vigour: (o.arm && o.arm.vigour) || 1,
  });

  /* The strap is a BENCH PROP, not a lease prop. It has to still be on the
     arm during palpation, cleaning, the stick and the release — four different
     modes — and the only way to guarantee that is for it to be the same object
     throughout rather than four objects drawn to match. */
  const strap = view.benchProp("strap", () => buildStrap({ color: o.strapColor }));

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
    velocity: createVelocity(),
    drag: null,
    wrapAnim: null,
    voice: null,
    lastAspect: 0,
    frame: 0,
    active: true,
    /** live geometry the ribbon is drawn from, rebuilt every change */
    geom: {
      bandX: state.bandX == null ? 0.088 : state.bandX,
      heldPoint: null,
      anchorPoint: null,
      bite: 0,
      twist: 0,
      /** the centreline as last drawn, for grabbing the strap ANYWHERE */
      line: null,
    },
  };

  view.setSiteVisible(!!o.guided);
  if(view.body) view.body.setWatching(true);
  layoutLoose();
  refreshStrap();
  notify();
  return ctx;
}

export function stopTourniquet(){
  if(!ctx) return;
  if(ctx.voice) ctx.voice.stop();
  // The strap is a bench prop and deliberately survives: the band stays on the
  // arm for every step that follows. Only this mode's own lease goes.
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
  // A band tight enough to blanch the hand is a band the patient can feel.
  if(ctx.view.body) ctx.view.body.setTension(Math.max(0, (t - TENSION.GOOD_MAX)/0.30));
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

/** The strap coiled on the bench, before it is picked up. */
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
  let pts;

  if(ctx.wrapAnim){
    /* The band taking itself round the limb. The contact arc's END sweeps from
       where the stroke crossed all the way round, so the strap is genuinely
       following the skin the whole way — which is why it reads as being
       threaded under rather than as one shape swapped for another. */
    const a = ctx.wrapAnim;
    const k = Math.min(1, a.t/WRAP_ANIM);
    const e = 1 - Math.pow(1 - k, 3);
    const r = limbRadius(a.bandX);
    const under = a.wrap !== WRAP.OVER;
    const from = under ? END_GAP : -(2*Math.PI - END_GAP);
    const to   = under ? (2*Math.PI - END_GAP) : END_GAP;
    const arc = contactArc({
      bandX: a.bandX, radius: r, armY: ARM_Y,
      from, to: from + (to - from)*e,
      skew: a.skew*(under ? 1 : -1), bite: 0, segments: 40,
    });
    const lead = arc[arc.length - 1];
    const anchor = new THREE.Vector3(a.bandX - 0.02, 0.004, 0.118*(1 - e) + 0.02*e);
    pts = freeTail(arc[0], anchor, 0.5*(1 - e*0.7), 8).reverse()
      .concat(arc, freeTail(lead, lead.clone().setY(lead.y + 0.024*(1 - e)), 0.2, 5));
    ctx.strap.setCenterline(pts, { twist: Math.min(1.1, Math.abs(a.skew)*22) });
    g.line = pts;
    return;
  }

  if(s.phase === PHASE.LOOSE && !ctx.drag){
    ctx.strap.setCenterline(g.loose, { twist: 0 });
    g.line = g.loose;
    return;
  }

  // --- mid-stroke: the strap is being carried across the limb ---------------
  if(ctx.drag && ctx.drag.kind === "route"){
    const d = ctx.drag;
    const r = limbRadius(d.bandX);
    const lead = d.heldPoint || new THREE.Vector3(d.bandX, ARM_Y + r, 0);
    const anchor = new THREE.Vector3(d.bandX - 0.02, 0.004, 0.118);
    pts = freeTail(anchor, lead, 0.35, 16);
    ctx.strap.setCenterline(pts, { twist: 0 });
    g.line = pts;
    return;
  }

  // --- wrapped: a contact arc plus two tails --------------------------------
  const r = limbRadius(g.bandX);
  const under = s.wrap !== WRAP.OVER;
  const from = under ? END_GAP : -(2*Math.PI - END_GAP);
  const to   = under ? (2*Math.PI - END_GAP) : END_GAP;

  const arc = contactArc({
    bandX: g.bandX, radius: r, armY: ARM_Y,
    from, to, skew: s.skew * (under ? 1 : -1), bite: g.bite, segments: 44,
  });

  const anchorEnd = g.anchorPoint || defaultAnchorPoint();
  const heldEnd = g.heldPoint || defaultHeldPoint();
  const slack = 1 - Math.min(1, s.tension*1.4);

  const head = freeTail(arc[0], anchorEnd, slack*0.6, 8).reverse();
  const tail = freeTail(arc[arc.length - 1], heldEnd, slack*0.6, 10);
  pts = head.concat(arc, tail);
  ctx.strap.setCenterline(pts, { twist: g.twist });
  g.line = pts;
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

function rectOf(canvasEl){ return canvasEl.getBoundingClientRect(); }

/**
 * Is the pointer on the strap? ANYWHERE on it.
 *
 * The mesh raycast comes first because it is exact, then a screen-space
 * distance to the drawn centreline at an assist-scaled radius. A 25 mm ribbon
 * is a small target on a phone, and the old code accepted only its two tips.
 *
 * @returns {{on:boolean, t:number, end:number}|null}
 *   t    0…1 along the strap, so the caller knows WHERE it was grabbed
 *   end  which end is therefore the free one: 0 or 1
 */
function pickStrap(e, canvasEl){
  const rect = rectOf(canvasEl);
  ctx.ndc.x = ((e.clientX - rect.left)/rect.width)*2 - 1;
  ctx.ndc.y = -((e.clientY - rect.top)/rect.height)*2 + 1;
  ctx.raycaster.setFromCamera(ctx.ndc, ctx.view.camera);
  const hits = ctx.raycaster.intersectObjects(ctx.strap.group.children, true);
  if(hits.length) return nearestOnLine(e, canvasEl, Infinity) || { on: true, t: 0.5, end: 1 };
  return nearestOnLine(e, canvasEl, radiusPx(40, rect));
}

function nearestOnLine(e, canvasEl, maxPx){
  const line = ctx.geom.line;
  if(!line || line.length < 2) return null;
  const rect = rectOf(canvasEl);
  let best = null, bestD = maxPx;
  let prev = ctx.view.toScreen(line[0], rect, new THREE.Vector3());
  const cur = new THREE.Vector3();
  for(let i = 1; i < line.length; i++){
    ctx.view.toScreen(line[i], rect, cur);
    const d = pointSegDist(e.clientX, e.clientY, prev.x, prev.y, cur.x, cur.y);
    if(d.dist < bestD){
      bestD = d.dist;
      best = { on: true, t: (i - 1 + d.t)/(line.length - 1) };
    }
    prev.copy(cur);
  }
  if(!best) return null;
  // Grabbing near one end frees the other. Grabbing in the middle frees the
  // end you are dragging away from, which is what a hand does with a strap.
  best.end = best.t < 0.5 ? 1 : 0;
  return best;
}

function pointSegDist(px, py, ax, ay, bx, by){
  const dx = bx - ax, dy = by - ay;
  const len2 = dx*dx + dy*dy;
  let t = len2 ? ((px - ax)*dx + (py - ay)*dy)/len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { dist: Math.hypot(px - (ax + dx*t), py - (ay + dy*t)), t };
}

/** The limb reading under the pointer: metres along, metres off. */
function limbAt(e, canvasEl, axisX){
  return ctx.view.pointerToLimb(
    { x: e.clientX, y: e.clientY }, rectOf(canvasEl), axisX, limbRadius(axisX)
  );
}

/* ---------- the gesture -------------------------------------------------------- */

export function tourniquetPointerDown(e, canvasEl){
  if(!isTourniquetActive() || ctx.wrapAnim) return false;
  const s = ctx.state;
  const grab = pickStrap(e, canvasEl);
  if(!grab) return false;

  try{ canvasEl.setPointerCapture(e.pointerId); }catch(_){}
  if(canvasEl.style) canvasEl.style.cursor = "grabbing";
  ctx.velocity.reset();
  ctx.velocity.push(e.clientX, e.clientY);
  tapHaptic();

  if(s.phase === PHASE.LOOSE){
    ctx.drag = {
      kind: "route",
      downX: e.clientX, downY: e.clientY,
      end: grab.end,
      bandX: clampBandX(ctx.geom.bandX),
      onLimb: false,
      pPrev: 0, pFirst: 0, travel: 0, net: 0,
      liftSum: 0, liftN: 0,
      minX: null, maxX: null, sumX: 0, nX: 0,
      heldPoint: null,
    };
    return true;
  }

  if(s.phase === PHASE.ROUTED || s.phase === PHASE.TENSIONING || s.phase === PHASE.CROSSED){
    const limb = limbAt(e, canvasEl, s.bandX == null ? ctx.geom.bandX : s.bandX);
    ctx.drag = {
      kind: "tension",
      downX: e.clientX, downY: e.clientY,
      startTheta: limb ? limb.theta : 0,
      lastAlongX: null,
      alongDrift: 0,
    };
    if(!ctx.voice) ctx.voice = elasticVoice();
    return true;
  }

  if(s.phase === PHASE.SECURED){
    // Grabbing a secured band is how you take it off — one yank.
    ctx.drag = { kind: "pullTail", downX: e.clientX, downY: e.clientY, travel: 0, down: 0 };
    return true;
  }

  return false;
}

export function tourniquetPointerMove(e, canvasEl){
  if(!isTourniquetActive()) return false;
  const d = ctx.drag;
  if(!d){
    if(canvasEl.style && !ctx.wrapAnim){
      canvasEl.style.cursor = pickStrap(e, canvasEl) ? "grab" : "default";
    }
    return false;
  }
  ctx.velocity.push(e.clientX, e.clientY);

  if(d.kind === "route"){
    const rect = rectOf(canvasEl);
    const pt = { x: e.clientX, y: e.clientY };
    // The limb tapers, so the silhouette the hand is judged against has to be
    // the one where the hand actually IS.
    let ax = ctx.view.pointerToAxis(pt, rect, d.bandX, limbRadius(d.bandX));
    ax = ctx.view.pointerToAxis(pt, rect, ax.x, limbRadius(ax.x));
    return moveRoute(ax);
  }

  const anchorX = ctx.state.bandX == null ? ctx.geom.bandX : ctx.state.bandX;
  const limb = limbAt(e, canvasEl, anchorX);
  if(!limb) return true;

  if(d.kind === "tension") return moveTension(limb);
  if(d.kind === "pullTail") return movePullTail(e, limb);
  return true;
}

function clampBandX(x){
  return Math.max(BAND_RANGE.min, Math.min(BAND_RANGE.max, x));
}
/** The same limits, for the paths that adjust a band with no scene running. */
export function clampBandPosition(x){ return clampBandX(x); }

/**
 * The stroke across the arm.
 *
 * What is measured has not changed: how far the hand travelled perpendicular
 * to the limb, and whether it stayed against the skin. What HAS changed is how
 * much of it you have to survive. The old version wanted 1.75 radians
 * accumulated with a PEAK lift under 1.12, so one frame of overshoot scored
 * the wrap as laid over the top. This wants one crossing's worth of travel and
 * judges the route on the stroke's AVERAGE lift.
 */
function moveRoute(ax){
  const d = ctx.drag;
  const lift = Math.abs(ax.p)/ax.pMax;

  // Measured from where the strap first MEETS THE ARM, not from where it was
  // picked up off the bench, so carrying it across does not count as turning.
  if(!d.onLimb){
    if(lift > 1.8){                            // still out over the bench
      d.bandX = clampBandX(ax.x);
      d.heldPoint = ctx.view.limbToWorld(d.bandX, 0, limbRadius(d.bandX) + 0.05);
      refreshStrap();
      return true;
    }
    d.onLimb = true;
    d.pPrev = ax.p;
    d.pFirst = ax.p;
    d.bandX = clampBandX(ax.x);
    d.minX = d.maxX = ax.x;
    d.sumX = ax.x; d.nX = 1;
    strapDrag();
    refreshStrap();
    return true;
  }

  const dp = ax.p - d.pPrev;
  d.pPrev = ax.p;
  // distance travelled round the limb, in silhouette half-widths: a half turn
  // carries the hand from one edge to the other, i.e. two of them
  d.travel += Math.abs(dp)/ax.pMax;
  d.net = (ax.p - d.pFirst)/ax.pMax;
  d.liftSum += lift; d.liftN++;

  d.minX = Math.min(d.minX, ax.x);
  d.maxX = Math.max(d.maxX, ax.x);
  d.sumX += ax.x; d.nX++;
  // Magnetic seating: the band lands at the MEAN of where the stroke was, not
  // at whichever pixel the pointer happened to be on when the count ran out.
  d.bandX = clampBandX(d.sumX/d.nX);

  const r = limbRadius(d.bandX);
  const theta = Math.max(-1.4, Math.min(1.4, -d.net*1.4));
  d.heldPoint = ctx.view.limbToWorld(d.bandX, theta, r + Math.max(0, lift - 1)*0.02);
  refreshStrap();

  if(d.travel >= WRAP_STROKE || Math.abs(d.net) >= 0.72) commitWrap(d);
  return true;
}

/**
 * The band wraps ITSELF. Position snaps to a flat, square seating; the
 * remaining skew is what the hand actually did, less a few forgiving
 * millimetres — so a 4 mm drift cannot leave you with a crooked band, and a
 * genuine spiral still does.
 */
function commitWrap(d){
  const lift = d.liftN ? d.liftSum/d.liftN : 0;
  const wrap = lift <= OVER_LIFT ? WRAP.UNDER : WRAP.OVER;
  const skew = Math.max(0, (d.maxX - d.minX) - skewForgiveness());

  ctx.geom.bandX = d.bandX;
  ctx.geom.twist = Math.min(1.1, skew*22);
  markRouted(ctx.state, { bandX: d.bandX, wrap, skew });
  ctx.drag = null;
  ctx.wrapAnim = { t: 0, bandX: d.bandX, wrap, skew };
  refreshStrap();
  notify();
}

function skewForgiveness(){ return 0.006 + assistLevel()*0.007; }

/**
 * Tensioning — and, on release, everything that used to be three more
 * gestures.
 *
 * The pull is real metres of the free end held clear of the limb, exactly as
 * before, because that reading is exact and the arm's answer to it is the
 * whole point of the step. What has gone is having to then carry the ends past
 * each other and thread a loop back under the band while holding that tension
 * through a solve that cannot see motion along the arm.
 */
function moveTension(limb){
  const d = ctx.drag, s = ctx.state, g = ctx.geom;

  const rest = limbRadius(g.bandX);
  const tension = Math.min(1, Math.max(0, limb.rho - rest)/PULL_FULL);
  setTension(s, tension);
  g.bite = MAX_BITE*s.tension;
  g.heldPoint = ctx.view.limbToWorld(limb.x, limb.theta, Math.max(limb.rho, rest*0.9));

  // Which way the tail is being drawn ALONG the arm. Used only to catch the
  // one thing worth catching: a tail dragged down over the site you are about
  // to clean and puncture.
  if(d.lastAlongX != null) d.alongDrift += limb.x - d.lastAlongX;
  d.lastAlongX = limb.x;

  if(ctx.voice) ctx.voice.set(tension);
  refreshStrap();
  notify();
  return true;
}

function movePullTail(e, limb){
  const d = ctx.drag;
  d.travel = Math.hypot(e.clientX - d.downX, e.clientY - d.downY);
  d.down = e.clientY - d.downY;
  ctx.geom.heldPoint = ctx.view.limbToWorld(
    limb.x, limb.theta, Math.max(limb.rho, limbRadius(ctx.geom.bandX)*0.9)
  );
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
    // Let go part-way across and the strap simply drops back to the bench.
    // Nothing has happened to the patient and nothing is scored.
    ctx.geom.heldPoint = null;
    layoutLoose();
    refreshStrap();
    return true;
  }

  if(d.kind === "tension"){
    if(ctx.voice){ ctx.voice.stop(); ctx.voice = null; }
    if(s.tension >= HOLD_MIN){
      /* It sets. Crossing and tucking are what a hand does without thinking
         once the tension is right, so they happen — and the tail goes up-arm,
         which is correct, UNLESS the learner actively dragged it down toward
         the site, which is the only version of this worth grading. */
      markCrossed(s);
      const tuck = d.alongDrift < -0.020 ? TUCK.DISTAL : TUCK.PROXIMAL;
      ctx.geom.heldPoint = null;
      markSecured(s, { tuck, tuckedUnder: true });
      strapSet();
      setHaptic();
    }else{
      /* Not enough pull to hold anything. The band is on the arm but loose —
         it has not sprung off, which used to punish a light hand for no
         clinical reason. It simply is not doing its job yet, and the flat
         veins are what say so. */
      ctx.geom.bite = 0;
      ctx.geom.heldPoint = null;
    }
    refreshStrap();
    notify();
    return true;
  }

  if(d.kind === "pullTail"){
    // One downward yank. Direction matters: a sideways wobble is not a removal.
    if(d.travel > YANK_PX && d.down > YANK_PX*0.4){
      ctx.geom.bite = 0;
      ctx.geom.heldPoint = null;
      ctx.geom.twist = 0;
      markUnravelled(s);
      layoutLoose();
      strapSnap();
      setHaptic();
      notify();
    }else{
      ctx.geom.heldPoint = null;
    }
    refreshStrap();
    return true;
  }

  return true;
}

export function tourniquetPointerCancel(){
  if(!isTourniquetActive()) return false;
  if(ctx.voice){ ctx.voice.stop(); ctx.voice = null; }
  if(ctx.drag && ctx.drag.kind === "route") layoutLoose();
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
  ctx.wrapAnim = null;
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
  const step = dt || 0.016;
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

  if(ctx.wrapAnim){
    ctx.wrapAnim.t += step;
    refreshStrap();
    if(ctx.wrapAnim.t >= WRAP_ANIM){
      ctx.wrapAnim = null;
      refreshStrap();
      notify();
    }
  }

  ctx.view.tick(step);

  // The clock is the only thing that changes on its own once the band holds,
  // and it changes the arm: distension decays as the sample hemoconcentrates.
  if(isSecured(ctx.state) && ctx.frame % 12 === 0) notify();

  renderer.render(ctx.view.scene, ctx.view.camera);
  return true;
}

/** Live gesture feedback for the coach panel, so it can name what is happening. */
export function currentGesture(){
  if(!ctx) return null;
  if(ctx.wrapAnim){
    const a = ctx.wrapAnim;
    return {
      kind: "route", progress: 1, direction: a.wrap, bandX: a.bandX, skew: a.skew,
      swept: a.wrap === WRAP.UNDER ? 2 : -2,
    };
  }
  const d = ctx.drag;
  if(!d) return null;
  if(d.kind === "route"){
    const lift = d.liftN ? d.liftSum/d.liftN : 0;
    return {
      kind: "route",
      swept: (lift <= OVER_LIFT ? 1 : -1)*d.travel,
      progress: Math.min(1, Math.max(d.travel/WRAP_STROKE, Math.abs(d.net)/0.72)),
      direction: d.travel > 0.25 ? (lift <= OVER_LIFT ? WRAP.UNDER : WRAP.OVER) : null,
      bandX: d.bandX,
      skew: d.maxX == null ? 0 : Math.max(0, (d.maxX - d.minX) - skewForgiveness()),
    };
  }
  if(d.kind === "tension"){
    return {
      kind: "tension", tension: ctx.state.tension, crossed: true,
      tuckReady: ctx.state.tension >= HOLD_MIN, tuckSide: TUCK.PROXIMAL,
    };
  }
  return { kind: d.kind };
}

export { WRAP, TUCK, PHASE, secondsOn };
