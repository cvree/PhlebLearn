/* =========================================================================
   PROCEDURAL BENCH AUDIO — diegetic sound, synthesised.

   The game used to make four noises: "tap", "good", "bad", "click". Abstract
   UI beeps, on a medical simulator, at the exact moments that should have been
   the most physical in the game. Worse, most of the encounter was SILENT, and
   silence is what makes a simulator feel like a worksheet.

   Everything here is synthesised rather than sampled, for three reasons that
   all matter more than fidelity would:

     1  It is CONTINUOUS and PARAMETRIC. Palpation is not a sound effect, it is
        a timbre that changes under your fingers; the vacuum is not a clip, it
        is a hiss whose decay IS the fill gauge. Neither can be a sample.
     2  It ships in the bundle at zero bytes.
     3  It can be built from what the simulation already knows — tension, fill
        fraction, tissue type, pressure — so the sound and the model can never
        drift apart.

   Two buses. `room` carries ambience and anything that should DUCK when
   something important happens; `front` carries the thing that matters and is
   never ducked. That split is the whole flashback moment's audio in one line:
   duck the room, resolve a note on the front.

   Nothing in here decides anything. Callers say what happened.
   ========================================================================= */
import { SS } from "../game/gameState.js";

let actx = null;
let master = null, roomBus = null, frontBus = null;
let noiseBuf = null;
let started = false;

function ctx(){
  if(actx) return actx;
  try{
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return null;
    actx = new AC();
    master = actx.createGain();
    master.gain.value = 0.9;
    master.connect(actx.destination);

    roomBus = actx.createGain();
    roomBus.gain.value = 1;
    roomBus.connect(master);

    frontBus = actx.createGain();
    frontBus.gain.value = 1;
    frontBus.connect(master);
  }catch(_){ actx = null; }
  return actx;
}

/** Sound effects follow the same switch the rest of the game's audio does. */
function enabled(){ return SS.sfx !== false; }

function now(){ const a = ctx(); return a ? a.currentTime : 0; }

/** One second of white noise, generated once and reused by every voice. */
function noise(){
  const a = ctx();
  if(!a) return null;
  if(noiseBuf) return noiseBuf;
  const n = a.sampleRate;
  noiseBuf = a.createBuffer(1, n, n);
  const d = noiseBuf.getChannelData(0);
  for(let i = 0; i < n; i++) d[i] = Math.random()*2 - 1;
  return noiseBuf;
}

function noiseSource(loop){
  const a = ctx();
  const s = a.createBufferSource();
  s.buffer = noise();
  s.loop = loop !== false;
  return s;
}

function gain(v, dest){
  const a = ctx();
  const g = a.createGain();
  g.gain.value = v == null ? 1 : v;
  g.connect(dest || frontBus);
  return g;
}

function filt(type, freq, q){
  const a = ctx();
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  if(q != null) f.Q.value = q;
  return f;
}

/** Envelope helper: attack to `peak`, then decay to silence over `dur`. */
function env(g, t0, peak, attack, dur){
  g.gain.cancelScheduledValues(t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + Math.max(0.001, attack));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
}

/* =========================================================================
   ONE-SHOTS
   ========================================================================= */

/** A short filtered noise burst. The workhorse behind most contact sounds. */
function burst(o){
  if(!enabled() || !ctx()) return;
  const a = ctx();
  const t = a.currentTime;
  const src = noiseSource(false);
  const bp = filt(o.type || "bandpass", o.freq, o.q == null ? 1.2 : o.q);
  const g = gain(0, o.bus || frontBus);
  if(o.sweep) bp.frequency.exponentialRampToValueAtTime(Math.max(40, o.sweep), t + (o.dur || 0.1));
  src.connect(bp); bp.connect(g);
  env(g, t, o.peak == null ? 0.25 : o.peak, o.attack == null ? 0.004 : o.attack, o.dur || 0.1);
  src.start(t); src.stop(t + (o.dur || 0.1) + 0.05);
}

