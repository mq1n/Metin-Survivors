import { afterEach, describe, expect, it } from 'vitest';
import { cloneContent, fixtureConfig } from '../../sim/__fixtures__/content';
import { giveSkill, spawn } from '../../sim/__tests__/helpers';
import { hurtPlayer, HurtKind } from '../../sim/combat';
import type { RunResult } from '../../sim/run';
import { createWorld } from '../../sim/world';
import { CoopHarness } from './harness';
import { sanitizeMeta } from './meta';
import { buildPlayerResult, decodeResult, encodeResult } from './results';

function twoPlayerWorld() {
  // `config` describes the first hero (class warrior, doctrine a); `coop` lists the additional ones
  const config = fixtureConfig({
    coop: [{ classId: 'warrior', doctrine: 'b', sex: 'f', empire: 'chowon', meta: { stats: {} } }],
  });
  return createWorld(config, cloneContent(), config.meta);
}

describe('per-player results', () => {
  it('gives each hero its own numbers and the party the shared ones', () => {
    const w = twoPlayerWorld();
    expect(w.players).toHaveLength(2);
    giveSkill(w, 'bladewheel', 2, 1);
    w.players[0]!.kills = 5;
    w.players[1]!.kills = 9;
    w.players[1]!.level = 7;
    w.players[1]!.yeopEarned = 321;
    w.players[1]!.shards = 4;
    w.players[1]!.skills[0]!.damage = 999;
    const a = buildPlayerResult(w, false, 0);
    const b = buildPlayerResult(w, false, 1);
    expect(a.doctrine).toBe('a');
    expect(b.doctrine).toBe('b');
    expect(a.kills).toBe(5);
    expect(b.kills).toBe(9);
    expect(b.level).toBe(7);
    expect(b.yeop).toBe(321);
    expect(b.shards).toBe(4);
    expect(b.damageBySkill.some((s) => s.damage === 999)).toBe(true);
    expect(a.players).toHaveLength(2);
    expect(a.time).toBe(b.time);
    expect(a.seed).toBe(b.seed);
    expect(a.runOptions).toEqual(b.runOptions);
  });

  it('survives the wire (JSON ≤ 4096 chars) and rejects garbage', () => {
    const w = twoPlayerWorld();
    const r = buildPlayerResult(w, true, 1);
    const wire = encodeResult(r);
    const text = JSON.stringify(wire);
    expect(text.length).toBeLessThan(1500);
    const back = decodeResult(JSON.parse(text));
    expect(back).not.toBeNull();
    const norm = (x: RunResult): unknown => JSON.parse(JSON.stringify({ ...x, time: Math.round(x.time * 100) / 100, maxCorruption: Math.round(x.maxCorruption * 1000) / 1000 }));
    expect(norm(back as RunResult)).toEqual(norm(r));
    expect(decodeResult(null)).toBeNull();
    expect(decodeResult('x')).toBeNull();
    expect(decodeResult({ ...wire, c: 'dragon' })).toBeNull();
    expect(decodeResult({ ...wire, df: 'nightmare' })).toBeNull();
    const hostile = decodeResult({ ...wire, k: -5, y: 'lots', lv: 1e99, t: Number.NaN, ds: [['x', 1e9, -1], 7], pl: [[9, 9, 9, 9, 9], 'x'] });
    expect(hostile).not.toBeNull();
    expect(hostile?.kills).toBe(0);
    expect(hostile?.yeop).toBe(0);
    expect(hostile?.level).toBeLessThanOrEqual(9999);
    expect(hostile?.time).toBe(0);
    expect(hostile?.damageBySkill).toHaveLength(1);
    expect(hostile?.players.every((p) => p.index <= 3)).toBe(true);
  });

  it('fits the worst case (12 skills, 64 bosses, many metin types) in one relay event', () => {
    const w = twoPlayerWorld();
    const r = buildPlayerResult(w, true, 0);
    r.bossesKilled = Array.from({ length: 64 }, (_, i) => `boss_${i}_xxxxxxxx`);
    r.metinTypesBroken = Array.from({ length: 60 }, (_, i) => `metin_type_${i % 12}`);
    r.damageBySkill = Array.from({ length: 15 }, (_, i) => ({ skillId: `skill_number_${i}`, rank: 5, damage: 12_345_678 + i }));
    expect(JSON.stringify(encodeResult(r)).length).toBeLessThan(4096);
  });
});

