import * as THREE from "three";

let renderer=null;

export function createRenderer(){
  renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setSize(innerWidth,innerHeight);
  // proper color management so pastels stay rich instead of clipping to white
  // (outputEncoding/sRGBEncoding were removed from modern three.js in favor of outputColorSpace)
  if(THREE.SRGBColorSpace!==undefined)renderer.outputColorSpace=THREE.SRGBColorSpace;
  if(THREE.ACESFilmicToneMapping!==undefined)renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=0.92;
  renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  return renderer;
}
export function getRenderer(){ return renderer; }
export function resizeRenderer(camera){
  camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
}
