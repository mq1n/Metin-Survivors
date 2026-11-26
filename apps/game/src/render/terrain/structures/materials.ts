// The architecture material: one MeshStandardMaterial (vertex colours + baked AO) patched with per-vertex "kind" patterns
// (roof tiles, timber grain, lacquer, masonry courses, lattice, eave discs ...), derivative bump, optional triplanar
// detail texture, snow / moss overlay and emissive vertices. All props share ONE compiled program (cache key), so a
// zone with 14 prop types compiles it once. Fog, hemisphere/sun lighting, tone mapping and shadows stay stock three.js.
import { Color, DataTexture, MeshStandardMaterial, RGBAFormat, SRGBColorSpace, UnsignedByteType, type ColorRepresentation, type Material, type Side, type Texture } from 'three';
import type { QualityProfile } from '../../quality';
import { applyOcclusionFade } from '../occlusion';
import { applyAtmosphere } from '../atmosphere';
import { worldUniforms } from '../zoneContext';
import { KIND } from './geom/kinds';

export interface ArchMaterialOptions {
  /** triplanar detail texture for the stone / masonry kinds (e.g. tex_rock_canyon) */
  detail?: Texture | null;
  /** metres per detail tile */
  detailScale?: number;
  /** detail strength 0..1 */
  detailMix?: number;
  /** 0..1 snow on up-facing surfaces */
  snow?: number;
  /** 0..1 moss on low / up-facing surfaces */
  moss?: number;
  mossColor?: ColorRepresentation;
  /** strength of the baked AO 0..1 (default 1) */
  ao?: number;
  /** multiplier for emissive vertices */
  glow?: number;
  /** flat self-illumination as a fraction of the albedo: keeps props readable in dark zones */
  lift?: number;
  /** warm bounce light from the ground (lava glow): colour × strength, strongest on low, downward-facing surfaces */
  uplight?: ColorRepresentation;
  roughness?: number;
  side?: Side;
}

interface ArchUniforms {
  uATime: { value: number };
  uASnow: { value: number };
  uAMoss: { value: number };
  uAMossCol: { value: Color };
  uAQ: { value: number };
  uAAO: { value: number };
  uAGlow: { value: number };
  uALift: { value: number };
  uAUp: { value: Color };
  uADetail: { value: Texture };
  uADetailMix: { value: number };
  uADetailScale: { value: number };
  uADetailAvg: { value: number };
}

const whiteTex = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat, UnsignedByteType);
whiteTex.colorSpace = SRGBColorSpace;
whiteTex.needsUpdate = true;

const DEFINES = Object.entries(KIND)
  .map(([k, v]) => `#define K_${k.toUpperCase()} ${v}`)
  .join('\n');

const VERT_PARS = /* glsl */ `
attribute vec3 aMat;
varying vec3 vALocal;
varying vec3 vALocalN;
varying vec2 vAUv;
varying vec3 vAMat;
`;

const FRAG_PARS = /* glsl */ `
${DEFINES}
varying vec3 vALocal;
varying vec3 vALocalN;
varying vec2 vAUv;
varying vec3 vAMat;
uniform float uATime;
uniform float uASnow;
uniform float uAMoss;
uniform vec3 uAMossCol;
uniform float uAQ;
uniform float uAAO;
uniform float uAGlow;
uniform float uALift;
uniform vec3 uAUp;
uniform sampler2D uADetail;
uniform float uADetailMix;
uniform float uADetailScale;
uniform float uADetailAvg;

float aHash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
float aHash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float aNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(aHash3(i), aHash3(i + vec3(1,0,0)), f.x), mix(aHash3(i + vec3(0,1,0)), aHash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(aHash3(i + vec3(0,0,1)), aHash3(i + vec3(1,0,1)), f.x), mix(aHash3(i + vec3(0,1,1)), aHash3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float aFbm(vec3 p) { return 0.55 * aNoise(p) + 0.3 * aNoise(p * 2.1 + 3.7) + 0.15 * aNoise(p * 4.3 + 8.1); }
vec3 aBump(vec3 surfPos, vec3 surfNorm, vec2 dH, float faceDir) {
  vec3 sx = normalize(dFdx(surfPos));
  vec3 sy = normalize(dFdy(surfPos));
  vec3 r1 = cross(sy, surfNorm);
  vec3 r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}
`;

