import {
  CLASS_IDS,
  COOP_LIMITS,
  DAILY_PERIOD,
  DAILY_REWARD_MAX,
  DAILY_REWARD_WEIGHTS,
  DAILY_RUN_OPTION_STEPS,
  DAY_MS,
  DOCTRINE_KEYS,
  EMPIRE_IDS,
  LEADERBOARD_PERIODS,
  RUN_OPTION_KEYS,
  RUN_OPTION_MAX,
  RUN_OPTION_MIN,
  SNAPSHOT_HEADER_BYTES,
  SnapshotFlags,
  ZONE_IDS,
  computeScore,
  dailyMismatch,
  dailyReward,
  dailySpec,
  dayIndex,
  dayStartMs,
  dequantize,
  encodeSnapshot,
  formatBearer,
  isRoomCode,
  leaderboardQueryString,
  isTransferCode,
  normalizeCode,
  parseBearer,
  parseClientMessage,
  parseLeaderboardQuery,
  parseRev,
  parseRunSubmission,
  parseServerMessage,
  parseToken,
  quantize,
  readSnapshotHeader,
  snapshotPayload,
  validateDisplayName,
  type RunSubmission,
} from '@ms/shared';
import { describe, expect, it, vi } from 'vitest';
import balance from '../../../apps/game/src/data/content/balance.json';
import { runBody } from './helpers';

describe('display name format', () => {
  it('accepts Turkish letters, digits and single separators', () => {
    for (const n of ['Çağatay', 'Şükrü Öz', 'İsmail_42', 'ışık.dağ', 'Ada-Lovelace', 'Abc']) {
      expect(validateDisplayName(n), n).toMatchObject({ ok: true });
    }
  });
  it('NFC-normalises and trims', () => {
    const v = validateDisplayName('  I\u0307smail  ');
    expect(v).toEqual({ ok: true, value: '\u0130smail' });
  });
  it('rejects bad length, charset and separators', () => {
    for (const n of ['ab', 'a'.repeat(17), 'bad<name>', 'two  spaces', '_lead', 'trail-', 'emoji😀x', 'ключ123', '日本語です', 'tab\tname', 12, null]) {
      expect(validateDisplayName(n), String(n)).toMatchObject({ ok: false });
    }
  });
  it('counts code points not UTF-16 units at the 16-char edge', () => {
    expect(validateDisplayName('a'.repeat(16))).toMatchObject({ ok: true });
    expect(validateDisplayName('ç'.repeat(16))).toMatchObject({ ok: true });
    expect(validateDisplayName('ç'.repeat(17))).toMatchObject({ ok: false });
  });
});

describe('auth token', () => {
  const cred = { playerId: 'A'.repeat(16), secret: 'b'.repeat(32) };
  it('round-trips', () => {
    expect(parseBearer(`Bearer ${formatBearer(cred)}`)).toEqual(cred);
    expect(parseToken(formatBearer(cred))).toEqual(cred);
  });
  it('rejects malformed tokens', () => {
    for (const t of ['', 'Bearer', 'Bearer x.y', `Bearer ${cred.playerId}`, `Basic ${formatBearer(cred)}`, `Bearer ${'A'.repeat(15)}.${cred.secret}`]) {
      expect(parseBearer(t), t).toBeNull();
    }
    expect(parseBearer(null)).toBeNull();
  });
});

