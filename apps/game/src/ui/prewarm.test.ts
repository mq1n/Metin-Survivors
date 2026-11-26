// PERF-03: the first-use UI prewarm. The sequence is driven through injected io (no browser); the lists are checked against the real
// manifest, fonts.css, Hud.tsx and the content, so a renamed texture / a new HUD material / a new card family cannot silently fall out.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { startUiPrewarm } from '../app/app';
import { content } from '../data/loader';
import type { Card, HudSnapshot } from '../sim/types';
import {
  buildPrewarmCards,
  buildPrewarmHud,
  DEFAULT_PLAN,
  FRAMES_PER_SURFACE,
  PREWARM_FONTS,
  PREWARM_GROUPS,
  PREWARM_SURFACES,
  PREWARM_TEXTURES,
  prewarmRunUi,
  raritiesOf,
  resetPrewarmForTests,
  runPrewarm,
  SURFACE_BUILDERS,
  type PrewarmIo,
  type SurfaceId,
} from './prewarm';

const root = resolve(__dirname, '..', '..');
const read = (rel: string): string => readFileSync(resolve(root, rel), 'utf8');

/** a fake browser: records the order of the calls, every id resolves to a url, the groups take 1 ms each */
function fakeIo(over: Partial<PrewarmIo> = {}): { io: PrewarmIo; log: string[] } {
  const log: string[] = [];
  let clock = 0;
  const io: PrewarmIo = {
    now: () => clock++,
    textureUrl: (id) => `/t/${id}.webp`,
    decode: async (u) => {
      log.push(`decode ${u}`);
      return true;
    },
    loadFont: async (f) => {
      log.push(`font ${f}`);
      return true;
    },
    paint: async (ids) => {
      log.push(`paint ${ids.join('+')}`);
      return [];
    },
    mark: (n) => log.push(`mark ${n}`),
    ...over,
  };
  return { io, log };
}

