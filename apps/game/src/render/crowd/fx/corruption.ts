// Corrupted-enemy look (metin aura) — crowd FX block snippet (C0 split; owner: the player-feedback builder).
// Runs inside the crowd fragment shader's FX block (crowdMaterial.ts) after lighting, with `outgoingLight`, `normal`,
// `vFx` (x hit flash, y dissolve, z corruption, w tier), `vStatus` (bit mask), `vLocal`, `uCrowdTime`, crowdNoise() and
// the block locals st, viewDir, fres, rim, tier, rank in scope. Changing the GLSL needs a cache-key bump (crowd-skin-vN).
//
// r2 (2026-10-20): r1 still read PINK (violet grade over an orange / tan albedo + a magenta rim + pink embers): now a darker, colder grade
// (62 % luminance, 68 % mix, hue cool violet-grey, no red in the rim or the embers) so a corrupted creature reads as a dark cold
// body with a thin indigo rim, never magenta.
// r1 (2026-10-19): the pink / magenta camo repaint (a noise-vein mix multiplied over the whole mesh: every corrupted creature

// KEPT (only a cool dark grade, 45 % at full corruption, towards a violet-black desaturated body), the silhouette gets a
// pulsing violet rim, and a few sparse ember flecks drift up the body in object space (tiny hot specks, < 10 % coverage, never
// veins). The rising wisps / ground smear belong to the status target's corruption loops (bodyFeed), not to this block.
export const CROWD_FX_CORRUPTION = /* glsl */ `  // corruption (Metin aura): dark cold violet-black grade that keeps the albedo detail + thin pulsing indigo rim + sparse lilac embers
  float cr = vFx.z;
  if (cr > 0.001) {
    float pulse = 0.75 + 0.25 * sin(uCrowdTime * 1.7 + vLocal.x * 2.0 + vLocal.z * 1.5);
    float lumC = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
    vec3 dark = vec3(lumC) * vec3(0.55, 0.5, 0.95) * 0.62;
    outgoingLight = mix(outgoingLight, dark, clamp(cr, 0.0, 1.0) * 0.5);
    float emb = smoothstep(0.78, 0.92, crowdNoise(vLocal * 9.0 + vec3(0.0, -uCrowdTime * 0.7, 0.0)));
    outgoingLight += vec3(0.26, 0.2, 1.0) * rim * 0.32 * cr * pulse;
    outgoingLight += vec3(0.62, 0.5, 1.0) * emb * cr * (0.5 + 0.5 * pulse) * 0.35;
  }

`;
