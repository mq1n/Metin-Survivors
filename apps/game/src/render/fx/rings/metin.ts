// Ground look of a living metin stone, kind `metin`: a FILLED rune-glyph carpet in the rune colour (one GLSL branch of groundRings.ts
// `ringLook`; owner: the metin builder). Rebuilt r1 (2026-10-19): the old look was a hairline hexagram + hairline rune band drawn over the
// whole 13 m aura radius, bare line art on the floor. Now:
//   - a filled, soot-dark carpet disc (radius ~28 % of the aura radius: ~3.6 m for a stone) tinted deep rune colour, so it reads on snow;
//   - engraved concentric grooves, 12 faint wedges, a ring of FAT soft glyphs (runeMask with a wide soft stroke, not 1 px lines),
//     a filled hexagram (two filled triangles, brighter where they overlap) with a glowing heart and orbiting nodes;
//   - a slow expanding pulse, a soft dark rim and glow outside the rim;
//   - the aura (gameplay) radius is marked by a soft broken band of glyph ticks, never a hairline circle.
// Awakened stones (strength > 1.2) lean the carpet toward blood red. Runs inside `vec4 ringLook(vec2 l, float R, float kind, float str,
// vec3 colMain, float seed, float t)` with the locals TAU, r, ang, aaM, col, a, outside and the FX_GLSL_LIB helpers (band, layer,
// hash21, runeMask) plus rot2 / sdNgon / diamond in scope; write straight-alpha colour via layer().
export const RING_METIN = /* glsl */ `    // ---- metin: filled rune-glyph carpet in the rune colour --------------------------------------------------
    float awk = smoothstep(1.15, 1.3, str);
    vec3 c = mix(colMain, vec3(0.92, 0.1, 0.07), awk * 0.85);
    vec3 cHi = mix(c, vec3(1.0, 0.96, 0.9), 0.42);
    vec3 cDeep = c * 0.3 + vec3(0.012, 0.0, 0.02);
    float pulse = 0.82 + 0.18 * sin(t * (2.0 + awk * 1.4) + seed);
    float rc = clamp(R * 0.28, 1.6, 6.0);
    float rho = r / rc;
    float inC = 1.0 - smoothstep(0.9, 1.0, rho);
    // filled base: scorched stone tinted by the rune colour (dark body keeps the carpet readable on snow)
    layer(col, a, cDeep, inC * (0.5 - 0.12 * smoothstep(0.0, 0.5, rho)));
    // radial wedges (12): alternate faint fills, the carpet pattern of a woven rug
    float wedge = step(0.5, fract(ang / TAU * 12.0 + 0.25));
    layer(col, a, c * 0.8, inC * smoothstep(0.22, 0.3, rho) * (0.12 + 0.1 * wedge));
    // engraved grooves: three soft concentric bands (wide, glowing, never hairlines)
    layer(col, a, c, band(rho, 0.3, 0.035, aaM / rc) * inC * 0.55 * pulse);
    layer(col, a, c, band(rho, 0.62, 0.03, aaM / rc) * inC * 0.5);
    layer(col, a, c, band(rho, 0.9, 0.045, aaM / rc) * inC * 0.62 * pulse);
    // ring of fat soft glyphs between the second and third groove
    float rLo = rc * 0.67;
    float rHi = rc * 0.86;
    float nC = max(10.0, floor(TAU * (rLo + rHi) * 0.5 / 0.62));
    float u = ang / TAU - t * 0.012;
    float cid = floor(u * nC);
    float cu = fract(u * nC) - 0.5;
    float cv = (r - rLo) / (rHi - rLo) - 0.5;
    float inBand = band(r, (rLo + rHi) * 0.5, (rHi - rLo) * 0.5, aaM);
    float flick = 0.7 + 0.3 * step(0.35, hash21(vec2(cid, floor(t * 1.3 + cid * 0.53))));
    float rm = 0.0;
    float rg = 0.0;
#ifndef LOW
    if (inBand > 0.001) {
      rg = runeMask(vec2(cu, cv), cid + 3.0, 0.13) * inBand;
      rm = runeMask(vec2(cu, cv), cid + 3.0, 0.045) * inBand;
    }
#endif
    layer(col, a, c, rg * 0.7 * flick);
    layer(col, a, cHi, rm * 0.85 * flick);
    // filled hexagram: two filled triangles, a brighter lens where they overlap, soft inner glow
    vec2 p1 = rot2(l, t * 0.1);
    vec2 p2 = rot2(l, -t * 0.1 + 1.0471976);
    float rt = rc * 0.28;
    float s1 = sdNgon(p1, rt, 3.0);
    float s2 = sdNgon(p2, rt, 3.0);
    float f1 = 1.0 - smoothstep(-aaM, aaM, s1);
    float f2 = 1.0 - smoothstep(-aaM, aaM, s2);
    layer(col, a, c, max(f1, f2) * 0.4);
    layer(col, a, cHi, f1 * f2 * 0.3 * pulse);
    float e1 = band(s1, 0.0, 0.05, aaM);
    float e2 = band(s2, 0.0, 0.05, aaM);
    layer(col, a, cHi, max(e1, e2) * 0.65 * pulse);
    // glowing heart under the stone
    layer(col, a, cHi, exp(-r * r / (rc * rc * 0.012)) * 0.45 * pulse);
    // orbiting nodes on the groove
    for (int i = 0; i < 3; i++) {
      float oa = t * 0.6 + float(i) * 2.0943951 + seed;
      vec2 op = vec2(sin(oa), cos(oa)) * rc * 0.62;
      layer(col, a, cHi, (1.0 - smoothstep(0.1, 0.1 + aaM * 2.0, length(l - op))) * 0.85);
    }
    // slow expanding pulse over the carpet
    float wv = fract(t * 0.22 + seed * 0.1);
    layer(col, a, cHi, band(r, wv * rc, 0.1 + 0.12 * wv, aaM) * (1.0 - wv) * (1.0 - wv) * 0.4 * inC);
    // dark soot rim and the carpet's glow spilling over the edge
    layer(col, a, vec3(0.02, 0.0, 0.03), band(r, rc * 1.0, 0.16, aaM) * 0.32);
    layer(col, a, c, exp(-max(r - rc, 0.0) / 0.35) * step(rc, r) * 0.32 * pulse);
    // the aura radius: a soft broken band of glyph ticks (the gameplay edge), faint. r9 ship (Z9 critic: the dashed ring vanished on Seori
    // snow, even at +120 % contrast): each tick sits on a dark rune-tinted under-stroke first, so it reads on white ground as well as on grass
    float ar = band(r, R - 0.2, 0.3, aaM * 1.5);
    float dash = smoothstep(0.3, 0.7, fract(ang / TAU * 56.0 + t * 0.012));
    layer(col, a, cDeep, ar * dash * 0.24);
    layer(col, a, c, ar * dash * 0.13 * pulse);
    layer(col, a, c, exp(-abs(r - (R - 0.2)) / 0.6) * 0.045 * (1.0 - outside));
`;
