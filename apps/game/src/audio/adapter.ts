// Sim events → sounds + adaptive music. Pure routing/decision logic; all playback goes through SfxPlayer / LoopBank /
// MusicPlayer. Reads the (pooled) event objects synchronously; retains nothing.
import type { AudioAsset } from '../data/assetManifest';
import type { EnemyDef } from '../data/schema';
import type { CardPickEvent, RunEventEvent, SimEvent } from '../sim/events';
import type { World } from '../sim/world';
import { AMB_FADE_OUT_S, DUCK_DENSITY_MAX_DB, type AmbienceBed, type AudioEngine } from './engine';
import type { MusicPlayer } from './music';
import { EVENT_DRIVEN, type SfxResolver } from './rules';
import type { LoopBank, PlayOpts, SfxPlayer } from './sfx';

export type MusicMode = 'menu' | 'calm' | 'combat' | 'boss' | 'off';

// PickupKind / ElementIdx / HealSource mirrors (sim/stores.ts, sim/events.ts: const enums, kept numeric on purpose)
const PICKUP_XP = 0;
const PICKUP_YEOP = 1;
const PICKUP_HEAL = 2;
const ELEMENT_FIRE = 1;
const HEAL_SKILL = 3;
const HEAL_CARD = 4;
const ATTACK_MELEE = 0;
const ATTACK_RANGED = 1;
const ATTACK_CHARGE = 2;
const ATTACK_LEAP = 3;
const ATTACK_EXPLODE = 4;
const ATTACK_BREATH = 6;

const LADDER: readonly string[] = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `sfx_xp_pickup_0${n}`);
const LADDER_TOP = LADDER.length - 1;
const LADDER_TIMEOUT = 0.9;

const RACE_DEATH: Readonly<Record<string, string>> = {
  animal: 'sfx_death_animal',
  orc: 'sfx_death_orc',
  esoteric: 'sfx_death_mystic',
  undead: 'sfx_death_undead',
  devil: 'sfx_death_fire',
  insect: 'sfx_death_generic',
  desert: 'sfx_death_animal',
  ice: 'sfx_death_ice',
  fire: 'sfx_death_fire',
  dragon: 'sfx_death_golem',
  human: 'sfx_death_orc',
  metin: 'sfx_death_golem',
};

const ATTACK_DEFAULT: readonly (string | null)[] = [
  'sfx_enemy_swipe', // melee
  'sfx_enemy_magic_cast', // ranged
  'sfx_enemy_whoosh_heavy', // charge
  'sfx_enemy_slam', // leap
  'sfx_explosion_small', // explode
  null, // aura
  'sfx_boss_breath', // breath
];

const HEAT_ON = 7;
const HEAT_OFF = 2.5;

// AR-02: the music ducks by SFX density. The load is the smoothed number of playing SFX voices (the pool holds 40); from
// DENSITY_LO the music sinks (smoothstep) to DUCK_DENSITY_MAX_DB at DENSITY_HI. A late fight measured 22 voices on average
// (p95 34), a quiet stretch 0-6. The engine adds the 50 ms attack / 600 ms release; the adapter only moves in 0.25 dB steps.
const DENSITY_TAU = 0.35;
const DENSITY_LO = 10;
const DENSITY_HI = 34;
const DENSITY_STEP_DB = 0.25;

// EV-04: run events (sim 'runEvent': announce -> active -> end, plus the shrine's 'channel') and pact awakenings get their own cues, all
// from existing manifest sounds. The mapping, by kind and phase (the code of onRunEvent / onChannel / onAwakening is the same table):
//   metinRain     announce  sfx_metin_warn x3, flat, 1.5 s apart, rising (0.55 / 0.75 / 0.95), at fixed SIM times (announce start + 0 / 1.5 / 3)
//   championHunt  announce  sfx_boss_roar, flat, 0.55 (the call)            active  sfx_boss_roar at the champion, 0.9 (it stands; one frame
//                 later, dropped when the same dispatch ends the hunt: a champion that never stood does not roar)
//                 end       sfx_holy_chime, flat, 0.6 (only a won hunt, p = 1)
//   goldenHour    announce  sfx_yeop_pile, flat, 0.75                       active  a coin shimmer (sfx_yeop_pickup, flat, soft, pitched
//                 up) every 2.2-3.6 SIM seconds until the window's endAt   end     the shimmer stops
//   bargain       announce  sfx_bell_toll at the shrine, 0.55 + sfx_aura_loop (LoopBank, positional) for as long as the shrine exists
//                 (announce .. end, or the planned endAt, or 6.5 sim s without a refresh: a lost 'end' never leaves the hum running);
//                 channel  sfx_holy_chime at the shrine, 0.6, once per hero when its channel completes (p = 1)
//   pact awakening (cardPick with awakening)  sfx_awaken + 0.65 s later sfx_yeop_pile (the gold layer) at the hero, 0.5
// Clocks. Sim-clock cues (the rain alarms, the shimmer, the shrine's bounds) run on w.time: a card / chest modal freezes the sim without a
// pause event and so freezes them, and a co-op guest's pause overlay (the shared sim runs on) does not hold them. Real-time cues (the gold
// layer, the decode retries, the shrine's start retries) run on `evT`, the clock of the rendered frames, frozen while paused.
// Decode. The once-per-run stingers (sfx_bell_toll, sfx_aura_loop, sfx_holy_chime) are in no download rank of audio/index.ts: at 60 sim seconds
// the adapter asks for the sounds of the zone's own event kinds (nothing for a zone without events), and a stinger that still meets an
// undecoded buffer retries every 0.2 s for EV_LATE_S.
// Voices: at most 2 one-shots at a time (the rain's overlapping alarms, the awaken pair, a bell or chime over nothing else); the shrine's loop is the
// LoopBank's single voice. Nothing here allocates per event or per frame.

