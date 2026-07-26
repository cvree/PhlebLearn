import { box } from "../rendering/materials.js";

// Tucked into the back-left corner of the room, near the desk.
export function buildSharpsBin(scene){
  const bin=box(0.72,0.74,0.72,0xb9c8dc,-2.7,0.37,-1.9); bin.userData={pickType:"bin"}; scene.add(bin);
  scene.add(box(0.78,0.08,0.78,0xa9b9d0,-2.7,0.78,-1.9));
  return bin;
}
