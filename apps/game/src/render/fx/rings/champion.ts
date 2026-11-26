// Ground ring look, kind `champion` (owner: the player-feedback builder): one GLSL branch of groundRings.ts `ringLook`. Runs inside
// `vec4 ringLook(vec2 l, float R, float kind, float str, vec3 colMain, float seed, float t)` with the locals TAU, r, ang, aaM,
// col, a, outside and the FX_GLSL_LIB helpers (band, layer, hash21, runeMask) plus rot2 / sdNgon / diamond in scope.
//
// r3: a little thinner / shorter (the swarm carpet of r2 competed with the hero ring): bold crimson w 0.1 (r2 0.125), 3 shorter gold comets (r2 4).

// crimson comet arcs turning one way, 4 gold comets on an inner radius turning the other way, 4 gold-white four-point sparkles
// riding the ring and 4 spark comets: the richest of the three rings, so a champion stands out of a pack of indigo elites
// without any UI ornament. Dark maroon under-glow beneath the arcs (colour holds on snow); no closed ring.
import { cometArc, cometLayer, lin } from './arcs';

export const RING_CHAMPION = /* glsl */ `    // ---- champion: bold crimson comet arcs + gold inner comets + sparkles (click_select, alpha-blended) ---------
    vec3 body = ${lin(1.0, 0.1, 0.04)};
    vec3 gold = ${lin(1.0, 0.72, 0.08)};
    vec3 hot = ${lin(1.0, 0.86, 0.5)};
    vec3 deep = ${lin(0.24, 0.0, 0.0)};
    float breathe = 0.94 + 0.06 * sin(t * 1.5 + seed);
${cometArc({ id: 1, n: 3, len: [0.5, 0.66], rc: 'R - 0.1', w: 0.1, tailW: 0.34, tailPow: 0.6, glowOut: 0.19, glowIn: 0.25, spin: 0.16, body: 'body', hot: 'hot', under: 'deep', aBody: 0.97, aHot: 0.92, aGlow: 0.4, aUnder: 0.85, gain: 'breathe' })}${cometArc({ id: 2, n: 3, len: [0.34, 0.5], rc: 'R - 0.34', w: 0.04, tailW: 0.3, tailPow: 0.6, glowOut: 0.07, glowIn: 0.1, spin: -0.24, body: 'gold', hot: 'hot', under: 'deep', aBody: 0.85, aHot: 0.7, aGlow: 0.34, aUnder: 0.4 })}${cometLayer({ id: 3, n: 4, rc: 'R - 0.07', spin: 0.3, size: 0.05, tail: 0.36, col: 'hot', a: 0.85 })}    // four soft four-point sparkles riding the ring
    float aq = mod(ang + t * 0.2 + 0.7853982, 1.5707963) - 0.7853982;
    vec2 qf = r * vec2(sin(aq), cos(aq)) - vec2(0.0, R - 0.07);
    float spark = exp(-dot(qf, qf) / 0.0045) + 0.55 * (exp(-qf.x * qf.x / 0.00012) * exp(-abs(qf.y) / 0.16) + exp(-qf.y * qf.y / 0.00012) * exp(-abs(qf.x) / 0.16));
    layer(col, a, hot, min(spark, 1.0) * 0.8 * (0.7 + 0.3 * sin(t * 3.1 + seed)));
`;
