/* =========================================================================
   PROCEDURAL SUPPLY MODELS

   Every piece of equipment the learner handles is registered in the shared
   model registry (rendering/modelRegistry.js) with `url:null` and a
   procedural builder as its fallback. That means:

     * today, the game ships with zero third-party geometry and still shows
       recognisable clinical equipment;
     * dropping an optimised .glb into public/assets/models/ and filling in
       the `url` here changes nothing at any call site;
     * if that .glb ever fails to load, the registry silently falls back to
       these builders instead of showing an emoji or an empty slot.

   Units are metres at real clinical scale — a 13×75 mm collection tube is
   modelled as 0.013 × 0.075 — so nothing has to be fudged when these props
   are reused in later branches next to a full-size arm.
   ========================================================================= */
import * as THREE from "three";
import { registerModel } from "../../rendering/modelRegistry.js";
import { labelTexture, blankLabelTexture, biohazardTexture, fillLineTexture } from "../../rendering/labelTexture.js";
import { GAUGE_COLORS } from "./supplyCatalog.js";

/* ---------- shared materials (one instance, reused across every clone) ---- */
const MAT = {};
function mat(key, params){
  if(!MAT[key]) MAT[key] = new THREE.MeshStandardMaterial(params);
  return MAT[key];
}
const plasticWhite = ()=>mat("plasticWhite",{ color:0xf2f2ee, roughness:0.55, metalness:0.02 });
const paperWhite   = ()=>mat("paperWhite",  { color:0xfaf8f2, roughness:0.9,  metalness:0 });
const foilBlue     = ()=>mat("foilBlue",    { color:0x9fc4e8, roughness:0.35, metalness:0.35 });
const steel        = ()=>mat("steel",       { color:0xb9bec7, roughness:0.28, metalness:0.85 });
const darkPlastic  = ()=>mat("darkPlastic", { color:0x3c4048, roughness:0.6,  metalness:0.05 });
const clearPlastic = ()=>mat("clearPlastic",{ color:0xdfe6ee, roughness:0.18, metalness:0.0, transparent:true, opacity:0.42 });
const glass        = ()=>mat("glass",       { color:0xe8eef2, roughness:0.12, metalness:0.0, transparent:true, opacity:0.5 });
const sharpsRed    = ()=>mat("sharpsRed",   { color:0xb5342c, roughness:0.55, metalness:0.03 });
const sharpsLid    = ()=>mat("sharpsLid",   { color:0xd8d4cb, roughness:0.6,  metalness:0.03 });
const latexBlue    = ()=>mat("latexBlue",   { color:0x2f6fb5, roughness:0.75, metalness:0 });
const nitrileTeal  = ()=>mat("nitrileTeal", { color:0x2e8b8b, roughness:0.7,  metalness:0.02 });
const tan          = ()=>mat("tan",         { color:0xd9b48a, roughness:0.85, metalness:0 });

function labelPlane(w,h,tex,{ doubleSided }={}){
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w,h),
    new THREE.MeshStandardMaterial({ map:tex, roughness:0.85, metalness:0, side:doubleSided?THREE.DoubleSide:THREE.FrontSide })
  );
  return m;
}
function box(w,h,d,material,r){
  // r = corner rounding hint; a cheap bevel via a slightly inset second box
  const g = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), material);
  if(r) g.scale.set(1,1,1);
  return g;
}

/* ---------- builders ------------------------------------------------------ */

function buildGloveBox(){
  const g = new THREE.Group(); g.name = "gloveBox";
  const body = box(0.104,0.058,0.062, nitrileTeal());
  body.position.y = 0.029; body.name="body";
  g.add(body);
  // dispensing oval on the top face with a glove cuff poking out
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.016,20), darkPlastic());
  hole.rotation.x = -Math.PI/2; hole.position.set(0,0.0585,0);
  g.add(hole);
  const cuff = new THREE.Mesh(new THREE.SphereGeometry(0.014,12,8,0,Math.PI*2,0,Math.PI/2), plasticWhite());
  cuff.position.set(0.002,0.058,0.002); cuff.scale.set(1,0.7,0.8);
  g.add(cuff);
  const face = labelPlane(0.09,0.036, labelTexture({
    title:"NITRILE", lines:["Exam gloves","Powder-free · M"], stripe:"#2e8b8b", bg:"#f4f7f6", w:256,h:104
  }));
  face.position.set(0,0.030,0.0312);
  g.add(face);
  return g;
}

