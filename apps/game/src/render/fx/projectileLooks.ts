
// element ball: a dark alpha smoke layer (black_mine_edge / skeleton_magician_smake, rotating slowly) under a fast-spinning
// additive swirl (ls1_1 copy: 500 deg/s ccw), a few stretched sparks and a faint thick tail; the fire ghost's fireball is a
// flickering orange blob with 0.1 m ember streaks; the ice monster throws a cold-smoke streak; archers shoot the PC arrow

//
// This module holds the pieces of that look that are not the instancing plumbing of projectiles.ts:
//   - `lookOfStyle`        style (shape + colour from app/simFeed styleFromName) -> element look code (render/fx/projectileEvents LOOK)
//   - GLSL_HOSTILE_*       the fragment shaders of the hostile orb / arrow / blade and the ground glow decal
//   - `buildProjectileAtlas`  one 4x4 atlas (256 px cells) of existing shipped vfx sprites (manifest kind `vfx`): R = brightness,
//                          G = alpha mask. The shaders sample turbulence from it instead of pure-math gradients.

import { Color, DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, UnsignedByteType, type Texture } from 'three';
import { LOOK } from './projectileEvents';

// ------------------------------------------------------------------------------------------------------------------
// style -> look
// ------------------------------------------------------------------------------------------------------------------

/** reference colours of app/simFeed ELEMENT_COLORS (sRGB hex) in look order; the hostile table maps by nearest colour */
const LOOK_REF: ReadonlyArray<readonly [number, string]> = [
  [LOOK.fire, '#ff7a1a'],
  [LOOK.ice, '#7fdcff'],
  [LOOK.lightning, '#ffe45a'],
  [LOOK.dark, '#a24bff'],
  [LOOK.poison, '#7bff52'],
  [LOOK.holy, '#ffd35a'],
  [LOOK.wind, '#bff6e0'],
  [LOOK.blood, '#ff3a3a'],
  [LOOK.physical, '#fff2c4'],
];
const refLinear: Array<[number, number, number, number]> = [];

/** element look of a projectile style colour: nearest of the simFeed element colours (the default cream = physical) */
export function lookOfColor(hex: string): number {
  if (refLinear.length === 0) {
    const c = new Color();
    for (const [code, h] of LOOK_REF) {
      c.set(h);
      refLinear.push([code, c.r, c.g, c.b]);
    }
  }
  const c = new Color().set(hex);
  let best = LOOK.physical as number;
  let bd = Infinity;
  for (const [code, r, g, b] of refLinear) {
    const d = (r - c.r) * (r - c.r) + (g - c.g) * (g - c.g) + (b - c.b) * (b - c.b);
    if (d < bd) {
      bd = d;
      best = code;
    }
  }
  return best;
}

/** schema C9 `projectile.look` names (data/schema.ts, once the core lands the key) -> element look */
export const LOOK_OF_C9: Readonly<Record<string, number>> = {
  fireball: LOOK.fire,
  frost_shard: LOOK.ice,
  void_globes: LOOK.dark,
  poison_glob: LOOK.poison,
  wind_blade: LOOK.wind,
  bone_arrow: LOOK.physical,
  claw_slash: LOOK.blood,
  stone: LOOK.physical,
  foxfire: LOOK.ice,
};

/** the look of a style: its own `look` when the feed carries one, else the nearest element colour */
export function lookOfStyle(s: { color: string; look?: string }): number {
  if (s.look !== undefined) {
    const c9 = LOOK_OF_C9[s.look];
    if (c9 !== undefined) return c9;
  }
  return lookOfColor(s.color);
}

// ------------------------------------------------------------------------------------------------------------------
// atlas of shipped sprites
// ------------------------------------------------------------------------------------------------------------------

export const ATLAS_COLS = 4;
export const ATLAS_ROWS = 6;
export const ATLAS_CELL = 256;
/** cell index -> manifest id (kind vfx). Every id is an existing shipped sprite (apps/game/public/assets/textures/vfx). */
export const ATLAS_IDS: readonly string[] = [
  'vfx_wisp_tangle_a', 
  'vfx_marble_smoke_a', // 1  veined turbulent smoke: fire and dark bodies
  'vfx_swirl_vortex_arms_a', // 2  spinning vortex arms: wind
  'vfx_puff_haze_round_a', // 3  soft round cloud: glow bodies, cold smoke
  'vfx_smoke_lumpball_a', // 4  lumpy smoke ball (alpha): the dark underlay
  'vfx_orb_motes_a', // 5  bubbles / motes: poison
  'vfx_hit_ice', // 6  faceted crystals: ice
  'vfx_wisp_swirl_ball_a', // 7  swirl ring ball: ice / holy
  'vfx_hit_flame', // 8  ragged flame tongues: fire tails
  'vfx_enemy_projectiles_swirl_core', // 9  tight 4-arm energy swirl (own sprite): the spinning core layer of every ball
  'vfx_comet_egg_a', // 10 comet head + tail
  'vfx_hit_toxic', // 11 toxic blob: poison
  'vfx_hit_slash', // 12 air slash streaks: wind
  'vfx_enemy_projectiles_ember_arrow_fin', // 13 two swept leaf-shaped flame fins + droplets (own sprite): fire arrows
  'vfx_enemy_projectiles_claw_slash', // 14 ragged fibre crescent, horns trailing left (own sprite): claw / wind blade body
  'vfx_hit_ink', // 15 ink splash with tendrils: dark
  
  'vfx_enemy_projectiles_smoke_ball_dark', 
  'vfx_enemy_projectiles_ice_orb', // 17 frost swirl sphere with embedded crystal shards: the ice ball's spinning layer
  'vfx_enemy_projectiles_poison_glob', // 18 bubbled sludge glob with drips: the poison ball's layer
  'vfx_glow_orb_core_a', // 19 soft glow core (hot centre of the swirl, release flash)
  // round 3 (2026-10-20)
  'vfx_enemy_projectiles_fire_orb', // 20 head-on turbulent fireball, licking lobes + dark swirl gaps (own sprite): the fire orb's spinning layer
  'vfx_enemy_projectiles_claw_slash_b', // 21 a second fibre crescent of torn flame-like fibres + flung embers (own sprite): blade bodies
  // round 3 resume (2026-10-22): the ember streak the sprite stage shipped for this target
  'vfx_enemy_projectiles_ember_streak', // 22 a hot ember streak: round spark head (right, uv x 0.9) + a thin tail of fading grains trailing left: the first sparks behind every ball
];
export const ATLAS_W = ATLAS_COLS * ATLAS_CELL;
export const ATLAS_H = ATLAS_ROWS * ATLAS_CELL;
/** kept for callers that still read the square size (width) */
export const ATLAS_SIZE = ATLAS_W;

