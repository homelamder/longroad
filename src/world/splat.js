import * as THREE from 'three';
import { asset } from '../asset.js';

// Terrain PBR splatting. The chunk builder already knows, per vertex, how much of
// the ground is grass, rock, snow or bare soil — this material turns those weights
// into samples of real photographic textures (PolyHaven, CC0) with normal maps,
// instead of flat vertex colours. Vertex colour survives as a biome tint so the
// seven regions keep their identities on top of shared textures.
//
// Sampler budget: 5 diffuse + 5 normal = 10, inside WebGL's 16 guarantee even with
// a shadow map bound.

const TEX = [
  ['grass', '/tex/leafy_grass'],
  ['rock', '/tex/cliff_side'],
  ['snow', '/tex/snow_02'],
  ['soil', '/tex/brown_mud_03'],
  ['sand', '/tex/dense_sand'],
];

// Metres per texture repeat. Small enough for detail underwheel, big enough that
// tiling is not obvious from the chase camera.
const SCALE = { grass: 7, rock: 11, snow: 9, soil: 6, sand: 8 };

export function loadSplatTextures(base = '') {
  const loader = new THREE.TextureLoader();
  const load = (url, srgb) => {
    const t = loader.load(asset(base + url));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const out = {};
  for (const [key, path] of TEX) {
    out[key] = load(`${path}_diffuse_1k.jpg`, true);
    out[key + 'N'] = load(`${path}_nor_gl_1k.jpg`, false);
  }
  return out;
}

export function makeSplatMaterial(textures) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,          // biome tint
    roughness: 0.97,
    metalness: 0.0,
  });

  mat.onBeforeCompile = (shader) => {
    for (const [key] of TEX) {
      shader.uniforms['t_' + key] = { value: textures[key] };
      shader.uniforms['t_' + key + 'N'] = { value: textures[key + 'N'] };
    }

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aSplat;      // grass, rock, snow, soil
        attribute float aArid;      // 0 grass country, 1 sand country
        varying vec4 vSplat;
        varying float vArid;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSplat = aSplat;
        vArid = aArid;
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D t_grass; uniform sampler2D t_grassN;
        uniform sampler2D t_rock;  uniform sampler2D t_rockN;
        uniform sampler2D t_snow;  uniform sampler2D t_snowN;
        uniform sampler2D t_soil;  uniform sampler2D t_soilN;
        uniform sampler2D t_sand;  uniform sampler2D t_sandN;
        varying vec4 vSplat;
        varying float vArid;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;`)
      // Albedo: blend the five diffuse maps by the vertex weights. Rock uses a
      // second projection on steep faces so cliffs do not smear.
      .replace('#include <map_fragment>', `
        vec2 uvTop = vWorldPos.xz;
        vec3 wn = normalize(vWorldNormal);
        // Side projection for steep ground: pick the dominant horizontal axis.
        vec2 uvSide = abs(wn.x) > abs(wn.z) ? vWorldPos.zy : vWorldPos.xy;
        float steep = smoothstep(0.55, 0.85, 1.0 - wn.y);

        vec3 grassC = texture2D(t_grass, uvTop / ${SCALE.grass.toFixed(1)}).rgb;
        vec3 sandC  = texture2D(t_sand,  uvTop / ${SCALE.sand.toFixed(1)}).rgb;
        vec3 openC  = mix(grassC, sandC, vArid);
        vec3 rockC  = mix(
          texture2D(t_rock, uvTop  / ${SCALE.rock.toFixed(1)}).rgb,
          texture2D(t_rock, uvSide / ${SCALE.rock.toFixed(1)}).rgb, steep);
        vec3 snowC  = texture2D(t_snow, uvTop / ${SCALE.snow.toFixed(1)}).rgb;
        vec3 soilC  = texture2D(t_soil, uvTop / ${SCALE.soil.toFixed(1)}).rgb;

        vec4 w4 = vSplat / max(vSplat.x + vSplat.y + vSplat.z + vSplat.w, 1e-4);
        vec3 tex = openC * w4.x + rockC * w4.y + snowC * w4.z + soilC * w4.w;
        // No manual sRGB decode: colorSpace on the texture gives the diffuse maps
        // an SRGB8 internal format, so the hardware hands us linear values already.
        diffuseColor.rgb *= tex;`)
      // Normal perturbation from the same weights (top projection, UDN-style blend).
      .replace('#include <normal_fragment_maps>', `
        vec3 nGrass = texture2D(t_grassN, uvTop / ${SCALE.grass.toFixed(1)}).xyz;
        vec3 nRock  = texture2D(t_rockN,  uvTop / ${SCALE.rock.toFixed(1)}).xyz;
        vec3 nSnow  = texture2D(t_snowN,  uvTop / ${SCALE.snow.toFixed(1)}).xyz;
        vec3 nSoil  = texture2D(t_soilN,  uvTop / ${SCALE.soil.toFixed(1)}).xyz;
        vec3 nSand  = texture2D(t_sandN,  uvTop / ${SCALE.sand.toFixed(1)}).xyz;
        vec3 nOpen = mix(nGrass, nSand, vArid);
        vec3 nTex = nOpen * w4.x + nRock * w4.y + nSnow * w4.z + nSoil * w4.w;
        nTex = nTex * 2.0 - 1.0;
        // World-space perturbation of the interpolated normal: treat the map's xy
        // as a tilt in the ground plane. Strength tuned by eye.
        vec3 pert = normalize(vec3(nTex.x * 0.85, 1.0, nTex.y * 0.85));
        // Rotate the perturbation from +Y onto the surface normal (cheap basis).
        vec3 up = abs(wn.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
        vec3 tangent = normalize(cross(up, wn));
        vec3 bitan = cross(wn, tangent);
        normal = normalize(tangent * pert.x + wn * pert.y + bitan * pert.z);
        normal = normalize((viewMatrix * vec4(normal, 0.0)).xyz);`);
  };
  mat.customProgramCacheKey = () => 'terrain-splat';
  return mat;
}