describe('run submission guard', () => {
  it('accepts a well-formed run and strips unknown fields', () => {
    const v = parseRunSubmission({ ...runBody(), extra: 'x' });
    expect(v.ok).toBe(true);
    if (v.ok) expect('extra' in v.value).toBe(false);
  });
  it('rejects each malformed field', () => {
    const base = runBody();
    const bad: [string, unknown][] = [
      ['runId', 'short'],
      ['runId', 'has spaces in it!!'],
      ['clientVersion', 'one'],
      ['zone', 'nowhere'],
      ['difficulty', 'nightmare'],
      ['classId', 'mage'],
      ['seed', -1],
      ['seed', 1.5],
      ['victory', 'yes'],
      ['duration', -1],
      ['duration', Number.NaN],
      ['duration', 99999],
      ['endedAt', 1.5],
      ['stats', null],
    ];
    for (const [k, v] of bad) {
      expect(parseRunSubmission({ ...base, [k]: v }), `${k}=${String(v)}`).toMatchObject({ ok: false, field: k });
    }
    expect(parseRunSubmission({ ...base, stats: { ...base.stats, kills: -1 } })).toMatchObject({ ok: false, field: 'stats.kills' });
    expect(parseRunSubmission({ ...base, stats: { ...base.stats, level: 0 } })).toMatchObject({ ok: false, field: 'stats.level' });
    expect(parseRunSubmission({ ...base, stats: { ...base.stats, yeop: 1.5 } })).toMatchObject({ ok: false, field: 'stats.yeop' });
    expect(parseRunSubmission('x')).toMatchObject({ ok: false });
  });
  it('validates the optional co-op party size (2..4, integer)', () => {
    const base = runBody();
    for (const coop of [2, 3, 4]) expect(parseRunSubmission({ ...base, coop })).toMatchObject({ ok: true, value: { coop } });
    expect(parseRunSubmission(base)).toMatchObject({ ok: true });
    const solo = parseRunSubmission(base);
    expect(solo.ok && 'coop' in solo.value).toBe(false);
    for (const coop of [1, 0, 5, -1, 2.5, '2', null, Number.NaN]) {
      expect(parseRunSubmission({ ...base, coop }), String(coop)).toMatchObject({ ok: false, field: 'coop' });
    }
  });
  it('validates the optional daily day index and Run Options (DLY-01)', () => {
    const base = runBody();
    const plain = parseRunSubmission(base);
    expect(plain.ok && 'daily' in plain.value).toBe(false);
    expect(plain.ok && 'runOptions' in plain.value).toBe(false);
    const options = { density: 1.25, health: 1, damage: 1.5, speed: 3 };
    const v = parseRunSubmission({ ...base, daily: 20_000, runOptions: { ...options, extra: 9 } });
    expect(v).toMatchObject({ ok: true, value: { daily: 20_000, runOptions: options } });
    if (v.ok) expect(Object.keys(v.value.runOptions ?? {}).sort()).toEqual(['damage', 'density', 'health', 'speed']);
    expect(parseRunSubmission({ ...base, daily: 0 })).toMatchObject({ ok: true, value: { daily: 0 } });
    for (const daily of [-1, 1.5, '20000', null, 1_000_001, Number.NaN]) {
      expect(parseRunSubmission({ ...base, daily }), String(daily)).toMatchObject({ ok: false, field: 'daily' });
    }
    const bad: [unknown, string][] = [
      ['x', 'runOptions'],
      [null, 'runOptions'],
      [[1, 1, 1, 1], 'runOptions'],
      [{ density: 1, health: 1, damage: 1 }, 'runOptions.speed'],
      [{ density: 0.99, health: 1, damage: 1, speed: 1 }, 'runOptions.density'],
      [{ density: 1, health: 3.01, damage: 1, speed: 1 }, 'runOptions.health'],
      [{ density: 1, health: 1, damage: '1', speed: 1 }, 'runOptions.damage'],
      [{ density: 1, health: 1, damage: 1, speed: Number.POSITIVE_INFINITY }, 'runOptions.speed'],
    ];
    for (const [runOptions, field] of bad) {
      expect(parseRunSubmission({ ...base, runOptions }), field).toMatchObject({ ok: false, field });
    }
  });
});

describe('score', () => {
  const stats: RunSubmission['stats'] = { kills: 1000, elites: 10, bosses: 2, metins: 5, level: 21, yeop: 1234 };
  it('is the documented formula', () => {
    // 1000*10 + 10*100 + 2*1500 + 5*600 + 20*120 + floor(1234/10) + 600*5
    const expected = 10_000 + 1_000 + 3_000 + 3_000 + 2_400 + 123 + 3_000;
    expect(computeScore(stats, { victory: false, duration: 600, difficulty: 'normal' })).toBe(expected);
    expect(computeScore(stats, { victory: true, duration: 600, difficulty: 'normal' })).toBe(expected + 25_000);
    expect(computeScore(stats, { victory: false, duration: 600, difficulty: 'hard' })).toBe(Math.round(expected * 1.5));
  });
});

