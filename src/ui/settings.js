/* Settings overlay + office upgrade shop + sticker book. Consolidated into
   one file (rather than three) because they're all "overlay panels reached
   from the settings-adjacent floating buttons" — see docs/ARCHITECTURE.md
   for the full module-boundary rationale. */
import { $ } from "../dom.js";
import { UPGRADES, STICKER_MILESTONES, STICKER_COINS } from "../config.js";
import { SS, DARK, REDUCED, setReduced, saveSS } from "../game/gameState.js";
import { sfx } from "../audio/audioManager.js";
import { musicOn, toggleMusic, setMusicVol, musicVolNow, updateMusicBtn } from "../audio/audioManager.js";
import { toast } from "./notifications.js";
import { overlayOpened, overlayClosed } from "./overlayFocus.js";
import {
  hasUpgrade, ownedUpgradeCount, getRoomLevel, roomLevelIndex, nextRoomLevel, upgradeTag, buyUpgrade,
  stickerCount, nextMilestone, stickerTotals
} from "../game/progression.js";
import { STICKERS } from "../config.js";
import { toggleTheme } from "../rendering/materials.js";
import { updateRoomUpgrades, arrangeStart, arrangeStop, arrangeIsOpen } from "../world/room.js";
import { CHALLENGES } from "../game/challenges.js";
import { chosenChallenges, toggleChallenge } from "../game/saveSystem.js";
import { loadoutLocked } from "../game/activeChallenges.js";
/* One-directional: panels.js does not import this file, so this is not a
   cycle. It exists because the clock-in screen STATES the loadout that
   Settings now chooses — arming a challenge and closing the overlay has to
   leave the terms of the next shift visible on the screen behind it. */
import { refreshIdle } from "./panels.js";

/* ---------- settings overlay ---------------------------------------------- */
export function syncSettingsLabels(){
  const t=$("setTheme"); if(t){ t.textContent=DARK?"On":"Off"; t.classList.toggle("on",DARK); }
  const m=$("setMotion"); if(m){ const on=!REDUCED; m.textContent=on?"On":"Off"; m.classList.toggle("on",on); }
  const u=$("setMusic"); if(u){ u.textContent=musicOn?"On":"Off"; u.classList.toggle("on",musicOn); }
  const sv=$("setMusicVol"); if(sv){ sv.value=Math.round(musicVolNow()*100); }
  const h=$("setHand"); if(h){ const left=SS.handedness==="left"; h.textContent=left?"Left":"Right"; h.classList.toggle("on",left); }
  const sn=$("setSnap"); if(sn){ const on=!!SS.assistedSnapping; sn.textContent=on?"On":"Off"; sn.classList.toggle("on",on); }
  const dm=$("setDirect"); if(dm){ const on=!SS.buttonControls; dm.textContent=on?"Direct":"Buttons"; dm.classList.toggle("on",on); }
  renderChallengePicker();
}

/* =========================================================================
   MAKE IT HARDER — the technique challenges, moved here from clock-in.

   Every entry takes something away: the coach, the magnetism, the vein
   finder, the hand you are used to. Nothing here makes a draw easier, which
   is what lets a challenge run be worth more (see game/challenges.js for the
   two invariants that keep the bonus honest).

   THE ONE THING THAT MADE THIS MOVE NON-TRIVIAL. The loadout is armed once,
   in startShift(), BEFORE the first patient is rolled — "Deep vein" changes
   the arm that roll produces. Clock-in was unreachable during a draw; Settings
   opens on Esc at any moment. So while a shift is running the picker is
   read-only and says so. Toggling comes back the moment there is no draw for
   an edit to reach.
   ========================================================================= */
