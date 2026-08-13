/* =========================================================================
   PATIENT ARCHETYPES — the biggest replayability lever there is.

   `makePatient()` already varies appearance, requisition and vein properties
   with difficulty, and that variation is real — but it is almost entirely
   NUMERIC. A harder patient has deeper veins and a bigger tube count, and the
   thing the learner actually does is identical every time. Ten draws in a row
   feel like one draw done ten times.

   An archetype is different: it changes WHAT YOU PHYSICALLY DO. Not a
   difficulty scalar, not a label on the requisition, but a different physical
   solution to a different arm and a different person.

     * `keys` are handed to armAnatomy's own applyPatientVariation(), so a
       "deep" patient's veins genuinely sit further under the skin and every
       branch that measures depth sees it — nothing here is a special case.
     * `arm` overrides act on the same fields the rest of the game already
       reads, for the same reason.
     * `contraindicated` sides make CHECKING the entire test, which is a real
       piece of practice this game could not previously express.

   Pure data plus one weighted picker. tests/archetypes.spec.js asserts that
   every archetype changes something physical rather than only cosmetic.
   ========================================================================= */

/**
 * @typedef {object} Archetype
 *   id, label, blurb        who they are
 *   keys                    scenario keys for applyPatientVariation
 *   arm                     overrides on the arm bundle (vigour, etc.)
 *   voice                   register the dialogue layer speaks them in
 *   lines                   two or three things they actually say
 *   minDifficulty           the ladder rung they start appearing on
 *   weight                  relative frequency once available
 *   physical                one sentence: what you DO differently. This is
 *                           the field that justifies the archetype existing,
 *                           and the test asserts every entry has one.
 */
export const ARCHETYPES = [
  {
    id: "textbook",
    label: "Textbook",
    blurb: "Big, visible, well-anchored median cubital.",
    physical: "Nothing is in the way. This is the draw every other one is measured against.",
    keys: [],
    arm: { vigour: 1.15 },
    voice: "easy",
    lines: ["Take your time.", "I'm a good stick, apparently."],
    minDifficulty: 0, weight: 3,
  },
  {
    id: "fragile",
    label: "Elderly, fragile veins",
    blurb: "Visible, but they roll and they blow.",
    physical: "Lower angle, lighter anchor, smaller tubes. The vein moves when you press it and tears if you go in steep.",
    keys: ["rolling", "fragile"],
    arm: { vigour: 0.92 },
    voice: "gentle",
    lines: ["My veins wander, they tell me.", "The last one went straight through."],
    minDifficulty: 1, weight: 3,
  },
  {
    id: "deep",
    label: "Deep vessels",
    blurb: "Nothing visible at all.",
    physical: "Palpation is the whole challenge — you will not find this vein by looking, and the vein finder earns its cost here.",
    keys: ["deep"],
    arm: { vigour: 1.0 },
    voice: "matter-of-fact",
    lines: ["People usually go for the back of my hand.", "You won't see anything, I'm afraid."],
    minDifficulty: 1, weight: 3,
  },
  {
    id: "dehydrated",
    label: "Dehydrated",
    blurb: "Flat veins that fill slowly.",
    physical: "Tourniquet timing matters enormously, and a warming pack changes the draw rather than decorating it.",
    keys: ["dry", "small"],
    arm: { vigour: 0.72 },
    voice: "tired",
    lines: ["I've been fasting since nine.", "I've not had a drink since last night."],
    minDifficulty: 1, weight: 2,
  },
  {
    id: "anxious",
    label: "Needle-phobic",
    blurb: "Flinches, and has fainted before.",
    physical: "Warn before the stick or they move on you. Communication becomes a real mechanic and vasovagal risk is live.",
    keys: [],
    arm: { vigour: 1.0 },
    history: { faintHistory: true },
    voice: "frightened",
    lines: ["Can you tell me before you do it?", "I went down last time. Sorry."],
    minDifficulty: 0, weight: 2,
  },
  {
    id: "paediatric",
    label: "Paediatric",
    blurb: "Small everything.",
    physical: "Butterfly, paediatric tubes, and no margin at all on the angle.",
    keys: ["small"],
    arm: { build: 0.80, vigour: 1.05 },
    voice: "child",
    lines: ["Is it going to hurt?", "Mum said I could have a sticker."],
    minDifficulty: 2, weight: 1,
  },
  {
    id: "scarred",
    label: "Scarred antecubital",
    blurb: "The fossa has been used too many times.",
    physical: "The first-choice site is unusable. You have to find an alternative and justify it.",
    keys: ["deep", "rolling"],
    arm: { vigour: 0.95, scarred: true },
    voice: "matter-of-fact",
    lines: ["They usually struggle with that arm.", "There's a lot of scar tissue there now."],
    minDifficulty: 2, weight: 2,
  },
  {
    id: "veteran",
    label: "Veteran hard stick",
    blurb: "Knows exactly where their good vein is — and is right.",
    physical: "Listening is the skill. Ignore them and you will spend three attempts learning what they told you for free.",
    keys: ["deep", "rolling"],
    arm: { vigour: 0.9 },
    voice: "wry",
    lines: [
      "There's one on the back of my left hand that always works.",
      "Don't bother with the crook of my arm, honestly.",
    ],
    hint: true,
    minDifficulty: 2, weight: 2,
  },
  {
    id: "anticoagulated",
    label: "Anticoagulated",
    blurb: "On warfarin. Bleeds and bruises.",
    physical: "Extended pressure, and a bruise forms fast if you are short with it.",
    keys: ["fragile"],
    arm: { vigour: 1.0, bleedFactor: 2.1 },
    voice: "matter-of-fact",
    lines: ["I'm on warfarin — I bruise like a peach.", "You'll need to hold it a while."],
    minDifficulty: 2, weight: 2,
  },
  {
    id: "contraindicated",
    label: "One arm off limits",
    blurb: "Mastectomy on one side, or a dialysis fistula.",
    physical: "One arm is off limits, so the draw happens on the other one — which mirrors the vein pattern and the whole approach with it. Asking is what tells you which.",
    keys: [],
    arm: { vigour: 1.0 },
    voice: "matter-of-fact",
    lines: [
      "Not that arm, please — I had surgery on that side.",
      "There's a fistula in the left. They use the right.",
    ],
    contraindicatedSide: true,
    minDifficulty: 3, weight: 2,
  },
];

