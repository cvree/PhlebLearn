/* =========================================================================
   Procedural canvas textures for equipment markings — printed labels,
   expiry blocks, gauge markings and the biohazard trefoil.

   These are generated at runtime rather than shipped as images, so there is
   no third-party artwork to license, nothing to 404 on GitHub Pages, and
   labels can carry per-encounter text (this patient's name, this tube's
   expiry date) instead of being baked in.
   ========================================================================= */
import * as THREE from "three";

const cache = new Map();

/* =========================================================================
   HEADLESS DEGRADATION.

   Every equipment model in the game builds its printed markings through this
   file, so without a `document` the model builders throw and the entire
   supply catalog fails to build. That put all of the game's REAL geometry —
   how tall a tube is, how deep a tray's floor is, where an object's lowest
   point sits — permanently out of reach of `npm test`, which is why the bug
   that dropped every staged item 12 mm into the tray floor could only ever
   have been caught by looking at a screenshot.

   In a headless environment the drawing is skipped and a blank texture is
   returned instead. Materials stay valid, geometry is unchanged, and the
   dimensional properties of every prop become assertable without a browser.
   Nothing in the browser path changes: `document` exists there, and the same
   canvas is drawn as before.
   ========================================================================= */
const HEADLESS = typeof document === "undefined" || !document.createElement;

/** A drawing context stand-in whose every method is a no-op. */
function nullContext(){
  return new Proxy({}, {
    get(_, prop){
      if(prop === "canvas") return null;
      if(prop === "measureText") return ()=>({ width: 0 });
      if(prop === "createLinearGradient" || prop === "createRadialGradient"){
        return ()=>({ addColorStop(){} });
      }
      return ()=>{};
    },
    set(){ return true; },
  });
}