export function renderChallengePicker(){
  const host = $("setChallenges");
  if(!host) return;
  const on = new Set(chosenChallenges());
  const locked = loadoutLocked();
  const mult = [...on].reduce((m, id) => m*(CHALLENGES.find(c => c.id===id) || {bonus:1}).bonus, 1);

  host.innerHTML = `
    <summary>⚡ Make it harder${on.size ? ` <b>· ${on.size} on · ×${mult.toFixed(2)}</b>` : ""}</summary>
    <p class="ssub">Every one of these takes something away, so a challenge run is always
       worth more — and stacking them multiplies.</p>
    ${locked ? `<p class="ssub locked-note">A shift is running. Changes apply to your next one.</p>` : ""}
    <div class="chal-chips">
      ${CHALLENGES.map(c => `
        <button class="chal-chip${on.has(c.id) ? " on" : ""}" data-chal="${c.id}"
                aria-pressed="${on.has(c.id)}" ${locked ? "disabled" : ""} title="${c.blurb}">
          ${c.label} <span class="chal-mult">×${c.bonus.toFixed(2)}</span>
        </button>`).join("")}
    </div>`;

  if(locked) return;
  host.querySelectorAll("[data-chal]").forEach(btn=>{
    btn.onclick = ()=>{ toggleChallenge(btn.dataset.chal); sfx("click"); renderChallengePicker(); };
  });
}

/**
 * Direct manipulation, or buttons for everything.
 *
 * This is an ACCESS preference and it belongs here, which is the whole point
 * of moving it. It used to be a per-step toggle inside the collection panel
 * that wrote itself to the save — so one tap of "Use controls" during one
 * tube made every future tube in every future draw a list of buttons, and the
 * 3D bench the game is built around was never seen again.
 */
export function toggleButtonControls(){
  SS.buttonControls = !SS.buttonControls;
  saveSS(); syncSettingsLabels(); sfx("tap");
}
export function toggleReduced(){ setReduced(!REDUCED); syncSettingsLabels(); sfx("tap"); }
// Handedness is not cosmetic: it mirrors the staging zones, the tray and the
// sharps reach zone (see venipuncture/staging/stagingLayout.js).
export function toggleHandedness(){ SS.handedness = SS.handedness==="left"?"right":"left"; saveSS(); syncSettingsLabels(); sfx("tap"); }
export function toggleAssistedSnapping(){ SS.assistedSnapping = !SS.assistedSnapping; saveSS(); syncSettingsLabels(); sfx("tap"); }
export function openSettings(){ const o=$("settings"); if(o){ o.classList.add("show"); syncSettingsLabels(); overlayOpened(o, "Settings"); } }
export function closeSettings(){ const o=$("settings"); if(o){ o.classList.remove("show"); overlayClosed(o); } refreshIdle(); }
export function toggleSettings(){ const o=$("settings"); if(!o)return; o.classList.contains("show")?closeSettings():openSettings(); }
export function toggleMusicAndSync(){ toggleMusic(); syncSettingsLabels(); }
export function toggleThemeAndSync(){ toggleTheme(); syncSettingsLabels(); }

/* =========================================================================
   HOW THIS WORKS — the one thing a first-time player was never told.

   This game is a physical simulation wearing a cozy coat, and the clock-in
   screen used to offer two mode buttons and no way of knowing that the arm on
   screen is a thing you DRAG, that a step can also be worked entirely from
   buttons, or which of the two modes a beginner should be in. Everything
   below is a fact about how to operate the game — not a tutorial, not a tour,
   and not a wall the player has to click through: it opens once on a fresh
   save and lives in Settings after that.
   ========================================================================= */
export function helpOpen(){ const o=$("helpOverlay"); return !!(o && o.classList.contains("show")); }
export function closeHelp(){
  const o=$("helpOverlay");
  if(o){ o.classList.remove("show"); overlayClosed(o); }
  /* Marked as seen on the way OUT rather than on the way in, so a player who
     reloads while it is open still gets it. */
  if(!SS.seenHelp){ SS.seenHelp = true; saveSS(); }
  refreshIdle();
}
export function openHelp(){
  const o=$("helpOverlay"), box=$("helpContent");
  if(!o || !box) return;
  box.innerHTML = `
    <div class="help-head">
      <h3>🩸 How this works</h3>
      <button class="shop-close" id="helpClose">Got it</button>
    </div>

    <div class="help-lede">You do the draw — you are not answering questions about
      it. The band is tied by pulling it, the vein is found with a fingertip, and
      the angle you enter at is measured in degrees.</div>

    <div class="help-row">
      <span class="help-ico">🖐️</span>
      <div><b>Work in the room.</b> Drag on the scene: pick a thing up, bring it
      where it goes, push it home. Turn an item over to read its label.</div>
    </div>
    <div class="help-row">
      <span class="help-ico">🎛️</span>
      <div><b>Or use buttons.</b> Steps carry a <b>Use controls</b> toggle —
      <b>Use a list</b> at the supply cart. Same work, graded the same.</div>
    </div>
    <div class="help-row">
      <span class="help-ico">🎓</span>
      <div><b>Start in Learn.</b> It names the error and will not let you past a
      step until it is right. <b>Play</b> says nothing until the report.</div>
    </div>
    <div class="help-row">
      <span class="help-ico">🩹</span>
      <div><b>Things go wrong on purpose,</b> because of something you did.
      Stopping the draw is often the right answer.</div>
    </div>

    <div class="help-keys">
      <span><b>Esc</b> settings</span>
      <span><b>🔄 Recenter</b> puts the camera back</span>
      <span><b>🗔</b> hides the panel</span>
    </div>`;
  o.classList.add("show");
  overlayOpened(o, "How this works");
  const c=$("helpClose"); if(c) c.onclick=()=>{ sfx("tap"); closeHelp(); };
}

