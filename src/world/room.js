/* =========================================================================
   The room shell (walls/floor that fade as the camera orbits) AND the decor
   placement system (grid floor items + wall art) live together here rather
   than split across two files: the original code has them call each other
   constantly (placing an item re-renders the room; the room re-render needs
   to know what's placed where), so separating them would just create an
   import cycle between the two halves. See docs/ARCHITECTURE.md.
   ========================================================================= */
import * as THREE from "three";
import {
  GRID_COLS, GRID_ROWS, MOVABLE, MOVABLE_META, DEFAULT_PLACEMENT,
  WALLS, WALL_MOVABLE, WALL_META, DEFAULT_WALL, WALL_EDGE, WALL_Y_LO, WALL_COLS, WALL_ROWS,
  STACK_SURFACES, SURFACE_OBSTACLES
} from "../config.js";
import { box, cyl, sph, mat, regTheme } from "../rendering/materials.js";
import { currentRoomSpec, getOfficeTier, hasUpgrade } from "../game/progression.js";
import { SS, saveSS, DARK, ARRANGE, setArrange, state } from "../game/gameState.js";
import { orbit, clampOrbit, updateCamera, cameraBounds, tweenCamera, normAngle, wallOpacityForSide } from "../rendering/camera.js";
import { dirLight, fillLight } from "../rendering/lighting.js";
import { applyTheme } from "../rendering/materials.js";
import { toast } from "../ui/notifications.js";

let scene = null;
export function setRoomScene(s){ scene = s; }

/* ---------- room shell (fades walls as the camera orbits) ----------------- */
let roomGroup=null;
export let roomWallParts={front:[],back:[],left:[],right:[]};
// Fixed key list, so the two per-frame wall passes below don't allocate an
// Object.keys() array on every frame of the room loop.
const WALL_SIDES=["front","back","left","right"];
// The wall targets are a pure function of the orbit angle, and the ease has a
// resting state. Both passes below are skipped once there is nothing to do —
// see updateRoomWallVisibility() and tickWallFade().
let lastWallTheta=null;
let wallFadeSettled=false;

export function buildRoom(){ refreshRoomShell(true); }

export function refreshRoomShell(){
  if(!scene) return;
  if(roomGroup){ scene.remove(roomGroup); }
  roomGroup=new THREE.Group(); roomGroup.name="room-shell"; scene.add(roomGroup);
  roomWallParts={front:[],back:[],left:[],right:[]};
  // brand-new meshes: neither cached angle nor "settled" says anything about them
  lastWallTheta=null; wallFadeSettled=false;
  const spec=currentRoomSpec(), w=spec.w, d=spec.d, h=spec.h;
  const backZ=-d/2, frontZ=d/2, leftX=-w/2, rightX=w/2;
  const addRoom=obj=>{ roomGroup.add(obj); return obj; };
  const addWall=(side,obj)=>{ obj.userData.wallSide=side; obj.castShadow=false; obj.receiveShadow=false; roomWallParts[side].push(obj); return addRoom(obj); };

  // Floor: the starter office is intentionally small, plain, and boxy.
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(w,d),mat(spec.floor,{roughness:1}));
  floor.rotation.x=-Math.PI/2; floor.receiveShadow=true; regTheme(floor,spec.floor); addRoom(floor);

  // Full walls on every side. Camera-facing foreground walls fade into a transparent
  // dollhouse cutaway as the player orbits, while opposite/back walls stay firm.
  addWall("back",box(w,h,0.32,spec.wall,0,h/2,backZ));
  addWall("left",box(0.32,h,d,spec.side,leftX,h/2,0));
  addWall("right",box(0.32,h,d,spec.side,rightX,h/2,0));
  addWall("front",box(w,h,0.28,spec.side,0,h/2,frontZ));

  // Thick floor lip and corner posts keep the camera from feeling like it is floating outside a stage.
  addWall("back",box(w,0.16,0.18,spec.trim,0,0.08,backZ+0.08));
  addWall("front",box(w,0.16,0.18,spec.trim,0,0.08,frontZ-0.08));
  addWall("left",box(0.18,0.16,d,spec.trim,leftX+0.08,0.08,0));
  addWall("right",box(0.18,0.16,d,spec.trim,rightX-0.08,0.08,0));
  [[leftX,backZ],[rightX,backZ],[leftX,frontZ],[rightX,frontZ]].forEach(([x,z])=>{
    const side=z>0?"front":"back";
    addWall(side,box(0.34,h,0.34,spec.trim,x,h/2,z));
  });

  // Office expansion purchases add subtle architectural polish without changing gameplay.
  if(spec.tier>=1){
    addRoom(box(w-1.1,0.16,0.08,0xffffff,0,2.35,backZ+0.18));
    addRoom(box(0.08,0.16,d-1.0,0xffffff,leftX+0.18,2.35,0));
  }
  if(spec.tier>=2){
    addRoom(box(w-2.2,0.14,0.08,0xc5d9e8,0,3.1,backZ+0.2));
    addRoom(box(0.08,0.14,d-2.0,0xc5d9e8,leftX+0.2,3.1,0));
    addRoom(box(2.2,0.1,0.08,0xb8d7ce,rightX-1.8,4.9,backZ+0.2));
  }
  if(spec.tier>=3){
    addRoom(box(w-3.0,0.08,0.08,0xfff7d8,0,5.15,backZ+0.22,{emissive:0xffd98a,emissiveIntensity:DARK?0.18:0.06}));
    addRoom(box(0.08,0.08,d-3.0,0xfff7d8,leftX+0.22,5.15,0,{emissive:0xffd98a,emissiveIntensity:DARK?0.18:0.06}));
  }
}

