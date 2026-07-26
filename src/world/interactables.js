/* Declares which pickType (tagged on a mesh's userData by whichever world/
   module built it — tubeRack, patient, sharpsBin, room's screen prop, mascot,
   stickerbook) is meaningful in which game-state screen. The raycaster
   (input/raycasting.js) finds *what* was hit; this module says whether that
   hit currently *means* anything; the actual response (open an overlay,
   toggle a tube, show a toast) is decided in main.js, which is the only
   place allowed to import both input/ and ui/. */
export const INTERACTABLE_STATES = {
  tube: ["select"],
  patient: ["arrive"],
  screen: ["review"],
  bin: ["handle"],
  mascot: null,        // null = always interactable, regardless of screen
  shop: null,
  stickerbook: null,
};

export function isInteractableNow(pickType, currentState){
  if(!(pickType in INTERACTABLE_STATES)) return false;
  const allowed = INTERACTABLE_STATES[pickType];
  return allowed===null || allowed.includes(currentState);
}
