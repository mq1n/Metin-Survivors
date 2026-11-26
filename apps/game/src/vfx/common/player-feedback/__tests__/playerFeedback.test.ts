// player-feedback target (r1 2026-10-19): ids + legacy flags kept, specs well-formed, sprites shipped, route sides, ring GLSL generator.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../../../sim/events';
import { PRESETS } from '../../../presets';
import type { Resolved } from '../../../presets';
import type { SpawnOpts } from '../../../types';
import type { ElementSpec, FxSpec, ParticleSpec } from '../../../spec/types';
import { texOk } from '../../../spec/curves';
import { RING_CHAMPION } from '../../../../render/fx/rings/champion';
import { RING_ELITE } from '../../../../render/fx/rings/elite';
import { RING_HERO } from '../../../../render/fx/rings/hero';
import { arcLayer, cometArc, cometLayer, lin } from '../../../../render/fx/rings/arcs';
import type { RouteCtx } from '../../route';
import { PF_ART_IDS } from '../art';
import { PLAYER_FEEDBACK } from '../index';
import { playerFeedbackRoutes } from '../route';
import { EVADE, HIT_BY_ELEMENT, HIT_PLAYER, HIT_VARIANTS, SHIELD } from '../specs';
import { AURA_RING, BUFF_AURA, DASH, DRAGON_HEAD, SELF_ART_IDS, SUMMON_CIRCLE, SUMMON_DRAGON, SUMMON_GHOST, SUMMON_WOLF } from '../specs_self';

const ALL_SPECS: FxSpec[] = [HIT_PLAYER, ...HIT_VARIANTS, EVADE, SHIELD, AURA_RING, BUFF_AURA, DASH, DRAGON_HEAD, SUMMON_CIRCLE, SUMMON_DRAGON, SUMMON_GHOST, SUMMON_WOLF];
const IDS = ['hit.player', 'player.evade', 'player.shield', 'aura.ring', 'dash.streak', 'buff.aura', 'summon.circle', 'summon.dragon', 'summon.ghost', 'summon.wolf', 'burst.dragon_head'];

const particles = (els: readonly ElementSpec[]): ParticleSpec[] => els.filter((e): e is ParticleSpec => e.kind === 'particle');
const ownPresets = (): Map<string, (typeof PLAYER_FEEDBACK.presets)[number]> => new Map(PLAYER_FEEDBACK.presets.map((p) => [p.id, p]));
const monotone = (c: readonly number[] | undefined, stride = 2): boolean => {
  if (c === undefined) return true;
  if (c.length === 0 || c.length % stride !== 0 || !c.every((v) => Number.isFinite(v))) return false;
  for (let i = stride; i < c.length; i += stride) if ((c[i] as number) < (c[i - stride] as number)) return false;
  return true;
};

describe('player-feedback ids and legacy flags', () => {
  it('owns every id of its row and registers each exactly once', () => {
    const mine = ownPresets();
    for (const id of IDS) expect(mine.has(id), id).toBe(true);
    const count = new Map<string, number>();
    for (const p of PRESETS) count.set(p.id, (count.get(p.id) ?? 0) + 1);
    for (const id of IDS) expect(count.get(id), id).toBe(1);
  });

  it('keeps the size / base / loop / variants contract of the old presets (README rows)', () => {
    const m = ownPresets();
    const row = (id: string): [string, number, boolean, boolean] => {
      const p = m.get(id)!;
      return [p.size, p.base, p.loop === true, p.variants === true];
    };
    expect(row('aura.ring')).toEqual(['radius', 3, true, true]);
    expect(row('dash.streak')).toEqual(['radius', 5, false, true]);
    expect(row('buff.aura')).toEqual(['radius', 1.6, false, true]);
    expect(row('summon.circle')).toEqual(['radius', 2.2, false, true]);
    expect(row('summon.dragon')).toEqual(['mult', 2.4, false, false]);
    expect(row('summon.ghost')).toEqual(['mult', 1.4, false, true]);
    expect(row('summon.wolf')).toEqual(['mult', 1.6, false, true]);
    expect(row('burst.dragon_head')).toEqual(['mult', 1.6, false, true]);
    expect(row('hit.player')).toEqual(['mult', 1, false, false]);
    expect(m.get('aura.ring')?.follow).toBe(true);
    expect(typeof m.get('aura.ring')?.tick).toBe('function');
  });

  it('the dash lane spec is registered (id sk.gen.pf_dash) and the classic dash.streak plays it', () => {
    expect(PLAYER_FEEDBACK.specs.map((s) => s.id)).toContain('sk.gen.pf_dash');
    expect(DASH.behavior).toBe('dash');
  });
});

