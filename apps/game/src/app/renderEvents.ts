// Maps sim events to render-side reactions: corpses, damage numbers, hero actions, camera shake, hit-stop, the run-start camera fly-in, the boss-spawn staging.
// (VFX and audio subscribe to `runEvents` themselves.)
import type { Element } from '../data/schema';
import { climaxOffByPage, ESTABLISHING_POSE, FLY_IN_SECONDS, FlyInGate, flyInOffByPage, flyInSkip, prefersReducedMotion, type CameraRig } from '../render/camera';
import type { RenderSystem } from '../render/core';
import type { HeroAction } from '../render/hero';
import { asPostPipeline } from '../render/post';
import { primeZoneSystem, warmEstablishing } from '../render/warmupPass';
import type { HitStopClock, RenderWorld } from '../render/world';
import { elementColor } from '../render/fx/damageNumbers';
import type { SimEvent } from '../sim/events';
import { ELEMENTS } from '../sim/stores';
import type { World } from '../sim/world';
import { runEvents } from './runEvents';

const HERO_ACTIONS: ReadonlySet<string> = new Set(['attack', 'attack2', 'cast', 'dash', 'hit', 'victory', 'special1', 'special2', 'special3']);
/** damage-number merge id for player hits (enemy ids stay far below) */
const PLAYER_NUMBER_ID = 1_000_000;

/** merge id of the gold-pickup counter ("+250" stacks into one number while coins are collected) */
const YEOP_NUMBER_ID = 1_000_920;

function element(idx: number): Element {
  return ELEMENTS[idx] ?? 'physical';
}

// ---------------------------------------------------------------------------------------------------------------------
// FEEL-02: render-only hit-stop. A big moment holds the RENDER clock of the corpses (death clip + dissolve), the hero mixers (while the
// hero stands), the metin stones and the VFX at 5 % for a few frames (render/world.ts scales the dt it hands those systems). It does NOT
// freeze the living crowd: enemies sample the sim's feed (animT / flash), which keeps ticking. The sim keeps ticking at 60 Hz, so a co-op
// host and its guests stay in step and nothing is ever replayed. Local to each client (the events reach a guest like the host), and only
// for moments the local player can see (HIT_STOP_VIEW_MARGIN): a partner's kill on the far side of the map holds nothing and uses no budget.

/** The moments that hold a frame. A plain elite (tier 1), an ordinary hit, a crit and a skill cast never do. */
export type HitStopKind = 'bossPhase' | 'leaderDeath' | 'championDeath' | 'bossDeath' | 'metinBreak' | 'finalBossDeath';

/** how long each moment holds (ms at full screen shake): boss phase change 45, tier >= 2 death 55, metin break 60, final boss 70 */
export const HIT_STOP_MS: Readonly<Record<HitStopKind, number>> = {
  bossPhase: 45,
  leaderDeath: 55,
  championDeath: 55,
  bossDeath: 55,
  metinBreak: 60,
  finalBossDeath: 70,
};

/**
 * A pack-leader kill and a regular metin break only hold when its ground circle (radius = this margin, m) touches the camera's view
 * footprint (rig.isVisible). Boss phases, boss deaths, the final boss death and the Great Metin break are announced by the HUD and stay global.
 */
export const HIT_STOP_VIEW_MARGIN = 2.5;

/** the render dt of the held systems while a hit-stop runs (5 % = a held pose that still breathes) */
export const HIT_STOP_DT_SCALE = 0.05;
/** at most one hit-stop per this many seconds (render clock) */
export const HIT_STOP_GAP = 3;
/**
 * A pack leader (tier 2) dies 15-30 times a minute in the late bands (measured), so it is the filler lane: it only holds when no
 * leader held for this many seconds (4 a minute at most) and never while a boss fights (the boss has its own beats). The champion,
 * the bosses, the metins and the phase changes are rare and use the gap alone.
 */
export const HIT_STOP_LEADER_COOLDOWN = 15;
/** a boss that never reports its death releases the pack-leader lane after this many seconds */
const BOSS_FIGHT_MAX = 300;
/** no matter what, at most this many hit-stops in any 60 s */
export const HIT_STOP_PER_MINUTE = 12;
/** the death of a pack leader / champion and the Champion Hunt's `runEvent` 'end' arrive in the same step: within this many seconds they are one kill */
const CHAMPION_PAIR_WINDOW = 0.25;
/** longest frame delta the clock counts (the same clamp as RenderCore.frame) */
const MAX_FRAME_DT = 0.25;

