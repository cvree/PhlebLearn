/* =========================================================================
   NEEDLE + HOLDER — the rules.

   The old steps were "drag a div onto another div" and "drag a cap 50px to
   the right". Neither is a skill. What actually decides whether an evacuated-
   tube unit is fit to stick a patient with is:

     STERILE FIELD  the pouch is peeled at its seam, not torn across; the
                    needle is handled by its sheath and never by the sleeved
                    end that goes inside the holder; if it touches anything
                    else it is done and a fresh one comes out
     ALIGNMENT      the needle goes onto the hub along the hub's own axis.
                    Started at an angle it cross-threads, and a cross-threaded
                    needle never seats however hard it is turned
     TURNS          finger-tight is a real amount of rotation. Short of it the
                    unit leaks and unseats during a tube change; well past it
                    the hub is over-torqued and will not come apart for
                    disposal
     CAP DIRECTION  the sheath comes off ALONG the needle's axis. Wiggled or
                    twisted off, the shaft bends and the bevel barbs — which
                    hurts, and shreds red cells on the way in
     BEVEL UP       where the bevel ends up is decided by where the thread
                    stopped, so it has to be looked at and rolled up
     THE CAP        it never goes back on by hand, and it never goes down on
                    the field that was just cleaned

   Pure maths. tests/assembly.spec.js asserts every threshold.
   ========================================================================= */

/* ---------- threading ------------------------------------------------------- */

/** Below this the needle is not attached to the holder at all. */
export const ATTACH_TURNS = 1.0;
/** Below this it is on, but loose enough to leak and unseat under vacuum. */
export const SECURE_TURNS = 2.0;
/** Finger-tight. */
export const SNUG_TURNS = 2.5;
/** Past this the hub is over-torqued: it cracks, and it will not come apart. */
export const OVERTIGHT_TURNS = 4.5;

/**
 * How far off the hub's axis the needle may be as threading begins.
 * Beyond it the first turn cuts a new thread across the existing one, and no
 * amount of further turning ever seats it.
 */
export const CROSS_THREAD_DEG = 12;
/** A cross-threaded needle binds here and goes no further. */
export const CROSS_BIND_TURNS = 0.75;

/* ---------- the pouch -------------------------------------------------------- */

/** Metres the peel may wander off the seam before the pouch is being torn. */
export const PEEL_OFF_SEAM = 0.006;
/** Fraction of the seam that has to be peeled for the needle to come out. */
export const PEEL_OPEN = 0.85;

/* ---------- uncapping -------------------------------------------------------- */

/** Metres of travel along the needle's axis before the sheath is clear. */
export const CAP_TRAVEL = 0.032;
/** Fraction of the pull that has to be axial. Below it, it was wiggled off. */
export const AXIAL_GOOD = 0.90;
/** Metres of sideways excursion the shaft survives before it is bent/barbed. */
export const WOBBLE_MAX = 0.004;
/** Degrees of twist the bevel survives. */
export const TWIST_MAX = 25;

/** Degrees off vertical the bevel may sit and still count as bevel-up. */
export const BEVEL_TOLERANCE_DEG = 25;

/** Seconds before the stick beyond which a warning has stopped being one. */
export const WARN_LEAD_MAX = 45;

/* ---------- derived quantities ----------------------------------------------- */

export function wrap180(deg){
  let d = deg % 360;
  if(d > 180) d -= 360;
  if(d < -180) d += 360;
  return d;
}

/**
 * Where the bevel ends up pointing, in degrees from straight up.
 *
 * This is not decoration: a real multi-sample needle screws in, so the bevel's
 * rotational position when you stop turning is wherever the thread happened to
 * stop. That is exactly why "check the bevel and roll it up" is a step at all
 * — you cannot know in advance where it will be.
 */
export function bevelFromTurns(turns){
  const frac = ((turns % 1) + 1) % 1;
  return wrap180(frac*360);
}

/** How much of the cap's travel went along the needle rather than across it. */
export function axialFraction(axialTravel, totalTravel){
  if(!totalTravel) return 0;
  return Math.max(0, Math.min(1, axialTravel/totalTravel));
}

/** Is the unit mechanically attached and safe to pull a cap off? */
export function isSecure(state){
  return !state.crossThreaded && state.turns >= SECURE_TURNS;
}

/* ---------- judgement --------------------------------------------------------- */

function issue(code, severity, message, data){
  return { code, severity, message, data: data || null };
}

function finish(issues, ready){
  const order = ["block", "warn", "note"];
  issues.sort((a,b)=>order.indexOf(a.severity) - order.indexOf(b.severity));
  const blocking = issues.filter(i=>i.severity === "block");
  return { issues, blocking, ready: blocking.length === 0 && ready };
}

/**
 * The needle threaded into the holder.
 * @param {object} state assemblyState
 */
