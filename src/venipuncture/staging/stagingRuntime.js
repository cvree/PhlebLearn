/* =========================================================================
   STAGING RUNTIME — pick up, turn over, and put down real objects.

   This is the interaction layer for physical supply staging. It owns:
     * pointer + touch dragging of a specific object across the counter
     * an inspect pose that requires the learner to actually TURN AN ITEM
       OVER before its printed information is revealed
     * gentle snapping into tube-rack wells (only at close range)
     * consequences: items stay exactly where they are released, and an item
       released off the counter falls and is contaminated

   It never decides whether staging is complete — it writes to stagingState
   and asks stagingRules. main.js drives it via the four exported hooks
   (isStagingActive / renderStaging / stagingPointer* ), which is the only
   coupling the composition root needs.
   ========================================================================= */
import * as THREE from "three";
import { sfx } from "../../audio/audioManager.js";
import { preloadModels } from "../../rendering/modelRegistry.js";
import { registerSupplyModels, SUPPLY_MODEL_IDS } from "./supplyModels.js";
import { buildStagingScene } from "./stagingScene.js";
import { ZONE, placeItem, inspectItem, markContaminated, recordEvent } from "./stagingState.js";
import { zoneAt, rackSlotAt, rackSlotPosition, crossesField, orientationForAspect, applyTrayOffset } from "./stagingLayout.js";
import { evaluateStaging } from "./stagingRules.js";
import { CATEGORY } from "./supplyCatalog.js";

const TAP_PX = 7;              // pointer travel below this is a tap, not a drag
const LIFT = 0.045;            // how high a held object floats above the surface
const RACK_SNAP = 0.024;       // metres — deliberately small: no long-range magnet
const INSPECT_ROTATION = 2.0;  // radians of accumulated turn before a label counts as read
const DOUBLE_TAP_MS = 300;     // window for "double-tap the item I'm holding to stage it"

let ctx = null;                // the single live staging session

/* ---------- lifecycle ------------------------------------------------------ */

export async function startStaging(opts){
  registerSupplyModels();
  await preloadModels(SUPPLY_MODEL_IDS).catch(()=>{});

  const view = buildStagingScene({
    catalog: opts.catalog,
    state: opts.state,
    layout: opts.layout,
    requiredTubes: opts.requiredTubes,
  });

  ctx = {
    ...opts,
    view,
    raycaster: new THREE.Raycaster(),
    ndc: new THREE.Vector2(),
    plane: new THREE.Plane(new THREE.Vector3(0,1,0), 0),
    drag: null,
    inspect: null,
    tweens: [],
    lastAspect: 0,
    active: true,
    assisted: !!opts.assistedSnapping,
  };
  notify();
  return ctx;
}

export function stopStaging(){
  if(!ctx) return;
  ctx.view.dispose();
  ctx = null;
}

export function isStagingActive(){ return !!(ctx && ctx.active); }
export function getStagingContext(){ return ctx; }

/** Re-syncs meshes after an out-of-band change (list view, undo). */
export function syncStagingFromState(){
  if(!ctx) return;
  ctx.view.refreshFromState(ctx.state);
  notify();
}

function notify(){
  if(!ctx) return;
  const result = evaluateStaging(ctx.state, ctx.catalog);
  ctx.state.ready = result.ready;
  if(ctx.onChange) ctx.onChange(result);
  return result;
}

/* ---------- rendering ------------------------------------------------------ */

export function renderStaging(renderer, dt){
  if(!ctx) return false;
  const size = renderer.getSize(new THREE.Vector2());
  const aspect = size.x / Math.max(1, size.y);
  // the coach panel is a side panel on desktop and a bottom sheet on phones;
  // either way the cart has to be framed in what's left of the canvas.
  ctx.frame = (ctx.frame||0) + 1;
  // A phone rotated into landscape needs the landscape cart, and vice versa.
  if(ctx.frame % 30 === 0 && ctx.onOrientationChange){
    const want = orientationForAspect(aspect);
    if(want !== ctx.layout.orientation){ ctx.onOrientationChange(want); return true; }
  }
  if(Math.abs(aspect - ctx.lastAspect) > 0.01 || ctx.frame % 30 === 0){
    const ob = measureObstruction(renderer);
    if(Math.abs(aspect-ctx.lastAspect) > 0.01 ||
       Math.abs(ob.rightFrac-(ctx.lastOb?ctx.lastOb.rightFrac:-1)) > 0.01 ||
       Math.abs(ob.bottomFrac-(ctx.lastOb?ctx.lastOb.bottomFrac:-1)) > 0.01){
      ctx.view.fitCamera(aspect, ob);
      ctx.lastAspect = aspect;
      ctx.lastOb = ob;
    }
  }
  tickTweens(dt||0.016);
  renderer.render(ctx.view.scene, ctx.view.camera);
  return true;
}

