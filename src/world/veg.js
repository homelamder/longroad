import * as THREE from 'three';
import { asset } from '../asset.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Tree } from '@dgreenheck/ez-tree';

// The realistic plant library. Two sources, both free off the internet:
//  - ez-tree (MIT): realistic trees GENERATED in the browser at boot — ships zero
//    megabytes of tree meshes, and every reload grows the same forest (fixed seeds).
//  - PolyHaven photoscans (CC0): boulders, stumps, dead trunks, a quiver tree —
//    decimated offline to game weight.
//
// Each species yields ONE merged geometry + material array so the scatter system
// can draw the whole population in a draw call or two. Heavy species also get a
// cheap far-LOD variant (fewer branches, fewer-but-larger leaves).

// Bake a mesh's world transform into fresh float32 attributes. gltfpack output is
// quantized — int16 positions with the dequantise transform stored on the NODE — so
// the transform must be applied while widening, never written back into int16.
function bakeToFloat(mesh) {
  mesh.updateWorldMatrix(true, false);
  const g = mesh.geometry;
  const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const v = new THREE.Vector3();
  const out = new THREE.BufferGeometry();

  const pos = g.getAttribute('position');
  const pf = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    pf[i * 3] = v.x; pf[i * 3 + 1] = v.y; pf[i * 3 + 2] = v.z;
  }
  out.setAttribute('position', new THREE.BufferAttribute(pf, 3));

  const nor = g.getAttribute('normal');
  if (nor) {
    const nf = new Float32Array(nor.count * 3);
    for (let i = 0; i < nor.count; i++) {
      v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      nf[i * 3] = v.x; nf[i * 3 + 1] = v.y; nf[i * 3 + 2] = v.z;
    }
    out.setAttribute('normal', new THREE.BufferAttribute(nf, 3));
  }

  const uv = g.getAttribute('uv');
  if (uv) {
    const uf = new Float32Array(uv.count * 2);
    for (let i = 0; i < uv.count; i++) {
      uf[i * 2] = uv.getX(i); uf[i * 2 + 1] = uv.getY(i);
    }
    out.setAttribute('uv', new THREE.BufferAttribute(uf, 2));
  }
  if (g.index) out.setIndex(g.index.clone());
  return out;
}

// Merge every mesh under a root into one geometry with material groups.
function mergeRoot(root) {
  const geos = [], mats = [];
  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry.getAttribute('position')) return;
    geos.push(bakeToFloat(o));
    mats.push(o.material);
  });
  if (!geos.length) throw new Error('empty model');
  const merged = mergeGeometries(geos, true);
  merged.computeBoundingBox();
  return { geo: merged, mats };
}

// Rescale so the model stands `height` metres tall with its feet at y = 0.
function normalize({ geo, mats }, height) {
  const box = geo.boundingBox;
  const h = box.max.y - box.min.y;
  const s = height / h;
  geo.translate(0, -box.min.y, 0);
  geo.scale(s, s, s);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return { geo, mats };
}

// Rebuild ez-tree's materials as clean MeshStandardMaterials that keep the maps.
// NOT optional: ez-tree's own leaf/bark materials replace the whole vertex shader
// for wind sway, and that shader has no instancing support — instanced canopies
// all render at the world origin instead of on their trees.
function tuneTreeMaterials(merged) {
  merged.mats = merged.mats.map((m) => {
    const leafy = m.name === 'leaves' || m.transparent || m.alphaTest > 0;
    if (m.map) m.map.anisotropy = 4;
    return new THREE.MeshStandardMaterial({
      map: m.map || null,
      color: m.color ? m.color.clone() : 0xffffff,
      roughness: 0.85,
      metalness: 0,
      side: THREE.DoubleSide,
      // Leaf alpha cuts, never blends — blending thousands of quads through each
      // other is both slow and wrong from most angles.
      ...(leafy ? { alphaTest: 0.5, transparent: false } : {}),
    });
  });
}