export function setMeshOpacity(mesh,opacity){
  if(!mesh||!mesh.material) return;
  // store a target; the animation loop eases toward it so walls fade in/out smoothly
  mesh.userData.wallTarget=opacity;
  if(mesh.userData.wallOpac===undefined) mesh.userData.wallOpac=opacity;
  // anything the material does not already reflect is work for the fade pass,
  // including the very first sync of a freshly built wall
  if(mesh.userData.wallApplied!==opacity) wallFadeSettled=false;
  mesh.castShadow=false; mesh.receiveShadow=false; // map walls take no shadows at all (kept clean)
}
/* Eases every wall toward the target the orbit angle set. Once every wall has
   arrived there is nothing left to ease, so the pass parks itself rather than
   rewriting the same opacity onto every wall material for the rest of the
   session; setMeshOpacity() wakes it again the moment a target moves. */
export function tickWallFade(){
  if(!roomWallParts||wallFadeSettled) return;
  let moving=false;
  for(const side of WALL_SIDES){
    for(const m of roomWallParts[side]){
      if(!m.material||m.userData.wallTarget===undefined) continue;
      const tgt=m.userData.wallTarget;
      let o=m.userData.wallOpac; if(o===undefined)o=tgt;
      if(o!==tgt){
        o += (tgt-o)*0.12;                        // ease (~0.2s) instead of snapping
        if(Math.abs(tgt-o)<0.005) o=tgt; else moving=true;
        m.userData.wallOpac=o;
      }
      // write only what the material is not already showing — this is what
      // makes a settled wall cost nothing, and it still covers the first sync
      if(m.userData.wallApplied!==o){
        m.material.transparent=o<0.99;
        m.material.opacity=o;
        m.material.depthWrite=o>0.45;
        m.userData.wallApplied=o;
      }
    }
  }
  wallFadeSettled=!moving;
}
/* The per-side target opacity is a pure function of the orbit angle, so an
   unchanged angle can only produce the targets the walls already carry. */
export function updateRoomWallVisibility(){
  if(!roomWallParts||!orbit) return;
  const theta=normAngle(orbit.theta);
  if(theta===lastWallTheta) return;
  lastWallTheta=theta;
  for(const side of WALL_SIDES){
    const opacity=wallOpacityForSide(side,theta);
    for(const m of roomWallParts[side]) setMeshOpacity(m,opacity);
  }
}

