/* =========================================================================
   Pure game data: no THREE, no DOM, no imports. Every other module is a
   consumer of this file, directly or indirectly — it must never import
   anything itself, or the acyclic layering (config < game < rendering <
   world < venipuncture < input < ui < main) breaks.
   ========================================================================= */

/* ---------- placeholder card data (mirrors verified Phleb Learn cards) ----- */
/* When merged, replace this with the real DB import from phleb-learn.html.    */
export const CARD_LINKS = {
  patientId:   {cardId:"id-03", topic:"Patient ID & Labeling",         section:"Patient ID"},
  requisition: {cardId:"id-01", topic:"Requisition & Test Orders",     section:"Patient ID"},
  tubeSelect:  {cardId:"tube-01",topic:"Tube Colors & Additives",       section:"Tubes"},
  orderOfDraw: {cardId:"od-05", topic:"Order of Draw",                 section:"Tubes"},
  siteSelect:  {cardId:"saf-02", topic:"Site Selection & Vein Assessment",section:"Safety"},
  supplyStaging:{cardId:"qa-02", topic:"Equipment Preparation & Work Area", section:"Specimen Handling"},
  labeling:    {cardId:"id-01", topic:"Patient ID & Labeling",         section:"Patient ID"},
  handling:    {cardId:"qa-04", topic:"Pre-Analytical & Specimen Handling", section:"Specimen Handling"},
  professional:{cardId:null,    topic:"Professional communication",    section:"Safety"},
  safety:      {cardId:"saf-02", topic:"Safety & Infection Control",    section:"Safety"}
};

/* Tubes, colors/additives/order from verified Phleb Learn deck (CLSI order). */
export const TUBES = {
  bloodculture:{name:"Blood culture", color:0xc9a23a, additive:"Sterile / SPS",      order:1},
  lightblue:   {name:"Light blue",    color:0x6fb2ee, additive:"Sodium citrate",     order:2},
  red:         {name:"Red",           color:0xdc4b4b, additive:"None (serum)",       order:3},
  sst:         {name:"SST (gold)",    color:0xf2c02e, additive:"Clot activator + gel",order:4},
  pst:         {name:"PST (lt green)", color:0xa8e06a, additive:"Lithium heparin + gel",order:5},
  green:       {name:"Green",         color:0x2f9e5e, additive:"Heparin",            order:6},
  lavender:    {name:"Lavender",      color:0xa782e0, additive:"EDTA",               order:7},
  gray:        {name:"Gray",          color:0x8f96a3, additive:"Fluoride/oxalate",   order:8}
};
export const TUBE_KEYS = Object.keys(TUBES);

/* Tests → required tube + handling. Verified mappings only. */
export const TESTS = {
  "CBC":             {tube:"lavender",   handling:"routine"},
  "PT/INR":          {tube:"lightblue",  handling:"routine"},
  "Glucose":         {tube:"gray",       handling:"routine"},
  "Blood culture":   {tube:"bloodculture",handling:"routine"},
  "Chemistry panel": {tube:"sst",        handling:"routine"},
  "Lipid panel":     {tube:"sst",        handling:"routine"},
  "Ammonia":         {tube:"green",      handling:"chilled"},
  "Bilirubin":       {tube:"sst",        handling:"light"}
};
export const TEST_NAMES = Object.keys(TESTS);

export const HANDLING = {
  routine:{label:"Routine, deliver promptly", labels:["Routine, deliver promptly","Standard transport at room temperature","Send at room temp without delay","Normal handling; transport soon"], why:"Most specimens just need timely, room-temperature transport."},
  chilled:{label:"Keep chilled (on ice)", labels:["Keep chilled (on ice)","Transport cold, on ice","Chill the specimen for transport","Place on ice during transport"], why:"A few analytes (e.g., ammonia) need cold transport to stay valid."},
  light:  {label:"Protect from light", labels:["Protect from light","Wrap to shield it from light","Light-protected transport","Cover it to block light exposure"], why:"Light-sensitive analytes (e.g., bilirubin) degrade if exposed."}
};

