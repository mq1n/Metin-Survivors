// Ground ring look, kind `hero` (the local hero's marker): one GLSL branch of groundRings.ts `ringLook` (owner: the
// player-feedback builder). Runs inside `vec4 ringLook(vec2 l, float R, float kind, float str, vec3 colMain, float seed,
// float t)` with the locals TAU, r, ang, aaM, col, a, outside and the FX_GLSL_LIB helpers (band, layer, hash21, runeMask) plus
// rot2 / sdNgon / diamond in scope; write straight-alpha colour via layer().
//

// is a saturated gold ring of ~3 bold comet arcs (thick bright head, tapering tail) with a glow wall: it pops on grass, snow and
// stone alike because it is an alpha-blended colour, not additive light. The r1 pale blue-white additive arcs vanished on snow.
// Now: 3 bold gold comet arcs turning at ~0.14 rev/s (head leads), a thin orange inner layer of 5 short comets turning the other
// way, 3 orbiting spark comets, a dark amber under-glow beneath every arc (separation on white / pale floors) and a very faint
// smooth warm pool under the feet. No closed ring of any kind: everything is zero outside its arcs. The facing is only the arcs
// glowing 20 % brighter toward the heading (r3: the soft wedge of r2 was not visible in any frame and is gone; no facing claim is made). The facing yaw rides in the
// kind's fraction: kind = 4 + yaw / TAU * 0.4.
import { cometArc, cometLayer, lin } from './arcs';

export const RING_HERO = /* glsl */ `    // ---- hero: bold gold comet arcs (click_select, alpha-blended) + inner orange layer + spark comets ----------
    float face = (kind - 4.0) * 2.5 * TAU;
    vec3 body = ${lin(1.0, 0.72, 0.06)};
    vec3 body2 = ${lin(1.0, 0.5, 0.04)};
    vec3 hot = ${lin(1.0, 0.95, 0.66)};
    vec3 deep = ${lin(0.4, 0.15, 0.0)};
    float breathe = 0.94 + 0.06 * sin(t * 1.7 + seed);
    float daF = mod(ang - face + 3.14159265, TAU) - 3.14159265;
    float faceG = 0.8 + 0.2 * exp(-daF * daF / 0.6);
    // a faint warm pool under the feet: smooth to zero well inside the ring (no edge, no hairline)
    layer(col, a, body * 0.8, exp(-(r * r) / (R * R * 0.25)) * 0.06 * breathe);
${cometArc({ id: 1, n: 3, len: [0.56, 0.74], rc: 'R - 0.1', w: 0.15, tailW: 0.34, tailPow: 0.6, glowOut: 0.22, glowIn: 0.28, spin: 0.14, body: 'body', hot: 'hot', under: 'deep', aBody: 0.96, aHot: 0.92, aGlow: 0.4, aUnder: 0.85, gain: 'breathe * faceG' })}${cometArc({ id: 2, n: 4, len: [0.42, 0.6], rc: 'R - 0.34', w: 0.05, tailW: 0.3, tailPow: 0.6, glowOut: 0.09, glowIn: 0.12, spin: -0.21, body: 'body2', hot: 'hot', under: 'deep', aBody: 0.9, aHot: 0.8, aGlow: 0.4, aUnder: 0.45 })}${cometLayer({ id: 3, n: 3, rc: 'R - 0.07', spin: 0.32, size: 0.05, tail: 0.38, col: 'hot', a: 0.85 })}`;
