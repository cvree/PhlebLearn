import * as THREE from "three";

export let hemiLight, ambLight, dirLight, fillLight;

export function createLighting(scene){
  // lights, soft and cozy (dialed WAY down so nothing blows out to white)
  hemiLight=new THREE.HemisphereLight(0xfdf0ff,0x8f7fb0,0.42); scene.add(hemiLight);
  ambLight=new THREE.AmbientLight(0xffffff,0.18); scene.add(ambLight);
  dirLight=new THREE.DirectionalLight(0xffe8d6,0.55);
  dirLight.position.set(6,11,6); dirLight.castShadow=true;
  dirLight.shadow.mapSize.set(1024,1024); dirLight.shadow.camera.near=1; dirLight.shadow.camera.far=40;
  dirLight.shadow.camera.left=-14;dirLight.shadow.camera.right=14;dirLight.shadow.camera.top=14;dirLight.shadow.camera.bottom=-14;
  scene.add(dirLight);
  // a soft warm fill pooled over the chair/desk area for a cozy, lamplit feel (no shadow = cheap)
  fillLight=new THREE.PointLight(0xffd2a6, 0.26, 24, 2); fillLight.position.set(-0.6,4.0,1.8); fillLight.castShadow=false; scene.add(fillLight);
  return {hemiLight,ambLight,dirLight,fillLight};
}

// called from materials.js's applyTheme() and from room.js when the lamp upgrade is bought
export function tuneLightsForTheme(dark, warmBonus){
  const warm = warmBonus ? 0.18 : 0;
  if(hemiLight) hemiLight.intensity = (dark?0.16:0.42) + warm*0.45;
  if(ambLight)  ambLight.intensity  = (dark?0.07:0.18) + warm*0.25;
  if(dirLight)  dirLight.intensity  = (dark?0.30:0.55) + warm;
}