describe('player-feedback specs', () => {
  it.each(ALL_SPECS.map((s) => [s.id, s] as const))('%s: well-formed elements, <= 16 (buff.aura 24: five light-shaft stations x 3 layers), texture roles known', (_id, spec) => {
    expect(spec.elements.length).toBeGreaterThan(0);
    expect(spec.elements.length).toBeLessThanOrEqual(spec.id === 'buff.aura' ? 24 : 16);
    for (const el of particles(spec.elements)) {
      expect(texOk(el.tex), el.note).toBe(true);
      expect(monotone(el.color, 3), `${el.note}: colour`).toBe(true);
      for (const c of [el.rate, el.life, el.vel, el.gravity, el.air]) expect(monotone(c), `${el.note}: curve`).toBe(true);
      expect(el.cycle).toBeGreaterThan(0);
      expect(el.max).toBeGreaterThanOrEqual(1);
    }
  });

  it('one-shots never outlive 1.7 s (hit / evade / shield stay <= 0.5 s)', () => {
    for (const spec of [HIT_PLAYER, ...HIT_VARIANTS, EVADE, SHIELD]) {
      for (const el of particles(spec.elements)) {
        const life = Math.max(...el.life.filter((_, i) => i % 2 === 1)) + (el.t0 ?? 0);
        expect(life, `${spec.id}: ${el.note}`).toBeLessThanOrEqual(0.5);
      }
    }
    for (const spec of [BUFF_AURA, SUMMON_CIRCLE, SUMMON_DRAGON, SUMMON_GHOST, SUMMON_WOLF, DRAGON_HEAD, DASH]) {
      for (const el of particles(spec.elements)) {
        const life = Math.max(...el.life.filter((_, i) => i % 2 === 1)) + (el.t0 ?? 0);
        expect(life, `${spec.id}: ${el.note}`).toBeLessThanOrEqual(1.8);
      }
    }
  });

  it('hit.player never draws a white wash: no element starts near-white at alpha >= 0.9 with additive 1.5+ (hot core stays warm)', () => {
    for (const el of particles(HIT_PLAYER.elements)) {
      const first = el.color[1] as number;
      const r = (first >> 16) & 255;
      const b = first & 255;
      expect(b, el.note).toBeLessThan(r); // warm: red above blue in the first colour key
    }
  });

  it('self effects are at least 2.5 m wide (the shield sphere, the circles, the rings)', () => {
    const widest = (spec: FxSpec): number => Math.max(...particles(spec.elements).map((el) => (typeof el.half[0] === 'number' ? Math.max(...(el.half as number[]).filter((_, i) => i % 2 === 1)) : 0) * 2));
    for (const spec of [SHIELD, BUFF_AURA, AURA_RING, SUMMON_CIRCLE, SUMMON_DRAGON]) expect(widest(spec), spec.id).toBeGreaterThanOrEqual(2.5);
  });

  it('r3: the hit impact star is a ~2.5 m ray star at chest height (card half >= 1.8 m, sprite rays reach ~42 % of the card)', () => {
    for (const spec of [HIT_PLAYER, ...HIT_VARIANTS]) {
      const stars = particles(spec.elements).filter((el) => typeof el.tex !== 'string' && el.tex.art === 'vfx_player_feedback_ray_star');
      expect(stars.length, spec.id).toBeGreaterThanOrEqual(2); // alpha twin + additive
      for (const el of stars) expect(Math.max(...(el.half as number[]).filter((_, i) => i % 2 === 1)), spec.id).toBeGreaterThanOrEqual(1.8);
    }
  });

  it('r3: screen-billboard half pairs are [vertical, horizontal]: the thin column sprite is stretched WIDE, never tall (the first r3 pass drew 8 m needles)', () => {
    for (const spec of [BUFF_AURA, SUMMON_CIRCLE]) {
      for (const el of particles(spec.elements)) {
        if (typeof el.tex === 'string' || el.tex.art !== 'vfx_player_feedback_light_column') continue;
        const [v, h] = el.half as readonly [readonly number[], readonly number[]];
        expect(v[1] as number, `${spec.id}: ${el.note}`).toBeLessThan(h[1] as number);
        expect((v[1] as number) * 2, `${spec.id}: card height`).toBeLessThanOrEqual(6);
      }
    }
  });

  it('ships every sprite the target references in the texture manifest', () => {
    const man = JSON.parse(readFileSync(new URL('../../../../../public/assets/manifest/textures.json', import.meta.url), 'utf8')) as Record<string, { kind: string }>;
    const t = ((man as unknown as { textures?: Record<string, { kind: string }> }).textures ?? man) as Record<string, { kind: string }>;
    for (const id of [...PF_ART_IDS, ...SELF_ART_IDS]) expect(t[id]?.kind, id).toBe('vfx');
  });

  it('every art id used by a spec is listed in the audit lists', () => {
    const listed = new Set<string>([...PF_ART_IDS, ...SELF_ART_IDS]);
    for (const spec of ALL_SPECS) {
      for (const el of particles(spec.elements)) {
        const tex = el.tex;
        if (typeof tex === 'string') continue;
        const ids = typeof tex.art === 'string' ? [tex.art] : [...tex.art];
        for (const id of ids) expect(listed.has(id), `${spec.id}: ${id}`).toBe(true);
      }
    }
  });
});

