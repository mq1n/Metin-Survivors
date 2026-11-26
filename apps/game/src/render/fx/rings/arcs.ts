

// broken stretches, the mesh breathing over 11 frames x 0.02 s) rebuilt analytically: no texture, no hairline vector circle.
//
// `arcLayer()` returns a GLSL block for one layer, to be pasted INSIDE a `ringLook` kind branch (render/fx/groundRings.ts): it
// reads the branch locals `r`, `ang`, `aaM`, `t`, `seed`, `col`, `a` and the FX_GLSL_LIB helpers `hash21`, `layer`, and composites
// into `col` / `a` (straight alpha "over", like every other ring). Everything is wrapped in `{ }` so variable names never clash.
//
// One layer = N cells round the ring; every cell holds ONE arc of random length (len0..len1 of the cell) at a random offset, so the
// ring is irregularly broken, with tapered feathered ends, a slow radial wobble and a faint grain along the arc. The arc profile
// across the radius is a hot thin core (gaussian) over a wider glow that is feathered INWARD (like click_select_vertical's wall:
// crisp outer edge, soft inner fade) when `inW > outW`.
export interface ArcLayer {
  /** unique small integer per layer inside one branch (seeds the per-cell randomness) */
  id: number;
  /** cells round the ring (arcs per layer) */
  n: number;
  /** arc length range, fraction of its cell */
  len: readonly [number, number];
  /** GLSL float expression: centre radius (m) */
  rc: string;
  /** half width (m) of the hot core at the arc's middle / of the glow on the outer + inner side */
  core: number;
  outW: number;
  inW: number;
  /** width at the arc ends as a fraction of the middle */
  endW?: number;
  /** end feather as a fraction of the arc length */
  endSoft?: number;
  /** revolutions per second (sign = direction) */
  spin: number;
  /** GLSL colour expressions (vec3): glow body (saturated, alpha-blended) and the hot core */
  glowCol: string;
  coreCol: string;
  /** peak alpha of the glow / the core */
  aGlow: number;
  aCore: number;
  /** radial wobble amplitude (m) and its speed */
  wobble?: number;
  /** optional dark under-glow colour (readability on snow / pale stone) and its alpha */
  under?: string;
  aUnder?: number;
  /** GLSL float expression multiplied into every alpha of the layer (breathing, fades) */
  gain?: string;
}

const f = (x: number): string => (Number.isInteger(x) ? x.toFixed(1) : String(x));

export function arcLayer(o: ArcLayer): string {
  const es = o.endSoft ?? 0.3;
  const endW = o.endW ?? 0.4;
  const wob = o.wobble ?? 0.012;
  const id = f(o.id);
  return `    {
      float u${o.id} = ang / TAU + ${f(o.spin)} * t + seed * 0.1591549 + ${id} * 0.37;
      float cu${o.id} = u${o.id} * ${f(o.n)};
      float cid${o.id} = floor(cu${o.id});
      float cf${o.id} = cu${o.id} - cid${o.id};
      float h0${o.id} = hash21(vec2(cid${o.id} + ${id} * 17.0, floor(seed * 2.0) + 3.1));
      float h1${o.id} = hash21(vec2(cid${o.id} * 1.7 + 5.0, ${id} * 3.3 + 9.2));
      float len${o.id} = mix(${f(o.len[0])}, ${f(o.len[1])}, h0${o.id});
      float x${o.id} = (cf${o.id} - (1.0 - len${o.id}) * (0.25 + 0.5 * h1${o.id})) / len${o.id};
      float end${o.id} = smoothstep(0.0, ${f(es)}, x${o.id}) * (1.0 - smoothstep(${f(1 - es)}, 1.0, x${o.id}));
      float bell${o.id} = sin(clamp(x${o.id}, 0.0, 1.0) * 3.14159265);
      float wm${o.id} = mix(${f(endW)}, 1.0, pow(bell${o.id}, 0.6));
      float wb${o.id} = ${f(wob)} * sin(ang * 5.0 + t * 0.9 + ${id} * 2.1 + h0${o.id} * 6.2831853);
      float d${o.id} = r - (${o.rc}) - wb${o.id};
      float side${o.id} = d${o.id} < 0.0 ? ${f(o.inW)} : ${f(o.outW)};
      float grain${o.id} = 0.84 + 0.16 * sin(ang * 61.0 + h0${o.id} * 40.0 + t * 1.7) * sin(r * 47.0 + h1${o.id} * 20.0);
      float prof${o.id} = exp(-abs(d${o.id}) / (side${o.id} * wm${o.id})) * grain${o.id};
      float hot${o.id} = exp(-(d${o.id} * d${o.id}) / (${f(o.core * o.core)} * wm${o.id} * wm${o.id} + 1e-5));
      float gn${o.id} = ${o.gain ?? '1.0'};
${o.under ? `      layer(col, a, ${o.under}, prof${o.id} * end${o.id} * ${f(o.aUnder ?? 0.2)} * gn${o.id});\n` : ''}      layer(col, a, ${o.glowCol}, prof${o.id} * end${o.id} * ${f(o.aGlow)} * gn${o.id});
      layer(col, a, ${o.coreCol}, hot${o.id} * end${o.id} * ${f(o.aCore)} * gn${o.id});
    }
`;
}

