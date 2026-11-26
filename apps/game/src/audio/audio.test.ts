// Audio runtime tests: sound-id resolution, rules, event routing, voice pool limits, pitch ladder, music switching.
// A tiny fake WebAudio graph stands in for the browser (node environment).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioAsset } from '../data/assetManifest';
import type { SimEvent } from '../sim/events';
import { RUN_EVENT_ANNOUNCE, RUN_EVENT_HEARTBEAT, RUN_EVENT_REFRESH_GRACE, runEventKindDef } from '../sim/runEvents';
import type { World } from '../sim/world';
import { EV_ANNOUNCE_S, EV_STALE_S, SimAudioAdapter } from './adapter';
import { AMB_COMBAT_DB, AMB_FADE_IN_S, AMB_FADE_OUT_S, AMB_MUFFLE_HZ, AMB_OPEN_HZ, AUDIO_RETRY_BASE_MS, AmbienceBed, AudioEngine, DUCK_DENSITY_MAX_DB, LIMITER } from './engine';
import { createAudio, loopRegion, ruleFor, SfxResolver } from './index';
import { MusicPlayer, SYNC_FADE_S, SYNC_LEAD_S, SYNC_RHO, syncFadeGains } from './music';
import { LoopBank, SfxPlayer } from './sfx';

// ---- fake WebAudio ---------------------------------------------------------------------------------------------------
class Param {
  /** the value after the automation the tests schedule (every call below lands at once) */
  private cur: number;
  /**
   * What the node outputs before its first automation event takes effect: WebAudio's `value` attribute, which a fresh GainNode
   * has at 1 and only a direct `param.value = x` assignment changes (automation calls do not touch it).
   */
  intrinsic: number;
  /** linearRampToValueAtTime(value, time) calls, in order (fades) */
  ramps: [number, number][] = [];
  /** setTargetAtTime(value, time, timeConstant) calls, in order (ducks) */
  targets: [number, number, number][] = [];
  constructor(initial = 0, intrinsic = initial) {
    this.cur = initial;
    this.intrinsic = intrinsic;
  }
  get value(): number {
    return this.cur;
  }
  set value(v: number) {
    this.cur = v;
    this.intrinsic = v;
  }
  setTargetAtTime(v: number, t = 0, tc = 0): void {
    this.cur = v;
    this.targets.push([v, t, tc]);
  }
  setValueAtTime(v: number): void {
    this.cur = v;
  }
  linearRampToValueAtTime(v: number, t = 0): void {
    this.cur = v;
    this.ramps.push([v, t]);
  }
  cancelScheduledValues(): void {}
}
class FakeNode {
  /** nodes this one was connected to (the bus graph) */
  outputs: unknown[] = [];
  connect<T>(n: T): T {
    this.outputs.push(n);
    return n;
  }
  disconnect(): void {}
}
class FakeGain extends FakeNode {
  /** a fresh GainNode outputs its input at gain 1 until an event or an assignment says otherwise (reads as 0 until something is scheduled) */
  gain = new Param(0, 1);
}
class FakeSource extends FakeNode {
  buffer: { name: string; duration: number } | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  playbackRate = new Param();
  onended: (() => void) | null = null;
  startedAt = -1;
  startOffset = 0;
  /** the intrinsic gain of the GainNode this source feeds, when start() ran: the gain its first sample passes at (null = not into a gain) */
  gainAtStart: number | null = null;
  stopped = false;
  stopAt = -1;
  start(t: number, offset = 0): void {
    this.startedAt = t;
    this.startOffset = offset;
    const out = this.outputs[0];
    this.gainAtStart = out instanceof FakeGain ? out.gain.intrinsic : null;
  }
  stop(t = 0): void {
    this.stopped = true;
    this.stopAt = t;
  }
}
class FakeFilter extends FakeNode {
  type = '';
  frequency = new Param();
  Q = new Param();
}
class FakeComp extends FakeNode {
  threshold = new Param();
  knee = new Param();
  ratio = new Param();
  attack = new Param();
  release = new Param();
}
class FakePanner extends FakeNode {
  pan = new Param();
}
const sources: FakeSource[] = [];
class FakeCtx {
  currentTime = 0;
  state = 'running';
  destination = new FakeNode();
  gains: FakeGain[] = [];
  createGain = (): FakeGain => {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  };
  createBufferSource = (): FakeSource => {
    const s = new FakeSource();
    sources.push(s);
    return s;
  };
  createStereoPanner = (): FakePanner => new FakePanner();
  createBiquadFilter = (): FakeFilter => new FakeFilter();
  createDynamicsCompressor = (): FakeComp => new FakeComp();
  /** decodes what the stubbed fetch returned: the bytes are the url, the buffer is named after it */
  decodeAudioData = async (b: ArrayBuffer): Promise<AudioBuffer> => fakeBuffer(new TextDecoder().decode(b), 100);
  addEventListener(): void {}
  resume = (): Promise<void> => Promise.resolve();
  suspend = (): Promise<void> => Promise.resolve();
  close = (): Promise<void> => Promise.resolve();
}

const fakeBuffer = (name: string, duration = 1): AudioBuffer => ({ name, duration }) as unknown as AudioBuffer;
const asset = (id: string, over: Partial<AudioAsset> = {}): AudioAsset => ({ id, url: `assets/audio/${id}.mp3`, kind: 'sfx', duration: 0.5, bytes: 1, gain: 1, ...over });

function makeManifest(): Record<string, AudioAsset> {
  const m: Record<string, AudioAsset> = {};
  const sfxIds = [
    'sfx_hit_flesh', 'sfx_hit_flesh_heavy', 'sfx_crit', 'sfx_death_animal', 'sfx_death_orc', 'sfx_death_generic', 'sfx_death_golem',
    'sfx_player_hurt_m', 'sfx_player_hurt_f', 'sfx_player_death_m', 'sfx_level_up', 'sfx_ui_click', 'sfx_metin_warning',
    'sfx_metin_impact', 'sfx_metin_shatter', 'sfx_boss_spawn', 'sfx_boss_death', 'sfx_enemy_swipe', 'sfx_ground_slam', 'sfx_yeop_pickup',
  ];
  for (const id of sfxIds) m[id] = asset(id);
  m['sfx_metin_pulse'] = asset('sfx_metin_pulse', { kind: 'ambience', loop: true, loopStart: 0, loopEnd: 2.4, duration: 2.4 });
  for (let i = 1; i <= 8; i++) m[`sfx_xp_pickup_0${i}`] = asset(`sfx_xp_pickup_0${i}`);
  m['sfx_ui_click'] = asset('sfx_ui_click_01', { id: 'sfx_ui_click', variants: ['assets/audio/sfx_ui_click_01.mp3', 'assets/audio/sfx_ui_click_02.mp3'] });
  for (const id of ['mus_menu', 'mus_yeonmu', 'mus_boss']) m[id] = asset(id, { kind: 'music', loop: true, duration: 100, loopStart: 0, loopEnd: 100 });
  for (const id of ['mus_victory', 'mus_defeat']) m[id] = asset(id, { kind: 'stinger', duration: 8 });
  const yeonmu = m['mus_yeonmu'];
  const boss = m['mus_boss'];
  if (!yeonmu || !boss) throw new Error('fixture');
  m['mus_yeonmu_calm'] = { ...yeonmu, id: 'mus_yeonmu_calm' };
  m['mus_yeonmu_combat'] = { ...yeonmu, id: 'mus_yeonmu_combat' };
  m['mus_yeonmu_boss'] = { ...boss, id: 'mus_yeonmu_boss' };
  return m;
}

const world = {
  players: [{ x: 0, z: 0, sex: 'm' }],
  typeDefs: [
    { id: 'wolf', race: ['animal'], rank: 'pawn', sfx: { death: 'sfx_death_wolf', attack: 'sfx_bite' } },
    { id: 'orc', race: ['orc'], rank: 'knight', sfx: {} },
    { id: 'golem', race: ['metin'], rank: 'pawn', sfx: { death: 'sfx_death_zzz' } },
    { id: 'boss', race: ['animal'], rank: 'boss', sfx: { attack: 'sfx_tiger_roar' } },
  ],
  zone: { id: 'yeonmu', music: { calm: 'mus_yeonmu_calm', combat: 'mus_yeonmu_combat', boss: 'mus_yeonmu_boss' } },
  ix: { bosses: new Map() },
} as unknown as World;

const ev = (e: Record<string, unknown>): SimEvent => e as unknown as SimEvent;
const damage = (crit = false, boss = false): SimEvent =>
  ev({ t: 'damage', x: 2, z: 1, amount: 3, crit, element: 0, targetId: 1, player: 0, skill: 0, killed: false, dot: false, boss });

/** the zone beds a build ships (AG-01): 48 s mono loops, kind 'ambience' */
function addBeds(m: Record<string, AudioAsset>, ids = ['amb_yeonmu', 'amb_seori']): Record<string, AudioAsset> {
  for (const id of ids) m[id] = asset(id, { kind: 'ambience', loop: true, loopStart: 0, loopEnd: 48, duration: 48 });
  return m;
}

function harness(opts: { beds?: boolean; undecoded?: string[]; manifest?: Record<string, AudioAsset> } = {}) {
  sources.length = 0;
  (globalThis as { AudioContext?: unknown }).AudioContext = FakeCtx;
  const manifest = opts.manifest ?? (opts.beds ? addBeds(makeManifest()) : makeManifest());
  const engine = new AudioEngine((p) => p, { autoUnlock: false });
  engine.unlock();
  const ctx = engine.ctx as unknown as FakeCtx;
  const skip = new Set((opts.undecoded ?? []).map((id) => manifest[id]?.url));
  for (const a of Object.values(manifest)) {
    if (skip.has(a.url)) continue; // not decoded: engine.load() goes to the (stubbed) fetch
    engine.inject(a.url, fakeBuffer(a.url, a.kind === 'ambience' ? a.duration : 1)); // a loop is as long as its manifest entry says
    for (const v of a.variants ?? []) engine.inject(v, fakeBuffer(v));
  }
  const music = new MusicPlayer(engine, manifest);
  const sfx = new SfxPlayer(engine, manifest);
  const loops = new LoopBank(engine, manifest);
  const resolver = new SfxResolver((id) => id in manifest);
  const ambience = new AmbienceBed(engine, manifest);
  const adapter = new SimAudioAdapter({ engine, sfx, loops, music, resolver, manifest, ambience });
  const names = (): string[] => sources.filter((s) => s.startedAt >= 0 && s.buffer).map((s) => (s.buffer?.name ?? '').replace('assets/audio/', '').replace('.mp3', ''));
  const nodes = (): { bus: FakeGain; filter: FakeFilter; sfxBus: FakeGain } => ({ bus: engine.ambienceBus as unknown as FakeGain, filter: engine.ambienceFilter as unknown as FakeFilter, sfxBus: engine.sfxBus as unknown as FakeGain });
  return {
    manifest, engine, music, sfx, loops, adapter, ambience, nodes,
    /** started sources playing a bed / the zone music */
    bedSources: (): FakeSource[] => sources.filter((s) => s.startedAt >= 0 && (s.buffer?.name ?? '').includes('amb_')),
    musicSources: (): FakeSource[] => sources.filter((s) => s.startedAt >= 0 && (s.buffer?.name ?? '').includes('mus_yeonmu')),
    advance: (dt: number): void => {
      ctx.currentTime += dt;
    },
    played: (name: string): number => names().filter((n) => n === name).length,
    sequence: names,
    /** engine.load() of an injected buffer resolves through microtasks only */
    flush: async (): Promise<void> => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    },
  };
}

// ---- tests -----------------------------------------------------------------------------------------------------------
describe('SfxResolver', () => {
  const have = new Set(['sfx_death_animal', 'sfx_death_orc', 'sfx_death_generic', 'sfx_hit_flesh', 'sfx_hit_armor', 'sfx_hit_flesh_heavy', 'sfx_metin_warning', 'sfx_enemy_bite', 'sfx_ground_slam', 'sfx_lightning_cast', 'sfx_fire_cast', 'sfx_sword_swing_light']);
  const unknown: string[] = [];
  const r = new SfxResolver((id) => have.has(id), (id) => unknown.push(id));

  it('exact ids pass through, aliases map', () => {
    expect(r.resolve('sfx_hit_flesh')).toBe('sfx_hit_flesh');
    expect(r.resolve('sfx_metin_warn')).toBe('sfx_metin_warning');
  });
  it('deaths by race keyword', () => {
    expect(r.resolve('sfx_death_wolf_alpha')).toBe('sfx_death_animal');
    expect(r.resolve('sfx_death_orc_chief')).toBe('sfx_death_orc');
    expect(r.resolve('sfx_death_mystery')).toBe('sfx_death_generic');
  });
  it('hits and skills by keyword', () => {
    expect(r.resolve('sfx_hit_scale')).toBe('sfx_hit_armor');
    expect(r.resolve('sfx_chain_lightning')).toBe('sfx_lightning_cast');
    expect(r.resolve('sfx_sword_arc')).toBe('sfx_sword_swing_light');
    expect(r.resolve('sfx_bite')).toBe('sfx_enemy_bite');
  });
  it('unknown ids are null and reported once', () => {
    expect(r.resolve('sfx_totally_unknown_thing')).toBeNull();
    expect(r.resolve('sfx_totally_unknown_thing')).toBeNull();
    expect(unknown).toEqual(['sfx_totally_unknown_thing']);
  });
});

describe('rules and loop regions', () => {
  it('UI sounds are flat, hits are capped, big moments duck the music', () => {
    expect(ruleFor('sfx_ui_click').falloff).toBe(0);
    expect(ruleFor('sfx_hit_flesh').max).toBeLessThanOrEqual(4);
    expect(ruleFor('sfx_level_up').duck).toBeDefined();
    expect(ruleFor('sfx_boss_roar').prio).toBeGreaterThanOrEqual(8);
  });
  const a = asset('m', { duration: 100, loopStart: 0, loopEnd: 100, kind: 'music' });
  it('gapless decode loops the whole buffer; an un-trimmed MP3 delay is skipped', () => {
    expect(loopRegion(fakeBuffer('x', 100), a)).toEqual({ start: 0, end: 100 });
    const r = loopRegion(fakeBuffer('x', 100.0509), a);
    expect(r.start).toBeCloseTo(1105 / 44100, 6);
    expect(r.end - r.start).toBeCloseTo(100, 6);
  });
});

