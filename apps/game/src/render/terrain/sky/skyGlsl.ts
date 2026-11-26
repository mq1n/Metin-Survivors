// GLSL shared by the sky dome, the backdrop rings and the liquid shaders so that water / ice reflect the very sky the dome paints.

/**
 * uniforms: uSkyTop, uSkyHorizon, uSkyBottom, uHazeColor (the sky's haze colour: the colour the far terrain ends at, index.ts skyHazeColor;
 * the liquid shaders feed it the biome fog colour).
 *   skyBase(dir)   gradient without distance haze
 *   skyHaze(e)     weight of the fog colour at elevation e (applied after tone mapping by the dome, like the scene fog)
 *   skyGradient(d) both combined (pre tone mapping), for reflections
 *   skyHazeOut()   the colour the far terrain ends at, in the colour space the fragment is written in (SKY_HAZE_OUT_GLSL, dome and rings only)
 *
 * SKY-01: both curves above the horizon start flat. pow(e, 0.4) has an infinite slope at e = 0 and exp(-7 e) a slope of -4.9 against
 * the flat side below the horizon, so the first degree above the horizon climbed far faster than everything else and the dome
 * drew a hard line there (and the 8-bit steps of that climb read as a band). Below E_RAMP / E_HAZE a cubic Hermite with a zero start
 * slope joins the old curve with its own value and slope, so every direction above those elevations is exactly what it was.
 * CPU references: skyRampRef / skyHazeRef (sky.test.ts keeps both in step with the GLSL).
 */
export const SKY_GRADIENT_GLSL = /* glsl */ `
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyBottom;
uniform vec3 uHazeColor;

// pow(e, 0.4) above E_RAMP = 0.12 (value 0.428225, slope 1.4274), a Hermite from 0 with a flat start below it
float skyRamp(float e) {
  float x = clamp(e, 0.0, 1.0);
  if (x >= 0.12) return pow(x, 0.4);
  float t = x / 0.12;
  float t2 = t * t;
  return (3.0 * t2 - 2.0 * t2 * t) * 0.428225 + (t2 * t - t2) * 0.171290;
}

vec3 skyBase(vec3 d) {
  float e = d.y;
  vec3 up = mix(uSkyHorizon, uSkyTop, skyRamp(e));
  vec3 down = mix(uSkyHorizon, uSkyBottom, smoothstep(0.0, -0.45, e));
  return e >= 0.0 ? up : down;
}

// the horizon band dissolves into the fog colour so far ground, backdrop and sky meet without a seam; below the horizon
// the haze dominates (the nadir colour only shows when looking steeply down past the world edge)
// above: 0.7 exp(-7 e) from E_HAZE = 0.06 (value 0.459933, slope -3.2195), a Hermite from 0.7 with a flat start below it
float skyHaze(float e) {
  if (e < 0.0) return 0.7 + 0.22 * smoothstep(0.0, -0.25, e);
  if (e >= 0.06) return exp(-e * 7.0) * 0.7;
  float t = e / 0.06;
  float t2 = t * t;
  return (2.0 * t2 * t - 3.0 * t2 + 1.0) * 0.7 + (3.0 * t2 - 2.0 * t2 * t) * 0.459933 + (t2 * t - t2) * -0.193172;
}

vec3 skyGradient(vec3 d) {
  return mix(skyBase(d), uHazeColor, skyHaze(d.y));
}
`;

/**
 * SKY-01: the haze colour for a mix that happens AFTER `<colorspace_fragment>` (the dome and the rings blend their distance haze
 * there, where three's own fog_fragment and atmosphere.ts blend the depth haze of the terrain). It is the colour the far terrain
 * ends at: the scene fog (`uFogColor`) with atmosphere.ts' depth haze (`uAtmoHaze`, share `uAtmoK`) over it. Both are linear
 * working-space colours. three converts the scene fog on the CPU for a draw straight to the canvas; a ShaderMaterial uniform is not
 * converted. On low there is no post pass (the tone mapped, sRGB encoded fragment goes to the canvas), so mixing a raw linear value
 * there painted every haze band, wall foot and horizon strip dark (linear #b49c7c is (116, 85, 51) as sRGB, against (180, 156, 124)).
 * `linearToOutputTexel` is three's own program prefix: the sRGB transfer function on the canvas, the identity in the linear HDR
 * scene target of medium / high, so there `mix(fog, haze, k)` is exactly the linear colour the terrain ends at.
 *   ATMO_RAW (defined by index.ts when atmosphere.ts mixes its haze colour into the converted fog without converting it, as it did
 *   when this was written, so the far terrain of the low tier is `mix(OETF(fog), haze, k)`): the sky mirrors that, so the two meet
 *   without a step on every tier; without it the haze is converted too (the correct, final form).
 * Needs SKY_GRADIENT_GLSL and a non-raw material.
 */
export const SKY_HAZE_OUT_GLSL = /* glsl */ `
uniform vec3 uFogColor;
uniform vec3 uAtmoHaze;
uniform float uAtmoK;
vec3 skyHazeOut() {
  vec3 fogOut = linearToOutputTexel(vec4(uFogColor, 1.0)).rgb;
#ifdef ATMO_RAW
  return mix(fogOut, uAtmoHaze, uAtmoK);
#else
  return mix(fogOut, linearToOutputTexel(vec4(uAtmoHaze, 1.0)).rgb, uAtmoK);
#endif
}
`;