/* ---------- patient generator (safe, fictional only) --------------------- */
export const FIRST=["Maria","James","Aisha","Diego","Linh","Noah","Priya","Sam","Grace","Omar","Ella","Marcus","Yuki","Sofia","Theo","Nina","Andre","Rosa","Kai","Lena","Hassan","Mei","Tomas","Ava","Ravi","Clara","Jonas","Imani","Pedro","Ines","Cyrus","Maya","Wei","Fatima","Lucas","Amara","Dmitri","Sienna","Tariq","Beatriz","Kenji","Zoe","Mateo","Aaliyah","Soren","Camila","Idris","Freya","Hugo","Nadia","Bao","Esme","Rashid","Talia","Leon","Anika","Cole","Mira","Yusuf","Greta"];
export const LAST=["Tufferson","Okafor","Nguyen","Alvarez","Patel","Romano","Castillo","Bauer","Delacroix","Whitfield","Kowalski","Mbeki","Iqbal","Sorensen","Reyes","Hartman","Underwood","Vasquez","Lindqvist","Abara","Fontaine","Greaves","Petrov","Espinoza","Marchetti","Sundgren","Halloran","Bashir","Ferraro","Niemann","Yamamoto","O'Connor","Dubois","Kim","Andersson","Mensah","Rossi","Haddad","Novak","Cohen","Silva","Park","Schneider","Fernandez","Adebayo","Larsen","Khan","Moreau","Tan","Walsh"];
export const MOODS=["Calm","Nervous","Chatty","Tired","Cheerful","Shy","Anxious","Curious","Grumpy","Brave","Sleepy","Bubbly","Quiet","Impatient","Stoic"];

// ---- bold patient appearance variety ----
export const SKIN_TONES=[0xfbe0c8,0xf3c9a0,0xe6b386,0xd49a6a,0xb87c4f,0x96603a,0x70472b,0x523320];
export const HAIR_NATURAL=[0x241d1a,0x3f2d20,0x5a3d27,0x7a5230,0x9c6b3f,0xc99a52,0xd9c27a,0x9a9aa2,0xcfcdd4];
export const HAIR_BOLD=[0x4f8cff,0xff7ab0,0x9b6bff,0x2fb37a,0xff7a3c,0xff4d6d];
export const HAIR_SENIOR=[0x9a9aa2,0xcfcdd4,0xe8e6ea,0x7a5230,0x5a3d27];
export const HAIR_STYLES=["bald","buzz","short","long","bun","ponytail","afro","cap","beanie","hijab"];
export const FABRIC=[0x6b5b95,0x88498f,0x2f6f6f,0x4a6fa5,0xb5651d,0xe05a5a,0x33808a,0x5c6bc0,0x2a2440,0xffc24d];
export const SHIRTS=[0xff9cc0,0xbcd6f7,0xc7e9b0,0xffd98a,0xc9b3e8,0xff6b6b,0x4fb0ff,0x33c08a,0xffc24d,0xa06bff,0xf06595,0x20c0c0,0x8d6e63,0xff7a3c,0x5c6bc0,0xfdfdfd];

