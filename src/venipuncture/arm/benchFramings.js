/* =========================================================================
   BENCH FRAMINGS — where the camera looks during each beat.

   One entry per beat. `look` is the point the camera aims at; `frame` is the
   set of points that must remain on screen, which armScene's solveFraming()
   fits a distance to. Declaring a POINT SET rather than a span is what lets a
   framing say something meaningful — "keep the hand in shot, because a hand
   going pale is how a band that is too tight announces itself" — instead of
   a bounding box someone has to keep in their head.

   All coordinates are limb-local metres (see armAnatomy.js): +X proximal,
   +Y out of the skin, +Z toward the operator. ARM_Y (0.052) is the limb's
   own axis height, so a `y` of ARM_Y is level with the middle of the arm.

   Nothing here cuts. armScene eases between whichever two of these are
   current, over roughly half a second, always.
   ========================================================================= */

const ARM_Y = 0.052;

/* The patient's FACE, not their chest. Making this a frame point is what
   guarantees there is a person in the picture at every beat — and because the
   patient leans forward over their own arm (see patientBody.js), including it
   costs the arm only a few percent of the frame rather than a third of it. */
const PERSON = [0.245, ARM_Y + 0.235, -0.005];

export const FRAMINGS = {
  /* The whole limb, hand included, plus the patient. This is the framing the
     band and the fingers work in: judging tension means watching the hand at
     the same time as the forearm. */
  access: {
    look: [-0.055, ARM_Y + 0.004, 0.004],
    frame: [
      [-0.335, ARM_Y, 0.00], [0.215, ARM_Y, 0.00],
      [-0.05, ARM_Y, 0.075], [-0.05, ARM_Y, -0.070],
      [-0.05, ARM_Y + 0.055, 0], PERSON,
    ],
  },

  /* Cleaning and assembly. The site stays in shot while the tray comes into
     the bottom of the frame, because assembling a needle during the alcohol's
     thirty-second dry is correct technique and the game should let you watch
     both at once. */
  prep: {
    look: [-0.022, ARM_Y, 0.040],
    frame: [
      [-0.185, ARM_Y, 0.00], [0.130, ARM_Y, 0.00],
      [-0.02, ARM_Y, 0.155], [-0.02, ARM_Y, -0.055],
      [-0.02, ARM_Y + 0.050, 0], PERSON,
    ],
  },

  /* The stick. Pushed in close: the anchor, the entry point and the bevel
     have to be legible at a few millimetres.

     This is the ONE framing with no person point in it, and that is a
     deliberate concession rather than an oversight — you cannot hold a 4 mm
     vein and a face in the same frame, and at this moment the vein wins.
     The patient does not stop existing: their shoulder still clips the top of
     frame, their breathing tightens audibly through the approach, and the
     camera eases back out to `collect` the moment blood is flowing, which is
     where their exhale is meant to be seen. */
  stick: {
    look: [-0.020, ARM_Y + 0.010, 0.008],
    frame: [
      /* Wide enough that the fossa's crease, the marked site and the whole
         length of the needle are all readable at once. Pushed in tighter than
         this (the first attempt) the frame filled with undifferentiated skin
         and the player lost every landmark they had just spent a minute
         finding. */
      [-0.125, ARM_Y, 0.004], [0.075, ARM_Y, 0.004],
      [-0.02, ARM_Y, 0.070], [-0.02, ARM_Y, -0.046],
      [-0.02, ARM_Y + 0.046, 0],
    ],
  },

  /* Collection. Pulls back to take in the holder, the tubes coming off the
     rack, and the arm at the same time — the rhythm of a draw is push, pop,
     hiss, watch, click, rack, and all six have to be visible. */
  collect: {
    look: [-0.030, ARM_Y, 0.055],
    frame: [
      [-0.200, ARM_Y, 0.00], [0.140, ARM_Y, 0.00],
      [-0.03, ARM_Y, 0.185], [-0.03, ARM_Y, -0.060],
      [-0.03, ARM_Y + 0.060, 0], PERSON,
    ],
  },

  /* Aftercare: pressure, bandage, and the patient's own reaction to being
     finished with. Tighter than access, wider than stick. */
  close: {
    look: [-0.040, ARM_Y + 0.004, 0.020],
    frame: [
      [-0.240, ARM_Y, 0.00], [0.175, ARM_Y, 0.00],
      [-0.04, ARM_Y, 0.120], [-0.04, ARM_Y, -0.060],
      [-0.04, ARM_Y + 0.055, 0], PERSON,
    ],
  },

  /* The tray on its own — inversion, labelling, anything that happens off the
     patient. The arm stays in the corner of frame so the encounter never
     stops being about a person. */
  bench: {
    look: [-0.030, 0.010, 0.105],
    frame: [
      [-0.210, 0.01, 0.02], [0.150, 0.01, 0.02],
      [-0.03, 0.01, 0.215], [-0.03, ARM_Y + 0.02, -0.030],
    ],
  },
};

export const DEFAULT_FRAMING = FRAMINGS.access;

/** Which framing a bench mode belongs in. One place, so no mode guesses. */
export const FRAMING_FOR_MODE = {
  tourniquet: "access",
  palpation: "access",
  cleaning: "prep",
  assembly: "prep",
  insert: "stick",
  collection: "collect",
  withdrawal: "close",
  postdraw: "close",
  inversion: "bench",
};
