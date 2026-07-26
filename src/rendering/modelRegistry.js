/* =========================================================================
   Model registry — the centralized asset pipeline the old MODELS={} stub and
   its unused loadModel() were scaffolding for (see phlebshift3dlab.html's
   original comment: "Drop low-poly .glb files in MODELS below"). This is
   Phase 0 plumbing: no real .glb files are downloaded yet (see
   docs/ASSET_PIPELINE.md), every registered model currently has no `url` or
   an intentionally-missing one, so preloadModels() always exercises the
   procedural fallback path. Filling in real URLs later requires zero call-site
   changes — that's the point of the registry.

   API:
     registerModel({ id, url, fallback })   // fallback: () => THREE.Object3D
     await preloadModels([ids], onProgress) // resolves once every id has
                                             // either a cached GLB or a
                                             // cached fallback instance
     createModelInstance(id)                // returns a fresh clone, or null
     disposeModel(id) / disposeAllModels()   // free geometry/material memory
   ========================================================================= */
import { loadGLB } from "./assetLoader.js";

const registry = new Map();   // id -> { url, fallback }
const cache = new Map();      // id -> THREE.Object3D (the template that gets cloned)
const failures = new Map();   // id -> Error (last load failure, for diagnostics)

export function registerModel({ id, url, fallback }){
  if(!id) throw new Error("registerModel requires an id");
  registry.set(id, { url: url||null, fallback: fallback||null });
}

export function isRegistered(id){ return registry.has(id); }
export function getLoadFailure(id){ return failures.get(id)||null; }

async function loadOne(id){
  const entry = registry.get(id);
  if(!entry) throw new Error(`Model "${id}" was never registered`);
  if(cache.has(id)) return cache.get(id);

  if(entry.url){
    try{
      const gltfScene = await loadGLB(entry.url);
      cache.set(id, gltfScene);
      return gltfScene;
    }catch(err){
      failures.set(id, err);
      console.warn(`[modelRegistry] "${id}" failed to load from ${entry.url}, using procedural fallback.`, err);
    }
  }
  if(entry.fallback){
    const built = entry.fallback();
    cache.set(id, built);
    return built;
  }
  throw new Error(`Model "${id}" has no url and no fallback — nothing to build`);
}

// Preloads every id, in parallel, tolerating individual failures (a failed
// GLB still resolves via its fallback). onProgress(done, total, id) fires
// after each model settles, so a loading screen can show real progress.
export async function preloadModels(ids, onProgress){
  const total = ids.length;
  let done = 0;
  await Promise.all(ids.map(async id=>{
    try{ await loadOne(id); }
    catch(err){ failures.set(id, err); console.error(`[modelRegistry] "${id}" has no usable model:`, err); }
    finally{ done++; if(onProgress) onProgress(done, total, id); }
  }));
}

// Returns a fresh instance safe to add to the scene (geometry/material are
// shared across clones for memory, which is correct for static decor props).
export function createModelInstance(id){
  const template = cache.get(id);
  if(!template){ console.warn(`[modelRegistry] "${id}" was not preloaded yet — call preloadModels() first.`); return null; }
  return template.clone(true);
}

function disposeObject3D(obj){
  obj.traverse(o=>{
    if(o.geometry) o.geometry.dispose();
    if(o.material){
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m=>{ if(m && m.dispose) m.dispose(); });
    }
  });
}
export function disposeModel(id){
  const template = cache.get(id);
  if(template) disposeObject3D(template);
  cache.delete(id);
}
export function disposeAllModels(){
  for(const id of cache.keys()) disposeModel(id);
}