/**
 * SKY-01: temporal +-1/255 dither, LOW TIER ONLY (`QUALITY == 0`; any other tier, or no QUALITY define at all, gets 0.0 and the
 * compiler drops the add). On low there is no post pass: the dome, the rings and the abyss write the 8-bit canvas themselves, so a
 * slow gradient (the 0.7 haze ramp over a few hundred pixels) quantises into visible stairs. Two taps of post.ts' interleaved-gradient
 * noise (COMPOSITE_FRAG, same constants, same per-frame offset (frame % 97) * 1.37) summed to a triangular distribution of +-1 LSB;
 * `t` is the render time in seconds (worldUniforms.uTime), the pattern re-rolls every 1/60 s (rounded to the nearest frame, so an
 * exact multiple of 1/60 never straddles two). Added AFTER the colour space conversion: a real 8-bit LSB.
 * Medium and up render into the linear HDR scene target and post.ts dithers the final 8-bit write itself; a dither added there
 * would land before ACES and the sRGB curve, which stretch it by up to 12x in dark skies (Daeryeol's near-black sky went from
 * a std of 0.4 to 2 LSB with peaks of +-5), so those tiers draw no sky dither of their own.
 */
export const SKY_DITHER_GLSL = /* glsl */ `
float skyDither(float t) {
#if defined( QUALITY ) && QUALITY == 0
  vec2 fc = gl_FragCoord.xy + mod(floor(t * 60.0 + 0.5), 97.0) * 1.37 * vec2(5.588238, 3.1415);
  float a = fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715))));
  float b = fract(52.9829189 * fract(dot(fc.yx + 23.7, vec2(0.06711056, 0.00583715))));
  return (a + b - 1.0) * (1.0 / 255.0);
#else
  return 0.0;
#endif
}
`;

/** Elevation (rad above the horizon) where skyRamp / skyHaze meet the old curves. */
export const SKY_E_RAMP = 0.12;
export const SKY_E_HAZE = 0.06;

/** CPU reference of skyRamp (the GLSL above): pow(e, 0.4) with a flat Hermite start below SKY_E_RAMP. */
export function skyRampRef(e: number): number {
  const x = Math.min(1, Math.max(0, e));
  if (x >= SKY_E_RAMP) return Math.pow(x, 0.4);
  const t = x / SKY_E_RAMP;
  const p1 = Math.pow(SKY_E_RAMP, 0.4);
  const m1 = 0.4 * Math.pow(SKY_E_RAMP, -0.6) * SKY_E_RAMP;
  return (3 * t * t - 2 * t * t * t) * p1 + (t * t * t - t * t) * m1;
}

/** CPU reference of skyHaze (the GLSL above). */
export function skyHazeRef(e: number): number {
  if (e < 0) {
    const s = Math.min(1, Math.max(0, e / -0.25));
    return 0.7 + 0.22 * (s * s * (3 - 2 * s));
  }
  if (e >= SKY_E_HAZE) return Math.exp(-e * 7) * 0.7;
  const t = e / SKY_E_HAZE;
  const p1 = Math.exp(-SKY_E_HAZE * 7) * 0.7;
  const m1 = -4.9 * Math.exp(-SKY_E_HAZE * 7) * SKY_E_HAZE;
  return (2 * t * t * t - 3 * t * t + 1) * 0.7 + (3 * t * t - 2 * t * t * t) * p1 + (t * t * t - t * t) * m1;
}

/** CPU reference of skyDither for one fragment (x, y = gl_FragCoord.xy) at render time t: a value in (-1/255, 1/255) on QUALITY 0, else 0. */
export function skyDitherRef(x: number, y: number, t: number, quality = 0): number {
  if (quality !== 0) return 0;
  const fract = (v: number): number => v - Math.floor(v);
  const off = (Math.floor(t * 60 + 0.5) % 97) * 1.37;
  const fx = x + off * 5.588238;
  const fy = y + off * 3.1415;
  const a = fract(52.9829189 * fract(fx * 0.06711056 + fy * 0.00583715));
  const gx = fy + 23.7;
  const gy = fx;
  const b = fract(52.9829189 * fract(gx * 0.06711056 + gy * 0.00583715));
  return (a + b - 1) / 255;
}

type Rgb = readonly [number, number, number];
const srgbOetf = (x: number): number => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);

/**
 * CPU reference of skyHazeOut (the GLSL above): `fog` / `haze` are linear working-space colours, `k` the atmosphere haze share. `canvas`:
 * the fragment goes to the sRGB canvas (low; medium / high draw into the linear HDR target, where the output transform is the identity);
 * `raw`: ATMO_RAW (atmosphere.ts mixes its haze colour unconverted). Returns the colour in the space the fragment is written in.
 */
export function skyHazeOutRef(fog: Rgb, haze: Rgb, k: number, raw: boolean, canvas: boolean): [number, number, number] {
  const out = (c: Rgb): Rgb => (canvas ? [srgbOetf(c[0]), srgbOetf(c[1]), srgbOetf(c[2])] : c);
  const f = out(fog);
  const h = raw ? haze : out(haze);
  return [f[0] + (h[0] - f[0]) * k, f[1] + (h[1] - f[1]) * k, f[2] + (h[2] - f[2]) * k];
}