/** A pitched body: what gives a pop its "wet" and a click its "glass". */
function tone(o){
  if(!enabled() || !ctx()) return;
  const a = ctx();
  const t = a.currentTime + (o.delay || 0);
  const osc = a.createOscillator();
  osc.type = o.wave || "sine";
  osc.frequency.setValueAtTime(o.freq, t);
  if(o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + (o.dur || 0.12));
  const g = gain(0, o.bus || frontBus);
  osc.connect(g);
  env(g, t, o.peak == null ? 0.16 : o.peak, o.attack == null ? 0.005 : o.attack, o.dur || 0.12);
  osc.start(t); osc.stop(t + (o.dur || 0.12) + 0.05);
}

/* ---------- skin and needle ------------------------------------------------- */

/** Tip meets skin. Dry, small, and the first commitment. */
export function skinTick(){
  burst({ freq: 2600, sweep: 1400, q: 2.2, peak: 0.14, dur: 0.045 });
}

/**
 * The skin gives. THE single most physically satisfying frame in the game, so
 * it is three layers: a transient, a wet body dropping in pitch, and a short
 * tail of tissue noise.
 */
export function skinPop(){
  burst({ freq: 1900, sweep: 520, q: 1.0, peak: 0.42, dur: 0.075, attack: 0.001 });
  tone({ freq: 420, to: 130, wave: "sine", peak: 0.30, dur: 0.13, attack: 0.001 });
  burst({ freq: 340, sweep: 180, q: 0.7, peak: 0.16, dur: 0.20, attack: 0.012 });
}

/** The vein wall gives: the same shape, lower and softer. You are in. */
export function veinPop(){
  burst({ freq: 900, sweep: 300, q: 1.1, peak: 0.22, dur: 0.070, attack: 0.002 });
  tone({ freq: 220, to: 96, wave: "sine", peak: 0.22, dur: 0.17, attack: 0.002 });
}

/**
 * The tightening creak of skin being pushed rather than cut. A held voice:
 * start it when resistance begins, feed it the load, stop it at the pop.
 */
export function skinCreak(){
  if(!enabled() || !ctx()) return silentVoice();
  const a = ctx();
  const src = noiseSource(true);
  const bp = filt("bandpass", 300, 7);
  const g = gain(0.0001, frontBus);
  src.connect(bp); bp.connect(g);
  src.start();
  let dead = false;
  return {
    /** @param {number} k 0..1 how far the skin has been stretched */
    set(k){
      if(dead) return;
      const kk = Math.max(0, Math.min(1, k));
      const t = a.currentTime;
      bp.frequency.setTargetAtTime(260 + kk*760, t, 0.05);
      bp.Q.setTargetAtTime(6 + kk*10, t, 0.08);
      g.gain.setTargetAtTime(0.0002 + kk*0.11, t, 0.04);
    },
    stop(){
      if(dead) return; dead = true;
      const t = a.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0.0001, t, 0.03);
      try{ src.stop(t + 0.25); }catch(_){}
    },
  };
}

/* ---------- palpation ------------------------------------------------------- */

/**
 * The continuous "give" under the pad. This is the single highest-value sound
 * in the game: feeling is an audio problem as much as a visual one, and this
 * is what turns sweeping an arm from guessing into hunting.
 *
 * Timbre carries the tissue. A vein is a soft, low, resonant give; a tendon is
 * a hard dead cord with no resonance at all; nothing under the pad is just the
 * broadband hush of skin on skin.
 */
