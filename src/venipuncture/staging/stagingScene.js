/* =========================================================================
   STAGING SCENE — the close-up supply cart the learner actually works at.

   Builds its own THREE.Scene and camera (rendered through the app's existing
   renderer, so there is only ever one WebGL context) containing:
     * the cart body, counter slab and back shelf
     * one instanced model per catalog entry, decorated with its own identity
     * the working tray, the numbered tube rack, and the reach zone pad
     * restrained interaction feedback: a hover outline, a contact shadow
       under a held object, and a placement ghost only when a snap is close

   This module owns MESHES ONLY. Where an object is allowed to be, and what
   that means clinically, lives in stagingRules.js — nothing here decides
   whether the tray is ready.
   ========================================================================= */
import * as THREE from "three";
import { TUBES } from "../../config.js";
import { createModelInstance } from "../../rendering/modelRegistry.js";
import { labelTexture, contactShadowTexture } from "../../rendering/labelTexture.js";
import { decorateInstance, buildTubeRack } from "./supplyModels.js";
import { CATEGORY } from "./supplyCatalog.js";
import { ZONE } from "./stagingState.js";
import { rackSlotPosition, trayRestingSpot, storeSlot, ORIENTATION, restingY, supportHeight } from "./stagingLayout.js";

const COUNTER_Y = 0;

function surfaceLabel(text, w, h, opts){
  const o = opts||{};
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w,h),
    new THREE.MeshBasicMaterial({
      map: labelTexture({ lines:[text], bg:o.bg||"#e9edf2", ink:o.ink||"#5a6472", w:o.tw||256, h:o.th||48 }),
      transparent:true, opacity:o.opacity==null?0.9:o.opacity, depthWrite:false,
    })
  );
  m.rotation.x = -Math.PI/2;
  return m;
}

let bgTexture = null;
function gradientBackground(){
  if(bgTexture) return bgTexture;
  const c = document.createElement("canvas");
  c.width = 4; c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0,0,0,128);
  grad.addColorStop(0, "#d9e6f3");
  grad.addColorStop(0.55, "#eaf0f6");
  grad.addColorStop(1, "#f4f1ec");
  g.fillStyle = grad; g.fillRect(0,0,4,128);
  bgTexture = new THREE.CanvasTexture(c);
  bgTexture.colorSpace = THREE.SRGBColorSpace;
  return bgTexture;
}

function dashedOutline(rectangle, color, y){
  const { minX, maxX, minZ, maxZ } = rectangle;
  const pts = [
    new THREE.Vector3(minX,y,minZ), new THREE.Vector3(maxX,y,minZ),
    new THREE.Vector3(maxX,y,maxZ), new THREE.Vector3(minX,y,maxZ),
    new THREE.Vector3(minX,y,minZ),
  ];
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color, dashSize:0.018, gapSize:0.012, transparent:true, opacity:0.7 }));
  line.computeLineDistances();
  return line;
}

