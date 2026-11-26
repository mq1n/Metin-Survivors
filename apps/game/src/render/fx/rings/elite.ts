// Ground ring look, kind `elite` (owner: the player-feedback builder): one GLSL branch of groundRings.ts `ringLook`. Runs inside
// `vec4 ringLook(vec2 l, float R, float kind, float str, vec3 colMain, float seed, float t)` with the locals TAU, r, ang, aaM,
// col, a, outside and the FX_GLSL_LIB helpers (band, layer, hash21, runeMask) plus rot2 / sdNgon / diamond in scope.
//
// r3 (stress frames: 30+ thick saturated arcs made a busy carpet that competed with the hero): ONE layer of 3 thinner, shorter comets + 2 spark comets per elite
// (r2: 3 bold + 4 thin + 2 sparks).
// r2 rebuild (2026-10-20): the click_select family (saturated ALPHA-blended arcs) in INDIGO: 3 bold comet arcs (head leads) turning
// one way, 6 short cyan-blue comets turning the other way on an inner radius, 2 spark comets, a deep navy under-glow beneath every
// arc so the ring keeps its colour on snow, pale stone and dark cobble. Same grammar as the hero marker (gold) and the champion
// (crimson) but thinner, so a swarm of elites marks itself without out-shouting the hero. No closed ring.
import { cometArc, cometLayer, lin } from './arcs';

export const RING_ELITE = /* glsl */ `    // ---- elite: bold indigo comet arcs, 2 counter-rotating layers + spark comets (click_select, alpha-blended) ---
    vec3 body = ${lin(0.3, 0.27, 1.0)};
    vec3 body2 = ${lin(0.25, 0.62, 1.0)};
    vec3 hot = ${lin(0.82, 0.88, 1.0)};
    vec3 deep = ${lin(0.0, 0.0, 0.2)};
    float breathe = 0.94 + 0.06 * sin(t * 1.9 + seed);
${cometArc({ id: 1, n: 3, len: [0.36, 0.5], rc: 'R - 0.08', w: 0.07, tailW: 0.32, tailPow: 0.6, glowOut: 0.1, glowIn: 0.14, spin: -0.2, body: 'body', hot: 'hot', under: 'deep', aBody: 0.92, aHot: 0.85, aGlow: 0.3, aUnder: 0.7, gain: 'breathe' })}${cometArc({ id: 2, n: 3, len: [0.22, 0.34], rc: 'R - 0.26', w: 0.03, tailW: 0.3, tailPow: 0.6, glowOut: 0.05, glowIn: 0.07, spin: 0.28, body: 'body2', hot: 'hot', under: 'deep', aBody: 0.6, aHot: 0.5, aGlow: 0.2, aUnder: 0.3 })}${cometLayer({ id: 3, n: 2, rc: 'R - 0.06', spin: -0.3, size: 0.045, tail: 0.34, col: 'hot', a: 0.8 })}`;
