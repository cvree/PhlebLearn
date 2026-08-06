/* Room/upgrade progression rules — pure logic over SS. No THREE, no DOM.
   Side effects (toast, sfx, re-rendering the 3D room or the shop overlay)
   belong to the UI layer that calls these functions, not to this module. */
import { UPGRADES, ROOM_LEVELS, UPGRADE_TAG, STICKERS, STICKER_MILESTONES, STICKER_COINS } from "../config.js";
import { SS, saveSS } from "./gameState.js";
import { addCoins } from "./saveSystem.js";

export function normalizeUpgrades(){
  if(!Array.isArray(SS.ownedUpgrades)) SS.ownedUpgrades=[];
  SS.ownedUpgrades=[...new Set(SS.ownedUpgrades)];
}
export function hasUpgrade(id){
  if(id==="stickerbook") return true;
  normalizeUpgrades();
  return SS.ownedUpgrades.includes(id);
}
export function ownedUpgradeCount(){ normalizeUpgrades(); return SS.ownedUpgrades.length; }
export function upgradeTag(u){ return UPGRADE_TAG[u.id] || "Decor"; }
export function roomLevelIndex(){ const n=ownedUpgradeCount(); let idx=0; ROOM_LEVELS.forEach((x,i)=>{ if(n>=x.min) idx=i; }); return idx; }
export function getRoomLevel(){ const n=ownedUpgradeCount(); let lvl=ROOM_LEVELS[0]; ROOM_LEVELS.forEach(x=>{ if(n>=x.min) lvl=x; }); return lvl; }
export function nextRoomLevel(){ const n=ownedUpgradeCount(); return ROOM_LEVELS.find(x=>x.min>n)||null; }

export function getOfficeTier(){
  if(hasUpgrade("dreamRenovation")) return 3;
  if(hasUpgrade("labSuite")) return 2;
  if(hasUpgrade("officeLease")) return 1;
  return 0;
}
export function currentRoomSpec(){
  const tier=getOfficeTier();
  return [
    // Vertical room: depth (front to back) is now the long axis, width is narrow, ceiling is taller.
    {tier:0,w:7.2, d:10.4,h:6.5,camMin:3.2, camMax:7.5, wall:0xdfe4ef,side:0xe6dde8,floor:0xcfc8d8,trim:0xbcb4ca,target:{x:0,y:1.2,z:0.45}},
    {tier:1,w:8.6, d:12.4,h:6.7,camMin:3.4, camMax:8.5, wall:0xe2e8f4,side:0xeadfec,floor:0xd5ccdf,trim:0xb9bfd3,target:{x:0,y:1.22,z:0.3}},
    {tier:2,w:10.0,d:15.0,h:7.0,camMin:3.6, camMax:9.6, wall:0xe6edf6,side:0xefe2eb,floor:0xd9d0e2,trim:0xaebfd0,target:{x:0,y:1.26,z:0.1}},
    {tier:3,w:11.6,d:18.0,h:7.4,camMin:3.85,camMax:10.6,wall:0xeaf1f7,side:0xf1e4ed,floor:0xded4e5,trim:0xaec8ce,target:{x:0,y:1.3,z:-0.05}}
  ][tier];
}

// Returns a result descriptor; the UI layer decides how to react (toast/sfx/re-render).
export function buyUpgrade(id){
  normalizeUpgrades();
  const up=UPGRADES.find(u=>u.id===id);
  if(!up) return {ok:false,reason:"unknown"};
  if(hasUpgrade(id)) return {ok:false,reason:"owned",upgrade:up};
  if(SS.coins<up.cost) return {ok:false,reason:"cant-afford",upgrade:up,short:up.cost-SS.coins};
  SS.coins-=up.cost; SS.ownedUpgrades.push(id); saveSS();
  return {ok:true,upgrade:up};
}

/* =========================================================================
   EQUIPMENT — the upgrades that change what the learner can DO.

   Every other upgrade in the shop is the room: it changes how the clinic
   looks and pays a coin bonus. These four change the draw itself, and each
   one does it by moving a number some branch is ALREADY reading rather than
   by adding a special case to it:

     butterflyKit   the device stops being dictated by the patient's arms and
                    becomes the learner's choice — including the wrong choice,
                    which the report then has something to say about.
     veinFinder     deep veins become visible through the skin. It does not
                    palpate them for you: `feltChosen` is still what the
                    rubric grades, so the light finds a vein and the fingers
                    still have to confirm it.
     warmingPack    raises the arm's own `vigour`, which is the number vein
                    distension, fill rate and flash all already depend on.
     pediatricKit   scales tube volume, which is what decides whether a
                    vacuum pulls a narrow vein shut against the bevel.

   Pure reads over SS. No THREE, no DOM.
   ========================================================================= */