/** DT-01: the defeat record (killer, moment, next boss) on the wire */
describe('death record on the wire', () => {
  /** hero `i` is struck down at run time `t` by a fresh creature of `type` */
  function fell(w: ReturnType<typeof twoPlayerWorld>, i: number, type: string, t: number): void {
    const p = w.players[i]!;
    p.hp = p.hpMax = 1;
    p.iframes = 0;
    w.time = t;
    const row = spawn(w, type, p.x + 1, p.z);
    hurtPlayer(w, i, 50, p.x + 1, p.z, 0, HurtKind.Melee, w.enemies.id[row] as number);
    expect(p.alive).toBe(false);
  }
  const norm = (x: RunResult): unknown => JSON.parse(JSON.stringify({ ...x, time: Math.round(x.time * 100) / 100, maxCorruption: Math.round(x.maxCorruption * 1000) / 1000, damageTaken: Math.round(x.damageTaken), killedAt: x.killedAt === undefined ? undefined : Math.round(x.killedAt * 100) / 100, nextBoss: x.nextBoss && { id: x.nextBoss.id, inSec: Math.round(x.nextBoss.inSec * 100) / 100 } }));

  it('each hero gets its own record: where HE fell, who struck, which boss came next', () => {
    const w = twoPlayerWorld();
    fell(w, 1, 'bear', 40.123);
    fell(w, 0, 'wolf', 200.5);
    const host = buildPlayerResult(w, false, 0);
    const guest = buildPlayerResult(w, false, 1);
    expect(host.killedBy).toBe('wolf');
    expect(host.killedAt).toBeCloseTo(200.5, 9);
    expect(host.nextBoss?.id).toBe('boss_ork_chief');
    expect(host.nextBoss?.inSec).toBeCloseTo(279.5, 9);
    expect(guest.killedBy).toBe('bear');
    expect(guest.killedAt).toBeCloseTo(40.123, 9);
    expect(guest.nextBoss?.id).toBe('boss_horyeong');
    expect(guest.nextBoss?.inSec).toBeCloseTo(139.877, 9);
    // the shared numbers stay the party's
    expect(host.time).toBe(guest.time);
  });

  it('round trip with the fields: JSON under the relay cap, decoded equal', () => {
    const w = twoPlayerWorld();
    fell(w, 1, 'bear', 40.123);
    fell(w, 0, 'wolf', 200.5);
    for (const i of [0, 1]) {
      const r = buildPlayerResult(w, false, i);
      const text = JSON.stringify(encodeResult(r));
      expect(text.length).toBeLessThan(1600);
      const back = decodeResult(JSON.parse(text)) as RunResult;
      expect(norm(back)).toEqual(norm(r));
      expect(back.killedBy).toBe(r.killedBy);
      expect(back.nextBoss?.id).toBe(r.nextBoss?.id);
    }
  });

  it('round trip without them: a victory, a hero still standing and an older host send no new keys and decode to none', () => {
    const w = twoPlayerWorld();
    fell(w, 1, 'bear', 40);
    const won = buildPlayerResult(w, true, 1);
    const standing = buildPlayerResult(w, false, 0);
    for (const r of [won, standing]) {
      expect('killedBy' in r || 'killedAt' in r || 'nextBoss' in r).toBe(false);
      const wire = encodeResult(r);
      expect('kb' in wire || 'kt' in wire || 'nb' in wire).toBe(false);
      const back = decodeResult(JSON.parse(JSON.stringify(wire))) as RunResult;
      expect('killedBy' in back || 'killedAt' in back || 'nextBoss' in back).toBe(false);
      expect(norm(back)).toEqual(norm(r));
    }
    // a wire from before DT-01 (no kb / kt / nb at all) still decodes
    const legacy = JSON.parse(JSON.stringify(encodeResult(buildPlayerResult(w, false, 1)))) as Record<string, unknown>;
    delete legacy.kb;
    delete legacy.kt;
    delete legacy.nb;
    const old = decodeResult(legacy) as RunResult;
    expect(old).not.toBeNull();
    expect(old.killedBy).toBeUndefined();
    expect(old.killedAt).toBeUndefined();
    expect(old.nextBoss).toBeUndefined();
  });

  it('an unnamed killer travels as a moment and a next boss only', () => {
    const w = twoPlayerWorld();
    const p = w.players[1]!;
    p.hp = p.hpMax = 1;
    w.time = 55;
    hurtPlayer(w, 1, 50, 90, 90, 0, HurtKind.Projectile);
    const r = buildPlayerResult(w, false, 1);
    const wire = encodeResult(r);
    expect(wire.kb).toBeUndefined();
    expect(wire.kt).toBe(55);
    expect(wire.nb).toEqual(['boss_horyeong', 125]);
    const back = decodeResult(JSON.parse(JSON.stringify(wire))) as RunResult;
    expect(back.killedBy).toBeUndefined();
    expect(back.killedAt).toBe(55);
    expect(back.nextBoss).toEqual({ id: 'boss_horyeong', inSec: 125 });
  });

  it('hostile fields are dropped or clamped, never trusted', () => {
    const wire = encodeResult(buildPlayerResult(twoPlayerWorld(), false, 0));
    const decode = (extra: Record<string, unknown>): RunResult => decodeResult({ ...wire, ...extra }) as RunResult;
    expect(decode({ kb: 'x'.repeat(500) }).killedBy).toBeUndefined();
    expect(decode({ kb: '<img src=x onerror=1>' }).killedBy).toBeUndefined();
    expect(decode({ kb: 'boss:' }).killedBy).toBeUndefined();
    expect(decode({ kb: 'evil:wolf' }).killedBy).toBeUndefined();
    expect(decode({ kb: 7 }).killedBy).toBeUndefined();
    expect(decode({ kb: 'metin:metin_lament' }).killedBy).toBe('metin:metin_lament');
    expect(decode({ kb: 'hazard:lava' }).killedBy).toBe('hazard:lava');
    expect(decode({ kt: Number.NaN }).killedAt).toBeUndefined();
    expect(decode({ kt: 'soon' }).killedAt).toBeUndefined();
    expect(decode({ kt: -30 }).killedAt).toBe(0);
    expect(decode({ kt: 1e99 }).killedAt).toBe(1e6);
    expect(decode({ nb: 'boss_horyeong' }).nextBoss).toBeUndefined();
    expect(decode({ nb: [3, 4] }).nextBoss).toBeUndefined();
    expect(decode({ nb: ['bad id', 4] }).nextBoss).toBeUndefined();
    expect(decode({ nb: [] }).nextBoss).toBeUndefined();
    expect(decode({ nb: ['boss_horyeong', -4] }).nextBoss).toEqual({ id: 'boss_horyeong', inSec: 0 });
    expect(decode({ nb: ['boss_horyeong', 'x'] }).nextBoss).toEqual({ id: 'boss_horyeong', inSec: 0 });
  });

  it('encoder and decoder share one tag rule: a 48-char id round-trips, a 49-char id is dropped on both sides, never cut', () => {
    const w = twoPlayerWorld();
    fell(w, 1, 'bear', 40);
    const base = buildPlayerResult(w, false, 1);
    const id48 = 'a'.repeat(48);
    const id49 = 'a'.repeat(49);
    const send = (killedBy: string, nextId: string): { wire: ReturnType<typeof encodeResult>; back: RunResult } => {
      const wire = encodeResult({ ...base, killedBy, nextBoss: { id: nextId, inSec: 12 } });
      return { wire, back: decodeResult(JSON.parse(JSON.stringify(wire))) as RunResult };
    };
    // the longest tags that fit: the bare id, and the 'hazard:' prefix (the longest) in front of it
    for (const [kb, nb] of [[id48, id48], [`boss:${id48}`, id48], [`hazard:${id48}`, id48], [`metin:${id48}`, id48]] as const) {
      const { wire, back } = send(kb, nb);
      expect(wire.kb).toBe(kb);
      expect(wire.nb).toEqual([nb, 12]);
      expect(back.killedBy).toBe(kb);
      expect(back.nextBoss).toEqual({ id: nb, inSec: 12 });
    }
    // one char more: nothing is sent (not a cut id that names nothing) and nothing is decoded; the moment still travels
    for (const [kb, nb] of [[id49, id49], [`boss:${id49}`, id49], [`hazard:${id49}`, id49]] as const) {
      const { wire, back } = send(kb, nb);
      expect(wire.kb).toBeUndefined();
      expect(wire.nb).toBeUndefined();
      expect(wire.kt).toBe(base.killedAt === undefined ? undefined : Math.round(base.killedAt * 100) / 100);
      expect(back.killedBy).toBeUndefined();
      expect(back.nextBoss).toBeUndefined();
      expect(back.killedAt).toBeCloseTo(base.killedAt as number, 2);
    }
    // an id the decoder would refuse for its characters is dropped by the encoder too, and nothing beyond the 64-char cap is ever sent
    const odd = send('boss:bad id', 'bad id');
    expect(odd.wire.kb).toBeUndefined();
    expect(odd.wire.nb).toBeUndefined();
    const hugeWire = encodeResult({ ...base, killedBy: `boss:${'b'.repeat(80)}`, nextBoss: { id: 'n'.repeat(80), inSec: 1 } });
    expect(hugeWire.kb).toBeUndefined();
    expect(hugeWire.nb).toBeUndefined();
  });

  it('the worst case (64 boss ids, 12 skills, the longest ids) still fits one relay event', () => {
    const w = twoPlayerWorld();
    const r = buildPlayerResult(w, false, 0);
    r.bossesKilled = Array.from({ length: 64 }, (_, i) => `boss_${i}_xxxxxxxx`);
    r.metinTypesBroken = Array.from({ length: 60 }, (_, i) => `metin_type_${i % 12}`);
    r.damageBySkill = Array.from({ length: 15 }, (_, i) => ({ skillId: `skill_number_${i}`, rank: 5, damage: 12_345_678 + i }));
    r.killedBy = `boss:${'b'.repeat(80)}`;
    r.killedAt = 1_234_567.891;
    r.nextBoss = { id: 'n'.repeat(80), inSec: 987_654.321 };
    const wire = encodeResult(r);
    expect(JSON.stringify(wire).length).toBeLessThan(4096);
    // ids the decoder would refuse are not sent at all (never cut)
    expect(wire.kb).toBeUndefined();
    expect(wire.nb).toBeUndefined();
  });
});

