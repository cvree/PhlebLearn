/* Low-level GLTF loading. One responsibility: fetch a .glb and hand back an
   Object3D, or fail cleanly. The model registry (modelRegistry.js) is the
   caching/fallback layer built on top of this — nothing else should call
   GLTFLoader directly. */
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export function loadGLB(url){
  return new Promise((resolve,reject)=>{
    if(!GLTFLoader || !url){ reject(new Error("no GLTFLoader or url")); return; }
    try{
      new GLTFLoader().load(
        url,
        gltf=>{
          gltf.scene.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
          resolve(gltf.scene);
        },
        undefined,
        err=>reject(err instanceof Error ? err : new Error(String(err)))
      );
    }catch(e){ reject(e); }
  });
}
