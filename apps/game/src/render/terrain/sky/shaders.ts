// GLSL for the sky dome and the backdrop rings. Defines: QUALITY 0..2 · CLOUD 0..3 · NPLUME n · STRATA · SNOW · VOLCANO · MESA.
// SKY-01: both fragment shaders blend their haze in the output colour space (skyHazeOut) and end with skyDither(uTime) (skyGlsl.ts:
// low tier only), the abyss in index.ts too.
import { SKY_DITHER_GLSL, SKY_GRADIENT_GLSL, SKY_HAZE_OUT_GLSL } from './skyGlsl';

export const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  // pin the dome to the far plane: opaque geometry drawn earlier rejects the pixels it covers (early-z), nothing is written
  gl_Position.z = gl_Position.w * 0.9999;
}
`;

export const DOME_FRAG = /* glsl */ `
${SKY_GRADIENT_GLSL}
${SKY_HAZE_OUT_GLSL}
${SKY_DITHER_GLSL}
uniform sampler2D uNoise;
uniform float uTime;
uniform vec2 uWindDir;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec3 uGlow;
#if NPLUME > 0
uniform vec4 uPlume[NPLUME];
#endif
varying vec3 vDir;

float cn(vec2 p) { return texture2D(uNoise, p).b; }

// fbm-ish cloud field with its contrast stretched around 0.5
float shape(vec2 p) {
  #if QUALITY >= 1
    float n = cn(p) * 0.55 + cn(p * 2.3 + 0.37) * 0.3 + cn(p * 5.1 + 0.71) * 0.15;
  #else
    float n = cn(p) * 0.7 + cn(p * 2.3 + 0.37) * 0.3;
  #endif
  return (n - 0.5) * 2.5 + 0.5;
}