export const EVENTS=[
  {type:"none"},{type:"none"},{type:"none"},
  {type:"respond", emoji:"😰", safety:false, when:"pre",
   lines:["I'm really scared of needles…","Can you make it quick?"],
   options:[{t:"Acknowledge the fear, explain calmly what you'll do, and offer to have them look away.",ok:true,reply:"Okay, that actually helps. Thank you."},
     {t:"Tell them to toughen up, it's nothing.",ok:false,reply:"…that makes me feel worse."},
     {t:"Promise it won't hurt at all.",ok:false,reply:"You said that, and then it did. Now I don't trust you."}],
   learn:"Acknowledge anxiety, explain calmly, and offer comfort measures. Don't dismiss feelings or over promise a pain free stick.",
   why:"Honesty and empathy build trust and lower fainting risk."},
  {type:"respond", emoji:"🧤", safety:true, when:"pre",
   lines:["Just so you know, I have a latex allergy."],
   options:[{t:"Thank them, switch to latex free gloves and supplies, and note it.",ok:true,reply:"Great, thank you for checking."},
     {t:"Say your gloves are probably fine.",ok:false,reply:"Please don't risk it!"},
     {t:"Ignore it, you're almost done anyway.",ok:false,reply:"That could send me to the ER."}],
   learn:"Always honor a stated latex allergy: use latex free gloves, tourniquet, and bandages, and document it.",
   why:"Latex exposure can trigger a serious allergic reaction."},
  {type:"respond", emoji:"😵‍💫", safety:true, when:"pre",
   lines:["Heads up, I usually pass out when I get blood drawn."],
   options:[{t:"Have them lie down or recline before you begin, and stay with them.",ok:true,reply:"Lying down does help. Thanks."},
     {t:"Tell them to sit up straight so it's over faster.",ok:false,reply:"That's how I hit my head last time."},
     {t:"Say fainting is all in their head.",ok:false,reply:"That's dismissive."}],
   learn:"For a known fainter, position them reclined before the draw and monitor them. Preventing a fall beats reacting to one.",
   why:"Vasovagal syncope can cause real injury from a fall."},
  {type:"respond", emoji:"🧐", safety:false, when:"post",
   lines:["So… what do these results mean?","Am I okay?"],
   options:[{t:"Explain that you collect and transport the samples, and the provider reviews and explains results.",ok:true,reply:"Okay, I'll ask my doctor. Thank you."},
     {t:"Take a guess at what the tests might show.",ok:false,reply:"Wait, should I be worried now?!"},
     {t:"Recite a normal range you half remember.",ok:false,reply:"Now I'm more confused."}],
   learn:"Phlebotomists collect and transport specimens; they do not analyze or interpret results. Refer interpretation to the provider.",
   why:"Interpreting results is outside a phlebotomist's scope and can cause harm."},
  {type:"respond", emoji:"🤕", safety:false, when:"post",
   lines:["Ow… why does my arm hurt so much?"],
   options:[{t:"Check the site, apply gentle pressure, offer ice, and say mild soreness is normal but to report worsening pain or numbness.",ok:true,reply:"That's reassuring. Thank you."},
     {t:"Tell them pain means you did it wrong, and apologize over and over.",ok:false,reply:"Now I'm panicking."},
     {t:"Say it's nothing and walk away.",ok:false,reply:"That felt dismissive."}],
   learn:"Mild soreness or bruising is common. Check the site, apply pressure or ice, and advise reporting severe pain, swelling, numbness, or tingling.",
   why:"Reassurance plus a safety net catches the rare complication."},
  {type:"respond", emoji:"😟", safety:false, when:"pre",
   lines:["Is this going to hurt?"],
   options:[{t:"Be honest: a quick pinch is normal, and walk them through what to expect.",ok:true,reply:"Okay, I can handle a pinch."},
     {t:"Promise it won't hurt at all.",ok:false,reply:"…you lied."},
     {t:"Say it'll hurt a lot, to set low expectations.",ok:false,reply:"Now I'm terrified."}],
   learn:"Set honest expectations: a brief pinch is normal. Over or under promising both erode trust.",
   why:"Calm honesty reduces anxiety and builds rapport."},
  {type:"respond", emoji:"🤔", safety:false,
   lines:["Wow, that's a lot of tubes…","Why do you need so many?"],
   options:[{t:"Explain that different tests need different tube additives.",ok:true,reply:"Oh, that makes sense — thanks for explaining!"},
     {t:"Tell them not to worry about it.",ok:false,reply:"…okay, I guess."},
     {t:"Say you can't discuss it.",ok:false,reply:"That's a little unsettling."}],
   learn:"Different tests need different tube additives, so one visit can require several color-coded tubes.",
   why:"A kind, clear explanation builds trust."},
  {type:"respond", emoji:"😬", safety:false,
   lines:["I'm not gonna lie…","I really hate needles."],
   options:[{t:"Acknowledge it, stay calm, and talk them through what to expect.",ok:true,reply:"Okay… that actually helps. Thank you."},
     {t:"Laugh and tell them not to be a baby.",ok:false,reply:"That doesn't make me feel better."},
     {t:"Say nothing and work as fast as possible.",ok:false,reply:"That made me more nervous!"}],
   learn:"Acknowledging fear and explaining calmly helps anxious patients cope — a relaxed patient is safer to work with.",
   why:"Validate the feeling and reassure them."},
  {type:"respond", emoji:"😟", safety:false,
   lines:["Be honest with me…","is this going to hurt?"],
   options:[{t:"Be honest and reassuring — a quick, small pinch.",ok:true,reply:"Okay, I can handle a quick pinch."},
     {t:"Promise they'll feel absolutely nothing.",ok:false,reply:"…I felt that! You said nothing."},
     {t:"Dodge the question.",ok:false,reply:"Now I'm more worried."}],
   learn:"Honest, gentle reassurance builds trust; over-promising ('you won't feel a thing') backfires.",
   why:"Be honest but kind."},
  {type:"respond", emoji:"🙏", safety:true,
   lines:["Just so you know,","I had surgery on my left side last year."],
   options:[{t:"Note it and avoid that arm per policy; use the other side or check with the nurse.",ok:true,reply:"Thank you for being careful."},
     {t:"Use that arm anyway to save time.",ok:false,reply:"Wait — are you sure that's okay?"},
     {t:"Decide it's fine without checking.",ok:false,reply:"Shouldn't you check first?"}],
   learn:"Draws are generally avoided on the same side as certain surgeries (like a mastectomy). Follow policy and confirm when unsure.",
   why:"Honor it and follow policy."},
  {type:"respond", emoji:"🙋", safety:true,
   lines:["Before we start —","I'm allergic to latex."],
   options:[{t:"Switch to latex-free supplies and note the allergy.",ok:true,reply:"Great, thank you for listening."},
     {t:"Use whatever's closest to save time.",ok:false,reply:"But I told you I'm allergic!"},
     {t:"Say a little latex is fine.",ok:false,reply:"That's really not okay."}],
   learn:"Honor stated allergies and use latex-free supplies to prevent a reaction.",
   why:"Use latex-free supplies and note it."},
  {type:"respond", emoji:"🤔", safety:false,
   lines:["So once you draw this…","can you tell me what my results mean?"],
   options:[{t:"Kindly explain the provider will share and discuss results.",ok:true,reply:"Fair enough — I'll ask my doctor."},
     {t:"Give them your own interpretation.",ok:false,reply:"Wait, are you sure about that?"},
     {t:"Make a guess to be helpful.",ok:false,reply:"That doesn't sound right…"}],
   learn:"Interpreting results is outside the phlebotomist's scope — the ordering provider explains them.",
   why:"Defer interpretation to the provider."},
  {type:"respond", emoji:"😅", safety:true,
   lines:["Um, quick question…","I ate breakfast. Was I supposed to fast?"],
   options:[{t:"Let them know, and check with the nurse/provider before drawing.",ok:true,reply:"Okay — glad I mentioned it."},
     {t:"Draw anyway and say nothing.",ok:false,reply:"Won't that mess up the test?"},
     {t:"Tell them to skip the test entirely.",ok:false,reply:"Can you even decide that?"}],
   learn:"Fasting status affects tests like glucose and lipids. Flag it — don't hide it or change the order yourself.",
   why:"Flag fasting issues, don't hide them."},
  // `anticoagulated` is explicit trigger DATA, not something to infer from the
  // words in `lines`. The post-draw care branch reads it to make this patient
  // genuinely bleed and clot more slowly, so "apply firm pressure longer" is a
  // thing the learner has to actually do rather than a sentence they read.
  {type:"respond", emoji:"🙂", safety:true, anticoagulated:true,
   lines:["I should mention,","I'm on blood thinners."],
   options:[{t:"Note it and plan to apply firm pressure longer afterward.",ok:true,reply:"Thanks — that makes me feel cared for."},
     {t:"Ignore it; it doesn't matter.",ok:false,reply:"Are you sure? I bruise easily."},
     {t:"Tell them to stop taking them.",ok:false,reply:"You can't tell me that!"}],
   learn:"Patients on anticoagulants bleed and bruise more — apply firm pressure longer and watch the site. Never advise stopping meds.",
   why:"Longer pressure; never advise stopping meds."},
  {type:"respond", emoji:"🧤", safety:false,
   lines:["Random question —","why do you wear gloves?"],
   options:[{t:"Explain it protects both of you (standard precautions).",ok:true,reply:"Smart — makes sense."},
     {t:"Say it's just a rule you follow.",ok:false,reply:"Oh… okay."},
     {t:"Say you don't really need them.",ok:false,reply:"That seems unsafe."}],
   learn:"Gloves are part of standard precautions — they protect both patient and phlebotomist from bloodborne pathogens.",
   why:"Infection control protects everyone."},
  {type:"respond", emoji:"😕", safety:false,
   lines:["That band is kind of tight…","why do you use it?"],
   options:[{t:"Explain it helps find the vein, and you'll keep it under a minute.",ok:true,reply:"Got it — thanks."},
     {t:"Leave it on extra long to be safe.",ok:false,reply:"My arm's going numb…"},
     {t:"Say it doesn't matter how long it's on.",ok:false,reply:"That doesn't sound right."}],
   learn:"A tourniquet helps locate veins but should stay on under a minute — too long causes hemoconcentration and skews results.",
   why:"Keep the tourniquet under a minute."},
  {type:"respond", emoji:"😊", safety:false,
   lines:["I saw you gently flip that tube.","Why?"],
   options:[{t:"Explain it mixes the additive so the sample stays good.",ok:true,reply:"Neat — makes sense."},
     {t:"Say you were just shaking it hard.",ok:false,reply:"Shaking? Is that safe?"},
     {t:"Say it's a nervous habit.",ok:false,reply:"Oh… okay?"}],
   learn:"Gentle inversions mix the additive evenly; shaking can cause hemolysis and ruin the sample.",
   why:"Gentle inversions mix additives — don't shake."},
  {type:"respond", emoji:"😟", safety:false,
   lines:["That looks like a lot of blood…","am I going to be okay?"],
   options:[{t:"Reassure them it's a small, safe amount.",ok:true,reply:"Phew — okay then."},
     {t:"Joke that you'll take it all.",ok:false,reply:"That's not funny!"},
     {t:"Say you're not really sure.",ok:false,reply:"That's not reassuring…"}],
   learn:"Routine draws take only a small, safe volume. Calm reassurance eases worry.",
   why:"It's a small, safe amount."},
  {type:"respond", emoji:"🙍", safety:false,
   lines:["Last time I got a huge bruise.","Can we avoid that?"],
   options:[{t:"Explain you'll apply firm pressure afterward to help prevent it.",ok:true,reply:"Thank you — that helps."},
     {t:"Say bruises are just unavoidable.",ok:false,reply:"That's discouraging."},
     {t:"Blame their veins.",ok:false,reply:"That feels kind of rude."}],
   learn:"Firm pressure after the draw helps prevent a hematoma (bruise). Releasing too early is a common cause.",
   why:"Firm post-draw pressure prevents bruising."},
  {type:"respond", emoji:"⏰", safety:true,
   lines:["I'm running really late.","Can we skip the questions?"],
   options:[{t:"Stay polite but still verify identity fully.",ok:true,reply:"Okay, I understand. Go ahead."},
     {t:"Skip the ID check to save time.",ok:false,reply:"Wait, don't you need to check?"},
     {t:"Guess their identity from the chart.",ok:false,reply:"That seems risky…"}],
   learn:"Never skip identification, even under time pressure — wrong-patient errors are among the most serious mistakes.",
   why:"Always verify ID, even when rushed."},
  {type:"respond", emoji:"😵", safety:true,
   lines:["I'm sorry, I…","I feel really faint."],
   options:[{t:"Stop, help them sit back safely, and call for help.",ok:true,reply:"Thank you… I feel a bit better sitting."},
     {t:"Finish quickly before they pass out.",ok:false,reply:"I don't feel good at all…"},
     {t:"Tell them to walk it off.",ok:false,reply:"I really can't right now."}],
   learn:"If a patient feels faint, stop immediately, support them, and get help. Safety always outranks finishing the draw.",
   why:"Stop and support — safety first."},
  {type:"respond", emoji:"😶", safety:false,
   lines:["You seem young.","Have you done this many times before?"],
   options:[{t:"Answer calmly and professionally, and reassure them.",ok:true,reply:"Okay, that puts me at ease."},
     {t:"Get defensive and short with them.",ok:false,reply:"…I was just asking."},
     {t:"Exaggerate wildly to impress them.",ok:false,reply:"That sounds made up."}],
   learn:"Calm professionalism reassures an anxious patient far better than defensiveness or bravado.",
   why:"Stay calm and professional."},
  {type:"verify", nickname:true,
   prompt:"Patient gives only a nickname when you ask their name.",
   why:"Always confirm full legal name and date of birth — never identify by nickname or room number."},
  {type:"verify", nickname:true,
   prompt:'Patient answers "Yep, that\'s me!" without giving details.',
   why:"A yes/no isn't identification — have them state full name and DOB."},
  {type:"label", missingTime:true,
   prompt:"The requisition is missing a collection-time field.",
   why:"You still must label with date AND time of collection — don't leave it off."}
];