function buildTourniquet(){
  const g = new THREE.Group(); g.name = "tourniquet";
  // a flat latex-free strap, loosely coiled — the same object branch 2 will
  // uncoil, route under the arm and tension.
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.036,0.0075,8,36), latexBlue());
  coil.rotation.x = -Math.PI/2; coil.position.y = 0.0075;
  coil.scale.set(1,1,0.42); coil.name="coil";
  g.add(coil);
  const inner = new THREE.Mesh(new THREE.TorusGeometry(0.024,0.006,8,30), latexBlue());
  inner.rotation.x = -Math.PI/2; inner.position.set(0.004,0.016,0.002);
  inner.scale.set(1,1,0.42);
  g.add(inner);
  // the free tail, lying across the coil
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.062,0.0026,0.024), latexBlue());
  tail.position.set(0.052,0.010,0.006); tail.rotation.z = 0.10; tail.name="tail";
  g.add(tail);
  return g;
}

function buildAlcoholPad(){
  const g = new THREE.Group(); g.name = "alcoholPad";
  const pack = box(0.052,0.005,0.052, foilBlue());
  pack.position.y = 0.0025; pack.name="body";
  g.add(pack);
  // serrated tear edge
  const tear = new THREE.Mesh(new THREE.BoxGeometry(0.052,0.0022,0.006), foilBlue());
  tear.position.set(0,0.0034,-0.026);
  g.add(tear);
  const face = labelPlane(0.046,0.046, labelTexture({
    title:"ALCOHOL PREP", lines:["70% Isopropyl","Medium · Sterile"], stripe:"#2f6fb5", bg:"#eef4fb", w:220,h:220
  }));
  face.rotation.x = -Math.PI/2; face.position.set(0,0.0053,0);
  face.name="frontLabel";
  g.add(face);
  const back = labelPlane(0.046,0.046, labelTexture({
    lines:["LOT 4471-B","EXP —","Single use only","Do not use if open"], bg:"#f6f6f1", w:220,h:220
  }));
  back.rotation.x = Math.PI/2; back.position.set(0,-0.0003,0);
  back.name="backLabel";
  g.add(back);
  return g;
}

function buildNeedle(){
  const g = new THREE.Group(); g.name = "needlePack";
  // sealed peel-pack: paper backing + clear blister showing the needle
  const paper = box(0.098,0.0016,0.034, paperWhite());
  paper.position.y = 0.0008; paper.name="body";
  g.add(paper);
  const blister = new THREE.Mesh(new THREE.CapsuleGeometry(0.0075,0.076,4,10), clearPlastic());
  blister.rotation.z = Math.PI/2; blister.position.set(0,0.0075,0);
  blister.scale.set(1,1,0.75); blister.name="blister";
  g.add(blister);
  // the needle inside: hub (gauge-coloured band), shaft, patient-end sheath
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.0055,0.0048,0.016,14), plasticWhite());
  hub.rotation.z = Math.PI/2; hub.position.set(-0.020,0.0072,0);
  g.add(hub);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0058,0.0058,0.005,14), new THREE.MeshStandardMaterial({ color:GAUGE_COLORS[21], roughness:0.5 }));
  band.rotation.z = Math.PI/2; band.position.set(-0.0125,0.0072,0);
  band.name = "gaugeBand";
  g.add(band);
  const sheath = new THREE.Mesh(new THREE.CylinderGeometry(0.0042,0.0036,0.040,12), plasticWhite());
  sheath.rotation.z = Math.PI/2; sheath.position.set(0.016,0.0072,0);
  g.add(sheath);
  const face = labelPlane(0.05,0.026, labelTexture({
    title:"MULTISAMPLE", lines:["21G × 1 in","STERILE EO"], bg:"#f7f7f2", w:230,h:120
  }));
  face.rotation.x = -Math.PI/2; face.position.set(-0.024,0.0018,0.0);
  face.name="frontLabel";
  g.add(face);
  return g;
}

