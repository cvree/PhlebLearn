/* =========================================================================
   STRAP MESH — the tourniquet as a real 25 mm band.

   A flat ribbon swept along a centreline that is recomputed every frame from
   the application's actual geometry: where round the limb it has been passed,
   how hard it is being pulled, where the held end currently is, and where the
   tucked loop sits. Nothing here is animation — the ribbon is a readout of
   tourniquetState, which is why a band that is too loose visibly sags and one
   that is too tight visibly bites into the limb.

   The width direction is kept aligned with the limb's long axis, so a wrap
   taken at an angle produces a band that is genuinely skewed across the arm
   rather than one that is drawn straight and labelled crooked.
   ========================================================================= */
import * as THREE from "three";

export const STRAP_WIDTH = 0.025;      // a real single-use tourniquet
const MAX_POINTS = 96;

const X_AXIS = new THREE.Vector3(1, 0, 0);

/**
 * @param {object} o {color, width}
 */
export function buildStrap(o){
  const opt = o || {};
  const width = opt.width || STRAP_WIDTH;
  const half = width/2;

  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(MAX_POINTS*2*3);
  const normals = new Float32Array(MAX_POINTS*2*3);
  const uvs = new Float32Array(MAX_POINTS*2*2);
  const indices = [];
  for(let i=0;i<MAX_POINTS-1;i++){
    const a = i*2, b = i*2+1, c = (i+1)*2, d = (i+1)*2+1;
    indices.push(a, b, c,  b, d, c);
  }
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);

  const mat = new THREE.MeshStandardMaterial({
    color: opt.color == null ? 0x2f5fa8 : opt.color,
    roughness: 0.72,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  mat.userData.perInstance = true;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "tourniquetStrap";
  mesh.frustumCulled = false;

  const group = new THREE.Group();
  group.name = "tourniquet";
  group.add(mesh);

  // The graspable ends. These are what the pointer actually picks — a 25 mm
  // ribbon edge is not a finger target, so each end carries an invisible grab
  // volume exactly as the supply cart's props do.
  const ends = [0, 1].map(i=>{
    const g = new THREE.Group();
    g.name = `strapEnd${i}`;
    const grab = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.05, 0.05),
      new THREE.MeshBasicMaterial({ colorWrite:false, depthWrite:false, transparent:true, opacity:0 })
    );
    grab.name = "pickProxy";
    g.add(grab);
    g.userData.strapEnd = i;
    group.add(g);
    return g;
  });

  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const wid = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const ref = new THREE.Vector3();

  let count = 0;

  /**
   * Rebuilds the ribbon along an ordered list of centreline points.
   * @param {THREE.Vector3[]} pts
   * @param {object} [opts] {twist} radians of roll applied along the band —
   *        a spiralled wrap rolls the band into a cord, which is the visual
   *        consequence of a skewed application
   */
  function setCenterline(pts, opts){
    const o = opts || {};
    const n = Math.min(MAX_POINTS, pts.length);
    count = n;
    if(n < 2){ geo.setDrawRange(0, 0); return; }

    for(let i=0;i<n;i++){
      const p = pts[i];
      const prev = pts[Math.max(0, i-1)];
      const next = pts[Math.min(n-1, i+1)];
      tan.subVectors(next, prev);
      if(tan.lengthSq() < 1e-12) tan.set(1,0,0);
      tan.normalize();

      // Width runs along the limb axis wherever that is meaningful; where the
      // band's own direction IS the limb axis (out along a tail), fall back to
      // world up so the tail still reads as a flat strip.
      ref.copy(X_AXIS);
      if(Math.abs(ref.dot(tan)) > 0.94) ref.set(0, 1, 0);
      wid.copy(ref).addScaledVector(tan, -ref.dot(tan));
      if(wid.lengthSq() < 1e-10) wid.set(0, 0, 1);
      wid.normalize();

      // A twisted band narrows as it rolls: the same strip seen edge-on.
      const twist = (o.twist || 0) * (i/(n-1));
      const w = half * Math.max(0.22, Math.cos(twist));

      nrm.crossVectors(tan, wid).normalize();

      tmpA.copy(p).addScaledVector(wid, -w);
      tmpB.copy(p).addScaledVector(wid, w);

      const i6 = i*6;
      positions[i6]   = tmpA.x; positions[i6+1] = tmpA.y; positions[i6+2] = tmpA.z;
      positions[i6+3] = tmpB.x; positions[i6+4] = tmpB.y; positions[i6+5] = tmpB.z;
      normals[i6]   = nrm.x; normals[i6+1] = nrm.y; normals[i6+2] = nrm.z;
      normals[i6+3] = nrm.x; normals[i6+4] = nrm.y; normals[i6+5] = nrm.z;

      const v = i/(n-1);
      const i4 = i*4;
      uvs[i4] = 0; uvs[i4+1] = v; uvs[i4+2] = 1; uvs[i4+3] = v;
    }

    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    geo.attributes.uv.needsUpdate = true;
    geo.setDrawRange(0, (n-1)*6);
    geo.computeBoundingSphere();

    // park the grab volumes on the two free ends
    ends[0].position.copy(pts[0]);
    ends[1].position.copy(pts[n-1]);
  }

  /** Colour shift as it is pulled: latex lightens as it stretches. */
  function setStretch(t){
    const k = Math.max(0, Math.min(1, t || 0));
    mat.color.setHex(opt.color == null ? 0x2f5fa8 : opt.color);
    mat.color.lerp(new THREE.Color(0x8fb4e8), k*0.55);
  }

  function setVisible(v){ group.visible = !!v; }

  function dispose(){
    geo.dispose();
    mat.dispose();
    group.traverse(obj=>{
      if(obj !== mesh && obj.geometry) obj.geometry.dispose();
      if(obj !== mesh && obj.material && obj.material.dispose) obj.material.dispose();
    });
  }

  return {
    group, mesh, ends, width,
    setCenterline, setStretch, setVisible, dispose,
    get pointCount(){ return count; },
  };
}

