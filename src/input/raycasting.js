/* Pure ray-intersection helpers: given a pointer event, what 3D object (if
   any) does it hit? Dispatch (what that hit *means*) lives in main.js. */
import * as THREE from "three";
import { getCamera } from "../rendering/camera.js";
import { orbit } from "../rendering/camera.js";
import { WALLS } from "../config.js";
import { wallInfo, wallYHi, FLOOR_PLANE } from "../world/room.js";
import { wallOpacityForSide } from "../rendering/camera.js";
import { WALL_EDGE, WALL_Y_LO } from "../config.js";

export const raycaster = new THREE.Raycaster();
export const pointer = new THREE.Vector2();

function setPointerFromEvent(e, canvasEl){
  const r=canvasEl.getBoundingClientRect();
  pointer.x=((e.clientX-r.left)/r.width)*2-1;
  pointer.y=-((e.clientY-r.top)/r.height)*2+1;
  raycaster.setFromCamera(pointer, getCamera());
}

export function pickArrangeItem(e, canvasEl, upgradeGroup){
  if(!upgradeGroup) return null;
  setPointerFromEvent(e, canvasEl);
  const hits=raycaster.intersectObjects(upgradeGroup.children,true);
  for(const h of hits){
    let o=h.object;
    while(o && o.userData.movableId===undefined && o.userData.wallId===undefined) o=o.parent;
    if(o&&o.userData.movableId!==undefined) return {kind:"floor",group:o,id:o.userData.movableId};
    if(o&&o.userData.wallId!==undefined) return {kind:"wall",group:o,id:o.userData.wallId};
  }
  return null;
}

// project the pointer onto whichever wall it's aimed at, returning a snapped {wall,col,row}
export function pointerToWallTarget(e, canvasEl, WALL_COLS, WALL_ROWS){
  setPointerFromEvent(e, canvasEl);
  let best=null;
  const theta=orbit?orbit.theta:0;
  WALLS.forEach(wall=>{
    // skip the cutaway / see-through walls nearest the camera so art lands on the wall you can actually see
    if(wallOpacityForSide(wall,theta) < 0.45) return;
    const info=wallInfo(wall);
    const n = info.axis==="x" ? new THREE.Vector3(0,0,1) : new THREE.Vector3(1,0,0);
    const plane=new THREE.Plane(n, -info.fixed);
    const pt=new THREE.Vector3();
    if(!raycaster.ray.intersectPlane(plane,pt)) return;
    const along = info.axis==="x" ? pt.x : pt.z;
    if(Math.abs(along) > info.len/2-WALL_EDGE*0.5) return;
    if(pt.y < WALL_Y_LO-0.6 || pt.y > wallYHi()+0.6) return;
    const dist=raycaster.ray.origin.distanceTo(pt);
    if(!best || dist<best.dist){
      const usableLen=info.len-WALL_EDGE*2, usableH=wallYHi()-WALL_Y_LO;
      let col=Math.round((along+usableLen/2)/(usableLen/WALL_COLS)-0.5);
      let row=Math.round((pt.y-WALL_Y_LO)/(usableH/WALL_ROWS)-0.5);
      best={wall, col:Math.max(0,Math.min(WALL_COLS-1,col)), row:Math.max(0,Math.min(WALL_ROWS-1,row)), dist};
    }
  });
  return best;
}

export function pointerToFloor(e, canvasEl){
  if(!FLOOR_PLANE) return null;
  setPointerFromEvent(e, canvasEl);
  const pt=new THREE.Vector3();
  return raycaster.ray.intersectPlane(FLOOR_PLANE,pt) ? pt : null;
}

// Returns {data, obj} for the first pickable ancestor under the pointer, or null.
export function pickAt(e, canvasEl, scene){
  setPointerFromEvent(e, canvasEl);
  const hits=raycaster.intersectObjects(scene.children,true);
  for(const h of hits){
    let o=h.object;
    while(o && !o.userData.pickType) o=o.parent;
    if(o && o.userData.pickType) return {data:o.userData, obj:o};
  }
  return null;
}
