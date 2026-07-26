/* Web Audio sfx beeps + the lobby music track. No DOM beyond the music button
   label, no dependency on ui/ — ui/settings.js calls into this and re-syncs
   its own labels afterward. */
import { LOBBY_MUSIC_PATH } from "../config.js";
import { SS, saveSS, state } from "../game/gameState.js";

let actx=null;
export function sfx(kind){
  try{
    actx=actx||new (window.AudioContext||window.webkitAudioContext)();
    const t=actx.currentTime, o=actx.createOscillator(), g=actx.createGain();
    const map={good:[660,880],bad:[300,180],tap:[440,440],coin:[880,1320],win:[523,784],click:[520,520]};
    const f=map[kind]||map.tap;
    o.type=kind==="bad"?"sawtooth":"sine"; o.frequency.setValueAtTime(f[0],t);
    o.frequency.exponentialRampToValueAtTime(f[1],t+0.12);
    g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.14,t+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001,t+0.22);
    o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t+0.24);
  }catch(e){}
}

let lobbyAudio=null;
export let musicOn = SS.music!==false;
export function musicVolNow(){ return typeof SS.musicVol==="number" ? SS.musicVol : 0.55; }
function initMusic(){
  if(lobbyAudio || typeof Audio==="undefined") return;
  try{ lobbyAudio=new Audio(LOBBY_MUSIC_PATH); lobbyAudio.loop=true; lobbyAudio.volume=musicVolNow(); }catch(e){}
}
export function setMusicVol(v){ v=Math.max(0,Math.min(1,v)); SS.musicVol=v; initMusic(); if(lobbyAudio) lobbyAudio.volume=v; saveSS(); }
export function playLobby(){ if(!musicOn) return; initMusic(); if(lobbyAudio){ try{ const pr=lobbyAudio.play(); if(pr&&pr.catch) pr.catch(()=>{}); }catch(e){} } }
export function stopLobby(){ if(lobbyAudio){ try{ lobbyAudio.pause(); }catch(e){} } }
export function updateMusicBtn(){ const b=document.getElementById("musicBtn"); if(b) b.textContent = musicOn?"🎵 Music: on":"🎵 Music: off"; }
export function toggleMusic(){ musicOn=!musicOn; SS.music=musicOn; saveSS(); if(musicOn){ if(state==="idle"||state==="summary") playLobby(); } else stopLobby(); updateMusicBtn(); sfx("tap"); }
// lobby track plays on the menu screens, pauses during an encounter
export function musicForState(){ if(!musicOn){ stopLobby(); return; } if(state==="idle"||state==="summary") playLobby(); else stopLobby(); }

// Mobile browsers block audio until the user interacts. Unlock on the first gesture:
// resume the sound-effects context and start the lobby track if it should be playing.
let _audioUnlocked=false;
export function unlockAudio(){
  if(_audioUnlocked) return; _audioUnlocked=true;
  try{ if(actx && actx.state==="suspended" && actx.resume) actx.resume(); }catch(e){}
  initMusic();
  if(musicOn && (state==="idle"||state==="summary")) playLobby();
}
export function armAudioUnlock(){
  if(typeof window==="undefined"||!window.addEventListener) return;
  const evs=["pointerdown","touchstart","mousedown","keydown"];
  const h=()=>{ unlockAudio(); evs.forEach(ev=>{ try{ window.removeEventListener(ev,h); }catch(e){} }); };
  evs.forEach(ev=>{ try{ window.addEventListener(ev,h,{passive:true}); }catch(e){} });
}