describe('the plan', () => {
  it('paints the run-start surfaces first and covers every surface of the QA fix (story, HUD, level-up, chest, essence, boss reward, pause)', () => {
    expect(PREWARM_GROUPS[0]).toEqual(['story']);
    expect(PREWARM_SURFACES.slice(0, 2)).toEqual(['story', 'hud']);
    for (const id of ['story', 'hud', 'levelUp', 'chest', 'essence', 'bossReward', 'pause'] as const) expect(PREWARM_SURFACES).toContain(id);
    expect(new Set(PREWARM_SURFACES).size).toBe(PREWARM_SURFACES.length);
  });

  it('mounts at most three surfaces together (full-viewport layers: about 25 MB of raster) and lists every surface once', () => {
    for (const g of PREWARM_GROUPS) expect(g.length).toBeLessThanOrEqual(3);
    expect(PREWARM_GROUPS.flat().length).toBe(new Set(PREWARM_GROUPS.flat()).size);
  });

  it('has a builder for every surface and none more', () => {
    expect(Object.keys(SURFACE_BUILDERS).sort()).toEqual([...PREWARM_SURFACES].sort());
  });

  it('keeps each surface up for at least 4 painted frames (style + layout, animations end, paint, raster)', () => {
    expect(FRAMES_PER_SURFACE).toBeGreaterThanOrEqual(4);
  });

  it('only names textures the shipped manifest has (a renamed one would silently stop being decoded)', () => {
    const manifest = JSON.parse(read('public/assets/manifest.json')) as { textures: Record<string, unknown> };
    const missing = PREWARM_TEXTURES.filter((id) => !(id in manifest.textures));
    expect(missing).toEqual([]);
    expect(new Set(PREWARM_TEXTURES).size).toBe(PREWARM_TEXTURES.length);
  });

  it('decodes every material the HUD publishes on its root (Hud.tsx TEX_VARS) and the pause / run gauges borrow', () => {
    const hud = read('src/ui/hud/Hud.tsx');
    const block = /const TEX_VARS[^=]*=\s*\[([\s\S]*?)\];/.exec(hud)?.[1] ?? '';
    const ids = [...block.matchAll(/\['(uk_[a-z_]+)'/g)].map((m) => m[1] as string);
    expect(ids.length).toBeGreaterThanOrEqual(9);
    expect(PREWARM_TEXTURES.filter((id) => ids.includes(id))).toEqual(expect.arrayContaining(ids));
    const ps = read('src/ui/screens/psTex.ts');
    for (const m of ps.matchAll(/\['(uk_[a-z_]+)', '--/g)) expect(PREWARM_TEXTURES).toContain(m[1]);
  });

  it('loads every face family / weight fonts.css declares and the UI uses (latin + latin-ext sample)', () => {
    const css = read('src/ui/style/fonts.css');
    const declared = new Set([...css.matchAll(/font-family:\s*'([^']+)'/g)].map((m) => m[1]));
    for (const family of declared) {
      if (family === 'Cinzel Decorative') continue; // the decorative faces are gone from the UI (C1)
      expect(PREWARM_FONTS.some((f) => f.includes(`'${family}'`))).toBe(true);
    }
    for (const spec of PREWARM_FONTS) expect(declared.has(/'([^']+)'/.exec(spec)?.[1] ?? '')).toBe(true);
  });
});

describe('the synthetic data', () => {
  const sel = { classId: 'warrior', doctrine: 'a' as const, zone: 'yeonmu' };

  it('deals every rarity across the offers and only ids the content has', () => {
    const cards = buildPrewarmCards(content, sel);
    const all: Card[] = [...cards.levelUp, ...cards.levelUp4, ...cards.essence, ...cards.boss];
    expect([...raritiesOf(all)].sort()).toEqual(['common', 'epic', 'legendary', 'rare', 'uncommon']);
    const known = new Set([...content.skills, ...content.passives, ...content.stones, ...content.trinkets].map((x) => x.id));
    for (const c of all) if (c.id) expect(known.has(c.id)).toBe(true);
  });

  it('shows the card families a first level-up meets: pact line, "awakens with" line, a legendary awakening and a fallback heal', () => {
    const cards = buildPrewarmCards(content, sel);
    expect(cards.levelUp.some((c) => c.pact !== undefined)).toBe(true);
    expect(cards.levelUp.some((c) => c.needs !== undefined)).toBe(true);
    expect(cards.levelUp4.some((c) => c.rarity === 'legendary' && c.awakening)).toBe(true);
    expect(cards.levelUp4.some((c) => c.kind === 'heal')).toBe(true);
    expect(cards.essence.map((c) => c.kind)).toEqual(['stone', 'stoneUp', 'trinket']);
  });

  it('gives the HUD snapshot a mid-run build: skills at every rank band, an awakened one, passives, spirit stones and trinkets', () => {
    const hud = buildPrewarmHud(null, content, sel);
    const bands = hud.skills.map((x) => x.rank);
    expect(hud.skills.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...bands)).toBe(7);
    expect(hud.skills.some((x) => x.awakened)).toBe(true);
    expect(hud.skills.some((x) => x.rank >= 3 && x.rank < 5)).toBe(true);
    expect(hud.skills.some((x) => x.rank >= 5 && x.rank < 7)).toBe(true);
    const skillIds = new Set(content.skills.map((x) => x.id));
    for (const x of hud.skills) expect(skillIds.has(x.id)).toBe(true);
    expect(hud.passives.length).toBeGreaterThan(0);
    expect(hud.stones.filter(Boolean).length).toBeGreaterThan(0);
    expect(hud.trinkets.filter(Boolean).length).toBeGreaterThan(0);
  });

  it("keeps the run's own basic attack in front of the synthetic skills", () => {
    const bare = buildPrewarmHud(null, content, sel);
    const basic = { id: 'my_basic', icon: 'icon_x', rank: 0, cooldown: 0, cdLeft: 0, basic: true, awakened: false };
    const own = buildPrewarmHud({ ...bare, skills: [basic] }, content, sel);
    expect(own.skills[0]).toEqual(basic);
    expect(own.skills.length).toBeGreaterThan(1);
  });

  it('takes the skills of the selected doctrine', () => {
    const cls = content.classes.find((c) => c.id === 'warrior');
    const skills = cls?.doctrines.find((d) => d.id === 'b')?.skills ?? [];
    const cards = buildPrewarmCards(content, { ...sel, doctrine: 'b' });
    expect(skills.length).toBeGreaterThan(2);
    expect(cards.levelUp4[0]?.id).toBe(skills[2]);
  });

  it('puts the boss plate, a metin and corruption on the HUD snapshot, over the run\'s own one when the store has it', () => {
    const bare = buildPrewarmHud(null, content, sel);
    expect(bare.boss?.id).toBe(content.zones.find((z) => z.id === 'yeonmu')?.bosses[0]?.boss);
    expect(bare.metins.length).toBe(1);
    expect(bare.corruption).toBeGreaterThan(0.01);
    const base = { ...bare, level: 9, kills: 77, boss: null, metins: [], corruption: 0 } as HudSnapshot;
    const over = buildPrewarmHud(base, content, sel);
    expect(over.level).toBe(9);
    expect(over.kills).toBe(77);
    expect(over.boss).not.toBeNull();
    expect(over.hp).toBeLessThan(over.hpMax);
  });
});

describe('runPrewarm', () => {
  it('decodes the art and loads the fonts, then paints each group once, in plan order', async () => {
    const { io, log } = fakeIo();
    const r = await runPrewarm(io, DEFAULT_PLAN);
    const firstPaint = log.findIndex((l) => l.startsWith('paint '));
    expect(log.slice(0, firstPaint).filter((l) => l.startsWith('decode ')).length).toBe(PREWARM_TEXTURES.length);
    expect(log.slice(0, firstPaint).filter((l) => l.startsWith('font ')).length).toBe(PREWARM_FONTS.length);
    expect(log.filter((l) => l.startsWith('paint ')).map((l) => l.slice(6))).toEqual(PREWARM_GROUPS.map((g) => g.join('+')));
    expect(log[0]).toBe('mark ms:prewarm:start');
    expect(log[log.length - 1]).toBe('mark ms:prewarm:end');
    expect(r.complete).toBe(true);
    expect(r.aborted).toBe(false);
    expect(r.textures).toEqual({ requested: PREWARM_TEXTURES.length, decoded: PREWARM_TEXTURES.length });
    expect(r.fonts).toEqual({ requested: PREWARM_FONTS.length, loaded: PREWARM_FONTS.length });
    expect(r.surfaces.map((s) => s.id)).toEqual([...PREWARM_SURFACES]);
    for (const id of PREWARM_SURFACES) expect(log).toContain(`mark ms:prewarm:${id}`);
  });

  it('skips a texture the manifest does not ship and counts only the ones that decoded', async () => {
    const { io, log } = fakeIo({ textureUrl: (id) => (id === 'uk_board' ? null : `/t/${id}.webp`), decode: async (u) => !u.includes('uk_rust') });
    const r = await runPrewarm(io, DEFAULT_PLAN);
    expect(log.some((l) => l.includes('uk_board'))).toBe(false);
    expect(r.textures.requested).toBe(PREWARM_TEXTURES.length);
    expect(r.textures.decoded).toBe(PREWARM_TEXTURES.length - 2);
    expect(r.complete).toBe(true);
  });

  it('a surface that cannot be built is recorded and the others still run; the call never rejects', async () => {
    const groups: string[] = [];
    const { io, log } = fakeIo({
      paint: async (ids) => {
        groups.push(ids.join('+'));
        return ids.includes('hud') ? [{ id: 'hud' as SurfaceId, error: 'hud exploded' }] : [];
      },
      decode: async () => {
        throw new Error('decode exploded');
      },
      loadFont: async () => {
        throw new Error('font exploded');
      },
    });
    const r = await runPrewarm(io, DEFAULT_PLAN);
    expect(log.filter((l) => l.startsWith('decode ') || l.startsWith('font '))).toEqual([]);
    expect(log).not.toContain('mark ms:prewarm:hud');
    expect(log).toContain('mark ms:prewarm:story');
    expect(groups).toEqual(PREWARM_GROUPS.map((g) => g.join('+')));
    expect(r.surfaces.find((s) => s.id === 'hud')).toMatchObject({ ok: false, error: 'hud exploded' });
    expect(r.surfaces.find((s) => s.id === 'story')?.ok).toBe(true);
    expect(r.surfaces.filter((s) => s.ok).length).toBe(PREWARM_SURFACES.length - 1);
    expect(r.complete).toBe(false);
    expect(r.textures.decoded).toBe(0);
    expect(r.fonts.loaded).toBe(0);
  });

  it('a whole group that throws is recorded surface by surface and the next group still runs', async () => {
    const seen: string[] = [];
    const { io } = fakeIo({
      paint: async (ids) => {
        seen.push(ids.join('+'));
        if (ids.includes('levelUp')) throw new Error('mount failed');
        return [];
      },
    });
    const r = await runPrewarm(io, DEFAULT_PLAN);
    expect(seen.length).toBe(PREWARM_GROUPS.length);
    expect(r.surfaces.filter((s) => !s.ok).map((s) => s.id)).toEqual(PREWARM_GROUPS.find((g) => (g as readonly string[]).includes('levelUp')) ?? []);
    expect(r.surfaces.every((s) => s.ok || s.error === 'mount failed')).toBe(true);
    expect(r.complete).toBe(false);
  });

  it('an abort stops before the next group (the one on screen is unmounted by the io)', async () => {
    const ctl = new AbortController();
    const painted: string[] = [];
    const { io } = fakeIo({
      paint: async (ids) => {
        painted.push(ids.join('+'));
        if (ids.includes('levelUp')) ctl.abort();
        return [];
      },
    });
    const r = await runPrewarm(io, DEFAULT_PLAN, ctl.signal);
    expect(painted).toEqual(['story', 'hud', 'levelUp']);
    expect(r.aborted).toBe(true);
    expect(r.complete).toBe(false);
  });

  it('an abort before the start paints nothing', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const { io, log } = fakeIo();
    const r = await runPrewarm(io, DEFAULT_PLAN, ctl.signal);
    expect(log.some((l) => l.startsWith('paint '))).toBe(false);
    expect(r.aborted).toBe(true);
  });

  it('aborting while decode never resolves still exits within the join bound', async () => {
    const ctl = new AbortController();
    const { io, log } = fakeIo({
      decode: () => new Promise<boolean>(() => {}),
    });
    const t0 = Date.now();
    setTimeout(() => ctl.abort(), 35);
    const r = await runPrewarm(io, DEFAULT_PLAN, ctl.signal);
    expect(Date.now() - t0).toBeLessThan(250);
    expect(r.aborted).toBe(true);
    expect(r.complete).toBe(false);
    expect(log.some((l) => l.startsWith('paint '))).toBe(false);
  });

  it('a plan without art, fonts or surfaces is an empty complete run', async () => {
    const { io, log } = fakeIo();
    const r = await runPrewarm(io, { textures: [], fonts: [], groups: [] });
    expect(log).toEqual(['mark ms:prewarm:start', 'mark ms:prewarm:end']);
    expect(r.complete).toBe(true);
    expect(r.surfaces).toEqual([]);
  });
});

describe('prewarmRunUi', () => {
  beforeEach(() => resetPrewarmForTests());

  it('without a UI (node, or before mountUi) it resolves "no-ui" and never throws', async () => {
    const r = await prewarmRunUi();
    expect(r.skipped).toBe('no-ui');
    expect(r.surfaces).toEqual([]);
  });
});

describe('App.startUiPrewarm (the run load joins the prewarm, bounded)', () => {
  it('runs the prewarm with an abort signal and finish() waits for a fast one without aborting it early', async () => {
    let seen: AbortSignal | undefined;
    let ranTo = '';
    const job = startUiPrewarm({
      joinMs: 1000,
      load: async () => ({
        prewarmRunUi: async (o) => {
          seen = o?.signal;
          await new Promise((r) => setTimeout(r, 20));
          ranTo = seen?.aborted ? 'aborted' : 'complete';
        },
      }),
    });
    await job.finish();
    expect(ranTo).toBe('complete');
    expect(seen?.aborted).toBe(true); // finish() always stops it afterwards
  });

  it('a prewarm that outlasts the join is aborted and the load goes on', async () => {
    let seen: AbortSignal | undefined;
    const t0 = Date.now();
    const job = startUiPrewarm({
      joinMs: 60,
      load: async () => ({
        prewarmRunUi: (o) =>
          new Promise<void>((res) => {
            seen = o?.signal;
            o?.signal?.addEventListener('abort', () => res(), { once: true });
          }),
      }),
    });
    await job.finish();
    expect(seen?.aborted).toBe(true);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('a loader that rejects or throws, or no loader at all, never breaks the run load', async () => {
    await startUiPrewarm({ joinMs: 50, load: () => Promise.reject(new Error('chunk 404')) }).finish();
    await startUiPrewarm({
      joinMs: 50,
      load: () => {
        throw new Error('sync throw');
      },
    }).finish();
    await startUiPrewarm({ joinMs: 50, load: null }).finish();
    await startUiPrewarm({ joinMs: 50, load: async () => ({ prewarmRunUi: () => Promise.reject(new Error('boom')) }) }).finish();
  });

  it('abort() stops it at once', async () => {
    let seen: AbortSignal | undefined;
    const job = startUiPrewarm({ joinMs: 50, load: async () => ({ prewarmRunUi: async (o) => void (seen = o?.signal) }) });
    job.abort();
    await job.finish();
    expect(seen?.aborted).toBe(true);
  });
});