/** orbiting comet glints: `n` short bright heads with a tapered tail trailing behind, on radius `rc` (GLSL expr) */
export function cometLayer(o: { id: number; n: number; rc: string; spin: number; size: number; tail: number; col: string; a: number; gain?: string }): string {
  const id = f(o.id);
  return `    {
      float uc${o.id} = ang / TAU + ${f(o.spin)} * t + seed * 0.0795775 + ${id} * 0.19;
      float cc${o.id} = uc${o.id} * ${f(o.n)};
      float ci${o.id} = floor(cc${o.id});
      float cfx${o.id} = fract(cc${o.id});
      float hc${o.id} = hash21(vec2(ci${o.id} + ${id} * 5.0, 11.7));
      float tw${o.id} = 0.55 + 0.45 * sin(t * (2.0 + hc${o.id} * 3.0) + hc${o.id} * 40.0);
      float head${o.id} = 0.5 + 0.38 * (hc${o.id} - 0.5);
      float arcM${o.id} = (cfx${o.id} - head${o.id}) * 6.2831853 * max(r, 0.05) / ${f(o.n)} * ${o.spin >= 0 ? '1.0' : '-1.0'};
      float tail${o.id} = arcM${o.id} > 0.0 ? exp(-arcM${o.id} / ${f(o.tail)}) : exp(arcM${o.id} / ${f(o.size * 0.5)});
      float dr${o.id} = r - (${o.rc});
      float rad${o.id} = exp(-(dr${o.id} * dr${o.id}) / ${f(o.size * o.size)});
      layer(col, a, ${o.col}, tail${o.id} * rad${o.id} * tw${o.id} * ${f(o.a)} * ${o.gain ?? '1.0'});
    }
`;
}

// ---------------------------------------------------------------------------------------------------------------------


// ~3 bold arcs, thick bright head, long tapering tail, with a soft glow wall. The r1 version was pale additive blue-white and
// vanished on snow. `cometArc()` = N bold comet arcs per layer that visibly turn (head leads, tail trails), composited
// OVER the floor in four passes: a dark under-glow (separation on snow / pale stone), a soft saturated glow, the saturated
// body (alpha ~0.92) and a hot core on the head half. No closed ring anywhere: every pass is zero outside its arcs.
export interface CometArc {
  /** unique small integer per arc layer inside one branch (seeds the per-cell randomness) */
  id: number;
  /** arcs (cells) round the ring */
  n: number;
  /** arc length range, fraction of its cell */
  len: readonly [number, number];
  /** GLSL float expression: centre radius (m) */
  rc: string;
  /** half width (m) of the saturated body at the head */
  w: number;
  /** width at the tail end as a fraction of the head width (default 0.28) */
  tailW?: number;
  /** soft glow half width (m) outward / inward of the body edge, at the head */
  glowOut?: number;
  glowIn?: number;
  /** revolutions per second; the arc HEAD leads: it is the end the pattern moves toward (sign = direction) */
  spin: number;
  /** GLSL vec3 expressions (linear): saturated body, hot core, dark under-glow */
  body: string;
  hot: string;
  under?: string;
  /** peak alphas */
  aBody?: number;
  aHot?: number;
  aGlow?: number;
  aUnder?: number;
  /** head cap softness / tail length exponent (alpha ~ x^tailPow from the tail) */
  headSoft?: number;
  tailPow?: number;
  /** radial wobble amplitude (m) */
  wobble?: number;
  /** GLSL float expression multiplied into every alpha of the layer */
  gain?: string;
}

