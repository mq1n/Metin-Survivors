// Run-event routing (EV-03b): the sim's 'runEvent' (RS-02a payload: kind, phase, id, x, z, player, p) and, while a Metin Rain is up, its stones'
// 'metinWarn' events become the event presets of ./presets.ts: spawned, moved and removed here, as PERSISTENT HANDLES KEYED BY THE EVENT ID.
//
//   bargain      announce / active / channel -> `ev.shrine` at (x, z) (once per event id; a repeated phase is a heartbeat: nothing happens) and its
//                column of light `ev.shrinePillar`, which stands only while no hero channels (it would wash the hero out in the centre). The channel
//                ring fills in `SHRINE_SEGMENTS` steps: `ev.shrineChannel` segment k stands while the best channel progress of the heroes has reached
//                (k + 1) / N, and all of them go when it resets. A completed channel (p = 1) plays `ev.shrineClaim` once.
//   championHunt active -> `ev.champion` on the champion; every frame it is moved to the live position of the champion row (`RunEventSource.champion`,
//                app/simFeed.ts: the Leader-flagged enemy, the same on a co-op guest) and, without that, to the position of the latest event (the sim re-emits
//                it every 3 m the champion moves).
//   metinRain    active -> notes the clock; every non-great `metinWarn` within the rain's `within` s (+ 1) of it is one of the rain's stones: `ev.rainMark`
//                at its landing spot in the stone's rune colour.
//   end          (any kind) -> every handle of the event stops, the entry is gone, and the id is remembered as ENDED: nothing outlives the event, and a
//                report of the dead event that arrives after its end (a co-op guest decodes the 'end' BEFORE the 'channel' reports of the same block:
//                net/coop/events.ts flushes priority 0 first) is not a new event.
//
// The route owns no sim state and draws no random number. It costs nothing while no event is up (one `Map.size` test per frame), and a handful of
// spawns per event otherwise; the champion costs one `move` per frame. A loop that ended by itself (evicted, expired) is respawned by the 0.5 s
// liveness check while its event is up (the same rule as the metin loops of vfx/common/metin/route.ts). Presets are looked up by id at spawn time and an
// unknown id is a cheap no-op, so a route can run before its presets are registered.
import type { RunEventEvent, SimEvent } from '../../../sim/events';
import type { SpawnOpts } from '../../types';
import { CHAMPION_BASE, EVENT_PRESET_IDS, RAIN_MARK_BASE, SHRINE_BASE, SHRINE_SEGMENTS } from './ids';

/** the part of the VFX system the route needs (VfxSystem satisfies it; the tests pass a fake) */
export interface EventVfxHost {
  /** spawns a preset (loops return their handle, one-shots 0) */
  spawn(id: string, o?: SpawnOpts): number;
  move(handle: number, x: number, z: number, y?: number): void;
  stop(handle: number): void;
  /** true while the loop behind `handle` runs */
  alive(handle: number): boolean;
}

/** what the route cannot know from the events (pushed by app/simFeed.ts configureVfxEvents, once per run) */
export interface RunEventSource {
  /** the live position of the Champion Hunt's champion nearest to (x, z); false = none is standing (the route then uses the position of the last event) */
  champion?: (x: number, z: number, out: { x: number; z: number }) => boolean;
  /** rune colour (0xRRGGBB) of a metin def id; absent = the ring is white */
  rune?: (def: string) => number | undefined;
  /** the shrine's channel radius, m (runEvents.json kinds.bargain.radius) */
  shrineRadius?: number;
  /** seconds after the rain's start its last stone is called (runEvents.json kinds.metinRain.within) */
  rainWithin?: number;
}

let source: RunEventSource | null = null;

/** the run's event wiring (app/simFeed.ts configureVfxEvents); null = none (the routes then use the event positions and defaults) */
export function setRunEventSource(s: RunEventSource | null): void {
  source = s;
}

/** seconds of VFX time without a 'channel' event after which a hero's channel counts as reset (the sim reports it at least every 0.25 s while it runs; a pause or a modal holds the reports, so the ring clears after this and lights again at once when the channel goes on) */
export const CHANNEL_STALE = 2;
/** a 'metinWarn' within this many seconds of a Metin Rain's 'active' event is one of its stones when the source does not say (the rain calls its last stone `within` = 6 s after the start, +1 s of slack) */
export const RAIN_MARK_WINDOW = 7;
/** seconds after the rain's 'active' event during which a 'metinWarn' is one of its stones: the content's `within` + 1 s of slack, else the default */
const rainWindow = (): number => (source?.rainWithin !== undefined ? source.rainWithin + 1 : RAIN_MARK_WINDOW);
/** seconds between two liveness checks of the loops */
export const LIVENESS_EVERY = 0.5;
/** heroes whose channel is tracked (the co-op party) */
const PLAYERS = 4;