/* wording variants so recurring steps don't read identically each time */
export const VERIFY_CORRECT=[
  "Match full name and date of birth against the requisition.",
  "Confirm two identifiers, name and DOB, with the order.",
  "Have the patient state name and DOB, then check the requisition.",
  "Verify name plus date of birth against the paperwork first."
];
export const VERIFY_WRONG=[
  "Trust the room or chair number.",
  "Go by which bed they're sitting in.",
  "Use just their first name.",
  "Assume it's right since they showed up.",
  "Recognize them by face from last time.",
  "Use only an ID number someone said out loud."
];
export const NICK_CORRECT=[
  "Politely ask for their full legal name and date of birth, then match.",
  "Kindly request full name and DOB before continuing.",
  "Explain you need their legal name and birth date to confirm."
];
export const NICK_WRONG=[
  "Accept the nickname, close enough.",
  "Match the nickname to the chart and move on.",
  "Skip it and start the draw.",
  "Identify them by the room instead."
];

export const REQ_ISSUES=[
  {flaw:"dob",   catch:"The date of birth is missing."},
  {flaw:"name",  catch:"The name doesn't match the patient."},
  {flaw:"test",  catch:"A test is missing or unreadable."},
  {flaw:"date",  catch:"There's no collection date."},
  {flaw:"dup",   catch:"A test is listed twice."},
  {flaw:"prov",  catch:"The ordering provider isn't listed."}
];
export const ALL_CATCHES=REQ_ISSUES.map(x=>x.catch);

