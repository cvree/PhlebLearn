/* The "why it matters" coaching cards shown on the score screen — passed the
   FEEDBACK/CARD_LINKS lookup plus a scoreDetailAnswer() function (from
   game/scoring.js) so this stays a pure renderer with no game-logic of its
   own. Kept separate from panels.js because it's coaching content, not
   screen-flow control. */
import { CARD_LINKS } from "../config.js";
import { FEEDBACK } from "../game/scoring.js";

export function fbCard(c, ok, scoreDetailAnswer, onReviewClick){
  const f=FEEDBACK[c], link=CARD_LINKS[c];
  const a = scoreDetailAnswer(c,ok);
  const status = ok ? "Correct interaction" : "Needs review";
  const ansHTML = a ? `<div class="ans">${a.ctx?`<span class="ansrow ctx">${a.ctx}</span>`:""}<span class="ansrow ${ok?'correct':'you'}">Encounter result: <b>${status}</b></span><span class="ansrow ${ok?'correct':'you'}">Your answer: <b>${a.your||", "}</b></span><span class="ansrow correct">Best answer: <b>${a.correct||", "}</b></span></div>` : "";
  const d=document.createElement("div"); d.className="fb"+(ok?"":" no");
  d.innerHTML=`<b>${ok?'✓':'✗'} ${f.label}</b>${ansHTML}<br>
    <span class="why">Why it matters: ${f.why}</span><br>
    <span class="tip">💡 ${f.tip}</span><br>
    <span class="why">Related study topic: ${link.topic}${link.cardId?` (card ${link.cardId})`:""}</span>
    <button class="opt" style="margin-top:6px;border-style:dashed">📚 Review in Learn Mode</button>`;
  d.querySelector(".opt").onclick=onReviewClick;
  return d;
}
