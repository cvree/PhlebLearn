/* Patient + scenario generation — pure data assembly, no rendering. */
import { TUBES, TESTS, TEST_NAMES, EVENTS, REQ_ISSUES, DRAW_EVENTS, SKIN_TONES, HAIR_NATURAL,
  HAIR_BOLD, HAIR_SENIOR, HAIR_STYLES, FABRIC, SHIRTS, MOODS, FIRST, LAST } from "../config.js";
import { pad, randInt, pick, shuffle } from "../utils.js";
import { difficultyLevel } from "./saveSystem.js";

export function makeAppearance(ageCat){
  const child=ageCat==="Child", teen=ageCat==="Teen", older=ageCat==="Older adult";
  const skin=pick(SKIN_TONES);
  let hairColor = older?pick(HAIR_SENIOR) : ((teen||child)&&Math.random()<0.3?pick(HAIR_BOLD):pick(HAIR_NATURAL));
  let styles = child?["short","buzz","ponytail","bun","cap"] : HAIR_STYLES;
  const hair=pick(styles);
  let height = (child?0.6: teen?0.86: older?0.94: 1.0)*(0.95+Math.random()*0.12);
  const width = pick(child?[0.78,0.9]:[0.82,1.0,1.0,1.18,1.36])*(0.96+Math.random()*0.08);
  const glasses = Math.random() < (older?0.5:0.28);
  let facial="none";
  if(!child && !teen && Math.random()<0.3) facial=pick(["beard","mustache","stubble"]);
  return {skin,hairColor,hair,height,width,glasses,facial,accent:pick(FABRIC)};
}

export function inferEventWhen(event){
  if(!event || event.type!=="respond") return null;
  if(event.when) return event.when;
  const txt=(event.lines||[]).join(" ").toLowerCase();
  // safety-critical and setup-relevant information belongs before the draw
  if(event.safety) return "pre";
  if(/result|results|arm hurt|sore|bruise|bruising|bandage|pressure|after/i.test(txt)) return "post";
  return "pre";
}

/* site selection & vein assessment, a deep, randomized decision bag.
   Each arm gets a random condition; the correct call is derived from them.   */