const COLOR_PATCH = /* glsl */ `
#include <color_fragment>
int aKind = int(vAMat.x + 0.5);
float aH = 0.0;
float aRough = -1.0;
float aEmitK = 1.0;
float aSnowOk = 1.0;
{
  vec3 L = vALocal;
  float px = length(fwidth(L));
  float lod = (1.0 - smoothstep(0.035, 0.16, px)) * (uAQ > 0.5 ? 1.0 : 0.0);
  float lum = 0.93 + 0.14 * aFbm(L * 0.85);
  vec2 t = vAUv;
  if (aKind == K_TILE) {
    float cx = t.x / 0.27;
    float col = floor(cx);
    float fx = fract(cx);
    float d = min(fx, 1.0 - fx);
    float cover = 1.0 - smoothstep(0.0, 0.17, d);
    float ry = t.y / 0.38 + mod(col, 2.0) * 0.5;
    float rf = fract(ry);
    float rid = floor(ry);
    float rnd = aHash(vec2(col, rid));
    float rowShade = 1.0 - 0.15 * smoothstep(0.55, 1.0, rf);
    float lower = 1.0 + 0.05 * (1.0 - smoothstep(0.0, 0.1, rf));
    float tile = rowShade * lower * (0.92 + 0.16 * rnd) * (0.8 + 0.3 * cover);
    tile *= 1.0 - 0.14 * step(0.93, rnd);
    lum *= mix(1.0, tile / 0.9, lod);
    aH = (cover * 0.8 + rf * 0.15) * lod;
    aRough = 0.78;
  } else if (aKind == K_WOOD) {
    float gr = aNoise(vec3(t.x * 6.0, t.y * 0.7, 1.7));
    float fine = aNoise(vec3(t.x * 26.0, t.y * 2.0, 5.0));
    lum *= 0.84 + 0.3 * gr + 0.12 * (fine - 0.5) * lod;
    aH = (gr * 0.5 + fine * 0.5) * 0.35 * lod;
  } else if (aKind == K_LACQUER) {
    float s = aNoise(vec3(t.x * 12.0, t.y * 0.6, 9.0));
    lum *= 0.94 + 0.12 * s;
    aRough = 0.5;
    aSnowOk = 0.7;
  } else if (aKind == K_METAL) {
    lum *= 0.9 + 0.2 * aNoise(L * 5.0);
    aRough = 0.42;
  } else if (aKind == K_PLASTER) {
    float st = aNoise(L * vec3(2.2, 0.7, 2.2));
    lum *= 0.93 + 0.14 * st;
    aH = aNoise(L * 16.0) * 0.22 * lod;
  } else if (aKind == K_STONE || aKind == K_MASONRY) {
    float n1 = aNoise(L * 3.0);
    float n2 = aNoise(L * 9.5);
    lum *= 0.86 + 0.24 * n1 + 0.1 * (n2 - 0.5);
    aH = (n1 * 0.55 + n2 * 0.45) * lod;
    if (aKind == K_MASONRY) {
      vec3 n = normalize(vALocalN);
      float wall = 1.0 - smoothstep(0.45, 0.7, abs(n.y));
      float tcoord = dot(L.xz, normalize(vec2(-n.z, n.x) + 1e-4));
      float course = L.y / 0.4;
      float row = floor(course);
      float rfy = fract(course);
      float bx = tcoord / 0.95 + aHash(vec2(row, 3.0)) * 7.0;
      float bf = fract(bx);
      float joint = max(1.0 - smoothstep(0.0, 0.06, rfy), 1.0 - smoothstep(0.0, 0.035, bf));
      float blk = aHash(vec2(floor(bx), row));
      float mas = (1.0 - 0.38 * joint) * (0.9 + 0.2 * blk);
      lum *= mix(1.0, mix(1.0, mas, wall), lod);
      aH = mix(aH, aH * 0.5 - joint * 0.9 + blk * 0.25, wall * lod);
    }
    if (uADetailMix > 0.0 && uAQ > 0.5) {
      vec3 w = pow(abs(normalize(vALocalN)), vec3(4.0));
      w /= (w.x + w.y + w.z);
      vec3 dt = texture2D(uADetail, L.zy / uADetailScale).rgb * w.x + texture2D(uADetail, L.xz / uADetailScale).rgb * w.y + texture2D(uADetail, L.xy / uADetailScale).rgb * w.z;
      float dl = dot(dt, vec3(0.299, 0.587, 0.114));
      lum *= 1.0 + (dl - uADetailAvg) / max(uADetailAvg, 0.05) * uADetailMix * 0.9;
      diffuseColor.rgb *= mix(vec3(1.0), dt / max(dl, 0.02), 0.22 * uADetailMix);
      aH += dl * 1.2 * uADetailMix;
    }
    aRough = 0.9;
  } else if (aKind == K_LATTICE) {
    vec2 g = fract(t / 0.17);
    float bar = max(1.0 - smoothstep(0.1, 0.17, g.x), 1.0 - smoothstep(0.1, 0.17, g.y));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.045, 0.028, 0.02), bar * mix(0.7, 1.0, lod));
    aEmitK = 1.0 - bar * 0.94;
    aH = bar * 0.8 * lod;
  } else if (aKind == K_TILEEND) {
    vec2 g = vec2(t.x / 0.19, t.y / 0.17) ;
    vec2 f = fract(g) - 0.5;
    float disc = 1.0 - smoothstep(0.36, 0.46, length(f * vec2(1.0, 1.0)));
    float ring = smoothstep(0.18, 0.26, length(f)) * disc;
    lum *= mix(1.0, mix(0.5, 1.1, disc) * (1.0 - 0.18 * ring), lod * 0.85 + 0.15);
    aH = disc * 0.7 * lod;
  } else if (aKind == K_CLOTH) {
    lum *= 0.93 + 0.1 * aNoise(vec3(t * 70.0, 3.0)) * lod;
    aH = aNoise(vec3(t * 70.0, 3.0)) * 0.25 * lod;
  } else if (aKind == K_STRAW) {
    float s = aNoise(vec3(t.x * 16.0, t.y * 1.1, 4.0));
    lum *= 0.72 + 0.56 * s;
    aH = s * 0.7 * lod;
    aRough = 1.0;
  } else if (aKind == K_EMBER) {
    aEmitK = 0.5 + 1.0 * aNoise(L * 1.6 + vec3(0.0, uATime * 0.55, uATime * 0.3));
    aSnowOk = 0.0;
  }
  diffuseColor.rgb *= lum;
}
`;