function measureObstruction(renderer){
  const canvas = renderer.domElement;
  const panel = typeof document!=="undefined" ? document.getElementById("panel") : null;
  if(!canvas || !panel) return { rightFrac:0, bottomFrac:0 };
  const c = canvas.getBoundingClientRect();
  const p = panel.getBoundingClientRect();
  if(!c.width || !c.height || !p.width) return { rightFrac:0, bottomFrac:0 };
  const sideSheet = p.width < c.width * 0.75;
  if(sideSheet) return { rightFrac: Math.min(0.45, (c.right - p.left)/c.width), bottomFrac:0 };
  return { rightFrac:0, bottomFrac: Math.min(0.6, (c.bottom - p.top)/c.height) };
}

function tickTweens(dt){
  if(!ctx.tweens.length) return;
  const keep = [];
  for(const tw of ctx.tweens){
    tw.t = Math.min(1, tw.t + dt/tw.dur);
    const e = 1 - Math.pow(1-tw.t, 3);
    tw.obj.position.set(
      tw.from.x + (tw.to.x-tw.from.x)*e,
      tw.from.y + (tw.to.y-tw.from.y)*e,
      tw.from.z + (tw.to.z-tw.from.z)*e
    );
    if(tw.t<1) keep.push(tw); else if(tw.onDone) tw.onDone();
  }
  ctx.tweens = keep;
}
function tweenTo(obj, to, dur, onDone){
  ctx.tweens = ctx.tweens.filter(t=>t.obj!==obj);
  ctx.tweens.push({ obj, from:{ x:obj.position.x, y:obj.position.y, z:obj.position.z }, to, t:0, dur:dur||0.22, onDone });
}

/* ---------- picking -------------------------------------------------------- */

function setNdc(e, canvasEl){
  const r = canvasEl.getBoundingClientRect();
  ctx.ndc.x = ((e.clientX - r.left)/r.width)*2 - 1;
  ctx.ndc.y = -((e.clientY - r.top)/r.height)*2 + 1;
  ctx.raycaster.setFromCamera(ctx.ndc, ctx.view.camera);
}

/**
 * Real geometry always wins over a grab proxy. Pointing straight at a tube
 * picks the tube; pointing at empty counter *near* a tube still picks it via
 * its proxy — but a proxy never steals a pick from the object the learner is
 * actually pointing at, which is what made small props on the back shelf
 * un-grabbable behind their neighbours.
 */
function pickItem(e, canvasEl){
  setNdc(e, canvasEl);
  const hits = ctx.raycaster.intersectObjects(ctx.view.root.children, true);
  let proxyHit = null;
  for(const h of hits){
    let o = h.object;
    const isProxy = h.object.name==="pickProxy";
    while(o && o.userData.itemId===undefined) o = o.parent;
    if(!o || o.userData.itemId===undefined || !o.visible) continue;
    if(!isProxy) return o;
    if(!proxyHit) proxyHit = o;
  }
  return proxyHit;
}

/**
 * The tray is only picked when nothing on it is under the pointer — reaching
 * for a tube that happens to be sitting on the tray must never drag the whole
 * work area instead.
 */
function pickTray(e, canvasEl){
  setNdc(e, canvasEl);
  const hits = ctx.raycaster.intersectObjects(ctx.view.root.children, true);
  for(const h of hits){
    let o = h.object;
    while(o && o.userData.itemId===undefined && !o.userData.trayHandle) o = o.parent;
    if(!o) continue;
    if(o.userData.itemId!==undefined) return null;   // an object on the tray wins
    if(o.userData.trayHandle) return o;
  }
  return null;
}