/** GLSL vec3 literal of an sRGB colour (0..1 components) converted to the linear value the ring pass outputs */
export function lin(r: number, g: number, b: number): string {
  const c = (v: number): string => Math.pow(v, 2.2).toFixed(4);
  return `vec3(${c(r)}, ${c(g)}, ${c(b)})`;
}

export function cometArc(o: CometArc): string {
  const id = f(o.id);
  const i = String(o.id);
  const tw = o.tailW ?? 0.28;
  const hs = o.headSoft ?? 0.09;
  const tp = o.tailPow ?? 0.85;
  const gO = o.glowOut ?? o.w * 1.6;
  const gI = o.glowIn ?? o.w * 2.4;
  const xh = o.spin >= 0 ? `1.0 - x${i}` : `x${i}`;
  return `    {
      float u${i} = ang / TAU + ${f(o.spin)} * t + seed * 0.1591549 + ${id} * 0.37;
      float cu${i} = u${i} * ${f(o.n)};
      float cid${i} = floor(cu${i});
      float cf${i} = cu${i} - cid${i};
      float h0${i} = hash21(vec2(cid${i} + ${id} * 17.0, floor(seed * 2.0) + 3.1));
      float h1${i} = hash21(vec2(cid${i} * 1.7 + 5.0, ${id} * 3.3 + 9.2));
      float len${i} = mix(${f(o.len[0])}, ${f(o.len[1])}, h0${i});
      float x${i} = (cf${i} - (1.0 - len${i}) * (0.25 + 0.5 * h1${i})) / len${i};
      float xc${i} = clamp(${xh}, 0.0, 1.0);
      float env${i} = pow(xc${i}, ${f(tp)}) * (1.0 - smoothstep(${f(1 - hs)}, 1.0, xc${i})) * step(0.0, x${i}) * step(x${i}, 1.0);
      float wd${i} = mix(${f(tw)}, 1.0, pow(xc${i}, 0.8));
      float wb${i} = ${f(o.wobble ?? 0.01)} * sin(ang * 5.0 + t * 0.9 + ${id} * 2.1 + h0${i} * 6.2831853);
      float d${i} = r - (${o.rc}) - wb${i};
      float ad${i} = abs(d${i});
      float W${i} = ${f(o.w)} * wd${i};
      float bdy${i} = 1.0 - smoothstep(W${i} * 0.55, W${i} * 1.1, ad${i});
      float hotm${i} = exp(-(d${i} * d${i}) / (W${i} * W${i} * 0.2 + 1e-5)) * smoothstep(0.3, 0.95, xc${i});
      float glw${i} = exp(-max(ad${i} - W${i} * 0.6, 0.0) / (${f(gO)} * wd${i} * (d${i} < 0.0 ? ${f(gI / gO)} : 1.0) + 1e-4));
      float udr${i} = exp(-(d${i} * d${i}) / (W${i} * W${i} * 7.0 + 1e-5));
      float gn${i} = ${o.gain ?? '1.0'};
${o.under ? `      layer(col, a, ${o.under}, udr${i} * env${i} * ${f(o.aUnder ?? 0.5)} * gn${i});\n` : ''}      layer(col, a, ${o.body}, glw${i} * env${i} * ${f(o.aGlow ?? 0.4)} * gn${i});
      layer(col, a, ${o.body}, bdy${i} * env${i} * ${f(o.aBody ?? 0.92)} * gn${i});
      layer(col, a, ${o.hot}, hotm${i} * env${i} * ${f(o.aHot ?? 0.9)} * gn${i});
    }
`;
}
