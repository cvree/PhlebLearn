/* Ephemeral UI feedback: toast messages, confetti, floating XP, click sparks.
   Filed under ui/ because that's the domain, but treated as a dependency LEAF
   (like dom.js) — it must never import from panels.js/coachLayer.js/settings.js
   or anything in game/world/venipuncture/input, precisely so every other layer
   can safely call toast()/confetti() without creating an import cycle. */
import { $ } from "../dom.js";
import { REDUCED } from "../game/gameState.js";

export function toast(msg){
  let t=document.createElement("div");
  t.textContent=msg;
  // top offset clears the top bar, and the top bar clears the notch
  t.style.cssText="position:absolute;top:calc(60px + var(--safe-t));left:50%;transform:translateX(-50%);z-index:25;background:#2b2740;color:#fff;padding:8px 14px;border-radius:12px;font-weight:800;font-size:13px;box-shadow:var(--shadow);max-width:88%;text-align:center;animation:slideUp .25s ease both";
  $("app").appendChild(t); setTimeout(()=>t.remove(),2200);
}

const CONF_COLORS=["#ff9cc0","#bcd6f7","#c7e9b0","#ffd98a","#c9b3e8","#5fbf8b","#5aa9f0"];
export function confetti(n){
  if(REDUCED)return;
  n=n||44; const app=$("app"); if(!app)return;
  for(let i=0;i<n;i++){
    const p=document.createElement("div"); p.className="confpiece";
    const left=Math.random()*100, dx=(Math.random()*2-1)*40, dur=1.2+Math.random()*1.4;
    p.style.left=left+"vw";
    p.style.background=CONF_COLORS[i%CONF_COLORS.length];
    p.style.setProperty("--dx",dx+"vw");
    p.style.setProperty("--rot",(Math.random()*720-360)+"deg");
    p.style.setProperty("--dur",dur+"s");
    if(Math.random()<.5)p.style.borderRadius="50%";
    app.appendChild(p); setTimeout(()=>p.remove(),dur*1000+200);
  }
}

export function floatXP(text){
  if(REDUCED){ toast(text); return; }
  const app=$("app"); if(!app)return;
  const d=document.createElement("div"); d.className="floatxp"; d.textContent=text;
  d.style.right="calc(16px + var(--safe-r))"; d.style.top="calc(48px + var(--safe-t))";
  app.appendChild(d); setTimeout(()=>d.remove(),1200);
}

// react-bits: ClickSpark — a little burst of sparks at the pointer
export function clickSpark(x,y,hue){
  if(REDUCED) return;
  const app=$("app"); if(!app) return;
  const n=8, base=(hue==null?265:hue);
  for(let i=0;i<n;i++){
    const s=document.createElement("div"); s.className="clickspark";
    const ang=(Math.PI*2/n)*i + Math.random()*0.4, dist=16+Math.random()*16;
    s.style.left=x+"px"; s.style.top=y+"px";
    s.style.setProperty("--sx",(Math.cos(ang)*dist).toFixed(1)+"px");
    s.style.setProperty("--sy",(Math.sin(ang)*dist).toFixed(1)+"px");
    s.style.background=`hsl(${base+i*10},85%,64%)`;
    app.appendChild(s); setTimeout(()=>s.remove(),520);
  }
}