export function makeSiteScenario(dl){
  dl=dl||0; const hb=dl*0.04; // hard bias: shrink the easy bands as difficulty climbs
  const clear={key:"clear",sev:"clear",obs:"healthy, visible veins"};
  const conds=[
    // ABSOLUTE, that arm is never an option
    {key:"fistula", sev:"absolute",obs:"a dialysis AV fistula",           note:"Never draw from an arm with an AV fistula or graft."},
    {key:"mastectomy",sev:"absolute",obs:"a prior mastectomy on that side", note:"Avoid the arm on the side of a mastectomy or lymph-node removal."},
    {key:"cast",    sev:"absolute",obs:"a cast and heavy bandaging",      note:"A casted arm can't be accessed."},
    // RELATIVE, avoid, but a careful alternative on that arm exists
    {key:"iv",      sev:"relative",obs:"an IV line running at the bend",  note:"Don't draw above an IV.", alt:"draw below the IV site"},
    {key:"hematoma", sev:"relative",obs:"a hematoma over the usual vein",  note:"Don't draw through a hematoma.", alt:"choose a vein away from the bruise"},
    {key:"scarred", sev:"relative",obs:"scarring over the usual vein",    note:"Avoid scarred or sclerosed spots.", alt:"find an unscarred vein"},
    {key:"tattoo",  sev:"relative",obs:"a fresh tattoo over the bend",    note:"Avoid drawing through a fresh tattoo.", alt:"use a clear patch of skin"},
    {key:"edema",   sev:"relative",obs:"mild localized swelling",         note:"Avoid edematous tissue.", alt:"use a non-swollen site"},
    // TRICKY, looks hard but is perfectly usable (trap: don't over-escalate)
    {key:"deep",    sev:"tricky",obs:"deeper veins you can't see but can feel", note:"Veins you can palpate are fine, locate them by feel.", use:"palpate to locate the vein, then use the antecubital"},
    {key:"dry",     sev:"tricky",obs:"slightly flat veins (a little dehydrated)",note:"Mildly flat veins are still usable.", use:"proceed with the antecubital; warm the site if needed"},
    {key:"hairy",   sev:"tricky",obs:"hair on the arm but good veins underneath",note:"Hair isn't a contraindication.", use:"proceed with the antecubital vein"}
  ];
  const byS=s=>conds.filter(c=>c.sev===s);
  const pickUniq=(arr,not)=>{let c=pick(arr),g=0;while(not&&c.key===not.key&&g++<6)c=pick(arr);return c;};
  const r=Math.random(); let L,R;
  if(r<0.10-hb*0.5){ L=clear; R=clear; }
  else if(r<0.42-hb){ const c=pick(conds.filter(x=>x.sev==="absolute"||x.sev==="relative")); if(Math.random()<0.5){L=c;R=clear;}else{L=clear;R=c;} }
  else if(r<0.58-hb){ const c=pick(byS("tricky")); if(Math.random()<0.5){L=c;R=clear;}else{L=clear;R=c;} }
  else if(r<0.80){ const a=pick(byS("absolute")), rel=pick(byS("relative")); if(Math.random()<0.5){L=a;R=rel;}else{L=rel;R=a;} }
  else if(r<0.90){ const a=byS("absolute"); L=pick(a); R=pickUniq(a,L); }
  else { const rl=byS("relative"); L=pick(rl); R=pickUniq(rl,L); }

  const usable=a=>a.sev==="clear"||a.sev==="tricky";
  const desc=`You assess both arms.<br><b>Left arm:</b> ${L.obs}.<br><b>Right arm:</b> ${R.obs}.`;
  let options, learn;
  const Lu=usable(L), Ru=usable(R);

  if(Lu&&Ru){
    const trickySide = L.sev==="tricky"?"left":(R.sev==="tricky"?"right":null);
    const clearSide = L.sev==="clear"?"left":(R.sev==="clear"?"right":null);
    if(trickySide && clearSide){
      const tc = trickySide==="left"?L:R;
      options=shuffle([
        {t:`Use the ${clearSide} arm, choosing the straightforward healthy median cubital site.`,ok:true,reply:"Good choice: start with the easiest healthy antecubital vein."},
        {t:`Use the ${trickySide} arm because ${tc.obs}.`,ok:false,reply:"That vein may be usable, but the clear healthy arm is the beginner-friendly best choice."},
        {t:`Skip straight to a hand vein.`,ok:false,reply:"The healthy antecubital site is still first choice."}
      ]);
      learn=`When one arm has healthy visible veins and the other is a trickier but palpable option, choose the straightforward healthy median cubital site first. ${tc.note}`;
    }else if(trickySide){
      const tc = trickySide==="left"?L:R;
      options=shuffle([
        {t:`Use the ${trickySide} arm, ${tc.use}.`,ok:true,reply:"Right, that's a usable vein, not a contraindication."},
        {t:`Ask the nurse, it's too risky to attempt.`,ok:false,reply:"No need to escalate; that vein is fine."},
        {t:`Skip straight to a hand vein.`,ok:false,reply:"The antecubital is still first choice here."}
      ]);
      learn=`${tc.note} Don't over-escalate, this is a normal, usable vein.`;
    }else{
      options=shuffle([
        {t:`Either arm, choose the median cubital (antecubital) vein.`,ok:true,reply:"Yep, antecubital first."},
        {t:`Go straight to a vein on the back of the hand.`,ok:false,reply:"Antecubital is the first choice when available."},
        {t:`Pick an arm at random without looking.`,ok:false,reply:"Always assess the veins first."}
      ]);
      learn=`When both arms are healthy, the median cubital vein in the antecubital fossa is the preferred first-choice site.`;
    }
  } else if(Lu||Ru){
    const good=Lu?"left":"right", bad=Lu?"right":"left", goodC=Lu?L:R, badC=Lu?R:L;
    const goodVerb = goodC.sev==="tricky" ? goodC.use : "the median cubital (antecubital) vein";
    options=shuffle([
      {t:`Use the ${good} arm, ${goodVerb}.`,ok:true,reply:"Good, the suitable arm."},
      {t:`Use the ${bad} arm despite ${badC.obs}.`,ok:false,reply:"That arm should be avoided."},
      {t:`Pick an arm without checking either one.`,ok:false,reply:"Always assess both arms first."}
    ]);
    learn=`${badC.note} Use the other arm.`;
  } else {
    const Labs=L.sev==="absolute", Rabs=R.sev==="absolute";
    if(Labs&&Rabs){
      options=shuffle([
        {t:`Neither arm is usable, ask the nurse / use an approved alternate site per policy.`,ok:true,reply:"Right, both are off-limits; escalate."},
        {t:`Use the left arm despite ${L.obs}.`,ok:false,reply:"That arm is absolutely off-limits."},
        {t:`Use the right arm despite ${R.obs}.`,ok:false,reply:"That arm is absolutely off-limits."}
      ]);
      learn=`${L.note} ${R.note} When both arms are absolutely contraindicated, don't improvise, escalate.`;
    }else{
      const relSide=L.sev==="relative"?"left":"right", absSide=L.sev==="absolute"?"left":"right";
      const relC=L.sev==="relative"?L:R, absC=L.sev==="absolute"?L:R;
      options=shuffle([
        {t:`Use the ${relSide} arm carefully, ${relC.alt}.`,ok:true,reply:"Right, the other arm is never an option, so work around the lesser issue."},
        {t:`Use the ${absSide} arm despite ${absC.obs}.`,ok:false,reply:"That arm is absolutely off-limits."},
        {t:`Refuse the draw entirely.`,ok:false,reply:"There's still a workable site, don't refuse."}
      ]);
      learn=`${absC.note} Since that arm is never an option, use the other arm carefully: ${relC.alt}. Escalate only if you truly can't.`;
    }
  }
  return {desc, options, learn, why:learn, safety:true};
}