describe('leaderboard query', () => {
  const q = (s: string) => parseLeaderboardQuery(new URLSearchParams(s));
  it('applies defaults', () => {
    expect(q('zone=yeonmu')).toEqual({ ok: true, value: { mode: 'solo', zone: 'yeonmu', difficulty: 'normal', class: 'all', period: 'all', limit: 25 } });
    expect(q('zone=yeonmu&mode=coop')).toMatchObject({ ok: true, value: { mode: 'coop' } });
  });
  it('rejects bad values', () => {
    for (const s of ['', 'zone=x', 'zone=yeonmu&difficulty=x', 'zone=yeonmu&class=mage', 'zone=yeonmu&period=month', 'zone=yeonmu&limit=0', 'zone=yeonmu&limit=101', 'zone=yeonmu&limit=abc', 'zone=yeonmu&mode=duo']) {
      expect(q(s).ok, s).toBe(false);
    }
  });
  it('accepts the day board next to the client-visible periods, which stay all|week (DLY-01)', () => {
    expect([...LEADERBOARD_PERIODS]).toEqual(['all', 'week']);
    expect(DAILY_PERIOD).toBe('day');
    expect((LEADERBOARD_PERIODS as readonly string[]).includes(DAILY_PERIOD)).toBe(false);
    expect(q('zone=seori&period=day')).toMatchObject({ ok: true, value: { period: 'day', zone: 'seori' } });
    for (const s of ['zone=seori&period=Day', 'zone=seori&period=days', 'zone=seori&period=daily']) expect(q(s).ok, s).toBe(false);
    const qs = leaderboardQueryString({ zone: 'seori', period: 'day' });
    expect(qs).toBe('zone=seori&period=day');
    expect(q(qs)).toMatchObject({ ok: true, value: { period: 'day' } });
  });
});

describe('leaderboard query string', () => {
  it('round-trips through the parser', () => {
    const qs = leaderboardQueryString({ zone: 'seori', mode: 'coop', difficulty: 'hard', class: 'yacha', period: 'week', limit: 10 });
    expect(qs).toBe('zone=seori&mode=coop&difficulty=hard&class=yacha&period=week&limit=10');
    expect(parseLeaderboardQuery(new URLSearchParams(qs))).toEqual({
      ok: true,
      value: { mode: 'coop', zone: 'seori', difficulty: 'hard', class: 'yacha', period: 'week', limit: 10 },
    });
  });
});

describe('codes and revisions', () => {
  it('normalises and validates codes', () => {
    expect(normalizeCode(' abcd-efgh ')).toBe('ABCDEFGH');
    expect(isTransferCode('ABCDEFGH')).toBe(true);
    expect(isTransferCode('ABCDEFG0')).toBe(false);
    expect(isRoomCode('ABC234')).toBe(true);
    expect(isRoomCode('ABC23')).toBe(false);
  });
  it('parses ETag / If-Match values', () => {
    expect(parseRev('"7"')).toBe(7);
    expect(parseRev('7')).toBe(7);
    expect(parseRev('W/"12"')).toBe(12);
    expect(parseRev('abc')).toBeNull();
    expect(parseRev(null)).toBeNull();
  });
});