void main() {
  vec3 d = normalize(vDir);
  float e = d.y;
  vec3 col = skyBase(d);
  float cs = max(dot(d, uSunDir), 0.0);
  float above = smoothstep(-0.03, 0.04, e);
  vec3 sunTint = uSunColor;

  #if CLOUD == 3
    // ember horizon: the whole rim of the world glows
    col += uGlow * (exp(-abs(e) * 5.5) * 0.7 + exp(-abs(e) * 18.0) * 0.8);
    sunTint *= 0.35;
  #endif
  col += sunTint * (pow(cs, 7.0) * 0.16 + pow(cs, 80.0) * 0.5);
  col += sunTint * smoothstep(0.99925, 0.99975, cs) * 7.0 * above;

  #if CLOUD == 2 && QUALITY >= 1
    // faint aurora curtains (textureLod: the bearing wraps, so no screen-space derivatives)
    float az = atan(d.x, d.z) * 0.15915;
    float band = smoothstep(0.1, 0.26, e) * (1.0 - smoothstep(0.36, 0.7, e));
    float a1 = textureLod(uNoise, vec2(az * 2.0 + uTime * 0.004, 0.13), 1.5).b;
    float rays = textureLod(uNoise, vec2(az * 14.0 + a1 * 1.3, e * 0.2 + uTime * 0.006), 1.5).b;
    float curtain = smoothstep(0.42, 0.72, a1) * smoothstep(0.38, 0.7, rays) * band;
    vec3 aur = mix(vec3(0.08, 0.85, 0.5), vec3(0.42, 0.28, 0.9), smoothstep(0.15, 0.5, e + rays * 0.12));
    col += aur * curtain * 0.38;
  #endif

  vec2 w = uWindDir * uTime * 0.006;
  vec2 uv = d.xz / max(e + 0.25, 0.06);
  vec2 sunUv = normalize(uSunDir.xz + 1e-4) * 0.012;
  float fadeH = smoothstep(0.0, 0.2, e);
  float dens = 0.0;
  float lit = 0.5;
  vec3 cloudCol = uCloudLit;
  float edge = 0.0;

  #if CLOUD == 0
    vec2 p = uv * 0.45 + w;
    float s = shape(p);
    float s2 = shape(p + sunUv);
    dens = smoothstep(0.54, 0.78, s);
    lit = clamp(0.55 + (s - s2) * 5.0, 0.0, 1.0);
    lit = mix(lit, 1.0, 0.3 * (1.0 - smoothstep(0.5, 0.9, s)));
    cloudCol = mix(uCloudShade, uCloudLit, smoothstep(0.15, 0.8, lit));
  #elif CLOUD == 1
    vec2 p = vec2(uv.x * 0.2, uv.y * 0.65) + w;
    float s = shape(p);
    float s2 = shape(p + sunUv);
    dens = smoothstep(0.5, 0.76, s) * 0.92;
    lit = clamp(0.5 + (s - s2) * 4.0, 0.0, 1.0);
    cloudCol = mix(uCloudShade, uCloudLit, smoothstep(0.2, 0.85, lit));
    cloudCol += uGlow * 0.5 * (1.0 - lit) * (0.35 + 0.65 * pow(cs, 2.0));
  #elif CLOUD == 2
    vec2 p = vec2(uv.x * 0.1, uv.y * 0.6) + w * 0.5;
    float s = shape(p);
    float s2 = shape(p + sunUv);
    dens = smoothstep(0.36, 0.62, s) * 0.9;
    #if QUALITY >= 1
      float cirrus = smoothstep(0.52, 0.78, shape(vec2(uv.x * 0.05 + 0.3, uv.y * 1.5) + w * 0.3)) * 0.5;
      dens = max(dens, cirrus);
    #endif
    lit = clamp(0.55 + (s - s2) * 2.5, 0.0, 1.0);
    cloudCol = mix(uCloudShade, uCloudLit, smoothstep(0.2, 0.85, lit));
  #else
    vec2 p = uv * 0.4 + w * 1.5;
    float s = shape(p);
    float s2 = shape(p + sunUv);
    dens = smoothstep(0.4, 0.64, s) * 0.96;
    lit = clamp(0.4 + (s - s2) * 4.0, 0.0, 1.0);
    cloudCol = mix(uCloudShade, uCloudLit, lit * 0.55);
    // underlit by the glowing horizon and the lava fields
    cloudCol += uGlow * pow(1.0 - e, 3.0) * smoothstep(0.35, 0.7, s) * 0.55;
  #endif

  edge = dens * (1.0 - dens) * 4.0;
  #if QUALITY >= 1
    cloudCol += sunTint * pow(cs, 5.0) * edge * 0.5;
  #endif
  #if CLOUD == 3
    cloudCol += uGlow * edge * 0.35;
  #endif
  dens *= fadeH;
  col = mix(col, cloudCol, dens);

  #if NPLUME > 0
    // smoke plumes rising from the crater rims of the backdrop cones
    vec2 dh = normalize(d.xz + 1e-5);
    float el = asin(clamp(e, -1.0, 1.0));
    for (int i = 0; i < NPLUME; i++) {
      vec4 pl = uPlume[i];
      float cr = dh.x * pl.y - dh.y * pl.x;
      float facing = step(0.0, dot(dh, pl.xy));
      float h = el - pl.z;
      float wd = 0.014 + max(h, 0.0) * 0.5;
      float sway = (textureLod(uNoise, vec2(h * 5.0 - uTime * 0.02, 0.37), 1.0).b - 0.5) * (0.02 + max(h, 0.0) * 0.5);
      float x = abs(cr - sway) / wd;
      float col1 = 1.0 - smoothstep(0.3, 1.0, x);
      float puff = textureLod(uNoise, vec2(cr * 16.0, h * 12.0 - uTime * 0.05), 1.0).b;
      float plume = col1 * smoothstep(-0.002, 0.012, h) * (1.0 - smoothstep(0.22, 0.52, h)) * smoothstep(0.2, 0.58, puff + 0.3) * facing;
      vec3 smoke = vec3(0.035, 0.014, 0.012) + uGlow * 0.6 * exp(-max(h, 0.0) * 16.0);
      col = mix(col, smoke, plume * 0.9 * pl.w);
    }
  #endif

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // distance haze is applied after tone mapping, like the scene fog on the terrain, towards the colour the far terrain ends at (index.ts
  // skyHazeColor: fog + atmosphere depth haze), so the far ground meets the dome seamlessly;
  // SKY-01: in the colour space of the fragment (three converts the scene fog the same way): on low the canvas is sRGB
  gl_FragColor.rgb = mix(gl_FragColor.rgb, skyHazeOut(), skyHaze(e) * (1.0 - 0.4 * dens));
  // SKY-01: low tier only (the other tiers are dithered by post.ts): temporal +-1/255 triangular dither on post.ts' hash
  gl_FragColor.rgb += skyDither(uTime);
}
`;

export const RING_VERT = /* glsl */ `
attribute vec3 aTint;
attribute vec4 aA;
attribute vec2 aB;
varying vec3 vTint;
varying vec4 vA;
varying vec2 vB;
varying vec3 vDirW;
void main() {
  vTint = aTint;
  vA = aA;
  vB = aB;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDirW = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const RING_FRAG = /* glsl */ `
${SKY_GRADIENT_GLSL}
${SKY_HAZE_OUT_GLSL}
${SKY_DITHER_GLSL}
uniform sampler2D uNoise;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uShadow;
uniform float uSnow;
uniform float uRough;
varying vec3 vTint;
varying vec4 vA;
varying vec2 vB;
varying vec3 vDirW;

void main() {
  float hTop = max(vA.y, 1.0);
  float frac = clamp(vA.x / hTop, -0.5, 1.2);
  vec3 dir = normalize(vDirW);
  vec3 rad = normalize(vec3(dir.x, 0.0, dir.z));
  vec3 tang = vec3(-rad.z, 0.0, rad.x);
  // facade normal from the silhouette slope: ridges facing the sun catch light, the opposite flank falls into shadow
  vec3 n = normalize(-rad * 0.85 - tang * vA.z * 2.2 * (0.3 + 0.7 * smoothstep(0.45, 1.0, frac)) + vec3(0.0, 0.55, 0.0));
  #if QUALITY >= 1
    vec2 facet = texture2D(uNoise, vec2(vB.x * 48.0, vA.x * 0.08)).rg * 2.0 - 1.0;
    float fine = texture2D(uNoise, vec2(vB.x * 96.0, vA.x * 0.12 + 0.5)).b;
    n = normalize(n + (tang * facet.x + vec3(0.0, 1.0, 0.0) * facet.y) * uRough);
  #else
    float fine = 0.5;
  #endif
  float lit = smoothstep(-0.25, 0.65, dot(n, uSunDir));
  vec3 c = mix(mix(vTint, uShadow, 0.55) * 0.75, vTint * (0.95 + 0.4 * uSunColor), lit);
  c *= 0.9 + 0.2 * fine;

  #ifdef STRATA
    // sandstone strata: alternating red / cream beds over a finer layering, rain-wash gullies down the walls, and a pale
    // cap rock with a shadowed lip under the flat tops
    float hs = vA.x + (fine - 0.5) * 2.0;
    float beds = smoothstep(-0.3, 0.3, sin(hs * 0.3));
    float thin = smoothstep(-0.3, 0.6, sin(hs * 1.2 + 1.7));
    c *= mix(vec3(0.9, 0.7, 0.6), vec3(1.1, 1.05, 0.96), beds) * (0.84 + 0.16 * thin);
    #if QUALITY >= 1
      float gully = texture2D(uNoise, vec2(vB.x * 160.0, vA.x * 0.01)).b;
      c *= 0.78 + 0.34 * smoothstep(0.25, 0.75, gully);
    #endif
    float cap = smoothstep(0.88, 0.94, frac) * step(frac, 1.0);
    float lip = smoothstep(0.8, 0.86, frac) * (1.0 - smoothstep(0.86, 0.9, frac));
    c = mix(c, c * 1.22 + 0.015, cap) * (1.0 - 0.32 * lip);
  #endif
  #ifdef SNOW
    float snow = smoothstep(uSnow - 6.0, uSnow + 10.0, vA.x + (fine - 0.5) * 22.0) * smoothstep(-0.1, 0.45, n.y);
    vec3 snowCol = mix(uShadow * 1.9 + 0.12, vec3(0.95, 0.97, 1.0), lit);
    c = mix(c, snowCol, snow);
  #endif
  vec3 glow = vec3(0.0);
  #ifdef VOLCANO
    float cone = vA.w;
    float crater = cone * cone * cone * smoothstep(0.88, 0.99, frac);
    float st = texture2D(uNoise, vec2(vB.x * 96.0, vA.x * 0.012)).a;
    float lava = cone * (1.0 - smoothstep(0.0, 0.14, st)) * smoothstep(0.25, 0.75, frac) * step(frac, 1.0);
    float flick = 0.9 + 0.1 * sin(uTime * 1.3 + vB.x * 500.0);
    glow = vec3(1.0, 0.32, 0.06) * (crater * 2.6 + lava * 1.5) * flick;
  #endif

  // aerial perspective towards the very gradient the dome paints at this direction, and a fade at the foot
  float haze = vB.y * (1.0 - 0.25 * clamp(frac, 0.0, 1.0));
  float foot = 1.0 - smoothstep(0.0, 30.0, vA.x);
  float hz = max(haze, foot);
  c = mix(c, skyBase(dir), hz);
  c += glow * (1.0 - hz * 0.5);

  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // SKY-01: the haze colour in the fragment's colour space (see skyHazeOut), once for both mixes
  vec3 hazeOut = skyHazeOut();
  gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeOut, hz * skyHaze(dir.y));
  #ifdef MESA
    // canyon country: the walls rise out of the valley haze (the scene fog the far terrain already wears), not the sky band
    gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeOut, foot);
  #endif
  // SKY-01: the dome's low tier dither, so the haze gradient of a wall does not band on its own
  gl_FragColor.rgb += skyDither(uTime);
}
`;
