// Liquid system: ONE baked surface (water / lava / ice) for `field.layout.liquid` plus ONE shore decal = 2 draw calls.
// The surface is a static mesh of flat tiles at `level` over the wet area; the fragment shaders read the baked height
// texture, discard where the terrain is above the liquid and derive depth, foam, flow and shore distance per pixel.
// Per-frame CPU work is limited to a handful of uniform copies.
// Zones core C3: look.liquidLook (water shore / foam / glitter / bed stones / colours / clarity / taper, ice tint /
// opacity / glitter / cracks / frost / rim / texture, lava mode / flow / emissive / shore / contact shade) switches the
// matching shader path on (shaders.ts); a zone without it renders exactly as before.
// LIQ-01 (upgrade stage 2, D-LAVA-03): the flat lava reads lava.hotHdr / lava.skin / lava.skinScale (A0-LOOK) through
// `lavaHotParams`: hot flow lines that feed the bloom and drifting darker cooling skins, both from QUALITY >= 1 on.
// LIQ-02 (upgrade stage 2, S-ICE-03): the frozen mere reads ice.sheen / ice.sheenColor (A0-LOOK) and the existing ice.glitter through
// `iceSheenParams`: a clear cool-blue sheet, sky light added over it and crisp sparse sun glints, all from QUALITY >= 1 on. From
// medium up the sheet blends premultiplied (`icePremultiplied`) so that light can be ADDED without veiling the bed, and the sheet is
// drawn under the ground markers (`liquidRenderOrder`) so the hero's ring, elite rings and telegraphs keep their colour on the ice.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  Group,
  LinearFilter,
  Mesh,
  NormalBlending,
  RGBAFormat,
  RepeatWrapping,
  ShaderMaterial,
  SRGBColorSpace,
  UniformsLib,
  UniformsUtils,
  UnsignedByteType,
  Vector4,
  type IUniform,
  type PerspectiveCamera,
  type Texture,
  type Vector3,
} from 'three';
import type { Liquid } from '../../../world/layoutTypes';
import type { QualityProfile } from '../../quality';
import { findLook, type LiquidLook } from '../look';
import { bakedLightRef } from '../bakedLightRef';
import { getNoiseAtlas } from '../sky/noiseAtlas';
import { tryNormal, tryTexture, worldUniforms, type ZoneContext, type ZoneSystem } from '../zoneContext';
import { bakeLiquid, MAX_FLOW, SD_RANGE, type BakeOptions } from './bake';
import { FROST_FRAG, GLOW_FRAG, ICE_FRAG, LAVA_FRAG, LIQUID_VERT, WATER_FRAG, WET_FRAG } from './shaders';

const BAKE_OPTS: Record<Liquid['kind'], BakeOptions> = {
  water: { surfaceQuads: 1, decalReach: 1.8, decalLift: 0.09 },
  lava: { surfaceQuads: 4, decalReach: 6, decalLift: 0.12 },
  ice: { surfaceQuads: 1, decalReach: 3.5, decalLift: 0.09 },
};

/** water extinction (1/m of light path): a 0.55 m ford keeps ~60 % of the bed, a 2 m channel ~15 % */
const WATER_CLARITY = 0.44;
/** default ice albedo texture (look.liquidLook.ice.tex overrides it) */
const ICE_TEX = 'tex_ice_blue';

/** Bake options for a liquid kind with the zone's C3 look applied (beach reach, tapered sources). */
export function liquidBakeOptions(kind: Liquid['kind'], ll: LiquidLook | undefined): BakeOptions {
  const o = { ...BAKE_OPTS[kind] };
  if (ll?.legacyDecalSplit) o.legacySplit = true;
  if (kind === 'water' && ll?.water) {
    const w = ll.water.shore?.width ?? 0;
    if (w > 0) o.decalReach = Math.max(o.decalReach, w + 1.2);
    if ((ll.water.taper ?? 0) > 0) o.taper = ll.water.taper;
  }
  return o;
}

/** LIQ-01 defaults of the flat lava's hot veins and cooling skins (a LiquidLook.lava field that is absent takes these). */
export const LAVA_HOT_DEFAULTS = Object.freeze({ hotHdr: 1.6, skin: 0.22, skinScale: 6 });