/** 1x1 stand-in while the sprites load (a soft flat value: the shaders fall back to their analytic noise, never a hole) */
export function makeAtlasStandIn(): DataTexture {
  const data = new Uint8Array([150, 150, 150, 255]);
  const t = new DataTexture(data, 1, 1, RGBAFormat, UnsignedByteType);
  t.needsUpdate = true;
  return t;
}

interface PixelSource {
  width: number;
  height: number;
}

/**
 * Packs the sprites into the atlas texture (browser only). Per cell: R = brightness (max channel x alpha, additive sprites
 * keep their value), G = alpha mask (the real alpha of a straight-alpha sprite, else the brightness again). Missing sprites
 * stay black. `load(id)` is the engine's `Assets.loadTexture`.
 */
export async function buildProjectileAtlas(load: (id: string) => Promise<Texture>): Promise<DataTexture | null> {
  if (typeof document === 'undefined') return null;
  const out = new Uint8Array(ATLAS_W * ATLAS_H * 4);
  const cell = document.createElement('canvas');
  cell.width = cell.height = ATLAS_CELL;
  const cctx = cell.getContext('2d', { willReadFrequently: true });
  if (!cctx) return null;
  const textures = await Promise.all(ATLAS_IDS.map((id) => load(id).catch(() => null)));
  let loaded = 0;
  for (let i = 0; i < ATLAS_IDS.length; i++) {
    const tex = textures[i];
    const img = tex?.image as (CanvasImageSource & PixelSource) | undefined;
    if (!img || !(img.width > 0)) continue;
    cctx.clearRect(0, 0, ATLAS_CELL, ATLAS_CELL);
    cctx.drawImage(img, 0, 0, ATLAS_CELL, ATLAS_CELL);
    const px = cctx.getImageData(0, 0, ATLAS_CELL, ATLAS_CELL).data;
    const cx = (i % ATLAS_COLS) * ATLAS_CELL;
    // cell i sits at column i % 4, row floor(i / 4) counted from v = 0 (texture rows run bottom -> top, flipY false);
    // the shader's artAt reads the same layout
    const cy = Math.floor(i / ATLAS_COLS) * ATLAS_CELL;
    for (let y = 0; y < ATLAS_CELL; y++) {
      // image row y (top first) -> texture row (flipped inside the cell so v up = image up)
      const ty = cy + (ATLAS_CELL - 1 - y);
      for (let x = 0; x < ATLAS_CELL; x++) {
        const s = (y * ATLAS_CELL + x) * 4;
        const a = (px[s + 3] as number) / 255;
        const m = Math.max(px[s] as number, px[s + 1] as number, px[s + 2] as number);
        const d = ((ty * ATLAS_W) + cx + x) * 4;
        // an opaque image is an additive sprite (brightness = alpha); a masked one carries its own mask
        const lum = a >= 0.999 ? m : m * a;
        out[d] = lum;
        out[d + 1] = a >= 0.999 ? m : Math.round(a * 255);
        out[d + 2] = 0;
        out[d + 3] = 255;
      }
    }
    loaded++;
  }
  if (loaded === 0) return null;
  const t = new DataTexture(out, ATLAS_W, ATLAS_H, RGBAFormat, UnsignedByteType);
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------------------------------------------------------
// GLSL
// ------------------------------------------------------------------------------------------------------------------

/** shared helpers (appended after FRAG_COMMON): the atlas sampler, rotation, per-look palettes and textures */
export const GLSL_HOSTILE_COMMON = /* glsl */ `
uniform sampler2D tArt;

vec3 disp(vec3 c) { return pow(c, vec3(2.2)); }
mat2 rot2(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, s, -s, c);
}
// atlas cell sample, q in [-1, 1]^2 (outside = 0): (brightness, alpha mask)
vec2 artAt(float cell, vec2 q) {
  vec2 uv = q * 0.5 + 0.5;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  uv = 0.014 + clamp(uv, 0.0, 1.0) * 0.972;
  vec2 c = vec2(mod(cell, 4.0), floor(cell / 4.0));
  return texture2D(tArt, (c + uv) * vec2(0.25, 0.1666667)).rg * inside;
}
float fbm2(vec2 p) {
  return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.07 + 5.3) + 0.15 * vnoise(p * 4.11 + 11.7);
}

// look codes: 0 physical 1 fire 2 ice 3 lightning 4 dark 5 poison 6 holy 7 wind 8 blood
// (round 2) every palette is a SATURATED element body (alpha-blended smoke carries the hue, so it survives on snow) with a hot

void lookPal(float lk, out vec3 cCore, out vec3 cMid, out vec3 cRim, out vec3 cSmoke) {
  if (lk < 0.5) {                       // physical: ochre bone-spirit over brown smoke
    cCore = disp(vec3(1.0, 0.9, 0.5)); cMid = disp(vec3(0.92, 0.5, 0.1)); cRim = disp(vec3(0.6, 0.26, 0.04)); cSmoke = disp(vec3(0.1, 0.05, 0.015));
  } else if (lk < 1.5) {                // fire: flame blob (yellow-white heart, orange body, red rim)
    cCore = disp(vec3(1.0, 0.82, 0.36)); cMid = disp(vec3(1.0, 0.44, 0.04)); cRim = disp(vec3(0.9, 0.12, 0.02)); cSmoke = disp(vec3(0.15, 0.04, 0.01));
  } else if (lk < 2.5) {                // ice: frost sphere over deep-blue smoke
    cCore = disp(vec3(0.78, 0.94, 1.0)); cMid = disp(vec3(0.1, 0.4, 1.0)); cRim = disp(vec3(0.04, 0.18, 0.85)); cSmoke = disp(vec3(0.012, 0.035, 0.18));
  } else if (lk < 3.5) {                // lightning
    cCore = disp(vec3(1.0, 1.0, 0.95)); cMid = disp(vec3(1.0, 0.84, 0.2)); cRim = disp(vec3(1.0, 0.56, 0.06)); cSmoke = disp(vec3(0.1, 0.07, 0.01));
  } else if (lk < 4.5) {                
    cCore = disp(vec3(1.0, 0.6, 0.2)); cMid = disp(vec3(0.8, 0.08, 0.16)); cRim = disp(vec3(0.5, 0.03, 0.2)); cSmoke = disp(vec3(0.045, 0.0, 0.025));
  } else if (lk < 5.5) {                // poison: toxic glob over dark green smoke
    cCore = disp(vec3(0.92, 1.0, 0.52)); cMid = disp(vec3(0.32, 0.84, 0.1)); cRim = disp(vec3(0.08, 0.5, 0.14)); cSmoke = disp(vec3(0.01, 0.07, 0.02));
  } else if (lk < 6.5) {                // holy
    cCore = disp(vec3(1.0, 0.98, 0.84)); cMid = disp(vec3(1.0, 0.8, 0.3)); cRim = disp(vec3(1.0, 0.56, 0.1)); cSmoke = disp(vec3(0.1, 0.07, 0.02));
  } else if (lk < 7.5) {                // wind: teal vortex over dark teal smoke
    cCore = disp(vec3(0.74, 1.0, 0.9)); cMid = disp(vec3(0.12, 0.78, 0.62)); cRim = disp(vec3(0.03, 0.46, 0.42)); cSmoke = disp(vec3(0.008, 0.09, 0.08));
  } else {                              // blood / claw: crimson
    cCore = disp(vec3(1.0, 0.8, 0.6)); cMid = disp(vec3(1.0, 0.2, 0.14)); cRim = disp(vec3(0.8, 0.05, 0.08)); cSmoke = disp(vec3(0.1, 0.01, 0.02));
  }
}

//   cellS / spinS  the spinning ADDITIVE swirl core (atlas cell, rad/s)      cellH / spinH  the alpha-blended coloured smoke volume
//   dark           strength of the dark smoke body (0..1)                     hueK           strength of the coloured smoke volume
void lookTex(float lk, out float cellS, out float spinS, out float cellH, out float spinH, out float dark, out float hueK, out float flick) {
  if (lk < 0.5)      { cellS = 9.0;  spinS = 2.6;  cellH = 1.0; spinH = -1.2; dark = 0.62; hueK = 0.74; flick = 0.14; }
  else if (lk < 1.5) { cellS = 20.0; spinS = -3.0; cellH = 1.0; spinH = 2.4;  dark = 0.62; hueK = 0.8;  flick = 0.3; }
  else if (lk < 2.5) { cellS = 17.0; spinS = 2.8;  cellH = 3.0; spinH = -0.9; dark = 0.72; hueK = 0.78; flick = 0.12; }
  else if (lk < 3.5) { cellS = 9.0;  spinS = 9.0;  cellH = 1.0; spinH = -6.0; dark = 0.4;  hueK = 0.4;  flick = 0.35; }
  else if (lk < 4.5) { cellS = 9.0;  spinS = -8.7; cellH = 1.0; spinH = 1.4;  dark = 0.84; hueK = 0.52; flick = 0.18; }
  else if (lk < 5.5) { cellS = 18.0; spinS = 0.9;  cellH = 1.0; spinH = -1.5; dark = 0.74; hueK = 0.62; flick = 0.15; }
  else if (lk < 6.5) { cellS = 7.0;  spinS = 2.0;  cellH = 3.0; spinH = -1.5; dark = 0.35; hueK = 0.4;  flick = 0.1; }
  else if (lk < 7.5) { cellS = 9.0;  spinS = 7.5;  cellH = 3.0; spinH = -2.4; dark = 0.66; hueK = 0.76; flick = 0.12; }
  else               { cellS = 9.0;  spinS = -3.0; cellH = 1.0; spinH = 2.6;  dark = 0.72; hueK = 0.62; flick = 0.28; }
}

// premultiplied alpha layer over dst (colour straight)
vec4 lay(vec4 dst, vec3 col, float a) {
  return vec4(col * a + dst.rgb * (1.0 - a), a + dst.a * (1.0 - a));
}


// body), stay where they were released while the body moves on (so they trail by the travel), swell, rise and fade. Returns premultiplied.
// Round 3: the spacing and the sizes are jittered (round 2 read as 2-3 evenly spaced dashes), and smokeRibbon below adds the continuous smoke.
#ifdef LOW
#define NPUFF 3
#define NSPK 3
#define NSTK 1
#else
#define NPUFF 6
#define NSPK 7
#define NSTK 2
#endif
vec4 trailPuffs(vec2 p, float x0, float tr, float t, float seed, vec3 smokeCol, float k, float size) {
  vec4 acc = vec4(0.0);
  float ph = seed * 6.2831;
  for (int i = 0; i < NPUFF; i++) {
    float fi = float(i);
    float h = hash11(seed * 43.0 + fi * 5.17);
    float h3 = hash11(seed * 17.0 + fi * 2.9);
    float a = fract(t * 0.8 + (fi + (h3 - 0.5) * 0.9) / float(NPUFF) + h * 0.07);
    vec2 c = vec2(x0 - 0.1 - a * (tr * 0.85 + 0.9) * size, (h - 0.5) * 0.7 * size + a * 0.6 * size * (0.45 + h));
    float rad = size * (0.3 + 0.55 * a) * (0.75 + 0.5 * h3);
    vec2 q = (p - c) / rad;
    float qq = dot(q, q);
    if (qq < 1.0) {
      float blob = (1.0 - smoothstep(0.1, 1.0, sqrt(qq))) * (0.45 + 0.8 * vnoise(q * 2.6 + vec2(fi * 3.1, ph)));
      float al = clamp(blob * (1.0 - a) * smoothstep(0.0, 0.14, a) * k, 0.0, 0.85);
      acc = lay(acc, smokeCol, al);
    }
  }
  return acc;
}

// ages, modulated by noise so it is a drifting smoke and not a stripe. Returns premultiplied.
vec4 smokeRibbon(vec2 p, float x0, float tr, float t, float seed, vec3 col, float k, float size) {
  float len = (tr * 0.9 + 1.4) * size;
  float u = (x0 - p.x) / len;
  if (u <= 0.0 || u >= 1.0) return vec4(0.0);
  float ph = seed * 6.2831;
  float w = size * (0.2 + 0.6 * u);
  float yc = size * 0.45 * u * u * (0.6 + hash11(seed * 7.0));
  float dy = (p.y - yc) / w;
  float nz = fbm2(vec2(p.x * 1.7 + t * 0.55 + ph, p.y * 2.3 - t * 0.35));
  float prof = exp(-dy * dy * 1.6) * (0.25 + 1.1 * nz);
  float al = clamp(prof * pow(1.0 - u, 1.3) * smoothstep(0.0, 0.07, u) * k, 0.0, 0.75);
  return lay(vec4(0.0), col, al);
}

// Round 3: small round embers (round 2 stretched them into evenly spaced dashes)
vec3 emberSparks(vec2 p, float x0, float tr, float t, float seed, vec3 cHot, vec3 cCool, float size) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < NSPK; i++) {
    float fi = float(i);
    float h1 = hash11(seed * 57.0 + fi * 7.31);
    float h2 = hash11(seed * 91.0 + fi * 3.17);
    float u = fract(t * (0.6 + 0.9 * h1) + h2);
    vec2 c = vec2(x0 - u * (0.5 + tr * 0.42 * (0.3 + h1)) * size, (h2 - 0.5) * 2.0 * size * (0.2 + u) + u * u * 0.35 * size);
    float rad = (0.045 + 0.04 * h1) * size;
    float sd = length((p - c) * vec2(0.62, 1.0));
    float s = (1.0 - smoothstep(0.0, rad, sd)) * (1.0 - u) * smoothstep(0.0, 0.08, u);
    // the first embers are the generated ember streak (atlas cell 22: a round spark head at uv x 0.9 with a thin tail of fading grains trailing
    // left): the head leads at c, the tail points back towards the body the ember was shed from (mirrored in x)
    if (i < NSTK) {
      // flung out sideways and back (never through the ball's own middle: a streak crossing the ball read as a lens-flare bar): the head leads
      // along dir, the tail of grains points back at the body
      float sg = i == 0 ? 1.0 : -1.0;
      vec2 cs = vec2(x0 - (1.15 + 1.1 * u) * size, sg * (0.35 + 0.55 * u) * size + u * u * 0.15 * size);
      vec2 dir = normalize(vec2(-1.0, sg * (0.3 + 0.3 * h1)));
      vec2 dp2 = p - cs;
      float Lh = (0.4 + 0.15 * h2) * size;
      vec2 qq = vec2(dot(dp2, dir) / Lh + 0.8, (dp2.x * -dir.y + dp2.y * dir.x) / Lh + 0.016);
      s = artAt(22.0, qq).x * 2.2 * (1.0 - u) * smoothstep(0.0, 0.1, u);
    }
    acc += mix(cHot, cCool, u) * s;
  }
  return acc;
}
`;

/** hostile orb (round 3): a continuous drifting smoke column + puffs + a soft round DARK smoke body (no plateau, no ring) + an alpha-blended coloured smoke volume + the spinning additive swirl core + per-element structure + round embers; no outline */
export const GLSL_HOSTILE_ORB = /* glsl */ `
vec4 hostileOrbBody(vec2 p, float lk, float t, float seed, float tr, float fade, float spd) {
  float d0 = length(p);
  bool tailOn = tr > 0.05;
  vec3 cCore; vec3 cMid; vec3 cRim; vec3 cSmoke;
  lookPal(lk, cCore, cMid, cRim, cSmoke);
  float cellS; float spinS; float cellH; float spinH; float dark; float hueK; float flick;
  lookTex(lk, cellS, spinS, cellH, spinH, dark, hueK, flick);
  float ph = seed * 6.2831;
  float isFire = ((lk > 0.5 && lk < 1.5) || lk > 7.5) ? 1.0 : 0.0;
  float isFireOnly = (lk > 0.5 && lk < 1.5) ? 1.0 : 0.0;
  float isIce = (lk > 1.5 && lk < 2.5) ? 1.0 : 0.0;
  float isPoison = (lk > 4.5 && lk < 5.5) ? 1.0 : 0.0;
  float isWind = (lk > 6.5 && lk < 7.5) ? 1.0 : 0.0;
  // a body that has just been spawned (a boss volley: 12-20 bodies on one spot) is faint and small first, so the dark bodies do not add up to
  // a solid cushion at the caster's feet; it condenses over ~0.3 s while the volley fans out
  float born = mix(0.3, 1.0, smoothstep(0.0, 0.32, vColB.w));
  float ang = atan(p.y, p.x + 1e-5);
  vec2 cir = vec2(cos(ang), sin(ang));
  // soft turbulent silhouette: the radius follows a drifting noise ring (flame lobes / smoke churn); no outline, no regular polygon
  float lobe = (fbm2(cir * 1.5 + vec2(t * 0.8, -t * 0.6) + ph) - 0.5) * (0.3 + 0.34 * isFire);
  float d = d0 / (1.0 + lobe);
  float fl = 1.0 + flick * (0.5 * sin(t * 27.0 + ph) + 0.5 * sin(t * 41.0 + ph * 2.3));
  vec3 smokeCol = mix(cSmoke, cMid * 0.28, 0.3);

  // 0. smoke left behind: a continuous drifting column + puffs that stay where they were released (the ball moves through its own smoke)
  vec4 res = vec4(0.0);
  if (tailOn) {
    res = smokeRibbon(p, -0.3, tr, t, seed, smokeCol, 0.7 * dark * born, 1.0);
    res = over(trailPuffs(p, -0.35, tr, t, seed, smokeCol, 0.62 * dark * born, 1.1), res);
  }

  
  //    slowly turning. Round 3: no plateau and an eroded noise radius, so there is NO crisp dark ring round the bright core (round 2 had one),
  //    and its fringe carries the element's dark hue instead of black
  vec2 sb = artAt(16.0, rot2(-t * 0.6 + ph) * p * 0.8);
  float nzb = fbm2(p * 2.1 + vec2(t * 0.45, -t * 0.35) + ph * 3.0);
  float db = d0 / (1.0 + (nzb - 0.5) * 0.55);
  float soft = pow(1.0 - smoothstep(0.1, 1.36, db), 1.5);
  float aBody = clamp(soft * mix(0.5, 1.0, sb.y) * (0.85 + 0.2 * fl) * dark, 0.0, 0.8) * born;
  vec3 bodyCol = mix(cSmoke, cRim * 0.32, 0.3 + 0.3 * smoothstep(0.3, 1.1, db));
  res = lay(res, bodyCol, aBody);

  // 2. the coloured smoke volume (ALPHA blended: the element hue survives on a white floor), turning against the swirl
  vec2 sh = artAt(cellH, rot2(t * spinH + ph * 2.0) * p * 0.9);
  float lump = 0.6 + 0.5 * fbm2(p * 2.0 + vec2(t * 0.8, -t * 0.5) + ph);
  float aH = clamp(sh.x * hueK * lump * fl * (1.0 - smoothstep(0.2, 0.95, d)), 0.0, 0.94);
  res = lay(res, mix(cMid, cRim, smoothstep(0.3, 0.95, d)) * 0.8, aH);
  // 2b. a saturated, darker-than-the-glow body in the element hue under the additive layers: on a white floor an additive-only ball washes to
  //     peach / beige / mint (round 2), with this base the hue survives (the glow then lifts it instead of replacing the floor)
  float aBase = (1.0 - smoothstep(0.28, 0.86, d)) * 0.5 * (lk > 3.5 && lk < 4.5 ? 0.6 : 1.0) * born;
  res = lay(res, mix(cMid * 0.5, cRim * 0.7, smoothstep(0.1, 0.8, d)), aBase);

  
  vec2 ss = artAt(cellS, rot2(t * spinS + ph) * p * 1.05);
  float swirl = pow(clamp(ss.x, 0.0, 1.4), 1.15) * (1.0 - smoothstep(0.42 + 0.22 * isFireOnly, 0.86 + 0.3 * isFireOnly, d)) * fl;
  float swG = isIce > 0.5 ? 0.62 : (isPoison > 0.5 ? 0.8 : (isFireOnly > 0.5 ? 0.6 : 1.0));
  vec3 add = mix(cMid, cCore, 0.3) * swirl * swG;
  // the hot heart: ice / wind keep it small (round 2: a white lens-flare puff), the ochre ball gets a real hot core
  float heartK = isIce > 0.5 ? 0.3 : (isWind > 0.5 ? 0.4 : (isPoison > 0.5 ? 0.5 : (lk < 0.5 ? 0.9 : 0.62)));
  add += cCore * exp(-d * d * 20.0) * heartK + cMid * exp(-d * d * 5.0) * 0.2;

  // 4. per-element structure (so ice / poison / wind / ochre do not collapse into one white puff in greyscale)
#ifndef LOW
  if (isIce > 0.5) {
    // faceted crystal shards orbiting inside the frost swirl (small turning diamonds, not a flare star)
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float h = hash11(seed * 13.0 + fi * 4.3);
      float sg = mod(fi, 2.0) < 0.5 ? 1.0 : -1.0;
      float a2 = t * (0.9 + 0.5 * h) * sg + h * 6.283;
      vec2 cp = (0.26 + 0.5 * fract(h * 7.3)) * vec2(cos(a2), sin(a2));
      vec2 qd = rot2(h * 3.14 + t * 1.6) * (p - cp);
      float dia = abs(qd.x) * 1.7 + abs(qd.y) * 0.85;
      float sz = 0.075 + 0.05 * h;
      float shard = 1.0 - smoothstep(sz * 0.55, sz, dia);
      float tw = 0.6 + 0.4 * sin(t * 6.0 + fi * 2.1 + ph);
      add += mix(cMid, cCore, 0.6) * shard * tw * 1.0 * (1.0 - smoothstep(0.6, 1.0, d));
    }
  }
  if (lk > 5.5 && lk < 6.5) {
    float tw = pow(max(0.0, sin(t * 9.0 + ph * 5.0)), 12.0);
    float ray = exp(-abs(p.x) * 9.0) * exp(-abs(p.y) * 1.15) + exp(-abs(p.y) * 9.0) * exp(-abs(p.x) * 1.15);
    add += cCore * ray * (0.05 + 0.5 * tw) * (1.0 - smoothstep(0.6, 1.0, d));
  }
  if (isPoison > 0.5) {
    // poison: FILLED translucent bubbles rising through the glob (a darker green body, a thin bright edge, a shine), different sizes
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float h = hash11(seed * 19.0 + fi * 3.7);
      float h2 = hash11(seed * 23.0 + fi * 9.1);
      float rise = fract(t * (0.3 + 0.3 * h2) + h);
      vec2 bp = vec2((h2 - 0.5) * 0.9, (rise - 0.5) * 1.1);
      float br = 0.07 + 0.11 * h;
      vec2 bq = p - bp;
      float bd = length(bq);
      float body = 1.0 - smoothstep(br * 0.55, br, bd);
      float edge = exp(-sq((bd - br * 0.92) * 30.0)) * 0.55;
      vec2 sq2 = bq - vec2(-br * 0.35, br * 0.38);
      float shine = exp(-dot(sq2, sq2) * (260.0 / (br * br * 100.0 + 0.3)));
      float env = (1.0 - smoothstep(0.45, 0.85, d)) * smoothstep(0.0, 0.15, rise) * smoothstep(1.0, 0.85, rise);
      add += (cMid * body * 0.34 + cCore * edge + vec3(1.0) * shine * 0.55) * env;
      res = lay(res, cRim * 0.5, body * 0.32 * env);
    }
  }
  if (isWind > 0.5) {
    // wind: a second vortex layer turning against the swirl core, soft (not the thin vector arcs on their own)
    vec2 sv = artAt(2.0, rot2(-t * 3.2 + ph) * p * 1.1);
    add += cMid * pow(clamp(sv.x, 0.0, 1.2), 1.3) * 0.3 * (1.0 - smoothstep(0.5, 0.95, d));
    // and a few leaves of dust being carried round the body
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float h = hash11(seed * 29.0 + fi * 6.1);
      float a2 = t * (3.0 + h) + h * 6.283;
      vec2 cp = (0.5 + 0.28 * h) * vec2(cos(a2), sin(a2) * 0.85);
      add += mix(cMid, cCore, 0.4) * (1.0 - smoothstep(0.0, 0.07 + 0.03 * h, length(p - cp))) * 0.7 * (1.0 - smoothstep(0.7, 1.1, d));
    }
  }
  if (isFire > 0.5 && tailOn) {
    // flame tongues streaming back from the ball
    vec2 qf = vec2((-p.x - 0.95) / 1.15, p.y / 0.85);
    float tg = artAt(8.0, vec2(qf.y, -qf.x)).x * smoothstep(0.1, -0.5, p.x) * smoothstep(-2.8, -1.0, p.x);
    add += mix(cMid, cCore, 0.25) * tg * 1.3 * (0.7 + 0.3 * sin(t * 31.0 + ph));
  }
#endif

  // 5. sparks / embers shed behind (hot -> cool), visibly moving
  add += emberSparks(p, 0.15, tr, t, seed, mix(cCore, cMid, 0.45) * 2.0, cRim * 1.5, 1.0);

  // 6. the faint thick glow of the throw file (a smear of the element colour behind the ball, over the smoke column)
  if (tailOn) {
    float u = clamp(-(p.x - 0.2) / (tr + 0.8), 0.0, 1.0);
    float wdt = mix(0.5, 0.04, pow(u, 0.6));
    float prof = exp(-sq(p.y / wdt) * 2.4);
    float nn = fbm2(vec2(p.x * 1.5 + t * spd * 0.12 + ph, p.y * 3.2 + ph * 3.0));
    float join = smoothstep(0.4, -0.1, p.x);
    add += (cMid * 0.5 + cCore * pow(1.0 - u, 3.0) * 0.55) * prof * pow(1.0 - u, 1.8) * (0.2 + 0.9 * nn) * join * born;
  }
  res.rgb += add;
  return res * fade;
}
// The corners of the quad beyond the body (d0 > 1.6, except the smoke-tail corridor) draw nothing and skip the whole look. The skip is a
// conditional CALL and not an early return inside the look: FXC (ANGLE on D3D11) turns a divergent early return into a varying-exit
// region around everything after it, and the atlas reads of the swirl / ember loops inside that region warn X3595 ("gradient instruction
// used in a loop with varying iteration"). Same pixels: what the early return skipped was 0 and stays 0.
vec4 hostileOrb(vec2 p, float lk, float t, float seed, float tr, float fade, float spd) {
  bool tailOn = tr > 0.05;
  vec4 r = vec4(0.0);
  if (!(length(p) > 1.6 && !(tailOn && p.x < 0.3 && abs(p.y) < 2.2))) r = hostileOrbBody(p, lk, t, seed, tr, fade, spd);
  return r;
}
`;

/** hostile arrow: tapered shaft, steel head, soft fletching, element glow, flame fins (fire) / miasma (poison) / frost shards (ice) */
export const GLSL_HOSTILE_ARROW = /* glsl */ `
// leaf-shaped fin: lies along the shaft behind the head, tapering at both ends, swept outwards, signed distance-like
float finMask(vec2 p, float side, float x0, float len, float wid, float sweep, float t, float ph) {
  float u = (x0 - p.x) / len;
  if (u < 0.0 || u > 1.0) return 0.0;
  float prof = pow(sin(3.14159 * u), 0.85);
  float yc = side * (0.04 + sweep * u * u);
  float wob = 0.8 + 0.2 * sin(t * 24.0 + ph + u * 9.0);
  float hw = wid * prof * wob;
  return (1.0 - smoothstep(hw * 0.35, hw, abs(p.y - yc))) * prof;
}
vec4 hostileArrow(vec2 p, float lk, float t, float seed, float trR, float fade, float hl) {
  vec3 cCore; vec3 cMid; vec3 cRim; vec3 cSmoke;
  lookPal(lk, cCore, cMid, cRim, cSmoke);
  float ph = seed * 6.2831;
  float born = mix(0.3, 1.0, smoothstep(0.0, 0.3, vColB.w));
  float isFireA = (lk > 0.5 && lk < 1.5) ? 1.0 : 0.0;
  float isPhysA = lk < 0.5 ? 1.0 : 0.0;
  float isPoisA = (lk > 4.5 && lk < 5.5) ? 1.0 : 0.0;
  float isIceA = (lk > 1.5 && lk < 2.5) ? 1.0 : 0.0;
  float fin = isFireA > 0.5 ? 1.0 : (isPhysA > 0.5 ? 0.5 : (isPoisA > 0.5 ? 0.5 : (isIceA > 0.5 ? 0.4 : 0.0)));
  // silhouette: a sturdier tapered shaft, a diamond head, three feather vanes (round 3: thicker, so it is more than a 2 px hairline at the game camera)
  float shaft = sdSeg(p, vec2(-hl + 0.15, 0.0), vec2(hl - 0.95, 0.0)) - mix(0.08, 0.13, smoothstep(-hl, hl, p.x));
  float head = sdTri(vec2(p.y, hl - p.x), vec2(0.42, 1.15));
  vec2 pf = vec2(p.x, abs(p.y));
  float flet = 1e3;
  for (int i = 0; i < 3; i++) {
    float x0 = -hl + 0.28 + float(i) * 0.3;
    flet = min(flet, sdSeg(pf, vec2(x0, 0.03), vec2(x0 - 0.42, 0.34)) - 0.04);
  }
  float sd = min(shaft, min(head, flet));
  float aa = fwidth(sd) * 0.9 + 1e-4;
  float fill = 1.0 - smoothstep(-aa, aa, sd);
  // materials: wood with a lit top edge, brushed steel head catching the element hue, translucent feather vanes
  float lit = clamp(0.5 + p.y * 3.2, 0.0, 1.0);
  vec3 wood = mix(vec3(0.07, 0.04, 0.025), vec3(0.5, 0.33, 0.18), lit);
  float steelT = clamp(0.4 + (p.y + 0.3) * 1.1 + (hl - p.x) * 0.1, 0.0, 1.0);
  vec3 steel = mix(vec3(0.2, 0.22, 0.27), vec3(1.0, 0.97, 0.92), steelT * steelT * 0.85);
  steel = mix(steel, cCore * 1.2, 0.3) + cMid * smoothstep(-0.1, 0.0, head) * 0.55;
  vec3 vane = mix(cSmoke * 3.0, cMid * 0.8, lit) + 0.04;
  vec3 body = wood;
  if (head <= shaft && head <= flet) body = steel;
  else if (flet < shaft) body = vane;
  body *= 0.55 + 0.45 * smoothstep(0.0, -0.04, sd);
  vec4 solid = vec4(body * fill, fill);

  vec4 res = vec4(0.0);
  vec3 add = vec3(0.0);
  float x0 = hl - 0.55;
  
  if (trR > 0.05) {
    vec3 smk = mix(cSmoke, cMid * 0.28, 0.3);
    res = smokeRibbon(p, -hl + 0.3, trR, t, seed, smk, 0.6 * born, 0.85);
    res = over(trailPuffs(p, -hl + 0.2, trR, t, seed, smk, 0.5 * born, 0.8), res);
  }
  // poison: a miasma (alpha smoke in the toxic hue with ragged edges) streams behind the arrow instead of straight vector blades
  if (isPoisA > 0.5) {
    // round 3 resume: wider + denser, so the poison arrow drags a green miasma (two ragged lobes breathing at different rates) instead of a hairline
    float uu = clamp((x0 - p.x) / (3.6 + trR * 0.4), 0.0, 1.0);
    float w = 0.24 + 0.95 * uu;
    float nz = fbm2(vec2(p.x * 2.2 + t * 2.4 + ph, p.y * 3.0 - t * 0.7));
    float nz2 = fbm2(vec2(p.x * 1.3 - t * 1.1 + ph * 2.0, p.y * 2.0 + t * 0.5 + 7.0));
    float m = exp(-sq(p.y / w) * 1.2) * pow(1.0 - uu, 1.1) * smoothstep(0.0, 0.06, uu) * (0.25 + 1.1 * nz + 0.6 * nz2);
    res = lay(res, mix(cRim * 0.55, cMid * 0.85, nz), clamp(m * 0.95, 0.0, 0.88) * born);
    add += cMid * m * 0.3;
  }
  // dark underlay (soft shadow of the shaft + head + fins): readable on bright floors, wide enough to show at the game camera
  float ua = (1.0 - smoothstep(0.02, 0.6, sd)) * 0.66 * born;
  res = lay(res, cSmoke, ua);

  // element glow + head light + motion streak
  float gl = exp(-max(sd, 0.0) * 4.5) * 0.5;
  vec2 hq = p - vec2(hl - 0.3, 0.0);
  add += cMid * (gl * 1.4 + exp(-dot(hq, hq) * 1.9) * 0.45);
  float u2 = clamp((hl - p.x) / (hl * 2.0 + trR), 0.0, 1.0);
  float sw = mix(0.2, 0.02, pow(u2, 0.6));
  float streak = exp(-sq(p.y / max(sw, 0.01)) * 2.0) * pow(1.0 - u2, 1.7);
  float streakK = isPoisA > 0.5 ? 0.3 : 1.0; // the poison arrow's thin hot line is replaced by the miasma above
  add += (cMid * streak * 1.0 + cCore * streak * pow(1.0 - u2, 4.0) * 0.7) * streakK;
  float tip = exp(-dot(p - vec2(hl, 0.0), p - vec2(hl, 0.0)) * 10.0);
  add += mix(cMid, cCore, 0.6) * tip * 1.1;

  // flame fins: leaf-shaped tongues streaming back from behind the head, hot centre -> red edge, ember droplets
  if (fin > 0.0) {
    float fl = 0.0;
    if (isFireA > 0.5 || isPhysA > 0.5) {
      // the generated fin sprite (two swept grainy flame leaves + droplets; root left, tips trailing right in the sprite); gold arrows get it fainter
      float fL = 3.0 + trR * 0.35;
      float fu = (x0 - p.x) / fL;
      vec2 fq = vec2(-0.82 + fu * 1.66, p.y * 0.74 + 0.03 * sin(t * 19.0 + ph + fu * 7.0));
      float spr = artAt(13.0, fq).x * smoothstep(-0.08, 0.1, fu) * (1.0 - smoothstep(0.86, 1.0, fu));
      fl = clamp(spr * (0.85 + 0.25 * sin(t * 23.0 + ph + fu * 5.0)), 0.0, 1.0) * (isPhysA > 0.5 ? 0.62 : 1.0);
    } else if (isIceA > 0.5) {
      for (int s = 0; s < 2; s++) {
        float side = s == 0 ? 1.0 : -1.0;
        float m = finMask(p, side, x0, 2.8 + trR * 0.35, 0.5 * fin, 0.85, t, ph + side);
        fl = max(fl, m);
      }
    }
    float core = fl * fl;
    add += (cRim * 1.6 + cMid * 1.3 * fl + mix(cMid, cCore, 0.5) * core * 0.9) * fl * (1.0 + 0.3 * fin);
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float h1 = hash11(seed * 31.0 + fi * 5.7);
      float u = fract(t * (1.0 + 0.7 * h1) + h1 * 3.0);
      float side = fi < 2.5 ? 1.0 : -1.0;
      vec2 dp = vec2(x0 - 0.2 - u * 1.8, side * (0.25 + 0.55 * u * u) * (0.5 + h1));
      vec2 dd = (p - dp) * vec2(0.55, 1.0);
      add += mix(cCore, cRim, u) * (1.0 - smoothstep(0.0, 0.07, length(dd))) * (1.0 - u) * 1.5 * fin;
    }
  }
  // embers shed behind every arrow
  add += emberSparks(p, -hl + 0.3, trR, t, seed, mix(cCore, cMid, 0.45) * 1.7, cRim * 1.4, 0.8);
  res.rgb += add;
  res = res * fade;
  res = over(vec4(solid.rgb * fade, solid.a * fade), res);
  return res;
}
`;

/** hostile blade (claw / wind / ring bolt): grainy flame-fibre crescent (two generated fibre sprites, torn by noise), hot leading edge, smoke column + embers behind, dark underlay */
export const GLSL_HOSTILE_BLADE = /* glsl */ `
vec4 hostileBlade(vec2 p, float lk, float t, float seed, float trail, float fade, float S) {
  vec3 cCore; vec3 cMid; vec3 cRim; vec3 cSmoke;
  lookPal(lk, cCore, cMid, cRim, cSmoke);
  float ph = seed * 6.2831;
  float born = mix(0.3, 1.0, smoothstep(0.0, 0.3, vColB.w));
  vec2 q = p / S;
  q.x += 0.28;
  // flame-fibre body: two generated fibre crescents (torn fibres of different length, hot leading edge, horns trailing), picked per bolt; the
  // sampling coordinate is torn by drifting noise and the brightness grained along the fibres, so the crescent flickers like flame and is not a
  // smooth glossy C (round 2). No procedural disc fill: the blade is a fibre crescent and not a coin.
  float useB = step(0.5, hash11(seed * 3.7));
  float cellB = mix(14.0, 21.0, useB);
  float gainB = mix(1.0, 1.55, useB);
  float nzf = fbm2(vec2(q.y * 5.0 + ph, q.x * 3.0 - t * 5.0));
  vec2 qs = vec2(q.x * 0.874 + 0.199 + (nzf - 0.5) * 0.08, q.y * 0.672 + 0.03 * sin(t * 17.0 + ph) + (nzf - 0.5) * 0.06);
  float spr = artAt(cellB, qs).x * gainB;
  float fib = vnoise(vec2(q.y * 9.0 + ph, q.x * 2.5 - t * 8.0));
  float grain = 0.4 + 1.15 * fbm2(vec2(q.y * 12.0 + ph, q.x * 4.5 - t * 9.0));
  float energy = (0.62 + 0.55 * fib) * grain;
  float edgeW = smoothstep(-0.15, 0.85, qs.x);
  vec3 bodyCol = mix(cRim, mix(cMid, cCore, edgeW * edgeW * 0.85), smoothstep(-0.35, 0.55, qs.x));
  vec3 add = bodyCol * spr * 1.45 * energy;
  // soft fattened copy of the fibres (4 taps at two radii): the coloured smoke volume + the dark body, following the fibres
  float b1 = (artAt(cellB, qs + vec2(0.09, 0.0)).x + artAt(cellB, qs - vec2(0.09, 0.0)).x + artAt(cellB, qs + vec2(0.0, 0.09)).x + artAt(cellB, qs - vec2(0.0, 0.09)).x) * 0.25 * gainB;
  float b2 = 0.0;
#ifndef LOW
  b2 = (artAt(cellB, qs + vec2(0.2, 0.0)).x + artAt(cellB, qs - vec2(0.2, 0.0)).x + artAt(cellB, qs + vec2(0.0, 0.2)).x + artAt(cellB, qs - vec2(0.0, 0.2)).x) * 0.25 * gainB;
#endif
  float aHue = clamp(spr * 0.3 + b1 * 0.95 + b2 * 0.4, 0.0, 0.8) * 0.78 * born;
  float aDark = clamp(b1 * 1.3 + b2 * 1.4 + spr * 0.25, 0.0, 0.9) * 0.9 * born;
  // smoke + embers behind the crescent: a continuous drifting column over puffs
  vec4 res = vec4(0.0);
  float sz = max(S * 0.55, 0.45);
  vec3 smk = mix(cSmoke, cMid * 0.28, 0.3);
  if (trail > 0.05) {
    res = smokeRibbon(p, -0.3 * S, trail, t, seed, smk, 0.4 * born, sz);
    res = over(trailPuffs(p, -0.3 * S, trail, t, seed, smk, 0.5 * born, sz), res);
  }
  res = lay(res, cSmoke, aDark);
  res = lay(res, cMid * 0.78, aHue);
  add += emberSparks(p, -0.2 * S, trail, t, seed + fib * 0.37, mix(cCore, cMid, 0.45) * 1.9, cRim * 1.5, sz);
  add += cMid * exp(-length(vec2(p.x - 0.55 * S, p.y * 0.7)) * 3.2 / S) * 0.08 * edgeW;
  res.rgb += add;
  return res * fade;
}
`;

/** ground glow decal under a hostile projectile: soft pool of the element hue over a dark soft shadow (danger underlay) */
export const GLSL_HOSTILE_GROUND = /* glsl */ `
vec4 hostileGround(vec2 p, float lk, float t, float seed, float fade) {
  vec3 cCore; vec3 cMid; vec3 cRim; vec3 cSmoke;
  lookPal(lk, cCore, cMid, cRim, cSmoke);
  // the caller encodes the body shape in vColA.a: 1 orb, 2 arrow, 3 blade (crescents and arrows get a much fainter pool: round 2 left a pale
  // disc ringed by dots under every one of them, which read as a tea-light)
  float sh = vColA.a;
  float g = length(p) / 2.4;
  float ang = atan(p.y, p.x + 1e-5);
  // gentle low-frequency breathing only (a lumpy modulation read as a flower on the floor)
  float n = 0.82 + 0.18 * vnoise(vec2(ang * 1.3 + t * 0.9, seed * 5.0 + g * 2.0));
  // a body that has just spawned (a boss volley) leaves no pool yet: the pools of 12-20 bodies would add up to a solid dish at the caster's feet
  float born = smoothstep(0.04, 0.45, vColB.w);
  float kDark = sh > 2.5 ? 0.4 : (sh > 1.5 ? 0.6 : 1.0);
  float kHue = sh > 2.5 ? 0.3 : (sh > 1.5 ? 0.5 : 1.0);
  // the danger underlay: a dark soft pool and a smaller element-hue pool over it (ALPHA, darker than the ball so it reads on snow); no ring
  float aDark = (1.0 - smoothstep(0.05, 0.8, g)) * 0.34 * n * kDark;
  float aHue = exp(-g * g * 11.0) * 0.22 * n * kHue;
  vec4 res = lay(vec4(0.0), cSmoke, aDark);
  res = lay(res, cMid * 0.62, aHue);
  res.rgb += cCore * exp(-g * g * 18.0) * 0.05 * kHue;
  return res * fade * born;
}
`;