function buildHolder(){
  const g = new THREE.Group(); g.name = "holder";
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0125,0.0125,0.062,20,1,true), clearPlastic());
  barrel.rotation.z = Math.PI/2; barrel.position.set(0,0.0125,0); barrel.name="body";
  g.add(barrel);
  const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.019,0.019,0.003,20), clearPlastic());
  flange.rotation.z = Math.PI/2; flange.position.set(0.031,0.0125,0);
  g.add(flange);
  const hubEnd = new THREE.Mesh(new THREE.CylinderGeometry(0.006,0.008,0.012,16), plasticWhite());
  hubEnd.rotation.z = Math.PI/2; hubEnd.position.set(-0.036,0.0125,0); hubEnd.name="hub";
  g.add(hubEnd);
  // thread ridges on the hub so branch 5's clockwise-threading mechanic has
  // something real to align to
  for(let i=0;i<3;i++){
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.0062,0.0007,6,16), plasticWhite());
    t.rotation.y = Math.PI/2; t.position.set(-0.033-i*0.004,0.0125,0);
    g.add(t);
  }
  return g;
}

function buildGauze(){
  const g = new THREE.Group(); g.name = "gauze";
  const pouch = box(0.056,0.006,0.056, paperWhite());
  pouch.position.y = 0.003; pouch.name="body";
  g.add(pouch);
  const face = labelPlane(0.05,0.05, labelTexture({
    title:"STERILE", lines:["Gauze 2×2 in","8 ply · 2 per pouch"], stripe:"#4f8f5f", bg:"#f7faf6", w:230,h:230
  }));
  face.rotation.x = -Math.PI/2; face.position.set(0,0.0062,0);
  face.name="frontLabel";
  g.add(face);
  return g;
}

function buildBandage(){
  const g = new THREE.Group(); g.name = "bandage";
  const wrap = box(0.046,0.004,0.022, paperWhite());
  wrap.position.y = 0.002; wrap.name="body";
  g.add(wrap);
  const strip = box(0.030,0.0022,0.014, tan());
  strip.position.set(0,0.0052,0);
  g.add(strip);
  return g;
}

function buildTube(){
  const g = new THREE.Group(); g.name = "tube";
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.0065,0.0065,0.066,18), glass());
  body.position.y = 0.033; body.name="body";
  g.add(body);
  const base = new THREE.Mesh(new THREE.SphereGeometry(0.0065,16,10,0,Math.PI*2,Math.PI/2,Math.PI/2), glass());
  base.position.y = 0.0;
  g.add(base);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0072,0.0072,0.014,18), new THREE.MeshStandardMaterial({ color:0xdc4b4b, roughness:0.5 }));
  cap.position.y = 0.070; cap.name="cap";
  g.add(cap);
  const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.0060,0.0072,0.004,18), new THREE.MeshStandardMaterial({ color:0xdc4b4b, roughness:0.5 }));
  capTop.position.y = 0.079; capTop.name="capTop";
  g.add(capTop);
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.00665,0.00665,0.030,18,1,true),
    new THREE.MeshStandardMaterial({ map:blankLabelTexture(), roughness:0.9 }));
  label.position.y = 0.030; label.name="label";
  g.add(label);
  return g;
}