/* draw complications, recognition + high-level professional response (NO needle technique).
   who: "patient" speaks, otherwise a "⚠️ Heads up" observation bubble.
   when: "mid" = interrupts the active draw, before pressure/bandaging (needle still in or
         blood still flowing); "post" = discovered after the stick is done and bandaged.       */
export const DRAW_EVENTS=[
  {emoji:"⚠️", who:"⚠️ Heads up", safety:true, when:"mid",
   lines:["The needle's in but no blood is flashing back."],
   options:[{t:"Make one careful adjustment; if it still fails, stop and ask a colleague.",ok:true,reply:"Right, limited attempts, then hand off."},
     {t:"Probe around under the skin until you hit it.",ok:false,reply:"That risks nerve injury and real pain."},
     {t:"Say the patient just has 'bad veins' and give up loudly.",ok:false,reply:"Unkind and unprofessional."}],
   learn:"Limit attempts (usually two). Never probe or redirect blindly, it can injure nerves. After two tries, hand off to a colleague."},
  {emoji:"⚠️", who:"⚠️ Heads up", safety:true, when:"mid",
   lines:["A bruise is swelling up at the site."],
   options:[{t:"Stop, remove the needle, and apply firm pressure.",ok:true,reply:"Yes, pressure controls a hematoma."},
     {t:"Keep drawing through it.",ok:false,reply:"That makes the hematoma worse."},
     {t:"Ignore it and bandage lightly.",ok:false,reply:"It'll keep bleeding under the skin."}],
   learn:"A forming hematoma means stop and apply firm pressure. Continuing worsens the bruise and pain."},
  {emoji:"😣", who:"patient", safety:true, when:"mid",
   lines:["Sorry, I flinched!"],
   options:[{t:"Pause, make sure everything's safe, then reassure them.",ok:true,reply:"Thanks for stopping."},
     {t:"Pin their arm down hard and keep going.",ok:false,reply:"Please don't restrain me!"},
     {t:"Scold them for moving.",ok:false,reply:"That's not kind."}],
   learn:"If a patient moves, pause and make sure everything is safe before continuing. Never restrain forcefully."},
  {emoji:"⚠️", who:"⚠️ Heads up", safety:true, when:"mid",
   lines:["The blood is bright red and pulsing into the tube."],
   options:[{t:"Remove, apply firm pressure several minutes, and notify staff.",ok:true,reply:"Correct, that may be arterial."},
     {t:"Keep filling all the tubes.",ok:false,reply:"That's not safe."},
     {t:"Bandage lightly and send them off.",ok:false,reply:"It could keep bleeding."}],
   learn:"Bright red, pulsing blood may be arterial, remove, hold firm pressure for several minutes, and notify staff. Arterial puncture is outside CPT I scope."},
  {emoji:"⚠️", who:"⚠️ Heads up", safety:true, when:"post",
   lines:["Cleaning up, you nick your own finger on the used needle."],
   options:[{t:"Stop, wash the area, and report it per exposure protocol.",ok:true,reply:"Right, wash and report immediately."},
     {t:"Wipe it and keep working.",ok:false,reply:"Exposures must be reported."},
     {t:"Hide it so you don't get in trouble.",ok:false,reply:"Never conceal an exposure."}],
   learn:"A needlestick is an exposure: wash the site and report it right away per protocol. Never conceal it."},
  {emoji:"⚠️", who:"⚠️ Heads up", safety:true, when:"mid",
   lines:["Blood started, then the flow just stopped."],
   options:[{t:"If it won't flow, stop, don't dig, reassess or get help.",ok:true,reply:"Good, no blind probing."},
     {t:"Push the needle deeper, searching for it.",ok:false,reply:"That can injure the patient."},
     {t:"Yank it straight out fast.",ok:false,reply:"That can cause a hematoma."}],
   learn:"If flow stops, don't probe blindly. Stop, reassess, and seek help if needed."},
  {emoji:"⚠️", who:"⚠️ Heads up", safety:false, when:"post",
   lines:["There's an extra tube on the tray that wasn't ordered."],
   options:[{t:"Set it aside and use only what's ordered.",ok:true,reply:"Exactly, only what's ordered."},
     {t:"Use it too, more is better.",ok:false,reply:"That's an extra, unneeded draw."},
     {t:"Dump all the tubes and start over.",ok:false,reply:"No need to waste them."}],
   learn:"Collect only the tubes the order calls for; set any extras aside."},
  {emoji:"⚠️", who:"⚠️ Heads up", safety:true, when:"mid",
   lines:["There's an IV running in that arm, above where you'd draw."],
   options:[{t:"Use the other arm, or follow policy / ask the nurse.",ok:true,reply:"Smart, avoid drawing above an IV."},
     {t:"Draw right above the running IV.",ok:false,reply:"That contaminates the sample."},
     {t:"Stop the IV yourself.",ok:false,reply:"That's not your call."}],
   learn:"Avoid drawing above an active IV, it contaminates results. Use the other arm or follow policy / ask the nurse."}
];

