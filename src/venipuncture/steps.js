/* =========================================================================
   The 2D fallback venipuncture interactions — one render function per step
   id from procedureState.js's VP_STEP_DEFS. Each function receives:
     c        the current procedure state (persists across re-renders)
     stage    the DOM container to fill
     advance  call when the step's action is complete, to move to the next one
   None of these decide *sequencing* — they only render their own widget and
   flip their own boolean(s) on `c`. clinicalRules.js is the source of truth
   for whether an action is allowed to complete.
   ========================================================================= */
import { TUBES } from "../config.js";
import { $ } from "../dom.js";
import { FX } from "../fx.js";
import { sfx } from "../audio/audioManager.js";
import { makeDraggable, isNear } from "../input/touchInput.js";
import { VP_TIPS } from "./questions.js";
import { canReleaseTourniquet, canWithdrawNeedle, canActivateSafety, canDisposeSharps, canApplyPressure, canApplyBandage } from "./clinicalRules.js";
import { FILL_MS, TQ_MS } from "../config.js";

export function vpTubeDot(k){ return `<span class="vp-dot" style="background:#${TUBES[k].color.toString(16).padStart(6,'0')}"></span>`; }
function vpBtn(label,cls){ return `<button class="btn ${cls||''} vp-tap" id="vpAct">${label}</button>`; }