/* ---------- movable decor: grid placement system -------------------------- */
function gridMargin(){ return 0.16; } // grid reaches close to the interior wall faces so tiles meet the room borders
export function gridToWorld(gx,gz){
  const spec=currentRoomSpec(), m=gridMargin();
  const uW=spec.w-m*2, uD=spec.d-m*2;
  return { x:-uW/2+(gx+0.5)*(uW/GRID_COLS), z:uD/2-(gz+0.5)*(uD/GRID_ROWS) }; // gz0 = front (+Z, near camera)
}
export function worldToGrid(x,z){
  const spec=currentRoomSpec(), m=gridMargin();
  const uW=spec.w-m*2, uD=spec.d-m*2;
  let gx=Math.round((x+uW/2)/(uW/GRID_COLS)-0.5);
  let gz=Math.round((uD/2-z)/(uD/GRID_ROWS)-0.5);
  return [Math.max(0,Math.min(GRID_COLS-1,gx)), Math.max(0,Math.min(GRID_ROWS-1,gz))];
}
// Only the tube area and the chair stay clear; everything else can hold decor.
function lockFootprints(){
  return [
    {x:1.35,z:-0.05,hw:0.85,hd:0.85}, // patient chair
    {x:1.35,z:0.35, hw:0.55,hd:0.55}, // patient
    {x:0,   z:2.7,  hw:1.55,hd:0.70}  // tube rack (the tube area)
  ];
}
function lockedCells(){
  const spec=currentRoomSpec(), m=gridMargin();
  const cw=(spec.w-m*2)/GRID_COLS, cd=(spec.d-m*2)/GRID_ROWS, fps=lockFootprints(), out=[];
  for(let gz=0; gz<GRID_ROWS; gz++) for(let gx=0; gx<GRID_COLS; gx++){
    const w=gridToWorld(gx,gz);
    if(fps.some(f=> Math.abs(w.x-f.x) < f.hw+cw*0.2 && Math.abs(w.z-f.z) < f.hd+cd*0.2)) out.push([gx,gz]);
  }
  return out;
}
export function isLocked(gx,gz){ return lockedCells().some(c=>c[0]===gx&&c[1]===gz); }
export function placementOf(id){ return (SS.placements&&SS.placements[id])||DEFAULT_PLACEMENT[id]||[2,3]; }
function itemRadius(id){ return (MOVABLE_META[id]&&MOVABLE_META[id].r)||0.3; }
// What does a piece of radius r rest on at this cell? floor (y=0), a furniture top, or nothing (blocked)?
function surfaceAt(gx,gz,r){
  r=r||0.3;
  if(isLocked(gx,gz)) return {ok:false,reason:"locked"};
  const w=gridToWorld(gx,gz);
  let onSurf=null, blocked=false;
  STACK_SURFACES.forEach(s=>{
    if(Math.abs(w.x-s.x) < s.hw+0.18 && Math.abs(w.z-s.z) < s.hd+0.18){
      if(r<=s.maxR){ if(!onSurf||s.top>onSurf.top) onSurf=s; }
      else blocked=true; // a surface is here but the item is too big to sit on it, and the floor is taken
    }
  });
  if(onSurf) return {ok:true,y:onSurf.top,surface:onSurf};
  if(blocked) return {ok:false,reason:"toobig"};
  return {ok:true,y:0}; // plain floor
}
// keep a floor piece fully inside the room given its footprint radius (fixes large items like the rug clipping walls)
export function clampFloorWorld(id,x,z){
  const spec=currentRoomSpec(), r=itemRadius(id), pad=0.28;
  const lx=Math.max(0,spec.w/2-pad-r), lz=Math.max(0,spec.d/2-pad-r);
  return { x:Math.max(-lx,Math.min(lx,x)), z:Math.max(-lz,Math.min(lz,z)) };
}
function hitsObstacle(x,z,r){ return SURFACE_OBSTACLES.some(o=> Math.abs(x-o.x) < o.hw+r-0.02 && Math.abs(z-o.z) < o.hd+r-0.02 ); }
// world transform for a piece of radius r at a given cell (pure geometry — surface top or floor, clamped in bounds)
export function cellWorld(id,gx,gz){
  const w=gridToWorld(gx,gz), r=itemRadius(id), s=surfaceAt(gx,gz,r);
  if(s.surface){ const su=s.surface;
    return { x:Math.max(su.x-su.hw+r,Math.min(su.x+su.hw-r,w.x)), y:su.top, z:Math.max(su.z-su.hd+r,Math.min(su.z+su.hd-r,w.z)) };
  }
  const f=clampFloorWorld(id,w.x,w.z);
  return { x:f.x, y:0, z:f.z };
}
export function placementWorld(id){ const c=placementOf(id); return cellWorld(id,c[0],c[1]); }
// would a piece of radius r at (x,z) overlap another placed piece? (the flat rug is a floor covering, so ignore it)
function hitsOtherDecor(id,x,z,r,ignoreId){
  return MOVABLE.some(o=>{
    if(o===id||o===ignoreId||o==="rug"||!hasUpgrade(o)) return false;
    const w=placementWorld(o);
    return Math.hypot(x-w.x, z-w.z) < r+itemRadius(o)-0.05;
  });
}
// can `id` rest at this cell? checks reserved cells, fit, the computer/props, and other decor
export function placementCheck(id,gx,gz,ignoreId){
  const r=itemRadius(id), s=surfaceAt(gx,gz,r);
  if(!s.ok) return {ok:false,reason:s.reason};
  const w=cellWorld(id,gx,gz);
  if(hitsObstacle(w.x,w.z,r)) return {ok:false,reason:"obstacle"};
  if(hitsOtherDecor(id,w.x,w.z,r,ignoreId)) return {ok:false,reason:"overlap"};
  return {ok:true,x:w.x,y:w.y,z:w.z};
}
export function itemAtCell(gx,gz){ return MOVABLE.find(id=>hasUpgrade(id)&&placementOf(id)[0]===gx&&placementOf(id)[1]===gz); }
// 90° rotation state for floor decor (quarter turns 0..3). Floor collision is a circle (itemRadius),
// so yaw is purely visual and can never change placement validity — safe to rotate freely.
export function floorRotOf(id){ return (SS.rotations&&SS.rotations[id])||0; }
export function rotateFloorItem(id){
  if(!SS.rotations) SS.rotations={};
  SS.rotations[id]=((floorRotOf(id)+1)%4);
  saveSS(); updateRoomUpgrades();
}
function placedGroup(id){ const g=new THREE.Group(); const w=placementWorld(id); g.position.set(w.x,w.y,w.z); g.rotation.y=floorRotOf(id)*Math.PI/2; g.userData.movableId=id; if(upgradeGroup) upgradeGroup.add(g); return g; }