/* ---------- economy / progression data ------------------------------------ */
export const BADGE_NAMES = {"first-shift":"🩺 First Shift","perfect":"🌟 Perfect Encounter","order-master":"🔢 Order Master","safety-star":"🛡️ Safety Star","shift-done":"✅ Shift Complete","trainee":"🎓 Trainee"};
export const DIFF_NAMES = ["Calm","Steady","Busy","Hectic","Expert"];

export const UPGRADES=[
  {id:"plant",icon:"🪴",name:"Little Plant",cost:15,desc:"A tiny plant makes the draw room feel less bare.",bonus:"cosmetic",kind:"decor"},
  {id:"poster",icon:"🖼️",name:"Calm Wall Poster",cost:20,desc:"Adds friendly education art to the back wall.",bonus:"professional",kind:"wall"},
  {id:"basket",icon:"🧺",name:"Organized Supply Basket",cost:30,desc:"Adds a neat prep basket and small tube/order bonus coins.",bonus:"organization",kind:"organization"},
  {id:"lamp",icon:"💡",name:"Warm Lamp",cost:35,desc:"Soft light warms up the room and looks lovely in dark mode.",bonus:"comfort",kind:"decor"},
  {id:"sunprint",icon:"🌤️",name:"Sunny Window Print",cost:40,desc:"A cheerful faux-window print for a room with no real view yet.",bonus:"comfort",kind:"wall"},
  {id:"chair",icon:"🛋️",name:"Comfy Patient Chair",cost:45,desc:"Adds cushiony chair pads for a friendlier patient experience.",bonus:"comfort",kind:"comfort"},
  {id:"plush",icon:"🧸",name:"Tiny Comfort Plush",cost:50,desc:"A sweet desk buddy that helps anxious-patient encounters feel cozier.",bonus:"comfort",kind:"comfort"},
  {id:"veinchart",icon:"📋",name:"Beginner Vein Chart",cost:55,desc:"Simple training wall art that feels professional, not scary.",bonus:"safety",kind:"wall"},
  {id:"certificate",icon:"📜",name:"Training Certificate",cost:60,desc:"Shows your clinic is becoming more official.",bonus:"safety",kind:"wall"},
  {id:"shelf",icon:"🧪",name:"Vial Display Shelf",cost:75,desc:"A neat collectible shelf for tube-color practice.",bonus:"organization",kind:"wall"},
  {id:"rug",icon:"🌈",name:"Cute Clinic Rug",cost:90,desc:"Softens the bare floor around the draw chair.",bonus:"comfort",kind:"decor"},
  {id:"aquarium",icon:"🐠",name:"Mini Aquarium",cost:120,desc:"A late-game cozy focal point for anxious patients.",bonus:"comfort",kind:"decor"},
  {id:"officeLease",icon:"🧱",name:"Bigger Office Lease",cost:150,desc:"Expands the tiny box office into a tidier clinic room with more wall space.",bonus:"cosmetic",kind:"office"},
  {id:"gallery",icon:"🎨",name:"Cozy Wall Gallery",cost:180,desc:"Adds a small set of friendly art pieces across the expanded wall.",bonus:"comfort",kind:"wall"},
  {id:"labSuite",icon:"🏥",name:"Cozy Lab Suite",cost:275,desc:"Moves you into a larger, warmer professional lab layout.",bonus:"cosmetic",kind:"office"},
  {id:"dreamRenovation",icon:"✨",name:"Dream Clinic Renovation",cost:450,desc:"Final roomy clinic shell with polished trim and lots of future decor space.",bonus:"cosmetic",kind:"office"}
];
export const ROOM_LEVELS=[
  {min:0,name:"Bare Box Office"},{min:3,name:"Tidy Clinic"},{min:7,name:"Cozy Draw Room"},{min:11,name:"Tiny Pro Lab"},{min:14,name:"Dream Clinic"}
];
export const UPGRADE_TAG={plant:"Decor",poster:"Decor",basket:"Organization",lamp:"Cozy",sunprint:"Decor",chair:"Comfort",plush:"Comfort",veinchart:"Safety",certificate:"Safety",shelf:"Organization",rug:"Cozy",aquarium:"Cozy",officeLease:"Upgrade",gallery:"Decor",labSuite:"Upgrade",dreamRenovation:"Upgrade"};