interface Live {
  readonly id: number;
  readonly kind: string;
  x: number;
  z: number;
  /** the event's main loop (the shrine, the champion ring); 0 = none */
  h: number;
  /** shrine: handle of the pillar of light (0 = not standing: a hero channels) */
  pil: number;
  /** shrine: handle of the lit channel segments (0 = not lit) */
  readonly seg: number[];
  /** shrine: segments lit (0..SHRINE_SEGMENTS) */
  lit: number;
  /** shrine: channel progress of each hero (0..1) and the VFX time of its last report */
  readonly p: number[];
  readonly pAt: number[];
  /** shrine: the hero's completed channel was celebrated (reset when its progress drops) */
  readonly claimed: boolean[];
  /** rain: VFX time of the 'active' event */
  t0: number;
  /** rain: metin ids that got a mark */
  readonly marked: number[];
}

export class RunEventVfx {
  private readonly live = new Map<number, Live>();
  /** ids of the events that ended (the guest's wire order puts the 'end' ahead of the last 'channel' reports) */
  private readonly ended = new Set<number>();
  private clock = 0;
  private check = 0;
  private readonly at = { x: 0, z: 0 };

  constructor(private readonly host: EventVfxHost) {}

  /** events (events of other types are ignored; sim events are pooled: read synchronously) */
  handle(e: SimEvent): void {
    if (e.t === 'runEvent') this.onRunEvent(e);
    else if (e.t === 'metinWarn') this.onWarn(e.metin, e.def, e.x, e.z, e.great);
  }

  /** once per VFX frame */
  update(dt: number): void {
    this.clock += dt;
    if (this.live.size === 0) return;
    this.check -= dt;
    const due = this.check <= 0;
    if (due) this.check = LIVENESS_EVERY;
    for (const s of this.live.values()) {
      if (s.kind === 'championHunt') this.follow(s, due);
      else if (s.kind === 'bargain') this.tendShrine(s, due);
    }
  }

  /** run end / VfxSystem.clear(): the loops are released by the system, the entries are dropped here */
  reset(): void {
    this.live.clear();
    this.ended.clear();
    this.check = 0;
  }

  /** events standing right now (tests, QA) */
  get liveCount(): number {
    return this.live.size;
  }

  /** the entry of an event id (tests) */
  stateOf(id: number): Readonly<Live> | undefined {
    return this.live.get(id);
  }

  // ------------------------------------------------------------------------------------------------------------------ run events

  private onRunEvent(e: RunEventEvent): void {
    if (e.phase === 'end') {
      this.ended.add(e.id);
      this.drop(e.id);
      return;
    }
    if (this.ended.has(e.id)) return;
    switch (e.kind) {
      case 'bargain':
        this.onShrine(e);
        break;
      case 'championHunt':
        // nothing stands at the announcement (the champion is placed when the hunt starts); the ring begins with the active phase
        if (e.phase === 'active') this.onChampion(e);
        break;
      case 'metinRain':
        if (e.phase === 'active' && !this.live.has(e.id)) this.entry(e).t0 = this.clock;
        break;
      default:
        break;
    }
  }

  private entry(e: RunEventEvent): Live {
    let s = this.live.get(e.id);
    if (s !== undefined && s.kind !== e.kind) {
      this.drop(e.id);
      s = undefined;
    }
    if (s === undefined) {
      s = {
        id: e.id,
        kind: e.kind,
        x: e.x,
        z: e.z,
        h: 0,
        pil: 0,
        seg: new Array<number>(SHRINE_SEGMENTS).fill(0),
        lit: 0,
        p: new Array<number>(PLAYERS).fill(0),
        pAt: new Array<number>(PLAYERS).fill(-1e9),
        claimed: new Array<boolean>(PLAYERS).fill(false),
        t0: this.clock,
        marked: [],
      };
      this.live.set(e.id, s);
    }
    return s;
  }

  private drop(id: number): void {
    const s = this.live.get(id);
    if (s === undefined) return;
    if (s.h !== 0) this.host.stop(s.h);
    if (s.pil !== 0) this.host.stop(s.pil);
    for (let k = 0; k < s.seg.length; k++) if (s.seg[k] !== 0) this.host.stop(s.seg[k] as number);
    this.live.delete(id);
  }

  // ------------------------------------------------------------------------------------------------------------------ the shrine

  private radius(): number {
    const r = source?.shrineRadius;
    return r !== undefined && r > 0 ? r : SHRINE_BASE;
  }

  private onShrine(e: RunEventEvent): void {
    const s = this.entry(e);
    s.x = e.x;
    s.z = e.z;
    if (s.h === 0 || !this.host.alive(s.h)) this.spawnShrine(s);
    const i = e.player;
    if (e.phase === 'channel' && i >= 0 && i < PLAYERS) {
      const was = s.p[i] as number;
      s.p[i] = e.p;
      s.pAt[i] = this.clock;
      // a completed channel is celebrated once; the claim re-arms when the hero's progress drops again
      if (e.p >= 1 && !(s.claimed[i] as boolean)) {
        s.claimed[i] = true;
        this.host.spawn(EVENT_PRESET_IDS.shrineClaim, { x: s.x, z: s.z, scale: this.radius() });
      } else if (e.p < 1 && was >= 1) s.claimed[i] = false;
    }
    this.fill(s);
  }

