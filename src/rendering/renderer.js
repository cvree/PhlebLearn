import * as THREE from "three";

let renderer=null;

/**
 * How many device pixels to actually draw per CSS pixel.
 *
 * A phone reporting devicePixelRatio 3 asks for NINE times the fragments of a
 * 1x screen, and this scene is fragment-bound: translucent skin over vessel
 * geometry, soft shadows, a tone-mapped pass. Capping at 2 was already an
 * improvement over rendering native; capping the small-screen case harder is
 * what takes a mid-range phone from ~30fps to a steady 60, and at these
 * physical pixel densities the difference is not visible.
 */
export function pixelRatioCap(){
  const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
  const small = typeof innerWidth === "number" && innerWidth < 900;
  return Math.min(dpr, small ? 1.6 : 2);
}

export function createRenderer(){
  renderer=new THREE.WebGLRenderer({ antialias:true, powerPreference:"high-performance" });
  renderer.setPixelRatio(pixelRatioCap());
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
  // Re-applied on resize: rotating a phone, or dragging a window between a
  // laptop screen and an external monitor, changes which cap applies.
  renderer.setPixelRatio(pixelRatioCap());
  renderer.setSize(innerWidth,innerHeight);
}
