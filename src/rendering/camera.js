/* Camera + orbit controls math. Everything here is about where the camera
   sits relative to the room; wall-fade-on-orbit (which walls need to fade)
   is a world/room.js concern that reads `orbit`/normAngle() from here — the
   dependency arrow points world -> rendering, never the reverse, so this
   file must not import anything from world/. */
import * as THREE from "three";
import { currentRoomSpec } from "../game/progression.js";
import { ARRANGE } from "../game/gameState.js";

let camera=null;
export const orbit = {radius:9.5, theta:0.62, phi:1.04, target:null};

export function createCamera(){
  camera=new THREE.PerspectiveCamera(52,innerWidth/innerHeight,0.1,100);
  orbit.target=new THREE.Vector3(0,1.18,0.25);
  return camera;
}
export function getCamera(){ return camera; }

export function normAngle(a){
  const tau=Math.PI*2;
  return ((a+Math.PI)%tau+tau)%tau-Math.PI;
}
// Kept for compatibility with older helper logic. The full cutaway system in
// world/room.js now updates every wall continuously as the player rotates 360°.
export function isFrontViewingAngle(theta){ return Math.sin(theta)>0.32; }
export function smoothStep(edge0,edge1,x){
  const t=Math.max(0,Math.min(1,(x-edge0)/(edge1-edge0)));
  return t*t*(3-2*t);
}
export function wallCameraDot(side,theta){
  const cx=Math.cos(theta), cz=Math.sin(theta);
  if(side==="front") return cz;       // camera is on patient/front side (+Z)
  if(side==="back") return -cz;       // camera is behind the back wall (-Z)
  if(side==="right") return cx;       // camera is on right side (+X)
  if(side==="left") return -cx;       // camera is on left side (-X)
  return -1;
}
// Fade the two walls closest to the camera, not just the patient/front wall.
// This makes the room feel like a rotating dollhouse: the two unseen/foreground
// walls become a soft cutaway, while the opposite walls stay solid.
export function wallOpacityForSide(side,theta){
  const strength=smoothStep(-0.05,0.55,wallCameraDot(side,theta));
  const minOpacity=0.12;
  return 1-(1-minOpacity)*strength;
}
export function maxRadiusInsideRoom(spec,theta,phi){
  const tx=spec.target.x, tz=spec.target.z;
  const halfW=spec.w/2, halfD=spec.d/2, margin=0.34;
  const sx=Math.cos(theta), sz=Math.sin(theta);
  const sinPhi=Math.max(0.2,Math.sin(phi||1.04));
  let limits=[];
  if(sx>0.02) limits.push((halfW-margin-tx)/sx);
  if(sx<-0.02) limits.push((-halfW+margin-tx)/sx);
  if(sz>0.02) limits.push((halfD-margin-tz)/sz);
  if(sz<-0.02) limits.push((-halfD+margin-tz)/sz);
  const hLimit=Math.max(1.8,Math.min.apply(null,limits.filter(v=>isFinite(v)&&v>0)));
  return hLimit/sinPhi;
}
export function cameraBounds(){
  const spec=currentRoomSpec();
  // Arrange mode gives more vertical freedom and a little extra pull-back so it's
  // easy to look up at the walls and down at the floor while placing things.
  const maxR=ARRANGE ? spec.camMax+2.2 : spec.camMax;
  return {minR:spec.camMin,maxR:Math.max(spec.camMin+0.25,maxR),minPhi:ARRANGE?0.42:0.68,maxPhi:ARRANGE?1.48:1.31};
}
export function clampOrbit(){
  if(!orbit) return;
  orbit.theta=normAngle(orbit.theta); // full 360 degrees, just wrapped for stable math.
  const spec=currentRoomSpec();
  if(orbit.target&&orbit.target.set) orbit.target.set(spec.target.x,spec.target.y,spec.target.z);
  const b=cameraBounds();
  orbit.phi=Math.max(b.minPhi,Math.min(b.maxPhi,orbit.phi));
  orbit.radius=Math.max(b.minR,Math.min(b.maxR,orbit.radius));
}
export function setDefaultOrbit(){
  const spec=currentRoomSpec();
  orbit.theta=0.68; orbit.phi=1.04; orbit.radius=Math.min(6.45,spec.camMax);
  if(orbit.target&&orbit.target.set) orbit.target.set(spec.target.x,spec.target.y,spec.target.z);
  clampOrbit();
}
// smooth camera glide (used for the rearrange-mode zoom-out)
let camTween=null;
export function easeInOut(x){ return x<0.5 ? 4*x*x*x : 1-Math.pow(-2*x+2,3)/2; }
export function tweenCamera(toR,toPhi,dur){ if(!orbit) return; camTween={t:0,dur:dur||0.9,fromR:orbit.radius,toR:toR,fromPhi:orbit.phi,toPhi:toPhi}; }
export function tickCamTween(dt){
  if(!camTween||!orbit) return;
  camTween.t=Math.min(1, camTween.t + (dt||0)/camTween.dur);
  const e=easeInOut(camTween.t);
  orbit.radius=camTween.fromR+(camTween.toR-camTween.fromR)*e;
  orbit.phi  =camTween.fromPhi+(camTween.toPhi-camTween.fromPhi)*e;
  updateCamera();
  if(camTween.t>=1) camTween=null;
}
export function updateCamera(){
  clampOrbit();
  const s=orbit;
  const x=s.target.x+s.radius*Math.sin(s.phi)*Math.cos(s.theta);
  const y=s.target.y+s.radius*Math.cos(s.phi);
  const z=s.target.z+s.radius*Math.sin(s.phi)*Math.sin(s.theta);
  camera.position.set(x,y,z); camera.lookAt(s.target);
}