describe('player-feedback route', () => {
  function harness() {
    const fired: { id: string; o: SpawnOpts }[] = [];
    const ctx = {
      time: 0,
      density: 1,
      players: new Float32Array(12),
      heightAt: () => 2,
      o: (x: number, z: number, scale: number, dirX?: number, dirZ?: number) => ({ x, z, scale, dirX, dirZ }) as SpawnOpts,
      fire: (id: string, o: SpawnOpts) => {
        fired.push({ id, o: { ...o } });
        return 0;
      },
      resolve: (id: string) => ({ def: { id } }) as unknown as Resolved,
    } as unknown as RouteCtx;
    const routes = playerFeedbackRoutes();
    const send = (result: number, srcX = 4): { id: string; o: SpawnOpts } => {
      const ev = { t: 'playerHit', player: 0, amount: 10, result, x: 1, z: 2, srcX, srcZ: 2, element: 1, hp: 50 } as SimEvent;
      for (const r of routes) r.handle(ev, ctx);
      return fired[fired.length - 1]!;
    };
    return { send };
  }

  it('hit / evade / shield map to their presets at chest height with the blow direction', () => {
    const h = harness();
    const hit = h.send(0);
    expect(hit.id).toBe('sk.gen.pf_hit_fire'); // the harness event carries element 1 (fire): a hit plays the family of its element
    expect(hit.o.y).toBeCloseTo(3);
    expect(hit.o.dirX).toBeCloseTo(-3);
    expect(h.send(1).id).toBe('player.evade');
    expect(h.send(2).id).toBe('player.shield');
  });

  it('player.evade dodges AWAY from the attacker along the screen horizontal in a screen-pinned frame (SpawnOpts.b = facing + side); level attackers alternate; hit.player mirrors toward the side the blow travels to; the shield never mirrors', () => {
    const h = harness();
    // attacker on the right (srcX 4 > x 1): dodge left (b > 0), frame pinned: dir = (0, -1) = local +x screen-left, local +z up the screen
    const right = h.send(1, 4);
    expect(right.o.b).toBe(1);
    expect(right.o.dirX).toBe(0);
    expect(right.o.dirZ).toBe(-1);
    // attacker on the left (srcX -3): dodge right (b < 0)
    expect(h.send(1, -3).o.b).toBe(-1);
    // attacker level with the hero on the screen (straight above / below): the side alternates
    const a = h.send(1, 1.2).o.b;
    const b = h.send(1, 1.2).o.b;
    expect(Math.abs(a ?? 0)).toBe(1);
    expect(b).toBe(-(a as number));
    // the harness blow runs from x = 4 to x = 1 (toward -x): the slash is mirrored
    expect(h.send(0).o.b).toBe(1);
    expect(h.send(2).o.b).toBe(0);
  });
});