export function itemRadiusOf(id){ return itemRadius(id); }
export function placeItem(id,gx,gz){
  if(!MOVABLE.includes(id)||!hasUpgrade(id)) return false;
  const other=itemAtCell(gx,gz);
  const chk=placementCheck(id,gx,gz,other); // ignore the cell's current piece — we'll swap it out
  if(!chk.ok){
    toast(chk.reason==="toobig"?"Too big to sit there 📏":chk.reason==="obstacle"?"No room — something's already there 🖥️":chk.reason==="overlap"?"That would overlap another piece ✋":"That spot is reserved 🧪");
    return false;
  }
  if(other&&other!==id){ const mine=placementOf(id).slice(); SS.placements[other]=mine; } // swap, lose nothing
  SS.placements[id]=[gx,gz];
  saveSS(); updateRoomUpgrades();
  return true;
}

/* ---------- movable WALL art: positions on back / left / right walls ------ */
export function wallInfo(wall){
  const spec=currentRoomSpec(), t=0.22;
  if(wall==="left")  return {axis:"z", len:spec.d, fixedAxis:"x", fixed:-spec.w/2+t, rotY:Math.PI/2};
  if(wall==="right") return {axis:"z", len:spec.d, fixedAxis:"x", fixed: spec.w/2-t, rotY:-Math.PI/2};
  if(wall==="front") return {axis:"x", len:spec.w, fixedAxis:"z", fixed: spec.d/2-t, rotY:Math.PI}; // the main / open wall
  return {axis:"x", len:spec.w, fixedAxis:"z", fixed:-spec.d/2+t, rotY:0}; // back
}
export function wallYHi(){ return currentRoomSpec().h-0.5; }
// snap a (wall,col,row) to a world transform, clamped so an item of size (iw,ih) stays fully on the wall
export function wallToWorld(wall,col,row,iw,ih){
  const spec=currentRoomSpec(), info=wallInfo(wall);
  iw=iw||1; ih=ih||1;
  const usableLen=Math.max(0.2, info.len-WALL_EDGE*2);
  const yHi=wallYHi(), usableH=Math.max(0.2, yHi-WALL_Y_LO);
  let along = -usableLen/2 + (col+0.5)*(usableLen/WALL_COLS);
  let y      = WALL_Y_LO + (row+0.5)*(usableH/WALL_ROWS);
  const aLim=Math.max(0, info.len/2-WALL_EDGE-iw/2);
  along=Math.max(-aLim, Math.min(aLim, along));
  y=Math.max(0.55+ih/2, Math.min(spec.h-0.30-ih/2, y));
  const out={y, rotY:info.rotY, along};
  if(info.axis==="x"){ out.x=along; out.z=info.fixed; } else { out.z=along; out.x=info.fixed; }
  return out;
}
export function wallPlaceOf(id){ return (SS.wallPlace&&SS.wallPlace[id])||DEFAULT_WALL[id]||["back",2,1]; }
// 90° rotation state for wall art (quarter turns). Odd turns swap the frame's width/height,
// so bounds + overlap must use the rotated footprint to stay correct (guarded so it can't clip).
export function wallRotOf(id){ return (SS.wallRot&&SS.wallRot[id])||0; }
export function wallDims(id){ const m=WALL_META[id]||{w:1,h:1}; return (wallRotOf(id)%2===1)?{w:m.h,h:m.w}:{w:m.w,h:m.h}; }
function wallWorldOf(id){ const p=wallPlaceOf(id), m=wallDims(id); return wallToWorld(p[0],p[1],p[2],m.w,m.h); }
// does placing `id` at (wall,col,row) overlap another owned wall piece on the same wall?
export function wallOverlapAt(id, wall, col, row){
  const m=wallDims(id), pos=wallToWorld(wall,col,row,m.w,m.h);
  return WALL_MOVABLE.some(other=>{
    if(other===id||!hasUpgrade(other)) return false;
    const op=wallPlaceOf(other); if(op[0]!==wall) return false;
    const om=wallDims(other), opos=wallToWorld(op[0],op[1],op[2],om.w,om.h);
    return Math.abs(pos.along-opos.along) < (m.w+om.w)/2-0.05 && Math.abs(pos.y-opos.y) < (m.h+om.h)/2-0.05;
  });
}
// rotate a wall frame 90° in its own plane, but only if the turned footprint still fits + doesn't overlap
export function rotateWallItem(id){
  if(!SS.wallRot) SS.wallRot={};
  const next=(wallRotOf(id)+1)%4;
  const p=wallPlaceOf(id), wall=p[0], col=p[1], row=p[2];
  const m=WALL_META[id]||{w:1,h:1};
  const dims=(next%2===1)?{w:m.h,h:m.w}:{w:m.w,h:m.h};
  const info=wallInfo(wall), spec=currentRoomSpec();
  const fitsW = dims.w/2 <= (info.len/2-WALL_EDGE)+0.001;
  const fitsH = dims.h <= ((spec.h-0.30)-0.55)+0.001;
  if(!fitsW || !fitsH){ toast("That frame's too big to turn here 🖼️"); return; }
  const saved=SS.wallRot[id]; SS.wallRot[id]=next;           // check overlap with the turned footprint
  if(wallOverlapAt(id,wall,col,row)){ if(saved===undefined) delete SS.wallRot[id]; else SS.wallRot[id]=saved; toast("Not enough room to turn it ✋"); return; }
  saveSS(); updateRoomUpgrades();
}
export function placeWallItem(id,wall,col,row){
  if(!WALL_MOVABLE.includes(id)||!hasUpgrade(id)) return false;
  if(!WALLS.includes(wall)) return false;
  if(wallOverlapAt(id,wall,col,row)){ toast("Not enough room there 🖼️"); return false; }
  if(!SS.wallPlace) SS.wallPlace={};
  SS.wallPlace[id]=[wall,col,row];
  saveSS(); updateRoomUpgrades();
  return true;
}
function wallGroup(id){
  const g=new THREE.Group(); const w=wallWorldOf(id);
  g.position.set(w.x,w.y,w.z); g.rotation.y=w.rotY;
  const roll=wallRotOf(id)*Math.PI/2; if(roll) g.rotateZ(roll);   // 90° in-plane turn around the wall normal
  g.userData.wallId=id; if(upgradeGroup) upgradeGroup.add(g); return g;
}
// a framed picture built in LOCAL space, centered at origin, facing +Z (the group's rotation aims it at the room)
function wallArtLocal(g,w,h,bg,accent,ox,oy){
  ox=ox||0; oy=oy||0;
  g.add(box(w+0.12,h+0.12,0.07,0xb8abc8,ox,oy,0));
  const canvas=box(w,h,0.08,bg,ox,oy,0.04); g.add(canvas);
  g.add(box(w*0.62,0.08,0.05,accent,ox,oy+h*0.14,0.09));
  g.add(box(w*0.38,0.06,0.05,accent,ox,oy-h*0.10,0.09));
  return canvas;
}

