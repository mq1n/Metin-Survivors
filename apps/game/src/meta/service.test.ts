import type { Loadout, ZoneId } from '@ms/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryNet, MemoryRoom } from '../net/coop/memoryRelay';
import { CoopSession, type CoopRunStart } from '../net/coop/session';
import { fixtureContent } from './__fixtures__/content';
import { FakeCloud, FakeServer } from './__fixtures__/fakeCloud';
import { NOW, makeRun } from './__fixtures__/testkit';
import { bonusContextFor } from './bonuses';
import { SaveError, checksum } from './errors';
import { seededRng } from './rng';
import { MetaService, type SettingsPort, type TabChannel } from './service';
import { MemoryStore, SaveRepository, encodeRecord, type TxWrites } from './storage';
import { xpForPoints } from './talents';
import { SAVE_VERSION } from './types';
import type { SettingsData } from '../engine/settings';

const C = fixtureContent;

async function open(store = new MemoryStore(), extra: Partial<Parameters<typeof MetaService.open>[0]> = {}): Promise<MetaService> {
  return MetaService.open({ content: C, store, rng: seededRng(77), now: () => NOW, channel: null, ...extra });
}

class FakeSettings implements SettingsPort {
  value: SettingsData;
  private subs = new Set<(s: SettingsData) => void>();
  constructor(initial: SettingsData) {
    this.value = initial;
  }
  update(patch: Partial<SettingsData>): void {
    this.value = { ...this.value, ...patch };
    for (const s of this.subs) s(this.value);
  }
  subscribe(fn: (s: SettingsData) => void): () => void {
    this.subs.add(fn);
    fn(this.value);
    return () => this.subs.delete(fn);
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('open / persistence', () => {
  it('creates and persists a new profile on first launch', async () => {
    const store = new MemoryStore();
    const svc = await open(store);
    expect(svc.loadInfo).toMatchObject({ source: 'none', recovered: false, corrupt: false });
    expect(svc.save.profile.created).toBe(NOW);
    expect(svc.persistence).toBe('memory');
    expect(await store.get('save.main')).toBeDefined();
    const again = await open(store);
    expect(again.loadInfo.source).toBe('main');
    expect(again.save).toEqual(svc.save);
  });

  it('calling flush() when already clean does not prevent later mutations from persisting', async () => {
    const store = new MemoryStore();
    const svc = await open(store);
    // Clean state right after open(): flush() must not poison persistLoop.
    await svc.flush();
    svc.rename('AfterCleanFlush');
    await svc.flush();
    const reopened = await open(store);
    expect(reopened.save.profile.name).toBe('AfterCleanFlush');
    // Calling flush() a second time while clean still allows further writes.
    await svc.flush();
    svc.rename('SecondChange');
    await svc.flush();
    expect((await open(store)).save.profile.name).toBe('SecondChange');
  });

  it('commands update state, notify subscribers and survive a reload', async () => {
    const store = new MemoryStore();
    const svc = await open(store);
    // give the warrior some XP through a settled run so talents become available
    svc.settle(makeRun({ victory: true }), { submit: false });
    const seen: string[] = [];
    const off = svc.subscribe((_s, reason) => seen.push(reason));
    seen.length = 0;
    const avail = svc.save.classes.warrior.xp;
    expect(avail).toBeGreaterThan(0);
    const r = svc.allocateTalent('warrior', 'a', 'r0c0');
    expect(r.ok).toBe(true);
    expect(seen).toEqual(['command']);
    off();
    await svc.flush();
    const reopened = await open(store);
    expect(reopened.save.classes.warrior.talents.warrior_a).toEqual({ r0c0: 1 });
    expect(reopened.save.stats.runs).toBe(1);
  });

  it('a failed command changes nothing and notifies nobody', async () => {
    const svc = await open();
    const rev = svc.revision;
    const seen: number[] = [];
    svc.subscribe(() => seen.push(1));
    seen.length = 0;
    expect(svc.allocateTalent('warrior', 'a', 'r0c0')).toEqual({ ok: false, reason: 'noPoints' });
    expect(svc.equip('warrior', 'yeonmu_weapon_warrior')).toEqual({ ok: false, reason: 'notOwned' });
    expect(svc.upgradeGear('warrior', 'yeonmu_weapon_warrior')).toEqual({ ok: false, reason: 'notOwned' });
    expect(svc.revision).toBe(rev);
    expect(seen).toEqual([]);
  });

  it('coalesces bursts of commands into few writes and never loses the last one', async () => {
    const store = new MemoryStore();
    let writes = 0;
    const original = store.transact.bind(store);
    store.transact = (keys: readonly string[], fn: (c: Record<string, string | undefined>) => TxWrites | undefined) => {
      writes++;
      return original(keys, fn);
    };
    const svc = await open(store);
    writes = 0;
    for (let i = 0; i < 25; i++) svc.rename(`Hero${i}`);
    await svc.flush();
    expect(writes).toBeLessThanOrEqual(2);
    expect((await open(store)).save.profile.name).toBe('Hero24');
  });

  it('recovers from a corrupted primary using the backup and reports it', async () => {
    const store = new MemoryStore();
    const svc = await open(store);
    svc.rename('First');
    await svc.flush();
    svc.rename('Second');
    await svc.flush();
    await store.transact([], () => ({ set: { 'save.main': 'corrupt' } }));
    const recovered = await open(store);
    expect(recovered.loadInfo).toMatchObject({ source: 'backup', recovered: true });
    expect(recovered.save.profile.name).toBe('First');
    // the recovered state was written back: a plain reopen is clean
    expect((await open(store)).loadInfo).toMatchObject({ source: 'main', recovered: false });
  });

  it('starts a fresh profile (flagged corrupt) when nothing is readable', async () => {
    const store = new MemoryStore();
    await store.transact([], () => ({ set: { 'save.main': 'junk', 'save.bak': 'junk' } }));
    const svc = await open(store);
    expect(svc.loadInfo).toMatchObject({ corrupt: true, source: 'none' });
    expect(svc.save.stats.runs).toBe(0);
    expect(await svc.repo.readCorrupt()).toBe('junk');
  });

  it('refuses to open a save from a newer build', async () => {
    const store = new MemoryStore();
    const base = await open(store);
    await store.transact([], () => ({ set: { 'save.main': encodeRecord({ ...base.save, version: SAVE_VERSION + 1 }, NOW) } }));
    await expect(open(store)).rejects.toBeInstanceOf(SaveError);
  });

  it('migrates and re-persists an old save on open', async () => {
    const store = new MemoryStore();
    await open(store);
    const old = { profile: { id: 'abc', name: 'Old', created: 1 }, classes: { warrior: { xp: 900, gear: {}, collection: [] } }, bank: { yeop: 10, shards: 0 } };
    const raw = JSON.stringify(old);
    await store.transact([], () => ({ set: { 'save.main': JSON.stringify({ f: 1, t: NOW, c: checksum(raw), d: raw }) } }));
    const svc = await open(store);
    expect(svc.loadInfo.fromVersion).toBe(0);
    expect(svc.save.version).toBe(SAVE_VERSION);
    const stored = await new SaveRepository(store).load(C);
    expect(stored.fromVersion).toBe(SAVE_VERSION);
  });
});

describe('gameplay commands', () => {
  it('settle banks the run, persists, exposes the summary; blacksmith + gear flow end to end', async () => {
    const svc = await open();
    const { summary } = svc.settle(makeRun({ victory: true, bossesKilled: ['yeonmu_boss1', 'yeonmu_final'], yeopLeft: 100_000, shards: 500 }), { submit: false });
    expect(summary.bank.yeopTotal).toBe(100_000);
    expect(svc.canStart('suryeon', 'normal')).toEqual({ ok: true });
    expect(svc.canStart('seori', 'normal')).toEqual({ ok: false, reason: 'zoneLocked' });
    // force a piece into the collection through the pure grant path via equip: seed one drop deterministically
    const gearId = 'yeonmu_weapon_warrior';
    const s = svc.save;
    s.classes.warrior.collection.push(gearId); // test seam: pretend it dropped
    const up = svc.upgradeGear('warrior', gearId, { next: () => 0 });
    expect(up).toMatchObject({ ok: true, success: true, from: 0, to: 1 });
    expect(svc.save.classes.warrior.plus[gearId]).toBe(1);
    expect(svc.equip('warrior', gearId)).toMatchObject({ ok: true, slot: 'weapon' });
    const b = svc.bonusesFor({ classId: 'warrior', doctrine: 'a', empire: 'saehwa' });
    expect(b.stats.damage).toBeCloseTo(0.08 + 0.02);
    // the empire bonus is applied by the sim from RunConfig.empire, never a second time through the meta bonuses
    expect(b.stats.maxHpPct).toBeUndefined();
    expect(svc.unequip('warrior', 'weapon')).toMatchObject({ ok: true });
  });

  it('respec is free; rename sanitises', async () => {
    const svc = await open();
    svc.save.classes.warrior.xp = xpForPoints(5);
    expect(svc.allocateTalent('warrior', 'a', 'r0c0').ok).toBe(true);
    svc.respecTalents('warrior');
    expect(svc.save.classes.warrior.talents).toEqual({});
    svc.rename('   ');
    expect(svc.save.profile.name).toBe('Kahraman');
    svc.rename('  Ejder  ');
    expect(svc.save.profile.name).toBe('Ejder');
  });
});

describe('settings mirror', () => {
  it('mirrors device settings into the save without marking it for cloud sync', async () => {
    const svc = await open();
    const port = new FakeSettings(svc.save.settings);
    const updatedBefore = svc.save.profile.updated;
    svc.bindSettings(port);
    port.update({ masterVolume: 0.25 });
    expect(svc.save.settings.masterVolume).toBe(0.25);
    expect(svc.save.profile.updated).toBe(updatedBefore);
    await svc.flush();
    expect((await open((svc.repo.store as MemoryStore))).save.settings.masterVolume).toBe(0.25);
  });
});

describe('export / import / reset', () => {
  it('exports a .msav that another install can import; bad files leave state untouched', async () => {
    const a = await open();
    a.settle(makeRun({ victory: true, yeopLeft: 4321 }), { submit: false });
    const text = a.exportMsav();
    const b = await open();
    const before = structuredClone(b.save);
    await expect(b.importMsav('MSAV1.1.deadbeef.AAAA')).rejects.toBeInstanceOf(SaveError);
    expect(b.save).toEqual(before);
    const r = await b.importMsav(text);
    expect(r.fromVersion).toBe(SAVE_VERSION);
    expect(b.save.bank.yeop).toBe(4321);
    expect(b.save.profile.id).toBe(a.save.profile.id);
    expect((await open(b.repo.store as MemoryStore)).save.bank.yeop).toBe(4321);
  });

  it('import applies the file settings to the live settings port', async () => {
    const a = await open();
    const port = new FakeSettings(a.save.settings);
    a.bindSettings(port);
    port.update({ sfxVolume: 0.11 });
    const text = a.exportMsav();
    const b = await open();
    const bp = new FakeSettings(b.save.settings);
    b.bindSettings(bp);
    await b.importMsav(text);
    expect(bp.value.sfxVolume).toBe(0.11);
  });

  it('reset starts over but keeps this device\'s settings', async () => {
    const svc = await open();
    svc.settle(makeRun({ victory: true, yeopLeft: 99 }), { submit: false });
    const settings = svc.save.settings;
    await svc.resetProfile('Neo');
    expect(svc.save.stats.runs).toBe(0);
    expect(svc.save.bank.yeop).toBe(0);
    expect(svc.save.profile.name).toBe('Neo');
    expect(svc.save.settings).toEqual(settings);
  });
});

describe("Sky Sovereign's Favour (MT-01)", () => {
  const sel = { classId: 'warrior' as const, doctrine: 'a' as const, empire: 'saehwa' as const, zone: 'yeonmu', difficulty: 'normal' as const };

  it('failed attempts raise it, the first clear ends it; it is derived from the save, so it survives a reload and a .msav round trip', async () => {
    const store = new MemoryStore();
    const svc = await open(store);
    const at = (zone: string, difficulty: 'normal' | 'hard' = 'normal') => svc.favourFor(zone, difficulty);
    // the run bonuses with / without the favour: a settled run may also drop gear, so compare the two instead of expecting `{}`
    const noZone = { classId: 'warrior' as const, doctrine: 'a' as const, empire: 'saehwa' as const };
    const delta = (zone: string, difficulty: 'normal' | 'hard' = 'normal') => {
      const on = svc.bonusesFor(bonusContextFor({ ...sel, zone, difficulty })).stats;
      const off = svc.bonusesFor(noZone).stats;
      return { damage: (on.damage ?? 0) - (off.damage ?? 0), maxHpPct: (on.maxHpPct ?? 0) - (off.maxHpPct ?? 0), others: { ...on, damage: off.damage, maxHpPct: off.maxHpPct } };
    };
    expect(at('yeonmu')).toBe(0);
    expect(svc.bonusesFor(bonusContextFor(sel)).stats).toEqual({});

    for (let i = 1; i <= 3; i++) svc.settle(makeRun({ victory: false, zone: 'yeonmu' }), { submit: false });
    expect(at('yeonmu')).toBeCloseTo(0.09, 9);
    expect(delta('yeonmu')).toMatchObject({ damage: expect.closeTo(0.09, 9), maxHpPct: expect.closeTo(0.09, 9) });
    expect(delta('yeonmu').others).toEqual(svc.bonusesFor(noZone).stats);
    // other zone / difficulty untouched, and a context without zone (armory) shows none
    expect(at('suryeon')).toBe(0);
    expect(at('yeonmu', 'hard')).toBe(0);
    expect(delta('suryeon')).toMatchObject({ damage: 0, maxHpPct: 0 });
    expect(delta('yeonmu', 'hard')).toMatchObject({ damage: 0, maxHpPct: 0 });

    // survives a reload from the store and an export / import
    await svc.flush();
    const again = await open(store);
    expect(again.favourFor('yeonmu', 'normal')).toBeCloseTo(0.09, 9);
    const imported = await open();
    await imported.importMsav(svc.exportMsav());
    expect(imported.favourFor('yeonmu', 'normal')).toBeCloseTo(0.09, 9);

    // three more failures hit the cap, a hard attempt counts on its own
    for (let i = 0; i < 3; i++) svc.settle(makeRun({ victory: false, zone: 'yeonmu' }), { submit: false });
    expect(at('yeonmu')).toBe(0.15);
    svc.settle(makeRun({ victory: false, zone: 'yeonmu', difficulty: 'hard' }), { submit: false });
    expect(at('yeonmu', 'hard')).toBeCloseTo(0.03, 9);
    expect(at('yeonmu')).toBe(0.15);

    // the first normal clear takes it away for good (a later defeat does not bring it back)
    svc.settle(makeRun({ victory: true, zone: 'yeonmu', bossesKilled: ['yeonmu_boss1', 'yeonmu_final'] }), { submit: false });
    expect(at('yeonmu')).toBe(0);
    expect(delta('yeonmu')).toMatchObject({ damage: 0, maxHpPct: 0 });
    svc.settle(makeRun({ victory: false, zone: 'yeonmu' }), { submit: false });
    expect(at('yeonmu')).toBe(0);
    expect(at('yeonmu', 'hard')).toBeCloseTo(0.03, 9);
  });

  it('co-op: every client sends its OWN favour for the ROOM\'s zone; the host builds each hero from that hero\'s init', async () => {
    // three profiles: the host failed Seori 5x (+15 %), guest 1 failed it twice (+6 %), guest 2 already cleared it (0 %)
    const attempts = [
      { runs: 5, clears: 0 },
      { runs: 2, clears: 0 },
      { runs: 7, clears: 1 },
    ];
    const profiles: MetaService[] = [];
    for (const a of attempts) {
      const svc = await open();
      svc.save.stats.zones['seori'] = { normal: { runs: a.runs, clears: a.clears, bestScore: 0, bestTime: 0, bestLevel: 0 } };
      // all three have 'yeonmu' selected in the menu: the favour must follow the room's zone, not the menu
      svc.save.stats.zones['yeonmu'] = { normal: { runs: 3, clears: 0, bestScore: 0, bestTime: 0, bestLevel: 0 } };
      profiles.push(svc);
    }

    const net = new MemoryNet();
    const room = new MemoryRoom(net, { latencyMs: 25, jitterMs: 0, seed: 7 });
    const loadouts: Loadout[] = [
      { classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', tier: 1 },
      { classId: 'warrior', doctrine: 'b', sex: 'f', empire: 'chowon', tier: 2 },
      { classId: 'warrior', doctrine: 'a', sex: 'f', empire: 'jihae', tier: 0 },
    ];
    const settleNet = async (ms: number): Promise<void> => {
      for (let t = 0; t < ms; t += 5) {
        net.advance(5);
        await Promise.resolve();
        await Promise.resolve();
      }
    };
    const runs = new Map<number, CoopRunStart>();
    const sessions: CoopSession[] = [];
    try {
      for (let i = 0; i < loadouts.length; i++) {
        const t = room.client(`p${i}`, `Player${i + 1}`);
        const s = new CoopSession(t, { getLoadout: () => loadouts[i] as Loadout, onRunStart: (r) => runs.set(i, r), now: () => net.now });
        sessions.push(s);
        await Promise.all([t.connect(), settleNet(120)]);
        s.join(loadouts[i] as Loadout, i !== 0);
        await settleNet(120);
      }
      sessions[0]?.start('seori' as ZoneId, 'normal', 4321);
      await settleNet(200);

      // what App.startRun does: bonusesFor(bonusContextFor(selection with the room's zone / difficulty)), then coop.config({ meta })
      const configs = [];
      for (let i = 0; i < loadouts.length; i++) {
        const run = runs.get(i);
        if (!run) throw new Error(`player ${i} never received the run start`);
        expect([run.zone, run.difficulty]).toEqual(['seori', 'normal']);
        const lo = loadouts[i] as Loadout;
        const menu = { classId: lo.classId, doctrine: lo.doctrine, empire: lo.empire, zone: 'yeonmu', difficulty: 'normal' as const };
        const meta = (profiles[i] as MetaService).bonusesFor(bonusContextFor({ ...menu, zone: run.zone, difficulty: run.difficulty }));
        configs.push(run.config({ meta }));
      }
      await settleNet(300);
      const [host, guest1, guest2] = await Promise.all(configs);

      const favourOf = (m: { stats: { damage?: number; maxHpPct?: number } } | undefined) => ({ damage: m?.stats.damage ?? 0, maxHpPct: m?.stats.maxHpPct ?? 0 });
      const want = (f: number) => ({ damage: expect.closeTo(f, 9), maxHpPct: expect.closeTo(f, 9) });
      // the host's own hero
      expect(favourOf(host?.meta)).toEqual(want(0.15));
      // the host's init of each guest carries THAT guest's favour (it came over the relay and through sanitizeMeta)
      expect(host?.coop?.map((c) => c.classId)).toEqual(['warrior', 'warrior']);
      expect(favourOf(host?.coop?.[0]?.meta)).toEqual(want(0.06));
      expect(host?.coop?.[1]?.meta.stats).toEqual({});
      // a guest's own local config holds its own favour too (its mirror world shows its own hero)
      expect(favourOf(guest1?.meta)).toEqual(want(0.06));
      expect(guest2?.meta.stats).toEqual({});
      // the menu zone (Yeonmu, 3 failures = 9 %) was not used
      expect(host?.meta.stats.damage).not.toBeCloseTo(0.09, 9);
    } finally {
      for (const r of runs.values()) r.abort();
      for (const s of sessions) s.close();
    }
  });
});

describe('cloud integration', () => {
  it('settle submits the run through the API client', async () => {
    const api = new FakeCloud();
    api.credentials = true;
    const svc = await open(new MemoryStore(), { api });
    const { summary, submit } = svc.settle(makeRun({ victory: true }), { empire: 'jihae', sex: 'm' });
    const out = await submit;
    expect(out).toMatchObject({ kind: 'submitted' });
    expect(api.server.runs[0]).toMatchObject({ runId: summary.runId, empire: 'jihae', sex: 'm', zone: 'yeonmu' });
  });

  it('the first submit of an unnamed profile registers its own public name, not the shared default (EXPLORER-1)', async () => {
    const registeredBy = async (seed: number, name?: string): Promise<string | undefined> => {
      const api = new FakeCloud();
      const svc = await open(new MemoryStore(), { api, rng: seededRng(seed) });
      if (name !== undefined) svc.rename(name);
      await svc.settle(makeRun({ victory: true })).submit;
      return api.registered[0];
    };
    const a = await registeredBy(1);
    const b = await registeredBy(2);
    expect(a).toMatch(/^Hero-[A-Z0-9]{4}$/);
    expect(b).toMatch(/^Hero-[A-Z0-9]{4}$/);
    expect(a).not.toBe(b);
    expect(await registeredBy(1, 'Ejder')).toBe('Ejder');
  });

  it('without an API the run is only banked locally; offline runs queue', async () => {
    const svc = await open();
    expect(await svc.settle(makeRun()).submit).toEqual({ kind: 'skipped', reason: 'disabled' });
    const api = new FakeCloud();
    api.credentials = true;
    api.offline = true;
    const online = await open(new MemoryStore(), { api });
    expect(await online.settle(makeRun()).submit).toEqual({ kind: 'queued' });
    expect(online.save.stats.runs).toBe(1);
  });

  it('syncs the save, and adopting a cloud copy keeps this device\'s settings', async () => {
    const server = new FakeServer();
    const apiA = new FakeCloud(server);
    apiA.credentials = true;
    const a = await open(new MemoryStore(), { api: apiA });
    const pa = new FakeSettings(a.save.settings);
    a.bindSettings(pa);
    pa.update({ masterVolume: 0.1, quality: 'low' });
    a.settle(makeRun({ victory: true, yeopLeft: 800 }), { submit: false });
    expect(await a.syncNow()).toMatchObject({ kind: 'pushed', rev: 1 });

    const apiB = new FakeCloud(server);
    apiB.credentials = true;
    const b = await open(new MemoryStore(), { api: apiB });
    const bSettings = b.save.settings;
    expect(await b.syncNow()).toMatchObject({ kind: 'pulled', rev: 1 });
    expect(b.save.bank.yeop).toBe(800);
    expect(b.save.settings).toEqual(bSettings);
    expect(b.save.settings.masterVolume).not.toBe(0.1);
    // persisted too
    expect((await open(b.repo.store as MemoryStore)).save.bank.yeop).toBe(800);
  });

  it('syncNow is disabled without an API', async () => {
    expect(await (await open()).syncNow()).toEqual({ kind: 'disabled' });
  });

  it('auto-sync pushes shortly after a change, and stops cleanly', async () => {
    vi.useFakeTimers();
    const api = new FakeCloud();
    api.credentials = true;
    const svc = await open(new MemoryStore(), { api });
    const stop = svc.startAutoSync({ debounceMs: 1000, intervalMs: 3_600_000 });
    svc.rename('Auto');
    await vi.advanceTimersByTimeAsync(500);
    expect(api.calls).not.toContain('putSave');
    await vi.advanceTimersByTimeAsync(600);
    expect(api.calls).toContain('putSave');
    expect(JSON.parse(api.server.save?.body ?? '{}').profile.name).toBe('Auto');
    stop();
    const before = api.calls.length;
    svc.rename('Later');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.calls.length).toBe(before);
    svc.dispose();
  });

  it('auto-sync surfaces conflicts through cloud.subscribe', async () => {
    vi.useFakeTimers();
    const server = new FakeServer();
    const apiA = new FakeCloud(server);
    apiA.credentials = true;
    const a = await open(new MemoryStore(), { api: apiA });
    a.settle(makeRun({ yeopLeft: 10 }), { submit: false });
    await a.syncNow();
    const apiB = new FakeCloud(server);
    apiB.credentials = true;
    const b = await open(new MemoryStore(), { api: apiB });
    b.settle(makeRun({ yeopLeft: 20 }), { submit: false }); // first link with progress vs existing cloud
    const seen: string[] = [];
    b.cloud?.subscribe((o) => seen.push(o.kind));
    b.startAutoSync({ debounceMs: 100, intervalMs: 3_600_000 });
    b.rename('B');
    await vi.advanceTimersByTimeAsync(200);
    expect(seen).toContain('conflict');
    expect(b.cloud?.conflict).not.toBeNull();
    expect(await b.cloud?.resolveConflict('local')).toMatchObject({ kind: 'pushed' });
    b.dispose();
  });
});

describe('multi-tab', () => {
  it('another tab\'s write is picked up through the channel', async () => {
    const store = new MemoryStore();
    const listeners: (() => void)[] = [];
    const mk = (): TabChannel => ({
      post: () => listeners.forEach((l) => l()),
      onMessage: (fn) => void listeners.push(fn),
      close: () => undefined,
    });
    let t = NOW;
    const tab1 = await MetaService.open({ content: C, store, rng: seededRng(1), now: () => t, channel: mk() });
    const tab2 = await MetaService.open({ content: C, store, rng: seededRng(2), now: () => t, channel: mk() });
    t += 1000;
    tab1.rename('FromTab1');
    await tab1.flush();
    await vi.waitFor(() => expect(tab2.save.profile.name).toBe('FromTab1'));
  });
});