export function feelVoice(){
  if(!enabled() || !ctx()) return Object.assign(silentVoice(), { pulse(){} });
  const a = ctx();
  const src = noiseSource(true);
  const lp = filt("lowpass", 380, 0.9);
  const body = filt("bandpass", 90, 3.2);
  const bodyGain = gain(0, frontBus);
  const airGain = gain(0, frontBus);
  src.connect(lp); lp.connect(airGain);
  src.connect(body); body.connect(bodyGain);
  src.start();

  // the artery's own beat, a separate short thump so it can be felt as rhythm
  let dead = false;
  return {
    /**
     * @param {object} o
     *   press     0..1 how hard the pad is pressing
     *   moving    0..1 how fast it is sweeping
     *   resonance 0..1 how much the thing underneath gives back
     *   pitch     Hz of the give — lower for a big vein, higher for a cord
     */
    set(o){
      if(dead) return;
      const t = a.currentTime;
      const press = Math.max(0, Math.min(1, o.press || 0));
      const moving = Math.max(0, Math.min(1, o.moving || 0));
      const res = Math.max(0, Math.min(1, o.resonance || 0));
      // Skin-on-skin: present whenever the hand is on the arm and moving.
      lp.frequency.setTargetAtTime(300 + moving*1500 + press*400, t, 0.06);
      airGain.gain.setTargetAtTime(0.0002 + (0.020 + press*0.030)*(0.25 + moving*0.75), t, 0.05);
      // The body of whatever is underneath.
      body.frequency.setTargetAtTime(o.pitch || 90, t, 0.05);
      body.Q.setTargetAtTime(1.4 + res*9, t, 0.08);
      bodyGain.gain.setTargetAtTime(0.0002 + res*press*0.16, t, 0.05);
    },
    /** One arterial thump. Called by the runtime in time with the pulse. */
    pulse(strength){
      if(dead) return;
      tone({ freq: 62, to: 38, wave: "sine", peak: 0.06 + 0.16*(strength || 0), dur: 0.16, attack: 0.008 });
    },
    stop(){
      if(dead) return; dead = true;
      const t = a.currentTime;
      airGain.gain.setTargetAtTime(0.0001, t, 0.05);
      bodyGain.gain.setTargetAtTime(0.0001, t, 0.05);
      try{ src.stop(t + 0.4); }catch(_){}
    },
  };
}

/* ---------- tourniquet ------------------------------------------------------ */

/** Elastic under load. Pitches up with tension — the readout you hear. */
export function elasticVoice(){
  if(!enabled() || !ctx()) return silentVoice();
  const a = ctx();
  const osc = a.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = 70;
  const lp = filt("lowpass", 500, 3);
  const g = gain(0.0001, frontBus);
  osc.connect(lp); lp.connect(g); osc.start();
  let dead = false;
  return {
    set(k){
      if(dead) return;
      const kk = Math.max(0, Math.min(1, k));
      const t = a.currentTime;
      osc.frequency.setTargetAtTime(64 + kk*116, t, 0.05);
      lp.frequency.setTargetAtTime(300 + kk*1500, t, 0.06);
      g.gain.setTargetAtTime(0.0002 + kk*0.055, t, 0.05);
    },
    stop(){
      if(dead) return; dead = true;
      g.gain.setTargetAtTime(0.0001, a.currentTime, 0.04);
      try{ osc.stop(a.currentTime + 0.3); }catch(_){}
    },
  };
}

/** Latex sliding over skin, while the band is being drawn round. */
export function strapDrag(){
  burst({ freq: 1200, sweep: 700, q: 0.8, peak: 0.07, dur: 0.16, attack: 0.03 });
}

/** The band sets: a leather creak and a soft thud. */
export function strapSet(){
  burst({ freq: 620, sweep: 240, q: 4.5, peak: 0.15, dur: 0.26, attack: 0.05 });
  tone({ freq: 96, to: 58, wave: "sine", peak: 0.20, dur: 0.19, attack: 0.006, delay: 0.05 });
}

/** One downward yank, and the recoil. */
export function strapSnap(){
  burst({ freq: 2200, sweep: 380, q: 0.9, peak: 0.34, dur: 0.10, attack: 0.001 });
  tone({ freq: 300, to: 110, wave: "triangle", peak: 0.16, dur: 0.14 });
}

/* ---------- cleaning -------------------------------------------------------- */

/** Granular scrub. Density and pitch track speed; weight tracks pressure. */
export function scrubVoice(){
  if(!enabled() || !ctx()) return silentVoice();
  const a = ctx();
  const src = noiseSource(true);
  const hp = filt("highpass", 900, 0.7);
  const bp = filt("bandpass", 2400, 1.1);
  const g = gain(0.0001, frontBus);
  src.connect(hp); hp.connect(bp); bp.connect(g); src.start();
  let dead = false;
  return {
    /** @param {object} o {speed 0..1, pressure 0..1, wet 0..1} */
    set(o){
      if(dead) return;
      const t = a.currentTime;
      const sp = Math.max(0, Math.min(1, o.speed || 0));
      const pr = Math.max(0, Math.min(1, o.pressure == null ? 0.6 : o.pressure));
      const wet = Math.max(0, Math.min(1, o.wet == null ? 1 : o.wet));
      bp.frequency.setTargetAtTime(1500 + sp*3400, t, 0.04);
      bp.Q.setTargetAtTime(0.8 + (1 - wet)*2.2, t, 0.1);
      hp.frequency.setTargetAtTime(500 + wet*900, t, 0.1);
      g.gain.setTargetAtTime(0.0002 + sp*pr*0.075, t, 0.03);
    },
    stop(){
      if(dead) return; dead = true;
      g.gain.setTargetAtTime(0.0001, a.currentTime, 0.05);
      try{ src.stop(a.currentTime + 0.3); }catch(_){}
    },
  };
}

