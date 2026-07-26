/* Owns the THREE.Scene itself. World-building (room/furniture/patient/tubes)
   lives in world/ and adds its objects to the scene this module returns. */
import * as THREE from "three";

let scene=null;

export function createScene(){
  scene=new THREE.Scene();
  scene.background=new THREE.Color(0xb9c4e8);   // calm dusk lavender-blue, not white
  scene.fog=new THREE.Fog(0xb9c4e8,12,28);
  return scene;
}
export function getScene(){ return scene; }