export const VP_STEPS = {
  hygiene(c,stage,advance){
    stage.innerHTML=`
      <div class="vp-tray">
        <div class="vp-tool" id="vpSan">🧴<span>sanitizer</span></div>
        <div class="vp-tool" id="vpGlove">🧤<span>gloves</span></div>
      </div>
      <div class="vp-status" id="vpMsg">Sanitize your hands, then glove up.</div>
      ${vpBtn("🧼 Sanitize & glove up","alt")}`;
    $("vpAct").onclick=()=>{
      sfx("good"); c.hygieneOk=true;
      const s=$("vpSan"),g=$("vpGlove"); if(s)s.classList.add("vp-check"); if(g)g.classList.add("vp-check");
      $("vpMsg").innerHTML="✅ Hands clean, gloves on.";
      setTimeout(advance,360);
    };
  },
  gather(c,stage,advance){
    const supplies=[
      {k:"gloves",emoji:"🧤",name:"Gloves"},{k:"tq",emoji:"🎀",name:"Tourniquet"},
      {k:"alcohol",emoji:"🧴",name:"Alcohol pad"},{k:"needle",emoji:"💉",name:"Needle"},
      {k:"holder",emoji:"🔧",name:"Holder"},{k:"gauze",emoji:"🩹",name:"Gauze"},
      {k:"bandage",emoji:"🩹",name:"Bandage"},{k:"sharps",emoji:"🗑️",name:"Sharps bin"}
    ];
    const tubeItems=c.tubes.map(k=>({k:"tube_"+k,name:TUBES[k].name,color:"#"+TUBES[k].color.toString(16).padStart(6,'0')}));
    const all=[...supplies,...tubeItems];
    c.gathered=c.gathered||{};
    stage.innerHTML=`
      <div class="vp-gather">
        ${all.map(it=>`<button class="vp-supply${c.gathered[it.k]?' vp-got':''}" data-k="${it.k}">${it.color?`<span class="vp-dot" style="background:${it.color}"></span>`:`<span class="vp-supply-emoji">${it.emoji}</span>`}<span class="vp-supply-name">${it.name}</span></button>`).join("")}
      </div>
      <div class="vp-status" id="vpMsg">Tap each item to load your tray. The tubes for this order appear in order of draw.</div>
      <button class="btn vp-tap" id="vpGatherDone" style="opacity:.5" disabled>Tray ready ▶</button>`;
    const msg=$("vpMsg"), doneBtn=$("vpGatherDone");
    const check=()=>{ if(all.every(it=>c.gathered[it.k])){ c.gatherOk=true; doneBtn.disabled=false; doneBtn.style.opacity=1;
      msg.innerHTML="✅ Tray fully stocked — nothing to run back for."; } };
    stage.querySelectorAll(".vp-supply").forEach(b=>{
      const k=b.dataset.k;
      b.onclick=()=>{ if(c.gathered[k])return; c.gathered[k]=true; b.classList.add("vp-got"); sfx("click");
        if(FX.gsap) FX.gsap.fromTo(b,{scale:.88},{scale:1,duration:.25,ease:"back.out(2.6)"}); check(); };
    });
    doneBtn.onclick=()=>{ if(doneBtn.disabled)return; sfx("tap"); advance(); };
    check();
  },
  assemble(c,stage,advance){
    stage.innerHTML=`
      <div class="vp-assemble">
        <div class="vp-holder" id="vpHolder"><div class="vp-hub"></div><span class="vp-lbl">tube holder</span></div>
        <div class="vp-needle" id="vpNeedle"><div class="vp-cap"></div><div class="vp-shaft"></div><span class="vp-lbl">needle — drag onto holder</span></div>
      </div>
      <div class="vp-status" id="vpMsg">The site is air-drying — assemble now. Drag the capped needle onto the holder until it threads in.</div>`;
    const needle=$("vpNeedle"), holder=$("vpHolder"), msg=$("vpMsg");
    makeDraggable(needle,{
      onMove(dx,dy){ needle.style.transform=`translate(${dx}px,${dy}px)`; needle.classList.toggle("vp-hot", isNear(needle,holder,90)); },
      onDrop(dx,dy){
        if(isNear(needle,holder,90)){
          c.assembleOk=true; sfx("good");
          needle.classList.remove("vp-hot");
          if(FX.gsap){ FX.gsap.to(needle,{x:0,y:0,duration:.25,ease:"back.out(2)",onComplete:()=>{needle.style.transform="";}}); }
          else needle.style.transform="";
          holder.classList.add("vp-assembled");
          msg.innerHTML="✅ Threaded and secure. Cap stays on for now.";
          setTimeout(advance,520);
        }else{
          if(FX.gsap) FX.gsap.to(needle,{x:0,y:0,duration:.4,ease:"elastic.out(1,.5)",onComplete:()=>{needle.style.transform="";}});
          else needle.style.transform="";
          msg.innerHTML="Bring the needle all the way onto the holder's hub.";
        }
      }
    });
  },
  tourniquet(c,stage,advance){
    stage.innerHTML=`
      <div class="vp-arm" id="vpArm">
        <div class="vp-zone" id="vpZone">tie 3–4″ above</div>
        <div class="vp-site"></div>
        <div class="vp-band" id="vpBand">🎀<span class="vp-lbl">drag the tourniquet up</span></div>
      </div>
      <div class="vp-status" id="vpMsg">Drag the tourniquet band up to the zone above the site.</div>`;
    const band=$("vpBand"), zone=$("vpZone"), msg=$("vpMsg");
    makeDraggable(band,{
      onMove(dx,dy){ band.style.transform=`translate(${dx}px,${dy}px)`; band.classList.toggle("vp-hot",isNear(band,zone,70)); },
      onDrop(){
        if(isNear(band,zone,70)){
          c.tourniquetOn=true; c.tqStart=performance.now(); sfx("good");
          band.classList.remove("vp-hot"); band.classList.add("vp-tied");
          if(FX.gsap){ FX.gsap.to(band,{x:0,y:0,duration:.2,onComplete:()=>{band.style.transform="";}});}else band.style.transform="";
          msg.innerHTML="✅ Snug, 3–4″ above. Timing has started — keep it under a minute.";
          setTimeout(advance,560);
        }else{
          if(FX.gsap) FX.gsap.to(band,{x:0,y:0,duration:.4,ease:"elastic.out(1,.5)",onComplete:()=>{band.style.transform="";}}); else band.style.transform="";
          msg.innerHTML="Place it in the highlighted zone above the draw site.";
        }
      }
    });
  },
  palpate(c,stage,advance){
    // median cubital = correct; artery pulses (trap), tendon is hard (trap), cephalic is a lesser option
    const shuffled=[
      {k:"median",label:"median cubital",ok:true,note:"Bouncy and well-anchored — the first-choice vein. 👍"},
      {k:"cephalic",label:"cephalic",ok:false,note:"Usable, but the median cubital is better anchored and safer first."},
      {k:"artery",label:"(pulsing)",ok:false,artery:true,note:"That's pulsing — it's the artery. Never target it."},
      {k:"tendon",label:"(hard cord)",ok:false,note:"That feels hard — it's a tendon, not a vein."}
    ].sort(()=>Math.random()-0.5);
    stage.innerHTML=`
      <div class="vp-arm vp-armbig" id="vpArm">
        <div class="vp-band vp-tied vp-bandfixed">🎀</div>
        ${shuffled.map((v,i)=>`<button class="vp-vein v-${v.k}" data-i="${i}">${v.artery?'💗':''}<span class="vp-veinlbl">${v.label}</span></button>`).join("")}
      </div>
      <div class="vp-status" id="vpMsg">Palpate and tap the best vein to draw from.</div>`;
    const msg=$("vpMsg");
    stage.querySelectorAll(".vp-vein").forEach(b=>{
      const v=shuffled[+b.dataset.i];
      b.onclick=()=>{
        if(v.ok){ b.classList.add("vp-good"); sfx("good"); c.veinOk=true; msg.innerHTML="✅ "+v.note; setTimeout(advance,620); }
        else { b.classList.add("vp-badpick"); sfx("bad"); msg.innerHTML="💡 "+v.note; c.veinOk=false; setTimeout(advance,900); }
      };
    });
  },
  clean(c,stage,advance){
    stage.innerHTML=`
      <div class="vp-arm" id="vpArm">
        <div class="vp-band vp-tied vp-bandfixed">🎀</div>
        <div class="vp-site vp-cleanzone" id="vpClean"><div class="vp-clean-fill" id="vpCleanFill"></div></div>
        <div class="vp-swab" id="vpSwab">🧽</div>
      </div>
      <div class="vp-status" id="vpMsg">Scrub the site with the alcohol swab — drag back and forth over it.</div>`;
    const swab=$("vpSwab"), zone=$("vpClean"), fill=$("vpCleanFill"), msg=$("vpMsg");
    let path=0, last=null, done=false;
    // Bug fix: the swab used to snap back to its starting position on every
    // pointer release, even mid-scrub. It now keeps whatever position the
    // player last dropped it at, matching the Phase 0 requirement that this
    // interaction "must retain its last dropped position rather than resetting."
    let curX=0, curY=0;
    makeDraggable(swab,{
      onStart(){ last=null; },
      onMove(dx,dy,e){
        swab.style.transform=`translate(${curX+dx}px,${curY+dy}px)`;
        if(isNear(swab,zone,58)){
          if(last) path+=Math.hypot(e.clientX-last.x,e.clientY-last.y);
          last={x:e.clientX,y:e.clientY};
          const pct=Math.min(100,path/240*100); if(fill) fill.style.width=pct+"%";
          if(pct>=100 && !done){ done=true; c.cleanOk=true; sfx("good"); zone.classList.add("vp-cleaned");
            msg.innerHTML="✅ Scrubbed — let it air-dry while you assemble the needle (don't re-touch)."; setTimeout(advance,700); }
        } else last=null;
      },
      onDrop(dx,dy){ curX+=dx; curY+=dy; if(!done) msg.innerHTML="Keep the swab on the site and scrub with friction."; }
    });
  },
  uncap(c,stage,advance){
    stage.innerHTML=`
      <div class="vp-capstage">
        <div class="vp-capneedle"><div class="vp-shaft"></div><div class="vp-bevel"></div></div>
        <div class="vp-bigcap" id="vpCap"><span class="vp-caparrow">➜</span><span class="vp-lbl">grab &amp; pull off</span></div>
      </div>
      <div class="vp-status" id="vpMsg">Grab the orange cap and drag it straight off to the side.</div>`;
    const cap=$("vpCap"), msg=$("vpMsg"); let done=false;
    makeDraggable(cap,{
      onStart(){ cap.querySelector(".vp-caparrow") && (cap.querySelector(".vp-caparrow").style.opacity="0"); },
      onMove(dx){ const x=Math.max(-16,dx); cap.style.transform=`translateX(${x}px)`; cap.style.opacity=Math.max(0.25,1-Math.max(0,x)/150);
        cap.classList.toggle("vp-hot", x>50); },
      onDrop(dx){
        if(done) return;
        if(dx>50){ done=true; c.uncapOk=true; sfx("good"); cap.classList.remove("vp-hot");
          if(FX.gsap) FX.gsap.to(cap,{x:250,opacity:0,rotate:14,duration:.34,ease:"power2.in"});
          else { cap.style.transform="translateX(250px)"; cap.style.opacity=0; }
          msg.innerHTML="✅ Cap off, bevel up. “Small poke coming!”"; setTimeout(advance,560);
        }else{
          if(FX.gsap) FX.gsap.to(cap,{x:0,opacity:1,duration:.35,ease:"back.out(2)",onComplete:()=>{cap.style.transform="";cap.style.opacity=1;}});
          else { cap.style.transform=""; cap.style.opacity=1; }
          cap.classList.remove("vp-hot");
          const ar=cap.querySelector(".vp-caparrow"); if(ar) ar.style.opacity="";
          msg.innerHTML="Give it a bigger pull to the side — straight off, never toward your hand.";
        }
      }
    });
  },
  insert(c,stage,advance){
    stage.innerHTML=`
      <div class="vp-arm vp-armbig" id="vpArm">
        <div class="vp-band vp-tied vp-bandfixed">🎀</div>
        <div class="vp-veinline"></div>
        <div class="vp-anglewedge"></div>
        <div class="vp-target" id="vpTarget"></div>
        <div class="vp-syringe" id="vpSyr">💉</div>
        <div class="vp-angle" id="vpAngle">angle: —</div>
      </div>
      <div class="vp-status" id="vpMsg">Drag the needle into the vein at a shallow 15–30° angle. Watch for the flash.</div>`;
    const syr=$("vpSyr"), target=$("vpTarget"), angEl=$("vpAngle"), msg=$("vpMsg");
    let done=false;
    makeDraggable(syr,{
      onMove(dx,dy){
        syr.style.transform=`translate(${dx}px,${dy}px) rotate(${Math.max(0,Math.min(60,Math.atan2(Math.max(0,dy),Math.max(6,dx))*180/Math.PI))}deg)`;
        const ang=Math.atan2(Math.max(0,dy),Math.max(6,dx))*180/Math.PI;
        const good=ang>=12&&ang<=32;
        if(angEl){ angEl.textContent="angle: "+Math.round(ang)+"°"; angEl.className="vp-angle "+(good?"vp-anglegood":"vp-anglebad"); }
        syr.classList.toggle("vp-hot", isNear(syr,target,64)&&good);
      },
      onDrop(dx,dy){
        if(done) return;
        const ang=Math.atan2(Math.max(0,dy),Math.max(6,dx))*180/Math.PI;
        const inTarget=isNear(syr,target,70);
        if(inTarget && ang>=12 && ang<=32){
          done=true; c.insertOk=true; c.angleQ="good"; sfx("good");
          target.classList.add("vp-flash"); msg.innerHTML="✅ Flash! You're in the vein at a clean angle.";
          if(FX.gsap) FX.gsap.to(syr,{scale:1.05,duration:.15,yoyo:true,repeat:1});
          setTimeout(advance,760);
        }else{
          c.angleQ = ang>32?"steep":(ang<12?"shallow":"miss");
          if(FX.gsap) FX.gsap.to(syr,{x:0,y:0,rotation:0,duration:.4,ease:"elastic.out(1,.6)",onComplete:()=>{syr.style.transform="";}}); else syr.style.transform="";
          if(angEl) angEl.className="vp-angle";
          msg.innerHTML = !inTarget ? "💡 Aim into the vein target." :
            ang>32 ? "💡 Too steep — you'd go through the vein. Flatter, 15–30°." :
                     "💡 Too shallow — you'd skim over it. A touch steeper, 15–30°.";
        }
      }
    });
  },
  fill(c,stage,advance){
    const k=c.tubes[0]||"red", col="#"+TUBES[k].color.toString(16).padStart(6,'0');
    stage.innerHTML=`
      <div class="vp-fillwrap">
        <div class="vp-holder vp-assembled"><div class="vp-hub"></div></div>
        <div class="vp-tube3d"><div class="vp-tubecap" style="background:${col}"></div><div class="vp-tubeband"></div><span class="vp-tubelbl">${TUBES[k].name}</span><div class="vp-fluid" id="vpFluid" style="background:${col}"></div></div>
      </div>
      <div class="vp-status" id="vpMsg">Seat the tube, then <b>stop at the fill line</b> for the right ratio.</div>
      ${vpBtn("⏹️ Stop at the fill line","gold")}`;
    const fluid=$("vpFluid"), msg=$("vpMsg");
    c.fillCur=0; c.t0=performance.now();
    let raf=null;
    const loop=()=>{ const t=performance.now()-c.t0; c.fillCur=Math.min(100,t/FILL_MS*100);
      if(fluid) fluid.style.height=c.fillCur+"%";
      if(c.fillCur>=100){ finish(100); return; } raf=requestAnimationFrame(loop); };
    const finish=(f)=>{ if(raf) cancelAnimationFrame(raf); c.fillFinal=f;
      const q=(f>=62&&f<=84)?"good":(f<62?"under":"over"); c.fillQ=q; c.fillGood=(q==="good");
      c.filled=c.filled||[]; c.filled.push(c.tubes[0]);
      msg.innerHTML = q==="good"?"✅ Filled right to the line.":q==="under"?"⚠️ A little underfilled — additive tubes need the full ratio.":"⚠️ Slightly overfilled — aim for the line.";
      sfx(q==="good"?"good":"click"); setTimeout(advance,700); };
    $("vpAct").onclick=()=>{ if(c.fillFinal!=null) return; finish(c.fillCur); };
    raf=requestAnimationFrame(loop);
    return ()=>{ if(raf) cancelAnimationFrame(raf); };
  },
  switch(c,stage,advance){
    const remaining=c.tubes.filter(k=>!(c.filled||[]).includes(k));
    if(!remaining.length){ c.tubeOrderOk=true; return advance(); }
    const nextCorrect=remaining[0]; // c.tubes already in order-of-draw
    stage.innerHTML=`
      <div class="vp-switch">
        <div class="vp-holder vp-assembled" id="vpSlot"><div class="vp-hub"></div><span class="vp-lbl">holder (needle steady)</span></div>
        <div class="vp-tuberow" id="vpRow">
          ${remaining.map(k=>`<div class="vp-tubepick" data-k="${k}" draggable="false">${vpTubeDot(k)}<span>${TUBES[k].name}</span></div>`).join("")}
        </div>
      </div>
      <div class="vp-status" id="vpMsg">Drag the next tube in the order of draw onto the holder. ${(c.filled||[]).length} filled so far.</div>`;
    const slot=$("vpSlot"), msg=$("vpMsg");
    stage.querySelectorAll(".vp-tubepick").forEach(pickEl=>{
      const k=pickEl.dataset.k;
      makeDraggable(pickEl,{
        onMove(dx,dy){ pickEl.style.transform=`translate(${dx}px,${dy}px)`; pickEl.classList.toggle("vp-hot",isNear(pickEl,slot,80)); },
        onDrop(){
          const onSlot=isNear(pickEl,slot,86);
          const resetPos=()=>{ if(FX.gsap) FX.gsap.to(pickEl,{x:0,y:0,duration:.35,ease:"back.out(2)",onComplete:()=>{pickEl.style.transform="";}}); else pickEl.style.transform=""; };
          if(!onSlot){ pickEl.classList.remove("vp-hot"); resetPos(); return; }
          if(k!==nextCorrect){ sfx("bad"); pickEl.classList.remove("vp-hot"); resetPos();
            c.tubeOrderOut=true; msg.innerHTML=`💡 That's out of order — ${TUBES[nextCorrect].name} was next.`;
            return;
          }
          sfx("good"); c.filled=c.filled||[]; c.filled.push(k); pickEl.classList.add("vp-filling");
          const col="#"+TUBES[k].color.toString(16).padStart(6,'0'); pickEl.style.setProperty("--fillcol",col);
          msg.innerHTML=`✅ ${TUBES[k].name} filling…`;
          setTimeout(()=>{ if(c.tubeOrderOk!==false && !c.tubeOrderOut) c.tubeOrderOk=true;
            const left=c.tubes.filter(x=>!(c.filled||[]).includes(x));
            if(left.length){ advance(true); } else { advance(); } }, 560); // advance(true) = re-render same step
        }
      });
    });
  },
  release(c,stage,advance){
    const elapsed=c.tqStart?(performance.now()-c.tqStart):0;
    stage.innerHTML=`
      <div class="vp-arm" id="vpArm"><div class="vp-band vp-tied vp-bandfixed" id="vpBand">🎀</div><div class="vp-site vp-cleaned"></div></div>
      <div class="vp-tqtimer"><div class="vp-tqbar" id="vpTqBar"></div><div class="vp-tqmark"></div></div>
      <div class="vp-status" id="vpMsg">Release the tourniquet <b>before</b> you withdraw the needle.</div>
      ${vpBtn("🎈 Release the tourniquet","mint")}`;
    const bar=$("vpTqBar"), msg=$("vpMsg");
    let raf=null;
    const loop=()=>{ const t=c.tqStart?(performance.now()-c.tqStart):0; const pct=Math.min(100,t/TQ_MS*100);
      if(bar){ bar.style.width=pct+"%"; bar.classList.toggle("vp-tqred",pct>70); } raf=requestAnimationFrame(loop); };
    $("vpAct").onclick=()=>{
      // Bug fix: releasing the tourniquet is now explicitly gated on confirmed
      // blood flash (canReleaseTourniquet), not just on the timer having run.
      if(!canReleaseTourniquet(c)){ sfx("bad"); msg.innerHTML="💡 Wait for blood flash before releasing the tourniquet."; return; }
      if(raf) cancelAnimationFrame(raf);
      const t=c.tqStart?(performance.now()-c.tqStart):0; const pct=Math.min(100,t/TQ_MS*100);
      c.tqGood=pct<=70; sfx(c.tqGood?"good":"click");
      const band=$("vpBand"); if(band){ band.classList.add("vp-released"); if(FX.gsap) FX.gsap.to(band,{x:40,opacity:0,duration:.3}); }
      msg.innerHTML=c.tqGood?"✅ Released in good time (under a minute).":"⚠️ It was on a while — release sooner to avoid hemoconcentration.";
      setTimeout(advance,640);
    };
    raf=requestAnimationFrame(loop);
    return ()=>{ if(raf) cancelAnimationFrame(raf); };
  },
  withdraw(c,stage,advance){
    stage.innerHTML=`
      <div class="vp-withdraw">
        <div class="vp-holder vp-assembled"><div class="vp-hub"></div><div class="vp-lasttube" id="vpLast">${vpTubeDot(c.tubes[c.tubes.length-1]||"red")}</div></div>
        <div class="vp-gauze" id="vpGauze">🩹 gauze</div>
      </div>
      <div class="vp-status" id="vpMsg">Take the last tube off first, then withdraw the needle over gauze.</div>
      <button class="btn ghost vp-tap" id="vpRemove">1 · Remove last tube</button>
      <button class="btn vp-tap" id="vpPull" disabled style="opacity:.5">2 · Withdraw needle</button>`;
    const msg=$("vpMsg"), removeBtn=$("vpRemove"), pull=$("vpPull");
    removeBtn.onclick=()=>{ c.lastTubeRemoved=true; sfx("click"); const last=$("vpLast"); if(last){ last.classList.add("vp-out"); if(FX.gsap) FX.gsap.to(last,{y:-30,opacity:0,duration:.3}); }
      removeBtn.disabled=true; removeBtn.style.opacity=.5; pull.disabled=false; pull.style.opacity=1;
      msg.innerHTML="Good — tube off. Now withdraw over gauze (gauze rests above the site; don't press yet — the needle's still in)."; };
    pull.onclick=()=>{
      // Bug fix: explicit gate via clinicalRules instead of an ad-hoc local flag.
      if(!canWithdrawNeedle(c)){ sfx("bad"); msg.innerHTML="💡 Remove the tube BEFORE the needle — order matters."; return; }
      c.withdrawOk=true; sfx("good"); const g=$("vpGauze"); if(g&&FX.gsap) FX.gsap.to(g,{scale:1.15,duration:.15,yoyo:true,repeat:1});
      msg.innerHTML="✅ Needle out, gauze laid over the site."; setTimeout(advance,560);
    };
  },
  safety(c,stage,advance){
    stage.innerHTML=`
      <div class="vp-safety">
        <div class="vp-needle vp-assembledneedle" id="vpNdl"><div class="vp-shaft"></div><div class="vp-bevel"></div><div class="vp-sheath" id="vpSheath"></div></div>
      </div>
      <div class="vp-status" id="vpMsg">Engage the safety device immediately — never recap by hand.</div>
      ${vpBtn("🛡️ Activate the safety shield","alt")}`;
    const msg=$("vpMsg");
    $("vpAct").onclick=()=>{
      if(!canActivateSafety(c)){ sfx("bad"); msg.innerHTML="💡 Withdraw the needle first."; return; }
      c.safetyOk=true; sfx("good"); const sh=$("vpSheath"); if(sh){ sh.classList.add("vp-engaged"); if(FX.gsap) FX.gsap.fromTo(sh,{width:"0%"},{width:"100%",duration:.3});}
      msg.innerHTML="✅ Shield locked. Safe to handle."; setTimeout(advance,520);
    };
  },
  // Bug fix: dispose now runs immediately after safety and BEFORE pressure/bandage
  // (see procedureState.js's VP_STEP_DEFS order) — "point of use" disposal.
  dispose(c,stage,advance){
    stage.innerHTML=`
      <div class="vp-dispose">
        <div class="vp-needle vp-assembledneedle vp-used" id="vpUsed"><div class="vp-shaft"></div><span class="vp-lbl">drag to sharps →</span></div>
        <div class="vp-sharps" id="vpSharps">🗑️<span class="vp-lbl">SHARPS</span></div>
      </div>
      <div class="vp-status" id="vpMsg">Drag the whole used needle unit into the sharps container — right now, before pressure or a bandage.</div>`;
    const used=$("vpUsed"), bin=$("vpSharps"), msg=$("vpMsg");
    makeDraggable(used,{
      onMove(dx,dy){ used.style.transform=`translate(${dx}px,${dy}px)`; used.classList.toggle("vp-hot",isNear(used,bin,80)); bin.classList.toggle("vp-open",isNear(used,bin,80)); },
      onDrop(){
        if(!canDisposeSharps(c)){ sfx("bad"); msg.innerHTML="💡 Activate the safety device first."; return; }
        if(isNear(used,bin,86)){ c.disposeOk=true; sfx("good");
          if(FX.gsap) FX.gsap.to(used,{x:0,y:0,scale:0,opacity:0,duration:.3,ease:"power2.in"}); else { used.style.opacity=0; }
          bin.classList.add("vp-dropped"); msg.innerHTML="✅ Disposed at point of use. Never recap."; setTimeout(advance,560);
        }else{ if(FX.gsap) FX.gsap.to(used,{x:0,y:0,duration:.4,ease:"elastic.out(1,.5)",onComplete:()=>{used.style.transform="";}}); else used.style.transform="";
          used.classList.remove("vp-hot"); bin.classList.remove("vp-open"); msg.innerHTML="Drop it right into the sharps container."; }
      }
    });
  },
  pressure(c,stage,advance){
    stage.innerHTML=`
      <div class="vp-arm" id="vpArm"><div class="vp-site vp-cleaned"></div><div class="vp-pressgauze" id="vpPg">🩹</div></div>
      <div class="meter"><div class="bar" id="vpPBar" style="background:linear-gradient(90deg,var(--mint),var(--blue))"></div></div>
      <div class="vp-status" id="vpMsg">Press and hold to keep firm pressure on the site.</div>
      <button class="btn mint hold vp-tap" id="vpPress">🩹 Hold to apply pressure</button>`;
    const bar=$("vpPBar"), press=$("vpPress"), msg=$("vpMsg");
    if(!canApplyPressure(c)){ msg.innerHTML="💡 Dispose of the sharps unit first."; press.disabled=true; press.style.opacity=.5; return; }
    let holdStart=null, raf=null; const HOLD_MS=1200;
    const loop=()=>{ if(holdStart!=null){ const pct=Math.min(100,(performance.now()-holdStart)/HOLD_MS*100);
        if(bar)bar.style.width=pct+"%";
        if(pct>=100){ c.pressureOk=true; msg.innerHTML="✅ Bleeding controlled."; sfx("good");
          press.textContent="✔ Pressure held — continue ▶"; press.onclick=()=>{ sfx("tap"); advance(); }; holdStart=null; return; } }
      raf=requestAnimationFrame(loop); };
    const start=e=>{ e.preventDefault(); if(c.pressureOk)return; holdStart=performance.now(); };
    const end=()=>{ if(c.pressureOk||holdStart==null)return; holdStart=null; if(bar)bar.style.width="0%"; if(msg)msg.textContent="Hold a little longer — firm, steady pressure."; };
    press.addEventListener("pointerdown",start); press.addEventListener("pointerup",end); press.addEventListener("pointerleave",end);
    raf=requestAnimationFrame(loop);
    return ()=>{ if(raf) cancelAnimationFrame(raf); };
  },
  bandage(c,stage,advance){
    stage.innerHTML=`
      <div class="vp-arm" id="vpArm"><div class="vp-site vp-cleaned" id="vpSite"></div></div>
      <div class="vp-status" id="vpMsg">Apply the bandage and give aftercare advice.</div>
      ${vpBtn("🩹 Apply bandage","gold")}`;
    const msg=$("vpMsg");
    if(!canApplyBandage(c)){ msg.innerHTML="💡 Hold pressure first."; }
    $("vpAct").onclick=()=>{
      if(!canApplyBandage(c)){ sfx("bad"); msg.innerHTML="💡 Hold pressure first."; return; }
      c.bandageOk=true; sfx("good"); const site=$("vpSite"); if(site){ site.classList.add("vp-banded"); site.textContent="🩹"; if(FX.gsap) FX.gsap.from(site,{scale:0,duration:.3,ease:"back.out(2)"}); }
      msg.innerHTML="✅ Bandaged. “Keep it on ~15 min; tell us about any swelling or numbness.”"; setTimeout(advance,620);
    };
  },
  invert(c,stage,advance){
    const additive=c.tubes.filter(k=>TUBES[k].additive && !/None/i.test(TUBES[k].additive));
    const list = additive.length?additive:c.tubes.slice();
    const target=6;
    c.invCounts=c.invCounts||{};
    stage.innerHTML=`
      <div class="vp-invert" id="vpInv">
        ${list.map(k=>`<button class="vp-invtube" data-k="${k}">${vpTubeDot(k)}<span class="vp-invlbl">${TUBES[k].name}</span><span class="vp-invn" data-n="${k}">0/${target}</span></button>`).join("")}
      </div>
      <div class="vp-status" id="vpMsg">Tap each additive tube to gently invert it ${target}× — never shake.</div>
      <button class="btn vp-tap" id="vpDoneInv" style="opacity:.5" disabled>Done mixing ▶</button>`;
    const msg=$("vpMsg"), doneBtn=$("vpDoneInv");
    const check=()=>{ const all=list.every(k=>(c.invCounts[k]||0)>=target); if(all){ c.mixOk=true; doneBtn.disabled=false; doneBtn.style.opacity=1; msg.innerHTML="✅ All mixed gently — additives activated, no hemolysis."; } };
    stage.querySelectorAll(".vp-invtube").forEach(b=>{
      const k=b.dataset.k;
      b.onclick=()=>{
        const n=(c.invCounts[k]||0)+1; c.invCounts[k]=n; sfx("click");
        const nEl=b.querySelector(".vp-invn"); if(nEl) nEl.textContent=Math.min(n,target)+"/"+target;
        if(FX.gsap) FX.gsap.fromTo(b,{rotation:0},{rotation:180,duration:.32,ease:"power1.inOut",onComplete:()=>{FX.gsap.set(b,{rotation:0});}});
        if(n>=target){ b.classList.add("vp-mixed"); } check();
      };
    });
    doneBtn.onclick=()=>{ if(doneBtn.disabled) return; sfx("tap"); advance(); };
    check();
  }
};
