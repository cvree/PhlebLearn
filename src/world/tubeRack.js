import * as THREE from "three";
import { TUBE_KEYS, TUBES } from "../config.js";
import { box, mat, setRegisterTheme, onThemeChange } from "../rendering/materials.js";
import { DARK } from "../game/gameState.js";

export let tubeMeshes = [];
let rackBaseY = 0;

export function buildTubeRack(scene){
  // Small front table for tube practice, front and center as offices expand.
  const rackZ=2.7;
  scene.add(box(2.72,0.82,0.98,0xdfd3ec,0,0.41,rackZ));
  scene.add(box(2.92,0.13,1.14,0xd0bbe8,0,0.89,rackZ));
  const rack=box(2.62,0.42,0.62,0xb79fe0,0,1.22,rackZ); scene.add(rack);
  rackBaseY=1.36;
  tubeMeshes=[];
  setRegisterTheme(false);            // tubes keep their exact colors, never themed
  TUBE_KEYS.forEach((key,i)=>{
    const t=TUBES[key];
    const g=new THREE.Group();
    const body=new THREE.Mesh(new THREE.CylinderGeometry(0.15,0.15,0.68,14),
      new THREE.MeshStandardMaterial({color:0xeaf2fb,roughness:0.25,metalness:0.0,transparent:true,opacity:0.55,flatShading:true}));
    body.position.y=0.34; body.castShadow=true;
    const label=new THREE.Mesh(new THREE.CylinderGeometry(0.158,0.158,0.18,14),
      new THREE.MeshStandardMaterial({color:0xfbfdff,roughness:0.9,flatShading:true}));
    label.position.y=0.28;
    const cap=new THREE.Mesh(new THREE.CylinderGeometry(0.17,0.155,0.24,14),mat(t.color));
    cap.position.y=0.80; cap.castShadow=true;
    const capTop=new THREE.Mesh(new THREE.SphereGeometry(0.17,12,8),mat(t.color));
    capTop.position.y=0.91; capTop.scale.y=0.5;
    g.add(body); g.add(label); g.add(cap); g.add(capTop);
    g.position.set(-1.22+i*0.35,rackBaseY,rackZ);
    g.userData={pickType:"tube",tubeKey:key,tubeColor:t.color,baseY:rackBaseY,selected:false,caps:[cap,capTop]};
    scene.add(g); tubeMeshes.push(g);
    setTubeEmissive(g);
  });
  setRegisterTheme(true);
}

// the cap is the identifier, glow it in dark mode; brighter when selected
export function setTubeEmissive(g){
  const base = DARK?0.5:0.0;
  const lvl = g.userData.selected ? base+0.55 : base;
  (g.userData.caps||[]).forEach(m=>{ if(m.material&&m.material.emissive){ m.material.emissive.setHex(g.userData.tubeColor); m.material.emissiveIntensity=lvl; } });
}
onThemeChange(()=>{ tubeMeshes.forEach(setTubeEmissive); });

export function resetTubeSelection(){
  tubeMeshes.forEach(g=>{ g.userData.selected=false; g.position.y=g.userData.baseY; setTubeEmissive(g); });
}
export function toggleTubeMesh(g){
  g.userData.selected=!g.userData.selected;
  g.position.y=g.userData.baseY+(g.userData.selected?0.35:0);
  setTubeEmissive(g);
  return g.userData.selected;
}
