/* =========================================================================
   Conversational layer: every step has a voice. Patients speak for human
   moments; Dot (your coworker) guides bench steps. Decisions play out as:
   speak -> respond -> they react -> you learn.

   This module owns the dialogue *state machine* (lines -> choose -> reaction)
   and renders it into the shared panel — but it does NOT import the top-level
   UI dispatcher (that would create ui/ <-> game/ cycle). Instead, callers in
   ui/panels.js pass their own render function in as `cfg.rerender`, so this
   module only ever calls back into whichever screen invoked it.
   ========================================================================= */
import { $, panel } from "../dom.js";
import { shuffle } from "../utils.js";
import { ENC, guided } from "./gameState.js";
import { sfx } from "../audio/audioManager.js";

export const DOT = {name:"Dot",emoji:"🩸"};
export const MOOD_EMOJI = {Calm:"🙂",Nervous:"😬",Chatty:"😄",Tired:"😴",Cheerful:"😊",Shy:"😳",Anxious:"😰",Curious:"🤔",Grumpy:"😒",Brave:"😤",Sleepy:"🥱",Bubbly:"🤗",Quiet:"😐",Impatient:"🙄",Stoic:"😑"};
export function pEmoji(p){ return MOOD_EMOJI[p.mood]||"🙂"; }

export function says(who,emoji,text,sub){
  const dot = who===DOT.name ? " dot" : "";
  return `<div class="dlg"><div class="ava${dot}">${emoji}</div><div class="bubble"><div class="who">${who}${sub?` • ${sub}`:""}</div>${text}</div></div>`;
}

/* beginner-friendly lesson content shown before each step in Teaching mode */
/* =========================================================================
   THE TWO LESSONS THAT STILL HAVE A SCREEN.

   There were eleven, numbered "Step 1" through "Step 8", from a flow where a
   draw was eight multiple-choice screens. Nine of those screens are gone —
   identity, tube selection, order of draw, collection, labelling and handling
   are all things the learner physically DOES now, and a lesson attached to a
   screen that no longer exists is dead text with a step number on it that
   never matched anything again.

   Site selection and the professional response are the two that remain, and
   neither is a numbered step in a procedure: one is a judgement about the
   arms in front of you, the other is a conversation. So neither is numbered.
   ========================================================================= */
export const LESSONS = {
  site:{h:"Choosing a site",what:"Look at both arms and choose a safe vein — the median cubital in the antecubital fossa is the first choice.",why:"The wrong site causes failed draws, unusable samples, or patient harm.",tip:"Avoid the IV side, mastectomy side, fistula/graft arm, hematomas, scarring, edema, and fresh tattoos."},
  respond:{h:"Answering the patient",what:"Respond kindly, and safely — those are not in tension.",why:"Communication and safety matter as much as technical accuracy.",tip:"Patient safety first: stop if they feel faint, and never skip identification under pressure."}
};

export function teach(key){
  if(!guided()||!LESSONS[key])return "";
  const l=LESSONS[key];
  return `<div class="lesson"><span class="modetag">🎓 TEACHING MODE</span>
    <span class="lh">${l.h}</span>
    ${l.what}<br><span class="why">Why it matters: ${l.why}</span><br><span class="tip">💡 ${l.tip}</span></div>`;
}

export function showHint(box,msg){ clearHint(box); const d=document.createElement("div"); d.className="fb no teachhint"; d.innerHTML="💡 "+msg; box.appendChild(d); }
export function clearHint(box){ const h=box&&box.querySelector(".teachhint"); if(h)h.remove(); }

// option chooser: forgiving in teach mode (retry on wrong), records-and-advances in play mode
export function optionStep(options,onAccept,teachWhy){
  const box=$("opts"); box.innerHTML="";
  shuffle(options).forEach((o,i)=>{
    const b=document.createElement("button"); b.className="opt"; b.textContent=o.t;
    b.style.animationDelay=(i*55)+"ms";
    b.onclick=()=>{
      if(guided()){
        if(o.ok){ b.classList.add("good"); sfx("good"); clearHint(box); setTimeout(()=>onAccept(o),320); }
        else { b.classList.add("bad"); sfx("bad"); showHint(box, teachWhy||"Not quite, choose the safest, most correct option, then try again."); }
      } else { sfx(o.ok?"good":"bad"); onAccept(o); }
    };
    box.appendChild(b);
  });
}

// generic decision dialogue used by verify / requisition / handling / site.
// cfg.rerender is required: a zero-arg callback that redraws the calling screen
// (e.g. renderVerify) so this module never has to import the ui/ dispatcher.
export function runDialogue(stepKey,cfg){
  if(!ENC.dlg || ENC.dlg.step!==stepKey) ENC.dlg={step:stepKey,phase:"lines",idx:0,chosen:null,options:null};
  const d=ENC.dlg;
  const head=cfg.head||"";
  const lines=(cfg.lines&&cfg.lines.length)?cfg.lines:[""];
  const speak=t=>says(cfg.who,cfg.emoji,t,cfg.sub);
  if(d.phase==="lines"){
    panel.innerHTML=head+(cfg.extra||"")+speak(lines[d.idx])+
      `<button class="btn alt" id="dnext">${d.idx<lines.length-1?"▶ …":(cfg.respondLabel||"💬 Respond")}</button>`;
    $("dnext").onclick=()=>{ sfx("tap"); if(d.idx<lines.length-1)d.idx++; else d.phase="choose"; cfg.rerender(); };
    return;
  }
  if(d.phase==="choose"){
    if(!d.options) d.options=cfg.options;
    panel.innerHTML=head+(cfg.extra||"")+speak(lines[lines.length-1])+
      `<p class="sub">${cfg.prompt||"What do you do?"}</p><div id="opts"></div>`;
    const box=$("opts");
    shuffle(d.options).forEach((o,i)=>{
      const b=document.createElement("button"); b.className="opt"; b.textContent=o.t; b.style.animationDelay=(i*55)+"ms";
      b.onclick=()=>{
        if(guided() && !o.ok){ b.classList.add("bad"); sfx("bad");
          showHint(box,(o.reply?('Reaction: "'+o.reply+'", '):"")+(cfg.teachWhy||"Try the safest, most correct option.")); return; }
        b.classList.add(o.ok?"good":"bad"); sfx(o.ok?"good":"bad"); d.chosen=o; d.phase="reaction"; setTimeout(()=>cfg.rerender(),280);
      };
      box.appendChild(b);
    });
    return;
  }
  // reaction + takeaway
  const o=d.chosen;
  const rw=cfg.reactWho||cfg.who, re=cfg.reactEmoji||cfg.emoji;
  panel.innerHTML=head+says(rw,re,(o.reply||(o.ok?"Nice work.":"Hmm, let's reconsider.")),cfg.sub)+
    `<div class="learn"><b>📚 You learned:</b> ${cfg.learn||cfg.teachWhy||""}</div>
     <button class="btn" id="ddone">Continue ▶</button>`;
  $("ddone").onclick=()=>{ sfx("tap"); const done=cfg.onDone; ENC.dlg=null; done(o); };
}