/** seconds the announce phase lasts (sim/runEvents.ts RUN_EVENT_ANNOUNCE; numeric on purpose: the audio package imports no sim value). Keep in sync: a test compares. */
export const EV_ANNOUNCE_S = 5;
/**
 * A phase seen for the first time more than this many sim seconds after it began (a co-op guest that joined or resynced mid-event: the
 * host re-emits the running state every 5 s) resumes its state (loop, shimmer) but stays silent for the one-shot stingers. Also the longest
 * a sim-clock cue may be overdue before it is skipped (a stall never bursts), and the longest a stinger retries for an undecoded buffer.
 */
const EV_LATE_S = 1.5;
/** sim seconds without a refresh after which a running shrine loop is dropped: RUN_EVENT_HEARTBEAT + RUN_EVENT_REFRESH_GRACE of sim/runEvents.ts. Keep in sync: a test compares. */
export const EV_STALE_S = 6.5;
/** gap between two tries of a stinger whose buffer is still decoding */
const EV_RETRY_S = 0.2;
/** the sim second at which the sounds of the zone's event kinds are requested (outside the payload window: HUD + 6 s) */
const EV_WARM_S = 60;
/** manifest sounds of each event kind's cues (the ones no download rank of audio/index.ts lists are fetched by the warm-up above) */
const EV_CUE_IDS: Readonly<Record<string, readonly string[]>> = {
  bargain: ['sfx_bell_toll', 'sfx_aura_loop', 'sfx_holy_chime'],
  championHunt: ['sfx_boss_roar', 'sfx_holy_chime'],
  metinRain: ['sfx_metin_warn'],
  goldenHour: ['sfx_yeop_pile', 'sfx_yeop_pickup'],
};
/** metinRain: the three alarms, seconds after the announce began and their levels */
const RAIN_WARN_AT: readonly number[] = [0, 1.5, 3];
const RAIN_WARN_VOL: readonly number[] = [0.55, 0.75, 0.95];
/** goldenHour: first ping after the window opened, then the gaps (s) and pitch of the following pings (cycled; no random draw, no sim rng) */
const SHIMMER_FIRST_S = 1.1;
const SHIMMER_GAP_S: readonly number[] = [2.2, 3.1, 2.6, 3.6, 2.4];
const SHIMMER_RATE: readonly number[] = [1.19, 1.35, 1.12, 1.5, 1.26];
const SHIMMER_VOL = 0.3;
/** the bargain shrine's loop: LoopBank key = SHRINE_KEY_BASE - event id (metins use their non-negative ids), fade-out (s), retry gap (s) while the bank is full / the loop not decoded */
const SHRINE_KEY_BASE = -1000;
const SHRINE_FADE_S = 0.9;
const SHRINE_RETRY_S = 1;
/** a pact awakening: the gold layer lands on the awakening's bells (s after the pick) */
const GOLD_DELAY_S = 0.65;
const GOLD_VOL = 0.5;
/** the cue clock advances by at most this per frame: a hitch or a long stall never bursts the delayed cues */
const CUE_MAX_DT = 0.25;
const CUE_SLOTS = 8;

/** which clock a delayed cue waits on: `evT` (rendered frames, frozen while paused) or the sim's w.time */
const CLK_CUE = 0;
const CLK_SIM = 1;
/** who owns a cue: the run event (a new event id clears it) or the pact awakening (only a run start / end clears it) */
const OWN_EVENT = 0;
const OWN_GOLD = 1;

/** one delayed one-shot */
interface Cue {
  live: boolean;
  clk: number;
  own: number;
  /** the event's 'end' drops it (an alarm or a roar the end made pointless) */
  eof: boolean;
  /** when it is due, on its clock */
  at: number;
  /** cue clock: the retry window for an undecoded buffer closes here (0 = not opened yet) */
  until: number;
  id: string;
  vol: number;
  /** playback rate (0 = the sound's own) */
  rate: number;
  x: number;
  z: number;
  flat: boolean;
}

export interface AdapterDeps {
  engine: AudioEngine;
  sfx: SfxPlayer;
  loops: LoopBank;
  music: MusicPlayer;
  resolver: SfxResolver;
  manifest: Record<string, AudioAsset>;
  /** zone ambience bed (amb_<zone>); absent = a run has no bed */
  ambience?: AmbienceBed;
  /**
   * true = the host's background stream (audio/index.ts) fetches the bed after the zone music; the adapter only starts it
   * once it is decoded. false (tools, tests) = the adapter fetches it itself when the zone music is up.
   */
  backgroundBeds?: boolean;
}

interface ZoneMusicIds {
  calm: string;
  combat: string;
  boss: string;
}