export interface HitStopGrant {
  /** render seconds since the run's first frame */
  at: number;
  kind: HitStopKind;
  /** the hold, ms (after the screen-shake scaling) */
  ms: number;
}

/**
 * The hit-stop gate and clock. `trigger()` decides (rate limits, screen-shake scaling), `scale()` is what RenderWorld calls once
 * per frame: it advances the render clock and returns the multiplier for this frame's dt (1 outside a hit-stop; inside, the part of
 * the frame that lies in the hold counts 5 %, so a 45 ms hold is 45 ms of wall time whatever the frame rate).
 */
export class HitStop implements HitStopClock {
  /** render seconds since the run's first frame (the sum of the clamped frame deltas) */
  now = 0;
  /** seconds of hold still to run */
  left = 0;
  private lastAny = -Infinity;
  private lastLeader = -Infinity;
  private recent: number[] = [];
  /** bosses that stand (bossSpawn id -> clock time they appeared) */
  private readonly bosses = new Map<number, number>();
  readonly stats = { granted: 0, denied: 0, ms: 0, byKind: {} as Partial<Record<HitStopKind, number>> };
  /** the last 64 grants (QA traces and tests) */
  readonly log: HitStopGrant[] = [];

  /**
   * Asks for a hit-stop. `shake` = settings.screenShake (0..1): it scales the hold, 0 = off (nothing granted, no rate-limit state
   * used). Returns the hold in ms, 0 when denied. The final boss's death skips the 3 s gap (a deliberate deviation from the plan's "at most
   * once per 3 s"): it happens once per run and must not be swallowed by whatever held a moment before, so two holds can come less than 3 s
   * apart around the finale (0.48-2.94 s measured); the 12-a-minute cap still counts it.
   */
  trigger(kind: HitStopKind, shake: number): number {
    const k = shake >= 1 ? 1 : shake > 0 ? shake : 0;
    const ms = HIT_STOP_MS[kind] * k;
    if (!(ms >= 1)) return 0;
    const now = this.now;
    if (kind !== 'finalBossDeath') {
      let deny = now - this.lastAny < HIT_STOP_GAP;
      if (!deny && kind === 'leaderDeath') deny = now - this.lastLeader < HIT_STOP_LEADER_COOLDOWN || this.bossFight();
      if (!deny) {
        while (this.recent.length > 0 && now - (this.recent[0] as number) >= 60) this.recent.shift();
        deny = this.recent.length >= HIT_STOP_PER_MINUTE;
      }
      if (deny) {
        this.stats.denied++;
        return 0;
      }
    }
    this.left = Math.max(this.left, ms / 1000);
    this.lastAny = now;
    if (kind === 'leaderDeath') this.lastLeader = now;
    this.recent.push(now);
    this.stats.granted++;
    this.stats.ms += ms;
    this.stats.byKind[kind] = (this.stats.byKind[kind] ?? 0) + 1;
    this.log.push({ at: now, kind, ms });
    if (this.log.length > 64) this.log.shift();
    return ms;
  }

  /** A boss stands (its bossSpawn) / has fallen (its bossDeath): the pack-leader lane keeps quiet in between. */
  bossUp(id: number): void {
    this.bosses.set(id, this.now);
  }

  bossDown(id: number): void {
    this.bosses.delete(id);
  }

  private bossFight(): boolean {
    for (const t of this.bosses.values()) if (this.now - t < BOSS_FIGHT_MAX) return true;
    return false;
  }

  /** Advances the render clock by `rawDt` and returns this frame's dt multiplier (1 = no hit-stop). */
  scale(rawDt: number): number {
    if (!(rawDt > 0)) return 1;
    const dt = rawDt < MAX_FRAME_DT ? rawDt : MAX_FRAME_DT;
    this.now += dt;
    if (this.left <= 0) return 1;
    const inside = dt < this.left ? dt : this.left;
    this.left -= inside;
    return (inside * HIT_STOP_DT_SCALE + (dt - inside)) / dt;
  }

