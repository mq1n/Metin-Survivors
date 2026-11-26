// Payload policy of createAudio (src/audio/index.ts): what is fetched at boot, at the first gesture and during a run.
// A minimal fake WebAudio graph + a recording fetch stand in for the browser (node environment).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioAsset } from '../data/assetManifest';
import type { World } from '../sim/world';
import { createAudio } from './index';

class Param {
  value = 0;
  setTargetAtTime(): void {}
  setValueAtTime(): void {}
  linearRampToValueAtTime(): void {}
  cancelScheduledValues(): void {}
}
class Node0 {
  connect<T>(n: T): T {
    return n;
  }
  disconnect(): void {}
}
class Source extends Node0 {
  buffer: { url: string } | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  playbackRate = new Param();
  onended: (() => void) | null = null;
  started = false;
  start(): void {
    this.started = true;
  }
  stop(): void {}
}
const sources: Source[] = [];
class Ctx {
  currentTime = 0;
  state = 'running';
  destination = new Node0();
  createGain = (): Node0 & { gain: Param } => Object.assign(new Node0(), { gain: new Param() });
  createBufferSource = (): Source => {
    const s = new Source();
    sources.push(s);
    return s;
  };
  createStereoPanner = (): Node0 & { pan: Param } => Object.assign(new Node0(), { pan: new Param() });
  createBiquadFilter = (): Node0 & { type: string; frequency: Param; Q: Param } => Object.assign(new Node0(), { type: '', frequency: new Param(), Q: new Param() });
  createDynamicsCompressor = (): Node0 => Object.assign(new Node0(), { threshold: new Param(), knee: new Param(), ratio: new Param(), attack: new Param(), release: new Param() });
  decodeAudioData = async (_b: ArrayBuffer): Promise<AudioBuffer> => ({ duration: 100 }) as unknown as AudioBuffer;
  addEventListener(): void {}
  resume = (): Promise<void> => Promise.resolve();
  suspend = (): Promise<void> => Promise.resolve();
  close = (): Promise<void> => Promise.resolve();
}

const url = (id: string): string => `a/${id}.mp3`;
const sfx = (id: string, over: Partial<AudioAsset> = {}): AudioAsset => ({ id, url: url(id), kind: 'sfx', duration: 0.5, bytes: 1, gain: 1, ...over });
const track = (id: string, file = id): AudioAsset => ({ id, url: url(file), kind: 'music', duration: 100, bytes: 1, gain: 1, loop: true, loopStart: 0, loopEnd: 100 });

function manifest(): Record<string, AudioAsset> {
  const m: Record<string, AudioAsset> = {};
  // MENU, HOT, a class skill (warrior / ninja), trickle ranks 0..3 and an unranked one
  for (const id of ['sfx_ui_click', 'sfx_forge_success', 'sfx_hit_flesh', 'sfx_card_pick', 'sfx_run_start', 'sfx_sword_swing_light']) m[id] = sfx(id);
  for (const id of ['sfx_buff_cast', 'sfx_dagger', 'sfx_death_ice', 'sfx_metin_warning', 'sfx_boss_spawn', 'sfx_wolf_howl', 'sfx_ground_slam', 'sfx_misc']) m[id] = sfx(id);
  m['sfx_metin_pulse'] = sfx('sfx_metin_pulse', { kind: 'ambience', loop: true });
  m['mus_menu'] = track('mus_menu');
  m['mus_boss'] = track('mus_boss');
  m['mus_yeonmu'] = track('mus_yeonmu');
  m['mus_yeonmu_calm'] = track('mus_yeonmu_calm', 'mus_yeonmu');
  m['mus_yeonmu_combat'] = track('mus_yeonmu_combat', 'mus_yeonmu');
  m['mus_yeonmu_boss'] = track('mus_yeonmu_boss', 'mus_boss');
  return m;
}

/** + the zone ambience beds a build ships (AG-01: 48 s loops, kind 'ambience'); Yeonmu's and Seori's */
function bedManifest(): Record<string, AudioAsset> {
  const m = manifest();
  for (const id of ['amb_yeonmu', 'amb_seori']) m[id] = sfx(id, { kind: 'ambience', loop: true, loopStart: 0, loopEnd: 48, duration: 48 });
  return m;
}