describe('co-op message guards', () => {
  const loadout = { classId: 'ninja', doctrine: 'b', sex: 'f', empire: 'jihae', tier: 2, look: [1, 2, 3] };
  const parse = (m: unknown) => parseClientMessage(JSON.stringify(m));

  it('parses every client message type', () => {
    expect(parse({ t: 'join', loadout, ready: true })).toMatchObject({ ok: true, value: { t: 'join', ready: true } });
    expect(parse({ t: 'leave' })).toMatchObject({ ok: true });
    expect(parse({ t: 'start', zone: 'seori', difficulty: 'hard', seed: 7 })).toMatchObject({ ok: true });
    expect(parse({ t: 'end', victory: true })).toMatchObject({ ok: true });
    expect(parse({ t: 'input', seq: 1, tick: 2, mx: -127, mz: 127, aim: 255, btn: 3 })).toMatchObject({ ok: true });
    expect(parse({ t: 'event', k: 'levelUp', tick: 9, to: 2, d: { a: [1, 2] } })).toMatchObject({ ok: true });
    expect(parse({ t: 'pick', id: 4, index: 2 })).toMatchObject({ ok: true });
    expect(parse({ t: 'pause', reason: 'modal' })).toMatchObject({ ok: true });
    expect(parse({ t: 'resume' })).toMatchObject({ ok: true });
    expect(parse({ t: 'ping', ts: 12.5 })).toMatchObject({ ok: true });
  });
  it('rejects malformed messages', () => {
    const bad: unknown[] = [
      { t: 'nope' },
      { t: 'join', loadout: { ...loadout, classId: 'mage' } },
      { t: 'join', loadout: { ...loadout, tier: 9 } },
      { t: 'join', loadout: { ...loadout, look: new Array(9).fill(1) } },
      { t: 'start', zone: 'x', difficulty: 'hard', seed: 1 },
      { t: 'input', seq: 1, tick: 1, mx: 128, mz: 0 },
      { t: 'input', seq: 1, tick: 1, mx: 0.5, mz: 0 },
      { t: 'event', k: 'Bad Kind' },
      { t: 'event', k: 'ok', to: 4 },
      { t: 'pick', id: 1, index: 99 },
      { t: 'ping', ts: 'now' },
      [],
      'str',
    ];
    for (const m of bad) expect(parse(m).ok, JSON.stringify(m)).toBe(false);
    expect(parseClientMessage('{not json').ok).toBe(false);
  });
  it('enforces per-type size caps', () => {
    const big = { t: 'input', seq: 1, tick: 1, mx: 0, mz: 0, pad: 'x'.repeat(COOP_LIMITS.inputBytes) };
    expect(parse(big)).toMatchObject({ ok: false, reason: 'too large' });
    expect(parse({ t: 'event', k: 'ok', d: 'x'.repeat(COOP_LIMITS.eventBytes) })).toMatchObject({ ok: false });
    expect(parse({ t: 'event', k: 'ok', d: 'x'.repeat(1000) })).toMatchObject({ ok: true });
  });
  it('server guard accepts our messages and rejects junk', () => {
    expect(parseServerMessage('{"t":"pong","st":1}').ok).toBe(true);
    expect(parseServerMessage('{"t":"roomState","room":"ABC234","host":0,"players":[]}').ok).toBe(true);
    expect(parseServerMessage('{"t":"roomState","host":9}').ok).toBe(false);
    expect(parseServerMessage('{"t":"wat"}').ok).toBe(false);
    expect(parseServerMessage('nope').ok).toBe(false);
  });
});

describe('binary snapshot header', () => {
  it('round-trips and lays out little-endian at fixed offsets', () => {
    const header = { flags: SnapshotFlags.keyframe | SnapshotFlags.paused, seq: 0xdeadbeef, tick: 123456, epoch: 7, baseDelta: 0 };
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const frame = encodeSnapshot(header, payload);
    expect(frame.byteLength).toBe(SNAPSHOT_HEADER_BYTES + 5);
    const v = new DataView(frame);
    expect(v.getUint8(0)).toBe(1);
    expect(v.getUint8(1)).toBe(1);
    expect(v.getUint16(2, true)).toBe(5);
    expect(v.getUint32(4, true)).toBe(0xdeadbeef);
    expect(v.getUint32(8, true)).toBe(123456);
    expect(v.getUint16(12, true)).toBe(7);
    expect(readSnapshotHeader(frame)).toEqual(header);
    expect([...snapshotPayload(frame)]).toEqual([1, 2, 3, 4, 5]);
  });
  it('rejects short or foreign frames', () => {
    expect(readSnapshotHeader(new ArrayBuffer(8))).toBeNull();
    const wrong = new Uint8Array(16);
    wrong[0] = 9;
    expect(readSnapshotHeader(wrong)).toBeNull();
  });
  it('quantises within half a step', () => {
    for (const v of [-512, -0.3, 0, 17.77, 511.9]) {
      const q = quantize(v, -512, 512, 16);
      expect(Math.abs(dequantize(q, -512, 512, 16) - v)).toBeLessThanOrEqual(1024 / 65535 / 2 + 1e-9);
    }
    expect(quantize(9999, 0, 1, 8)).toBe(255);
    expect(quantize(-9, 0, 1, 8)).toBe(0);
  });
});

