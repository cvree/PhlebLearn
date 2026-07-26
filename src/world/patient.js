import * as THREE from "three";
import { box, sph, cyl, mat, setRegisterTheme } from "../rendering/materials.js";
import { makeAppearance } from "../game/encounter.js";

export let patientGroup = null;
export let mascot = null;

// >0 happy bounce, <0 sad squash, decays each frame in animate()
export let mascotReact = 0;
export function reactMascot(k){ if(k==="good"||k==="coin"||k==="win")mascotReact=1; else if(k==="bad")mascotReact=-1; }
export function decayMascotReact(){ mascotReact*=0.90; if(Math.abs(mascotReact)<0.01)mascotReact=0; }

function buildHair(group,a,headR,hy){
  const hc=a.hairColor, ac=a.accent;
  // domes are raised and pulled back so headwear caps the crown well above the eyes (no brow-covering)
  const dome=(rF,col,yOff,zOff,sy)=>{ const m=sph(headR*rF,col,0,hy+headR*yOff,headR*zOff); m.scale.set(1,sy||0.9,1); group.add(m); return m; };
  switch(a.hair){
    case "bald": break;
    case "buzz": dome(1.04,hc,0.34,-0.06,0.70); break;
    case "short": dome(1.06,hc,0.38,-0.08,0.80); break;
    case "long":
      dome(1.06,hc,0.40,-0.10,0.86);
      group.add(box(headR*1.7,headR*1.9,headR*0.45,hc,0,hy-headR*0.28,-headR*0.6));
      group.add(box(headR*0.42,headR*1.5,headR*0.62,hc,-headR*0.98,hy-headR*0.16,0));
      group.add(box(headR*0.42,headR*1.5,headR*0.62,hc, headR*0.98,hy-headR*0.16,0)); break;
    case "bun": dome(1.05,hc,0.40,-0.08,0.84); group.add(sph(headR*0.4,hc,0,hy+headR*1.12,-headR*0.20)); break;
    case "ponytail":
      dome(1.05,hc,0.40,-0.08,0.84);
      { const pt=cyl(headR*0.22,headR*0.13,headR*1.3,hc,0,hy+headR*0.12,-headR*0.95,8); pt.rotation.x=0.3; group.add(pt); } break;
    case "afro": { const m=sph(headR*1.32,hc,0,hy+headR*0.54,-headR*0.48); m.scale.set(1.05,1.06,1.05); group.add(m); } break;
    case "cap":
      dome(1.05,ac,0.42,-0.08,0.74);
      group.add(box(headR*1.25,headR*0.16,headR*0.85,ac,0,hy+headR*0.32,headR*0.74)); break;
    case "beanie":
      { const m=sph(headR*1.10,ac,0,hy+headR*0.48,-headR*0.06); m.scale.set(1,0.9,1); group.add(m);
        group.add(cyl(headR*1.08,headR*1.08,headR*0.20,ac,0,hy+headR*0.36,0,12)); } break;
    case "hijab":
      { const m=sph(headR*1.14,ac,0,hy+headR*0.30,-headR*0.40); m.scale.set(1.05,1.05,1.05); group.add(m);
        group.add(box(headR*1.9,headR*1.1,headR*1.5,ac,0,hy-headR*0.95,-headR*0.15)); } break;
  }
}