describe('runtime on a fake WebAudio graph', () => {
  beforeEach(() => {
    sources.length = 0;
  });
  afterEach(() => {
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
  });

  it('hit storms collapse by spacing/caps and crits stack on top', () => {
    const h = harness();
    for (let i = 0; i < 30; i++) h.adapter.handleEvent(damage(), world);
    expect(h.played('sfx_hit_flesh')).toBe(1);
    h.advance(0.05);
    h.adapter.handleEvent(damage(true), world);
    expect(h.played('sfx_crit')).toBe(1);
    h.advance(0.05);
    for (let i = 0; i < 8; i++) {
      h.adapter.handleEvent(damage(), world);
      h.advance(0.05);
    }
    expect(h.played('sfx_hit_flesh')).toBeLessThanOrEqual(9);
    expect(h.sfx.activeVoices).toBeLessThanOrEqual(40);
  });

  it('xp pickups climb the pitch ladder and the combo times out', () => {
    const h = harness();
    const pickup = ev({ t: 'pickup', player: 0, kind: 0, value: 1, x: 1, z: 1, tier: 0 });
    for (let i = 0; i < 10; i++) {
      h.adapter.handleEvent(pickup, world);
      h.advance(0.12);
    }
    const ladder = (n: number): string => `sfx_xp_pickup_0${n}`;
    expect(h.sequence().filter((n) => n.startsWith('sfx_xp_pickup'))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 8, 8].map(ladder));
    h.advance(1.2);
    h.adapter.handleEvent(pickup, world);
    expect(h.sequence().at(-1)).toBe('sfx_xp_pickup_01');
  });

  it('distance culling, deaths by race, metin loop lifecycle', () => {
    const h = harness();
    h.adapter.handleEvent(ev({ t: 'sfx', id: 'sfx_ground_slam', x: 500, z: 0, vol: 1 }), world);
    expect(h.played('sfx_ground_slam')).toBe(0);
    h.adapter.handleEvent(ev({ t: 'sfx', id: 'sfx_ground_slam', x: 5, z: 0, vol: 1 }), world);
    expect(h.played('sfx_ground_slam')).toBe(1);

    const death = (type: number): SimEvent => ev({ t: 'enemyDeath', id: 1, type, x: 1, z: 1, rot: 0, scale: 1, tier: 0, killer: 0, skill: 0, crit: false });
    h.adapter.handleEvent(death(0), world);
    h.advance(0.2);
    h.adapter.handleEvent(death(2), world);
    expect(h.played('sfx_death_animal')).toBe(1);
    expect(h.played('sfx_death_golem')).toBe(1); // 'sfx_death_zzz' → generic → race 'metin' → golem

    h.adapter.handleEvent(ev({ t: 'metinWarn', metin: 7, def: 'm', x: 4, z: 4, dur: 2, great: false }), world);
    h.adapter.handleEvent(ev({ t: 'metinImpact', metin: 7, def: 'm', x: 4, z: 4, radius: 5, great: false }), world);
    expect(h.played('sfx_metin_warning')).toBe(1);
    expect(h.played('sfx_metin_impact')).toBe(1);
    expect(h.loops.count).toBe(1);
    // a duplicate generic sfx for an event-driven sound is dropped
    h.adapter.handleEvent(ev({ t: 'sfx', id: 'sfx_metin_impact', x: 4, z: 4, vol: 1 }), world);
    expect(h.played('sfx_metin_impact')).toBe(1);
    h.adapter.handleEvent(ev({ t: 'metinBreak', metin: 7, def: 'm', x: 4, z: 4, great: false, awakened: false }), world);
    expect(h.loops.count).toBe(0);
  });

  it('player hurt follows the hero sex; boss attacks use the boss pattern sfx only', () => {
    const h = harness();
    h.adapter.handleEvent(ev({ t: 'playerHit', player: 0, amount: 4, result: 0, x: 0, z: 0, srcX: 1, srcZ: 1, element: 0, hp: 10 }), world);
    expect(h.played('sfx_player_hurt_m')).toBe(1);
    h.adapter.handleEvent(ev({ t: 'enemyAttack', enemy: 1, type: 3, kind: 0, x: 3, z: 0, dirX: 1, dirZ: 0 }), world);
    expect(h.played('sfx_enemy_swipe')).toBe(0);
    h.adapter.handleEvent(ev({ t: 'enemyAttack', enemy: 2, type: 1, kind: 0, x: 3, z: 0, dirX: 1, dirZ: 0 }), world);
    expect(h.played('sfx_enemy_swipe')).toBe(1);
  });

  it('run music: aliases of one file do not restart; boss crossfades; the stinger plays on runEnd', async () => {
    const h = harness();
    h.adapter.runStart(world);
    await h.flush();
    expect(h.music.currentUrl).toBe('assets/audio/mus_yeonmu.mp3');
    const decks = sources.filter((s) => s.loop && s.startedAt >= 0).length;
    h.adapter.update(world, 1);
    for (let i = 0; i < 40; i++) h.adapter.handleEvent(damage(), world);
    h.adapter.update(world, 0.016);
    await h.flush();
    expect(sources.filter((s) => s.loop && s.startedAt >= 0).length).toBe(decks); // calm→combat shares the file: no new deck
    h.adapter.handleEvent(ev({ t: 'bossSpawn', boss: 1, enemy: 1, bossId: 'b', x: 3, z: 3, final: false }), world);
    await h.flush();
    expect(h.music.currentUrl).toBe('assets/audio/mus_boss.mp3');
    h.adapter.handleEvent(ev({ t: 'runEnd', victory: true }), world);
    await h.flush();
    expect(h.played('mus_victory')).toBe(1);
  });

  it('createAudio: UI before unlock is silent, after unlock + decode it plays; volumes apply; dispose is clean', () => {
    sources.length = 0;
    (globalThis as { AudioContext?: unknown }).AudioContext = FakeCtx;
    const sub: { push: ((s: { masterVolume: number; musicVolume: number; sfxVolume: number }) => void) | null } = { push: null };
    const settings = {
      value: { masterVolume: 1, musicVolume: 0.5, sfxVolume: 0.5 },
      subscribe(fn: (s: { masterVolume: number; musicVolume: number; sfxVolume: number }) => void): () => void {
        sub.push = fn;
        return () => undefined;
      },
    };
    const audio = createAudio(makeManifest(), settings, { autoUnlock: false, preload: false, resolveUrl: (p) => p });
    audio.playUi('sfx_ui_click');
    expect(audio.stats.started).toBe(0);
    expect(audio.unlock()).toBe(true);
    expect(audio.unlocked).toBe(true);
    sub.push?.({ masterVolume: 0.2, musicVolume: 0.2, sfxVolume: 0.2 });
    audio.setVolumes({ music: 0.9 });
    audio.dispose();
  });
});

// ---- zone ambience bed (AR-01) -----------------------------------------------------------------------------------------
describe('zone ambience bed (amb_<zone>)', () => {
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  };
  const DB6 = Math.pow(10, AMB_COMBAT_DB / 20);
  const seori = { ...world, zone: { id: 'seori', music: { calm: 'mus_seori_calm', combat: 'mus_seori_combat', boss: 'mus_seori_boss' } } } as unknown as World;
  type H = ReturnType<typeof harness>;
  /** the gain node the latest bed source plays through: the one that feeds the ambience filter */
  const bedGain = (h: H): FakeGain => {
    const ctx = h.engine.ctx as unknown as FakeCtx;
    const feeding = ctx.gains.filter((g) => g.outputs.includes(h.engine.ambienceFilter));
    const g = feeding[feeding.length - 1];
    if (!g) throw new Error('no gain feeds the ambience filter');
    return g;
  };
  /** a fetch that answers only after `release()` (the bytes are the url: FakeCtx.decodeAudioData names the buffer after them) */
  const slowFetch = (): (() => void) => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    vi.stubGlobal('fetch', async (u: string) => {
      await held;
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode(u).buffer };
    });
    return release;
  };
  /** the manifest with a second zone (seori): both beds, both calm tracks */
  const twoZones = (): Record<string, AudioAsset> => {
    const m = addBeds(makeManifest(), ['amb_yeonmu', 'amb_seori']);
    m['mus_seori_calm'] = { ...(m['mus_yeonmu'] as AudioAsset), id: 'mus_seori_calm', url: 'assets/audio/mus_seori.mp3' };
    return m;
  };
  /** run start, music up, one frame: the bed has been handed over */
  const begin = async (h: H, w: World = world): Promise<void> => {
    h.adapter.runStart(w);
    await settle();
    h.adapter.update(w, 0.016);
    await settle();
  };

  beforeEach(() => {
    sources.length = 0;
  });
  afterEach(() => {
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
    vi.unstubAllGlobals();
  });

  it('starts after the zone music, loops, and enters through the ambience path under the SFX slider', async () => {
    // the zone track is still being fetched: the bed (decoded long ago) must wait for it
    const release = slowFetch();
    const h = harness({ beds: true, undecoded: ['mus_yeonmu'] });
    h.adapter.runStart(world);
    h.advance(1);
    h.adapter.update(world, 0.016);
    await settle();
    expect(h.musicSources()).toHaveLength(0);
    expect(h.bedSources()).toHaveLength(0); // no bed before the music
    expect(h.ambience.playing).toBe(false);

    release(); // the zone music arrives and starts
    await settle();
    expect(h.musicSources()).toHaveLength(1);
    expect(h.bedSources()).toHaveLength(0); // …the bed follows on the next frame, not in the same breath
    h.advance(2);
    h.adapter.update(world, 0.016);
    await settle();
    const [bed] = h.bedSources();
    const [music] = h.musicSources();
    expect(h.bedSources()).toHaveLength(1);
    expect(bed && music && sources.indexOf(bed) > sources.indexOf(music)).toBe(true);
    expect(music?.startedAt).toBe(1);
    expect(bed?.startedAt).toBe(3); // 2 s after the music
    expect(bed?.loop).toBe(true);
    expect(bed?.loopStart).toBe(0);
    expect(bed?.loopEnd).toBe(48);
    expect(bed?.startOffset).toBeGreaterThanOrEqual(0);
    expect(bed?.startOffset).toBeLessThan(48);
    expect(h.ambience.currentUrl).toBe('assets/audio/amb_yeonmu.mp3');
    // a second frame does not start a second source
    h.adapter.update(world, 0.016);
    await settle();
    expect(h.bedSources()).toHaveLength(1);

    // bus path: bed gain → ambience lowpass → ambience bus → SFX bus (so the SFX slider is the bed's volume)
    const { bus, filter, sfxBus } = h.nodes();
    expect(bedGain(h).outputs).toContain(filter);
    expect(filter.outputs).toContain(bus);
    expect(bus.outputs).toContain(sfxBus);
    expect(filter.type).toBe('lowpass');
    expect(filter.frequency.value).toBe(AMB_OPEN_HZ);
    expect(bus.gain.value).toBe(1);
    h.engine.setLevels({ sfx: 0.5 });
    expect(sfxBus.gain.value).toBeCloseTo(0.25, 6);
    h.engine.setLevels({ sfx: 0 });
    expect(sfxBus.gain.value).toBe(0);
    // fade in: 0 → the manifest gain over AMB_FADE_IN_S
    expect(bedGain(h).gain.ramps.at(-1)).toEqual([1, 3 + AMB_FADE_IN_S]);
  });

  it('a zone track that cannot be fetched does not keep the bed from starting', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) }));
    const h = harness({ beds: true, undecoded: ['mus_yeonmu'] });
    h.adapter.runStart(world);
    await settle();
    expect(h.musicSources()).toHaveLength(0);
    h.adapter.update(world, 0.016);
    await settle();
    expect(h.bedSources()).toHaveLength(1);
  });

  it('is 6 dB lower while combat heat is on (the music heat), back when it cools; a boss fight counts as combat', async () => {
    const h = harness({ beds: true });
    await begin(h);
    const { bus } = h.nodes();
    expect(h.bedSources()).toHaveLength(1);
    expect(bus.gain.value).toBe(1);
    expect(DB6).toBeCloseTo(0.501, 3);

    for (let i = 0; i < 40; i++) h.adapter.handleEvent(damage(), world);
    h.adapter.update(world, 0.016); // heat > 7: combat on…
    h.adapter.update(world, 0.016); // …and the bed follows on the next frame
    expect(bus.gain.value).toBeCloseTo(DB6, 6);
    h.adapter.update(world, 6);
    h.adapter.update(world, 6); // 40 * e^-3 ≈ 2: below the off threshold
    h.adapter.update(world, 0.016);
    expect(bus.gain.value).toBe(1);

    h.adapter.handleEvent(ev({ t: 'bossSpawn', boss: 1, enemy: 1, bossId: 'b', x: 3, z: 3, final: false }), world);
    h.adapter.update(world, 0.016);
    expect(bus.gain.value).toBeCloseTo(DB6, 6);
    h.adapter.handleEvent(ev({ t: 'bossDeath', boss: 1, enemy: 1, bossId: 'b', x: 3, z: 3 }), world);
    h.advance(3);
    h.adapter.update(world, 0.016);
    h.adapter.update(world, 0.016);
    expect(bus.gain.value).toBe(1);
  });

  it('a bed that starts while combat is on comes in under the lower level; a new run starts at the normal one', async () => {
    const h = harness({ beds: true });
    h.adapter.runStart(world);
    for (let i = 0; i < 40; i++) h.adapter.handleEvent(damage(), world);
    h.adapter.update(world, 0.016);
    h.adapter.update(world, 0.016);
    await settle();
    expect(h.bedSources()).toHaveLength(1);
    expect(h.nodes().bus.gain.value).toBeCloseTo(DB6, 6);
    h.adapter.runEnd(world);
    h.adapter.runStart(world);
    expect(h.nodes().bus.gain.value).toBe(1);
  });

  it('pause lowpasses the bed at 1.2 kHz and opens it again on resume', async () => {
    const h = harness({ beds: true });
    await begin(h);
    const { filter } = h.nodes();
    expect(filter.frequency.value).toBe(AMB_OPEN_HZ);
    h.adapter.pauseChanged(true);
    expect(filter.frequency.value).toBe(AMB_MUFFLE_HZ);
    expect(AMB_MUFFLE_HZ).toBe(1200);
    expect(h.bedSources().filter((s) => s.stopped)).toHaveLength(0); // muffled, not stopped
    h.adapter.pauseChanged(false);
    expect(filter.frequency.value).toBe(AMB_OPEN_HZ);
    // quitting from the pause menu: the next run does not start muffled
    h.adapter.pauseChanged(true);
    h.adapter.runEnd(world);
    h.adapter.runStart(world);
    expect(filter.frequency.value).toBe(AMB_OPEN_HZ);
  });

  it('fades out over 1.5 s at the run end event, at the lifecycle end (quit) and when the menus take over', async () => {
    const started = async (): Promise<H> => {
      const h = harness({ beds: true });
      await begin(h);
      h.advance(20);
      expect(h.ambience.playing).toBe(true);
      return h;
    };
    const faded = (h: H): void => {
      const [bed] = h.bedSources();
      expect(h.ambience.playing).toBe(false);
      expect(bedGain(h).gain.ramps.at(-1)).toEqual([0, 20 + AMB_FADE_OUT_S]);
      expect(bed?.stopped).toBe(true);
      expect(bed?.stopAt).toBeGreaterThan(20 + AMB_FADE_OUT_S);
      expect(bed?.stopAt).toBeLessThan(20 + AMB_FADE_OUT_S + 0.2);
      expect(AMB_FADE_OUT_S).toBe(1.5);
    };
    let h = await started();
    h.adapter.handleEvent(ev({ t: 'runEnd', victory: false }), world);
    faded(h);
    h = await started();
    h.adapter.runEnd(world); // quit / results / restart
    faded(h);
    h = await started();
    h.adapter.setZoneMusic('menu', 'calm'); // back in the menus
    faded(h);
    // and a bed does not come back after the run ended: no update revives it
    h.adapter.update(world, 0.016);
    await settle();
    expect(h.bedSources()).toHaveLength(1);
  });

  it('a run that ends while its bed is still being fetched never starts it', async () => {
    const release = slowFetch();
    const h = harness({ beds: true, undecoded: ['amb_yeonmu'] });
    await begin(h); // music is up: the bed is asked for, the fetch is held
    expect(h.bedSources()).toHaveLength(0);
    h.adapter.runEnd(world);
    release();
    await settle();
    expect(h.bedSources()).toHaveLength(0);
  });

  it('nothing happens without an amb_<zone> entry: no source, no fetch, no error, no level change', async () => {
    const fetches: string[] = [];
    vi.stubGlobal('fetch', async (u: string) => (fetches.push(u), { ok: false, arrayBuffer: async () => new ArrayBuffer(0) }));
    const h = harness(); // makeManifest(): no bed
    h.adapter.runStart(world);
    await settle();
    for (let i = 0; i < 5; i++) h.adapter.update(world, 0.1);
    h.adapter.pauseChanged(true);
    h.adapter.pauseChanged(false);
    for (let i = 0; i < 40; i++) h.adapter.handleEvent(damage(), world);
    h.adapter.update(world, 0.016);
    await settle();
    expect(h.bedSources()).toHaveLength(0);
    expect(h.ambience.playing).toBe(false);
    expect(h.ambience.currentUrl).toBe('');
    expect(h.adapter.bedUrl).toBeNull();
    expect(fetches).toEqual([]);
    expect(sources.filter((s) => s.loop && s.startedAt >= 0)).toHaveLength(1); // the zone music only
    expect(h.ambience.play('amb_yeonmu')).toBe(false);
    expect(() => h.ambience.stop()).not.toThrow();
    h.adapter.runEnd(world);
  });

  it("only this zone's bed plays, and only a manifest entry of kind ambience counts", async () => {
    let h = harness({ manifest: addBeds(makeManifest(), ['amb_seori']) });
    await begin(h); // yeonmu run: only seori's bed is listed
    expect(h.bedSources()).toHaveLength(0);
    expect(h.adapter.bedUrl).toBeNull();

    const wrong = makeManifest();
    wrong['amb_yeonmu'] = asset('amb_yeonmu', { kind: 'sfx' }); // the right id, the wrong kind
    h = harness({ manifest: wrong });
    await begin(h);
    expect(h.bedSources()).toHaveLength(0);

    h = harness({ manifest: twoZones() });
    await begin(h, seori);
    expect(h.bedSources().map((s) => s.buffer?.name)).toEqual(['assets/audio/amb_seori.mp3']);
  });

  it('a second run of the same zone replays the cached bed; another zone replaces it and frees its buffer', async () => {
    const h = harness({ manifest: twoZones() });
    await begin(h);
    h.adapter.runEnd(world);
    h.advance(5);
    await begin(h);
    expect(h.bedSources().map((s) => s.buffer?.name)).toEqual(['assets/audio/amb_yeonmu.mp3', 'assets/audio/amb_yeonmu.mp3']);
    expect(h.engine.has('assets/audio/amb_yeonmu.mp3')).toBe(true);
    h.adapter.runEnd(world);
    await begin(h, seori);
    expect(h.engine.has('assets/audio/amb_seori.mp3')).toBe(true);
    expect(h.engine.has('assets/audio/amb_yeonmu.mp3')).toBe(false); // one decoded bed at a time
  });

  it('createAudio reports the bed in stats and stops it with the system', () => {
    (globalThis as { AudioContext?: unknown }).AudioContext = FakeCtx;
    const audio = createAudio(addBeds(makeManifest(), ['amb_yeonmu']), null, { autoUnlock: false, preload: false, resolveUrl: (p) => p });
    expect(audio.stats.ambience).toBe('');
    audio.unlock();
    expect(() => audio.dispose()).not.toThrow();
  });
});