/** Multiplier on the patient's own venous filling, from the warming pack. */
export function vigourBonus(){
  return hasUpgrade("warmingPack") ? 1.18 : 1;
}

/** Tube stock on the cart: 1 is standard, 0.45 the paediatric kit. */
export function tubeVolumeScale(){
  return hasUpgrade("pediatricKit") ? 0.45 : 1;
}

/** Whether the learner may pick the device rather than being handed one. */
export function canChooseProcedure(){
  return hasUpgrade("butterflyKit");
}

/** Whether deep veins are visible through the skin before they are felt. */
export function hasVeinFinder(){
  return hasUpgrade("veinFinder");
}

/** Everything the kit currently changes, as one object for the report. */
export function equipmentInEffect(){
  return {
    butterflyKit: canChooseProcedure(),
    veinFinder: hasVeinFinder(),
    warmingPack: hasUpgrade("warmingPack"),
    pediatricKit: hasUpgrade("pediatricKit"),
    vigourBonus: vigourBonus(),
    tubeVolumeScale: tubeVolumeScale(),
  };
}

export function upgradeBonusForEncounter(p,s){
  let coins=0, notes=[];
  const comfortCase = (p.mood==="Nervous") || (p.event&&p.event.type==="respond"&&/scared|needles|pass out|faint|hurt|bruise/i.test((p.event.lines||[]).join(" ")));
  const safetyCase = (p.event&&p.event.safety) || !!p.drawEvent || !!p.site;
  if(s.tubeSelect && s.orderOfDraw && (hasUpgrade("basket")||hasUpgrade("shelf"))){ coins+=1; notes.push("+1 organization"); }
  if(s.professional && comfortCase && (hasUpgrade("chair")||hasUpgrade("plush")||hasUpgrade("lamp")||hasUpgrade("rug")||hasUpgrade("aquarium")||hasUpgrade("sunprint")||hasUpgrade("gallery"))){ coins+=1; notes.push("+1 comfort"); }
  if(s.safety && safetyCase && (hasUpgrade("certificate")||hasUpgrade("poster")||hasUpgrade("veinchart"))){ coins+=1; notes.push("+1 safety"); }
  return {coins,notes};
}

/* ---------- sticker book: collectible tallies of patients helped ---------- */
export function stickerCount(id){ return (SS.stickers&&SS.stickers[id])||0; }
export function isStickerClaimed(id,m){ return !!(SS.stickerClaimed&&SS.stickerClaimed[id+":"+m]); }
export function nextMilestone(count){ return STICKER_MILESTONES.find(m=>count<m)||null; }
export function stickerTotals(){
  let earned=0, coins=0, kinds=0;
  STICKERS.forEach(st=>{ const c=stickerCount(st.id); if(c>0)kinds++; STICKER_MILESTONES.forEach(m=>{ if(c>=m){earned++; coins+=STICKER_COINS[m]||0;} }); });
  return {earned,coins,kinds,total:STICKERS.length};
}
// called once per scored patient — increments matching stickers and pays milestone coins.
// `enc` is passed explicitly (not closed over) so STICKERS.match stays pure data-driven.
export function recordStickers(p,s,pct,enc){
  if(!SS.stickers) SS.stickers={};
  if(!SS.stickerClaimed) SS.stickerClaimed={};
  const wins=[];
  STICKERS.forEach(st=>{
    let hit=false; try{ hit=!!st.match(p,s,pct,enc); }catch(e){ hit=false; }
    if(!hit) return;
    const c=(SS.stickers[st.id]||0)+1; SS.stickers[st.id]=c;
    STICKER_MILESTONES.forEach(m=>{
      if(c>=m && !SS.stickerClaimed[st.id+":"+m]){
        SS.stickerClaimed[st.id+":"+m]=true;
        const coins=STICKER_COINS[m]||0;
        addCoins(coins);
        wins.push({st,m,coins});
      }
    });
  });
  return wins;
}