/* movable floor decor: grid placement system */
export const GRID_COLS=5, GRID_ROWS=7;
export const MOVABLE=["lamp","plant","rug","plush","basket","aquarium","stickerbook"];
export const MOVABLE_META={
  lamp:{icon:"💡",name:"Warm Lamp",r:0.40}, plant:{icon:"🪴",name:"Little Plant",r:0.32},
  rug:{icon:"🌈",name:"Clinic Rug",r:1.85}, plush:{icon:"🧸",name:"Comfort Plush",r:0.26},
  basket:{icon:"🧺",name:"Supply Basket",r:0.46}, aquarium:{icon:"🐠",name:"Mini Aquarium",r:0.78},
  stickerbook:{icon:"📔",name:"Sticker Book",r:0.46}
};
// sensible starting cells (gx 0..4 left->right, gz 0..6 front->back) — all clear of fixed furniture
export const DEFAULT_PLACEMENT={ lamp:[0,0], plant:[4,0], rug:[2,4], plush:[1,5], basket:[4,2], aquarium:[3,6], stickerbook:[0,5] };

/* movable WALL art: positions on back / left / right walls */
export const WALLS=["back","front","left","right"];
export const WALL_MOVABLE=["poster","sunprint","veinchart","certificate","gallery","shelf"];
export const WALL_COLS=6, WALL_ROWS=1;
// w = width along the wall, h = height (used for bounds + overlap so any size stays on the wall)
export const WALL_META={
  poster:{icon:"🖼️",name:"Calm Poster",w:1.47,h:1.57},
  sunprint:{icon:"🌤️",name:"Sunny Print",w:1.67,h:1.42},
  veinchart:{icon:"🩸",name:"Vein Chart",w:1.47,h:1.67},
  certificate:{icon:"📜",name:"Certificate",w:1.45,h:0.98},
  gallery:{icon:"🎨",name:"Gallery Trio",w:2.40,h:1.40},
  shelf:{icon:"🧫",name:"Display Shelf",w:2.05,h:0.60}
};
export const DEFAULT_WALL={
  gallery:["back",2,0], poster:["back",5,0],
  sunprint:["front",1,0], certificate:["front",4,0],
  veinchart:["left",2,0], shelf:["right",2,0]
};
export const WALL_EDGE=0.35, WALL_Y_LO=1.7;

