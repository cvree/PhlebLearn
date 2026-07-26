import { DIFF_NAMES } from "../config.js";
import { SS, saveSS } from "./gameState.js";

export function addXP(n){ SS.xp+=n; }
export function addCoins(n){ SS.coins+=n; if(n>0) SS.earned=(SS.earned||0)+n; }

// Difficulty rises with lifetime coins earned. Same loop every time — just more
// complications and trickier picks as the player gets more practiced.
export function difficultyLevel(){ const e=SS.earned||0; return e<60?0 : e<150?1 : e<320?2 : e<560?3 : 4; }
export function difficultyName(){ return DIFF_NAMES[difficultyLevel()]||"Calm"; }

// Coins are the reward. Higher score pays more (and harder cases pay more); a fast,
// solid finish adds a speed bonus; a perfect adds a flat bonus; decor adds its bonus.
export function coinPayout(pct, catCount, elapsedMs, upgradeCoins){
  const dl=difficultyLevel();
  const score=Math.round(pct/100*(8+dl*2));
  const sec=Math.round((elapsedMs||0)/1000);
  const par=40+(catCount||7)*6;
  const speed=(pct>=60&&sec>0&&sec<par)?Math.min(5,Math.round((par-sec)/par*6)):0;
  const perfect=(pct===100)?5:0;
  const upgrade=upgradeCoins||0;
  return {score,speed,perfect,upgrade,par,sec,total:score+speed+perfect+upgrade};
}

export function bumpMastery(link,correct){
  if(!link||!link.cardId)return;
  const id=link.cardId, cur=SS.mastery[id]||0;
  SS.mastery[id]=Math.max(0,Math.min(100,cur+(correct?6:-8)));
  if(!correct){ if(!SS.weak.includes(id))SS.weak.push(id); }
  else { if(SS.mastery[id]>=50)SS.weak=SS.weak.filter(x=>x!==id); }
}

export function awardBadge(id){ if(!SS.badges.includes(id))SS.badges.push(id); }