/* ---------- upgrade props: rendered into the room as they're bought ------- */
export let upgradeGroup=null, stickerBookGroup=null;

export function updateRoomUpgrades(){
  if(!scene) return;
  refreshRoomShell();
  if(upgradeGroup){ scene.remove(upgradeGroup); }
  upgradeGroup=new THREE.Group(); upgradeGroup.name="office-upgrades"; scene.add(upgradeGroup);
  const spec=currentRoomSpec(), backZ=-spec.d/2+0.24, leftX=-spec.w/2+0.28, rightX=spec.w/2-0.28, frontZ=spec.d/2-0.28;
  const addUG=obj=>{ upgradeGroup.add(obj); return obj; };
  const addWallArt=(x,y,z,w,h,bg,accent)=>{
    addUG(box(w+0.12,h+0.12,0.07,0xb8abc8,x,y,z));
    const canvas=addUG(box(w,h,0.08,bg,x,y,z+0.04));
    addUG(box(w*0.62,0.08,0.05,accent,x,y+h*0.14,z+0.09));
    addUG(box(w*0.38,0.06,0.05,accent,x,y-h*0.10,z+0.09));
    return canvas;
  };

  // Architecture upgrades: the shell expands immediately, and these props sell the new-office fantasy.
  if(hasUpgrade("officeLease")){
    addUG(box(1.25,1.65,0.10,0xf7f3ff,rightX-0.9,3.25,backZ));
    addUG(box(0.95,0.07,0.06,0x8d7ac0,rightX-0.9,3.52,backZ+0.06));
    addUG(box(0.72,0.05,0.06,0x8d7ac0,rightX-0.9,3.24,backZ+0.06));
  }
  if(hasUpgrade("labSuite")){
    addUG(box(2.2,0.78,0.82,0xcbd8e3,leftX+1.55,0.39,frontZ-1.25));
    addUG(box(2.35,0.12,0.98,0xb9c9d6,leftX+1.55,0.86,frontZ-1.25));
    addUG(box(0.62,0.42,0.08,0x91b9d3,leftX+0.65,1.28,frontZ-1.0,{emissive:0x5aa9f0,emissiveIntensity:DARK?0.15:0.06}));
  }
  if(hasUpgrade("dreamRenovation")){
    addUG(box(2.6,0.08,0.08,0xfff7d8,rightX-1.7,4.55,backZ,{emissive:0xffd98a,emissiveIntensity:DARK?0.25:0.08}));
    addUG(box(1.05,0.72,0.28,0xd3e8e0,rightX-1.0,0.38,frontZ-1.2));
    addUG(box(0.92,0.11,0.34,0xb9d8ce,rightX-1.0,0.79,frontZ-1.2));
  }

  if(hasUpgrade("plant")){
    const g=placedGroup("plant");
    g.add(cyl(0.22,0.16,0.34,0xe0a06a,0,0.17,0,16));     // pot, base on the ground
    g.add(cyl(0.205,0.205,0.05,0x6b4a2f,0,0.345,0,16));  // soil
    g.add(sph(0.28,0x7fce9e,0,0.58,0)); g.add(sph(0.20,0x8fd9a8,0.15,0.50,0.05)); g.add(sph(0.17,0x96e0ad,-0.13,0.48,-0.04));
  }
  if(hasUpgrade("poster")){
    wallArtLocal(wallGroup("poster"),1.35,1.45,0xf3ead2,0xff9cc0);
  }
  if(hasUpgrade("sunprint")){
    const g=wallGroup("sunprint"); const art=wallArtLocal(g,1.55,1.3,0xdff2ff,0xffd98a);
    art.material.emissive.setHex(0x5aa9f0); art.material.emissiveIntensity=DARK?0.12:0.04;
    g.add(cyl(0.12,0.12,0.04,0xffd98a,-0.42,0.16,0.12,18));
  }
  if(hasUpgrade("veinchart")){
    const g=wallGroup("veinchart"); wallArtLocal(g,1.35,1.55,0xf7f3ff,0x6b5bd2);
    g.add(box(0.06,0.9,0.05,0x5aa9f0,-0.2,-0.05,0.12));
    g.add(box(0.06,0.65,0.05,0x5aa9f0,0.17,-0.13,0.12));
  }
  if(hasUpgrade("gallery")){
    const g=wallGroup("gallery");
    wallArtLocal(g,0.82,0.72,0xfdf2f8,0xff9cc0,-0.82,-0.18);
    wallArtLocal(g,0.72,0.66,0xeafaf2,0x34b27b, 0.00, 0.30);
    wallArtLocal(g,0.82,0.72,0xeef6ff,0x5aa9f0, 0.82,-0.18);
  }
  if(hasUpgrade("basket")){
    const g=placedGroup("basket");
    g.add(box(0.78,0.40,0.56,0xd7a96c,0,0.20,0));        // basket body on the floor/surface
    g.add(box(0.84,0.08,0.62,0xc98f55,0,0.42,0));        // rim
    [[-0.21,-0.12],[0.02,0.04],[0.22,0.13]].forEach(([x,z])=>g.add(cyl(0.045,0.045,0.46,0xf3ead2,x,0.60,z,10)));
  }
  if(hasUpgrade("lamp")){
    const g=placedGroup("lamp");
    g.add(cyl(0.24,0.28,0.08,0x8d7ac0,0,0.04,0,16));     // weighted base on the floor
    g.add(cyl(0.04,0.04,1.66,0x8d7ac0,0,0.88,0,12));     // pole
    const shade=cyl(0.34,0.5,0.40,0xffdf9c,0,1.86,0,18); shade.material.emissive.setHex(0xffbf6f); shade.material.emissiveIntensity=DARK?0.75:0.35; g.add(shade);
  }
  if(hasUpgrade("chair")){
    addUG(box(1.28,0.15,1.24,0xffc7dd,1.35,0.75,-0.05));
    addUG(box(1.12,0.72,0.14,0xffb3d2,1.35,1.42,-0.46));
    addUG(box(0.46,0.14,0.32,0xfdf2f8,1.35,1.76,-0.35));
  }
  if(hasUpgrade("plush")){
    const g=placedGroup("plush");
    g.add(sph(0.21,0xc9a37b,0,0.21,0));                  // body sitting on the floor/surface
    g.add(sph(0.155,0xc9a37b,0,0.46,0.02));              // head
    g.add(sph(0.07,0xc9a37b,-0.13,0.57,0)); g.add(sph(0.07,0xc9a37b,0.13,0.57,0)); // ears
    g.add(sph(0.06,0xe8c9a8,0,0.42,0.14));               // muzzle
    g.add(sph(0.025,0x3a2f55,-0.06,0.49,0.16)); g.add(sph(0.025,0x3a2f55,0.06,0.49,0.16)); // eyes
  }
  if(hasUpgrade("certificate")){
    const g=wallGroup("certificate");
    g.add(box(1.45,0.98,0.08,0xf7e4a6,0,0,0));
    g.add(box(1.12,0.07,0.04,0x8d7ac0,0,0.22,0.06)); g.add(box(0.82,0.055,0.04,0x8d7ac0,0,-0.02,0.06));
    g.add(cyl(0.1,0.1,0.035,0xff9cc0,0.4,-0.27,0.06,18));
  }
  if(hasUpgrade("shelf")){
    const g=wallGroup("shelf");
    g.add(box(2.05,0.14,0.34,0xb79fe0,0,-0.10,0.17));
    [0xc9a23a,0x6fb2ee,0xdc4b4b,0xf2c02e,0xa782e0].forEach((c,i)=>{ g.add(cyl(0.06,0.06,0.38,0xeaf2fb,-0.8+i*0.38,0.16,0.20,12)); g.add(cyl(0.078,0.078,0.1,c,-0.8+i*0.38,0.40,0.20,12)); });
  }
  if(hasUpgrade("rug")){
    const g=placedGroup("rug");
    const rug=new THREE.Mesh(new THREE.CircleGeometry(1.85,32),mat(0xf2a9c7,{roughness:1})); rug.rotation.x=-Math.PI/2; rug.position.set(0,0.012,0); rug.receiveShadow=true; regTheme(rug,0xf2a9c7); g.add(rug);
    g.add(box(1.25,0.03,0.16,0xffd98a,0,0.04,0)); g.add(box(0.16,0.03,1.25,0xbcd6f7,0,0.045,0));
  }
  if(hasUpgrade("aquarium")){
    const g=placedGroup("aquarium");
    g.add(box(1.22,0.44,0.56,0x9a86d8,0,0.22,0));        // stand on the floor
    g.add(box(1.20,0.50,0.54,0x8fd0ff,0,0.71,0,{transparent:true,opacity:0.5,emissive:0x5aa9f0,emissiveIntensity:DARK?0.4:0.2})); // tank
    g.add(box(1.22,0.06,0.56,0x9a86d8,0,0.97,0));        // tank lid
    g.add(sph(0.10,0xff9cc0,-0.20,0.74,0.18)); g.add(sph(0.075,0xffd98a,0.22,0.66,-0.16)); // fish
    g.add(cyl(0.03,0.08,0.26,0x7fce9e,0.42,0.62,0,8));   // water plant
  }
  // The sticker book is always present (not a shop item): a cozy collectible you can tap to open
  // and drag with the rearrange tool. It sits on a little stand so it reads clearly from any angle.
  {
    const g=placedGroup("stickerbook");
    g.userData.pickType="stickerbook";                          // tap (in normal mode) opens the book
    g.add(box(0.62,0.30,0.46,0xe9b079,0,0.15,0));               // warm wooden stand
    g.add(box(0.66,0.05,0.50,0xd79a64,0,0.305,0));              // stand top lip
    const cover=box(0.50,0.085,0.62,0xff9cc0,0.02,0.375,0);     // pink book cover, tilted up on the stand
    cover.rotation.x=-0.32; g.add(cover);
    const pages=box(0.46,0.05,0.58,0xfff3f8,0.04,0.40,0.02);    // cream pages, just proud of the cover
    pages.rotation.x=-0.32; g.add(pages);
    const spine=box(0.07,0.10,0.62,0xe06a8b,-0.20,0.37,0);      // deeper-pink spine
    spine.rotation.x=-0.32; g.add(spine);
    const ribbon=box(0.07,0.015,0.26,0xffd98a,0.12,0.405,0.22); // gold bookmark ribbon peeking out
    ribbon.rotation.x=-0.32; g.add(ribbon);
    const star=cyl(0.075,0.075,0.02,0xffd98a,0.06,0.425,-0.06,5); // little gold star sticker on the cover
    star.rotation.x=-0.32; star.material.emissive.setHex(0xffbf4f); star.material.emissiveIntensity=DARK?0.5:0.22;
    g.add(star);
    g.userData.bookStar=star;                                   // animated gentle twinkle in animate()
    stickerBookGroup=g;
  }
  if(dirLight) dirLight.color.setHex(hasUpgrade("lamp")?0xffdfba:0xffe8d6);
  if(fillLight) fillLight.intensity = hasUpgrade("lamp")?0.38:0.26; // a bought lamp makes the room glow cozier
  clampOrbit(); updateCamera(); applyTheme(DARK);
}