export function spawnPatient(scene, p){
  removePatient(scene);
  setRegisterTheme(false);
  const a=p.appearance||makeAppearance(p.ageCat||"Adult");
  patientGroup=new THREE.Group();
  const wS=a.width, hS=a.height, bottom=0.30;
  const bodyLen=1.3*hS, bodyCY=bottom+bodyLen/2;
  // body is added FIRST so the breathing animation (children[0]/userData.body) targets it
  const body=cyl(0.42*wS,0.5*wS,bodyLen,p.shirt,0,bodyCY,0,12);
  patientGroup.add(body);
  const headR=0.4*(0.9+0.18*hS);
  const headY=bottom+bodyLen+headR*0.72;
  const head=sph(headR,a.skin,0,headY,0); head.scale.set(1,1.08,1); patientGroup.add(head); // slightly taller head = more face room
  // eyes sit in the lower-middle of the face so hats/hair have forehead room above them
  const eyeZ=headR*0.85, eyeX=headR*0.32, eyeY=headY-headR*0.05, eyeR=headR*0.135;
  [-1,1].forEach(s=>{
    patientGroup.add(sph(eyeR,0x3a2f55,s*eyeX,eyeY,eyeZ));
    patientGroup.add(sph(eyeR*0.34,0xffffff,s*eyeX-0.03,eyeY+eyeR*0.45,eyeZ+0.03)); // catchlight = friendly, not blank
  });
  // hair / headwear
  buildHair(patientGroup,a,headR,headY);
  // facial hair (adults)
  if(a.facial==="beard"){ const b=sph(headR*0.74,a.hairColor,0,headY-headR*0.44,headR*0.5); b.scale.set(1,0.72,0.6); patientGroup.add(b); }
  else if(a.facial==="mustache"){ patientGroup.add(box(headR*0.5,headR*0.12,0.06,a.hairColor,0,headY-headR*0.16,eyeZ)); }
  else if(a.facial==="stubble"){ const b=sph(headR*0.7,a.hairColor,0,headY-headR*0.4,headR*0.55); b.scale.set(1,0.5,0.5); b.material.transparent=true; b.material.opacity=0.45; patientGroup.add(b); }
  // glasses: translucent lenses + dark bridge, so the eyes still show through
  if(a.glasses){
    const lensL=sph(headR*0.17,0xbfe0ff,-eyeX,eyeY,eyeZ+0.02); lensL.scale.set(1,1,0.4); lensL.material.transparent=true; lensL.material.opacity=0.5; patientGroup.add(lensL);
    const lensR=sph(headR*0.17,0xbfe0ff, eyeX,eyeY,eyeZ+0.02); lensR.scale.set(1,1,0.4); lensR.material.transparent=true; lensR.material.opacity=0.5; patientGroup.add(lensR);
    patientGroup.add(box(eyeX*0.8,headR*0.05,0.04,0x2a2440,0,eyeY,eyeZ+0.04));
  }
  [body,head].forEach(m=>{m.material.emissive.setHex(m===head?a.skin:p.shirt);m.material.emissiveIntensity=0.12;});
  patientGroup.position.set(1.35,0.0,0.35);
  patientGroup.userData={pickType:"patient",body};
  scene.add(patientGroup);
  setRegisterTheme(true);
  return patientGroup;
}
export function removePatient(scene){ if(patientGroup){scene.remove(patientGroup);patientGroup=null;} }

export function buildMascot(scene){
  setRegisterTheme(false);
  mascot=new THREE.Group();
  const dotPink=0xff9cc0, dotDeep=0xff7fb0;
  const aura=sph(0.58,0xffd0e4,0,0,0); aura.material.transparent=true; aura.material.opacity=0.20; aura.material.emissive.setHex(dotPink); aura.material.emissiveIntensity=0.6; aura.castShadow=false;
  const body=sph(0.45,dotPink,0,0,0); body.scale.set(1.05,0.92,1.0); body.material.emissive.setHex(dotDeep); body.material.emissiveIntensity=0.30;
  const shine=sph(0.13,0xffffff,-0.17,0.20,0.33); shine.material.transparent=true; shine.material.opacity=0.6; shine.castShadow=false;
  const stem=cyl(0.022,0.045,0.20,dotDeep,0,0.52,0,8);
  const bud=sph(0.075,0xffd98a,0,0.64,0); bud.material.emissive.setHex(0xffbf6f); bud.material.emissiveIntensity=0.45;
  const eyeL=sph(0.105,0x3a2f55,-0.165,0.06,0.36), eyeR=sph(0.105,0x3a2f55,0.165,0.06,0.36);
  const cL=sph(0.038,0xffffff,-0.20,0.11,0.43), cR=sph(0.038,0xffffff,0.13,0.11,0.43); cL.castShadow=false; cR.castShadow=false;
  const chL=sph(0.072,0xff85ad,-0.28,-0.06,0.27), chR=sph(0.072,0xff85ad,0.28,-0.06,0.27);
  [chL,chR].forEach(c=>{c.material.transparent=true;c.material.opacity=0.6;c.castShadow=false;});
  const smile=new THREE.Mesh(new THREE.TorusGeometry(0.11,0.02,8,18,Math.PI), mat(0x6e2f49)); smile.position.set(0,-0.03,0.40); smile.rotation.z=Math.PI; smile.castShadow=false;
  const armL=sph(0.085,dotPink,-0.43,-0.05,0.05), armR=sph(0.085,dotPink,0.43,-0.05,0.05);
  [aura,body,shine,stem,bud,eyeL,eyeR,cL,cR,chL,chR,smile,armL,armR].forEach(m=>mascot.add(m));
  mascot.position.set(-2.3,1.7,2.7); mascot.scale.set(0.52,0.52,0.52);
  mascot.userData={pickType:"mascot", eyes:[eyeL,eyeR], arms:[armL,armR]};
  scene.add(mascot);
  setRegisterTheme(true);
  return mascot;
}
