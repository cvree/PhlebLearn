/* Orbit-drag rotate + wheel zoom for the room camera. `onChange` is supplied
   by main.js and typically re-runs updateRoomWallVisibility() — that call
   lives in world/room.js, which this module must not import directly. */
import { orbit, updateCamera, cameraBounds, getCamera } from "../rendering/camera.js";
import { resizeRenderer } from "../rendering/renderer.js";

// Returns handlers the caller wires onto pointerdown/pointermove/pointerup,
// and a flag object reporting whether an orbit-drag is in progress (so the
// caller can skip picking on drag-release).
export function createOrbitControls(canvasEl, onChange){
  const dragState = { dragging:false, moved:false };
  let lastX=0, lastY=0;

  function onPointerDown(e){
    dragState.dragging=true; dragState.moved=false; lastX=e.clientX; lastY=e.clientY;
  }
  function onPointerMove(e){
    if(!dragState.dragging) return;
    const dx=e.clientX-lastX, dy=e.clientY-lastY;
    if(Math.abs(dx)+Math.abs(dy)>4) dragState.moved=true;
    orbit.theta-=dx*0.006; orbit.phi=orbit.phi-dy*0.005;
    lastX=e.clientX; lastY=e.clientY;
    updateCamera(); if(onChange) onChange();
  }
  function onPointerUp(){
    dragState.dragging=false;
  }
  function onWheel(e){
    const b=cameraBounds();
    orbit.radius=Math.max(b.minR,Math.min(b.maxR,orbit.radius+e.deltaY*0.008));
    updateCamera(); if(onChange) onChange();
  }
  function onResize(){
    resizeRenderer(getCamera());
  }
  canvasEl.addEventListener("wheel",onWheel,{passive:true});
  addEventListener("resize",onResize);

  return { dragState, onPointerDown, onPointerMove, onPointerUp };
}