/**
 * Opens it once, on a save that has never played. Called from the clock-in
 * screen rather than from boot, so it lands after the room has appeared
 * instead of over a loading screen.
 */
export function maybeOpenHelp(){
  if(SS.seenHelp || SS.shifts || SS.xp) return false;
  openHelp();
  return true;
}

/* ---------- upgrade shop ---------------------------------------------------- */
export function renderUpgradeShop(){
  const overlay=$("shopOverlay"), box=$("shopContent"); if(!overlay||!box)return;
  const count=ownedUpgradeCount(), level=getRoomLevel(), lvIdx=roomLevelIndex(), next=nextRoomLevel();
  const pct=Math.min(100,count/UPGRADES.length*100);
  const nextUp=UPGRADES.find(u=>!hasUpgrade(u.id));
  const rows=UPGRADES.map(u=>{
    const owned=hasUpgrade(u.id), afford=SS.coins>=u.cost, gap=u.cost-SS.coins;
    const status = owned ? `<span class="tag owned">✅ Owned</span>`
      : afford ? `<button class="tag buy" data-buy="${u.id}">Buy</button>`
      : `<span class="tag need">Need ${gap}</span>`;
    return `<div class="shop-item ${owned?'owned':''}">
      <div class="shop-ico">${u.icon}</div>
      <div class="shop-body">
        <div class="shop-title">${u.name}</div>
        <div class="shop-desc">${u.desc}</div>
        <div class="shop-tags"><span class="tag cat">${upgradeTag(u)}</span><span class="tag cost">🪙 ${u.cost}</span>${status}</div>
      </div></div>`;
  }).join("");
  box.innerHTML=`<div class="shop-head"><h3>🛍️ Office upgrades</h3><button class="shop-close" id="shopClose">Done</button></div>
    <div class="shop-intro">Spend coins from patient interactions to turn the bare office into a cozy little draw room. Purchased items appear in the 3D room and stay saved on this device.</div>
    <div class="roomlevel"><span class="rl-name">🏠 Lv.${lvIdx+1} ${level.name}</span><div class="levelbar"><span style="width:${pct}%"></span></div><span class="rl-count">${count}/${UPGRADES.length}</span></div>
    <div class="shop-pills"><span class="pill">🪙 Coins ${SS.coins}</span><span class="pill">⭐ XP ${SS.xp}</span></div>
    ${nextUp?`<div class="shop-next">Next: 🔒 ${nextUp.name} (${nextUp.cost})</div>`:`<div class="shop-next">🎉 Every upgrade owned!</div>`}
    <button class="shop-next" id="arrangeBtn" style="cursor:pointer;border-color:var(--plum);color:var(--plum)">🧩 Rearrange the room</button>
    <div class="shop-list">${rows}</div>`;
  overlay.classList.add("show");
  overlayOpened(overlay, "Office upgrades");
  $("shopClose").onclick=()=>{ sfx("tap"); closeUpgradeShop(); };
  const ab=$("arrangeBtn"); if(ab) ab.onclick=()=>{ sfx("tap"); closeUpgradeShop(); arrangeStart(); };
  box.querySelectorAll("[data-buy]").forEach(btn=>btn.onclick=()=>{
    const result=buyUpgrade(btn.dataset.buy);
    if(result.ok){ updateRoomUpgrades(); renderUpgradeShop(); sfx("coin"); }
    else if(result.reason==="owned"){ toast("Already owned: "+result.upgrade.name); }
    else if(result.reason==="cant-afford"){ sfx("bad"); toast("Need "+result.short+" more coins for "+result.upgrade.name+"."); }
  });
}
export function closeUpgradeShop(){ const overlay=$("shopOverlay"); if(overlay){ overlay.classList.remove("show"); overlayClosed(overlay); } }