// ---- adaptive music, safety limiter, SFX ducking (AR-02) ---------------------------------------------------------------
describe('adaptive music, safety limiter, SFX ducking (AR-02)', () => {
  type H = ReturnType<typeof harness>;
  const CALM_URL = 'assets/audio/mus_yeonmu_calm.mp3';
  const COMBAT_URL = 'assets/audio/mus_yeonmu.mp3';
  /** the manifest of a build whose calm stem is a file of its own (AG-02); `calmOver` reshapes that entry */
  const layeredManifest = (calmOver: Partial<AudioAsset> = {}): Record<string, AudioAsset> => {
    const m = makeManifest();
    m['mus_yeonmu_calm'] = { ...(m['mus_yeonmu'] as AudioAsset), id: 'mus_yeonmu_calm', url: CALM_URL, ...calmOver };
    return m;
  };
  /** the manifest plus 40 distinct one-shots: 40 voices play at once when each is played once */
  const crowdManifest = (): Record<string, AudioAsset> => {
    const m = makeManifest();
    for (let i = 0; i < 40; i++) m[`sfx_dens_${i}`] = asset(`sfx_dens_${i}`);
    return m;
  };
  const loopDecks = (): FakeSource[] => sources.filter((s) => s.loop && s.startedAt >= 0);
  /** the gain nodes of the music decks, oldest first (the ones that feed the music filter) */
  const deckGains = (h: H): FakeGain[] => (h.engine.ctx as unknown as FakeCtx).gains.filter((g) => g.outputs.includes(h.engine.musicFilter));
  const filterHz = (h: H): number => (h.engine.musicFilter as unknown as FakeFilter).frequency.value;
  const duckNode = (h: H): FakeGain => h.engine.musicDuck as unknown as FakeGain;
  const FLOOR = Math.pow(10, -DUCK_DENSITY_MAX_DB / 20);
  /** combat heat: the damage events a fight sends, then one frame (the adapter switches the music) */
  const fight = async (h: H): Promise<void> => {
    h.adapter.update(world, 0.016);
    for (let i = 0; i < 40; i++) h.adapter.handleEvent(damage(), world);
    h.adapter.update(world, 0.016);
    await h.flush();
  };
  /** the playhead of a deck (seconds into its loop) at engine time t */
  const playhead = (s: FakeSource, t: number, loopLen = 1): number => (((s.startOffset + (t - s.startedAt)) % loopLen) + loopLen) % loopLen;
  const settleCtx = (h: H): FakeCtx => h.engine.ctx as unknown as FakeCtx;

  beforeEach(() => {
    sources.length = 0;
  });
  afterEach(() => {
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
  });

  // ---- calm / combat crossfade ------------------------------------------------------------------------------------------
  it('one file for calm and combat (today): the lowpass path, no second deck, no layers', async () => {
    const h = harness();
    h.adapter.runStart(world);
    await h.flush();
    expect(h.music.layered).toBe(false);
    expect(loopDecks()).toHaveLength(1);
    expect(loopDecks()[0]?.startedAt).toBe(0); // no look-ahead on this path
    expect(filterHz(h)).toBeCloseTo(4200, 3); // calm: veiled
    await fight(h);
    expect(loopDecks()).toHaveLength(1);
    expect(filterHz(h)).toBeCloseTo(22000, 3); // combat: open
    h.adapter.update(world, 12); // the heat dies away
    await h.flush();
    expect(loopDecks()).toHaveLength(1);
    expect(filterHz(h)).toBeCloseTo(4200, 3);
    expect(deckGains(h)[0]?.gain.ramps).toHaveLength(1); // the one linear fade-in of the first start, nothing else
  });

  it('distinct calm and combat files: a position-synced 1.2 s constant-energy crossfade, the filter stays open', async () => {
    const h = harness({ manifest: layeredManifest() });
    h.adapter.runStart(world);
    await h.flush();
    expect(h.music.layered).toBe(true);
    expect(loopDecks().map((s) => s.buffer?.name)).toEqual([CALM_URL]);
    expect(loopDecks()[0]?.startedAt).toBeCloseTo(SYNC_LEAD_S, 9);
    expect(filterHz(h)).toBeCloseTo(22000, 3); // calm is its own mix: no lowpass on top

    h.advance(10.37);
    await fight(h);
    const [calm, combat] = loopDecks();
    expect(combat?.buffer?.name).toBe(COMBAT_URL);
    if (!calm || !combat) throw new Error('two decks expected');
    const now = settleCtx(h).currentTime;
    const when = now + SYNC_LEAD_S;
    expect(combat.startedAt).toBeCloseTo(when, 9);
    // both decks run at the same offset: the playhead of the new one equals the playhead of the old one
    expect(combat.startOffset).toBeCloseTo(playhead(calm, when), 9);
    expect(playhead(combat, when + 3.3)).toBeCloseTo(playhead(calm, when + 3.3), 9);
    // the old deck leaves after the fade
    expect(calm.stopAt).toBeCloseTo(when + SYNC_FADE_S + 0.05, 9);
    expect(combat.stopped).toBe(false);

    const [gCalm, gCombat] = deckGains(h);
    const fadeIn = gCombat?.gain.ramps ?? [];
    const fadeOut = (gCalm?.gain.ramps ?? []).slice(-fadeIn.length);
    expect(fadeIn.length).toBeGreaterThanOrEqual(12);
    expect(fadeOut).toHaveLength(fadeIn.length);
    fadeIn.forEach(([vIn, tIn], i) => {
      const [vOut, tOut] = fadeOut[i] ?? [NaN, NaN];
      expect(tIn).toBeCloseTo(tOut, 9);
      // constant energy for rho-correlated layers: g_in^2 + g_out^2 + 2 rho g_in g_out never moves (not the equal-power sum of squares)
      expect(vIn * vIn + vOut * vOut + 2 * SYNC_RHO * vIn * vOut).toBeCloseTo(1, 9);
      expect(tIn).toBeCloseTo(when + (SYNC_FADE_S * (i + 1)) / fadeIn.length, 9);
    });
    expect(fadeIn.at(-1)).toEqual([1, when + SYNC_FADE_S]);
    expect(fadeOut.at(-1)).toEqual([0, when + SYNC_FADE_S]);
    const mid = fadeIn[fadeIn.length / 2 - 1];
    const midOut = fadeOut[fadeOut.length / 2 - 1];
    expect(mid?.[0]).toBeCloseTo(Math.SQRT1_2 / Math.sqrt(1 + SYNC_RHO), 9); // 0.7071 / sqrt(1 + rho) each at the middle
    expect(midOut?.[0]).toBeCloseTo(Math.SQRT1_2 / Math.sqrt(1 + SYNC_RHO), 9);
    // the law is not the equal-power one: it sits below sin / cos everywhere inside the fade, and rises / falls monotonically
    fadeIn.slice(0, -1).forEach(([vIn], i) => {
      expect(vIn).toBeLessThan(Math.sin(((i + 1) / fadeIn.length) * Math.PI * 0.5));
      if (i > 0) expect(vIn).toBeGreaterThan(fadeIn[i - 1]?.[0] ?? Infinity);
    });
    fadeOut.slice(1).forEach(([vOut], i) => expect(vOut).toBeLessThan(fadeOut[i]?.[0] ?? -Infinity));
    expect(filterHz(h)).toBeCloseTo(22000, 3);
  });

  it('crossfade law: constant energy for the assumed correlation, bounded swell for identical stems, bounded dip for unrelated ones', () => {
    expect(SYNC_RHO).toBe(0.8);
    let worstSwellDb = -Infinity; // fully correlated layers add in amplitude
    let worstDipDb = Infinity; // unrelated layers add in power
    for (let i = 0; i <= 200; i++) {
      const { gIn, gOut } = syncFadeGains(i / 200);
      expect(gIn * gIn + gOut * gOut + 2 * SYNC_RHO * gIn * gOut).toBeCloseTo(1, 12);
      worstSwellDb = Math.max(worstSwellDb, 20 * Math.log10(gIn + gOut));
      worstDipDb = Math.min(worstDipDb, 10 * Math.log10(gIn * gIn + gOut * gOut));
    }
    expect(syncFadeGains(0)).toEqual({ gIn: 0, gOut: 1 });
    expect(syncFadeGains(1).gIn).toBeCloseTo(1, 12);
    expect(syncFadeGains(1).gOut).toBeCloseTo(0, 12);
    expect(worstSwellDb).toBeLessThan(0.5); // identical stems: at most +0.46 dB (equal power gave +3.0 dB)
    expect(worstDipDb).toBeGreaterThan(-2.6); // unrelated stems: at most -2.55 dB at the middle (equal gain would give -3.0 dB)
  });

  it('a layered deck that replaces the veiled menu theme opens the shared filter over the fade, not in 150 ms', async () => {
    const h = harness({ manifest: layeredManifest() });
    h.adapter.setZoneMusic('menu', 'calm'); // the menu theme: a non-pair deck, the lowpass at 4.2 kHz
    await h.flush();
    expect(h.music.currentUrl).toBe('assets/audio/mus_menu.mp3');
    expect(filterHz(h)).toBeCloseTo(4200, 3);
    h.advance(3);
    h.adapter.runStart(world);
    await h.flush();
    expect(h.music.currentUrl).toBe(CALM_URL);
    const last = (h.engine.musicFilter as unknown as FakeFilter).frequency.targets.at(-1);
    expect(last?.[0]).toBeCloseTo(22000, 3);
    expect(last?.[2]).toBeCloseTo(1.4 / 3, 9); // 95 % open when the menu theme is gone
    // a calm -> combat switch inside the pair keeps the quick retarget (the filter is open already)
    h.advance(10);
    await fight(h);
    expect((h.engine.musicFilter as unknown as FakeFilter).frequency.targets.at(-1)?.[2]).toBeCloseTo(0.05, 9);
  });

  it('calm -> combat -> calm keeps one playhead through both crossfades; an overtaken request starts no deck', async () => {
    const h = harness({ manifest: layeredManifest() });
    h.adapter.runStart(world);
    await h.flush();
    h.advance(7.9);
    await fight(h);
    h.advance(0.5); // back before the first fade is over
    h.music.play('mus_yeonmu_calm');
    await h.flush();
    const [a, b, c] = loopDecks();
    if (!a || !b || !c) throw new Error('three decks expected');
    expect(c.buffer?.name).toBe(CALM_URL);
    for (const t of [c.startedAt, c.startedAt + 2.7, c.startedAt + 41.1]) {
      expect(playhead(c, t)).toBeCloseTo(playhead(b, t), 9);
      expect(playhead(c, t)).toBeCloseTo(playhead(a, t), 9);
    }
    // the combat request is still loading when calm is asked again: calm is playing, nothing restarts
    const n = loopDecks().length;
    h.music.play('mus_yeonmu_combat');
    h.music.play('mus_yeonmu_calm');
    await h.flush();
    expect(loopDecks()).toHaveLength(n);
    expect(h.music.currentUrl).toBe(CALM_URL);
  });

  it('loops of different lengths are not one song form: an ordinary crossfade, no shared offset', async () => {
    const h = harness({ manifest: layeredManifest({ loopEnd: 0.5, duration: 0.5 }) });
    h.adapter.runStart(world);
    await h.flush();
    h.advance(3.3);
    await fight(h);
    const [, combat] = loopDecks();
    if (!combat) throw new Error('two decks expected');
    expect(combat.startOffset).toBe(0); // its own resume position, not the calm deck's
    expect(deckGains(h)[1]?.gain.ramps).toHaveLength(1); // one linear ramp (1.4 s), not the synced steps
    expect(deckGains(h)[1]?.gain.ramps[0]?.[1]).toBeCloseTo(settleCtx(h).currentTime + SYNC_LEAD_S + 1.4, 9);
  });

  it('boss music over a layered zone is an ordinary crossfade: no look-ahead, no shared offset', async () => {
    const h = harness({ manifest: layeredManifest() });
    h.adapter.runStart(world);
    await h.flush();
    h.advance(5.2);
    h.adapter.handleEvent(ev({ t: 'bossSpawn', boss: 1, enemy: 1, bossId: 'b', x: 3, z: 3, final: false }), world);
    await h.flush();
    expect(h.music.currentUrl).toBe('assets/audio/mus_boss.mp3');
    const boss = loopDecks().at(-1);
    expect(boss?.startedAt).toBe(settleCtx(h).currentTime); // the boss track is not a layer: no look-ahead, no sync
    expect(deckGains(h).at(-1)?.gain.ramps).toHaveLength(1);
  });

  it('the other layer is decoded as soon as the first deck is up, so the first heat switches at once', async () => {
    const fetched: string[] = [];
    vi.stubGlobal('fetch', async (u: string) => (fetched.push(u), { ok: true, arrayBuffer: async () => new TextEncoder().encode(u).buffer }));
    try {
      const h = harness({ manifest: layeredManifest(), undecoded: ['mus_yeonmu'] }); // calm is decoded, the combat file is not
      expect(h.engine.has(COMBAT_URL)).toBe(false);
      h.adapter.runStart(world);
      await h.flush();
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(loopDecks().map((s) => s.buffer?.name)).toEqual([CALM_URL]);
      expect(fetched).toEqual([COMBAT_URL]);
      expect(h.engine.has(COMBAT_URL)).toBe(true);
      // one file for both (today): nothing to warm
      fetched.length = 0;
      const a = harness({ undecoded: ['mus_yeonmu'] });
      a.adapter.runStart(world);
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(fetched).toEqual([COMBAT_URL]); // the one zone track, fetched once for the calm start itself
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // ---- master safety limiter ----------------------------------------------------------------------------------------------
  it('the master limiter is a safety: ratio 20, 0.1 s release, hard knee, threshold above the old -9 dB', () => {
    const h = harness();
    const l = h.engine.limiter as unknown as FakeComp;
    expect(l.threshold.value).toBe(LIMITER.threshold);
    expect(l.ratio.value).toBe(20);
    expect(l.release.value).toBeCloseTo(0.1, 9);
    expect(l.knee.value).toBe(0);
    expect(l.attack.value).toBeLessThanOrEqual(0.003);
    expect(LIMITER.threshold).toBeGreaterThanOrEqual(-4); // the old limiter bent everything above -9 dBFS
    expect(LIMITER.threshold).toBeLessThanOrEqual(-3);
    expect(l.outputs).toContain(settleCtx(h).destination);
  });

  // ---- SFX density ducking ------------------------------------------------------------------------------------------------
  it('the event duck of rules.ts is unchanged when the density duck is off', () => {
    const h = harness();
    h.engine.duckMusic(7, 1.1);
    const t = duckNode(h).gain.targets;
    expect(t).toHaveLength(2);
    expect(t[0]?.[0]).toBeCloseTo(Math.pow(10, -7 / 20), 9);
    expect(t[0]?.[2]).toBeCloseTo(0.05, 9);
    expect(t[1]?.[0]).toBe(1);
    expect(t[1]?.[1]).toBeCloseTo(settleCtx(h).currentTime + 1.1, 9);
    expect(t[1]?.[2]).toBeCloseTo(0.6 / 3, 9);
  });

  it('density duck: never deeper than -3 dB, whatever the caller asks', () => {
    const h = harness();
    h.engine.setDensityDuck(30);
    expect(h.engine.densityDuckDb).toBe(DUCK_DENSITY_MAX_DB);
    expect(duckNode(h).gain.value).toBeCloseTo(FLOOR, 9);
    h.engine.setDensityDuck(Number.POSITIVE_INFINITY);
    h.engine.setDensityDuck(3.0001);
    h.engine.setDensityDuck(-6);
    expect(h.engine.densityDuckDb).toBe(0);
    expect(duckNode(h).gain.value).toBe(1);
    for (const [v] of duckNode(h).gain.targets) expect(v).toBeGreaterThanOrEqual(FLOOR - 1e-12);
    expect(DUCK_DENSITY_MAX_DB).toBe(3);
  });

  it('density duck: 50 ms attack going down, 600 ms release coming back', () => {
    const h = harness();
    h.engine.setDensityDuck(2);
    h.engine.setDensityDuck(3);
    h.engine.setDensityDuck(1);
    const tcs = duckNode(h).gain.targets.map((x) => x[2]);
    expect(tcs[0]).toBeCloseTo(0.05 / 3, 9); // 95 % in 50 ms
    expect(tcs[1]).toBeCloseTo(0.05 / 3, 9);
    expect(tcs[2]).toBeCloseTo(0.6 / 3, 9); // 95 % in 600 ms
  });

  it('density duck and event duck share one gain: the deeper wins, they never add up', () => {
    const h = harness();
    h.engine.setDensityDuck(3);
    h.engine.duckMusic(7, 1.1);
    const t = duckNode(h).gain.targets;
    expect(t.at(-2)?.[0]).toBeCloseTo(Math.pow(10, -7 / 20), 9); // -7 dB, not -10
    expect(t.at(-1)?.[0]).toBeCloseTo(FLOOR, 9); // after the hold: back to the density duck
    h.engine.duckMusic(1, 0.5); // a shallow event while the density duck is deeper
    const t2 = duckNode(h).gain.targets;
    expect(t2.at(-2)?.[0]).toBeCloseTo(FLOOR, 9);
    // a density change during the hold keeps the hold's end
    h.engine.duckMusic(7, 1.1);
    const holdEnd = duckNode(h).gain.targets.at(-1)?.[1] ?? 0;
    h.advance(0.4);
    h.engine.setDensityDuck(1);
    const t3 = duckNode(h).gain.targets;
    expect(t3.at(-2)?.[0]).toBeCloseTo(Math.pow(10, -7 / 20), 9);
    expect(t3.at(-1)?.[1]).toBeCloseTo(holdEnd, 9);
    expect(t3.at(-1)?.[0]).toBeCloseTo(Math.pow(10, -1 / 20), 9);
  });

  it('event duck attack: a density step during the held event duck never slows it down (own 0.05 s time constant)', () => {
    const EVENT = Math.pow(10, -7 / 20);
    const scenarios: { before: number; steps: number[] }[] = [
      { before: 0, steps: [1.25] }, // an attack step of the density duck (its tc 0.0167)
      { before: 0, steps: [2.5] },
      { before: 0, steps: [1.25, 2.5] }, // the two steps of the review, one after the other
      { before: 2.5, steps: [1.25] }, // a release step (its tc 0.2): the old code stretched the -7 dB attack from 154 ms to 524 ms
      { before: 2.5, steps: [2, 1.5, 1] },
    ];
    for (const sc of scenarios) {
      const h = harness();
      if (sc.before > 0) h.engine.setDensityDuck(sc.before);
      h.engine.duckMusic(7, 1.1);
      h.advance(0.03);
      const n = duckNode(h).gain.targets.length;
      const holdEnd = h.engine.now - 0.03 + 1.1;
      for (const db of sc.steps) h.engine.setDensityDuck(db);
      const t = duckNode(h).gain.targets.slice(n);
      expect(t).toHaveLength(2 * sc.steps.length); // per step: the target now, then the target after the hold
      sc.steps.forEach((db, i) => {
        const now = t[2 * i];
        const after = t[2 * i + 1];
        expect(now?.[0]).toBeCloseTo(EVENT, 9); // the event duck is the deeper source
        expect(now?.[1]).toBeCloseTo(0.03, 9);
        expect(now?.[2]).toBeCloseTo(0.05, 9); // the event's own attack, not 0.0167 / 0.2
        expect(after?.[0]).toBeCloseTo(Math.pow(10, -db / 20), 9);
        expect(after?.[1]).toBeCloseTo(holdEnd, 9);
        expect(after?.[2]).toBeCloseTo(0.6 / 3, 9);
      });
    }
    // the density duck leads when it is the deeper one: its own time constants apply
    const h = harness();
    h.engine.duckMusic(1, 1);
    const n = duckNode(h).gain.targets.length;
    h.engine.setDensityDuck(2);
    expect(duckNode(h).gain.targets[n]?.[0]).toBeCloseTo(Math.pow(10, -2 / 20), 9);
    expect(duckNode(h).gain.targets[n]?.[2]).toBeCloseTo(0.05 / 3, 9);
    h.engine.setDensityDuck(1.5);
    expect(duckNode(h).gain.targets[n + 2]?.[2]).toBeCloseTo(0.6 / 3, 9);
  });

  it('the adapter ducks the music by the voices that play: nothing when quiet, in between when busy, -3 dB at most when packed', async () => {
    const h = harness({ manifest: crowdManifest() });
    h.adapter.runStart(world);
    await h.flush();
    const flat = { flat: true } as const;
    const frames = (n: number): void => {
      for (let i = 0; i < n; i++) {
        h.advance(0.05);
        h.adapter.update(world, 0.05);
      }
    };
    // quiet: 6 voices
    for (let i = 0; i < 6; i++) h.sfx.play(`sfx_dens_${i}`, 0, 0, flat);
    frames(40);
    expect(h.engine.densityDuckDb).toBe(0);
    expect(duckNode(h).gain.targets).toHaveLength(0); // the music gain was never touched
    // busy: 22 voices (a late fight's average)
    for (let i = 6; i < 22; i++) h.sfx.play(`sfx_dens_${i}`, 0, 0, flat);
    expect(h.sfx.activeVoices).toBe(22);
    frames(40);
    expect(h.engine.densityDuckDb).toBeGreaterThan(0.75);
    expect(h.engine.densityDuckDb).toBeLessThan(2.25);
    // packed: the whole pool of 40
    for (let i = 22; i < 40; i++) h.sfx.play(`sfx_dens_${i}`, 0, 0, flat);
    expect(h.sfx.activeVoices).toBe(40);
    for (let i = 0; i < 80; i++) {
      frames(1);
      expect(h.engine.densityDuckDb).toBeLessThanOrEqual(DUCK_DENSITY_MAX_DB);
    }
    expect(h.engine.densityDuckDb).toBe(DUCK_DENSITY_MAX_DB);
    expect(duckNode(h).gain.value).toBeCloseTo(FLOOR, 9);
    for (const [v] of duckNode(h).gain.targets) expect(v).toBeGreaterThanOrEqual(FLOOR - 1e-12); // never below -3 dB
    // the fight dies down: the duck lifts again
    h.sfx.dispose();
    expect(h.sfx.activeVoices).toBe(0);
    frames(60);
    expect(h.engine.densityDuckDb).toBe(0);
    expect(duckNode(h).gain.value).toBe(1);
  });

  it('density duck edge cases: pause, run end, a frozen frame, menus and the next run start clean', async () => {
    const h = harness({ manifest: crowdManifest() });
    h.adapter.runStart(world);
    await h.flush();
    for (let i = 0; i < 40; i++) h.sfx.play(`sfx_dens_${i}`, 0, 0, { flat: true });
    const pack = (): void => {
      for (let i = 0; i < 40; i++) h.adapter.update(world, 0.1);
    };
    pack();
    expect(h.engine.densityDuckDb).toBe(3);
    h.adapter.update(world, 0); // a frozen frame changes nothing
    expect(h.engine.densityDuckDb).toBe(3);
    h.adapter.pauseChanged(true); // the paused music is muffled, not ducked
    expect(h.engine.densityDuckDb).toBe(0);
    h.adapter.pauseChanged(false);
    h.adapter.update(world, 0.016); // one frame is not enough to pack the duck again
    expect(h.engine.densityDuckDb).toBeLessThan(1);
    pack();
    expect(h.engine.densityDuckDb).toBe(3);
    h.adapter.handleEvent(ev({ t: 'runEnd', victory: false }), world);
    expect(h.engine.densityDuckDb).toBe(0);
    h.adapter.update(world, 0.5); // the run is over: the adapter no longer drives anything
    expect(h.engine.densityDuckDb).toBe(0);
    h.adapter.runStart(world); // a new run starts from zero load
    expect(h.engine.densityDuckDb).toBe(0);
    pack();
    expect(h.engine.densityDuckDb).toBe(3);
    h.adapter.setZoneMusic('menu', 'calm'); // back in the menus
    expect(h.engine.densityDuckDb).toBe(0);
  });

  it('pause: frames with a real dt and voices still ringing never re-duck the paused music until the run resumes', async () => {
    const h = harness({ manifest: crowdManifest() });
    h.adapter.runStart(world);
    await h.flush();
    for (let i = 0; i < 40; i++) h.sfx.play(`sfx_dens_${i}`, 0, 0, { flat: true });
    const pack = (): void => {
      for (let i = 0; i < 40; i++) h.adapter.update(world, 0.1);
    };
    pack();
    expect(h.engine.densityDuckDb).toBe(3);
    h.adapter.pauseChanged(true);
    expect(h.engine.densityDuckDb).toBe(0);
    const scheduled = duckNode(h).gain.targets.length;
    // FixedLoop keeps rendering (audio.update with the real frame time) while the run is paused; 40 voices keep ringing, and a click or two joins
    for (let i = 0; i < 90; i++) {
      h.advance(0.016);
      if (i % 30 === 0) h.sfx.play('sfx_ui_click', 0, 0, { flat: true });
      h.adapter.update(world, 0.016);
      expect(h.engine.densityDuckDb).toBe(0);
    }
    h.adapter.update(world, 0.25);
    expect(h.sfx.activeVoices).toBeGreaterThanOrEqual(14);
    expect(h.engine.densityDuckDb).toBe(0);
    expect(duckNode(h).gain.targets).toHaveLength(scheduled); // not one gain event while paused
    expect(duckNode(h).gain.value).toBe(1);
    h.adapter.pauseChanged(false); // the run goes on: the load climbs again from zero
    h.adapter.update(world, 0.016);
    expect(h.engine.densityDuckDb).toBeLessThan(1);
    pack();
    expect(h.engine.densityDuckDb).toBe(3);
    // a run quit from its pause menu never reports the resume: the next run still ducks
    h.adapter.pauseChanged(true);
    h.adapter.runEnd(world);
    h.adapter.runStart(world);
    pack();
    expect(h.engine.densityDuckDb).toBe(3);
  });

  // ---- deck start: no one-sample click from the look-ahead -----------------------------------------------------------------
  it('every music deck is silent at its first sample: the gain node is zeroed before start(when), the look-ahead included', async () => {
    // WebAudio: a fresh GainNode passes at gain 1 until its first event lands. A deck that starts in the future (SYNC_LEAD_S) on a
    // clock where when * sampleRate falls a hair above a frame plays its first sample before setValueAtTime(0, when) takes effect.
    const h = harness({ manifest: layeredManifest() });
    h.adapter.runStart(world); // the first layered deck of a run (starts 40 ms ahead)
    await h.flush();
    h.advance(10.37);
    await fight(h); // calm -> combat: the synced crossfade
    h.adapter.update(world, 12); // the heat dies away: combat -> calm
    await h.flush();
    h.advance(3.3);
    h.adapter.handleEvent(ev({ t: 'bossSpawn', boss: 1, enemy: 1, bossId: 'b', x: 3, z: 3, final: false }), world); // boss theme: no look-ahead
    await h.flush();
    h.adapter.handleEvent(ev({ t: 'bossDeath', boss: 1, enemy: 1, bossId: 'b', x: 3, z: 3, final: false }), world);
    h.advance(2.6);
    h.adapter.update(world, 0.016); // boss -> the pair again
    await h.flush();
    const decks = loopDecks();
    expect(decks.map((d) => d.buffer?.name)).toEqual([CALM_URL, COMBAT_URL, CALM_URL, 'assets/audio/mus_boss.mp3', CALM_URL]);
    expect(decks.filter((d) => d.startedAt > 0).length).toBeGreaterThanOrEqual(4); // the look-ahead decks are among them
    for (const d of decks) expect(d.gainAtStart).toBe(0);
    // the same for the plain (alias) path: today's decks never start at a gain of 1 either
    sources.length = 0;
    const a = harness();
    a.adapter.runStart(world);
    await a.flush();
    a.adapter.handleEvent(ev({ t: 'bossSpawn', boss: 1, enemy: 1, bossId: 'b', x: 3, z: 3, final: false }), world);
    await a.flush();
    expect(loopDecks()).toHaveLength(2);
    for (const d of loopDecks()) expect(d.gainAtStart).toBe(0);
  });

  // ---- event duck: the release is not cut short either --------------------------------------------------------------------
  it('event duck release: a density step while the held duck lets go keeps the release time (no snap back toward the density level)', () => {
    const RELEASE_TC = 0.6 / 3;
    const steps: { before: number; at: number; db: number; tc: number; why: string }[] = [
      { before: 2.25, at: 1.15, db: 2.5, tc: RELEASE_TC, why: 'an attack step (own tc 0.0167) 50 ms into the release' },
      { before: 2.25, at: 1.3, db: 2.5, tc: RELEASE_TC, why: 'an attack step 200 ms into the release' },
      { before: 2.25, at: 1.15, db: 1.5, tc: RELEASE_TC, why: 'a release step (own tc 0.2) in the window keeps 0.6 / 3' },
      { before: 0, at: 1.1, db: 1, tc: RELEASE_TC, why: 'the very moment the hold ends' },
      { before: 2.25, at: 1.1 + 0.6 - 0.01, db: 2.5, tc: RELEASE_TC, why: 'just before the release window closes' },
      { before: 2.25, at: 1.1 + 0.6 + 0.01, db: 2.5, tc: 0.05 / 3, why: 'after the window: the density tc is unchanged (attack)' },
      { before: 2.25, at: 1.1 + 0.6 + 0.01, db: 1.5, tc: 0.6 / 3, why: 'after the window: the density tc is unchanged (release)' },
    ];
    for (const sc of steps) {
      const h = harness();
      if (sc.before > 0) h.engine.setDensityDuck(sc.before);
      h.engine.duckMusic(7, 1.1);
      h.advance(sc.at);
      const n = duckNode(h).gain.targets.length;
      h.engine.setDensityDuck(sc.db);
      const t = duckNode(h).gain.targets.slice(n);
      expect(t, sc.why).toHaveLength(1); // the hold is over: one target, the density level
      expect(t[0]?.[0], sc.why).toBeCloseTo(Math.pow(10, -sc.db / 20), 9);
      expect(t[0]?.[1], sc.why).toBeCloseTo(sc.at, 9);
      expect(t[0]?.[2], sc.why).toBeCloseTo(sc.tc, 9);
    }
    // the release time is the event's own: a slower one slows the density step during it
    const h = harness();
    h.engine.duckMusic(5, 0.9, 1.5);
    h.advance(1.0);
    const n = duckNode(h).gain.targets.length;
    h.engine.setDensityDuck(2);
    expect(duckNode(h).gain.targets[n]?.[2]).toBeCloseTo(1.5 / 3, 9);
    // a shallow event never holds the density duck back: the density duck leads when it is the deeper one
    const g = harness();
    g.engine.setDensityDuck(2);
    g.engine.duckMusic(1, 0.5);
    g.advance(0.6);
    const m = duckNode(g).gain.targets.length;
    g.engine.setDensityDuck(3);
    expect(duckNode(g).gain.targets[m]?.[0]).toBeCloseTo(Math.pow(10, -3 / 20), 9);
  });
});

// ---- EV-04: run-event cues and the pact awakening gold layer ----------------------------------------------------------------
// Synthetic 'runEvent' / 'cardPick' events through the adapter on the fake graph. The sim clock (world.time) and the audio clock advance
// together in `step` (the adapter's cue clock follows update's dt); sounds end after their real duration so the voice peaks mean something.
describe('run event and pact awakening cues (EV-04)', () => {
  const DUR: Record<string, number> = {
    sfx_metin_warn: 2.07, sfx_boss_roar: 4.56, sfx_holy_chime: 3.23, sfx_yeop_pile: 1.47, sfx_yeop_pickup: 0.62, sfx_bell_toll: 4.13, sfx_awaken: 4,
  };
  const LOOP = 'loop:sfx_aura_loop';

  function evManifest(): Record<string, AudioAsset> {
    const m = makeManifest();
    for (const [id, d] of Object.entries(DUR)) m[id] = asset(id, { duration: d });
    m['sfx_aura_loop'] = asset('sfx_aura_loop', { kind: 'ambience', loop: true, loopStart: 0, loopEnd: 2, duration: 2, gain: 0.271 });
    return m;
  }

  /**
   * a run: adapter started on a world with two heroes (0 at the origin, 1 at x = 6), events fed by hand, clocks stepped together.
   * `undecoded`: manifest ids whose buffer is not decoded yet (engine.load() goes to the stubbed fetch); `events`: the content's runEvents.zones
   * (zone id -> kinds; absent = the shipped content, which lists none).
   */
  function rig(opts: { undecoded?: string[]; events?: Record<string, string[]> } = {}) {
    const h = harness({ manifest: evManifest(), undecoded: opts.undecoded });
    const skip = new Set(opts.undecoded ?? []);
    for (const [id, d] of Object.entries(DUR)) if (!skip.has(id)) h.engine.inject(`assets/audio/${id}.mp3`, fakeBuffer(`assets/audio/${id}.mp3`, d));
    const ix = opts.events ? { bosses: new Map(), runEvents: { zones: opts.events } } : (world as unknown as { ix: object }).ix;
    const w = { ...(world as object), players: [{ x: 0, z: 0, sex: 'm' }, { x: 6, z: 0, sex: 'f' }], time: 0, ix } as unknown as World;
    h.adapter.runStart(w);
    let peak = 0;
    let peakAll = 0;
    const ended = new Set<FakeSource>();
    const settle = (): void => {
      const now = (h.engine.ctx as unknown as FakeCtx).currentTime;
      for (const s of sources) {
        if (s.startedAt < 0 || s.loop || ended.has(s) || !s.buffer || s.startedAt + s.buffer.duration > now) continue;
        ended.add(s);
        s.onended?.();
      }
    };
    const track = (): void => {
      peak = Math.max(peak, h.sfx.activeVoices);
      peakAll = Math.max(peakAll, h.sfx.activeVoices + h.loops.count);
    };
    return {
      h, w,
      /** peak of simultaneous one-shot voices so far */
      get peak(): number {
        return peak;
      },
      /** peak of one-shot voices + running loops at one time */
      get peakAll(): number {
        return peakAll;
      },
      at(t: number): void {
        w.time = t;
      },
      send(e: SimEvent): void {
        settle();
        h.adapter.handleEvent(e, w);
        track();
      },
      /** n frames of dt; `sim` false = the sim clock stands still while the frames go on (a card modal, the host's pause menu) */
      step(dt: number, n = 1, sim = true): void {
        for (let i = 0; i < n; i++) {
          h.advance(dt);
          if (sim) w.time += dt;
          settle();
          h.adapter.update(w, dt);
          track();
        }
      },
      /** every one-shot start of manifest sound `id`, in the order they began */
      starts(id: string): FakeSource[] {
        return sources.filter((s) => s.startedAt >= 0 && !s.loop && s.buffer?.name === `assets/audio/${id}.mp3`);
      },
      loopSources(id: string): FakeSource[] {
        return sources.filter((s) => s.startedAt >= 0 && s.loop && s.buffer?.name === `assets/audio/${id}.mp3`);
      },
      level: (s: FakeSource): number => (s.outputs[0] as FakeGain).gain.value,
      /** stereo position of a start: null = no panner (flat, or dead centre) */
      pan: (s: FakeSource): number | null => {
        const p = (s.outputs[0] as FakeGain).outputs[0];
        return p instanceof FakePanner ? p.pan.value : null;
      },
      /** all one-shots started so far, as a sorted id list (the zone music and beds are not SFX) */
      ids(): string[] {
        return sources
          .filter((s) => s.startedAt >= 0 && !s.loop && s.buffer && !/mus_|amb_/.test(s.buffer.name))
          .map((s) => (s.buffer?.name ?? '').replace('assets/audio/', '').replace('.mp3', ''))
          .sort();
      },
    };
  }

  const runEv = (kind: string, phase: string, over: Record<string, unknown> = {}): SimEvent =>
    ev({ t: 'runEvent', kind, phase, id: 1, x: 12, z: -4, startAt: 100, endAt: 145, player: -1, p: 0, ...over });
  const pick = (over: Record<string, unknown> = {}): SimEvent =>
    ev({ t: 'cardPick', player: 0, kind: 'skillUp', id: 'bladewheel', rarity: 'epic', rank: 7, awakening: true, ...over });
  const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;
  /** a level that went through the +-1 dB random spread of its rule */
  const spread = (level: number, nominal: number): boolean => level > nominal * 0.87 && level < nominal * 1.14;

  beforeEach(() => {
    sources.length = 0;
  });
  afterEach(() => {
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
    vi.unstubAllGlobals();
  });

  // ---- metinRain -------------------------------------------------------------------------------------------------------------
  it('metinRain: the announce rings three alarms 1.5 s apart, flat and rising; the other phases stay silent', () => {
    const r = rig();
    r.at(95);
    r.send(runEv('metinRain', 'announce', { endAt: 150 }));
    expect(r.starts('sfx_metin_warn')).toHaveLength(1); // the first one is immediate
    r.step(0.1, 5);
    expect(r.starts('sfx_metin_warn')).toHaveLength(1);
    r.step(0.1, 40); // 4.5 s after the announce
    const warns = r.starts('sfx_metin_warn');
    expect(warns).toHaveLength(3);
    const t0 = warns[0]?.startedAt ?? 0;
    expect(near((warns[1]?.startedAt ?? 0) - t0, 1.5, 0.11)).toBe(true);
    expect(near((warns[2]?.startedAt ?? 0) - t0, 3, 0.11)).toBe(true);
    expect(warns.map((s) => r.level(s))).toEqual([0.55, 0.75, 0.95]);
    expect(warns.map((s) => r.pan(s))).toEqual([null, null, null]);
    expect(r.peak).toBeLessThanOrEqual(2);
    // the 5 s heartbeat of the same phase and the later phases add nothing
    r.send(runEv('metinRain', 'announce', { endAt: 150 }));
    r.at(100);
    r.send(runEv('metinRain', 'active', { endAt: 150 }));
    r.step(0.1, 30);
    r.at(150);
    r.send(runEv('metinRain', 'end', { endAt: 150, p: 1 }));
    r.step(0.1, 30);
    expect(r.ids()).toEqual(['sfx_metin_warn', 'sfx_metin_warn', 'sfx_metin_warn']);
  });

  // ---- championHunt ------------------------------------------------------------------------------------------------------------
  it('championHunt: a distant roar at the announce, a panned roar where the champion stands, a chime for a won hunt only', () => {
    const r = rig();
    r.at(95);
    r.send(runEv('championHunt', 'announce', { endAt: 160, x: 0, z: 0 }));
    const call = r.starts('sfx_boss_roar');
    expect(call).toHaveLength(1);
    expect(r.level(call[0] as FakeSource)).toBeCloseTo(0.55, 6);
    expect(r.pan(call[0] as FakeSource)).toBeNull();
    r.step(0.1, 50);
    r.at(100);
    r.send(runEv('championHunt', 'active', { endAt: 160, x: 12, z: -4 }));
    expect(r.starts('sfx_boss_roar')).toHaveLength(1); // it roars on the next frame (a hunt that failed in this very dispatch must not)
    r.step(0.016);
    const roars = r.starts('sfx_boss_roar');
    expect(roars).toHaveLength(2);
    const champ = roars[1] as FakeSource;
    expect(r.level(champ)).toBeCloseTo(0.9, 6); // 12.6 m away: inside the roar's 30 m of full level
    expect(r.pan(champ)).toBeCloseTo((12 / 18) * 0.85, 6); // heard from the champion's side
    expect(champ.playbackRate.value).toBeCloseTo(0.9, 6); // the deeper roar
    // a moving champion re-emits 'active' (same phase): no second roar
    r.step(0.1, 10);
    r.send(runEv('championHunt', 'active', { endAt: 160, x: 20, z: 2 }));
    expect(r.starts('sfx_boss_roar')).toHaveLength(2);
    // a failed hunt is silent
    r.at(130);
    r.send(runEv('championHunt', 'end', { endAt: 130, p: 0 }));
    expect(r.starts('sfx_holy_chime')).toHaveLength(0);
    // a won hunt chimes (flat)
    const won = rig();
    won.at(130);
    won.send(runEv('championHunt', 'end', { endAt: 130, p: 1 }));
    const chime = won.starts('sfx_holy_chime');
    expect(chime).toHaveLength(1);
    expect(spread(won.level(chime[0] as FakeSource), 0.6)).toBe(true);
    expect(won.pan(chime[0] as FakeSource)).toBeNull();
  });

  // ---- goldenHour --------------------------------------------------------------------------------------------------------------
  it('goldenHour: a coin pour at the announce, a soft pitched shimmer for the whole window, nothing after it', () => {
    const r = rig();
    r.at(95);
    r.send(runEv('goldenHour', 'announce', { endAt: 145, x: 0, z: 0 }));
    const pour = r.starts('sfx_yeop_pile');
    expect(pour).toHaveLength(1);
    expect(spread(r.level(pour[0] as FakeSource), 0.75)).toBe(true);
    expect(r.pan(pour[0] as FakeSource)).toBeNull();
    r.step(0.1, 50);
    expect(r.starts('sfx_yeop_pickup')).toHaveLength(0); // the window has not opened
    r.at(100);
    r.send(runEv('goldenHour', 'active', { endAt: 145, x: 0, z: 0 }));
    expect(r.starts('sfx_yeop_pickup')).toHaveLength(0); // the first ping waits ~1 s
    r.step(0.1, 10);
    expect(r.starts('sfx_yeop_pickup')).toHaveLength(0);
    r.step(0.1, 3);
    expect(r.starts('sfx_yeop_pickup')).toHaveLength(1);
    // the gaps cycle 2.2 / 3.1 / 2.6 / 3.6 / 2.4 s (to the frame) and the pitch climbs well above 1
    r.step(0.1, 430); // 44 s into the 45 s window
    const pings = r.starts('sfx_yeop_pickup');
    expect(pings.length).toBeGreaterThanOrEqual(14);
    expect(pings.length).toBeLessThanOrEqual(18);
    const gaps = [2.2, 3.1, 2.6, 3.6, 2.4];
    for (let i = 1; i < 7; i++) {
      const d = (pings[i]?.startedAt ?? 0) - (pings[i - 1]?.startedAt ?? 0);
      expect(d, `gap ${i}`).toBeGreaterThanOrEqual((gaps[(i - 1) % 5] ?? 0) - 0.001);
      expect(d, `gap ${i}`).toBeLessThanOrEqual((gaps[(i - 1) % 5] ?? 0) + 0.11);
    }
    for (const p of pings) {
      expect(p.playbackRate.value).toBeGreaterThan(1.05);
      expect(r.level(p)).toBeLessThan(0.4);
      expect(r.pan(p)).toBeNull();
    }
    expect(r.peak).toBeLessThanOrEqual(2);
    // the window closes at its endAt by itself (a guest whose 'end' was lost) ...
    r.step(0.1, 10);
    const n = r.starts('sfx_yeop_pickup').length;
    r.step(0.1, 60);
    expect(r.starts('sfx_yeop_pickup')).toHaveLength(n);
    // ... and the 'end' phase does not bring it back
    r.send(runEv('goldenHour', 'end', { endAt: 145, p: 1, x: 0, z: 0 }));
    r.step(0.1, 60);
    expect(r.starts('sfx_yeop_pickup')).toHaveLength(n);
    expect(r.starts('sfx_yeop_pile')).toHaveLength(1);
  });

  it('goldenHour: the end phase stops a running shimmer before the planned end', () => {
    const r = rig();
    r.at(100);
    r.send(runEv('goldenHour', 'active', { endAt: 145 }));
    r.step(0.1, 80);
    const n = r.starts('sfx_yeop_pickup').length;
    expect(n).toBeGreaterThanOrEqual(2);
    r.send(runEv('goldenHour', 'end', { endAt: 108, p: 1 }));
    r.step(0.1, 100);
    expect(r.starts('sfx_yeop_pickup')).toHaveLength(n);
  });

  // ---- bargain -----------------------------------------------------------------------------------------------------------------
  it('bargain: a bell and the aura loop at the shrine while it exists; a chime per completed channel', () => {
    const r = rig();
    r.at(95);
    r.send(runEv('bargain', 'announce', { endAt: 160, x: 12, z: 3 }));
    const bell = r.starts('sfx_bell_toll');
    expect(bell).toHaveLength(1);
    expect(r.pan(bell[0] as FakeSource)).toBeGreaterThan(0); // from the shrine's side
    expect(r.h.loops.count).toBe(1);
    expect(r.loopSources('sfx_aura_loop')).toHaveLength(1);
    expect(r.loopSources('sfx_aura_loop')[0]?.stopped).toBe(false);
    r.step(0.1, 55);
    r.at(100);
    r.send(runEv('bargain', 'active', { endAt: 160, x: 12, z: 3 }));
    expect(r.h.loops.count).toBe(1); // still the same loop
    expect(r.loopSources('sfx_aura_loop')).toHaveLength(1);
    expect(r.starts('sfx_bell_toll')).toHaveLength(1);
    // a hero channels: progress is silent, the completion chimes once at the shrine
    r.send(runEv('bargain', 'channel', { player: 0, p: 0.4, x: 12, z: 3 }));
    r.send(runEv('bargain', 'channel', { player: 0, p: 0.8, x: 12, z: 3 }));
    expect(r.starts('sfx_holy_chime')).toHaveLength(0);
    r.send(runEv('bargain', 'channel', { player: 0, p: 1, x: 12, z: 3 }));
    const chime = r.starts('sfx_holy_chime');
    expect(chime).toHaveLength(1);
    expect(r.pan(chime[0] as FakeSource)).toBeGreaterThan(0);
    r.step(0.3);
    r.send(runEv('bargain', 'channel', { player: 0, p: 1, x: 12, z: 3 })); // the throttled stream may repeat p = 1
    r.step(0.3);
    expect(r.starts('sfx_holy_chime')).toHaveLength(1);
    // the second hero chimes for its own channel
    r.step(0.5);
    r.send(runEv('bargain', 'channel', { player: 1, p: 1, x: 12, z: 3 }));
    expect(r.starts('sfx_holy_chime')).toHaveLength(2);
    // the shrine closes: the loop fades out and stays out
    r.at(130);
    r.send(runEv('bargain', 'end', { endAt: 130, p: 1, x: 12, z: 3 }));
    expect(r.h.loops.count).toBe(0);
    expect(r.loopSources('sfx_aura_loop')[0]?.stopped).toBe(true);
    r.step(0.1, 30);
    expect(r.h.loops.count).toBe(0);
    expect(r.starts('sfx_bell_toll')).toHaveLength(1);
  });

  it('bargain: the completion chime rearms when the hero leaves; other kinds and unnamed heroes have no channel cue', () => {
    const r = rig();
    r.at(100);
    r.send(runEv('bargain', 'active', { endAt: 160 }));
    r.send(runEv('bargain', 'channel', { player: 0, p: 1 }));
    r.step(0.5);
    r.send(runEv('bargain', 'channel', { player: 0, p: 0 })); // modal open / left the ring: back to 0
    r.step(0.5);
    r.send(runEv('bargain', 'channel', { player: 0, p: 1 }));
    expect(r.starts('sfx_holy_chime')).toHaveLength(2);
    const other = rig();
    other.at(100);
    other.send(runEv('championHunt', 'channel', { player: 0, p: 1 }));
    other.send(runEv('goldenHour', 'channel', { player: 0, p: 1 }));
    other.send(runEv('bargain', 'channel', { player: -1, p: 1 })); // no hero named: nothing to chime for
    expect(other.starts('sfx_holy_chime')).toHaveLength(0);
  });

  it('bargain: a full loop bank delays the shrine loop until a slot frees (retry); its key never collides with a metin', () => {
    const r = rig();
    for (let m = 0; m < 4; m++) r.send(ev({ t: 'metinImpact', metin: m, x: 3 + m, z: 0 }));
    expect(r.h.loops.count).toBe(4);
    r.at(95);
    r.send(runEv('bargain', 'announce', { endAt: 160 }));
    expect(r.h.loops.count).toBe(4); // refused: the bank is full
    expect(r.loopSources('sfx_aura_loop')).toHaveLength(0);
    r.step(0.25, 8);
    expect(r.loopSources('sfx_aura_loop')).toHaveLength(0);
    r.send(ev({ t: 'metinBreak', metin: 0, x: 3, z: 0 }));
    expect(r.h.loops.count).toBe(3);
    r.step(0.25, 6); // the retry gap (1 s) passes
    expect(r.loopSources('sfx_aura_loop')).toHaveLength(1);
    expect(r.h.loops.count).toBe(4);
    r.send(ev({ t: 'metinBreak', metin: 1, x: 4, z: 0 }));
    expect(r.h.loops.count).toBe(3);
    expect(r.loopSources('sfx_aura_loop')[0]?.stopped).toBe(false); // metin 1 went, the shrine did not
  });

  it('bargain: a heartbeat of the same phase starts a shrine loop that could not start', () => {
    const r = rig();
    for (let m = 0; m < 4; m++) r.send(ev({ t: 'metinImpact', metin: m, x: 3 + m, z: 0 }));
    r.at(100);
    r.send(runEv('bargain', 'active', { endAt: 160 }));
    expect(r.loopSources('sfx_aura_loop')).toHaveLength(0);
    r.send(ev({ t: 'metinBreak', metin: 2, x: 5, z: 0 }));
    r.send(runEv('bargain', 'active', { endAt: 160 })); // the 5 s heartbeat
    expect(r.loopSources('sfx_aura_loop')).toHaveLength(1);
  });

  // ---- every kind x every phase ---------------------------------------------------------------------------------------------------
  it('maps every kind and phase: the sounds a first sighting starts within 6 s', () => {
    // [kind, phase, extra, expected unique ids (the shrine loop as loop:<id>)]; each cell on a fresh run, at the moment the phase begins
    const cells: [string, 'announce' | 'active' | 'end' | 'channel', Record<string, unknown>, string[]][] = [
      ['metinRain', 'announce', {}, ['sfx_metin_warn']],
      ['metinRain', 'active', {}, []],
      ['metinRain', 'end', { p: 1 }, []],
      ['metinRain', 'channel', { player: 0, p: 1 }, []],
      ['championHunt', 'announce', {}, ['sfx_boss_roar']],
      ['championHunt', 'active', {}, ['sfx_boss_roar']],
      ['championHunt', 'end', { p: 1 }, ['sfx_holy_chime']],
      ['championHunt', 'end', { p: 0 }, []],
      ['championHunt', 'channel', { player: 0, p: 1 }, []],
      ['goldenHour', 'announce', {}, ['sfx_yeop_pile']],
      ['goldenHour', 'active', {}, ['sfx_yeop_pickup']],
      ['goldenHour', 'end', { p: 1 }, []],
      ['goldenHour', 'channel', { player: 0, p: 1 }, []],
      ['bargain', 'announce', {}, ['sfx_bell_toll', LOOP]],
      ['bargain', 'active', {}, [LOOP]],
      ['bargain', 'end', { p: 1 }, []],
      ['bargain', 'end', { p: 0 }, []],
      ['bargain', 'channel', { player: 0, p: 1 }, ['sfx_holy_chime']],
      ['bargain', 'channel', { player: 0, p: 0.5 }, []],
      ['comet', 'announce', {}, []], // a kind nobody gave a cue
      ['comet', 'active', {}, []],
      ['comet', 'end', { p: 1 }, []],
      ['comet', 'channel', { player: 0, p: 1 }, []],
    ];
    for (const [kind, phase, extra, want] of cells) {
      const r = rig();
      r.at(phase === 'announce' ? 95 : phase === 'active' ? 100 : phase === 'end' ? 145 : 110);
      r.send(runEv(kind, phase, { endAt: 145, ...extra }));
      r.step(0.1, 60);
      const got = [...new Set(r.ids()), ...(r.h.loops.count > 0 ? [LOOP] : [])].sort();
      expect(got, `${kind} ${phase} ${JSON.stringify(extra)}`).toEqual([...want].sort());
    }
  });

  // ---- late join, run end, pause ---------------------------------------------------------------------------------------------------
  it('a guest that joins mid-event resumes the state and skips the one-shot stingers', () => {
    const roar = rig();
    roar.at(120); // 20 s into the hunt: the heartbeat is the guest's first sight
    roar.send(runEv('championHunt', 'active', { endAt: 160 }));
    expect(roar.ids()).toEqual([]);
    const rain = rig();
    rain.at(98.5); // 3.5 s into the announce
    rain.send(runEv('metinRain', 'announce', { endAt: 150 }));
    rain.step(0.1, 40);
    expect(rain.ids()).toEqual([]);
    const gold = rig();
    gold.at(120);
    gold.send(runEv('goldenHour', 'active', { endAt: 145 }));
    expect(gold.ids()).toEqual([]);
    gold.step(0.1, 10);
    expect(gold.starts('sfx_yeop_pickup')).toHaveLength(1); // the shimmer for the rest of the window, no pour
    gold.step(0.1, 150);
    expect(gold.starts('sfx_yeop_pickup').length).toBeGreaterThan(2);
    gold.step(0.1, 120); // past 145
    const n = gold.starts('sfx_yeop_pickup').length;
    gold.step(0.1, 100);
    expect(gold.starts('sfx_yeop_pickup')).toHaveLength(n); // the window is over
    expect(gold.starts('sfx_yeop_pile')).toHaveLength(0);
    const shrine = rig();
    shrine.at(120);
    shrine.send(runEv('bargain', 'active', { endAt: 160 }));
    expect(shrine.starts('sfx_bell_toll')).toHaveLength(0);
    expect(shrine.h.loops.count).toBe(1); // but the shrine hums
  });

  it('a new event id starts clean; the run end cancels everything pending and later events are ignored', () => {
    const r = rig();
    r.at(95);
    r.send(runEv('bargain', 'announce', { id: 1, endAt: 160 }));
    expect(r.h.loops.count).toBe(1);
    r.send(runEv('metinRain', 'announce', { id: 2, startAt: 100, endAt: 150 })); // another event: the shrine of #1 is gone
    expect(r.h.loops.count).toBe(0);
    r.step(0.1, 5);
    r.send(ev({ t: 'runEnd', victory: false }));
    r.step(0.1, 50);
    expect(r.starts('sfx_metin_warn')).toHaveLength(1); // the two later alarms were cancelled
    r.send(runEv('bargain', 'announce', { id: 3, endAt: 160 }));
    expect(r.h.loops.count).toBe(0);
    // the lifecycle hook cleans up too
    const q = rig();
    q.at(100);
    q.send(runEv('goldenHour', 'active', { endAt: 145 }));
    q.h.adapter.runEnd(q.w);
    q.step(0.1, 100);
    expect(q.starts('sfx_yeop_pickup')).toHaveLength(0);
    const s = rig();
    s.at(95);
    s.send(runEv('bargain', 'announce', { endAt: 160 }));
    expect(s.h.loops.count).toBe(1);
    s.h.adapter.runEnd(s.w);
    expect(s.h.loops.count).toBe(0);
  });

  it('the host pause freezes the sim clock and with it the alarms; a long frame stall never bursts them', () => {
    const r = rig();
    r.at(95);
    r.send(runEv('metinRain', 'announce', { endAt: 150 }));
    r.step(0.1, 5);
    r.h.adapter.pauseChanged(true);
    r.step(0.5, 40, false); // 20 s of pause menu: the sim (w.time) stands still, the frames go on
    expect(r.starts('sfx_metin_warn')).toHaveLength(1);
    r.h.adapter.pauseChanged(false);
    r.step(0.1, 5);
    expect(r.starts('sfx_metin_warn')).toHaveLength(1); // 1.0 s of the 1.5 s gap played so far
    r.step(0.1, 7);
    expect(r.starts('sfx_metin_warn')).toHaveLength(2);
    r.step(0.1, 30);
    expect(r.starts('sfx_metin_warn')).toHaveLength(3);
    // a stalled tab: one frame that took 8 s, the sim catching up with it. The two late alarms are more than 1.5 s overdue and skipped: no burst, now or later
    const s = rig();
    s.at(95);
    s.send(runEv('metinRain', 'announce', { endAt: 150 }));
    s.step(8);
    expect(s.starts('sfx_metin_warn')).toHaveLength(1);
    s.step(0.1, 40);
    expect(s.starts('sfx_metin_warn')).toHaveLength(1);
    // two alarms due in one frame (a 3 s hitch, both within 1.5 s of their time): one in that frame, the next in the following one, in order
    const t = rig();
    t.at(95);
    t.send(runEv('metinRain', 'announce', { endAt: 150 }));
    t.step(3);
    expect(t.starts('sfx_metin_warn')).toHaveLength(2);
    t.step(0.6); // (the rule of the sound keeps 0.5 s between two alarms anyway)
    const warns = t.starts('sfx_metin_warn');
    expect(warns).toHaveLength(3);
    expect(warns.map((x) => t.level(x))).toEqual([0.55, 0.75, 0.95]);
    t.step(0.1, 40);
    expect(t.starts('sfx_metin_warn')).toHaveLength(3);
  });

  // ---- pact awakening -----------------------------------------------------------------------------------------------------------------
  it('a pact awakening pick plays the awaken sfx and, on its bells, a gold layer at the hero; other picks stay silent', () => {
    const r = rig();
    r.send(pick({ player: 1 }));
    const awaken = r.starts('sfx_awaken');
    expect(awaken).toHaveLength(1);
    expect(r.level(awaken[0] as FakeSource)).toBeCloseTo(0.7, 6);
    expect(r.pan(awaken[0] as FakeSource)).toBeNull();
    expect(r.starts('sfx_yeop_pile')).toHaveLength(0);
    r.step(0.1, 6);
    expect(r.starts('sfx_yeop_pile')).toHaveLength(0); // 0.6 s: not yet
    r.step(0.1, 2);
    const gold = r.starts('sfx_yeop_pile');
    expect(gold).toHaveLength(1);
    const dt = (gold[0]?.startedAt ?? 0) - (awaken[0]?.startedAt ?? 0);
    expect(dt).toBeGreaterThanOrEqual(0.65 - 0.001);
    expect(dt).toBeLessThanOrEqual(0.65 + 0.11);
    expect(spread(r.level(gold[0] as FakeSource), 0.5)).toBe(true);
    expect(r.pan(gold[0] as FakeSource)).toBeGreaterThan(0); // hero 1 stands at x = 6
    expect(r.peak).toBeLessThanOrEqual(2); // awaken + gold layer
    // the sim sends the awaken id as a generic 'sfx' event right after the card: it stays one start
    const both = rig();
    both.send(pick());
    both.send(ev({ t: 'sfx', id: 'sfx_awaken', x: 0, z: 0, vol: 0.7 }));
    expect(both.starts('sfx_awaken')).toHaveLength(1);
    // a card that is not an awakening (a plain rank-up, a passive, a pact-held G2) adds nothing
    const plain = rig();
    plain.send(pick({ awakening: false }));
    plain.send(pick({ awakening: false, kind: 'passiveUp', id: 'iron_will', rank: 2 }));
    plain.step(0.1, 30);
    expect(plain.ids()).toEqual([]);
  });

  it('an awakening during a bargain keeps the one-shot voices within 2; the pause holds the gold layer', () => {
    const r = rig();
    r.at(100);
    r.send(runEv('bargain', 'active', { endAt: 160 })); // the shrine loop is up
    r.send(pick());
    r.step(0.1, 60);
    expect(r.peak).toBeLessThanOrEqual(2);
    expect(r.starts('sfx_yeop_pile')).toHaveLength(1);
    const p = rig();
    p.send(pick());
    p.h.adapter.pauseChanged(true);
    p.step(0.5, 20);
    expect(p.starts('sfx_yeop_pile')).toHaveLength(0);
    p.h.adapter.pauseChanged(false);
    p.step(0.1, 9);
    expect(p.starts('sfx_yeop_pile')).toHaveLength(1);
  });

  it('a whole bargain stays within 2 voices (loop included) and a whole rain within 2', () => {
    const b = rig();
    b.at(95);
    b.send(runEv('bargain', 'announce', { endAt: 160 }));
    b.step(0.1, 50);
    b.at(100);
    b.send(runEv('bargain', 'active', { endAt: 160 }));
    b.step(0.1, 30);
    b.send(runEv('bargain', 'channel', { player: 0, p: 1 }));
    b.step(0.1, 50);
    expect(b.peakAll).toBeLessThanOrEqual(2);
    const m = rig();
    m.at(95);
    m.send(runEv('metinRain', 'announce', { endAt: 150 }));
    m.step(0.1, 60);
    expect(m.peak).toBeLessThanOrEqual(2);
  });

  // ---- decode: the once-per-run stingers (fix round) -----------------------------------------------------------------------------
  // sfx_bell_toll, sfx_aura_loop and sfx_holy_chime are in no download rank of audio/index.ts: without the 60 s request they would be fetched by
  // the first play(), which only starts the load and returns false.
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  };
  const fileOf = (id: string): string => `assets/audio/${id}.mp3`;
  /** a fetch that answers at once (the bytes are the url: FakeCtx.decodeAudioData names the buffer after them) and logs what it was asked for */
  const instantFetch = (): string[] => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (u: string) => (asked.push(u), { ok: true, arrayBuffer: async () => new TextEncoder().encode(u).buffer }));
    return asked;
  };
  /** a fetch that answers only after `release()` */
  const slowFetch = (): (() => void) => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    vi.stubGlobal('fetch', async (u: string) => {
      await held;
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode(u).buffer };
    });
    return release;
  };
  const BARGAIN_FILES = ['sfx_aura_loop', 'sfx_bell_toll', 'sfx_holy_chime'];
  const EVERY_CUE_FILE = ['sfx_aura_loop', 'sfx_bell_toll', 'sfx_boss_roar', 'sfx_holy_chime', 'sfx_metin_warn', 'sfx_yeop_pickup', 'sfx_yeop_pile'];

  it('the stingers no download rank lists are requested at 60 sim seconds, for the zone\'s own event kinds only, once', async () => {
    const asked = instantFetch();
    const r = rig({ undecoded: [...BARGAIN_FILES, 'sfx_yeop_pile', 'sfx_metin_warn'], events: { yeonmu: ['bargain', 'championHunt'] } });
    r.step(1, 59);
    await settle();
    expect(asked).toEqual([]); // 59 s: the payload window (HUD + 6 s) and the whole early run stay as they were
    r.step(0.5);
    await settle();
    expect(asked).toEqual([]);
    r.step(0.5); // 60 s
    await settle();
    // the bell, the loop and the chime of the bargain; the hunt's roar is decoded already, the rain and the golden hour are not this zone's
    expect([...asked].sort()).toEqual(BARGAIN_FILES.map(fileOf));
    r.step(1, 40);
    await settle();
    expect(asked).toHaveLength(3);
    // a new run asks again for what is missing then (here: the bell was evicted); what is decoded is left alone
    r.h.engine.evict(fileOf('sfx_bell_toll'));
    r.h.adapter.runStart(r.w);
    r.at(59);
    r.step(1, 3);
    await settle();
    expect(asked.slice(3)).toEqual([fileOf('sfx_bell_toll')]);
  });

  it('every kind asks for its own cue sounds; a zone without events, or with the events of another zone, asks for nothing', async () => {
    const cases: [Record<string, string[]> | undefined, string[]][] = [
      [{ yeonmu: ['metinRain'] }, ['sfx_metin_warn']],
      [{ yeonmu: ['goldenHour'] }, ['sfx_yeop_pickup', 'sfx_yeop_pile']],
      [{ yeonmu: ['championHunt'] }, ['sfx_boss_roar', 'sfx_holy_chime']],
      [{ yeonmu: ['bargain'] }, BARGAIN_FILES],
      [{ yeonmu: ['metinRain', 'championHunt', 'goldenHour', 'bargain'] }, EVERY_CUE_FILE], // the chime, listed twice, is asked for once
      [{ yeonmu: [] }, []],
      [{ seori: ['bargain'] }, []], // events elsewhere
      [undefined, []], // the shipped content: no zone lists any
    ];
    for (const [events, want] of cases) {
      const asked = instantFetch();
      const r = rig({ undecoded: EVERY_CUE_FILE, events });
      r.step(1, 70);
      await settle();
      expect([...asked].sort(), JSON.stringify(events)).toEqual(want.map(fileOf));
    }
  });

  it('once the stingers have arrived the bell, the loop and the chime play at their phases (a run whose class has none of them in its skills)', async () => {
    instantFetch();
    const r = rig({ undecoded: BARGAIN_FILES, events: { yeonmu: ['bargain'] } });
    r.step(1, 60);
    await settle();
    r.at(95);
    r.send(runEv('bargain', 'announce', { endAt: 160, x: 12, z: 3 }));
    expect(r.starts('sfx_bell_toll')).toHaveLength(1);
    expect(r.loopSources('sfx_aura_loop')).toHaveLength(1);
    r.step(0.1, 50);
    r.at(100);
    r.send(runEv('bargain', 'active', { endAt: 160, x: 12, z: 3 }));
    r.send(runEv('bargain', 'channel', { player: 0, p: 1, x: 12, z: 3 }));
    expect(r.starts('sfx_holy_chime')).toHaveLength(1);
    // the won hunt's chime is the same file
    const h = rig({ undecoded: ['sfx_holy_chime'], events: { yeonmu: ['championHunt'] } });
    h.step(1, 60);
    await settle();
    h.at(130);
    h.send(runEv('championHunt', 'end', { endAt: 130, p: 1 }));
    expect(h.starts('sfx_holy_chime')).toHaveLength(1);
  });

  it('a stinger that meets a buffer still decoding tries again every 0.2 s and plays once it is there; one that comes after its window never plays', async () => {
    const release = slowFetch();
    const r = rig({ undecoded: ['sfx_bell_toll', 'sfx_holy_chime'] });
    r.at(95);
    r.send(runEv('bargain', 'announce', { endAt: 160, x: 12, z: 3 }));
    expect(r.starts('sfx_bell_toll')).toHaveLength(0); // only started the load
    r.step(0.2, 3);
    expect(r.starts('sfx_bell_toll')).toHaveLength(0);
    release();
    await settle();
    r.step(0.25);
    expect(r.starts('sfx_bell_toll')).toHaveLength(1);
    r.step(0.2, 12);
    expect(r.starts('sfx_bell_toll')).toHaveLength(1); // it plays once
    // the channel chime goes through the same retry
    r.at(100);
    r.send(runEv('bargain', 'channel', { player: 1, p: 1, x: 12, z: 3 }));
    expect(r.starts('sfx_holy_chime')).toHaveLength(0); // its file is only being asked for now
    await settle();
    r.step(0.25);
    expect(r.starts('sfx_holy_chime')).toHaveLength(1);
    // a buffer that arrives after EV_LATE_S (1.5 s): the announce is over by then, the bell stays out
    const late = slowFetch();
    const q = rig({ undecoded: ['sfx_bell_toll'] });
    q.at(95);
    q.send(runEv('bargain', 'announce', { endAt: 160, x: 12, z: 3 }));
    q.step(0.2, 10); // 2 s
    late();
    await settle();
    q.step(0.2, 6);
    expect(q.starts('sfx_bell_toll')).toHaveLength(0);
    expect(q.h.engine.has(fileOf('sfx_bell_toll'))).toBe(true);
  });

  it('an awakening whose sounds are still decoding retries them too (the gold layer waits for its file)', async () => {
    const release = slowFetch();
    const r = rig({ undecoded: ['sfx_awaken', 'sfx_yeop_pile'] });
    r.send(pick());
    expect(r.starts('sfx_awaken')).toHaveLength(0);
    r.step(0.2, 2);
    release();
    await settle();
    r.step(0.25);
    expect(r.starts('sfx_awaken')).toHaveLength(1);
    await settle(); // the gold layer's file was asked for when its time came, a moment ago
    r.step(0.1, 10);
    expect(r.starts('sfx_yeop_pile')).toHaveLength(1);
  });

  // ---- the sim clock: modals, guests, stalls -------------------------------------------------------------------------------------
  it('a card modal (the sim frozen, no pauseChanged) holds the rain alarms and the shimmer; both go on with the sim', () => {
    const r = rig();
    r.at(95);
    r.send(runEv('metinRain', 'announce', { endAt: 150 }));
    r.step(0.1, 5); // 95.5
    r.step(0.5, 60, false); // a modal for 30 s: frames, no sim time, no pauseChanged
    expect(r.starts('sfx_metin_warn')).toHaveLength(1);
    r.step(0.1, 5); // 96.0
    expect(r.starts('sfx_metin_warn')).toHaveLength(1);
    r.step(0.1, 6); // 96.6: the second alarm is due at 96.5 of the sim
    expect(r.starts('sfx_metin_warn')).toHaveLength(2);
    r.step(0.1, 15);
    expect(r.starts('sfx_metin_warn')).toHaveLength(3);
    const g = rig();
    g.at(100);
    g.send(runEv('goldenHour', 'active', { endAt: 145 }));
    g.step(0.1, 20);
    const n = g.starts('sfx_yeop_pickup').length;
    expect(n).toBeGreaterThanOrEqual(1);
    g.step(0.5, 60, false); // 30 s frozen window
    expect(g.starts('sfx_yeop_pickup')).toHaveLength(n);
    g.step(0.1, 40);
    expect(g.starts('sfx_yeop_pickup').length).toBeGreaterThan(n);
  });

  it('a guest\'s pause overlay (pauseChanged while the shared sim runs on) keeps the alarms on the sim schedule, none after the fall', () => {
    const r = rig();
    r.at(95);
    r.send(runEv('metinRain', 'announce', { endAt: 150 }));
    r.step(0.1, 5);
    r.h.adapter.pauseChanged(true); // the overlay: the host's sim goes on
    r.step(0.1, 60); // 101.5, the stones fell at 100
    r.h.adapter.pauseChanged(false);
    r.step(0.1, 20);
    const warns = r.starts('sfx_metin_warn');
    expect(warns).toHaveLength(3);
    const t0 = warns[0]?.startedAt ?? 0;
    expect(near((warns[1]?.startedAt ?? 0) - t0, 1.5, 0.11)).toBe(true);
    expect(near((warns[2]?.startedAt ?? 0) - t0, 3, 0.11)).toBe(true);
    // the shimmer goes on under the overlay as well
    const g = rig();
    g.at(100);
    g.send(runEv('goldenHour', 'active', { endAt: 145 }));
    g.h.adapter.pauseChanged(true);
    g.step(0.1, 100);
    expect(g.starts('sfx_yeop_pickup').length).toBeGreaterThanOrEqual(3);
  });

  it('a guest that first sees the announce a second late hears the alarm it missed and the ones ahead of it; the event\'s end drops the rest', () => {
    const r = rig();
    r.at(96); // 1.0 s into the announce
    r.send(runEv('metinRain', 'announce', { endAt: 150 }));
    expect(r.starts('sfx_metin_warn')).toHaveLength(1);
    r.step(0.1, 40);
    expect(r.starts('sfx_metin_warn')).toHaveLength(3);
    const e = rig();
    e.at(95);
    e.send(runEv('metinRain', 'announce', { endAt: 150 }));
    e.step(0.1, 5);
    e.send(runEv('metinRain', 'end', { endAt: 95.5, p: 0 })); // the run ended during the announce
    e.step(0.1, 50);
    expect(e.starts('sfx_metin_warn')).toHaveLength(1);
  });

  // ---- an awakening and the first event ---------------------------------------------------------------------------------------------
  it('an awakening 0.2 s before the first announce of the run keeps its gold layer; only a run start or end clears it', () => {
    const r = rig();
    r.at(94.8);
    r.send(pick());
    r.step(0.2); // 95.0
    r.send(runEv('metinRain', 'announce', { endAt: 150 })); // evId -1 -> 1: clears the event's cues, not the awakening's
    r.step(0.1, 8);
    expect(r.starts('sfx_yeop_pile')).toHaveLength(1);
    expect(r.starts('sfx_awaken')).toHaveLength(1);
    // the same through a second event id
    const n = rig();
    n.at(95);
    n.send(runEv('bargain', 'announce', { id: 1, endAt: 160 }));
    n.send(pick());
    n.send(runEv('metinRain', 'announce', { id: 2, startAt: 100, endAt: 150 }));
    n.step(0.1, 8);
    expect(n.starts('sfx_yeop_pile')).toHaveLength(1);
    // a run end (the hook, the event) and a run start do clear it
    const a = rig();
    a.send(pick());
    a.h.adapter.runEnd(a.w);
    a.step(0.1, 20);
    expect(a.starts('sfx_yeop_pile')).toHaveLength(0);
    const b = rig();
    b.send(pick());
    b.send(ev({ t: 'runEnd', victory: true }));
    b.step(0.1, 20);
    expect(b.starts('sfx_yeop_pile')).toHaveLength(0);
    const c = rig();
    c.send(pick());
    c.h.adapter.runStart(c.w);
    c.step(0.1, 20);
    expect(c.starts('sfx_yeop_pile')).toHaveLength(0);
  });

  // ---- a lost 'end': the shrine loop is bounded -----------------------------------------------------------------------------------------
  it('a bargain whose end never arrives: the loop stops 6.5 s after its last heartbeat and never runs past the planned end; a heartbeat brings it back', () => {
    const r = rig();
    r.at(95);
    r.send(runEv('bargain', 'announce', { endAt: 160, x: 12, z: 3 }));
    r.step(0.1, 50);
    r.at(100);
    r.send(runEv('bargain', 'active', { endAt: 160, x: 12, z: 3 })); // the last heartbeat the guest saw
    expect(r.h.loops.count).toBe(1);
    r.step(0.1, 60); // 6.0 s of silence
    expect(r.h.loops.count).toBe(1);
    r.step(0.1, 6); // past 6.5 s
    expect(r.h.loops.count).toBe(0);
    expect(r.loopSources('sfx_aura_loop')[0]?.stopped).toBe(true);
    r.step(0.1, 50);
    expect(r.h.loops.count).toBe(0); // and it stays out
    // the event is still running after all: the next heartbeat starts the hum again
    r.send(runEv('bargain', 'active', { endAt: 160, x: 12, z: 3 }));
    expect(r.h.loops.count).toBe(1);
    expect(r.loopSources('sfx_aura_loop')).toHaveLength(2);
    // a heartbeat every 5 s keeps it up, up to the planned end and not a frame beyond
    for (let i = 0; i < 10; i++) {
      r.step(0.1, 50);
      r.send(runEv('bargain', 'active', { endAt: 160, x: 12, z: 3 }));
      expect(r.h.loops.count).toBe(r.w.time < 160 ? 1 : 0);
    }
    expect(r.w.time).toBeGreaterThan(160);
    expect(r.h.loops.count).toBe(0);
    // a channel event of the same id is a sign of life too
    const c = rig();
    c.at(100);
    c.send(runEv('bargain', 'active', { endAt: 160 }));
    c.step(0.1, 55);
    c.send(runEv('bargain', 'channel', { player: 0, p: 0.5 }));
    c.step(0.1, 55);
    expect(c.h.loops.count).toBe(1);
    c.step(0.1, 20);
    expect(c.h.loops.count).toBe(0);
    // an 'end' that does arrive is not undone by a stale heartbeat of the same event
    const e = rig();
    e.at(100);
    e.send(runEv('bargain', 'active', { endAt: 160 }));
    e.send(runEv('bargain', 'end', { endAt: 110, p: 1 }));
    expect(e.h.loops.count).toBe(0);
    e.send(runEv('bargain', 'active', { endAt: 160 }));
    expect(e.h.loops.count).toBe(0);
  });

  // ---- a hunt that cannot start ----------------------------------------------------------------------------------------------------
  it('a hunt that cannot start (active and end p = 0 in one dispatch) never roars; a normal start roars within one frame', () => {
    const r = rig();
    r.at(100);
    r.send(runEv('championHunt', 'active', { endAt: 160 }));
    r.send(runEv('championHunt', 'end', { endAt: 100, p: 0 }));
    r.step(0.1, 40);
    expect(r.starts('sfx_boss_roar')).toHaveLength(0);
    expect(r.starts('sfx_holy_chime')).toHaveLength(0);
    const n = rig();
    n.at(100);
    n.send(runEv('championHunt', 'active', { endAt: 160 }));
    n.step(0.016);
    expect(n.starts('sfx_boss_roar')).toHaveLength(1);
    // a hunt slain in its first seconds: the roar played, the chime follows
    n.at(104);
    n.send(runEv('championHunt', 'end', { endAt: 104, p: 1 }));
    expect(n.starts('sfx_holy_chime')).toHaveLength(1);
  });

  // ---- the numbers the audio package keeps for the sim ---------------------------------------------------------------------------------
  it('keeps the sim\'s announce lead and heartbeat bound as its own numbers', () => {
    expect(EV_ANNOUNCE_S).toBe(RUN_EVENT_ANNOUNCE);
    expect(EV_STALE_S).toBe(RUN_EVENT_HEARTBEAT + RUN_EVENT_REFRESH_GRACE);
    // and no registered kind sets a lead of its own (a shorter one would make its host-side stingers read as late)
    for (const kind of ['metinRain', 'championHunt', 'goldenHour', 'bargain']) {
      expect(runEventKindDef(kind), kind).toBeDefined();
      expect(runEventKindDef(kind)?.announce ?? RUN_EVENT_ANNOUNCE, kind).toBe(EV_ANNOUNCE_S);
    }
  });
});