export function buildStagingScene({ catalog, state, layout, requiredTubes }){
  const scene = new THREE.Scene();
  scene.background = gradientBackground();
  scene.fog = new THREE.Fog(0xdfe7f0, 1.8, 3.6);

  /* ---- lighting: soft clinical overheads, no real-time shadows ---------- */
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcdd6e0, 1.05));
  const key = new THREE.DirectionalLight(0xfff6e8, 1.15);
  key.position.set(-0.5, 1.4, 0.9);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdce9ff, 0.45);
  fill.position.set(0.8, 0.8, -0.6);
  scene.add(fill);

  const camera = new THREE.PerspectiveCamera(40, 1.6, 0.05, 12);

  const root = new THREE.Group();
  scene.add(root);

  /* ---- the cart ---------------------------------------------------------- */
  const BOUNDS = layout.counter;
  const CW = (BOUNDS.maxX - BOUNDS.minX) + 0.12;
  const CD = (BOUNDS.maxZ - BOUNDS.minZ) + 0.12;
  const CX = (BOUNDS.maxX + BOUNDS.minX)/2;
  const CZ = (BOUNDS.maxZ + BOUNDS.minZ)/2;
  const counterMat = new THREE.MeshStandardMaterial({ color:0xf6f3ec, roughness:0.5, metalness:0.04 });
  const cabinetMat = new THREE.MeshStandardMaterial({ color:0xd6dfe8, roughness:0.7, metalness:0.03 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(CW, 0.028, CD), counterMat);
  slab.position.set(CX, -0.014, CZ);
  root.add(slab);
  const cabinet = new THREE.Mesh(new THREE.BoxGeometry(CW-0.06, 0.42, CD-0.08), cabinetMat);
  cabinet.position.set(CX, -0.24, CZ-0.02);
  root.add(cabinet);
  const drawerCols = Math.max(1, Math.round(CW/0.46));
  for(let i=0;i<drawerCols;i++){
    const dw = (CW-0.10)/drawerCols;
    const dx = CX - CW/2 + 0.05 + dw*(i+0.5);
    const drawer = new THREE.Mesh(new THREE.BoxGeometry(dw*0.9, 0.11, 0.012), new THREE.MeshStandardMaterial({ color:0xdfe6ee, roughness:0.6 }));
    drawer.position.set(dx, -0.12, CZ + CD/2 - 0.045);
    root.add(drawer);
    const pull = new THREE.Mesh(new THREE.BoxGeometry(dw*0.35, 0.012, 0.012), new THREE.MeshStandardMaterial({ color:0x9aa4b1, roughness:0.35, metalness:0.6 }));
    pull.position.set(dx, -0.12, CZ + CD/2 - 0.034);
    root.add(pull);
  }
  const splash = new THREE.Mesh(new THREE.BoxGeometry(CW, 0.14, 0.02), new THREE.MeshStandardMaterial({ color:0xe9eff5, roughness:0.8 }));
  splash.position.set(CX, 0.07, BOUNDS.minZ - 0.05);
  root.add(splash);
  const shelfEdgeZ = layout.shelf.length ? Math.max(...layout.shelf.map(s=>s.z)) + 0.055 : BOUNDS.minZ + 0.2;
  const shelfLip = new THREE.Mesh(new THREE.BoxGeometry(CW-0.08, 0.012, 0.008), cabinetMat);
  shelfLip.position.set(CX, 0.006, shelfEdgeZ);
  root.add(shelfLip);

  /* ---- the patient's arm (spatial anchor, not yet interactive) ---------- */
  const armGroup = new THREE.Group(); armGroup.name = "armRest";
  const pad = new THREE.Mesh(new THREE.BoxGeometry(layout.arm.w, 0.028, layout.arm.d), new THREE.MeshStandardMaterial({ color:0xbcc7d4, roughness:0.8 }));
  pad.position.set(layout.arm.cx, 0.014, layout.arm.cz);
  armGroup.add(pad);
  const skin = new THREE.MeshStandardMaterial({ color:0xe6b98f, roughness:0.85 });
  const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.15, 6, 14), skin);
  forearm.rotation.z = Math.PI/2;
  forearm.position.set(layout.arm.cx + layout.sign*0.02, 0.070, layout.arm.cz);
  forearm.scale.set(1, 1, 0.86);
  armGroup.add(forearm);
  // a hand at the far end makes the arm read as an arm rather than a bolster,
  // and gives later branches an anchor for "make a fist"
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.040, 14, 10), skin);
  hand.position.set(layout.arm.cx - layout.sign*0.115, 0.066, layout.arm.cz);
  hand.scale.set(0.85, 0.72, 0.95);
  armGroup.add(hand);
  const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.046, 14, 10), skin);
  elbow.position.set(layout.arm.cx + layout.sign*0.108, 0.072, layout.arm.cz);
  elbow.scale.set(0.9, 0.85, 0.9);
  armGroup.add(elbow);
  root.add(armGroup);
  const armTag = surfaceLabel("patient's arm", 0.15, 0.026, { bg:"#dbe3ec", ink:"#5d6874", opacity:0.75 });
  armTag.position.set(layout.arm.cx, 0.0035, layout.arm.maxZ - 0.018);
  root.add(armTag);

  /* ---- working tray + tube rack ------------------------------------------
     Grouped so the learner can shove the whole work area around the counter.
     The group sits at the origin and its children hold their default absolute
     positions, so moving the group is exactly the tray offset the layout and
     the staged items are kept in sync with. */
  const trayGroup = new THREE.Group();
  trayGroup.name = "trayGroup";
  trayGroup.userData.trayHandle = true;
  root.add(trayGroup);

  const tray = createModelInstance("supply.tray") || new THREE.Group();
  tray.position.set(layout.tray.cx - layout.trayOffset.x, COUNTER_Y, layout.tray.cz - layout.trayOffset.z);
  trayGroup.add(tray);
  const trayTag = surfaceLabel("working tray — drag to move", 0.20, 0.026, { bg:"#e6ecf4", ink:"#586372", opacity:0.8, tw:340 });
  trayTag.position.set(tray.position.x, 0.014, tray.position.z + layout.tray.d/2 - 0.022);
  trayGroup.add(trayTag);

  const rack = buildTubeRack(requiredTubes.length);
  rack.position.set(layout.rack.cx - layout.trayOffset.x, 0.012, layout.rack.cz - layout.trayOffset.z);
  trayGroup.add(rack);
  trayGroup.position.set(layout.trayOffset.x, 0, layout.trayOffset.z);

  // an invisible grab slab covering the tray footprint, so the tray can be
  // picked up by its empty surface as well as by its rim
  const trayGrab = new THREE.Mesh(
    new THREE.BoxGeometry(layout.tray.w, 0.014, layout.tray.d),
    new THREE.MeshBasicMaterial({ colorWrite:false, depthWrite:false, transparent:true, opacity:0 })
  );
  trayGrab.position.set(tray.position.x, 0.007, tray.position.z);
  trayGrab.name = "trayGrab";
  trayGroup.add(trayGrab);

  /* ---- sharps reach zone -------------------------------------------------- */
  const reachPad = new THREE.Mesh(
    new THREE.PlaneGeometry(layout.reach.w, layout.reach.d),
    new THREE.MeshBasicMaterial({ color:0x6b7c92, transparent:true, opacity:0.12, depthWrite:false })
  );
  reachPad.rotation.x = -Math.PI/2;
  reachPad.position.set(layout.reach.cx, 0.002, layout.reach.cz);
  root.add(reachPad);
  root.add(dashedOutline(layout.reach, 0x6b7c92, 0.0035));
  const reachTag = surfaceLabel("sharps — within reach", 0.20, 0.028, { bg:"#dfe6ef", ink:"#4d5866", opacity:0.85, tw:320 });
  reachTag.position.set(layout.reach.cx, 0.0038, layout.reach.minZ + 0.020);
  root.add(reachTag);

  /* ---- feedback helpers ---------------------------------------------------- */
  const shadowTex = contactShadowTexture();
  const heldShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.12,0.12),
    new THREE.MeshBasicMaterial({ map:shadowTex, transparent:true, opacity:0, depthWrite:false })
  );
  heldShadow.rotation.x = -Math.PI/2; heldShadow.position.y = 0.0016;
  root.add(heldShadow);

  const ghost = new THREE.Mesh(
    new THREE.RingGeometry(0.012, 0.016, 24),
    new THREE.MeshBasicMaterial({ color:0x3f8f6d, transparent:true, opacity:0, depthWrite:false })
  );
  ghost.rotation.x = -Math.PI/2; ghost.position.y = 0.0022;
  root.add(ghost);

  /* ---- item instances ------------------------------------------------------ */
  const itemMeshes = new Map();
  const sharpsCursor = { i:0 };
  const shelfStock = [];

  catalog.forEach(def=>{
    const inst = createModelInstance(def.modelId) || new THREE.Group();
    const holder = new THREE.Group();
    holder.name = `item:${def.id}`;
    holder.add(inst);
    holder.userData.itemId = def.id;
    holder.userData.def = def;
    holder.userData.baseRotY = 0;

    const ctx = {};
    if(def.tubeKey){
      ctx.tubeColor = TUBES[def.tubeKey] ? TUBES[def.tubeKey].color : 0x888888;
      ctx.labelLines = def.flaws && def.flaws.includes("wrongPatient")
        ? [def.labelName || "", "PRE-LABELLED"]
        : [];
    }
    decorateInstance(inst, def, ctx);

    // Pick proxy: a 13×75 mm tube or a 5 mm-thick alcohol packet is a
    // hopeless finger target, and small props get lost behind larger ones in
    // a raycast. Each object carries an invisible, minimum-sized grab volume
    // so picking up a tube is as easy as picking up a glove box — including
    // on touch, where the required target is much bigger.
    inst.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(inst);
    const size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());

    /* How high this object's ORIGIN has to sit above whatever it rests on, so
       that its lowest point touches that surface and nothing more. Measured
       from the decorated instance rather than tabulated, so a GLB that later
       replaces the procedural builder is seated correctly with no code change.
       This is the number whose absence made staged items sink into the tray.
       It is signed: a model authored with its geometry slightly ABOVE its own
       origin (the coiled tourniquet is 4.35 mm up) gets a negative offset and
       is seated that much lower, so it touches the surface instead of
       hovering over it. */
    holder.userData.restOffset = Number.isFinite(bounds.min.y) ? -bounds.min.y : 0;
    if(Number.isFinite(size.x) && Number.isFinite(size.y)){
      const minGrab = layout.orientation===ORIENTATION.PORTRAIT ? 0.062 : 0.052;
      const px = Math.max(size.x, minGrab), py = Math.max(size.y, 0.034), pz = Math.max(size.z, minGrab);
      const proxy = new THREE.Mesh(
        new THREE.BoxGeometry(px, py, pz),
        new THREE.MeshBasicMaterial({ colorWrite:false, depthWrite:false, transparent:true, opacity:0 })
      );
      proxy.position.set(centre.x, Math.max(centre.y, py/2), centre.z);
      proxy.renderOrder = -1;
      proxy.name = "pickProxy";
      holder.add(proxy);
    }

    // The three sharps containers are floor units and stand in the storage
    // corner; everything else is shelf stock, positioned below.
    if(def.category===CATEGORY.SHARPS){
      const p = storeSlot(layout, sharpsCursor.i++);
      holder.position.set(p.x, restingYFor(def.id, ZONE.COUNTER), p.z);
      holder.userData.home = { x:p.x, z:p.z };
    }else{
      shelfStock.push({ holder, height: Number.isFinite(size.y) ? size.y : 0 });
    }
    root.add(holder);
    itemMeshes.set(def.id, holder);
  });

  // Tall stock goes on the back rows. Shelving a 75 mm urine container in
  // front of a 5 mm alcohol packet doesn't just look wrong — from a camera
  // looking down the bench it physically hides the packet, and a pointer aimed
  // at the packet hits the container instead. Sorting by height is what makes
  // every object on the cart reachable.
  shelfStock.sort((a,b)=>b.height - a.height);
  shelfStock.forEach((entry, i)=>{
    const slot = layout.shelf[i % layout.shelf.length];
    entry.holder.position.set(slot.x, restingYFor(entry.holder.userData.itemId, ZONE.COUNTER), slot.z);
    entry.holder.userData.home = { x:slot.x, z:slot.z };
  });

  /* ---- hover / held visual states ------------------------------------------ */
  const originalEmissive = new WeakMap();
  function setEmphasis(obj, amount, color){
    obj.traverse(o=>{
      if(!o.isMesh || !o.material || Array.isArray(o.material)) return;
      if(!("emissive" in o.material)) return;
      if(!originalEmissive.has(o)){
        originalEmissive.set(o, { hex:o.material.emissive.getHex(), i:o.material.emissiveIntensity });
      }
      const base = originalEmissive.get(o);
      if(amount<=0){
        o.material.emissive.setHex(base.hex);
        o.material.emissiveIntensity = base.i;
      }else{
        o.material.emissive.setHex(color==null ? 0x3f6f9f : color);
        o.material.emissiveIntensity = amount;
      }
    });
  }

  let hoveredId = null;
  function setHover(id){
    if(hoveredId===id) return;
    if(hoveredId && itemMeshes.has(hoveredId)) setEmphasis(itemMeshes.get(hoveredId), 0);
    hoveredId = id;
    if(hoveredId && itemMeshes.has(hoveredId)) setEmphasis(itemMeshes.get(hoveredId), 0.16, 0x4a7fb5);
  }
  function setInvalid(id, on){
    const m = itemMeshes.get(id);
    if(m) setEmphasis(m, on?0.22:0, 0xb5342c);
  }

  function showHeldShadow(x, z, lift, size){
    heldShadow.position.set(x, 0.0016, z);
    const s = (size||0.10) * (1 + lift*3.2);
    heldShadow.scale.set(s/0.12, s/0.12, 1);
    heldShadow.material.opacity = Math.max(0, 0.5 - lift*2.4);
  }
  function hideHeldShadow(){ heldShadow.material.opacity = 0; }

  function showGhost(x, z, r){
    ghost.position.set(x, 0.0022, z);
    const rr = r || 0.016;
    ghost.scale.set(rr/0.016, rr/0.016, 1);
    ghost.material.opacity = 0.55;
  }
  function hideGhost(){ ghost.material.opacity = 0; }

  /* ---- camera framing ------------------------------------------------------ */
  // A phone screen looks almost straight down at a deep, narrow cart; a
  // laptop looks across a wide, shallow one.
  const PITCH = layout.orientation===ORIENTATION.PORTRAIT ? 1.16 : 0.84;

  /**
   * Frames the whole counter inside the part of the canvas the coach panel
   * ISN'T covering. Without this the sharps reach zone — which for a
   * right-handed learner sits on the right — ends up underneath the panel,
   * i.e. the one placement the branch is trying to teach would be invisible.
   * @param {number} aspect
   * @param {{rightFrac:number, bottomFrac:number}} obstruction fractions of
   *        the canvas hidden by UI on each edge
   */
  function fitCamera(aspect, obstruction){
    const a = Math.max(0.4, aspect||1.6);
    const ob = obstruction || { rightFrac:0, bottomFrac:0 };
    const rightFrac = Math.min(0.45, Math.max(0, ob.rightFrac||0));
    const bottomFrac = Math.min(0.6, Math.max(0, ob.bottomFrac||0));
    camera.aspect = a;

    const width = (BOUNDS.maxX - BOUNDS.minX + 0.10) / (1 - rightFrac);
    const depth = (BOUNDS.maxZ - BOUNDS.minZ + 0.14) / (1 - bottomFrac);

    // Choose the distance from the depth requirement, then widen the lens (not
    // the distance) if the counter is still too wide to fit. Pushing the
    // camera back instead would shrink every prop to a few pixels on a phone.
    const BASE_FOV = 40, MAX_FOV = 62;
    camera.fov = BASE_FOV;
    let halfTan = Math.tan((BASE_FOV*Math.PI/180)/2);
    let dist = (depth*Math.sin(PITCH)/2) / halfTan * 1.04;

    // The counter's front edge is nearer the camera than the point it is
    // aimed at, so the frustum is narrower there. Fitting the width against
    // the centre depth silently clips whatever sits on the near corners —
    // which, mirrored for a left-handed learner, is the sharps reach zone.
    const nearGap = (BOUNDS.maxZ - CZ) * Math.cos(PITCH);
    const frontDist = ()=>Math.max(0.25, dist - nearGap);
    const neededFov = 2 * Math.atan((width/2) / frontDist() / a) * 180/Math.PI;
    if(neededFov > BASE_FOV){
      camera.fov = Math.min(MAX_FOV, neededFov);
      halfTan = Math.tan((camera.fov*Math.PI/180)/2);
      if(neededFov > MAX_FOV) dist = (width/2) / halfTan / a + nearGap;   // last resort
    }

    // world-space size of the visible frame at the counter's NEAR edge — the
    // conservative figure for converting "hidden fraction of the screen" into
    // "how far to slide the view"
    const visH = 2 * frontDist() * halfTan;
    const visW = visH * a;
    const dx = visW * rightFrac/2;
    const dz = (visH/Math.sin(PITCH)) * bottomFrac/2;

    const cx = CX + dx, cz = CZ + dz;
    camera.position.set(cx, Math.sin(PITCH)*dist, cz + Math.cos(PITCH)*dist);
    camera.lookAt(cx, 0.03, cz);
    camera.updateProjectionMatrix();

    // Fog has to follow the camera distance, or the portrait framing (which
    // sits ~3× further back than the landscape one) washes the whole cart out.
    scene.fog.near = dist * 0.95;
    scene.fog.far  = dist * 2.6;
  }
  fitCamera(1.6, { rightFrac:0.27, bottomFrac:0 });

  /* ---- reconciling meshes with state --------------------------------------- */
  // Every zone needs a rest position. Staging through the list view doesn't
  // supply one (there is no pointer to take it from), so a zone missing here
  // silently leaves the object sitting in the cart while the checklist says
  // it's staged — which is exactly the "object teleports between screens"
  // problem this branch exists to remove.
  /**
   * The y this item's origin must sit at to rest ON its zone's surface.
   *
   * THE one height authority for this scene. Every path that puts an object
   * down calls it — reconciling from state, committing a drop, staging from
   * the list view, recovering from the floor, and setting an inspected item
   * back down. Before this existed there were four such paths writing
   * `COUNTER_Y` (0) at a tray whose floor top is 12 mm up, which is why
   * anything flatter than 12 mm disappeared into it.
   */
  function restingYFor(id, zone){
    const mesh = itemMeshes.get(id);
    return restingY(zone, mesh ? mesh.userData.restOffset : 0);
  }

  function restPositionFor(id, st, trayIndexRef){
    if(st.pos) return st.pos;
    const mesh = itemMeshes.get(id);
    if(st.zone===ZONE.RACK && st.slot!=null) return rackSlotPosition(layout, st.slot, requiredTubes.length);
    if(st.zone===ZONE.TRAY)   return trayRestingSpot(layout, trayIndexRef.i++);
    if(st.zone===ZONE.REACH)  return { x:layout.reach.cx,  z:layout.reach.cz };
    if(st.zone===ZONE.ACROSS) return { x:layout.across.cx, z:layout.across.cz };
    return mesh ? mesh.userData.home : { x:0, z:0 };
  }

  /**
   * Pushes the authoritative state back onto the meshes. Called after any
   * change that didn't come from a direct drag (list-view staging, undo,
   * restoring a saved encounter).
   */
  function refreshFromState(s){
    const trayIndexRef = { i:0 };
    itemMeshes.forEach((mesh, id)=>{
      const st = s.items[id];
      if(!st) return;
      const p = restPositionFor(id, st, trayIndexRef);
      mesh.position.x = p.x;
      mesh.position.z = p.z;
      mesh.position.y = restingYFor(id, st.zone);
      mesh.visible = st.zone!==ZONE.WASTE;
    });
  }
  refreshFromState(state);

  function dispose(){
    root.traverse(o=>{
      if(o.geometry) o.geometry.dispose();
      if(o.material){
        const ms = Array.isArray(o.material)?o.material:[o.material];
        // shared registry materials are disposed by the registry, not here;
        // only the per-instance clones made in decorateInstance() are ours.
        ms.forEach(m=>{ if(m && m.userData && m.userData.perInstance && m.dispose) m.dispose(); });
      }
    });
    scene.clear();
  }

  /**
   * Moves the whole work area. `offset` is absolute, relative to the tray's
   * default spot.
   *
   * Staged items live on `root`, not on `trayGroup` — their world positions
   * stay authoritative, which is what lets the layout, the state and the mesh
   * all agree on where a thing is. The cost is that moving `trayGroup` alone
   * slides the tray out from under its own contents for the length of the
   * drag: the state positions were only rewritten on drop, so the tray
   * visibly abandoned everything on it and then teleported it back. So the
   * same delta is applied to everything the tray is carrying, live.
   */
  let carriedOffset = { x:0, z:0 };
  function setTrayOffset(offset, state){
    trayGroup.position.set(offset.x, 0, offset.z);
    const dx = offset.x - carriedOffset.x, dz = offset.z - carriedOffset.z;
    carriedOffset = { x:offset.x, z:offset.z };
    if(!state || (!dx && !dz)) return;
    itemMeshes.forEach((mesh, id)=>{
      const st = state.items[id];
      if(!st || (st.zone!==ZONE.TRAY && st.zone!==ZONE.RACK)) return;
      mesh.position.x += dx;
      mesh.position.z += dz;
    });
  }

  return {
    scene, camera, root, itemMeshes, rack, tray, trayGroup, armGroup,
    setHover, setInvalid, showHeldShadow, hideHeldShadow, showGhost, hideGhost,
    fitCamera, refreshFromState, setTrayOffset, restingYFor, supportHeight, dispose,
    COUNTER_Y,
  };
}