export function makePatient(){
  const first=pick(FIRST), last=pick(LAST);
  let decoyLast=pick(LAST); let g=0; while(decoyLast===last && g++<6) decoyLast=pick(LAST);
  const yr=randInt(1935,2024), mo=randInt(1,12), da=randInt(1,28);
  const id=(last[0]+first[0]).toUpperCase()+pad(randInt(10000,99999),5);
  const age=2026-yr;
  const ageCat= age<=12?"Child": age<=19?"Teen": age>=65?"Older adult":"Adult";
  const dl=difficultyLevel();
  // more tubes at higher difficulty makes order-of-draw harder, without changing the steps
  const nOrders = dl>=4 ? randInt(2,3) : dl>=2 ? randInt(1,3) : randInt(1,2);
  const orders=shuffle(TEST_NAMES).slice(0,nOrders);
  const event=pick(EVENTS);
  const eventWhen = event.type==="respond" ? inferEventWhen(event) : null;
  // required tubes (unique), sorted by canonical order of draw
  const reqSet=[...new Set(orders.map(o=>TESTS[o].tube))];
  reqSet.sort((a,b)=>TUBES[a].order-TUBES[b].order);
  // handling priority: light > chilled > routine
  let handling="routine";
  if(orders.some(o=>TESTS[o].handling==="light"))handling="light";
  else if(orders.some(o=>TESTS[o].handling==="chilled"))handling="chilled";
  // complication rates climb with difficulty (requisition flaw, draw event, site scenario)
  const reqIssue = Math.random() < (0.34+dl*0.06) ? pick(REQ_ISSUES) : null;
  const provider = pick(["Dr. Alvarez","Dr. Chen","Dr. Okafor","Dr. Patel","Dr. Romano","Dr. Singh"]);
  const drawPool = DRAW_EVENTS.filter(e=>!/IV running/i.test((e.lines||[]).join(" ")));
  const drawEvent = Math.random() < (0.26+dl*0.05) ? pick(drawPool) : null;  // a high-level draw complication to recognize and handle
  return {first,last,decoyLast,name:first+" "+last,dob:pad(mo,2)+"/"+pad(da,2)+"/"+yr,id,age,ageCat,
    mood:pick(MOODS),orders,reqSet,handling,event,eventWhen,reqIssue,provider,drawEvent,site:(Math.random() < (0.28+dl*0.05) ? makeSiteScenario(dl) : null),appearance:makeAppearance(ageCat),shirt:pick(SHIRTS)};
}