describe('Audio resilience, pause muffle recovery, and stinger cancellation (AUDIO-01..03)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
  });

  it('AUDIO-01: retries transient 503/network failures after backoff or evict, keeps 404 permanent, and resets MusicPlayer.wantUrl on failure', async () => {
    let nowMs = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    let calls = 0;
    vi.stubGlobal('fetch', async (u: string) => {
      calls++;
      if (u.includes('missing_404')) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
      if (calls === 1) return { ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) };
      return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(u).buffer };
    });

    const h = harness({ undecoded: ['mus_yeonmu', 'mus_yeonmu_calm', 'mus_yeonmu_combat'] });
    const url = 'assets/audio/mus_yeonmu.mp3';

    // First music.play hits 503: fails transiently, resets wantUrl, enters backoff cooldown.
    h.music.play('mus_yeonmu');
    await h.flush();
    expect(calls).toBe(1);
    expect(h.engine.hasFailed(url)).toBe(true);
    expect(h.music.currentUrl).toBe('');

    // During cooldown, immediate load does NOT storm fetch.
    expect(await h.engine.load(url)).toBeNull();
    expect(calls).toBe(1);

    // After backoff expires, hasFailed clears and music.play retries cleanly and succeeds!
    nowMs += AUDIO_RETRY_BASE_MS + 10;
    expect(h.engine.hasFailed(url)).toBe(false);
    h.music.play('mus_yeonmu');
    await h.flush();
    expect(calls).toBe(2);
    expect(h.engine.has(url)).toBe(true);
    expect(h.music.currentUrl).toBe(url);

    // Explicit evict also clears transient failure immediately without waiting for backoff.
    let failNext = true;
    let calls2 = 0;
    vi.stubGlobal('fetch', async (u: string) => {
      calls2++;
      if (failNext) {
        failNext = false;
        throw new TypeError('offline');
      }
      return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(u).buffer };
    });
    const transientUrl = 'assets/audio/sfx_transient.mp3';
    expect(await h.engine.load(transientUrl)).toBeNull();
    expect(calls2).toBe(1);
    expect(h.engine.hasFailed(transientUrl)).toBe(true);
    h.engine.evict(transientUrl);
    expect(h.engine.hasFailed(transientUrl)).toBe(false);
    expect(await h.engine.load(transientUrl)).not.toBeNull();
    expect(calls2).toBe(2);

    // Permanent 404 stays failed even after cooldown elapses (until explicit evict).
    let calls404 = 0;
    vi.stubGlobal('fetch', async () => {
      calls404++;
      return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    });
    const url404 = 'assets/audio/missing_404.mp3';
    expect(await h.engine.load(url404)).toBeNull();
    nowMs += 60_000;
    expect(h.engine.hasFailed(url404)).toBe(true);
    expect(await h.engine.load(url404)).toBeNull();
    expect(calls404).toBe(1);
  });

  it('AUDIO-02: pause -> quit -> menu -> next run restores unmuffled music filter frequency', async () => {
    const h = harness({ beds: true });
    const musicFilter = h.engine.musicFilter as unknown as FakeFilter;

    // Start run, then pause: music filter drops to 700 Hz.
    h.adapter.runStart(world);
    await h.flush();
    h.adapter.pauseChanged(true);
    expect(musicFilter.frequency.value).toBe(700);

    // Quit from pause menu (runEnd without resume) and return to menu music!
    h.adapter.runEnd(world);
    h.adapter.setZoneMusic('menu', 'menu');
    await h.flush();
    expect(musicFilter.frequency.value).toBeGreaterThan(700);

    // Repeat pause -> quit -> straight to next runStart without calling setZoneMusic in between!
    h.adapter.runStart(world);
    await h.flush();
    h.adapter.pauseChanged(true);
    expect(musicFilter.frequency.value).toBe(700);

    h.adapter.runStart(world);
    await h.flush();
    // Calm intensity (0) opens to 4200 Hz, NOT stuck at 700 Hz!
    expect(musicFilter.frequency.value).toBeCloseTo(4200, 1);

    // Combat intensity (1) opens all the way to 22000 Hz!
    h.music.setIntensity(1);
    expect(musicFilter.frequency.value).toBeCloseTo(22000, 1);
  });

  it('AUDIO-03: pending and active stingers are cancelled/stopped by stop(), starting a new track, and dispose()', async () => {
    // 1) Pending stinger overtaken by dispose() never starts when delayed fetch resolves.
    let resolveFetch!: () => void;
    vi.stubGlobal('fetch', async (u: string) => {
      await new Promise<void>((r) => {
        resolveFetch = r;
      });
      return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(u).buffer };
    });

    const h1 = harness({ undecoded: ['mus_victory'] });
    h1.music.playStinger('mus_victory');
    h1.music.dispose();
    resolveFetch();
    await h1.flush();
    expect(h1.played('mus_victory')).toBe(0);

    // 2) Pending stinger overtaken by stop() or play(newTrack) never starts.
    const h2 = harness({ undecoded: ['mus_defeat'] });
    h2.music.playStinger('mus_defeat');
    h2.music.stop();
    resolveFetch();
    await h2.flush();
    expect(h2.played('mus_defeat')).toBe(0);

    const h3 = harness({ undecoded: ['mus_victory'] });
    h3.music.playStinger('mus_victory');
    h3.music.play('mus_menu');
    resolveFetch();
    await h3.flush();
    expect(h3.played('mus_victory')).toBe(0);
    expect(h3.played('mus_menu')).toBe(1);

    // 3) Already-started active stinger is stopped when stop(), play(), or dispose() runs.
    const h4 = harness();
    h4.music.playStinger('mus_victory');
    await h4.flush();
    const stinger1 = sources.find((s) => s.buffer?.name.includes('mus_victory'));
    expect(stinger1?.startedAt).toBeGreaterThanOrEqual(0);
    expect(stinger1?.stopped).toBe(false);
    h4.music.stop();
    expect(stinger1?.stopped).toBe(true);

    h4.music.playStinger('mus_defeat');
    await h4.flush();
    const stinger2 = sources.find((s) => s.buffer?.name.includes('mus_defeat'));
    expect(stinger2?.stopped).toBe(false);
    h4.music.play('mus_menu');
    expect(stinger2?.stopped).toBe(true);

    h4.music.playStinger('mus_victory');
    await h4.flush();
    const stinger3 = sources.filter((s) => s.buffer?.name.includes('mus_victory')).at(-1);
    expect(stinger3?.stopped).toBe(false);
    h4.music.dispose();
    expect(stinger3?.stopped).toBe(true);
  });
});