/** The specs the client and the Worker must keep producing across releases (the hash is fixed: no re-rolls of past days). */
const GOLDEN: Record<number, unknown> = {
  0: { day: 0, zone: 'yeonmu', classId: 'wolfman', doctrine: 'b', empire: 'jihae', difficulty: 'normal', runOptions: { density: 1, health: 1.25, damage: 1.25, speed: 1 }, seed: 4020737602 },
  1: { day: 1, zone: 'seori', classId: 'yacha', doctrine: 'b', empire: 'jihae', difficulty: 'normal', runOptions: { density: 1.5, health: 1.5, damage: 1, speed: 1.5 }, seed: 1402982265 },
  19_000: { day: 19_000, zone: 'daeryeol', classId: 'shaman', doctrine: 'a', empire: 'jihae', difficulty: 'normal', runOptions: { density: 1.25, health: 1.25, damage: 1.5, speed: 1 }, seed: 3331473946 },
  20_500: { day: 20_500, zone: 'suryeon', classId: 'wolfman', doctrine: 'a', empire: 'saehwa', difficulty: 'normal', runOptions: { density: 1.5, health: 1.25, damage: 1, speed: 1 }, seed: 3851336535 },
  // 2026-10-29 / 30 / 31 (UTC)
  20_755: { day: 20_755, zone: 'daeryeol', classId: 'ninja', doctrine: 'b', empire: 'chowon', difficulty: 'normal', runOptions: { density: 1.25, health: 1.25, damage: 1.25, speed: 1 }, seed: 2635468513 },
  20_756: { day: 20_756, zone: 'daeryeol', classId: 'warrior', doctrine: 'a', empire: 'saehwa', difficulty: 'normal', runOptions: { density: 1.5, health: 1, damage: 1.25, speed: 1.25 }, seed: 88143147 },
  20_757: { day: 20_757, zone: 'suryeon', classId: 'ninja', doctrine: 'a', empire: 'jihae', difficulty: 'normal', runOptions: { density: 1.25, health: 1.25, damage: 1.5, speed: 1.5 }, seed: 3097144477 },
  999_999: { day: 999_999, zone: 'suryeon', classId: 'yacha', doctrine: 'b', empire: 'saehwa', difficulty: 'normal', runOptions: { density: 1, health: 1, damage: 1.25, speed: 1.25 }, seed: 304198395 },
};

