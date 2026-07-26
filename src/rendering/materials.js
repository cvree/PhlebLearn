/* Mesh-building helpers + the light/dark theme system. World-layer modules
   (room, furniture, patient, tube rack) call box()/cyl()/sph() to build
   meshes and get automatic theme registration for free.

   Theme changes ripple into world objects (e.g. tube emissive glow) that
   this module must not import directly (materials sits below world in the
   dependency order). Instead it exposes onThemeChange() so world modules can
   subscribe, keeping the dependency arrow pointing the right way. */
import * as THREE from "three";
import { getScene } from "./scene.js";
import { tuneLightsForTheme } from "./lighting.js";
import { DARK, setDark } from "../game/gameState.js";
import { hasUpgrade } from "../game/progression.js";
import { sfx } from "../audio/audioManager.js";

export let THEMED=[];               // room/furniture meshes that recolor with theme (NOT tubes)
export let REGISTER_THEME=true;     // when false, meshes built are excluded from theming
export function setRegisterTheme(v){ REGISTER_THEME=v; }

export function mat(color,opts){return new THREE.MeshStandardMaterial(Object.assign({color,roughness:0.85,metalness:0.05,flatShading:true},opts||{}));}
export function regTheme(m,color){ if(REGISTER_THEME){ m.userData.themeLight=color; m.userData.themeDark=darken(color); THEMED.push(m);} return m; }
export function box(w,h,d,color,x,y,z,o){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat(color,o));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;regTheme(m,color);return m;}
export function cyl(rt,rb,h,color,x,y,z,seg){const m=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg||10),mat(color));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;regTheme(m,color);return m;}
export function sph(r,color,x,y,z){const m=new THREE.Mesh(new THREE.SphereGeometry(r,10,7),mat(color));m.position.set(x,y,z);m.castShadow=true;regTheme(m,color);return m;}

// derive a deep, muted version of a color for the dark room
export function darken(hex){
  const c=new THREE.Color(hex), hsl={}; c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s*0.55, Math.max(0.05, hsl.l*0.20));
  return c;
}

export const THEME_BG={light:0xb9c4e8, dark:0x141221};

const themeListeners=[];
export function onThemeChange(fn){ themeListeners.push(fn); }

export function applyTheme(dark){
  setDark(dark);
  const scene=getScene();
  // recolor every themed (non-tube) surface
  THEMED.forEach(m=>{
    if(!m.material||!m.material.color)return;
    if(dark && m.userData.themeDark) m.material.color.copy(m.userData.themeDark);
    else if(m.userData.themeLight!=null) m.material.color.set(m.userData.themeLight);
  });
  // background + fog
  if(scene){
    if(scene.background&&scene.background.set) scene.background.set(dark?THEME_BG.dark:THEME_BG.light);
    if(scene.fog&&scene.fog.color&&scene.fog.color.set) scene.fog.color.set(dark?THEME_BG.dark:THEME_BG.light);
  }
  tuneLightsForTheme(dark, hasUpgrade("lamp"));
  const b=document.getElementById("themeBtn"); if(b) b.textContent = dark?"☀️ Light":"🌙 Dark";
  themeListeners.forEach(fn=>{ try{ fn(dark); }catch(e){} });
}
export function toggleTheme(){ applyTheme(!DARK); sfx("tap"); }