const BY_ID = Object.fromEntries(ARCHETYPES.map(a => [a.id, a]));

export function archetypeFor(id){ return BY_ID[id] || null; }

/**
 * Picks an archetype for a patient at a given difficulty.
 *
 * Weighted, and gated on the ladder, so a first shift meets textbook and
 * anxious patients and a hard shift meets fistulas and hard sticks. The
 * `avoid` argument keeps the same archetype from coming up twice running,
 * because two identical-feeling patients in a row is exactly the problem this
 * whole file exists to fix.
 */
export function pickArchetype(difficulty, avoid, rng){
  const rand = rng || Math.random;
  const d = difficulty == null ? 0 : difficulty;
  let pool = ARCHETYPES.filter(a => a.minDifficulty <= d && a.id !== avoid);
  if(!pool.length) pool = ARCHETYPES.filter(a => a.minDifficulty <= d);
  if(!pool.length) pool = [BY_ID.textbook];
  const total = pool.reduce((sum, a) => sum + a.weight, 0);
  let r = rand()*total;
  for(const a of pool){
    r -= a.weight;
    if(r <= 0) return a;
  }
  return pool[pool.length - 1];
}

/**
 * Folds an archetype into a patient object, in place.
 *
 * Everything it writes is a field the rest of the game already reads — scenario
 * keys, vigour, build, history flags — so an archetype never becomes a branch
 * anybody has to remember to handle.
 */
export function applyArchetype(patient, archetype){
  if(!patient || !archetype) return patient;
  patient.archetype = archetype.id;
  patient.archetypeLabel = archetype.label;
  patient.archetypePhysical = archetype.physical;
  patient.voice = archetype.voice;
  patient.archetypeLines = archetype.lines;

  // The site scenario is the existing carrier for "this arm is harder", so the
  // keys go there rather than into a parallel system.
  if(archetype.keys && archetype.keys.length){
    patient.site = patient.site || { keys: [], label: archetype.label };
    patient.site.keys = [...new Set([...(patient.site.keys || []), ...archetype.keys])];
  }
  if(archetype.history) patient.history = Object.assign({}, patient.history, archetype.history);
  if(archetype.arm) patient.armOverrides = Object.assign({}, patient.armOverrides, archetype.arm);
  if(archetype.arm && archetype.arm.build != null && patient.appearance){
    patient.appearance.width = archetype.arm.build;
  }
  if(archetype.contraindicatedSide){
    // Which arm is off limits is rolled here and NEVER printed on the
    // requisition, because the point is that you have to ask. The draw then
    // happens on the OTHER side, which mirrors the whole vein pattern and the
    // approach with it — a different physical draw, not a different label.
    const off = Math.random() < 0.5 ? "left" : "right";
    patient.contraindicatedSide = off;
    patient.forcedArmSide = off === "left" ? "right" : "left";
  }
  if(archetype.hint) patient.knowsTheirVein = true;
  return patient;
}
