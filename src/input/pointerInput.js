/* Drag-to-arrange input: grabbing a floor/wall decor piece, dragging it to a
   new cell or wall slot, and dropping (or tapping in place to rotate it). */
import { sfx } from "../audio/audioManager.js";
import { pickArrangeItem, pointerToWallTarget, pointerToFloor } from "./raycasting.js";
import {
  wallDims, wallToWorld, wallOverlapAt, wallPlaceOf, rotateWallItem, placeWallItem,
  clampFloorWorld, worldToGrid, placementCheck, itemAtCell, placeItem, rotateFloorItem,
  placementOf, highlightCell, moveGhost, itemRadiusOf, updateRoomUpgrades
} from "../world/room.js";
import { WALL_COLS, WALL_ROWS } from "../config.js";

export function createArrangeDragHandlers(canvasEl, getUpgradeGroup){
  let draggingItem=null, dragId=null, dragKind=null, dragOrig=null, hoverCell=null, hoverWall=null, hoverCol=0, hoverRow=0;
  let itemDownX=0, itemDownY=0;

  function tryGrab(e){
    const hit=pickArrangeItem(e, canvasEl, getUpgradeGroup());
    if(!hit) return false;
    draggingItem=hit.group; dragId=hit.id; dragKind=hit.kind;
    itemDownX=e.clientX; itemDownY=e.clientY;
    dragOrig = hit.kind==="wall" ? wallPlaceOf(dragId).slice() : placementOf(dragId).slice();
    try{ canvasEl.setPointerCapture(e.pointerId); }catch(_){}
    sfx("tap");
    return true;
  }

  function onMove(e){
    if(!draggingItem) return false;
    if(dragKind==="wall"){
      const m=wallDims(dragId);
      const tgt=pointerToWallTarget(e, canvasEl, WALL_COLS, WALL_ROWS);
      if(tgt){
        const w=wallToWorld(tgt.wall,tgt.col,tgt.row,m.w,m.h);
        draggingItem.position.set(w.x,w.y,w.z); draggingItem.rotation.set(0,w.rotY,0);
        hoverWall=tgt.wall; hoverCol=tgt.col; hoverRow=tgt.row;
        highlightCell(null); moveGhost(w,m.w,m.h,!wallOverlapAt(dragId,tgt.wall,tgt.col,tgt.row));
      }
    }else{
      const pt=pointerToFloor(e, canvasEl);
      if(pt){
        const c=clampFloorWorld(dragId,pt.x,pt.z);
        const cell=worldToGrid(c.x,c.z); hoverCell=cell;
        const chk=placementCheck(dragId,cell[0],cell[1],itemAtCell(cell[0],cell[1]));
        const restY = chk.ok ? chk.y : 0;
        draggingItem.position.set(c.x,restY+0.12,c.z);
        highlightCell(cell, chk.ok?"ok":"bad");
      }
    }
    return true;
  }

  function onUp(e){
    if(!draggingItem) return false;
    try{ canvasEl.releasePointerCapture(e.pointerId); }catch(_){}
    // a tap (pointer barely moved) rotates the piece 90°; a real drag places it
    const tap = Math.hypot(e.clientX-itemDownX, e.clientY-itemDownY) < 8;
    if(tap){
      const id=dragId, kind=dragKind;
      highlightCell(null); moveGhost(null);
      draggingItem=null; dragId=null; dragKind=null; hoverCell=null; hoverWall=null;
      if(kind==="wall") rotateWallItem(id); else rotateFloorItem(id);
      return true;
    }
    let ok;
    if(dragKind==="wall"){ ok=placeWallItem(dragId,hoverWall||dragOrig[0],hoverWall?hoverCol:dragOrig[1],hoverWall?hoverRow:dragOrig[2]); }
    else { const cell=hoverCell||dragOrig; ok=placeItem(dragId,cell[0],cell[1]); }
    if(ok){ sfx("good"); } else { updateRoomUpgrades(); sfx("bad"); }
    highlightCell(null); moveGhost(null); draggingItem=null; dragId=null; dragKind=null; hoverCell=null; hoverWall=null;
    return true;
  }

  function isDragging(){ return !!draggingItem; }

  return { tryGrab, onMove, onUp, isDragging };
}