/* ---------- tubes, holder, vacuum ------------------------------------------- */

/** Glass on plastic, plus the rack's own body resonating. */
export function tubeRackClick(){
  burst({ freq: 4200, sweep: 2000, q: 2.0, peak: 0.20, dur: 0.035, attack: 0.001 });
  tone({ freq: 1180, to: 900, wave: "triangle", peak: 0.10, dur: 0.09, attack: 0.001 });
  tone({ freq: 168, to: 140, wave: "sine", peak: 0.09, dur: 0.22, attack: 0.004, delay: 0.008 });
}

/** Glass touching glass as a tube is lifted past its neighbours. */
export function tubeChink(){
  burst({ freq: 5200, sweep: 3200, q: 3.0, peak: 0.10, dur: 0.028, attack: 0.001 });
}

/** The stopper gives: resistance, then a wet pop. Same profile as the skin. */
export function stopperPop(){
  burst({ freq: 1500, sweep: 420, q: 1.4, peak: 0.26, dur: 0.06, attack: 0.001 });
  tone({ freq: 300, to: 120, wave: "sine", peak: 0.20, dur: 0.11, attack: 0.001 });
}

/**
 * The vacuum. Starts strong and decays as the tube fills — and THAT is the
 * player's fill cue, not a timer. When it dies, flow has stopped.
 */
export function vacuumVoice(){
  if(!enabled() || !ctx()) return silentVoice();
  const a = ctx();
  const src = noiseSource(true);
  const bp = filt("bandpass", 2000, 1.6);
  const g = gain(0.0001, frontBus);
  src.connect(bp); bp.connect(g); src.start();
  let dead = false;
  return {
    /** @param {number} remaining 1 at first pierce, 0 when exhausted */
    set(remaining){
      if(dead) return;
      const k = Math.max(0, Math.min(1, remaining || 0));
      const t = a.currentTime;
      bp.frequency.setTargetAtTime(900 + k*2600, t, 0.12);
      g.gain.setTargetAtTime(0.0002 + k*k*0.075, t, 0.10);
    },
    stop(){
      if(dead) return; dead = true;
      g.gain.setTargetAtTime(0.0001, a.currentTime, 0.12);
      try{ src.stop(a.currentTime + 0.6); }catch(_){}
    },
  };
}

/* ---------- sharps ---------------------------------------------------------- */

/** The safety device: a hard, definitive plastic clack. Unmistakable. */
export function safetyClack(){
  burst({ freq: 3200, sweep: 900, q: 1.6, peak: 0.40, dur: 0.038, attack: 0.0008 });
  tone({ freq: 760, to: 430, wave: "square", peak: 0.10, dur: 0.055, attack: 0.001 });
}

/** The distinctive rattle-and-drop of a sharps bin. */
export function sharpsDrop(){
  burst({ freq: 2600, sweep: 1200, q: 1.2, peak: 0.24, dur: 0.05 });
  for(let i = 0; i < 3; i++){
    tone({ freq: 900 - i*150, to: 500, wave: "square", peak: 0.06, dur: 0.05, delay: 0.055 + i*0.045 });
  }
  tone({ freq: 120, to: 74, wave: "sine", peak: 0.12, dur: 0.26, delay: 0.14 });
}

/* ---------- the flashback --------------------------------------------------- */

/**
 * The best moment in the game, on the audio channel.
 *
 * Not a jingle: a RESOLUTION. One warm low note with a fifth and an octave
 * over it, arriving as the room ducks out from under it. The player should
 * not be able to say what the sound was — only that something let go.
 */
