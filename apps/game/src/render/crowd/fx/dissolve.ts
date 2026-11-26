// Corpse fade — the discard pass after <color_fragment> (CROWD_DISSOLVE: sets `crowdAsh`, keeps `crowdEdge` = 0 for the other FX
// snippets) and the grey-out in the FX block (CROWD_FX_DISSOLVE_EDGE). C0 split moved it verbatim; rebuilt r1 (2026-10-19, owner: the

// a hot peach rim ("burnt paper", leopard-spotted holes) are gone.
// r2 (blind critic): the r1 interleaved-gradient-noise dither drew a REGULAR diagonal lattice (a fishnet over the whole body for ~0.7 s).
// Now (1) the body stays WHOLE for most of the fade and only cools / darkens toward the plum ash of the death smoke (the corpse stays readable),
// (2) only the last ~sixth of the fade thins the body out, with WHITE noise (Hoskins hash of the pixel and a 24 Hz frame index: no lattice, the
// pattern changes every frame so the eye integrates it into a soft see-through ghost), never a blotch, no glow, no hole edge.
// The opaque crowd pass cannot do real alpha: the true fix is a core change (crowd.ts: keep the corpse lying >= 1.5 s = hold the death clip, then
// fade over ~1 s, ideally in a short transparent pass for the few fading corpses) — see structure.txt "corpse".
// vFx.y > 0: fade OUT (corpse), 0 -> 1. vFx.y < 0: fade IN (spawn emerge, once the core writes the channel), -1 (hidden) -> 0 (solid):
// the same noise serves both, the kept share is 1 - the threshold.
// Runs inside the crowd fragment shader's FX block (crowdMaterial.ts) after lighting, with `outgoingLight`, `normal`,
// `vFx` (x hit flash, y fade, z corruption, w tier), `vStatus` (bit mask), `vLocal`, `uCrowdTime`, crowdNoise() and
// the block locals st, viewDir, fres, rim, tier, rank in scope. Changing the GLSL needs a cache-key bump (crowd-skin-vN).
export const CROWD_DISSOLVE = /* glsl */ `
float crowdEdge = 0.0;
float crowdAsh = 0.0;
if (abs(vFx.y) > 0.001) {
  float crowdProg = clamp(abs(vFx.y), 0.0, 1.0);
  // corpse: whole until 0.82 of the fade, then thinned out; spawn emerge (y < 0): the plain progress
  float crowdThin = vFx.y > 0.0 ? smoothstep(0.82, 1.0, crowdProg) : crowdProg;
  vec3 crowdP3 = fract(vec3(gl_FragCoord.xy, floor(uCrowdTime * 24.0)) * 0.1031);
  crowdP3 += dot(crowdP3, crowdP3.zyx + 31.32);
  float crowdWhite = fract((crowdP3.x + crowdP3.y) * crowdP3.z);
  if (crowdWhite < crowdThin) discard;
  
  crowdAsh = vFx.y > 0.0 ? smoothstep(0.0, 0.8, crowdProg) * 0.22 : 0.0;
}
`;

export const CROWD_FX_DISSOLVE_EDGE = /* glsl */ `  // corpse fade: the body cools toward the grey-plum of the death smoke and darkens while it lies there (no hot rim)
  outgoingLight = mix(outgoingLight, vec3(dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722))) * vec3(0.8, 0.64, 0.82), crowdAsh * 0.5);
  outgoingLight *= 1.0 - 0.22 * crowdAsh;
`;