function pointOnCounter(e, canvasEl){
  setNdc(e, canvasEl);
  const p = new THREE.Vector3();
  return ctx.raycaster.ray.intersectPlane(ctx.plane, p) ? p : null;
}

/* ---------- inspect pose ---------------------------------------------------- */

function enterInspect(mesh){
  const def = mesh.userData.def;
  const cam = ctx.view.camera;
  const dir = new THREE.Vector3();
  cam.getWorldDirection(dir);
  const target = cam.position.clone().addScaledVector(dir, 0.34);
  ctx.inspect = {
    mesh,
    id: def.id,
    home: { x:mesh.position.x, y:mesh.position.y, z:mesh.position.z },
    rotAccum: 0,
    revealed: ctx.state.items[def.id].inspected,
  };
  mesh.userData.savedRot = { x:mesh.rotation.x, y:mesh.rotation.y, z:mesh.rotation.z };
  tweenTo(mesh, { x:target.x, y:target.y, z:target.z }, 0.24);
  ctx.view.hideHeldShadow();
  ctx.view.hideGhost();
  sfx("tap");
  if(ctx.onInspect) ctx.onInspect(def, ctx.inspect.revealed);
}

function exitInspect(){
  if(!ctx.inspect) return;
  clearTimeout(ctx.inspect.tapTimer);
  const { mesh, home } = ctx.inspect;
  const saved = mesh.userData.savedRot;
  if(saved) mesh.rotation.set(saved.x, saved.y, saved.z);
  tweenTo(mesh, home, 0.20);
  ctx.inspect = null;
  if(ctx.onInspect) ctx.onInspect(null, false);
}

export function isInspecting(){ return !!(ctx && ctx.inspect); }

/* ---------- drag ------------------------------------------------------------ */

export function stagingPointerDown(e, canvasEl){
  if(!isStagingActive()) return false;
  const mesh = pickItem(e, canvasEl);

  if(ctx.inspect){
    // pressing anywhere while inspecting starts a rotation gesture; pressing
    // the item itself and releasing without turning puts it back down.
    ctx.inspect.dragging = true;
    ctx.inspect.lastX = e.clientX;
    ctx.inspect.lastY = e.clientY;
    ctx.inspect.downX = e.clientX;
    ctx.inspect.downY = e.clientY;
    ctx.inspect.hitSelf = !!(mesh && mesh.userData.itemId===ctx.inspect.id);
    try{ canvasEl.setPointerCapture(e.pointerId); }catch(_){}
    return true;
  }

  if(!mesh){
    const trayHandle = pickTray(e, canvasEl);
    if(trayHandle) return beginTrayDrag(e, canvasEl);
    return false;
  }
  const id = mesh.userData.itemId;
  const p = pointOnCounter(e, canvasEl);
  ctx.drag = {
    mesh, id,
    downX: e.clientX, downY: e.clientY,
    moved: false,
    grabOffset: p ? { x: mesh.position.x - p.x, z: mesh.position.z - p.z } : { x:0, z:0 },
    from: ctx.state.items[id].zone,
  };
  mesh.position.y = ctx.view.COUNTER_Y + LIFT;
  ctx.view.setHover(id);
  if(canvasEl.style) canvasEl.style.cursor = "grabbing";
  try{ canvasEl.setPointerCapture(e.pointerId); }catch(_){}
  sfx("tap");
  return true;
}

/* ---------- dragging the whole work area ------------------------------------
   The tray carries everything on it. Items are not children of the tray mesh
   (their world positions are the authoritative record), so the drag moves the
   tray group and every staged item together, and the drop commits one offset
   to the layout, the state, and each item's stored position. */