const ROUGH_PATCH = /* glsl */ `
#include <roughnessmap_fragment>
if (aRough >= 0.0) roughnessFactor = aRough;
`;

const NORMAL_PATCH = /* glsl */ `
#include <normal_fragment_maps>
if (uAQ > 0.5) normal = aBump(-vViewPosition, normal, vec2(dFdx(aH), dFdy(aH)) * 0.55, faceDirection);
`;

const EMISSIVE_PATCH = /* glsl */ `
#include <emissivemap_fragment>
{
  float upN = vALocalN.y;
  float nz = aNoise(vALocal * 2.3);
  if (uASnow > 0.0) {
    float sm = uASnow * smoothstep(0.32, 0.78, upN + (nz - 0.5) * 0.55) * aSnowOk;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.72, 0.78, 0.88) * (0.9 + 0.12 * nz), sm);
    roughnessFactor = mix(roughnessFactor, 0.95, sm);
  }
  if (uAMoss > 0.0 && vAMat.y <= 0.0) {
    float mm = uAMoss * smoothstep(0.38, 0.72, aFbm(vALocal * 1.7)) * (0.3 + 0.7 * smoothstep(-0.3, 0.8, upN)) * (1.0 - smoothstep(0.4, 3.2, vALocal.y));
    diffuseColor.rgb = mix(diffuseColor.rgb, uAMossCol * (0.8 + 0.4 * nz), mm * 0.85);
  }
  diffuseColor.rgb *= mix(1.0, vAMat.z, uAAO);
  float down = 0.5 - 0.5 * normalize(vALocalN).y;
  totalEmissiveRadiance += diffuseColor.rgb * (uALift + uAUp * down * (1.0 - smoothstep(0.0, 6.0, vALocal.y)));
  float flick = 0.92 + 0.08 * sin(uATime * 6.3 + vALocal.x * 2.1 + vALocal.z * 1.7);
  totalEmissiveRadiance += vColor.rgb * vAMat.y * aEmitK * uAGlow * flick;
}
`;