  /** the shrine loop; `again` = an evicted loop respawned mid-event: rank 1 leaves out the appearing flare */
  private spawnShrine(s: Live): void {
    s.h = this.host.spawn(EVENT_PRESET_IDS.shrine, { x: s.x, z: s.z, scale: this.radius(), rank: s.h === 0 ? 0 : 1 });
  }

  private spawnPillar(s: Live): void {
    s.pil = this.host.spawn(EVENT_PRESET_IDS.shrinePillar, { x: s.x, z: s.z });
  }

  /** the pillar stands while nobody channels; segments lit = the best channel progress of the heroes x N (all of them from 0.999) */
  private fill(s: Live): void {
    let best = 0;
    for (let i = 0; i < PLAYERS; i++) best = Math.max(best, s.p[i] as number);
    if (best > 0 && s.pil !== 0) {
      this.host.stop(s.pil);
      s.pil = 0;
    } else if (best <= 0 && s.pil === 0) this.spawnPillar(s);
    const want = best >= 0.999 ? SHRINE_SEGMENTS : Math.max(0, Math.min(SHRINE_SEGMENTS, Math.floor(best * SHRINE_SEGMENTS + 1e-6)));
    while (s.lit < want) {
      const k = s.lit++;
      s.seg[k] = this.host.spawn(EVENT_PRESET_IDS.shrineChannel, { x: s.x, z: s.z, scale: this.radius(), rot: (k * Math.PI * 2) / SHRINE_SEGMENTS });
    }
    while (s.lit > want) {
      const k = --s.lit;
      if (s.seg[k] !== 0) this.host.stop(s.seg[k] as number);
      s.seg[k] = 0;
    }
  }

  /** every frame: a hero whose 'channel' reports stopped has reset (a dropped message, a leave); every 0.5 s: the loops still run */
  private tendShrine(s: Live, due: boolean): void {
    let changed = false;
    for (let i = 0; i < PLAYERS; i++) {
      if ((s.p[i] as number) > 0 && this.clock - (s.pAt[i] as number) > CHANNEL_STALE) {
        s.p[i] = 0;
        s.claimed[i] = false;
        changed = true;
      }
    }
    if (changed) this.fill(s);
    if (!due) return;
    if (s.h !== 0 && !this.host.alive(s.h)) this.spawnShrine(s);
    if (s.pil !== 0 && !this.host.alive(s.pil)) this.spawnPillar(s);
    for (let k = 0; k < s.lit; k++) {
      const h = s.seg[k] as number;
      if (h !== 0 && this.host.alive(h)) continue;
      s.seg[k] = this.host.spawn(EVENT_PRESET_IDS.shrineChannel, { x: s.x, z: s.z, scale: this.radius(), rot: (k * Math.PI * 2) / SHRINE_SEGMENTS });
    }
  }

  // ------------------------------------------------------------------------------------------------------------------ the champion

  private onChampion(e: RunEventEvent): void {
    const s = this.entry(e);
    s.x = e.x;
    s.z = e.z;
    if (s.h === 0 || !this.host.alive(s.h)) s.h = this.host.spawn(EVENT_PRESET_IDS.champion, { x: s.x, z: s.z, scale: CHAMPION_BASE });
  }

  /** the ring rides the champion: the live row when the source finds it, else the position of the latest event */
  private follow(s: Live, due: boolean): void {
    if (s.h === 0) return;
    const found = source?.champion?.(s.x, s.z, this.at) === true;
    if (found) {
      s.x = this.at.x;
      s.z = this.at.z;
    }
    if (due && !this.host.alive(s.h)) {
      s.h = this.host.spawn(EVENT_PRESET_IDS.champion, { x: s.x, z: s.z, scale: CHAMPION_BASE });
      return;
    }
    this.host.move(s.h, s.x, s.z);
  }

  // ------------------------------------------------------------------------------------------------------------------ the rain

  private onWarn(metin: number, def: string, x: number, z: number, great: boolean): void {
    if (great || this.live.size === 0) return;
    for (const s of this.live.values()) {
      if (s.kind !== 'metinRain' || this.clock - s.t0 > rainWindow() || s.marked.includes(metin)) continue;
      s.marked.push(metin);
      const o: SpawnOpts = { x, z, scale: RAIN_MARK_BASE };
      const rune = source?.rune?.(def);
      if (rune !== undefined) o.color = rune;
      this.host.spawn(EVENT_PRESET_IDS.rainMark, o);
      return;
    }
  }
}
