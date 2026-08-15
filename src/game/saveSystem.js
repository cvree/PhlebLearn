import { DIFF_NAMES } from "../config.js";
import { SS, saveSS, MODES } from "./gameState.js";
import { CHALLENGES } from "./challenges.js";

/* =========================================================================
   THE CHOSEN CHALLENGE LOADOUT, kept on the save so it survives a reload.

   Lives here rather than in the picker, because there are two pickers' worth
   of readers now: the Settings overlay writes it, the clock-in screen states
   it, and `startShift()` transfers it into `armChallenges()`. Filtering
   against the real CHALLENGES table on every read means a loadout saved
   before a challenge was renamed cannot arm something that no longer exists.
   ========================================================================= */
export function chosenChallenges(){
  if(!Array.isArray(SS.challenges)) SS.challenges = [];
  const ids = new Set(CHALLENGES.map(c => c.id));
  SS.challenges = SS.challenges.filter(id => ids.has(id));
  return SS.challenges;
}

/** Turns one challenge on or off. Returns the new list. */
export function toggleChallenge(id){
  const list = chosenChallenges();
  const at = list.indexOf(id);
  if(at >= 0) list.splice(at, 1); else list.push(id);
  saveSS();
  return list;
}

/* =========================================================================
   SAVE MIGRATION.

   The game shipped with four modes and now has two. A learner who put twenty
   draws through Practice must not open the new build to a blank record, so
   the progress recorded under the removed keys is FOLDED IN rather than
   dropped: Practice and the Bench were both ways of being taught, so their
   history joins Learn's, and the Final Practical was Play under its old name.

   Idempotent, and safe to run on a save that has already been migrated or was
   never in the old shape at all — which is what makes it safe to call
   unconditionally at boot.
   ========================================================================= */
const MODE_MERGES = [
  ["practice", MODES.LEARN],
  ["bench", MODES.LEARN],
  ["final", MODES.PLAY],
];

export function migrateSave(save){
  const s = save || SS;
  const prog = s.modeProgress;
  if(!prog || typeof prog !== "object") return s;

  MODE_MERGES.forEach(([from, to])=>{
    const old = prog[from];
    if(!old) return;
    delete prog[from];
    const cur = prog[to];
    if(!cur){ prog[to] = old; return; }
    // Two records for what is now one mode: keep the better best, add the
    // attempts, and interleave the histories by when they actually happened.
    cur.attempts = (cur.attempts || 0) + (old.attempts || 0);
    cur.passes = (cur.passes || 0) + (old.passes || 0);
    if(old.bestTotal != null && (cur.bestTotal == null || old.bestTotal > cur.bestTotal)){
      cur.bestTotal = old.bestTotal;
      if(old.bestPct != null) cur.bestPct = old.bestPct;
      if(old.bestAt != null) cur.bestAt = old.bestAt;
    }
    if(old.bestByCategory){
      cur.bestByCategory = cur.bestByCategory || {};
      Object.entries(old.bestByCategory).forEach(([k, v])=>{
        if(cur.bestByCategory[k] == null || v > cur.bestByCategory[k]) cur.bestByCategory[k] = v;
      });
    }
    const history = [...(cur.history || []), ...(old.history || [])]
      .sort((a, b)=>(a.at || 0) - (b.at || 0));
    cur.history = history.slice(-10);
  });
  return s;
}

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