/** mean linear luminance of a loaded texture (16×16 downsample); 0.4 when unreadable */
export function averageLuma(tex: Texture): number {
  const img = tex.image as CanvasImageSource | undefined;
  if (!img || typeof document === 'undefined') return 0.4;
  try {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return 0.4;
    g.drawImage(img, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) {
      const lin = (v: number): number => Math.pow(v / 255, 2.2);
      s += 0.299 * lin(d[i] as number) + 0.587 * lin(d[i + 1] as number) + 0.114 * lin(d[i + 2] as number);
    }
    return Math.max(0.03, s / 256);
  } catch {
    return 0.4;
  }
}

/** the shared architecture material (see file header); `userData.arch` carries the uniforms for setArchQuality */
export function createArchMaterial(o: ArchMaterialOptions = {}): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: o.roughness ?? 0.88, metalness: 0 });
  if (o.side !== undefined) mat.side = o.side;
  const u: ArchUniforms = {
    uATime: worldUniforms.uTime,
    uASnow: { value: o.snow ?? 0 },
    uAMoss: { value: o.moss ?? 0 },
    uAMossCol: { value: new Color(o.mossColor ?? '#55662f') },
    uAQ: { value: 1 },
    uAAO: { value: o.ao ?? 1 },
    uAGlow: { value: o.glow ?? 1.2 },
    uALift: { value: o.lift ?? 0 },
    uAUp: { value: new Color(o.uplight ?? '#000000') },
    uADetail: { value: o.detail ?? whiteTex },
    uADetailMix: { value: o.detail ? (o.detailMix ?? 0.7) : 0 },
    uADetailScale: { value: o.detailScale ?? 3 },
    uADetailAvg: { value: o.detail ? averageLuma(o.detail) : 0.4 },
  };
  mat.userData.arch = u;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvALocal = position; vALocalN = normal; vAUv = uv; vAMat = aMat;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', COLOR_PATCH)
      .replace('#include <roughnessmap_fragment>', ROUGH_PATCH)
      .replace('#include <normal_fragment_maps>', NORMAL_PATCH)
      .replace('#include <emissivemap_fragment>', EMISSIVE_PATCH);
    applyOcclusionFade(shader);
    applyAtmosphere(shader);
  };
  mat.customProgramCacheKey = () => 'arch-v1';
  return mat;
}

/** applies the quality profile to every arch material uniform set (detail / bump are skipped on `low`) */
export function setArchQuality(m: Material, p: QualityProfile): void {
  const u = m.userData.arch as ArchUniforms | undefined;
  if (u) u.uAQ.value = p.tier === 'low' ? 0 : 1;
}