function buildSharpsContainer(){
  const g = new THREE.Group(); g.name = "sharpsContainer";
  const W=0.155, D=0.115, H=0.165;
  const body = box(W,H,D, sharpsRed());
  body.position.y = H/2; body.name="body";
  g.add(body);
  // translucent fill window so the fill level is actually readable
  const window_ = new THREE.Mesh(new THREE.PlaneGeometry(W*0.62,H*0.5),
    new THREE.MeshStandardMaterial({ color:0xe4bcb6, roughness:0.35, transparent:true, opacity:0.55 }));
  window_.position.set(0,H*0.42,D/2+0.0009); window_.name="window";
  g.add(window_);
  // contents (scaled by fill level in decorate)
  const contents = new THREE.Mesh(new THREE.BoxGeometry(W*0.86,H*0.60,D*0.82),
    new THREE.MeshStandardMaterial({ color:0x8d8f96, roughness:0.7 }));
  contents.position.y = H*0.30; contents.name="contents"; contents.scale.y = 0.5;
  g.add(contents);
  // biohazard panel
  const bio = labelPlane(0.072,0.072, biohazardTexture({ bg:"#b5342c", fg:"#151210" }));
  bio.position.set(0,H*0.40,D/2+0.0016); bio.name="biohazard";
  g.add(bio);
  // fill line band
  const fl = labelPlane(W*0.98,0.014, fillLineTexture());
  fl.position.set(0,H*0.68,D/2+0.0014); fl.name="fillLine";
  g.add(fl);
  // lid assembly: base collar + rotating lid with a drop aperture
  const collar = box(W*1.03,0.014,D*1.03, sharpsLid());
  collar.position.y = H+0.007;
  g.add(collar);
  const lid = new THREE.Group(); lid.name="lid"; lid.position.y = H+0.014;
  // The lid is extruded from a rectangle with a circular hole cut out of it,
  // so the disposal aperture is a REAL opening you can see down into — open
  // vs. locked has to be readable at a glance, not inferred from a label.
  const APERTURE_R = 0.028;
  const shape = new THREE.Shape();
  const hw = W*0.49, hd = D*0.49;
  shape.moveTo(-hw,-hd); shape.lineTo(hw,-hd); shape.lineTo(hw,hd); shape.lineTo(-hw,hd); shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, APERTURE_R, 0, Math.PI*2, true);
  shape.holes.push(hole);
  const lidTop = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth:0.010, bevelEnabled:false }), sharpsLid());
  lidTop.rotation.x = -Math.PI/2; lidTop.position.y = 0.010; lidTop.name="lidTop";
  lid.add(lidTop);
  // the throat below the aperture, and a dark floor so the hole reads as depth
  const throat = new THREE.Mesh(new THREE.CylinderGeometry(APERTURE_R,APERTURE_R*0.82,0.030,22,1,true), darkPlastic());
  throat.position.y = -0.014; throat.name="throat";
  lid.add(throat);
  const throatFloor = new THREE.Mesh(new THREE.CircleGeometry(APERTURE_R*0.84,22), new THREE.MeshStandardMaterial({ color:0x1b1d21, roughness:0.95 }));
  throatFloor.rotation.x = -Math.PI/2; throatFloor.position.y = -0.029;
  lid.add(throatFloor);
  const apertureRim = new THREE.Mesh(new THREE.TorusGeometry(APERTURE_R,0.0032,8,26), sharpsLid());
  apertureRim.rotation.x = Math.PI/2; apertureRim.position.y = 0.011; apertureRim.name="apertureRim";
  lid.add(apertureRim);
  // the sliding closure plate: parked beside the aperture when open, sitting
  // right over it when the container has been locked for pickup
  const flap = new THREE.Mesh(new THREE.CylinderGeometry(APERTURE_R*1.12,APERTURE_R*1.12,0.006,24), sharpsLid());
  flap.position.set(W*0.34,0.014,0); flap.name="flap";
  lid.add(flap);
  g.add(lid);
  const spec = labelPlane(0.10,0.020, labelTexture({
    lines:["SHARPS · 5 QT"], bg:"#b5342c", ink:"#ffffff", w:260,h:56
  }));
  spec.position.set(0,0.030,D/2+0.0012);
  g.add(spec);
  return g;
}

function buildCottonBall(){
  const g = new THREE.Group(); g.name = "cottonBalls";
  const bag = box(0.056,0.038,0.040, new THREE.MeshStandardMaterial({ color:0xf3f2ee, roughness:0.85, transparent:true, opacity:0.75 }));
  bag.position.y = 0.019; bag.name="body";
  g.add(bag);
  [[-0.012,0.014,0],[0.010,0.020,0.006],[0.001,0.028,-0.006]].forEach(p=>{
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.010,10,8), paperWhite());
    b.position.set(p[0],p[1],p[2]);
    g.add(b);
  });
  return g;
}

function buildSyringe(){
  const g = new THREE.Group(); g.name = "syringe";
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0105,0.0105,0.082,18), clearPlastic());
  barrel.rotation.z = Math.PI/2; barrel.position.set(0,0.0105,0); barrel.name="body";
  g.add(barrel);
  const plunger = new THREE.Mesh(new THREE.CylinderGeometry(0.0045,0.0045,0.040,12), plasticWhite());
  plunger.rotation.z = Math.PI/2; plunger.position.set(0.058,0.0105,0);
  g.add(plunger);
  const thumb = new THREE.Mesh(new THREE.CylinderGeometry(0.013,0.013,0.003,16), plasticWhite());
  thumb.rotation.z = Math.PI/2; thumb.position.set(0.079,0.0105,0);
  g.add(thumb);
  const luer = new THREE.Mesh(new THREE.CylinderGeometry(0.004,0.006,0.010,12), plasticWhite());
  luer.rotation.z = Math.PI/2; luer.position.set(-0.046,0.0105,0);
  g.add(luer);
  return g;
}