/** What the LAVA_FLAT shader reads for the hot veins (`hotHdr`) and the cooling skins (`skin` coverage, `skinScale` metres per feature). */
export interface LavaHotParams {
  hotHdr: number;
  skin: number;
  skinScale: number;
}

const finiteOr = (v: number | undefined | null, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/**
 * The LIQ-01 knobs for one quality level (0 = low, 1 = medium, 2 = high and up). Low has no hot veins and no skins (the shader
 * compiles neither: a phone keeps today's flat lava, which has no bloom to feed); from medium on an absent field takes
 * LAVA_HOT_DEFAULTS, an explicit 0 switches that part off. Clamped: hotHdr 0..4, skin 0..0.6, skinScale 1..40 m.
 */
export function lavaHotParams(lv: LiquidLook['lava'] | undefined, level: number): LavaHotParams {
  if (level <= 0) return { hotHdr: 0, skin: 0, skinScale: LAVA_HOT_DEFAULTS.skinScale };
  const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
  return {
    hotHdr: clamp(finiteOr(lv?.hotHdr, LAVA_HOT_DEFAULTS.hotHdr), 0, 4),
    skin: clamp(finiteOr(lv?.skin, LAVA_HOT_DEFAULTS.skin), 0, 0.6),
    skinScale: clamp(finiteOr(lv?.skinScale, LAVA_HOT_DEFAULTS.skinScale), 1, 40),
  };
}

/** LIQ-02 defaults of the ice sheet's sheen and sun glitter (a LiquidLook.ice field that is absent takes these). */
export const ICE_SHEEN_DEFAULTS = Object.freeze({ sheen: 0.35, sheenColor: '#cfe6ff', glitter: 0.25 });

/** What the ICE_V2 shader reads for the sheen (`sheen` coverage, `sheenColor`) and the sun glints (`glitter` gain). */
export interface IceSheenParams {
  sheen: number;
  sheenColor: string;
  glitter: number;
}

/**
 * The LIQ-02 knobs for one quality level (0 = low, 1 = medium, 2 = high and up). Low has no sheen (the shader compiles neither the
 * sheen nor the glints there: a phone keeps today's sheet); from medium on an absent `sheen` takes 0.35, an absent `glitter` 0.25
 * and an absent / malformed `sheenColor` '#cfe6ff'; an explicit 0 switches that part off. Clamped: sheen and glitter 0..1.
 */
export function iceSheenParams(li: LiquidLook['ice'] | undefined, level: number): IceSheenParams {
  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
  const color = typeof li?.sheenColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(li.sheenColor) ? li.sheenColor : ICE_SHEEN_DEFAULTS.sheenColor;
  return {
    sheen: level <= 0 ? 0 : clamp01(finiteOr(li?.sheen, ICE_SHEEN_DEFAULTS.sheen)),
    sheenColor: color,
    glitter: clamp01(finiteOr(li?.glitter, ICE_SHEEN_DEFAULTS.glitter)),
  };
}

/**
 * LIQ-02: does the liquid surface blend premultiplied (ONE, ONE_MINUS_SRC_ALPHA)? Water always does; the frozen mere does from medium
 * up, where ICE_V2 adds sky light and sun glints on top of the sheet instead of covering the bed with them. Low (and an ice without a
 * look, which has no ICE_V2 path) keeps the plain non-premultiplied sheet it always had, so its pixels do not change.
 */
export function icePremultiplied(kind: 'water' | 'ice' | 'lava', hasIceLook: boolean, level: number): boolean {
  return kind === 'water' || (kind === 'ice' && hasIceLook && level > 0);
}

/**
 * LIQ-02: the draw order of the liquid surface and its shore decal. Every ground marker (the hero's ring -31 / -15, telegraphs -20, the
 * crowd's blob shadows -10) is drawn onto the ground BEFORE a water or lava surface (-10 / -9), which is right for a body the hero
 * wades into. The frozen mere is a sheet the hero walks ON, so it goes underneath them (-40 / -39): a marker, an elite ring or an enemy
 * telegraph keeps its colour on the ice however opaque the sheet is (the sheet writes no depth, so they still land on the bed).
 */
export function liquidRenderOrder(kind: 'water' | 'ice' | 'lava'): { surface: number; shore: number } {
  return kind === 'ice' ? { surface: -40, shore: -39 } : { surface: -10, shore: -9 };
}

/** rgb = linear sand colour, w = shelf width (m) */
function shoreUniform(hex: string, width: number): Vector4 {
  const c = new Color(hex);
  return new Vector4(c.r, c.g, c.b, width);
}

function solidTexture(r: number, g: number, b: number): DataTexture {
  const t = new DataTexture(new Uint8Array([r, g, b, 255]), 1, 1, RGBAFormat, UnsignedByteType);
  t.magFilter = t.minFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

function qualityLevel(p: QualityProfile): number {
  return p.tier === 'low' ? 0 : p.tier === 'medium' ? 1 : 2;
}

export function createLiquid(ctx: ZoneContext): ZoneSystem | null {
  const liquid = ctx.field.layout.liquid;
  if (!liquid) return null;
  const kind = liquid.kind;
  // C3: the zone's liquid look (undefined knobs keep the old constants)
  const zoneLook = findLook(ctx.biome.id);
  const ll = zoneLook?.liquidLook;
  // B2: the terrain's shadow on the bank layers (0 / absent = off, the shader compiles exactly as before)
  const shade = Math.max(0, Math.min(1, ll?.shade ?? 0));
  const bake = bakeLiquid(ctx.field, liquid.level, liquidBakeOptions(kind, ll));
  if (!bake) return null;

  const { biome, core } = ctx;
  const env = core.env;
  const tint = new Color(biome.water?.color ?? (kind === 'lava' ? '#ff5a14' : kind === 'ice' ? '#a8d8f0' : '#3f86a8'));
  const lw = kind === 'water' ? ll?.water : undefined;
  const li = kind === 'ice' ? ll?.ice : undefined;
  const lv = kind === 'lava' ? ll?.lava : undefined;
  const hot0 = lavaHotParams(lv, qualityLevel(ctx.quality));
  const sheen0 = iceSheenParams(li, qualityLevel(ctx.quality));

  const sunColor = new Color();
  const sunRad = new Color();
  const ambRad = new Color();
  const uniforms: Record<string, IUniform> = {
    ...UniformsUtils.clone(UniformsLib.fog),
    uHeight: { value: bake.heightTex },
    uFlow: { value: bake.flowTex },
    uNoise: { value: getNoiseAtlas() },
    uTime: worldUniforms.uTime,
    uWindDir: worldUniforms.uWindDir,
    uSunDir: worldUniforms.uSunDir,
    uSunColor: { value: sunColor },
    uSunRad: { value: sunRad },
    uAmbRad: { value: ambRad },
    uSkyTop: { value: new Color(biome.sky.top) },
    uSkyHorizon: { value: new Color(biome.sky.horizon) },
    uSkyBottom: { value: new Color(biome.sky.bottom) },
    uHazeColor: { value: new Color(biome.fog.color) },
    // water: in-scatter colour over the shallows / in the channel, pale stones painted on the bed, extinction per metre
    // (C3: look.liquidLook.water colours are the in-scatter body colours as authored, sRGB hex)
    uShallow: { value: lw?.shallow ? new Color(lw.shallow).multiplyScalar(0.32) : tint.clone().lerp(new Color('#7fd0c0'), 0.3).multiplyScalar(0.32) },
    uDeep: { value: lw?.deep ? new Color(lw.deep).multiplyScalar(0.34) : tint.clone().multiplyScalar(0.34) },
    uBed: { value: new Color(lw?.bed ?? '#b3a78e') },
    uClarity: { value: lw?.clarity ?? WATER_CLARITY },
    uCore: { value: tint.clone() },
    uIce: { value: null },
    uIceN: { value: null },
    uIceTint: { value: li?.tint ? new Color(li.tint) : new Color('#ffffff').lerp(tint, 0.5) },
    uWet: { value: new Color('#2c261c') },
    // C3 knobs (read only when the matching define is set)
    uShore: { value: shoreUniform(lw?.shore?.color ?? '#c9b48c', lw?.shore?.width ?? 0) },
    uWaterOpt: { value: new Vector4(lw?.foam ?? 1, lw?.glitter ?? 1, lw?.bedStones ?? 1, lw?.shore?.softness ?? 0.5) },
    uIceOpt: { value: new Vector4(li?.opacity ?? 0.9, sheen0.glitter, li?.crack ?? 0.5, li?.frost ?? 0.5) },
    uIceRim: { value: li?.rim ?? 0 },
    // LIQ-02 (ICE_V2, QUALITY >= 1): x sheen coverage, and the sheen colour (linear)
    uIceSheen: { value: new Vector4(sheen0.sheen, 0, 0, 0) },
    uIceSheenTint: { value: new Color(sheen0.sheenColor) },
    uLavaOpt: { value: new Vector4(lv?.flowScale ?? 1, lv?.emissive ?? 1, lv?.contactShade ?? (lv?.mode === 'flat' ? 0.5 : 0), lv?.shore?.glow ?? 1) },
    // LIQ-01 (LAVA_FLAT, QUALITY >= 1): x hot-vein HDR gain, y cooling-skin coverage, z skin feature size (m), w unused
    uLavaHot: { value: new Vector4(hot0.hotHdr, hot0.skin, hot0.skinScale, 0) },
    // LIQ-01: the hot veins' hue, #ff7a2a (linear): orange, never white
    uLavaHotTint: { value: new Color('#ff7a2a') },
  };
  // B2: the terrain's baked light map (bound as soon as the terrain has baked it) + the dynamic sun shadow of a `lights` material
  const lightRef = bakedLightRef(ctx.field);
  const shadeA = new Vector4(ctx.field.size / 2, ctx.field.size, 0, 0);
  let shadeBound = false;
  /** the white stand-in for `uLight` until the terrain's baked light map exists: a GL texture of its own, released when the real map takes its place (prod4: +1 texture per run) */
  let lightStandIn: DataTexture | null = null;
  if (shade > 0) {
    Object.assign(uniforms, UniformsUtils.clone(UniformsLib.lights));
    lightStandIn = solidTexture(255, 255, 255);
    uniforms.uLight = { value: lightStandIn };
    uniforms.uShadeA = { value: shadeA };
    const fillTint = new Color(zoneLook?.fill.shadowTint ?? '#000000');
    uniforms.uShadeFill = { value: new Vector4(fillTint.r, fillTint.g, fillTint.b, zoneLook?.fill.shadowFill ?? 0) };
  }

  const defines: Record<string, string | number> = {
    GRID_N: bake.n.toFixed(1),
    GRID_HALF: bake.half.toFixed(1),
    MAX_FLOW: MAX_FLOW.toFixed(1),
    SD_RANGE: SD_RANGE.toFixed(1),
    QUALITY: qualityLevel(ctx.quality),
  };
  if (lw) defines.WATER_V2 = '';
  if (li) defines.ICE_V2 = '';
  if (lv) defines.LAVA_V2 = '';
  if (lv?.mode === 'flat') defines.LAVA_FLAT = '';
  if (shade > 0) defines.SHORE_SHADE = '';
  // lava swells gently; the shore decal has no vertex animation so it hugs the terrain
  const surfaceDefines = kind === 'lava' ? { ...defines, LAVA_WAVE: 1 } : { ...defines };

  const surfaceFrag = kind === 'lava' ? LAVA_FRAG : kind === 'ice' ? ICE_FRAG : WATER_FRAG;
  const surfaceMat = new ShaderMaterial({
    name: `liquid_${kind}`,
    uniforms,
    defines: surfaceDefines,
    vertexShader: LIQUID_VERT,
    fragmentShader: surfaceFrag,
    fog: true,
    lights: shade > 0,
    transparent: true,
    blending: NormalBlending,
    // water outputs premultiplied colour so the bed can show through while reflections / glints stay additive; the frozen mere does the
    // same from medium up (LIQ-02)
    premultipliedAlpha: icePremultiplied(kind, !!li, qualityLevel(ctx.quality)),
    depthWrite: kind === 'lava',
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  const decalFrag = kind === 'lava' ? GLOW_FRAG : kind === 'ice' ? FROST_FRAG : WET_FRAG;
  const decalMat = new ShaderMaterial({
    name: `liquid_${kind}_shore`,
    uniforms,
    defines: { ...defines },
    vertexShader: LIQUID_VERT,
    fragmentShader: decalFrag,
    fog: true,
    lights: shade > 0,
    transparent: true,
    blending: kind === 'lava' ? AdditiveBlending : NormalBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });

  const surfaceGeo = new BufferGeometry();
  surfaceGeo.setAttribute('position', new BufferAttribute(bake.surface.positions, 3));
  surfaceGeo.setIndex(new BufferAttribute(bake.surface.index, 1));
  const decalGeo = new BufferGeometry();
  decalGeo.setAttribute('position', new BufferAttribute(bake.decal.positions, 3));
  decalGeo.setIndex(new BufferAttribute(bake.decal.index, 1));

  const surface = new Mesh(surfaceGeo, surfaceMat);
  surface.name = `liquid:${kind}`;
  surface.frustumCulled = false;
  surface.matrixAutoUpdate = false;
  const order = liquidRenderOrder(kind);
  surface.renderOrder = order.surface;
  surface.receiveShadow = shade > 0;
  const shore = new Mesh(decalGeo, decalMat);
  shore.name = `liquid:${kind}:shore`;
  shore.frustumCulled = false;
  shore.matrixAutoUpdate = false;
  shore.renderOrder = order.shore;
  shore.receiveShadow = shade > 0;

  const group = new Group();
  group.name = 'liquid';
  group.add(surface, shore);

  const fallbacks: Texture[] = [];
  let ready: Promise<void> | undefined;
  if (kind === 'ice') {
    ready = (async () => {
      const iceTex = li?.tex ?? ICE_TEX;
      const [tex, nrm] = await Promise.all([tryTexture(ctx.assets, iceTex), tryNormal(ctx.assets, iceTex)]);
      let albedo = tex;
      if (!albedo) {
        albedo = solidTexture(150, 190, 225);
        albedo.colorSpace = SRGBColorSpace;
        fallbacks.push(albedo);
      }
      let normal = nrm;
      if (!normal) {
        normal = solidTexture(128, 128, 255);
        fallbacks.push(normal);
      }
      for (const t of [albedo, normal]) t.wrapS = t.wrapT = RepeatWrapping;
      uniforms.uIce!.value = albedo;
      uniforms.uIceN!.value = normal;
    })();
  } else {
    uniforms.uIce!.value = getNoiseAtlas();
    uniforms.uIceN!.value = getNoiseAtlas();
  }

  const refreshLights = (): void => {
    sunColor.copy(env.sun.color);
    sunRad.copy(env.sun.color).multiplyScalar(env.sun.intensity / Math.PI);
    ambRad.copy(env.hemi.color).multiplyScalar(env.hemi.intensity / Math.PI);
  };
  refreshLights();

  const setQuality = (p: QualityProfile): void => {
    const q = qualityLevel(p);
    for (const m of [surfaceMat, decalMat]) {
      if (m.defines.QUALITY !== q) {
        m.defines.QUALITY = q;
        m.needsUpdate = true;
      }
    }
    // LIQ-02: the sheet's blend follows the tier (the shader premultiplies from QUALITY >= 1 on); the QUALITY change above recompiles it
    const premult = icePremultiplied(kind, !!li, q);
    if (surfaceMat.premultipliedAlpha !== premult) {
      surfaceMat.premultipliedAlpha = premult;
      surfaceMat.needsUpdate = true;
    }
    if (kind === 'lava') {
      const h = lavaHotParams(lv, q);
      (uniforms.uLavaHot!.value as Vector4).set(h.hotHdr, h.skin, h.skinScale, 0);
    }
    if (kind === 'ice') (uniforms.uIceSheen!.value as Vector4).x = iceSheenParams(li, q).sheen;
    // water and ice shore decals are decoration: drop them on the lowest tier (the lava glow is part of the read)
    shore.visible = kind === 'lava' || q > 0;
  };

  return {
    name: 'liquid',
    group,
    ready,
    update(_dt: number, _camera: PerspectiveCamera, _focus: Vector3) {
      refreshLights();
      if (shade > 0 && !shadeBound && lightRef.tex) {
        // the terrain finished its bake: shade the bank layers with the same texels, at the zone's own baked-shadow / AO strength
        uniforms.uLight!.value = lightRef.tex;
        shadeA.set(ctx.field.size / 2, lightRef.size, (zoneLook?.shadow.baked ?? 1) * shade, (zoneLook?.shadow.ao ?? 1) * shade);
        shadeBound = true;
        lightStandIn?.dispose();
        lightStandIn = null;
      }
    },
    setQuality,
    dispose() {
      surfaceGeo.dispose();
      decalGeo.dispose();
      surfaceMat.dispose();
      decalMat.dispose();
      bake.dispose();
      for (const t of fallbacks) t.dispose();
      lightStandIn?.dispose();
      lightStandIn = null;
    },
  };
}