export function flashChord(){
  if(!enabled() || !ctx()) return;
  duckRoom(0.4, 0.40);
  const base = 174.6;                                   // F3, low and warm
  [[1, 0.16, 1.15], [1.5, 0.085, 1.05], [2, 0.055, 0.95], [3, 0.022, 0.8]].forEach(([mult, peak, dur], i)=>{
    tone({ freq: base*mult, wave: "sine", peak, dur, attack: 0.035 + i*0.012 });
  });
  // and the fluid itself arriving in the chamber
  burst({ freq: 420, sweep: 180, q: 1.4, peak: 0.10, dur: 0.22, attack: 0.02 });
}

/** Everything in the room gets quieter for a moment, then comes back. */
export function duckRoom(depth, seconds){
  const a = ctx();
  if(!a || !roomBus) return;
  const t = a.currentTime;
  const d = Math.max(0, Math.min(1, depth == null ? 0.5 : depth));
  roomBus.gain.cancelScheduledValues(t);
  roomBus.gain.setValueAtTime(roomBus.gain.value, t);
  roomBus.gain.linearRampToValueAtTime(1 - d, t + 0.05);
  roomBus.gain.linearRampToValueAtTime(1, t + Math.max(0.15, seconds || 0.4));
}

/* ---------- the patient ----------------------------------------------------- */

/** Breath in and out. Tighter and faster the more anxious they are. */
export function breath(tension, out){
  const k = Math.max(0, Math.min(1, tension || 0));
  burst({
    freq: 420 + k*380, sweep: 260 + k*200, q: 0.9,
    peak: 0.030 + k*0.030, dur: out ? 0.65 : 0.45, attack: out ? 0.05 : 0.16,
    bus: roomBus,
  });
}

/** The breath they had been holding. Longer, lower, and audibly relieved. */
export function exhale(){
  burst({ freq: 300, sweep: 150, q: 0.7, peak: 0.075, dur: 0.95, attack: 0.06 });
}

/** A small in-breath through the teeth. */
export function wince(){
  burst({ freq: 1500, sweep: 2600, q: 2.4, peak: 0.10, dur: 0.20, attack: 0.02 });
}

/* ---------- room tone ------------------------------------------------------- */

let room = null;

/**
 * The bed the whole encounter sits on: air handling, a distant corridor, the
 * faint hum of a building. Silence is what makes a simulator feel like a
 * worksheet, and this is the cheapest possible cure.
 */
export function startRoomTone(){
  if(room || !enabled() || !ctx()) return;
  const a = ctx();
  const src = noiseSource(true);
  const lp = filt("lowpass", 340, 0.6);
  const hp = filt("highpass", 60, 0.5);
  const g = gain(0.0001, roomBus);
  src.connect(hp); hp.connect(lp); lp.connect(g);
  src.start();
  g.gain.setTargetAtTime(0.030, a.currentTime, 1.4);

  // a slow, barely-there swell so it never reads as a static hiss
  const lfo = a.createOscillator();
  lfo.frequency.value = 0.06;
  const lfoGain = a.createGain();
  lfoGain.gain.value = 0.010;
  lfo.connect(lfoGain); lfoGain.connect(g.gain); lfo.start();

  const hum = a.createOscillator();
  hum.type = "sine"; hum.frequency.value = 58;
  const humGain = gain(0.006, roomBus);
  hum.connect(humGain); hum.start();

  room = { src, g, lfo, hum, humGain };
  started = true;
}

export function stopRoomTone(){
  if(!room) return;
  const a = ctx();
  const t = a ? a.currentTime : 0;
  try{ room.g.gain.setTargetAtTime(0.0001, t, 0.4); }catch(_){}
  try{ room.humGain.gain.setTargetAtTime(0.0001, t, 0.4); }catch(_){}
  try{ room.src.stop(t + 1.4); room.lfo.stop(t + 1.4); room.hum.stop(t + 1.4); }catch(_){}
  room = null;
}

export function roomToneRunning(){ return !!room; }

/* ---------- plumbing -------------------------------------------------------- */

/** Every continuous voice answers this shape, so callers never null-check. */
function silentVoice(){
  return { set(){}, stop(){}, pulse(){} };
}

/** Browsers suspend the context until a gesture. Called from the unlock path. */
export function resumeProcedural(){
  const a = ctx();
  if(a && a.state === "suspended" && a.resume){ try{ a.resume(); }catch(_){} }
}

/** Whether anything has been heard yet — used to avoid starting muted audio. */
export function proceduralStarted(){ return started; }