export class SimAudioAdapter {
  private readonly flat: PlayOpts = { flat: true };
  private readonly opts: PlayOpts = { vol: 1 };
  private readonly deathCache: (string | null | undefined)[] = [];
  private readonly attackCache: (string | null | undefined)[] = [];
  private ladderStep = 0;
  private ladderT = -1e9;
  private topT = -1e9;
  private heat = 0;
  private combat = false;
  private lastHeatT = 0;
  private bossesAlive = 0;
  private bossClearAt = -1;
  private zoneId = '';
  private zoneMusic: ZoneMusicIds | null = null;
  private auto = false;
  private mode: MusicMode = 'off';
  private finalBoss = false;
  private ended = false;
  /** this run's bed id (`amb_<zone>`), null when the manifest has none */
  private bedId: string | null = null;
  /** url of the run's calm zone track (what the bed waits for), null when the zone has none */
  private calmUrl: string | null = null;
  /** the bed was handed to the player for this run */
  private bedUp = false;
  /** the bed sits at its combat level (combat heat, or a boss fight) */
  private bedHot = false;
  /** AR-02: smoothed count of playing SFX voices, and the density duck (dB) the engine was last given */
  private voiceLoad = 0;
  private duckDb = 0;
  /** AR-02: the run is paused (pauseChanged). FixedLoop keeps calling update() with a real dt then; the density duck must not move */
  private paused = false;

  // ---- EV-04: run-event cues. Real-time cues (the gold layer, decode retries, the shrine's start retries) run on `evT`, a clock of the rendered
  // frames of the run (update's dt, frozen while the pause menu is up, clamped per frame): it needs no AudioContext, and a stalled sim never
  // bursts the cues. The rain alarms and the shimmer run on the SIM clock (w.time), because a card / chest modal freezes the sim without a
  // pause event (the event's own countdown stands still, so must they) and a guest's pause overlay does not stop the shared sim.
  private readonly cues: Cue[] = Array.from({ length: CUE_SLOTS }, () => ({ live: false, clk: CLK_CUE, own: OWN_EVENT, eof: false, at: 0, until: 0, id: '', vol: 1, rate: 0, x: 0, z: 0, flat: true }));
  /** id of the run event whose phases were handled, the highest phase rank seen (0 none, 1 announce, 2 active, 3 end) and where it is */
  private evId = -1;
  private evRank = 0;
  private evX = 0;
  private evZ = 0;
  private evT = 0;
  /** the sounds of the zone's event kinds were requested (once per run, at EV_WARM_S sim seconds) */
  private warmed = false;
  /** goldenHour shimmer: running, the sim second its window ends, the sim second of the next ping and the cycle step */
  private shimmerOn = false;
  private shimmerEnd = 0;
  private shimmerAt = 0;
  private shimmerStep = 0;
  /** bargain shrine loop: wanted (the shrine exists), running, and when the next start attempt may be made (cue clock) */
  private shrineWant = false;
  private shrineUp = false;
  private shrineKey = 0;
  private shrineRetryAt = 0;
  /** bargain shrine: the planned end of the latest announce / active event, and the sim second of the last announce / active / channel event of the id */
  private shrineEnd = 0;
  private shrineSeen = 0;
  /** bargain channel chime: the event the mask belongs to and the heroes (bit = player) whose completion already chimed */
  private chimeId = -1;
  private chimed = 0;

  constructor(private readonly d: AdapterDeps) {}

  // ---- music control ----------------------------------------------------------------------------------------------

  /** Manual music control (menus, zone select). Switches the adapter off auto mode until the next run starts. */
  setZoneMusic(zone: string, mode: MusicMode): void {
    this.auto = false;
    this.zoneId = zone;
    this.zoneMusic = null;
    this.paused = false;
    this.d.music.setMuffled(false);
    this.d.engine.setAmbienceMuffled(false);
    this.stopBed(); // menus and zone select have no bed: a run that was quit fades it out
    this.resetDuck();
    this.syncLayers();
    this.applyMode(mode);
  }

  /** AR-02: tells the music player whether this zone's calm and combat are separate files (crossfade) or one (lowpass) */
  private syncLayers(): void {
    this.d.music.setLayers(this.trackFor('calm'), this.trackFor('combat'));
  }

  /** AR-02: the SFX density duck back to nothing (run start / end, pause, menus) */
  private resetDuck(): void {
    this.voiceLoad = 0;
    if (this.duckDb !== 0) {
      this.duckDb = 0;
      this.d.engine.setDensityDuck(0);
    }
  }

  /** AR-02: every frame of a run: smooth the voice count and move the density duck (never deeper than DUCK_DENSITY_MAX_DB) */
  private tickDuck(dt: number): void {
    if (!(dt > 0)) return; // a frozen frame has no time to smooth over
    const k = 1 - Math.exp(-Math.min(dt, 0.25) / DENSITY_TAU);
    this.voiceLoad += (this.d.sfx.activeVoices - this.voiceLoad) * k;
    const u = Math.min(1, Math.max(0, (this.voiceLoad - DENSITY_LO) / (DENSITY_HI - DENSITY_LO)));
    const db = Math.round((DUCK_DENSITY_MAX_DB * u * u * (3 - 2 * u)) / DENSITY_STEP_DB) * DENSITY_STEP_DB;
    if (db !== this.duckDb) {
      this.duckDb = db;
      this.d.engine.setDensityDuck(db);
    }
  }