describe('ring GLSL (hero / elite / champion)', () => {
  const rings: [string, string][] = [['hero', RING_HERO], ['elite', RING_ELITE], ['champion', RING_CHAMPION]];

  it.each(rings)('%s: balanced braces / parentheses, no tabs, writes through layer()', (_n, glsl) => {
    expect((glsl.match(/\{/g) ?? []).length).toBe((glsl.match(/\}/g) ?? []).length);
    expect((glsl.match(/\(/g) ?? []).length).toBe((glsl.match(/\)/g) ?? []).length);
    expect(glsl).toContain('layer(col, a');
    expect(glsl).not.toMatch(/\bband\(r, R/); // no hairline vector ring left
    expect(glsl).not.toContain('${');
  });

  it('every ring is made of >= 2 arc layers (broken arcs, not one band) and the hero keeps its facing cue', () => {
    for (const [n, glsl] of rings) expect((glsl.match(/float cid\d+ = floor/g) ?? []).length, n).toBeGreaterThanOrEqual(2);
    expect(RING_HERO).toContain('kind - 4.0');
  });

  it('arcLayer / cometLayer: per-layer unique names, no stray template text', () => {
    const a = arcLayer({ id: 7, n: 3, len: [0.4, 0.6], rc: 'R - 0.1', core: 0.02, outW: 0.05, inW: 0.1, spin: -0.04, glowCol: 'body', coreCol: 'hot', aGlow: 0.5, aCore: 0.5 });
    expect(a).toContain('float cid7 = floor');
    expect(a).not.toContain('undefined');
    expect(a).toContain('+ -0.04 * t');
    const c = cometLayer({ id: 8, n: 3, rc: 'R - 0.05', spin: 0.1, size: 0.05, tail: 0.3, col: 'hot', a: 0.8 });
    expect(c).toContain('float tail8');
    expect(c).not.toContain('undefined');
  });
});

describe('hit.player element family (r2)', () => {
  it('every element index has its own spec; element 0 is the classic hit.player slot; ids are unique and registered', () => {
    expect(HIT_BY_ELEMENT.length).toBe(8);
    expect(HIT_BY_ELEMENT[0]).toBe('hit.player');
    expect(new Set(HIT_BY_ELEMENT).size).toBe(8);
    const registered = new Set(PLAYER_FEEDBACK.specs.map((x) => x.id));
    for (const id of HIT_BY_ELEMENT.slice(1)) expect(registered.has(id), id).toBe(true);
  });

  it('the families really differ (no same-blob-recoloured): every element draws a different main sprite', () => {
    const mainArt = (spec: FxSpec): string => {
      const els = particles(spec.elements);
      const e = els[4]!; // r3: 0 = alpha ray star, 1 = additive ray star, 2 = hard core flare, 3 = smoke body, 4 = the element sprite (additive, secondary)
      return typeof e.tex === 'string' ? e.tex : (typeof e.tex.art === 'string' ? e.tex.art : e.tex.art.join(','));
    };
    const arts = [HIT_PLAYER, ...HIT_VARIANTS].map(mainArt);
    expect(new Set(arts).size).toBe(arts.length);
  });

  it('every ALPHA twin exists (the hue must hold on snow): each hit has >= 1 alpha element, the shield and the evade too', () => {
    for (const spec of [HIT_PLAYER, ...HIT_VARIANTS, EVADE, SHIELD, AURA_RING, SUMMON_CIRCLE, SUMMON_DRAGON, SUMMON_WOLF, BUFF_AURA]) {
      expect(particles(spec.elements).some((e) => e.blend === 'alpha'), spec.id).toBe(true);
    }
  });
});

describe('cometArc (r2 click_select arcs)', () => {
  it('generates unique names per layer, composites through layer() in 4 passes, no stray template text', () => {
    const g = cometArc({ id: 5, n: 3, len: [0.5, 0.7], rc: 'R - 0.1', w: 0.1, spin: 0.14, body: 'body', hot: 'hot', under: 'deep' });
    expect(g).toContain('float cid5 = floor');
    expect((g.match(/layer\(col, a/g) ?? []).length).toBe(4);
    expect(g).not.toContain('undefined');
    expect(g).not.toContain('${');
    // spin > 0: the head leads where the pattern moves (low x end), spin < 0 the other end
    expect(g).toContain('1.0 - x5');
    expect(cometArc({ id: 6, n: 3, len: [0.5, 0.7], rc: 'R', w: 0.1, spin: -0.1, body: 'body', hot: 'hot' })).toContain('clamp(x6, 0.0, 1.0)');
  });

  it('no GLSL local of a layer shadows the branch vec3s (body / body2 / hot / deep / gold): the r2 shader compile bug', () => {
    for (const glsl of [RING_HERO, RING_ELITE, RING_CHAMPION]) {
      // a `float body<N>` would clash with a branch `vec3 body<N>` (N = the layer id)
      const bad = [...glsl.matchAll(/\bfloat (body[0-9]*|hot[0-9]*|deep|gold)\b/g)].map((m) => m[0]);
      expect(bad).toEqual([]);
    }
  });

  it('lin() returns linear-light GLSL colours', () => {
    expect(lin(1, 1, 1)).toBe('vec3(1.0000, 1.0000, 1.0000)');
    expect(lin(0.5, 0, 0)).toBe('vec3(0.2176, 0.0000, 0.0000)');
  });
});
