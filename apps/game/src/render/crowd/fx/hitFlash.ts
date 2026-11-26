// Enemy hit flash — crowd FX block snippet (owner: the hits builder; r1 rebuild 2026-10-13).
// Runs inside the crowd fragment shader's FX block (crowdMaterial.ts) after lighting, with `outgoingLight`, `normal`,
// `vFx` (x hit flash, y dissolve, z corruption, w tier), `vStatus` (bit mask), `vLocal`, `uCrowdTime`, crowdNoise() and
// the block locals st, viewDir, fres, rim, tier, rank in scope. Changing the GLSL needs a cache-key bump (crowd-skin-vN)
// only for in-session hot reloads (three.js keys its in-memory program cache by it); a fresh page load always compiles
// the current source.
//
// r1: the old flash mixed the whole model toward white (milky ghost, detail lost, bloom-washed, hid the hit sprite).
// Now the model keeps its own colours: they are lifted (multiplied, so texture detail and shading survive), a hot warm

// The pulse is snappier than the linear sim decay (hf^1.5) and softer on bosses (hit constantly, must keep their read).
// r3: the r1 rim (fres^3 * 1.3, near-white) drew a 1-2 px bright outline round the silhouette at game scale: aliased, a "sticker"
// cut-out. Now the rim is a wide soft fresnel (fres^2) at a fraction of the strength and the flash is mostly a warm body lift,

// r4 (2026-10-27, leftovers L1): PALE and mid-dark bodies washed out to cream / pink-white (ice lion, yeti, ice spirits, white tigers, grey wolves on snow and
// grass; the lava golems and ogres turned pink-white). Cause: the lift (x1.5) and the flat additive fill (1.0, 0.72, 0.4) x (0.07 + fres^2 * 0.26) both push
// a bright body over 1.0 where the ACES curve / bloom turn it cream, and on a dark red body the additive G / B pulls the hue to pink. Now the flash is
// measured against the body's own ALBEDO luminance (flA: the lit value depends on sun / shadow and was too low to tell a yeti from a wolf): the lift and the
// fill shrink with it (flPale: 0 dark .. 1 pale), the fill is a saturated warm orange (never a near-white), and a PALE body shifts toward warm ochre at 0.85 of
// its own luminance instead (texture / shading detail survives, the blink reads as a hue change, not a brighter blob). Dark bodies keep the old strength
// (lift x1.55, a warm fill), bosses stay softer (hf x 0.45). The skin cache key is derived from the GLSL text (crowdSkinKey), nothing to bump.
export const CROWD_FX_HIT_FLASH = /* glsl */ `  // hit flash: lift + warm fill + soft broad rim, scaled by how bright the body already is; pale bodies shift hue instead of brightening
  float hf = clamp(vFx.x, 0.0, 1.0);
  hf *= sqrt(hf) * mix(1.0, 0.45, step(2.5, tier));
  float flA = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  float flPale = smoothstep(0.14, 0.40, flA);
  float flGain = mix(1.0, 0.0, flPale);
  outgoingLight *= 1.0 + 0.55 * hf * flGain;
  outgoingLight += vec3(1.0, 0.5, 0.16) * (0.06 + fres * fres * 0.24) * hf * flGain;
  vec3 flOchre = vec3(1.0, 0.48, 0.16);
  float flL2 = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
  outgoingLight = mix(outgoingLight, flOchre * (flL2 * mix(1.0, 0.85, flPale) / dot(flOchre, vec3(0.2126, 0.7152, 0.0722))), 0.85 * hf * flPale);
`;