  private trackFor(mode: MusicMode): string | null {
    const m = this.d.manifest;
    const zm = this.zoneMusic;
    const z = this.zoneId;
    const pick = (...ids: (string | undefined)[]): string | null => {
      for (const id of ids) if (id && id in m) return id;
      return null;
    };
    switch (mode) {
      case 'menu':
        return pick('mus_menu');
      case 'calm':
        return pick(zm?.calm, `mus_${z}_calm`, `mus_${z}`);
      case 'combat':
        return pick(zm?.combat, `mus_${z}_combat`, `mus_${z}`);
      case 'boss':
        return pick(zm?.boss, `mus_${z}_boss`, 'mus_boss');
      case 'off':
        return null;
    }
  }

  private applyMode(mode: MusicMode): void {
    const music = this.d.music;
    this.mode = mode;
    if (mode === 'off') {
      music.stop(1.2);
      return;
    }
    const id = this.trackFor(mode);
    if (!id) return;
    music.play(id, mode === 'boss' ? 0.8 : 1.4);
    music.setIntensity(mode === 'calm' ? 0 : 1);
    if (mode === 'calm' || mode === 'combat') {
      const b = this.trackFor('boss');
      if (b) music.prepare(b);
    }
  }

  // ---- run lifecycle ----------------------------------------------------------------------------------------------

  runStart(w: World): void {
    this.zoneId = w.zone.id;
    this.zoneMusic = w.zone.music;
    this.auto = true;
    this.heat = 0;
    this.combat = false;
    this.bossesAlive = 0;
    this.bossClearAt = -1;
    this.finalBoss = false;
    this.ended = false;
    this.ladderStep = 0;
    this.paused = false; // a run quit from its pause menu never reported the resume
    this.d.music.setMuffled(false);
    this.d.loops.stopAll();
    this.resetEventCues(true);
    this.warmed = false;
    this.resetDuck();
    this.syncLayers();
    this.applyMode('calm');
    const calm = this.trackFor('calm');
    this.calmUrl = calm ? (this.d.manifest[calm]?.url ?? null) : null;
    // the bed follows the zone music (tickBed); a zone without an amb_<zone> entry plays none
    this.stopBed();
    this.d.engine.setAmbienceMuffled(false);
    const bed = `amb_${w.zone.id}`;
    this.bedId = this.d.ambience?.has(bed) ? bed : null;
  }

  runEnd(_w: World): void {
    this.paused = false;
    this.d.music.setMuffled(false);
    this.d.engine.setAmbienceMuffled(false);
    this.d.loops.stopAll();
    this.resetEventCues(true);
    this.auto = false;
    this.resetDuck();
    this.stopBed();
    if (!this.ended) this.d.music.stop(1.0);
  }

  pauseChanged(paused: boolean): void {
    this.paused = paused;
    if (paused) this.resetDuck(); // the paused music is muffled, not ducked; the load climbs again when the run goes on
    this.d.music.setMuffled(paused);
    this.d.engine.setAmbienceMuffled(paused);
  }

  /** True once the run's zone music is decoded (or the zone has none): the moment its bed may be fetched and start. */
  zoneMusicReady(): boolean {
    const u = this.calmUrl;
    return u === null || this.d.engine.has(u) || this.d.engine.hasFailed(u);
  }

  /** the bed's url when this run has one (the host's background stream fetches it) */
  get bedUrl(): string | null {
    return this.bedId !== null ? (this.d.manifest[this.bedId]?.url ?? null) : null;
  }

  private stopBed(): void {
    this.bedId = null;
    this.bedUp = false;
    this.bedHot = false;
    this.d.engine.setAmbienceCombat(false);
    this.d.ambience?.stop(AMB_FADE_OUT_S);
  }

  /** Bed housekeeping, every frame of a run: -6 dB while combat heat (or a boss) is on; starts once the zone music is up. */
  private tickBed(): void {
    const hot = this.combat || this.mode === 'boss';
    if (hot !== this.bedHot) {
      this.bedHot = hot;
      this.d.engine.setAmbienceCombat(hot);
    }
    const id = this.bedId;
    if (id === null || this.bedUp || !this.d.ambience || this.d.engine.ctx === null || !this.zoneMusicReady()) return;
    const a = this.d.manifest[id];
    if (this.d.backgroundBeds && (!a || !this.d.engine.has(a.url))) return; // the background stream is still fetching it
    this.bedUp = this.d.ambience.play(id);
  }

  /** ~every frame (dt seconds): combat-heat decay, boss-clear timer, positional loops. */
  update(w: World | null, dt: number): void {
    if (w) {
      const p = w.players[0];
      if (p) {
        this.d.sfx.setListener(p.x, p.z);
        this.d.loops.update(p.x, p.z);
      }
    }
    if (!this.auto) return;
    this.heat *= Math.exp(-dt / 4);
    // Paused frames still arrive with a real dt (rings of voices, pause-menu clicks): they must not re-duck the muffled music.
    if (!this.paused) this.tickDuck(dt);
    this.tickBed();
    this.tickEventCues(w, dt);
    const now = this.d.engine.now;
    if (this.bossClearAt > 0 && now >= this.bossClearAt && this.bossesAlive <= 0 && !this.finalBoss) {
      this.bossClearAt = -1;
      this.applyMode(this.combat ? 'combat' : 'calm');
    }
    if (this.mode === 'boss') return;
    if (!this.combat && this.heat > HEAT_ON) {
      this.combat = true;
      this.mode = 'combat';
      this.d.music.setIntensity(1);
      const id = this.trackFor('combat');
      if (id) this.d.music.play(id);
    } else if (this.combat && this.heat < HEAT_OFF) {
      this.combat = false;
      this.mode = 'calm';
      this.d.music.setIntensity(0);
      const id = this.trackFor('calm');
      if (id) this.d.music.play(id);
    }
  }