// furniture tops you can stack small decor onto: {center, half-size, top height, biggest item radius that fits}
export const STACK_SURFACES=[
  {name:"desk",  x:-2.45,z:1.55, hw:1.16,hd:0.50, top:0.84, maxR:0.50}, // computer desk / counter
  {name:"supply",x:2.70, z:-1.70,hw:0.46,hd:0.33, top:0.96, maxR:0.34}, // supply stand
  {name:"bin",   x:-2.70,z:-1.90,hw:0.36,hd:0.36, top:0.82, maxR:0.32}  // sharps bin lid
];
// built-in props that already sit on a surface — decor must not overlap these
export const SURFACE_OBSTACLES=[
  {x:-2.45,z:1.35,hw:0.58,hd:0.42}, // computer monitor + stand on the desk
  {x:-2.45,z:1.80,hw:0.30,hd:0.24}, // reagent tray on the desk
  {x:2.70, z:-1.70,hw:0.26,hd:0.22}  // supply tote on the stand
];

/* ---------- sticker book ---------------------------------------------------
   `match` receives (patient, scores, pct, enc) — enc is the transient
   per-encounter state (ENC in the old monolith), passed explicitly rather
   than closed over, so this stays pure data with no game-state coupling.  */
export const STICKER_MILESTONES=[10,50,100,250];
export const STICKER_COINS={10:12,50:35,100:75,250:180};
export const STICKERS=[
  {id:"helped",   emoji:"🩷", name:"Patients Helped", blurb:"Every patient who ever sat in your chair. The heart of your little clinic.", match:()=>true},
  {id:"brave",    emoji:"🦁", name:"Brave Hearts", special:true, blurb:"Nervous or anxious patients you met with patience and calm.",
     match:(p)=>["Nervous","Anxious","Shy"].includes(p.mood) || (p.event&&p.event.type==="respond"&&/scared|faint|pass out|nervous|hurt|needle/i.test((p.event.lines||[]).join(" ")))},
  {id:"littleones",emoji:"🧸", name:"Little Ones", blurb:"Children and teens, handled gently and kindly.", match:(p)=>p.ageCat==="Child"||p.ageCat==="Teen"},
  {id:"golden",   emoji:"🌷", name:"Golden Years", blurb:"Older adults you cared for with warmth.", match:(p)=>p.ageCat==="Older adult"},
  {id:"orderace", emoji:"🧪", name:"Order Aces", blurb:"Multi-tube draws stacked in flawless order of draw — no additive carryover.", match:(p,s)=>!!s.orderOfDraw && p.reqSet.length>=2},
  {id:"perfect",  emoji:"⭐", name:"Perfect Rounds", special:true, blurb:"Encounters where every single step was right. Pristine specimen integrity.", match:(p,s,pct)=>pct===100},
  {id:"coldchain",emoji:"🧊", name:"Cold Chain", blurb:"Chilled specimens kept on ice, just as the analyte needs.", match:(p)=>p.handling==="chilled"},
  {id:"shielded", emoji:"🌙", name:"Light-Shielded", blurb:"Light-sensitive specimens protected from photodegradation.", match:(p)=>p.handling==="light"},
  {id:"steady",   emoji:"🩹", name:"Steady Hands", special:true, blurb:"Draw complications you recognized and handled safely.", match:(p,s,pct,enc)=>!!p.drawEvent && !!(enc&&enc.drawChoice)},
  {id:"sharpeye", emoji:"🔎", name:"Sharp Eyes", blurb:"Requisition errors you caught before a single tube was drawn.", match:(p,s)=>!!p.reqIssue && !!s.requisition}
];

/* ---------- misc shared constants ------------------------------------------ */
export const KEY = "phleb_shift_3d_v1";
export const LOBBY_MUSIC_PATH = "assets/audio/lobby.mp3";
export const FILL_MS = 5000, TQ_MS = 8800; // tube fill time, tourniquet timing window