// Generate one ez-tree with detail overrides. Overrides cut triangle count for
// far LODs: fewer root branches, fewer but larger leaf cards.
function growTree(preset, seed, { branchScale = 1, leafScale = 1, leafSize = 1, height }) {
  const tree = new Tree();
  tree.loadPreset(preset);
  const o = tree.options;
  o.seed = seed;
  for (const lvl of Object.keys(o.branch.children)) {
    o.branch.children[lvl] = Math.max(1, Math.round(o.branch.children[lvl] * branchScale));
  }
  for (const lvl of Object.keys(o.branch.sections)) {
    o.branch.sections[lvl] = Math.max(3, Math.round(o.branch.sections[lvl] * (branchScale < 1 ? 0.7 : 1)));
  }
  for (const lvl of Object.keys(o.branch.segments)) {
    o.branch.segments[lvl] = Math.max(3, Math.round(o.branch.segments[lvl] * (branchScale < 1 ? 0.75 : 1)));
  }
  o.leaves.count = Math.max(4, Math.round(o.leaves.count * leafScale));
  o.leaves.size *= leafSize;
  tree.generate();
  const merged = normalize(mergeRoot(tree), height);
  tuneTreeMaterials(merged);
  // The generator's meshes are garbage now; only the merged geometry survives.
  tree.traverse((x) => x.geometry?.dispose?.());
  return merged;
}

async function loadGlb(loader, url, height) {
  const gltf = await loader.loadAsync(url);
  const merged = normalize(mergeRoot(gltf.scene), height);
  for (const m of merged.mats) { if (m.map) m.map.anisotropy = 4; }
  return merged;
}

// Species table. `far` names the LOD used beyond the near rings; species without
// one simply thin out with distance as before.
export async function loadVegetation(onProgress = () => {}) {
  const loader = new GLTFLoader();
  const out = {};

  const grow = (id, preset, seed, opts) => {
    out[id] = growTree(preset, seed, opts);
    onProgress(id);
  };

  // Near-detail trees.
  // branchScale trims generator detail to an instancing budget — a near tree lands
  // around 6-9k triangles, a bush under 3k. Realism at driving distance comes from
  // the photographic leaf textures and silhouettes, not raw branch count.
  grow('pineA', 'Pine Medium', 11, { branchScale: 0.55, leafScale: 1.5, leafSize: 1.6, height: 17 });
  grow('pineB', 'Pine Medium', 23, { branchScale: 0.42, leafScale: 1.4, leafSize: 1.7, height: 13 });
  grow('oakA', 'Oak Medium', 31, { branchScale: 0.75, leafScale: 1.1, leafSize: 1.3, height: 13 });
  grow('ashA', 'Ash Medium', 7, { branchScale: 0.7, leafScale: 1.1, leafSize: 1.3, height: 12 });
  grow('aspenA', 'Aspen Medium', 5, { branchScale: 0.8, height: 11 });
  grow('bushA', 'Bush 1', 3, { branchScale: 0.45, leafScale: 0.7, leafSize: 1.3, height: 2.6 });
  grow('bushB', 'Bush 2', 6, { branchScale: 0.5, leafScale: 0.7, leafSize: 1.3, height: 2.2 });

  // Far LODs: ~a fifth of the branches, chunky leaves. Silhouettes, not portraits.
  grow('pineFar', 'Pine Medium', 11, { branchScale: 0.22, leafScale: 0.8, leafSize: 3.2, height: 15 });
  grow('oakFar', 'Oak Medium', 31, { branchScale: 0.4, leafScale: 0.6, leafSize: 2.8, height: 12 });

  // Photoscans.
  const jobs = [
    ['boulder', asset('/veg/boulder_01.glb'), 1.6],
    ['boulderB', asset('/veg/namaq_boulder.glb'), 2.2],
    ['stump', asset('/veg/stump.glb'), 0.9],
    ['deadTrunk', asset('/veg/dead_trunk.glb'), 0.8],   // lies flat; height ≈ thickness
    ['quiver', asset('/veg/quiver.glb'), 4.5],
  ];
  await Promise.all(jobs.map(async ([id, url, h]) => {
    out[id] = await loadGlb(loader, url, h);
    onProgress(id);
  }));

  return out;
}