const world = {
  time: 0,
  zone: {
    id: 'yeonmu',
    music: { calm: 'mus_yeonmu_calm', combat: 'mus_yeonmu_combat', boss: 'mus_yeonmu_boss' },
    bosses: [{ at: 180, boss: 'boss_a' }],
    final: { at: 900, boss: 'boss_b' },
  },
  players: [{ classId: 'warrior', x: 0, z: 0, sex: 'm' }],
  content: { skills: [{ classId: 'warrior', sfx: 'sfx_buff_cast' }, { classId: 'ninja', sfx: 'sfx_dagger' }, { classId: 'common', sfx: 'sfx_sword_swing_light' }] },
  ix: { bosses: new Map([['boss_a', { music: 'mus_boss', patterns: [{ sfx: 'sfx_ground_slam' }] }]]) },
  typeDefs: [],
} as unknown as World & { time: number };

let fetched: string[] = [];
const files = (...ids: string[]): string[] => ids.map(url).sort();

describe('audio payload policy', () => {
  beforeEach(() => {
    fetched = [];
    sources.length = 0;
    (globalThis as { AudioContext?: unknown }).AudioContext = Ctx;
    vi.stubGlobal('fetch', async (u: string) => {
      fetched.push(String(u));
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    });
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
  });

  it('boot fetches the menu sounds only; the menu track waits for the first gesture, which also brings the in-run core', async () => {
    const audio = createAudio(manifest(), null, { autoUnlock: false, resolveUrl: (p) => p });
    audio.setZoneMusic('menu', 'calm');
    await vi.advanceTimersByTimeAsync(10);
    expect(fetched.sort()).toEqual(files('sfx_ui_click', 'sfx_forge_success'));

    audio.unlock(); // first gesture
    await vi.advanceTimersByTimeAsync(10);
    expect(fetched.sort()).toEqual(files('mus_menu', 'sfx_card_pick', 'sfx_forge_success', 'sfx_hit_flesh', 'sfx_run_start', 'sfx_sword_swing_light', 'sfx_ui_click'));
    // decoded after the context exists → the menu music actually plays (it never did when decoded before the gesture)
    expect(sources.some((s) => s.loop && s.started && s.buffer !== null)).toBe(true);
    audio.dispose();
  });

  it('a run fetches its class skills at once, its music 10 s in, trickles its other sounds, boss assets only near the first boss', async () => {
    const audio = createAudio(manifest(), null, { autoUnlock: false, resolveUrl: (p) => p });
    audio.unlock();
    await vi.advanceTimersByTimeAsync(10);
    fetched = [];

    world.time = 0;
    audio.lifecycle.runStart(world);
    await vi.advanceTimersByTimeAsync(10);
    // the warrior's skill sounds; not the ninja's, not the boss track (the first boss is minutes away); the zone music
    // waits (the menu theme keeps playing): the first seconds' payload belongs to the world
    expect(fetched.sort()).toEqual(files('sfx_buff_cast'));

    await vi.advanceTimersByTimeAsync(2000);
    expect(fetched.length).toBe(2); // the trickle has begun: one file
    await vi.advanceTimersByTimeAsync(20);
    expect(fetched.length).toBe(2); // …and waits a gap before the next
    await vi.advanceTimersByTimeAsync(1000);
    audio.update(world, 0.016);
    await vi.advanceTimersByTimeAsync(1000);
    // combat feedback → metins; boss assets wait for the gate; other classes' skills / unlisted sounds: first use only
    expect(fetched.slice(1)).toEqual(['sfx_death_ice', 'sfx_metin_warning', 'sfx_metin_pulse'].map(url));
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetched).not.toContain(url('mus_yeonmu')); // 9 s in
    await vi.advanceTimersByTimeAsync(1500);
    expect(fetched.slice(4)).toEqual([url('mus_yeonmu')]); // 10 s in: the zone music

    world.time = 95; // first boss at 180 s, lead 90 s
    audio.update(world, 0.016);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetched.slice(5)).toEqual(['mus_boss', 'sfx_boss_spawn', 'sfx_wolf_howl', 'sfx_ground_slam'].map(url));
    expect(fetched).not.toContain(url('sfx_dagger'));
    expect(fetched).not.toContain(url('sfx_misc'));

    // a later run fetches nothing twice; runEnd stops a trickle that is still going
    fetched = [];
    audio.lifecycle.runEnd(world);
    audio.lifecycle.runStart(world);
    audio.lifecycle.runEnd(world);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetched).toEqual([]);
    audio.dispose();
  });

  /** `n` rendered run frames of `dt` seconds, the clock moving with them */
  async function frames(audio: ReturnType<typeof createAudio>, n: number, dt: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      audio.update(world, dt);
      await vi.advanceTimersByTimeAsync(dt * 1000);
    }
  }

  it('production: the zone music is fetched 9 s after the run has shown steady frames, however long the load and the first frames took', async () => {
    const audio = createAudio(manifest(), null, { autoUnlock: false, resolveUrl: (p) => p, musicAfterHud: true });
    audio.unlock();
    await vi.advanceTimersByTimeAsync(10);
    fetched = [];

    world.time = 0;
    audio.lifecycle.runStart(world);
    await vi.advanceTimersByTimeAsync(60_000); // a slow load: the run is on, the host has not drawn a frame yet
    expect(fetched).not.toContain(url('mus_yeonmu'));
    await frames(audio, 40, 0.25); // the first frames stall (programs compile): they never start the countdown
    expect(fetched).not.toContain(url('mus_yeonmu'));
    await frames(audio, 29, 0.016);
    await frames(audio, 1, 0.3); // a hitch resets the run of steady frames
    await frames(audio, 30, 0.016); // 30 in a row: the countdown starts
    await vi.advanceTimersByTimeAsync(8_000);
    expect(fetched).not.toContain(url('mus_yeonmu')); // 8.5 s later: still nothing (the gate window ends at HUD + 6 s)
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetched).toContain(url('mus_yeonmu'));
    // it starts when it is ready (not needed earlier): the track plays
    expect(sources.some((s) => s.loop && s.started && s.buffer !== null)).toBe(true);
    audio.dispose();
  });

  it('production: frames that never get steady still bring the music, 30 s after the first frame plus 9 s', async () => {
    const audio = createAudio(manifest(), null, { autoUnlock: false, resolveUrl: (p) => p, musicAfterHud: true });
    audio.unlock();
    await vi.advanceTimersByTimeAsync(10);
    fetched = [];
    world.time = 0;
    audio.lifecycle.runStart(world);
    await frames(audio, 100, 0.25); // 25 s at 4 fps
    expect(fetched).not.toContain(url('mus_yeonmu'));
    await frames(audio, 24, 0.25); // the frame at 30 s opens the countdown: due at 39 s, it is 31 s now
    expect(fetched).not.toContain(url('mus_yeonmu'));
    await vi.advanceTimersByTimeAsync(7_000);
    expect(fetched).not.toContain(url('mus_yeonmu'));
    await vi.advanceTimersByTimeAsync(1_500);
    expect(fetched).toContain(url('mus_yeonmu'));
    audio.dispose();
  });

  it('production: a run that ends before its music is due never fetches it', async () => {
    const audio = createAudio(manifest(), null, { autoUnlock: false, resolveUrl: (p) => p, musicAfterHud: true });
    audio.unlock();
    await vi.advanceTimersByTimeAsync(10);
    fetched = [];
    world.time = 0;
    audio.lifecycle.runStart(world);
    await frames(audio, 40, 0.016);
    audio.lifecycle.runEnd(world);
    await frames(audio, 30, 0.016);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetched).not.toContain(url('mus_yeonmu'));
    audio.dispose();
  });

  it('dev (default under vitest): the zone music is fetched 10 s after the run starts, frames or not', async () => {
    const audio = createAudio(manifest(), null, { autoUnlock: false, resolveUrl: (p) => p, musicAfterHud: false });
    audio.unlock();
    await vi.advanceTimersByTimeAsync(10);
    fetched = [];
    world.time = 0;
    audio.lifecycle.runStart(world);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(fetched).not.toContain(url('mus_yeonmu'));
    await vi.advanceTimersByTimeAsync(1_500);
    expect(fetched).toContain(url('mus_yeonmu'));
    audio.dispose();
  });

  it('preload: false preloads no sound effects on its own', async () => {
    const audio = createAudio(manifest(), null, { autoUnlock: false, preload: false, resolveUrl: (p) => p });
    audio.unlock();
    audio.setZoneMusic('menu', 'calm');
    audio.lifecycle.runStart(world);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetched.filter((u) => u.includes('/sfx_'))).toEqual([]);
    expect(fetched).toContain(url('mus_yeonmu')); // what is played still loads
    audio.dispose();
  });
  // ---- zone ambience bed (AR-01): a background rank behind the zone music ---------------------------------------------
  const ambFetched = (): string[] => fetched.filter((u) => u.includes('/amb_'));
  /** started loops by length: the zone track is 100 s, a bed 48 s */
  const loopsOf = (len: number): Source[] => sources.filter((s) => s.loop && s.started && s.loopEnd === len);

  it("the zone bed is a background rank: never in the gated window, after the zone music, only this zone's, once", async () => {
    const audio = createAudio(bedManifest(), null, { autoUnlock: false, resolveUrl: (p) => p, musicAfterHud: true });
    audio.unlock();
    await vi.advanceTimersByTimeAsync(10);
    fetched = [];

    world.time = 0;
    audio.lifecycle.runStart(world);
    await vi.advanceTimersByTimeAsync(60_000); // a slow load: no frame yet
    expect(ambFetched()).toEqual([]);
    await frames(audio, 40, 0.25); // stalled first frames
    await frames(audio, 30, 0.016); // 30 steady frames: the countdown starts (HUD)
    await vi.advanceTimersByTimeAsync(8_000); // HUD + 8 s: past the gate's window (HUD + 6 s), the music is due at +9 s
    expect(fetched).not.toContain(url('mus_yeonmu'));
    expect(ambFetched()).toEqual([]);
    expect(loopsOf(48)).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1_000); // the zone music is fetched…
    expect(fetched).toContain(url('mus_yeonmu'));
    await frames(audio, 4, 0.016); // …decoded: the bed's rank opens
    expect(ambFetched()).toEqual([url('amb_yeonmu')]);
    expect(fetched.indexOf(url('amb_yeonmu'))).toBeGreaterThan(fetched.indexOf(url('mus_yeonmu')));
    await frames(audio, 4, 0.016); // …and the bed starts after the music did
    expect(loopsOf(100)).toHaveLength(1);
    expect(loopsOf(48)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_000);
    audio.update(world, 0.016);
    expect(ambFetched()).toEqual([url('amb_yeonmu')]); // once; the other zone's bed is never fetched
    audio.dispose();
  });

  it('a second run of the zone replays the decoded bed without a request; an ended run never starts it', async () => {
    const audio = createAudio(bedManifest(), null, { autoUnlock: false, resolveUrl: (p) => p, musicAfterHud: false });
    audio.unlock();
    await vi.advanceTimersByTimeAsync(10);
    world.time = 0;
    audio.lifecycle.runStart(world);
    await vi.advanceTimersByTimeAsync(10_500); // dev: the zone music 10 s in
    await frames(audio, 8, 0.016);
    expect(loopsOf(48)).toHaveLength(1);
    audio.lifecycle.runEnd(world);

    fetched = [];
    audio.lifecycle.runStart(world); // music and bed are decoded already: both start at once, nothing is requested
    await frames(audio, 3, 0.016);
    expect(fetched.filter((u) => u.includes('/amb_') || u.includes('/mus_'))).toEqual([]);
    expect(loopsOf(48)).toHaveLength(2);
    audio.lifecycle.runEnd(world);
    audio.dispose();

    // a run that ends before its music is due never fetches the bed either
    const early = createAudio(bedManifest(), null, { autoUnlock: false, resolveUrl: (p) => p, musicAfterHud: true });
    early.unlock();
    await vi.advanceTimersByTimeAsync(10);
    const decodedBefore = loopsOf(48).length;
    fetched = [];
    early.lifecycle.runStart(world);
    await frames(early, 40, 0.016);
    early.lifecycle.runEnd(world);
    await frames(early, 30, 0.016);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ambFetched()).toEqual([]);
    expect(loopsOf(48)).toHaveLength(decodedBefore);
    early.dispose();
  });

  it('beds are not a sound tier: preload("all") leaves them to their run; a manifest without a bed fetches none', async () => {
    const audio = createAudio(bedManifest(), null, { autoUnlock: false, resolveUrl: (p) => p });
    audio.unlock();
    await audio.preload('all');
    expect(ambFetched()).toEqual([]);
    audio.dispose();

    const plain = createAudio(manifest(), null, { autoUnlock: false, resolveUrl: (p) => p, musicAfterHud: false });
    plain.unlock();
    await vi.advanceTimersByTimeAsync(10);
    fetched = [];
    world.time = 0;
    plain.lifecycle.runStart(world);
    await vi.advanceTimersByTimeAsync(10_500);
    await frames(plain, 600, 0.05);
    expect(ambFetched()).toEqual([]);
    expect(fetched).toContain(url('mus_yeonmu'));
    expect(loopsOf(48)).toHaveLength(0);
    plain.dispose();
  });
});