  /** A new run (or the end of one): no hold, a fresh clock and fresh limits. */
  reset(): void {
    this.now = 0;
    this.left = 0;
    this.lastAny = -Infinity;
    this.lastLeader = -Infinity;
    this.recent = [];
    this.bosses.clear();
    this.stats.granted = 0;
    this.stats.denied = 0;
    this.stats.ms = 0;
    this.stats.byKind = {};
    this.log.length = 0;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// FEEL-03: the staging of a boss spawn. The climax of a run, the Great Metin falling and the final boss emerging from it, used to be a shake and the
// boss plate. The final boss now also backs the camera off (render/camera.ts CameraRig.pullBack: +6 m over 1.2 s, held 0.4 s, eased back over
// 1.4 s, its own term on top of the zoom and the boss framing) and pulses the vignette (render/post.ts pulseVignette: +0.25 over 1.2 s); a band boss
// only pulses the vignette (+0.12 over 0.8 s). Render only and local to each client: nothing touches the sim, the net or any material (a vignette
// pulse writes one uniform of the composite pass that is already compiled), so nothing links mid-run. The events reach a co-op guest like the host,
// so both stage it; a guest that joins later sees none. The camera part honours the motion settings (screen shake scales it, 0 = none; the OS
// setting prefers-reduced-motion drops it); the vignette pulse is a light change, not motion, and stays. QA: `?up=noclimax` (dev server /
// VITE_QA_HOOKS builds) switches the whole staging off, the same-tree "before" arm of a blind pair.

/** the vignette pulse of the final boss's emerge: strength added at the peak (on top of the zone's) and how long it lasts (ms) */
export const FINAL_PULSE: Readonly<{ amount: number; ms: number }> = Object.freeze({ amount: 0.25, ms: 1200 });
/** the vignette pulse of a band boss's emerge */
export const BAND_PULSE: Readonly<{ amount: number; ms: number }> = Object.freeze({ amount: 0.12, ms: 800 });

// ---------------------------------------------------------------------------------------------------------------------
// FEEL-04: the run-start fly-in. The router holds the camera on the establishing pose from the run start (behind the intro card), and a
// render system releases it once the run clock moves (the card is closed, or there was none) and the frames are steady (render/camera.ts
// FlyInGate); the rig then eases it into the gameplay camera over 2.5 s. A move input during the hold or the flight runs the rest in 0.4 s.
// While the pose is held or flying, the AutoQuality governor is kept in its grace period: it must judge the gameplay camera, not this one
// (the establishing view costs 25-50 % more per frame, and the intro card can stay open for as long as the player reads). Local to this
// client: nothing here touches the sim or the net.

/** a run of the same zone and hero that starts within this long (ms) after the previous one ended is a restart: no fly-in (the player has just seen it) */
export const FLY_IN_RESTART_MS = 10 * 60 * 1000;

/**
 * A co-op guest's world is the mirror of the host's: net/coop/mirror.ts MirrorWorld owns a `guest` field (the CoopGuest it plays back) and the
 * sim World has none. The field is the only marker there is without a dependency on the co-op code (the main chunk must not import it);
 * camera.test.ts holds both sides of it with the real classes (a World without the field plays, a MirrorWorld skips), so a `guest` added to
 * World, or removed from MirrorWorld, fails there.
 */
function isMirrorWorld(world: World): boolean {
  return 'guest' in (world as object);
}

/**
 * The zone's own system (app/run.ts registers it as 'zone'): its update creates the terrain's chunks and far field for the camera it is
 * handed. The lookup is render/warmupPass.ts primeZoneSystem (the one PERF-01's load-time priming uses; warmup.test.ts reads the real
 * RenderCore source so a rename fails there). `false` and one console warning when the system is not there, instead of a silent miss that
 * would bring the first-flight stall back.
 */
export function refreshZone(rw: RenderWorld): boolean {
  if (primeZoneSystem(rw.core)) return true;
  console.warn('[flyIn] no render system named "zone": the far chunks are not built before the establishing warm-up pass');
  return false;
}

export class RenderEventRouter {
  private off: (() => void) | null = null;
  private offLife: (() => void) | null = null;
  /** FEEL-02: the hit-stop gate + render clock; RenderWorld.frame reads its time scale */
  readonly hitStop = new HitStop();
  /** hit-stop clock time of the last tier-2 death a hero caused (the Champion Hunt's champion is told from a pack leader by the event that follows it) */
  private tier2DeathAt = -Infinity;
  /** the Champion Hunt run event whose end already held a frame (the 'end' is re-sent every 5 s while it lingers) */
  private championEndId = -1;
  /** FEEL-04: the fly-in in progress (held or flying): its render system, the world whose clock releases it, the release gate, and whether a move input already sped it up */
  private flyIn: { sys: RenderSystem; world: World; gate: FlyInGate; hurried: boolean } | null = null;
  /** FEEL-04: the run that is going (zone + hero) and the last one that ended, for the restart rule */
  private liveRun: { zone: string; classId: string } | null = null;
  private lastRun: { zone: string; classId: string; endedAt: number } | null = null;
  private readonly now: () => number;

  constructor(
    private readonly rw: RenderWorld,
    opts: { now?: () => number } = {},
  ) {
    rw.hitStop = this.hitStop;
    this.now = opts.now ?? (() => Date.now());
  }

  attach(): void {
    this.off?.();
    this.offLife?.();
    this.off = runEvents.subscribe((e, w) => this.handle(e, w));
    this.offLife = runEvents.subscribeLifecycle({ runStart: (w) => this.runStart(w), runEnd: () => this.runEnd() });
  }

  detach(): void {
    this.off?.();
    this.off = null;
    this.offLife?.();
    this.offLife = null;
    this.stopFlyIn(true);
  }

  private resetRun(): void {
    this.hitStop.reset();
    // FEEL-03: a pull-back of the run that ended / is replaced never carries into the next one
    this.rw.core?.rig?.cancelPullBack?.();
    this.tier2DeathAt = -Infinity;
    this.championEndId = -1;
  }

  private runStart(world: World): void {
    this.resetRun();
    this.stopFlyIn(true);
    const zone = world.zone?.id ?? '';
    const classId = world.config?.classId ?? '';
    const last = this.lastRun;
    const restart = last !== null && last.zone === zone && last.classId === classId && this.now() - last.endedAt < FLY_IN_RESTART_MS;
    this.liveRun = { zone, classId };
    const rw = this.rw;
    const rig = this.flyInRig();
    // a render core without a system list or a rig without cinematics (menu previews, stand-ins): nothing to fly
    if (!rig || typeof rw.core.addSystem !== 'function') return;
    if (this.skipReason(world, restart)) return;
    rig.cinematic(ESTABLISHING_POSE, FLY_IN_SECONDS, { hold: true });
    try {
      // the second compile / upload pass at the pose (render/warmupPass.ts): behind the loading screen, the pose stays held afterwards
      warmEstablishing(rw.core, { refresh: () => refreshZone(rw) });
    } catch (err) {
      console.warn('[flyIn] establishing warm-up failed', err);
    }
    const sys: RenderSystem = { name: 'flyin', update: (dt) => this.flyInFrame(dt) };
    rw.core.addSystem(sys);
    this.flyIn = { sys, world, gate: new FlyInGate(), hurried: false };
    this.keepGovernorOut();
  }

  private runEnd(): void {
    this.resetRun();
    this.stopFlyIn(true);
    // only a run that started counts for the restart rule (a load that failed before runStart ends here, too)
    if (this.liveRun) this.lastRun = { ...this.liveRun, endedAt: this.now() };
    this.liveRun = null;
  }

  /** the rig, when it can fly (a stand-in core in tests / demos has none) */
  private flyInRig(): CameraRig | null {
    const rig = this.rw.core?.rig;
    return rig && typeof rig.cinematic === 'function' ? rig : null;
  }

  private skipReason(world: World, restart: boolean): string | null {
    const core = this.rw.core;
    return flyInSkip({
      tier: core.quality?.tier,
      shakeScale: core.rig.shakeScale,
      restart,
      guest: isMirrorWorld(world),
      off: flyInOffByPage(),
      reducedMotion: prefersReducedMotion(),
    });
  }

  /**
   * Ends the fly-in bookkeeping: the system leaves the core; `cancel` also puts the camera back on the gameplay rig. `inFrame`: called from
   * the system's own update, i.e. while RenderCore.frame walks its system list: the removal waits for the end of the frame (a splice there
   * would make the system registered after this one miss a frame).
   */
  private stopFlyIn(cancel: boolean, inFrame = false): void {
    const f = this.flyIn;
    this.flyIn = null;
    if (f) {
      const core = this.rw.core;
      if (inFrame) queueMicrotask(() => core.removeSystem(f.sys));
      else core.removeSystem(f.sys);
      // the gameplay camera starts with a fresh grace period: whatever the governor saw of the pose does not count
      this.keepGovernorOut();
    }
    if (cancel) this.flyInRig()?.cancelCinematic();
  }

  /** A governor that is waiting out its 8 s grace judges nothing: while the pose is held or flying, every frame starts it again. */
  private keepGovernorOut(): void {
    this.rw.core.governor?.reset();
  }

  /** The local hero moves (the sim's normalised input of the last step; the run clock must be moving, a card that is open leaves it at 0). */
  private heroMoves(world: World): boolean {
    const p = world.players?.[0];
    return world.time > 0 && !!p && Math.hypot(p.moveX, p.moveZ) > 0.1; // 0.1: a worn stick's drift is not a move
  }

  /** One rendered frame (a RenderCore system: after the rig moved, before the scene is drawn). */
  private flyInFrame(dt: number): void {
    const f = this.flyIn;
    if (!f) return;
    const rig = this.flyInRig();
    // over (flown to the end), or ended from outside (a teleport: the QA spot shots snap the rig): done for good
    if (!rig || !rig.cinematicActive) return this.stopFlyIn(false, true);
    this.keepGovernorOut();
    // a move input: the rest of the flight (or the wait for a steady frame) is 0.4 s, once; the player does not sit through it again and again
    if (!f.hurried && this.heroMoves(f.world)) {
      if (this.skipReason(f.world, false)) return this.stopFlyIn(true, true);
      f.hurried = true;
      rig.hurryCinematic();
      return;
    }
    // flying: the rig advances it by min(dt, 1/30 s) per frame
    if (!rig.cinematicHeld) return;
    if (!f.gate.frame(dt, f.world.time > 0)) return;
    // the settings may have changed while the pose was held (screen shake 0, the governor dropped to low)
    if (this.skipReason(f.world, false)) return this.stopFlyIn(true, true);
    rig.releaseCinematic();
  }

  /**
   * FEEL-03: the staging of a boss spawn (see the block above). The final boss: the camera pull-back and a vignette pulse; a band boss: the
   * smaller vignette pulse only. Every part is optional: a core without a composite pass (low tier, tests) or a rig without the pull-back does nothing for it.
   */
  private stageBossSpawn(final: boolean): void {
    if (climaxOffByPage()) return;
    const core = this.rw.core;
    const pulse = final ? FINAL_PULSE : BAND_PULSE;
    asPostPipeline(core?.composer)?.pulseVignette(pulse.amount, pulse.ms);
    if (final && typeof core?.rig?.pullBack === 'function' && !prefersReducedMotion()) core.rig.pullBack();
  }

  /** FEEL-02: asks the gate for a hold, scaled by the player's screen-shake setting (0 = hit-stop off) */
  private hold(kind: HitStopKind): void {
    this.hitStop.trigger(kind, this.rw.core.rig.shakeScale);
  }

  /**
   * FEEL-02: can the local player see this spot? Asked BEFORE the gate, so a moment nobody sees uses no rate-limit budget (the 3 s gap, the
   * 15 s pack-leader lane, the 12 a minute): a partner's kill in co-op reaches every client, wherever it happens.
   */
  private onScreen(x: number, z: number): boolean {
    return this.rw.core.rig.isVisible(x, z, HIT_STOP_VIEW_MARGIN);
  }

  private handle(e: SimEvent, world: World): void {
    const rw = this.rw;
    switch (e.t) {
      case 'enemyDeath':
        rw.enemyDied(e.type, e.x, e.z, e.rot, e.scale);
        if (e.tier >= 2) rw.shake(0.35);
        else if (e.tier === 1) rw.shake(0.08);
        // FEEL-02: a pack leader / champion (tier 2) a hero killed. A boss (tier 3) holds through its bossDeath event; a plain elite
        // (tier 1, also a metin's stone row) and the Champion Hunt's burrow-away (killer -1) never do.
        // Only when it happened on screen (also the pairing below: a champion that fell out of view holds nothing).
        if (e.tier === 2 && e.killer >= 0 && this.onScreen(e.x, e.z)) {
          this.tier2DeathAt = this.hitStop.now;
          this.hold('leaderDeath');
        }
        break;
      case 'damage': {
        const col = elementColor(element(e.element));
        rw.damage.spawn(e.x, e.z, e.amount, {
          crit: e.crit,
          color: col,
          targetId: e.targetId,
          kind: e.dot ? 'status' : 'normal',
          // co-op: a partner's hit never takes the local hero's places in the number field
          player: e.player,
        });
        break;
      }
      case 'playerHit': {
        if (e.result !== 0) {
          
          rw.damage.spawnText(e.result === 1 ? 'evade' : 'block', e.x, e.z, 0);
          break;
        }
        const p = world.players[e.player];
        // one stacking counter per player (merge key far above enemy ids), placed beside the hero by DamageNumbers
        rw.damage.spawn(e.x, e.z, e.amount, { kind: 'player', crit: false, targetId: PLAYER_NUMBER_ID + e.player, height: 2.1 });
        const hpFrac = p && p.hpMax > 0 ? e.amount / p.hpMax : e.amount / 200;
        rw.shake(Math.min(0.68, 0.28 + Math.min(0.4, hpFrac * 1.6)));
        if (p && e.player === 0) rw.heroes.views[e.player]?.trigger('hit');
        break;
      }
      case 'heal': {
        const p = world.players[e.player];
        if (p && e.amount >= 1) rw.damage.spawn(p.x, p.z, Math.round(e.amount), { kind: 'heal', height: 2.2, targetId: PLAYER_NUMBER_ID + e.player });
        break;
      }
      case 'pickup':
        if (e.kind === 1 && e.value >= 1) rw.damage.spawn(e.x, e.z, Math.round(e.value), { kind: 'yeop', height: 1.1, targetId: YEOP_NUMBER_ID });
        // xp gain (PickupKind.Xp = 0): one "+N XP" counter that keeps adding for a second, not a number per gem
        else if (e.kind === 0 && e.value > 0) rw.damage.spawnText('xp', e.x, e.z, e.value);
        break;
      case 'skillCast': {
        if (!e.noHeroAnim) {
          const view = rw.heroes.views[e.player];
          if (view) {
            const clip = e.heroClip && HERO_ACTIONS.has(e.heroClip) ? e.heroClip : e.behavior === 'meleeArc' ? 'attack' : 'cast';
            const directional =
              e.behavior !== 'selfBuff' &&
              e.behavior !== 'persistentAura' &&
              e.behavior !== 'spinAura' &&
              e.behavior !== 'shockwave' &&
              e.behavior !== 'orbit' &&
              e.behavior !== 'summon';
            const aimYaw = directional && e.dirX * e.dirX + e.dirZ * e.dirZ > 1e-6 ? Math.atan2(e.dirX, e.dirZ) : undefined;
            view.trigger(clip as HeroAction, 1, false, aimYaw);
          }
        }
        break;
      }
      case 'shake':
        rw.shake(e.amount);
        break;
      case 'bossSpawn':
        rw.shake(e.final ? 0.9 : 0.6);
        this.hitStop.bossUp(e.boss);
        this.stageBossSpawn(e.final);
        break;
      case 'bossPhase':
        this.hold('bossPhase'); // a phase change or the enrage
        break;
      case 'bossDeath':
        rw.shake(0.8);
        this.hitStop.bossDown(e.boss);
        this.hold(e.final ? 'finalBossDeath' : 'bossDeath');
        break;
      case 'metinImpact':
        rw.shake(e.great ? 1 : 0.7);
        break;
      case 'metinBreak':
        rw.shake(e.great ? 0.9 : 0.5);
        // the Great Metin (the final wave, announced by the HUD) is global; a regular metin only when it breaks in view
        if (e.great || this.onScreen(e.x, e.z)) this.hold('metinBreak');
        break;
      case 'runEvent':
        // the Champion Hunt was won: its 'end' (p 1) comes in the step the champion fell, right after the champion's own enemyDeath
        if (e.kind === 'championHunt' && e.phase === 'end' && e.p >= 1 && e.id !== this.championEndId) {
          this.championEndId = e.id;
          if (this.hitStop.now - this.tier2DeathAt <= CHAMPION_PAIR_WINDOW) this.hold('championDeath');
        }
        break;
      case 'levelUp':
        // brief non-held flourish so the hero never locks out of run/idle locomotion after leveling up
        rw.heroes.views[e.player]?.trigger('victory', 1.15, false);
        break;
      default:
        break;
    }
  }
}