describe('death record end to end (host + guest on the in-memory relay)', () => {
  let h: CoopHarness | null = null;
  afterEach(() => {
    h?.dispose();
    h = null;
  });
  const run = (n: number): void => {
    for (let i = 0; i < n; i++) (h as CoopHarness).tick({ x: 0, z: 0 }, [{ x: 0, z: 0 }]);
  };

  it('the guest and the host each learn who struck them down and where the boss timeline stood', async () => {
    h = await CoopHarness.create({ guests: 1, latencyMs: 30, enemies: 0, tough: true });
    const hw = h.hostWorld;
    const mw = h.guestWorlds[0]!;
    run(60 * 4);
    const wolf = spawn(hw, 'wolf', hw.players[1]!.x + 1, hw.players[1]!.z);
    hurtPlayer(hw, 1, 1e9, hw.players[1]!.x + 1, hw.players[1]!.z, 0, HurtKind.Melee, hw.enemies.id[wolf] as number);
    const tGuest = hw.time;
    run(60 * 2);
    const bear = spawn(hw, 'bear', hw.players[0]!.x + 1, hw.players[0]!.z);
    hurtPlayer(hw, 0, 1e9, hw.players[0]!.x + 1, hw.players[0]!.z, 0, HurtKind.Melee, hw.enemies.id[bear] as number);
    const tHost = hw.time;
    for (let i = 0; i < 400 && !hw.over; i++) h.tick();
    expect(hw.over).toBe(true);
    run(90);
    await h.settle(200);
    expect(mw.over).toBe(true);
    const own = mw.result!;
    const hostRes = hw.result!;
    expect(own.killedBy).toBe('wolf');
    expect(own.killedAt).toBeCloseTo(tGuest, 2);
    // the harness zone has no scheduled bosses: the next one is the final boss (fixture zone: 900 s)
    expect(own.nextBoss?.id).toBe('boss_scarlet_wyrm');
    expect(own.nextBoss?.inSec).toBeCloseTo(900 - tGuest, 1);
    expect(hostRes.killedBy).toBe('bear');
    expect(hostRes.killedAt).toBeCloseTo(tHost, 9);
    expect(hostRes.killedAt as number).toBeGreaterThan(own.killedAt as number);
  });

  it('a host that abandons the run after its hero fell keeps its record; the guest still standing has none', async () => {
    h = await CoopHarness.create({ guests: 1, latencyMs: 30, enemies: 0, tough: true });
    const hw = h.hostWorld;
    const mw = h.guestWorlds[0]!;
    run(60 * 4);
    const wolf = spawn(hw, 'wolf', hw.players[0]!.x + 1, hw.players[0]!.z);
    hurtPlayer(hw, 0, 1e9, hw.players[0]!.x + 1, hw.players[0]!.z, 0, HurtKind.Melee, hw.enemies.id[wolf] as number);
    const tHost = hw.time;
    expect(hw.players[0]?.alive).toBe(false);
    run(60 * 2);
    // the host hero is down, the guest stands: the run is not over
    expect(hw.players[1]?.alive).toBe(true);
    expect(hw.over).toBe(false);
    expect(h.host.finished).toBe(false);
    // the host quits from the pause menu: the session is disposed mid-run (CoopHost.dispose -> finish) and everybody gets a personal result
    expect(hw.buildResult(false).killedBy).toBe('wolf'); // the host's own quit path (CoopHostWorld.buildResult)
    h.runs[0]!.abort();
    expect(h.host.finished).toBe(true);
    await h.settle(300);
    const hostRes = h.host.results[0]!;
    expect(hostRes.victory).toBe(false);
    expect(hostRes.killedBy).toBe('wolf');
    expect(hostRes.killedAt).toBeCloseTo(tHost, 9);
    // the harness zone has no scheduled bosses: the next one is the final boss (fixture zone: 900 s)
    expect(hostRes.nextBoss?.id).toBe('boss_scarlet_wyrm');
    expect(hostRes.nextBoss?.inSec).toBeCloseTo(900 - tHost, 1);
    expect(hw.result).toBe(hostRes);
    const guestRes = mw.result!;
    expect(guestRes).toBeTruthy();
    expect(guestRes.victory).toBe(false);
    expect('killedBy' in guestRes || 'killedAt' in guestRes || 'nextBoss' in guestRes).toBe(false);
    expect(h.host.results[1]).toBeTruthy();
    expect('killedBy' in (h.host.results[1] as RunResult) || 'killedAt' in (h.host.results[1] as RunResult)).toBe(false);
  });

  it('a guest that was away too long (hero dropped without a blow) gets a result without a killer, the host keeps its own', async () => {
    h = await CoopHarness.create({ guests: 1, latencyMs: 30, enemies: 0, tough: true });
    const hw = h.hostWorld;
    const mw = h.guestWorlds[0]!;
    run(120);
    h.transports[1]?.drop();
    run(60 * 17);
    expect(hw.players[1]?.alive).toBe(false);
    expect(hw.players[1]?.killedAt).toBe(-1);
    await h.reconnect(1);
    run(60);
    const bear = spawn(hw, 'bear', hw.players[0]!.x + 1, hw.players[0]!.z);
    hurtPlayer(hw, 0, 1e9, hw.players[0]!.x + 1, hw.players[0]!.z, 0, HurtKind.Melee, hw.enemies.id[bear] as number);
    for (let i = 0; i < 400 && !hw.over; i++) h.tick();
    expect(hw.over).toBe(true);
    run(90);
    await h.settle(200);
    expect(hw.result?.killedBy).toBe('bear');
    const own = mw.result!;
    expect(own).toBeTruthy();
    expect('killedBy' in own || 'killedAt' in own || 'nextBoss' in own).toBe(false);
  });
});

