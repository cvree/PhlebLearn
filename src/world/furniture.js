import { box } from "../rendering/materials.js";
import { buildSharpsBin } from "./sharpsBin.js";

export function buildFurniture(scene){
  // Vertical room: the work flows front-to-back. Phlebotomist station runs down the left side,
  // patient chair sits center-right, supplies behind, sharps tucked in the back-left corner.
  // Work counter + monitor (left side, within easy reach of the chair).
  scene.add(box(2.25,0.72,0.92,0xc5bfcd,-2.45,0.36,1.55));
  scene.add(box(2.45,0.12,1.05,0xb8b0c2,-2.45,0.78,1.55));
  const screen=box(1.0,0.58,0.08,0x2a2440,-2.45,1.30,1.35);
  scene.add(box(0.32,0.23,0.14,0x9993aa,-2.45,0.95,1.35));
  const glow=box(0.86,0.42,0.035,0x9fc7df,-2.45,1.30,1.40,{emissive:0x5aa9f0,emissiveIntensity:0.18});
  glow.userData={pickType:"screen"}; scene.add(screen); scene.add(glow);

  // Plain patient chair, center-right, facing the camera. Comfy upgrade layers cushions on top.
  scene.add(box(0.52,0.28,0.52,0xb0a9bd,1.35,0.14,-0.05));   // pedestal so the chair rests on the floor
  scene.add(box(0.9,0.06,0.9,0xa79fb6,1.35,0.02,-0.05));     // foot plate
  scene.add(box(1.18,0.38,1.12,0xbeb8c6,1.35,0.47,-0.05));
  scene.add(box(1.18,1.05,0.24,0xb5aebf,1.35,1.12,-0.56));
  scene.add(box(0.18,0.40,1.0,0xb5aebf,0.72,0.86,-0.05));
  scene.add(box(0.18,0.40,1.0,0xb5aebf,1.98,0.86,-0.05));

  // Supply stand behind the chair on the right, within reach.
  scene.add(box(0.95,0.94,0.68,0xc7d2cc,2.7,0.47,-1.7));
  scene.add(box(1.02,0.08,0.75,0xb4c2bb,2.7,0.96,-1.7));
  scene.add(box(1.02,0.08,0.75,0xb4c2bb,2.7,0.55,-1.7));
  scene.add(box(0.46,0.20,0.36,0xded9e8,2.65,1.06,-1.7));    // tote resting on the supply shelf

  // Reagent tray sitting on the desk (not floating in mid-air).
  scene.add(box(0.56,0.30,0.44,0xc8bad8,-2.45,0.99,1.80));
  scene.add(box(0.46,0.045,0.36,0xf3ead2,-2.45,1.17,1.80));

  buildSharpsBin(scene);
}