function beginTrayDrag(e, canvasEl){
  const p = pointOnCounter(e, canvasEl);
  if(!p) return false;
  const carried = Object.keys(ctx.state.items).filter(id=>{
    const z = ctx.state.items[id].zone;
    return z===ZONE.TRAY || z===ZONE.RACK;
  }).map(id=>{
    const mesh = ctx.view.itemMeshes.get(id);
    return { id, mesh, from:{ x:mesh.position.x, z:mesh.position.z } };
  });
  ctx.trayDrag = {
    downX: e.clientX, downY: e.clientY, moved: false,
    grab: { x:p.x, z:p.z },
    startOffset: { x:ctx.layout.trayOffset.x, z:ctx.layout.trayOffset.z },
    carried,
  };
  if(canvasEl.style) canvasEl.style.cursor = "grabbing";
  try{ canvasEl.setPointerCapture(e.pointerId); }catch(_){}
  sfx("tap");
  return true;
}

function moveTrayDrag(e, canvasEl){
  const d = ctx.trayDrag;
  const p = pointOnCounter(e, canvasEl);
  if(!p) return true;
  if(Math.hypot(e.clientX-d.downX, e.clientY-d.downY) > TAP_PX) d.moved = true;
  const wanted = { x: d.startOffset.x + (p.x - d.grab.x), z: d.startOffset.z + (p.z - d.grab.z) };
  const applied = applyTrayOffset(ctx.layout, wanted);
  ctx.view.setTrayOffset(applied);
  const dx = applied.x - d.startOffset.x, dz = applied.z - d.startOffset.z;
  d.carried.forEach(c=>{ c.mesh.position.x = c.from.x + dx; c.mesh.position.z = c.from.z + dz; });
  return true;
}

function endTrayDrag(){
  const d = ctx.trayDrag;
  ctx.trayDrag = null;
  if(!d) return;
  const applied = ctx.layout.trayOffset;
  const dx = applied.x - d.startOffset.x, dz = applied.z - d.startOffset.z;
  if(!d.moved || (dx===0 && dz===0)) return;
  d.carried.forEach(c=>{
    const st = ctx.state.items[c.id];
    if(st.pos) st.pos = { x: st.pos.x + dx, z: st.pos.z + dz };
    else st.pos = { x: c.mesh.position.x, z: c.mesh.position.z };
  });
  ctx.state.trayOffset = { x:applied.x, z:applied.z };
  recordEvent(ctx.state, "moveTray", { x:applied.x, z:applied.z });
  sfx("click");
  notify();
}

export function stagingPointerMove(e, canvasEl){
  if(!isStagingActive()) return false;

  if(ctx.trayDrag) return moveTrayDrag(e, canvasEl);

  if(ctx.inspect){
    if(!ctx.inspect.dragging) return true;
    const dx = e.clientX - ctx.inspect.lastX;
    const dy = e.clientY - ctx.inspect.lastY;
    ctx.inspect.lastX = e.clientX; ctx.inspect.lastY = e.clientY;
    const m = ctx.inspect.mesh;
    m.rotation.y += dx*0.014;
    m.rotation.x += dy*0.014;
    ctx.inspect.rotAccum += Math.abs(dx*0.014) + Math.abs(dy*0.014);
    if(!ctx.inspect.revealed && ctx.inspect.rotAccum >= INSPECT_ROTATION){
      ctx.inspect.revealed = true;
      inspectItem(ctx.state, ctx.inspect.id);
      sfx("click");
      if(ctx.onInspect) ctx.onInspect(m.userData.def, true);
      notify();
    }
    return true;
  }

  if(!ctx.drag){
    const mesh = pickItem(e, canvasEl);
    ctx.view.setHover(mesh ? mesh.userData.itemId : null);
    if(canvasEl.style) canvasEl.style.cursor = mesh ? "grab" : "default";
    return false;
  }

  const p = pointOnCounter(e, canvasEl);
  if(!p) return true;
  if(Math.hypot(e.clientX-ctx.drag.downX, e.clientY-ctx.drag.downY) > TAP_PX) ctx.drag.moved = true;

  const x = p.x + ctx.drag.grabOffset.x;
  const z = p.z + ctx.drag.grabOffset.z;
  const mesh = ctx.drag.mesh;
  mesh.position.set(x, ctx.view.COUNTER_Y + LIFT, z);

  const cb = ctx.layout.counter;
  const offCounter = x<cb.minX || x>cb.maxX || z<cb.minZ || z>cb.maxZ;
  ctx.view.showHeldShadow(x, z, offCounter?0.9:0.0, 0.11);

  // placement ghost: only when a snap is genuinely close by
  const snap = snapTarget(ctx.drag.id, x, z);
  if(snap) ctx.view.showGhost(snap.x, snap.z, 0.014);
  else ctx.view.hideGhost();
  ctx.view.setInvalid(ctx.drag.id, offCounter);
  return true;
}

