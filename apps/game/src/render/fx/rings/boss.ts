// Ground ring look, kind `boss` (owner: the boss builder): one GLSL branch of groundRings.ts `ringLook`. Runs inside `vec4 ringLook(vec2 l,
// float R, float kind, float str, vec3 colMain, float seed, float t)` with the locals TAU, r, ang, aaM, col, a, outside and the FX_GLSL_LIB
// helpers (band, layer, hash21, runeMask) plus rot2 / sdNgon / diamond in scope; write straight-alpha colour via layer().
//
// r1 rebuild (2026-10-19): the loud crimson rune disc (opaque fill, chunky glyph band, gold hairlines + dots + a thick outer ring) became a

// embers and a dim thin glyph ring. No filled disc, no hairline circle: the red telegraph decals and the VFX of the boss patterns are the loud
// things of a boss fight, the sigil only says "boss".
// r2 (2026-10-20): the critic found "four white-hot crescent stickers styled like the hero ring" on stone and "a flat pale-grey translucent disc
// with a crisp edge" on snow. The disc is NOT in this branch: it is the crowd's blob shadow under the boss body (render/crowd/crowd.ts, core) with the
// ring's own dark pool on top of it; the pool is gone here (the arcs carry their own dark under-glow), and the arcs are no longer white-hot: more of
// them, shorter, a deep crimson body with an ember core (never the cream `hot`), so the boss sigil is a smouldering broken ring, not a hero ring.
// r3 (2026-10-22): the critic still saw "pink-red chevron and dot decals sit around the boss in every frame, flat stamped wedges". They were the dim glyph ring
// (runeMask cells: chevrons and dots, flickering on and off at random radii) and the pink of the default boss colour #c01f38. The glyph ring is gone; the arcs
// are fewer, LONGER and softer (a smouldering broken ring), the colour is pulled from pink to a deep blood red with an ember core, and a faint scorched
// band under them says "burnt ground" instead of a stamp. Nothing here is a filled shape or a vector outline.
import { arcLayer, cometLayer } from './arcs';

export const RING_BOSS = /* glsl */ `    // ---- boss: smouldering broken ring, 2 counter-turning layers of long soft deep-red arcs + embers over a faint scorched band -----------------
    vec3 crim = mix(colMain, vec3(0.6, 0.09, 0.03), 0.55);
    vec3 ember = mix(vec3(1.0, 0.46, 0.14), crim, 0.25);
    vec3 glowc = mix(crim, vec3(0.74, 0.12, 0.04), 0.5);
    vec3 deep = vec3(0.05, 0.0, 0.0);
    float pulse = 0.5 + 0.5 * sin(t * 1.6 + seed);
    float breathe = 0.82 + 0.18 * pulse;
    // burnt ground: a wide feathered dark band under the arcs (no edge, no fill)
    layer(col, a, deep, exp(-abs(r - (R - 0.45)) / 0.55) * (1.0 - outside) * 0.16 * breathe);
${arcLayer({ id: 1, n: 6, len: [0.55, 0.9], rc: 'R - 0.2', core: 0.05, outW: 0.24, inW: 0.65, spin: 0.04, glowCol: 'glowc', coreCol: 'ember', aGlow: 0.46, aCore: 0.2, under: 'deep', aUnder: 0.3, endSoft: 0.6, endW: 1.0, wobble: 0.03, gain: 'breathe' })}${arcLayer({ id: 2, n: 4, len: [0.4, 0.75], rc: 'R - 0.85', core: 0.04, outW: 0.16, inW: 0.45, spin: -0.07, glowCol: 'crim', coreCol: 'ember', aGlow: 0.3, aCore: 0.12, endSoft: 0.6, endW: 1.0, wobble: 0.03, gain: 'breathe' })}${cometLayer({ id: 3, n: 3, rc: 'R - 0.12', spin: 0.11, size: 0.05, tail: 0.3, col: 'ember', a: 0.4 })}`;