describe('sanitizeMeta', () => {
  it('keeps valid bonuses', () => {
    const m = sanitizeMeta({ stats: { maxHpPct: 40, armor: 120, vsRace: { beast: 12 }, resist: { fire: 5 } }, startLevel: 3, extraSkills: ['bladewheel'], rerolls: 2, skillMods: { bladewheel: { damage: 10 } } });
    expect(m.stats).toMatchObject({ maxHpPct: 40, armor: 120, vsRace: { beast: 12 }, resist: { fire: 5 } });
    expect(m.startLevel).toBe(3);
    expect(m.extraSkills).toEqual(['bladewheel']);
    expect(m.rerolls).toBe(2);
    expect(m.skillMods).toEqual({ bladewheel: { damage: 10 } });
  });

  it('drops unknown keys, non-finite values, absurd magnitudes and prototype tricks', () => {
    const m = sanitizeMeta(
      JSON.parse('{"stats":{"maxHp":1e300,"evil":5,"armor":"x","damage":NaN_,"__proto__":{"x":1}},"startLevel":9999,"extraSkills":["ok_skill","bad skill",7],"skillMods":{"__proto__":{"damage":1},"s":{"nope":1},"t":{"damage":5}}}'.replace('NaN_', '0')),
    );
    expect(m.stats).toEqual({ maxHp: 1e5, damage: 0 });
    expect(m.startLevel).toBe(40);
    expect(m.extraSkills).toEqual(['ok_skill']);
    expect(Object.keys(m.skillMods ?? {})).toEqual(['t']);
    expect(sanitizeMeta(null)).toEqual({ stats: {} });
    expect(sanitizeMeta([1, 2])).toEqual({ stats: {} });
  });

  it('keeps the JSON under the relay limit by trimming per-skill mods', () => {
    const skillMods: Record<string, Record<string, number>> = {};
    for (let i = 0; i < 64; i++) skillMods[`skill_${String(i).padStart(30, 'x')}`] = { damage: 1.123456789, cooldown: 2.123456789, area: 3.123456789, count: 1, duration: 2, speed: 3, pierce: 4, knockback: 5, tick: 6, range: 7, statusChance: 8, statusPower: 9, heal: 10 };
    const m = sanitizeMeta({ stats: { maxHp: 5 }, skillMods });
    expect(JSON.stringify(m).length).toBeLessThanOrEqual(3800);
    expect(m.stats).toMatchObject({ maxHp: 5 });
  });
});