export function stagingPointerUp(e, canvasEl){
  if(!isStagingActive()) return false;
  try{ canvasEl.releasePointerCapture(e.pointerId); }catch(_){}

  if(ctx.trayDrag){
    endTrayDrag();
    if(canvasEl.style) canvasEl.style.cursor = "grab";
    return true;
  }

  if(ctx.inspect){
    const travelled = Math.hypot(e.clientX-ctx.inspect.downX, e.clientY-ctx.inspect.downY);
    ctx.inspect.dragging = false;
    if(travelled > TAP_PX) return true;

    // A tap off the item sets it back down straight away. A tap ON the item
    // waits out the double-tap window, because a double-tap there means
    // "I've read it, put it on the tray" — the fast path once you know what
    // you're looking for.
    if(!ctx.inspect.hitSelf){ exitInspect(); return true; }

    const now = performance.now();
    if(ctx.inspect.lastTapAt && now - ctx.inspect.lastTapAt < DOUBLE_TAP_MS){
      clearTimeout(ctx.inspect.tapTimer);
      const id = ctx.inspect.id;
      exitInspect();
      stageItemTo(id, ZONE.TRAY);
      sfx("good");
      return true;
    }
    ctx.inspect.lastTapAt = now;
    ctx.inspect.tapTimer = setTimeout(()=>{ if(ctx && ctx.inspect) exitInspect(); }, DOUBLE_TAP_MS);
    return true;
  }

  const d = ctx.drag;
  if(!d) return false;
  ctx.drag = null;
  ctx.view.hideHeldShadow();
  ctx.view.hideGhost();
  ctx.view.setInvalid(d.id, false);
  if(canvasEl.style) canvasEl.style.cursor = "grab";

  if(!d.moved){
    // a tap on an object turns it over instead of moving it
    d.mesh.position.y = ctx.view.COUNTER_Y;
    enterInspect(d.mesh);
    return true;
  }

  commitDrop(d);
  return true;
}

export function stagingPointerCancel(e, canvasEl){
  if(!isStagingActive()) return false;
  if(ctx.trayDrag){ endTrayDrag(); }
  if(ctx.drag){ commitDrop(ctx.drag); ctx.drag = null; }
  ctx.view.hideHeldShadow(); ctx.view.hideGhost();
  return true;
}

/* ---------- drop resolution ------------------------------------------------- */

function snapTarget(id, x, z){
  const def = ctx.catalog.find(d=>d.id===id);
  if(!def || def.category!==CATEGORY.TUBE) return null;
  const n = ctx.requiredTubes.length;
  const slot = rackSlotAt(ctx.layout, x, z, n);
  if(slot==null) return null;
  const p = rackSlotPosition(ctx.layout, slot, n);
  const reach = ctx.assisted ? RACK_SNAP*2.2 : RACK_SNAP;
  if(Math.hypot(x-p.x, z-p.z) > reach) return null;
  return { x:p.x, z:p.z, slot };
}