/* ---------- centreline construction ------------------------------------------
   The band's shape is derived, never authored. Given the wrap geometry these
   helpers produce the points the ribbon is swept along. */

/**
 * A point on the circle around the limb axis at a given angle.
 * @param {number} x     position along the arm
 * @param {number} theta 0 = top of the limb, +ve toward +Z (medial)
 * @param {number} r     distance from the axis
 * @param {number} armY  height of the limb axis
 */
export function aroundLimb(x, theta, r, armY, out){
  const v = out || new THREE.Vector3();
  return v.set(x, armY + Math.cos(theta)*r, Math.sin(theta)*r);
}

/**
 * The arc of band that is actually in contact with the limb.
 *
 * @param {object} o
 *   bandX     where along the arm
 *   radius    limb radius there
 *   armY      limb axis height
 *   from,to   contact angles (radians); the arc runs from -> to the short way
 *             round the side the band was passed
 *   skew      metres of drift along the limb from one contact point to the
 *             other, so a crooked wrap produces a crooked band
 *   bite      how far the band sinks into the limb under tension
 *   segments  how finely to sample
 */
export function contactArc(o){
  const segs = o.segments || 40;
  const pts = [];
  for(let i=0;i<=segs;i++){
    const t = i/segs;
    const theta = o.from + (o.to - o.from)*t;
    // the band presses in hardest at the bottom, where the limb bears on it
    const press = o.bite * (0.45 + 0.55*Math.abs(Math.cos(theta*0.5)));
    const r = Math.max(0.004, o.radius - press);
    const x = o.bandX + (o.skew || 0)*(t - 0.5);
    pts.push(aroundLimb(x, theta, r, o.armY));
  }
  return pts;
}

/**
 * A free tail leaving the limb at a contact point and ending wherever the
 * learner's hand (or gravity) has left it. Sags under its own weight when
 * slack and straightens as it is pulled.
 */
export function freeTail(start, end, slack, segments){
  const segs = segments || 12;
  const pts = [];
  const drop = Math.max(0, slack) * start.distanceTo(end) * 0.55;
  for(let i=1;i<=segs;i++){
    const t = i/segs;
    const p = new THREE.Vector3().lerpVectors(start, end, t);
    p.y -= Math.sin(t*Math.PI) * drop;
    pts.push(p);
  }
  return pts;
}