export function evaluateAssembly(state){
  const issues = [];

  if(!state.pouchOpen){
    issues.push(issue("pouchSealed", "block",
      "The needle is still in its pouch. Peel the seam open — do not tear across the pack."));
  }else if(state.pouchTorn){
    issues.push(issue("tornPouch", "warn",
      "That pack was torn open rather than peeled. A torn film sheds fibres straight onto the needle you then pull through it — peel the seam back instead."));
  }

  if(state.pouchOpen && state.pouchCompromised){
    issues.push(issue("compromisedPouch", "block",
      "This pouch was already open when you staged it. The sterile barrier is broken, so the needle is not sterile — it goes in the sharps container and you take a fresh one."));
  }

  if(state.contaminated){
    issues.push(issue("contaminated", "block", contaminationMessage(state), { how: state.contaminatedBy }));
  }

  if(state.crossThreaded){
    issues.push(issue("crossThreaded", "block",
      `It went on at ${Math.round(state.engageMisalignDeg)}° and cross-threaded. It will not seat however hard you turn it — back it right off, line the needle up with the hub, and start again.`,
      { misalign: state.engageMisalignDeg }));
  }else if(state.turns < ATTACH_TURNS){
    issues.push(issue("notThreaded", "block",
      "The needle is not on the holder yet. Bring it to the hub along the hub's own axis, then turn it in.",
      { turns: state.turns }));
  }else if(state.turns < SECURE_TURNS){
    issues.push(issue("loose", "block",
      `Only ${state.turns.toFixed(1)} turns — that is on, but not finger-tight. A loose needle leaks air, drops the vacuum, and can unscrew itself when you pull a tube off.`,
      { turns: state.turns }));
  }else{
    if(state.turns < SNUG_TURNS){
      issues.push(issue("notSnug", "warn",
        `${state.turns.toFixed(1)} turns is holding, but not quite finger-tight. Take it to about ${SNUG_TURNS}.`,
        { turns: state.turns }));
    }
    if(state.turns > OVERTIGHT_TURNS){
      issues.push(issue("overTightened", "warn",
        `${state.turns.toFixed(1)} turns is over-torqued. Finger-tight is the whole instruction — forcing it past that cracks the hub and makes the unit hard to separate for disposal.`,
        { turns: state.turns }));
    }
  }

  if(state.reverseTurns > 0.25 && state.turns >= ATTACH_TURNS){
    issues.push(issue("unscrewed", "note",
      "You backed it off part-way at one point. Turning a seated needle the other way loosens it — go one way only, and stop at finger-tight."));
  }

  if(state.gauge && state.gauge !== 21){
    issues.push(issue("gauge", "note",
      `This is the ${state.gauge}G needle you staged. A routine antecubital draw is a 21G job.`,
      { gauge: state.gauge }));
  }

  if(state.dryElapsedAtStart != null && state.dryElapsedAtStart >= 30){
    issues.push(issue("dryTimeWasted", "note",
      "The site had already finished air-drying before you started assembling. The thirty seconds it needs is free time — assemble the unit inside it."));
  }

  return Object.assign(
    finish(issues, !state.crossThreaded && state.turns >= SECURE_TURNS && state.pouchOpen && !state.contaminated),
    { turns: state.turns, secure: isSecure(state) }
  );
}

function contaminationMessage(state){
  switch(state.contaminatedBy){
    case "threadEnd":
      return "You took hold of the sleeved end. That end goes inside the holder and into every tube you draw — once fingers have been on it the needle is done. Discard it and open a fresh one.";
    case "shaft":
      return "You took hold of the shaft. That is the part that goes into the patient. Discard it and open a fresh one.";
    case "bench":
      return "The needle went down on the bench. Nothing that has touched a work surface goes into a vein — discard it and open a fresh one.";
    case "skin":
      return "The needle touched the patient's skin outside the prepped field. Discard it and open a fresh one.";
    default:
      return "That needle is no longer sterile. Discard it and open a fresh one.";
  }
}

/**
 * The cap off, the bevel up, and the patient told.
 * @param {object} state assemblyState
 * @param {number} [now] injectable clock
 */