describe('daily challenge spec (DLY-01)', () => {
  const DAYS = Array.from({ length: 3000 }, (_, i) => 19_000 + i);
  const specs = DAYS.map((d) => dailySpec(d));

  it('dayIndex is the UTC day number', () => {
    expect(dayIndex(0)).toBe(0);
    expect(dayIndex(DAY_MS - 1)).toBe(0);
    expect(dayIndex(DAY_MS)).toBe(1);
    const noon = Date.UTC(2026, 9, 30, 12);
    const day = dayIndex(noon);
    expect(dayIndex(Date.UTC(2026, 9, 30, 0, 0, 0))).toBe(day);
    expect(dayIndex(Date.UTC(2026, 9, 30, 23, 59, 59, 999))).toBe(day);
    expect(dayIndex(Date.UTC(2026, 9, 31, 0, 0, 0))).toBe(day + 1);
    expect(dayStartMs(day)).toBe(Date.UTC(2026, 9, 30));
    expect(dayStartMs(day) <= noon && noon < dayStartMs(day + 1)).toBe(true);
  });

  it('is deterministic: the same day gives the same spec, and Math.random is never consulted', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be used');
    });
    try {
      for (const d of [0, 1, 19_000, 20_391, 999_999]) {
        const a = JSON.stringify(dailySpec(d));
        expect(JSON.stringify(dailySpec(d)), String(d)).toBe(a);
        // the defaults are the canonical lists the Worker passes
        expect(JSON.stringify(dailySpec(d, ZONE_IDS, CLASS_IDS)), String(d)).toBe(a);
      }
    } finally {
      random.mockRestore();
    }
    expect(specs.map((s) => s.day)).toEqual(DAYS);
  });

  it('emits valid ids and Run Options only', () => {
    for (const s of specs) {
      expect(ZONE_IDS).toContain(s.zone);
      expect(CLASS_IDS).toContain(s.classId);
      expect(DOCTRINE_KEYS).toContain(s.doctrine);
      expect(EMPIRE_IDS).toContain(s.empire);
      expect(s.difficulty).toBe('normal');
      expect(Number.isInteger(s.seed) && s.seed >= 0 && s.seed <= 0xffffffff).toBe(true);
      expect(Object.keys(s.runOptions).sort()).toEqual([...RUN_OPTION_KEYS].sort());
      for (const k of RUN_OPTION_KEYS) expect(DAILY_RUN_OPTION_STEPS as readonly number[]).toContain(s.runOptions[k]);
      expect(dailyReward(s.runOptions)).toBeLessThanOrEqual(DAILY_REWARD_MAX);
    }
    // what a client builds from a spec passes the submission guard
    const s = dailySpec(20_391);
    const run = parseRunSubmission(runBody({ zone: s.zone, classId: s.classId, doctrine: s.doctrine, empire: s.empire, seed: s.seed, daily: s.day, runOptions: { ...s.runOptions } }));
    expect(run.ok).toBe(true);
  });

  it('spreads over zones, classes, doctrines, empires and the three Run Option steps', () => {
    const share = <T>(pick: (s: (typeof specs)[number]) => T, value: T): number => specs.filter((s) => pick(s) === value).length / specs.length;
    for (const z of ZONE_IDS) expect(share((s) => s.zone, z), z).toBeGreaterThan(0.18);
    for (const c of CLASS_IDS) expect(share((s) => s.classId, c), c).toBeGreaterThan(0.13);
    for (const d of DOCTRINE_KEYS) expect(share((s) => s.doctrine, d), d).toBeGreaterThan(0.4);
    for (const e of EMPIRE_IDS) expect(share((s) => s.empire, e), e).toBeGreaterThan(0.27);
    for (const k of RUN_OPTION_KEYS) for (const step of DAILY_RUN_OPTION_STEPS) expect(share((s) => s.runOptions[k], step), `${k} ${step}`).toBeGreaterThan(0.27);
    // neighbouring days are not the same day over again, and seeds rarely repeat
    expect(new Set(specs.map((s) => s.seed)).size).toBeGreaterThan(specs.length - 3);
    expect(new Set(specs.slice(0, 365).map((s) => JSON.stringify(s))).size).toBe(365);
  });

  it("keeps the total reward of the sliders at 1.5 or less and mirrors the game's Run Options table", () => {
    const top = { density: 1.5, health: 1.5, damage: 1.5, speed: 1.5 };
    expect(dailyReward(top)).toBeLessThanOrEqual(DAILY_REWARD_MAX);
    expect(dailyReward({ density: 1, health: 1, damage: 1, speed: 1 })).toBe(1);
    // balance.json runOptions is the game's truth; the constants here must not drift from it (the Worker has no balance.json)
    for (const k of RUN_OPTION_KEYS) {
      const row = balance.runOptions[k];
      expect(DAILY_REWARD_WEIGHTS[k], k).toBe(row.rewardWeight);
      expect(RUN_OPTION_MIN, k).toBe(row.min);
      expect(RUN_OPTION_MAX, k).toBe(row.max);
      for (const step of DAILY_RUN_OPTION_STEPS) expect(((step - row.min) / row.step) % 1, `${k} ${step} on the slider grid`).toBe(0);
    }
    expect(balance.runOptions.rewardMax).toBeGreaterThanOrEqual(DAILY_REWARD_MAX);
  });

  it('honours the zone / class lists it is given and ignores unknown ids', () => {
    for (const d of DAYS.slice(0, 200)) {
      const s = dailySpec(d, ['seori'], ['wolfman']);
      expect([s.zone, s.classId]).toEqual(['seori', 'wolfman']);
      const sub = dailySpec(d, ['yeonmu', 'seori'], ['ninja', 'yacha', 'shaman']);
      expect(['yeonmu', 'seori']).toContain(sub.zone);
      expect(['ninja', 'yacha', 'shaman']).toContain(sub.classId);
      // the rest of the spec does not depend on the lists
      expect(sub.seed).toBe(dailySpec(d).seed);
      expect(sub.runOptions).toEqual(dailySpec(d).runOptions);
      // unknown ids are dropped; an empty result falls back to the canonical lists
      const junk = dailySpec(d, ['atlantis', 'seori'] as never, ['mage'] as never);
      expect(junk.zone).toBe('seori');
      expect(CLASS_IDS).toContain(junk.classId);
      expect(dailySpec(d, [] as never, [] as never)).toEqual(dailySpec(d));
    }
  });

  it('does not depend on the order of the lists it is given', () => {
    const zonesBack = [...ZONE_IDS].reverse();
    const classesBack = [...CLASS_IDS].reverse();
    // the same ids in the reverse order are the same day, for every day (a client must never get another zone / class than the Worker)
    for (const d of DAYS) expect(dailySpec(d, zonesBack, classesBack), String(d)).toEqual(specs[d - DAYS[0]!]);
    // the pinned specs hold whichever way the lists are written
    for (const [day, expected] of Object.entries(GOLDEN)) expect(dailySpec(Number(day), zonesBack, classesBack), day).toEqual(expected);
    // a subset is a set: its order (and repeats) change nothing
    for (const d of DAYS.slice(0, 365)) {
      expect(dailySpec(d, ['seori', 'yeonmu'], ['yacha', 'ninja', 'yacha']), String(d)).toEqual(dailySpec(d, ['yeonmu', 'seori'], ['ninja', 'yacha']));
    }
    // the defaults ARE the canonical lists: a submission is validated against them
    for (const d of DAYS.slice(0, 365)) expect(dailySpec(d)).toEqual(dailySpec(d, ZONE_IDS, CLASS_IDS));
  });

  it('pins known specs (client and Worker must agree across releases)', () => {
    expect(Object.keys(GOLDEN).length).toBeGreaterThanOrEqual(5);
    for (const [day, expected] of Object.entries(GOLDEN)) expect(dailySpec(Number(day)), day).toEqual(expected);
    // 2026-10-30 (UTC) is day 20,756
    expect(dayIndex(Date.UTC(2026, 9, 30, 12))).toBe(20_756);
  });

  describe('dailyMismatch', () => {
    const now = Date.UTC(2026, 9, 30, 12);
    const day = dayIndex(now);
    const follow = (d = day) => {
      const s = dailySpec(d);
      return { daily: d, zone: s.zone, classId: s.classId, doctrine: s.doctrine, empire: s.empire, difficulty: s.difficulty, seed: s.seed, runOptions: { ...s.runOptions } };
    };
    it('passes a run that follows the spec, and ignores runs without a daily', () => {
      expect(dailyMismatch(follow(), now)).toBeNull();
      expect(dailyMismatch(follow(day - 1), now)).toBeNull();
      expect(dailyMismatch({ ...follow(), daily: undefined, zone: 'yeonmu' } as never, now)).toBeNull();
    });
    it('names the first departure', () => {
      const s = dailySpec(day);
      const step = (v: number) => (v === 1.5 ? 1.25 : 1.5);
      const cases: [Record<string, unknown>, string, string][] = [
        [{ coop: 2 }, 'coop', 'solo_only'],
        [{ daily: day - 2 }, 'daily', 'out_of_window'],
        [{ daily: day + 1 }, 'daily', 'out_of_window'],
        [{ zone: ZONE_IDS.find((z) => z !== s.zone) }, 'zone', 'differs'],
        [{ classId: CLASS_IDS.find((c) => c !== s.classId) }, 'classId', 'differs'],
        [{ doctrine: undefined }, 'doctrine', 'missing'],
        [{ doctrine: s.doctrine === 'a' ? 'b' : 'a' }, 'doctrine', 'differs'],
        [{ empire: undefined }, 'empire', 'missing'],
        [{ empire: EMPIRE_IDS.find((e) => e !== s.empire) }, 'empire', 'differs'],
        [{ difficulty: 'hard' }, 'difficulty', 'differs'],
        [{ seed: s.seed + 1 }, 'seed', 'differs'],
        [{ runOptions: undefined }, 'runOptions', 'missing'],
        [{ runOptions: { ...s.runOptions, speed: step(s.runOptions.speed) } }, 'runOptions.speed', 'differs'],
        [{ runOptions: { ...s.runOptions, density: step(s.runOptions.density) } }, 'runOptions.density', 'differs'],
      ];
      for (const [over, field, reason] of cases) {
        expect(dailyMismatch({ ...follow(), ...over } as never, now), JSON.stringify(over)).toEqual({ field, reason });
      }
    });
    it('opens the window at UTC midnight', () => {
      const midnight = dayStartMs(day + 1);
      expect(dailyMismatch(follow(day), midnight - 1)).toBeNull();
      expect(dailyMismatch(follow(day - 1), midnight - 1)).toBeNull();
      expect(dailyMismatch(follow(day - 1), midnight)).toEqual({ field: 'daily', reason: 'out_of_window' });
      expect(dailyMismatch(follow(day), midnight)).toBeNull();
      expect(dailyMismatch(follow(day + 1), midnight)).toBeNull();
    });
  });
});