function commitDrop(d){
  const mesh = d.mesh;
  const x = mesh.position.x, z = mesh.position.z;
  const def = ctx.catalog.find(it=>it.id===d.id);

  // off the counter: it falls, and it is contaminated. Nothing snaps back.
  const bounds = ctx.layout.counter;
  if(x<bounds.minX || x>bounds.maxX || z<bounds.minZ || z>bounds.maxZ){
    placeItem(ctx.state, d.id, ZONE.FLOOR, { pos:{x,z} });
    markContaminated(ctx.state, d.id, "dropped on the floor");
    tweenTo(mesh, { x, y:-0.30, z }, 0.32);
    sfx("bad");
    notify();
    return;
  }

  const snap = snapTarget(d.id, x, z);
  if(snap){
    placeItem(ctx.state, d.id, ZONE.RACK, { slot:snap.slot, pos:{x:snap.x, z:snap.z}, crossedField:false });
    tweenTo(mesh, { x:snap.x, y:0.018, z:snap.z }, 0.18);
    sfx("click");
    notify();
    return;
  }

  let zone = zoneAt(ctx.layout, x, z);
  // a non-tube can't occupy the rack strip; treat it as tray
  if(zone===ZONE.RACK && (!def || def.category!==CATEGORY.TUBE)) zone = ZONE.TRAY;
  // a tube left in the rack strip but not near a well is loose on the tray
  if(zone===ZONE.RACK) zone = ZONE.TRAY;

  const crossed = (zone===ZONE.TRAY) && crossesField(ctx.layout, x);
  const settled = zone===ZONE.TRAY ? settleInTray(d.id, x, z) : { x, z };

  placeItem(ctx.state, d.id, zone, { pos:settled, crossedField:crossed });
  tweenTo(mesh, { x:settled.x, y:ctx.view.COUNTER_Y, z:settled.z }, 0.16);
  sfx(zone===ZONE.TRAY || zone===ZONE.REACH ? "good" : "tap");
  notify();
}

/**
 * Valid items settle into a usable spot instead of stacking on top of each
 * other — but only by the minimum nudge needed. An item dropped in clear
 * space does not move at all.
 */
function settleInTray(id, x, z){
  const occupied = [];
  ctx.state.requiredTubes; // (rack slots are handled separately)
  Object.keys(ctx.state.items).forEach(other=>{
    if(other===id) return;
    const st = ctx.state.items[other];
    if(st.zone!==ZONE.TRAY || !st.pos) return;
    occupied.push(st.pos);
  });
  const MIN = 0.052;
  let px = x, pz = z;
  for(let attempt=0; attempt<12; attempt++){
    const clash = occupied.find(p=>Math.hypot(p.x-px, p.z-pz) < MIN);
    if(!clash) break;
    const a = Math.atan2(pz-clash.z, px-clash.x) || (attempt*1.1);
    px = clash.x + Math.cos(a)*MIN;
    pz = clash.z + Math.sin(a)*MIN;
  }
  const t = ctx.layout.tray;
  px = Math.max(t.minX+0.03, Math.min(t.maxX-0.03, px));
  pz = Math.max(t.minZ+0.03, Math.min(t.maxZ-0.03, pz));
  return { x:px, z:pz };
}

/* ---------- programmatic actions (list view + tests) ------------------------ */

/**
 * The accessible list view and the automated tests both stage items through
 * these, so every input path writes the same state and is measured the same
 * way. There is no second, simpler rule set hiding behind accessibility mode.
 */
export function stageItemTo(id, zone, slot){
  if(!ctx) return null;
  const opts = { };
  if(zone===ZONE.RACK && slot!=null){
    opts.slot = slot;
    opts.pos = rackSlotPosition(ctx.layout, slot, ctx.requiredTubes.length);
  }else if(zone===ZONE.TRAY){
    const idx = Object.keys(ctx.state.items).filter(k=>ctx.state.items[k].zone===ZONE.TRAY).length;
    opts.pos = { x: ctx.layout.tray.minX + 0.055 + (idx%4)*0.083, z: ctx.layout.tray.cz + 0.035 + (Math.floor(idx/4)%2)*0.065 };
  }else if(zone===ZONE.REACH){
    opts.pos = { x: ctx.layout.reach.cx, z: ctx.layout.reach.cz };
  }else if(zone===ZONE.ACROSS){
    opts.pos = { x: ctx.layout.across.cx, z: ctx.layout.across.cz };
  }
  placeItem(ctx.state, id, zone, opts);
  ctx.view.refreshFromState(ctx.state);
  return notify();
}

export function inspectItemById(id){
  if(!ctx) return null;
  inspectItem(ctx.state, id);
  return notify();
}

export function returnItemToShelf(id){
  if(!ctx) return null;
  const mesh = ctx.view.itemMeshes.get(id);
  const home = mesh ? mesh.userData.home : { x:0, z:0 };
  placeItem(ctx.state, id, ZONE.SHELF, { pos:home });
  ctx.view.refreshFromState(ctx.state);
  recordEvent(ctx.state, "return", { id });
  sfx("tap");
  return notify();
}
