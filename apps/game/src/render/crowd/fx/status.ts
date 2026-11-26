// Enemy body status tints (slow, poison, burn, stun, freeze, bleed) — crowd FX block snippet (C0 split; owner: the status builder).
// Runs inside the crowd fragment shader's FX block (crowdMaterial.ts) after lighting, with `outgoingLight`, `normal`,
// `vFx` (x hit flash, y dissolve, z corruption, w tier), `vStatus` (bit mask), `vLocal`, `uCrowdTime`, crowdNoise() and
// the block locals st, viewDir, fres, rim, tier, rank in scope. Changing the GLSL needs a cache-key bump (crowd-skin-vN).
//
// r3 (2026-10-20): the slow dim is lighter (weight 0.7 -> 0.5): the critic read the darkened legs as a shadow, the smoke columns carry the read now.
// r1 (2026-10-19): the tints are SUPPORT for the sprite loops (vfx/common/status), not the status itself: burn was a uniform gold plating of every
// enemy (now a noise-masked ember crawl + a warm rim, the flame sprites carry the read), slow was a flat blue clay (now a subtle drained violet dim),
// poison a heavy green mix (now a light cast + a green rim), stun a yellow rim pulse (now lavender like its ring). Freeze / bleed are unchanged
// (their sprite loops are not built yet).
export const CROWD_FX_STATUS = /* glsl */ `  // status tints (bit order: slow, poison, burn, stun, freeze, bleed, fear, weaken)
  float poison = step(0.5, mod(floor(st / 2.0), 2.0));
  float burn = step(0.5, mod(floor(st / 4.0), 2.0));
  float stun = step(0.5, mod(floor(st / 8.0), 2.0));
  float freeze = step(0.5, mod(floor(st / 16.0), 2.0));
  float slow = step(0.5, mod(st, 2.0));
  float bleed = step(0.5, mod(floor(st / 32.0), 2.0));
  outgoingLight = mix(outgoingLight, outgoingLight * vec3(0.55, 0.85, 1.35) + vec3(0.02, 0.07, 0.12), freeze);
  // slow: drained, slightly violet dim (the smoke at the feet carries the read)
  float slowLum = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
  outgoingLight = mix(outgoingLight, mix(vec3(slowLum), outgoingLight, 0.6) * vec3(0.88, 0.84, 1.0) * 0.95, slow * (1.0 - freeze) * 0.5);
  // poison: light green cast + a green fresnel rim under the gas
  outgoingLight = mix(outgoingLight, outgoingLight * vec3(0.84, 1.08, 0.78), poison * 0.24);
  outgoingLight += poison * vec3(0.1, 0.62, 0.08) * (0.02 + rim * 0.7);
  // burn: embers crawling over the mesh (noise mask, drifting up) + a warm rim; never a uniform tint
  float flick = 0.75 + 0.25 * sin(uCrowdTime * 17.0 + vLocal.y * 6.0);
  float crawl = smoothstep(0.55, 0.86, crowdNoise(vLocal * 6.0 + vec3(0.0, -uCrowdTime * 1.6, 0.0)));
  outgoingLight += burn * vec3(1.0, 0.36, 0.05) * (0.015 + rim * 0.55 + crawl * 0.3) * flick;
  // stun: pale lavender rim pulse (matches the ring and the stars above the head)
  outgoingLight += stun * vec3(0.62, 0.56, 1.0) * rim * (0.5 + 0.5 * sin(uCrowdTime * 12.0)) * 0.55;
  outgoingLight += bleed * vec3(0.6, 0.02, 0.02) * rim * 0.5;

`;