/* ---------- sticker book ---------------------------------------------------- */
export function stickerBookOpen(){ const o=$("stickerOverlay"); return !!(o&&o.classList.contains("show")); }
export function openStickerBook(){ const o=$("stickerOverlay"); if(!o)return; renderStickerBook(); o.classList.add("show"); overlayOpened(o, "Sticker book"); }
export function closeStickerBook(){ const o=$("stickerOverlay"); if(o){ o.classList.remove("show"); overlayClosed(o); } }
function renderStickerBook(){
  const host=$("stickerContent"); if(!host) return;
  const tot=stickerTotals();
  const tile=(st)=>{
    const c=stickerCount(st.id);
    const nm=nextMilestone(c);
    const maxed=(nm===null);
    const locked=(c===0);
    const prevM = nm ? (STICKER_MILESTONES[STICKER_MILESTONES.indexOf(nm)-1]||0) : STICKER_MILESTONES[STICKER_MILESTONES.length-1];
    const pct = maxed ? 100 : Math.round(((c-prevM)/(nm-prevM))*100);
    const pips = STICKER_MILESTONES.map(m=>{
      const done=c>=m, isNext=(m===nm);
      return `<span class="sb-pip ${done?'done':''} ${isNext?'next':''}">${done?'★':'☆'} ${m}</span>`;
    }).join("");
    const nextLine = maxed
      ? `🏆 All milestones complete — fully collected!`
      : `Next: <b>${nm}</b> for <b>+${STICKER_COINS[nm]}🪙</b> · ${nm-c} to go`;
    return `<div class="sb-tile ${locked?'locked':''} ${maxed?'maxed':''} ${st.special?'special':''}" data-st="${st.id}">
      ${st.special?`<span class="sb-ribbon">${maxed?'COMPLETE':'SPECIAL'}</span>`:(maxed?`<span class="sb-ribbon">COMPLETE</span>`:"")}
      <div class="sb-emoji">${st.emoji}</div>
      <div class="sb-name">${st.name}</div>
      <div class="sb-count"><span class="lbl">collected</span> ${c}</div>
      <div class="sb-bar"><span style="width:${pct}%"></span></div>
      <div class="sb-pips">${pips}</div>
      <div class="sb-next">${nextLine}</div>
      <div class="sb-blurb">${st.blurb}</div>
    </div>`;
  };
  const specials=STICKERS.filter(s=>s.special), tallies=STICKERS.filter(s=>!s.special);
  host.innerHTML=`
    <div class="sb-cover">
      <button class="sb-close" id="sbClose" aria-label="Close sticker book">✕</button>
      <h3>📔 Sticker Book</h3>
      <p class="sb-tagline">A cozy keepsake of every patient your little clinic has helped 🩷</p>
      <div class="sb-stats">
        <span class="sb-stat">🌟 ${tot.earned} milestones</span>
        <span class="sb-stat">📚 ${tot.kinds}/${tot.total} kinds started</span>
        <span class="sb-stat">🪙 ${tot.coins} earned</span>
      </div>
    </div>
    <div class="sb-section">✨ Special Patients</div>
    <div class="sb-grid">${specials.map(tile).join("")}</div>
    <div class="sb-section">📈 Patient Tallies</div>
    <div class="sb-grid">${tallies.map(tile).join("")}</div>
    <div class="sb-foot">Tap any sticker to read its story · milestones at 10 · 50 · 100 · 250 pay coins</div>
  `;
  const cl=$("sbClose"); if(cl) cl.onclick=()=>{ sfx("tap"); closeStickerBook(); };
  host.querySelectorAll(".sb-tile").forEach(el=>{
    el.onclick=()=>{ el.classList.toggle("open"); sfx("tap"); };
  });
}

export { arrangeStop, arrangeIsOpen };
