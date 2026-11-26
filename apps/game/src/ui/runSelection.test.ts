// Regression tests for UI-01: runtime UI consumers read `store.runSelection` (active co-op room config) instead of stale solo `store.selection`.
import { h, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameStore, defaultSelection, type RunSelection } from '../app/store';
import { content } from '../data/loader';
import { settings } from '../engine/settings';
import { tl } from '../i18n/i18n';
import type { SimEvent } from '../sim/events';
import type { HudSnapshot, ModalRequest } from '../sim/types';
import { setDeps, type UiDeps } from './env';
import { announcements, attachAnnounceFeed, clearAnnouncements } from './hud/announce';
import { HINT_SETTLE_MS, attachHints } from './hud/hints';
import { atlasOpen, minimapHidden } from './hud/hooks';
import { Atlas, Minimap } from './hud/Minimap';
import { Taskbar } from './hud/Taskbar';
import { BossReward } from './modals/BossReward';
import { Pause } from './modals/Pause';
import { StoryModal } from './modals/Story';
import { installTestDom, type TestDomEnv } from './testDom';

const baseHud = (): HudSnapshot =>
  ({
    time: 120,
    level: 5,
    hp: 90,
    hpMax: 100,
    shield: 0,
    xp: 40,
    xpNext: 100,
    kills: 42,
    elites: 1,
    yeop: 150,
    shards: 2,
    dps: 320,
    alive: true,
    px: 12,
    pz: -18,
    corruption: 0,
    darkness: 0,
    rerolls: 2,
    banishes: 1,
    skills: [],
    passives: [],
    stones: [null, null, null, null, null, null],
    trinkets: [null, null, null],
    metins: [],
    boss: null,
    nextBoss: null,
    dmg: [],
  }) as unknown as HudSnapshot;

function emptyAssets() {
  return {
    manifest: {
      models: {},
      textures: {
        portrait_ninja_f: { url: 'assets/portrait_ninja_f.png' },
        portrait_warrior_m: { url: 'assets/portrait_warrior_m.png' },
        art_zone_yeonmu: { url: 'assets/zone_yeonmu.png' },
        art_zone_seori: { url: 'assets/zone_seori.png' },
      },
      icons: {},
      audio: {},
    },
    url: (u: string) => `/${u}`,
  };
}