function makeCanvas(w,h){
  if(HEADLESS) return { width:w, height:h, getContext: nullContext };
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}
function finish(canvas){
  if(HEADLESS){
    // A texture with no image: bindable, disposable, and never uploaded.
    const blank = new THREE.Texture();
    blank.colorSpace = THREE.SRGBColorSpace;
    return blank;
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * A printed label panel: a title line, then small print lines.
 * @param {object} o {title, lines[], w, h, bg, ink, accent, stripe}
 */
export function labelTexture(o){
  const w = o.w||256, h = o.h||160;
  const key = JSON.stringify(o);
  if(cache.has(key)) return cache.get(key);
  const c = makeCanvas(w,h), g = c.getContext("2d");

  g.fillStyle = o.bg || "#f7f7f4";
  g.fillRect(0,0,w,h);
  if(o.stripe){
    g.fillStyle = o.stripe;
    g.fillRect(0,0,w,Math.round(h*0.17));
  }
  const ink = o.ink || "#20242c";
  const pad = Math.round(w*0.07);
  let y = o.stripe ? Math.round(h*0.17)+Math.round(h*0.17) : Math.round(h*0.2);

  if(o.title){
    g.fillStyle = o.stripe ? "#ffffff" : ink;
    g.font = `700 ${Math.round(h*0.13)}px ui-sans-serif, system-ui, sans-serif`;
    g.textBaseline = "middle";
    if(o.stripe) g.fillText(o.title, pad, Math.round(h*0.085));
    else { g.fillText(o.title, pad, y); y += Math.round(h*0.17); }
  }
  g.fillStyle = ink;
  g.font = `500 ${Math.round(h*0.098)}px ui-sans-serif, system-ui, sans-serif`;
  (o.lines||[]).forEach(line=>{
    g.fillText(String(line), pad, y);
    y += Math.round(h*0.145);
  });
  if(o.accent){
    g.fillStyle = o.accent;
    g.fillRect(0,h-Math.round(h*0.06),w,Math.round(h*0.06));
  }
  const tex = finish(c);
  cache.set(key, tex);
  return tex;
}

/** A blank white specimen label with ruled writing lines (unlabelled tube). */
export function blankLabelTexture(){
  const key = "blank-label";
  if(cache.has(key)) return cache.get(key);
  const c = makeCanvas(192,128), g = c.getContext("2d");
  g.fillStyle = "#fbfbf7"; g.fillRect(0,0,192,128);
  g.strokeStyle = "#c9c9c0"; g.lineWidth = 2;
  for(let i=1;i<=4;i++){ g.beginPath(); g.moveTo(14,i*24); g.lineTo(178,i*24); g.stroke(); }
  const tex = finish(c); cache.set(key,tex); return tex;
}

/**
 * The international biohazard trefoil on a warning-coloured field.
 * Drawn from the standard construction (three 60°-spaced arcs around a
 * central ring), not traced from any copyrighted artwork.
 */
export function biohazardTexture(opts){
  const o = opts||{};
  const key = "biohazard:"+(o.bg||"#c0392b")+":"+(o.fg||"#12100f")+":"+(o.text||"");
  if(cache.has(key)) return cache.get(key);
  const S = 256;
  const c = makeCanvas(S,S), g = c.getContext("2d");
  g.fillStyle = o.bg || "#c0392b"; g.fillRect(0,0,S,S);

  const cx = S/2, cy = S/2 - 12, R = 62;
  g.strokeStyle = o.fg || "#12100f";
  g.fillStyle = o.fg || "#12100f";

  // three outer rings, 120° apart, each overlapping the centre
  for(let i=0;i<3;i++){
    const a = -Math.PI/2 + i*(Math.PI*2/3);
    const ox = cx + Math.cos(a)*R*0.62, oy = cy + Math.sin(a)*R*0.62;
    g.lineWidth = 15;
    g.beginPath(); g.arc(ox, oy, R*0.62, 0, Math.PI*2); g.stroke();
    // the notch that opens each ring toward the centre
    g.save();
    g.globalCompositeOperation = "destination-out";
    g.beginPath();
    g.moveTo(cx,cy);
    g.arc(cx, cy, R*0.52, a - 0.62, a + 0.62);
    g.closePath(); g.fill();
    g.restore();
  }
  // central ring
  g.lineWidth = 14;
  g.beginPath(); g.arc(cx, cy, R*0.30, 0, Math.PI*2); g.stroke();
  g.beginPath(); g.arc(cx, cy, R*0.09, 0, Math.PI*2); g.fill();

  g.fillStyle = o.fg || "#12100f";
  g.font = "800 26px ui-sans-serif, system-ui, sans-serif";
  g.textAlign = "center";
  g.fillText(o.text || "BIOHAZARD", cx, S-26);
  g.textAlign = "left";

  const tex = finish(c); cache.set(key,tex); return tex;
}

/** A dashed "FILL LINE — DO NOT FILL ABOVE" band for the sharps container. */
export function fillLineTexture(){
  const key = "fill-line";
  if(cache.has(key)) return cache.get(key);
  const c = makeCanvas(256,48), g = c.getContext("2d");
  g.fillStyle = "#f0efe8"; g.fillRect(0,0,256,48);
  g.fillStyle = "#1a1a1a";
  for(let x=0;x<256;x+=18){ g.fillRect(x,6,10,5); }
  g.font = "800 15px ui-sans-serif, system-ui, sans-serif";
  g.fillText("DO NOT FILL ABOVE THIS LINE", 8, 32);
  const tex = finish(c); cache.set(key,tex); return tex;
}

/** Soft radial contact shadow used under picked-up objects. */
export function contactShadowTexture(){
  const key = "contact-shadow";
  if(cache.has(key)) return cache.get(key);
  const c = makeCanvas(128,128), g = c.getContext("2d");
  const grad = g.createRadialGradient(64,64,2,64,64,62);
  grad.addColorStop(0,"rgba(0,0,0,0.42)");
  grad.addColorStop(0.55,"rgba(0,0,0,0.16)");
  grad.addColorStop(1,"rgba(0,0,0,0)");
  g.fillStyle = grad; g.fillRect(0,0,128,128);
  const tex = finish(c); cache.set(key,tex); return tex;
}

export function disposeLabelTextures(){
  cache.forEach(t=>t.dispose());
  cache.clear();
}