function buildUrineCup(){
  const g = new THREE.Group(); g.name = "urineCup";
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.028,0.024,0.060,22,1,true), clearPlastic());
  cup.position.y = 0.030; cup.name="body";
  g.add(cup);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.030,0.030,0.008,22), new THREE.MeshStandardMaterial({ color:0xe8c33a, roughness:0.5 }));
  lid.position.y = 0.062; lid.name="lid";
  g.add(lid);
  const face = labelPlane(0.042,0.024, labelTexture({ title:"URINE", lines:["Specimen container"], bg:"#faf8ee", w:200,h:110 }));
  face.position.set(0,0.030,0.0272);
  g.add(face);
  return g;
}

/* ---------- fixtures (not draggable, but same pipeline) ------------------ */
function buildTray(){
  const g = new THREE.Group(); g.name = "tray";
  const W=0.34, D=0.22, H=0.012;
  const floorMesh = box(W,H,D, mat("trayBody",{ color:0xdfe3ea, roughness:0.45, metalness:0.15 }));
  floorMesh.position.y = H/2;
  g.add(floorMesh);
  const rimMat = mat("trayRim",{ color:0xc8cdd6, roughness:0.4, metalness:0.2 });
  [[0,-D/2],[0,D/2]].forEach(([x,z])=>{
    const r = box(W,0.016,0.006, rimMat); r.position.set(x,0.014,z); g.add(r);
  });
  [[-W/2,0],[W/2,0]].forEach(([x,z])=>{
    const r = box(0.006,0.016,D, rimMat); r.position.set(x,0.014,z); g.add(r);
  });
  return g;
}

function buildTubeRack(slots){
  const g = new THREE.Group(); g.name = "tubeRack";
  const n = Math.max(1, slots||3);
  const w = 0.026*n + 0.014;
  const base = box(w,0.016,0.036, mat("rackBody",{ color:0xf0e9dc, roughness:0.7 }));
  base.position.y = 0.008;
  g.add(base);
  for(let i=0;i<n;i++){
    const x = -w/2 + 0.007 + 0.013 + i*0.026;
    const well = new THREE.Mesh(new THREE.CylinderGeometry(0.0085,0.0085,0.012,16,1,true), mat("rackWell",{ color:0xcfc6b4, roughness:0.8, side:THREE.DoubleSide }));
    well.position.set(x,0.011,0);
    well.name = `well${i}`;
    g.add(well);
    const num = labelPlane(0.011,0.011, labelTexture({ lines:[String(i+1)], bg:"#f0e9dc", w:48,h:48 }));
    num.rotation.x = -Math.PI/2; num.position.set(x,0.0165,0.014);
    g.add(num);
  }
  g.userData.slotX = Array.from({length:n},(_,i)=>-w/2 + 0.020 + i*0.026);
  return g;
}

/* ---------- registration -------------------------------------------------- */
export const SUPPLY_MODEL_IDS = [
  "supply.gloveBox","supply.tourniquet","supply.alcoholPad","supply.needle","supply.holder",
  "supply.gauze","supply.bandage","supply.tube","supply.sharpsContainer",
  "supply.cottonBall","supply.syringe","supply.urineCup","supply.tray",
];

let registered = false;
export function registerSupplyModels(){
  if(registered) return SUPPLY_MODEL_IDS;
  registered = true;
  const defs = {
    "supply.gloveBox": buildGloveBox,
    "supply.tourniquet": buildTourniquet,
    "supply.alcoholPad": buildAlcoholPad,
    "supply.needle": buildNeedle,
    "supply.holder": buildHolder,
    "supply.gauze": buildGauze,
    "supply.bandage": buildBandage,
    "supply.tube": buildTube,
    "supply.sharpsContainer": buildSharpsContainer,
    "supply.cottonBall": buildCottonBall,
    "supply.syringe": buildSyringe,
    "supply.urineCup": buildUrineCup,
    "supply.tray": buildTray,
  };
  // url stays null until an optimised, licence-cleared .glb exists for each
  // (see docs/ASSET_SOURCES.md) — the registry then prefers the .glb and
  // keeps these as the fallback automatically.
  Object.entries(defs).forEach(([id, fallback])=>registerModel({ id, url:null, fallback }));
  return SUPPLY_MODEL_IDS;
}