describe('UI-01: runtime UI consumes store.runSelection over solo store.selection', () => {
  let dom: TestDomEnv;
  let store: GameStore;
  const soloSel: RunSelection = {
    ...defaultSelection(),
    classId: 'warrior',
    doctrine: 'a',
    sex: 'm',
    empire: 'saehwa',
    zone: 'yeonmu',
    difficulty: 'normal',
  };
  const coopRoomSel: RunSelection = {
    ...defaultSelection(),
    classId: 'ninja',
    doctrine: 'b',
    sex: 'f',
    empire: 'jihae',
    zone: 'seori',
    difficulty: 'hard',
  };

  beforeEach(() => {
    dom = installTestDom();
    store = new GameStore();
    store.select(soloSel);
    minimapHidden.value = false;
    atlasOpen.value = false;
    setDeps({
      store,
      content,
      assets: emptyAssets(),
      meta: null,
      audio: null,
      input: null,
      events: null,
    } as unknown as UiDeps);
  });

  afterEach(() => {
    render(null, dom.body as unknown as Element);
    clearAnnouncements();
    atlasOpen.value = false;
    minimapHidden.value = false;
    setDeps(null);
    dom.restore();
    vi.useRealTimers();
  });

  it('store.runSelection overrides store.selection during a co-op run and leaves solo selection intact afterwards', () => {
    expect(store.runSelection.value.zone).toBe('yeonmu');
    expect(store.runSelection.value.difficulty).toBe('normal');

    store.setActiveRun(coopRoomSel);
    expect(store.runSelection.value.zone).toBe('seori');
    expect(store.runSelection.value.difficulty).toBe('hard');
    expect(store.runSelection.value.classId).toBe('ninja');
    // Solo menu selection stays independent from the co-op room config
    expect(store.selection.value.zone).toBe('yeonmu');
    expect(store.selection.value.difficulty).toBe('normal');
    expect(store.selection.value.classId).toBe('warrior');

    store.setActiveRun(null);
    expect(store.runSelection.value.zone).toBe('yeonmu');
    expect(store.runSelection.value.difficulty).toBe('normal');
  });

  it('Minimap and Atlas render the active co-op room zone, not the solo selection zone', () => {
    store.setActiveRun(coopRoomSel);
    const hud = baseHud();
    atlasOpen.value = true;
    const host = dom.document.createElement('div');
    dom.body.appendChild(host);

    render(h('div', null, h(Minimap, { hud }), h(Atlas, { hud })), host as unknown as Element);

    const minimapEl = host.querySelector('.ms-zm--minimap');
    const atlasEl = host.querySelector('.ms-zm--atlas');
    expect(minimapEl?.getAttribute('data-zone')).toBe('seori');
    expect(atlasEl?.getAttribute('data-zone')).toBe('seori');
    expect(store.selection.value.zone).toBe('yeonmu');
  });

  it('Pause modal shows the active co-op room zone, difficulty, and class instead of solo selection', () => {
    store.setActiveRun(coopRoomSel);
    store.setHud(baseHud());
    const host = dom.document.createElement('div');
    dom.body.appendChild(host);

    render(h(Pause, null), host as unknown as Element);

    const seori = content.zones.find((z) => z.id === 'seori');
    const ninja = content.classes.find((c) => c.id === 'ninja');
    const zoneText = host.querySelector('.ms-pause-zone')?.textContent ?? '';
    const classText = host.querySelector('.ms-pause-class')?.textContent ?? '';
    expect(seori).toBeDefined();
    expect(ninja).toBeDefined();
    expect(zoneText).toContain(tl(seori!.name));
    expect(host.querySelector('.ms-pause-zone .ms-kchip--red')).not.toBeNull();
    expect(classText).toContain(tl(ninja!.name));
  });

  it('Taskbar Vitals, BossReward, and StoryModal read store.runSelection for hero/zone art', () => {
    store.setActiveRun(coopRoomSel);
    const hud = baseHud();
    const host = dom.document.createElement('div');
    dom.body.appendChild(host);

    // Taskbar Vitals portrait uses active co-op run's ninja_f instead of solo warrior_m
    render(h(Taskbar, { hud, low: false }), host as unknown as Element);
    const orbImg = host.querySelector('.ms-tb-orb img');
    expect(orbImg?.getAttribute('src')).toBe('/assets/portrait_ninja_f.png');

    // BossReward uses active co-op room's zone art (seori)
    const boss = content.bosses[0]!;
    const req: ModalRequest = {
      id: 1,
      kind: 'bossReward',
      player: 0,
      level: 5,
      free: false,
      awakened: false,
      result: null,
      source: boss.id,
      cards: [],
      rerolls: 0,
      banishes: 0,
      skips: 0,
      canReroll: false,
      canBanish: false,
      canSkip: false,
      waited: 0,
    };
    render(h(BossReward, { request: req }), host as unknown as Element);
    const bossRoot = host.querySelector('.ms-boss');
    expect(bossRoot?.style['--zone-art']).toContain('/assets/zone_seori.png');

    // StoryModal (metin + defeat) uses active co-op run's zone art and class nameplate
    const metin = content.metins[0]!;
    render(h(StoryModal, { story: { kind: 'metin', ref: metin.id } }), host as unknown as Element);
    const storyArt = host.querySelector('.ms-story-art');
    expect(storyArt?.style['--art']).toContain('/assets/zone_seori.png');

    render(h(StoryModal, { story: { kind: 'defeat', ref: 'seori' } }), host as unknown as Element);
    const ninja = content.classes.find((c) => c.id === 'ninja')!;
    expect(host.querySelector('.ms-story-nameplate')?.textContent).toContain(tl(ninja.name));
  });

  it('announce.ts and hints.ts fall back to store.runSelection when World is absent (co-op guest / mirror)', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance', 'Date'] });
    const subs = new Set<(e: SimEvent) => void>();
    const events = { subscribe: (fn: (e: SimEvent) => void) => (subs.add(fn), () => void subs.delete(fn)) };

    // Build minimal content with two distinct zones (yeonmu = normal / blue rune / late band; seori = hard awakenMul 0.5 / crimson rune / early band)
    const testContent = {
      ...content,
      affixes: { enabled: true, fromBand: 1 },
      balance: { ...content.balance, hard: { ...content.balance.hard, awakenMul: 0.5 } },
      metins: [
        { id: 'metin_solo', awakenAfter: 100, rune: '#112233', name: { en: 'Solo Stone', tr: 'Solo' } },
        { id: 'metin_room', awakenAfter: 100, rune: '#dd4422', name: { en: 'Room Stone', tr: 'Oda' } },
      ],
      zones: [
        { id: 'yeonmu', order: 1, metins: { types: ['metin_solo'] }, bands: [{ from: 0 }, { from: 400 }] },
        { id: 'seori', order: 3, metins: { types: ['metin_room'] }, bands: [{ from: 0 }, { from: 50 }] },
      ],
    } as unknown as typeof content;

    store.select({ ...soloSel, zone: 'yeonmu', difficulty: 'normal' });
    store.setActiveRun({ ...coopRoomSel, zone: 'seori', difficulty: 'hard' });
    setDeps({ store, content: testContent, events } as unknown as UiDeps);

    settings.update({ showHints: true, hintsSeen: [] });
    const shownHints: { id: string; sub: string }[] = [];
    const offHints = attachHints(
      { store, content: testContent, events: events as never },
      {
        show: (p) => shownHints.push({ id: p.id, sub: p.sub }),
        busy: () => false,
        has: () => false,
        withdraw: () => {},
      },
    );
    store.setHud({ ...baseHud(), time: 100 });

    // 1. metinWarn without World -> uses activeRun hard awakenMul (100 * 0.5 = 50s -> 0:50), NOT solo normal (100s -> 1:40)
    for (const fn of subs) fn({ t: 'metinWarn', metin: 1, def: 'metin_room', x: 0, z: 0, great: false } as SimEvent);
    vi.advanceTimersByTime(HINT_SETTLE_MS + 500);
    expect(shownHints.find((h) => h.id === 'metinWarn')?.sub).toContain('0:50');
    offHints();

    // 2. elite enemySpawn at t=100 without World -> seori's band 1 starts at 50s (affix fires), whereas yeonmu's starts at 400s
    settings.update({ showHints: true, hintsSeen: [] });
    const affixHints: { id: string; sub: string }[] = [];
    const offAffix = attachHints(
      { store, content: testContent, events: events as never },
      {
        show: (p) => affixHints.push({ id: p.id, sub: p.sub }),
        busy: () => false,
        has: () => false,
        withdraw: () => {},
      },
    );
    store.setHud({ ...baseHud(), time: 100 });
    for (const fn of subs) fn({ t: 'enemySpawn', enemy: 2, type: 0, x: 0, z: 0, tier: 1, source: 5 } as SimEvent);
    vi.advanceTimersByTime(HINT_SETTLE_MS + 500);
    expect(affixHints.some((h) => h.id === 'affix')).toBe(true);
    offAffix();

    // 3. announce.ts runEvent metinRain without World -> picks activeRun zone's rune color (#dd4422), NOT solo (#112233)
    settings.update({ showHints: false });
    const offAnn = attachAnnounceFeed({ store, content: testContent, events: events as never });
    for (const fn of subs) {
      fn({ t: 'runEvent', kind: 'metinRain', phase: 'active', id: 99, x: 0, z: 0, startAt: 100, endAt: 130, player: -1, p: 0 } as SimEvent);
    }
    const banner = announcements.value[0];
    expect(banner?.color).toBe('#dd4422');
    offAnn();
  });
});