/* ---------- in-room drag arrange mode -------------------------------------- */
let arrangeGridGroup=null, arrangeCells={}, arrangeGhost=null;
export let FLOOR_PLANE=null;
export function arrangeIsOpen(){ return ARRANGE; }
function removeArrangeGrid(){ if(arrangeGridGroup&&scene){ scene.remove(arrangeGridGroup); } arrangeGridGroup=null; arrangeCells={}; arrangeGhost=null; }
function buildArrangeGrid(){
  removeArrangeGrid();
  if(!scene) return;
  arrangeGridGroup=new THREE.Group(); arrangeGridGroup.name="arrange-grid"; scene.add(arrangeGridGroup);
  const spec=currentRoomSpec(), m=gridMargin();
  const cw=(spec.w-m*2)/GRID_COLS, cd=(spec.d-m*2)/GRID_ROWS;
  for(let gz=0; gz<GRID_ROWS; gz++) for(let gx=0; gx<GRID_COLS; gx++){
    const w=gridToWorld(gx,gz), locked=isLocked(gx,gz);
    const tile=new THREE.Mesh(new THREE.BoxGeometry(cw*0.98,0.05,cd*0.98), mat(locked?0x9a92ad:0xcfc4f2,{transparent:true,opacity:locked?0.30:0.18,emissive:locked?0x554f6b:0x7c6ad6,emissiveIntensity:locked?0.10:0.16}));
    tile.position.set(w.x,0.04,w.z);
    tile.userData={tileLocked:locked,baseColor:locked?0x9a92ad:0xcfc4f2,baseEm:locked?0x554f6b:0x7c6ad6,baseOp:locked?0.30:0.18,baseEi:locked?0.10:0.16};
    arrangeGridGroup.add(tile); arrangeCells[gx+","+gz]=tile;
  }
  WALLS.forEach(wall=>{
    const info=wallInfo(wall), usableLen=info.len-WALL_EDGE*2, usableH=wallYHi()-WALL_Y_LO;
    const tw=usableLen/WALL_COLS*0.9, th=usableH/WALL_ROWS*0.9;
    for(let row=0; row<WALL_ROWS; row++) for(let col=0; col<WALL_COLS; col++){
      const w=wallToWorld(wall,col,row,0,0);
      const tile=new THREE.Mesh(new THREE.BoxGeometry(tw,th,0.04), mat(0xcfc4f2,{transparent:true,opacity:0.13,emissive:0x7c6ad6,emissiveIntensity:0.14}));
      tile.position.set(w.x,w.y,w.z); tile.rotation.y=info.rotY; tile.userData={wallGuide:true,wallSide:wall};
      arrangeGridGroup.add(tile);
    }
  });
  arrangeGhost=new THREE.Mesh(new THREE.BoxGeometry(1,1,0.06), mat(0x8fe6b4,{transparent:true,opacity:0.5,emissive:0x34b27b,emissiveIntensity:0.5}));
  arrangeGhost.visible=false; arrangeGridGroup.add(arrangeGhost);
}
export function moveGhost(w,iw,ih,valid){
  if(!arrangeGhost) return;
  if(!w){ arrangeGhost.visible=false; return; }
  arrangeGhost.visible=true;
  arrangeGhost.position.set(w.x,w.y,w.z); arrangeGhost.rotation.y=w.rotY||0;
  arrangeGhost.scale.set(iw||1,ih||1,1);
  arrangeGhost.material.color.setHex(valid?0x8fe6b4:0xff9a9a);
  arrangeGhost.material.emissive.setHex(valid?0x34b27b:0xe05a5a);
}
export function highlightCell(cell,kind){ // kind: 'ok' | 'bad' | null
  Object.entries(arrangeCells).forEach(([k,t])=>{
    const on = cell && k===cell[0]+","+cell[1];
    if(on){
      const good=kind!=="bad";
      t.material.color.setHex(good?0x8fe6b4:0xff9a9a);
      t.material.emissive.setHex(good?0x34b27b:0xe05a5a);
      t.material.emissiveIntensity=0.5; t.material.opacity=0.55;
    }else{
      t.material.color.setHex(t.userData.baseColor); t.material.emissive.setHex(t.userData.baseEm);
      t.material.emissiveIntensity=t.userData.baseEi; t.material.opacity=t.userData.baseOp;
    }
  });
}
export function getArrangeGridGroup(){ return arrangeGridGroup; }
// The caller (ui/settings.js "rearrange" button) is responsible for closing the
// shop overlay first — this module doesn't import ui/panels.js to avoid a cycle.
export function arrangeStart(){
  if(state!=="idle" && state!=="summary"){ toast("Finish with the patient first, then you can redecorate 🛋️"); return; }
  if(!MOVABLE.some(hasUpgrade) && !WALL_MOVABLE.some(hasUpgrade)){ toast("Buy some decor or wall art first, then drag it around 🪴"); return; }
  if(!SS.placements) SS.placements={};
  if(!SS.wallPlace) SS.wallPlace={};
  setArrange(true);
  if(!FLOOR_PLANE) FLOOR_PLANE=new THREE.Plane(new THREE.Vector3(0,1,0),0);
  buildArrangeGrid();
  // pull the camera back for a calm, roomy overview — feels like stepping back to redecorate
  const spec=currentRoomSpec(), toR=Math.min(cameraBounds().maxR, spec.camMax+1.9), toPhi=0.94;
  tweenCamera(toR,toPhi,1.25);
  const bar=document.getElementById("arrangeBar"); if(bar) bar.classList.add("show");
  toast("Step back and make it yours — drag pieces to move them, tap to turn them ✨");
}
export function arrangeStop(){
  setArrange(false); removeArrangeGrid();
  const bar=document.getElementById("arrangeBar"); if(bar) bar.classList.remove("show");
  const b=cameraBounds();
  const toR=Math.max(b.minR,Math.min(b.maxR,orbit.radius)), toPhi=Math.max(b.minPhi,Math.min(b.maxPhi,orbit.phi));
  tweenCamera(toR,toPhi,0.7);
  saveSS();
}
export function arrangeClose(){ arrangeStop(); }