export function evaluateUncap(state, now){
  const issues = [];
  const t = now == null ? Date.now() : now;

  if(!isSecure(state)){
    issues.push(issue("notAssembled", "block",
      "The needle is not securely on the holder. Do not take the cap off an assembly that is not finger-tight."));
  }

  if(state.capOn){
    issues.push(issue("stillCapped", "block",
      "The sheath is still on. Pull it straight off along the needle — do not twist or wiggle it."));
  }else{
    if(state.capAxialFraction < AXIAL_GOOD || state.maxLateral > WOBBLE_MAX){
      issues.push(issue("wiggledOff", "warn",
        `Only ${Math.round(state.capAxialFraction*100)}% of that pull was along the needle. Levering the sheath sideways bends the shaft and turns the bevel over on itself.`,
        { axial: state.capAxialFraction, lateral: state.maxLateral }));
    }
    if(Math.abs(state.capTwistDeg) > TWIST_MAX){
      issues.push(issue("twistedOff", "warn",
        `The sheath was twisted ${Math.round(Math.abs(state.capTwistDeg))}° coming off. A twisted pull rolls a burr onto the bevel edge.`));
    }
  }

  if(state.needleDamaged){
    issues.push(issue("barbedNeedle", "block",
      "The bevel is turned over — that needle is barbed. It will drag going in, hurt, and shred the sample. It goes in the sharps container and you take a fresh unit.",
      { inspected: state.bevelInspected }));
  }

  if(state.needleContaminated){
    issues.push(issue("needleTouched", "block",
      "The uncapped needle touched something. Once it is bare it touches nothing at all until it touches the vein — discard the unit and start again."));
  }

  if(state.recapped){
    issues.push(issue("recapped", "block",
      "Never put a sheath back on a needle by hand. That is the single most common way phlebotomists stick themselves — if it is exposed and you are not using it, it goes in the sharps container."));
  }

  if(state.capPlacedOn === "site"){
    issues.push(issue("capOnSite", "block",
      "The sheath went down on the skin you had just disinfected. That field is contaminated again and has to be re-cleaned before anything punctures it."));
  }else if(state.capPlacedOn === "floor"){
    issues.push(issue("capDropped", "warn",
      "The sheath went on the floor. It is not sterile, it is a trip hazard by the chair, and you are about to need both hands."));
  }

  if(!state.capOn){
    const bevel = Math.abs(state.bevelDeg == null ? bevelFromTurns(state.turns) : state.bevelDeg);
    if(bevel > BEVEL_TOLERANCE_DEG){
      issues.push(issue("bevelOff", "block",
        bevel > 120
          ? `The bevel is facing down — ${Math.round(bevel)}° off. Entering bevel-down cuts a flap instead of slicing, and it will not fill. Roll the holder until the opening faces up.`
          : `The bevel is ${Math.round(bevel)}° off vertical. Roll the holder until the opening faces straight up.`,
        { bevel }));
    }
    if(!state.bevelInspected){
      issues.push(issue("notInspected", "warn",
        "You have not looked at the bevel. Getting the cap off is exactly when a needle gets damaged — check it before it goes anywhere near the patient."));
    }
  }

  if(!state.warnedAt){
    issues.push(issue("patientNotWarned", "warn",
      "The patient has not been told. Say it plainly right before you go in — a stick nobody warned them about is how arms move at the wrong moment."));
  }else{
    const lead = (t - state.warnedAt)/1000;
    if(lead > WARN_LEAD_MAX){
      issues.push(issue("warnedTooEarly", "note",
        `You warned them ${Math.round(lead)} seconds ago. Told too far ahead, it just gives them time to tense up — say it as you are about to go in.`,
        { lead }));
    }
  }

  if(state.unitsDiscarded > 0){
    issues.push(issue("unitsDiscarded", "note",
      `${state.unitsDiscarded} unit${state.unitsDiscarded > 1 ? "s" : ""} discarded and replaced. Recognising a needle you should not use is the right call — it just costs the patient time.`,
      { units: state.unitsDiscarded }));
  }

  const bevelNow = Math.abs(state.bevelDeg == null ? bevelFromTurns(state.turns) : state.bevelDeg);
  return Object.assign(
    finish(issues, !state.capOn && bevelNow <= BEVEL_TOLERANCE_DEG && !state.needleDamaged
                   && !state.needleContaminated && !state.recapped && state.capPlacedOn !== "site"),
    { bevel: bevelNow, axial: state.capAxialFraction }
  );
}

export function nextIssue(result){
  return result && result.issues.length ? result.issues[0] : null;
}

export function nextAssemblyAction(state){
  if(!state.pouchOpen) return "Peel the pouch open along its seam.";
  if(state.pouchCompromised) return "That pouch was already open — discard it and take a fresh needle.";
  if(state.contaminated) return "Discard that needle and open a fresh one.";
  if(!state.needleInHand) return "Lift the needle out by its sheath — do not touch the sleeved end.";
  if(state.crossThreaded) return "Back it right off, line it up with the hub, and start again.";
  if(state.turns < ATTACH_TURNS) return "Bring the needle onto the hub along the hub's axis, then turn it in.";
  if(state.turns < SNUG_TURNS) return "Keep turning — finger-tight is about two and a half turns.";
  if(state.turns > OVERTIGHT_TURNS) return "That is well past finger-tight. Stop.";
  return "Threaded and finger-tight. Leave the sheath on until you are ready to stick.";
}

export function nextUncapAction(state){
  if(state.needleDamaged || state.needleContaminated) return "Discard this unit and take a fresh one.";
  if(state.capOn) return "Pull the sheath straight off, along the needle.";
  if(!state.bevelInspected) return "Look at the bevel before it goes anywhere near the patient.";
  const bevel = Math.abs(state.bevelDeg == null ? bevelFromTurns(state.turns) : state.bevelDeg);
  if(bevel > BEVEL_TOLERANCE_DEG) return "Roll the holder until the bevel faces straight up.";
  if(!state.capPlacedOn) return "Put the sheath down somewhere clear — not on the prepped field.";
  if(!state.warnedAt) return "Tell the patient you are about to go in.";
  return "Bevel up, patient warned. Ready.";
}