  // ---- events -----------------------------------------------------------------------------------------------------

  handleEvents(events: readonly SimEvent[], w: World): void {
    const p = w.players[0];
    if (p) this.d.sfx.setListener(p.x, p.z);
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e) this.handleEvent(e, w);
    }
  }

  private snd(raw: string, x: number, z: number, vol = 1, rate?: number): boolean {
    const id = this.d.resolver.resolve(raw);
    if (id === null) return false;
    this.opts.vol = vol;
    this.opts.rate = rate;
    return this.d.sfx.play(id, x, z, this.opts);
  }

  private sndFlat(raw: string, vol = 1, rate?: number): boolean {
    const id = this.d.resolver.resolve(raw);
    if (id === null) return false;
    this.flat.vol = vol;
    this.flat.rate = rate;
    return this.d.sfx.play(id, 0, 0, this.flat);
  }

  handleEvent(e: SimEvent, w: World): void {
    switch (e.t) {
      case 'sfx': {
        const id = this.d.resolver.resolve(e.id);
        if (id === null || EVENT_DRIVEN[id] === true) return;
        this.opts.vol = e.vol > 0 ? e.vol : 1;
        this.opts.rate = undefined;
        this.d.sfx.play(id, e.x, e.z, this.opts);
        return;
      }
      case 'damage': {
        this.heat += e.crit ? 2 : 1;
        if (e.dot) {
          if (e.element === ELEMENT_FIRE) this.snd('sfx_burn_tick', e.x, e.z, 0.8);
          return;
        }
        if (e.crit) this.snd('sfx_crit', e.x, e.z, 0.9);
        else this.snd(e.boss ? 'sfx_hit_flesh_heavy' : 'sfx_hit_flesh', e.x, e.z, e.boss ? 0.9 : 0.8);
        return;
      }
      case 'enemyDeath': {
        const def = w.typeDefs[e.type];
        const id = this.deathSound(e.type, def);
        if (id) this.snd(id, e.x, e.z, e.tier >= 1 ? 1 : 0.7);
        return;
      }
      case 'enemyAttack': {
        const def = w.typeDefs[e.type];
        if (def && (def.rank === 'boss' || def.rank === 'king')) return; // boss patterns carry their own `sfx` events
        const id = this.attackSound(e.type, e.kind, def);
        if (id) this.snd(id, e.x, e.z, 0.8);
        return;
      }
      case 'playerHit': {
        const female = w.players[e.player]?.sex === 'f';
        if (e.result === 0) this.sndFlat(female ? 'sfx_player_hurt_f' : 'sfx_player_hurt_m', 0.95);
        else if (e.result === 1) this.snd('sfx_dash_whoosh', e.x, e.z, 0.5);
        else this.snd('sfx_hit_armor', e.x, e.z, 0.8);
        return;
      }
      case 'playerDeath':
        this.sndFlat(w.players[e.player]?.sex === 'f' ? 'sfx_player_death_f' : 'sfx_player_death_m');
        return;
      case 'playerRevive':
        this.sndFlat('sfx_revive');
        return;
      case 'heal':
        if (e.source === HEAL_SKILL || e.source === HEAL_CARD) this.sndFlat('sfx_holy_chime', 0.5);
        return;
      case 'levelUp':
        this.sndFlat('sfx_level_up');
        return;
      case 'cardPick':
        if (e.awakening) this.onAwakening(e, w);
        return;
      case 'runEvent':
        this.onRunEvent(e, w);
        return;
      case 'pickup':
        this.onPickup(e.kind, e.x, e.z);
        return;
      case 'chestOpen':
        this.snd('sfx_chest_open', e.x, e.z);
        return;
      case 'chestLocked':
        this.sndFlat('sfx_ui_error', 0.8);
        return;
      case 'telegraph':
        if (e.source === 1 || e.source === 3) this.snd('sfx_telegraph', e.x, e.z, 0.7);
        return;
      case 'metinWarn':
        this.snd('sfx_metin_warning', e.x, e.z);
        return;
      case 'metinImpact':
        this.snd('sfx_metin_impact', e.x, e.z);
        this.d.loops.start(e.metin, 'sfx_metin_pulse', e.x, e.z);
        return;
      case 'metinAwaken':
        this.snd('sfx_metin_awaken', e.x, e.z);
        return;
      case 'metinBreak':
        this.d.loops.stop(e.metin);
        this.snd('sfx_metin_shatter', e.x, e.z);
        return;
      case 'bossSpawn':
        this.snd('sfx_boss_spawn', e.x, e.z);
        this.bossesAlive++;
        if (e.final) this.finalBoss = true;
        if (this.auto) this.bossMusic(w, e.bossId);
        return;
      case 'bossPhase':
        this.snd(e.enrage ? 'sfx_boss_roar' : 'sfx_boss_phase', w.players[0]?.x ?? 0, w.players[0]?.z ?? 0, 0.9);
        return;
      case 'bossDeath':
        this.snd('sfx_boss_death', e.x, e.z);
        this.bossesAlive = Math.max(0, this.bossesAlive - 1);
        if (this.auto && this.bossesAlive === 0) this.bossClearAt = this.d.engine.now + 2.5;
        return;
      case 'story':
        if (e.kind === 'zoneIntro') this.sndFlat('sfx_run_start', 0.8);
        return;
      case 'runEnd':
        this.ended = true;
        this.auto = false;
        this.d.loops.stopAll();
        this.resetEventCues(true);
        this.resetDuck();
        this.stopBed();
        this.d.music.playStinger(e.victory ? 'mus_victory' : 'mus_defeat');
        return;
      default:
        return;
    }
  }

  // ---- run events + pact awakenings (EV-04) -----------------------------------------------------------------------

  /** A phase change of the run's event plays its cue once; a repeated phase (the 5 s heartbeat, a moving event) only refreshes. */
  private onRunEvent(e: RunEventEvent, w: World): void {
    if (this.ended) return;
    if (e.phase === 'channel') {
      this.onChannel(e, w);
      return;
    }
    const rank = e.phase === 'announce' ? 1 : e.phase === 'active' ? 2 : 3;
    if (e.id !== this.evId) {
      this.resetEventCues(false); // a new event (one per run: a restart without runStart) starts clean; a pact awakening's gold layer stays
      this.evId = e.id;
    }
    this.evX = e.x;
    this.evZ = e.z;
    const shrine = e.kind === 'bargain' && rank <= 2;
    if (shrine) {
      this.shrineEnd = e.endAt;
      this.shrineSeen = w.time;
    }
    if (rank <= this.evRank) {
      // refresh: a shrine whose loop could not start (bank full, not decoded yet) tries again on the next heartbeat; one that was dropped for
      // a silent stretch (a guest that reconnected) comes back with the next heartbeat of the still running event
      if (shrine && this.evRank < 3 && !this.shrineWant && w.time < e.endAt) {
        this.shrineWant = true;
        this.shrineKey = SHRINE_KEY_BASE - e.id;
      }
      if (this.shrineWant && !this.shrineUp) this.startShrine();
      return;
    }
    this.evRank = rank;
    const begun = rank === 1 ? e.startAt - EV_ANNOUNCE_S : rank === 2 ? e.startAt : e.endAt;
    const fresh = !(w.time - begun > EV_LATE_S); // a missing clock reads as fresh
    if (rank === 3) this.dropEndedCues(); // the alarms and a roar still waiting are pointless now
    switch (e.kind) {
      case 'metinRain':
        if (rank === 1 && fresh) {
          // absolute sim times: the countdown to the fall and the alarms stop together, whatever freezes the sim or the audio
          for (let i = 0; i < RAIN_WARN_AT.length; i++) this.queue(CLK_SIM, begun + (RAIN_WARN_AT[i] ?? 0), 'sfx_metin_warn', RAIN_WARN_VOL[i] ?? 1, 0, true, 0, 0, OWN_EVENT, true);
          this.tickSimCues(w); // the alarm that is due now rings in this frame
        }
        return;
      case 'championHunt':
        if (!fresh) return;
        if (rank === 1) this.shoot('sfx_boss_roar', 0, 0, 0.55, 0, true, OWN_EVENT);
        // it stands: the deeper roar where it is, on the next frame so that a start that failed in this very dispatch ('end' p = 0) never roars
        else if (rank === 2) this.queue(CLK_CUE, this.evT, 'sfx_boss_roar', 0.9, 0.9, false, e.x, e.z, OWN_EVENT, true);
        else if (e.p >= 1) this.shoot('sfx_holy_chime', 0, 0, 0.6, 0, true, OWN_EVENT);
        return;
      case 'goldenHour':
        if (rank === 1) {
          if (fresh) this.shoot('sfx_yeop_pile', 0, 0, 0.75, 0, true, OWN_EVENT);
        } else if (rank === 2) this.startShimmer(w, e.endAt, fresh ? SHIMMER_FIRST_S : 0.4);
        else this.shimmerOn = false;
        return;
      case 'bargain':
        if (rank === 1 && fresh) this.shoot('sfx_bell_toll', e.x, e.z, 0.55, 0, false, OWN_EVENT);
        if (rank <= 2) {
          this.shrineWant = true;
          this.shrineKey = SHRINE_KEY_BASE - e.id;
          if (!this.shrineUp) this.startShrine();
        } else this.stopShrine();
        return;
      default:
        return; // a kind without a cue stays silent
    }
  }

  /** the bargain shrine's channel: a soft chime at the shrine the first time each hero's progress reaches 1 */
  private onChannel(e: RunEventEvent, w: World): void {
    if (e.kind !== 'bargain' || e.player < 0) return;
    if (e.id === this.evId) this.shrineSeen = w.time; // the host is alive: the loop's silent-stretch bound starts over
    if (e.id !== this.chimeId) {
      this.chimeId = e.id;
      this.chimed = 0;
    }
    const bit = 1 << Math.min(e.player, 30);
    if (e.p >= 1) {
      if ((this.chimed & bit) === 0) {
        this.chimed |= bit;
        this.shoot('sfx_holy_chime', e.x, e.z, 0.6, 0, false, OWN_EVENT);
      }
    } else if (e.p <= 0) this.chimed &= ~bit; // left the shrine: the next completion chimes again
  }

  /**
   * A card pick that lands as an awakening (the G2 -> P rank-up the pacts gate): the awaken sfx, and the gold layer (a coin cascade ending
   * on a glass bell) timed to the bells of sfx_awaken. The sim also sends sfx_awaken as a generic 'sfx' event right after: the rule of the id
   * (max 1, gap 0.35 s) keeps it single, and a co-op guest, whose droppable 'sfx' event may not arrive, still hears the awakening.
   */
  private onAwakening(e: CardPickEvent, w: World): void {
    const p = w.players[e.player];
    this.shoot('sfx_awaken', 0, 0, 0.7, 0, true, OWN_GOLD);
    this.queue(CLK_CUE, this.evT + GOLD_DELAY_S, 'sfx_yeop_pile', GOLD_VOL, 0, p === undefined, p?.x ?? 0, p?.z ?? 0, OWN_GOLD, false);
  }

  /** true while the manifest sound `raw` resolves to has a file (its url or a variant) that is neither decoded nor failed: a play() that came back false may only have started its load */
  private decoding(raw: string): boolean {
    const id = this.d.resolver.resolve(raw);
    const a = id === null ? undefined : this.d.manifest[id];
    if (!a) return false;
    const eng = this.d.engine;
    if (!eng.has(a.url) && !eng.hasFailed(a.url)) return true;
    for (const v of a.variants ?? []) if (!eng.has(v) && !eng.hasFailed(v)) return true;
    return false;
  }

  /** a one-shot now; when it only started the buffer's load, the same cue tries again every EV_RETRY_S until EV_LATE_S is over */
  private shoot(raw: string, x: number, z: number, vol: number, rate: number, flat: boolean, own: number): void {
    const r = rate > 0 ? rate : undefined;
    const ok = flat ? this.sndFlat(raw, vol, r) : this.snd(raw, x, z, vol, r);
    if (!ok && this.decoding(raw)) this.queue(CLK_CUE, this.evT + EV_RETRY_S, raw, vol, rate, flat, x, z, own, false, this.evT + EV_LATE_S);
  }

  /** a one-shot due at `at` on clock `clk`; a full queue drops it */
  private queue(clk: number, at: number, raw: string, vol: number, rate: number, flat: boolean, x: number, z: number, own: number, eof: boolean, until = 0): void {
    for (let i = 0; i < this.cues.length; i++) {
      const c = this.cues[i];
      if (c && !c.live) {
        c.live = true;
        c.clk = clk;
        c.own = own;
        c.eof = eof;
        c.at = at;
        c.until = until;
        c.id = raw;
        c.vol = vol;
        c.rate = rate;
        c.x = x;
        c.z = z;
        c.flat = flat;
        return;
      }
    }
  }

  /** a due cue plays; one that met an undecoded buffer is armed again on the cue clock for the rest of its retry window */
  private fire(c: Cue): void {
    c.live = false;
    const r = c.rate > 0 ? c.rate : undefined;
    const ok = c.flat ? this.sndFlat(c.id, c.vol, r) : this.snd(c.id, c.x, c.z, c.vol, r);
    if (ok || !this.decoding(c.id)) return;
    const until = c.until > 0 ? c.until : this.evT + EV_LATE_S;
    if (this.evT + EV_RETRY_S > until) return;
    c.live = true;
    c.clk = CLK_CUE;
    c.at = this.evT + EV_RETRY_S;
    c.until = until;
  }

  private startShimmer(w: World, endAt: number, first: number): void {
    this.shimmerOn = true;
    this.shimmerEnd = endAt;
    this.shimmerStep = 0;
    this.shimmerAt = w.time + first;
  }

  private startShrine(): void {
    const id = this.d.resolver.resolve('sfx_aura_loop');
    this.shrineRetryAt = this.evT + SHRINE_RETRY_S;
    if (id === null) return;
    const n = this.d.loops.count;
    this.d.loops.start(this.shrineKey, id, this.evX, this.evZ);
    this.shrineUp = this.d.loops.count > n;
  }

  private stopShrine(): void {
    if (this.shrineWant) this.d.loops.stop(this.shrineKey, SHRINE_FADE_S);
    this.shrineWant = false;
    this.shrineUp = false;
  }

  /** the sounds of the zone's own event kinds are asked for once per run (nothing for a zone without events): a stinger that no download rank lists would be lost on first use */
  private warmEventCues(w: World): void {
    this.warmed = true;
    const kinds = (w.ix as { runEvents?: { zones?: Record<string, readonly string[] | undefined> } }).runEvents?.zones?.[w.zone.id];
    if (!kinds) return;
    const eng = this.d.engine;
    for (const kind of kinds) {
      for (const raw of EV_CUE_IDS[kind] ?? []) {
        const id = this.d.resolver.resolve(raw);
        const a = id === null ? undefined : this.d.manifest[id];
        if (!a) continue;
        if (!eng.has(a.url) && !eng.hasFailed(a.url)) void eng.load(a.url);
        for (const v of a.variants ?? []) if (!eng.has(v) && !eng.hasFailed(v)) void eng.load(v);
      }
    }
  }

  /** every frame of a run: the sim-clock cues first (they follow w.time, paused or not), then the real-time ones (frozen while paused) */
  private tickEventCues(w: World | null, dt: number): void {
    if (w !== null) {
      if (!this.warmed && w.time >= EV_WARM_S) this.warmEventCues(w);
      this.tickSimCues(w);
    }
    if (this.paused) return;
    this.evT += dt > 0 ? Math.min(dt, CUE_MAX_DT) : 0;
    const now = this.evT;
    for (let i = 0; i < this.cues.length; i++) {
      const c = this.cues[i];
      if (c && c.live && c.clk === CLK_CUE && now >= c.at) this.fire(c);
    }
    if (this.shrineWant && !this.shrineUp && now >= this.shrineRetryAt) this.startShrine();
  }

  /**
   * The cues that follow the sim: the rain alarms (one per frame at most, none more than EV_LATE_S late: a stall never bursts, a late guest still
   * hears the ones ahead of it), the goldenHour shimmer, and the bounds of the shrine's loop. Not gated on the pause: a host pause freezes w.time
   * itself, a guest's pause overlay must not hold what the shared sim is counting.
   */
  private tickSimCues(w: World): void {
    const t = w.time;
    let fired = false;
    for (let i = 0; i < this.cues.length; i++) {
      const c = this.cues[i];
      if (!c || !c.live || c.clk !== CLK_SIM || t < c.at) continue;
      if (t - c.at > EV_LATE_S) c.live = false;
      else if (!fired) {
        fired = true;
        this.fire(c);
      }
    }
    if (this.shimmerOn) {
      if (t >= this.shimmerEnd) this.shimmerOn = false;
      else if (t >= this.shimmerAt) {
        const k = this.shimmerStep % SHIMMER_GAP_S.length;
        this.sndFlat('sfx_yeop_pickup', SHIMMER_VOL, SHIMMER_RATE[k]);
        this.shimmerAt = t + (SHIMMER_GAP_S[k] ?? 2.5);
        this.shimmerStep++;
      }
    }
    // the shrine exists until the sim says so; an 'end' that never arrived (a guest that reconnected in place) must not leave the hum running
    if (this.shrineWant && (t >= this.shrineEnd || t - this.shrineSeen > EV_STALE_S)) this.stopShrine();
  }

  /** the event's 'end': the cues that only made sense before it (the rain alarms, a roar not yet played) are dropped */
  private dropEndedCues(): void {
    for (const c of this.cues) if (c.eof) c.live = false;
  }

  /** a new event (`all` false) clears what the last one owned; a run start / end (`all`) also the awakening's gold layer */
  private resetEventCues(all: boolean): void {
    for (const c of this.cues) if (all || c.own === OWN_EVENT) c.live = false;
    this.stopShrine();
    this.shimmerOn = false;
    this.evId = -1;
    this.evRank = 0;
    this.chimeId = -1;
    this.chimed = 0;
  }

  private bossMusic(w: World, bossId: string): void {
    const own = w.ix.bosses.get(bossId)?.music;
    this.mode = 'boss';
    this.bossClearAt = -1;
    const id = own && own in this.d.manifest ? own : this.trackFor('boss');
    if (id) this.d.music.play(id, 0.8);
    this.d.music.setIntensity(1);
  }

  private onPickup(kind: number, x: number, z: number): void {
    if (kind === PICKUP_XP) {
      const now = this.d.engine.now;
      if (now - this.ladderT > LADDER_TIMEOUT) this.ladderStep = 0;
      this.ladderT = now;
      if (this.ladderStep >= LADDER_TOP && now - this.topT < 0.085) return; // top note repeats slower than the gap rule
      const id = LADDER[this.ladderStep];
      if (id !== undefined && this.snd(id, x, z, 0.85)) {
        if (this.ladderStep < LADDER_TOP) this.ladderStep++;
        else this.topT = now;
      }
    } else if (kind === PICKUP_YEOP) this.snd('sfx_yeop_pickup', x, z, 0.8);
    else if (kind === PICKUP_HEAL) this.snd('sfx_potion', x, z, 0.9);
  }

  private deathSound(type: number, def: EnemyDef | undefined): string | null {
    const hit = this.deathCache[type];
    if (hit !== undefined) return hit;
    let id: string | null = def?.sfx?.death ? this.d.resolver.resolve(def.sfx.death) : null;
    if ((id === null || id === 'sfx_death_generic') && def) {
      for (const race of def.race) {
        const r = RACE_DEATH[race];
        if (r) {
          id = r;
          break;
        }
      }
    }
    this.deathCache[type] = id ?? 'sfx_death_generic';
    return this.deathCache[type] ?? null;
  }

  private attackSound(type: number, kind: number, def: EnemyDef | undefined): string | null {
    if (kind === ATTACK_MELEE && def?.sfx?.attack) {
      const hit = this.attackCache[type];
      if (hit !== undefined) return hit;
      const id = this.d.resolver.resolve(def.sfx.attack);
      this.attackCache[type] = id ?? ATTACK_DEFAULT[ATTACK_MELEE] ?? null;
      return this.attackCache[type] ?? null;
    }
    if (kind === ATTACK_RANGED || kind === ATTACK_CHARGE || kind === ATTACK_LEAP || kind === ATTACK_EXPLODE || kind === ATTACK_BREATH || kind === ATTACK_MELEE) {
      return ATTACK_DEFAULT[kind] ?? null;
    }
    return null;
  }
}