export { buildTubeRack };

/* ---------- per-instance decoration --------------------------------------- */
/**
 * Applies the catalog entry's identity to a freshly cloned model instance:
 * cap colour, gauge band, printed labels, sharps fill level and lid state.
 * Materials that vary per instance are cloned here so recolouring one tube
 * never bleeds into another.
 */
export function decorateInstance(obj, def, ctx){
  const c = ctx||{};
  const setColor = (name, hex)=>{
    const m = obj.getObjectByName(name);
    if(!m || !m.material) return;
    m.material = m.material.clone();
    m.material.color = new THREE.Color(hex);
  };
  const setMap = (name, tex)=>{
    const m = obj.getObjectByName(name);
    if(!m || !m.material) return;
    m.material = m.material.clone();
    m.material.map = tex;
    m.material.needsUpdate = true;
  };

  if(def.tubeKey && c.tubeColor!=null){
    setColor("cap", c.tubeColor);
    setColor("capTop", c.tubeColor);
    setMap("label", labelTexture({
      lines: c.labelLines || [], bg: def.flaws && def.flaws.length ? "#fbf3ef" : "#fbfbf7",
      accent: def.flaws && def.flaws.includes("wrongPatient") ? "#c0392b" : null, w:192, h:128,
    }));
  }
  if(def.gauge!=null){
    setColor("gaugeBand", GAUGE_COLORS[def.gauge] || 0x888888);
    setMap("frontLabel", labelTexture({
      title:"MULTISAMPLE", lines:[`${def.gauge}G × 1 in`, def.flaws && def.flaws.includes("damaged") ? "SEAL BROKEN" : "STERILE EO"],
      bg: def.flaws && def.flaws.includes("damaged") ? "#f9efe9" : "#f7f7f2", w:230, h:120,
    }));
    if(def.flaws && def.flaws.includes("damaged")){
      const blister = obj.getObjectByName("blister");
      if(blister){ blister.material = blister.material.clone(); blister.material.opacity = 0.20; blister.rotation.x = 0.25; }
    }
  }
  if(def.category==="sharps"){
    const contents = obj.getObjectByName("contents");
    const lid = obj.getObjectByName("lid");
    const flap = obj.getObjectByName("flap");
    const overfilled = def.flaws && def.flaws.includes("overfilled");
    const closed = def.flaws && def.flaws.includes("closed");
    if(contents){
      // contents geometry is H*0.60 tall; keep its BASE on the container floor
      // so the fill level reads honestly against the printed fill line at H*0.68.
      const H = 0.165, geomH = H*0.60, floorY = 0.008;
      const s = overfilled ? 1.28 : 0.5;
      contents.scale.y = s;
      contents.position.y = floorY + geomH*s/2;
    }
    if(flap) flap.position.x = closed ? 0 : 0.155*0.34;   // slid over the aperture, or parked beside it
    const bio = obj.getObjectByName("biohazard");
    if(bio && overfilled){ setMap("biohazard", biohazardTexture({ bg:"#8f2018", fg:"#151210", text:"FULL — REPLACE" })); }
    if(bio && closed){ setMap("biohazard", biohazardTexture({ bg:"#b5342c", fg:"#151210", text:"LOCKED" })); }
  }
  if(def.category==="alcohol" && def.flaws && def.flaws.includes("empty")){
    const body = obj.getObjectByName("body");
    if(body){ body.scale.y = 0.35; }
    setMap("frontLabel", labelTexture({ title:"ALCOHOL PREP", lines:["70% Isopropyl","OPENED"], stripe:"#8a99a8", bg:"#eceef0", w:220,h:220 }));
  }
  if(def.category==="gauze" && def.flaws && def.flaws.includes("unsterile")){
    setMap("frontLabel", labelTexture({ title:"OPENED", lines:["Gauze 2×2 in","Pouch torn"], stripe:"#a08a5f", bg:"#f4f1e8", w:230,h:230 }));
  }
  return obj;
}
