// DEV-only: a sim stand-in producing render feeds (typed arrays) for benchmarks and the vertical slice before Sim lands.
// Mimics the real store semantics: swap-remove deaths, prev/cur positions, clip index + time, flash decay.
import type { EnemyFeed, PickupFeed, PlayerFeed, ProjectileFeed, TelegraphFeed } from '../render/feed';
import { CLIP_NAMES } from '../render/feed';
import type { MoveVector } from '../engine/input';

const CLIP = {
  idle: CLIP_NAMES.indexOf('idle'),
  walk: CLIP_NAMES.indexOf('walk'),
  run: CLIP_NAMES.indexOf('run'),
  attack: CLIP_NAMES.indexOf('attack'),
  hit: CLIP_NAMES.indexOf('hit'),
};

function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class StressEnemies implements EnemyFeed {
  count = 0;
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly px: Float32Array;
  readonly pz: Float32Array;
  readonly rot: Float32Array;
  readonly scale: Float32Array;
  readonly type: Uint16Array;
  readonly animClip: Uint8Array;
  readonly animT: Float32Array;
  readonly flash: Float32Array;
  readonly eliteTier: Uint8Array;
  readonly corrupted: Float32Array;
  readonly status: Uint16Array;
  readonly id: Uint32Array;
  readonly flags: Uint8Array;
  readonly speed: Float32Array;
  nextId = 1;

  constructor(readonly capacity: number) {
    this.x = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.px = new Float32Array(capacity);
    this.pz = new Float32Array(capacity);
    this.rot = new Float32Array(capacity);
    this.scale = new Float32Array(capacity);
    this.type = new Uint16Array(capacity);
    this.animClip = new Uint8Array(capacity);
    this.animT = new Float32Array(capacity);
    this.flash = new Float32Array(capacity);
    this.eliteTier = new Uint8Array(capacity);
    this.corrupted = new Float32Array(capacity);
    this.status = new Uint16Array(capacity);
    this.id = new Uint32Array(capacity);
    this.flags = new Uint8Array(capacity);
    this.speed = new Float32Array(capacity);
  }

  removeAt(i: number): void {
    const last = --this.count;
    if (i === last) return;
    for (const a of [this.x, this.z, this.px, this.pz, this.rot, this.scale, this.animT, this.flash, this.corrupted, this.speed]) {
      a[i] = a[last] as number;
    }
    this.type[i] = this.type[last] as number;
    this.animClip[i] = this.animClip[last] as number;
    this.eliteTier[i] = this.eliteTier[last] as number;
    this.status[i] = this.status[last] as number;
    this.id[i] = this.id[last] as number;
  }
}

export interface StressEvents {
  deaths: { type: number; x: number; z: number; rot: number; scale: number }[];
  damage: { x: number; z: number; amount: number; crit: boolean; id: number }[];
}

export interface StressOptions {
  enemies: number;
  types: number;
  seed?: number;
  /** extra feeds for the fx systems */
  projectiles?: number;
  pickups?: number;
  telegraphs?: number;
  /** enemy speed multiplier */
  speed?: number;
}

export class StressDriver {
  readonly enemies: StressEnemies;
  readonly events: StressEvents = { deaths: [], damage: [] };
  readonly player = { x: 0, z: 0, px: 0, pz: 0, rot: 0, speed: 0, dead: false, flash: 0, corrupted: 0 };
  readonly projectiles: ProjectileFeed;
  readonly pickups: PickupFeed;
  readonly telegraphs: TelegraphFeed;
  time = 0;
  /** when true the hero walks a figure-8 by itself */
  autopilot = true;
  /** enemies killed per second on average (they respawn on the ring) */
  killRate = 40;
  playerSpeed = 5;

  private readonly rnd: () => number;
  private readonly opts: StressOptions;
  private readonly pj: { count: number; x: Float32Array; z: Float32Array; px: Float32Array; pz: Float32Array; h: Float32Array; rot: Float32Array; radius: Float32Array; style: Uint8Array; hostile: Uint8Array; age: Float32Array };
  private readonly pk: { count: number; x: Float32Array; z: Float32Array; kind: Uint8Array; tier: Uint8Array; age: Float32Array; magnet: Uint8Array; h: Float32Array };
  private readonly tg: { count: number; shape: Uint8Array; owner: Uint8Array; x: Float32Array; z: Float32Array; rot: Float32Array; radius: Float32Array; length: Float32Array; width: Float32Array; progress: Float32Array };

  constructor(opts: StressOptions) {
    this.opts = opts;
    this.killRate = Math.max(2, opts.enemies * 0.07);
    this.rnd = lcg(opts.seed ?? 1234);
    this.enemies = new StressEnemies(Math.max(opts.enemies + 64, 128));
    for (let i = 0; i < opts.enemies; i++) this.spawn(true);

    const np = opts.projectiles ?? 0;
    const pj = (this.pj = {
      count: np,
      x: new Float32Array(np),
      z: new Float32Array(np),
      px: new Float32Array(np),
      pz: new Float32Array(np),
      h: new Float32Array(np),
      rot: new Float32Array(np),
      radius: new Float32Array(np),
      style: new Uint8Array(np),
      hostile: new Uint8Array(np),
      age: new Float32Array(np),
    });
    for (let i = 0; i < np; i++) {
      pj.radius[i] = 0.25 + this.rnd() * 0.2;
      pj.style[i] = i % 5;
      pj.hostile[i] = this.rnd() < 0.2 ? 1 : 0;
      pj.h[i] = 0.9 + this.rnd() * 0.5;
      pj.age[i] = this.rnd() * 3;
    }
    this.projectiles = pj;
    const nk = opts.pickups ?? 0;
    const pk = (this.pk = {
      count: nk,
      x: new Float32Array(nk),
      z: new Float32Array(nk),
      kind: new Uint8Array(nk),
      tier: new Uint8Array(nk),
      age: new Float32Array(nk),
      magnet: new Uint8Array(nk),
      h: new Float32Array(nk),
    });
    for (let i = 0; i < nk; i++) {
      const a = this.rnd() * Math.PI * 2;
      const r = 3 + this.rnd() * 26;
      pk.x[i] = Math.cos(a) * r;
      pk.z[i] = Math.sin(a) * r;
      const k = this.rnd();
      pk.kind[i] = k < 0.7 ? 0 : k < 0.85 ? 1 : k < 0.93 ? 2 : k < 0.97 ? 3 : 4;
      pk.tier[i] = pk.kind[i] === 0 ? Math.floor(this.rnd() * 5) : Math.floor(this.rnd() * 3);
      pk.age[i] = this.rnd() * 6;
    }
    this.pickups = pk;
    const nt = opts.telegraphs ?? 0;
    const tg = (this.tg = {
      count: nt,
      shape: new Uint8Array(nt),
      owner: new Uint8Array(nt),
      x: new Float32Array(nt),
      z: new Float32Array(nt),
      rot: new Float32Array(nt),
      radius: new Float32Array(nt),
      length: new Float32Array(nt),
      width: new Float32Array(nt),
      progress: new Float32Array(nt),
    });
    for (let i = 0; i < nt; i++) {
      tg.shape[i] = i % 4;
      tg.owner[i] = i % 3;
      const a = this.rnd() * Math.PI * 2;
      const r = 5 + this.rnd() * 14;
      tg.x[i] = Math.cos(a) * r;
      tg.z[i] = Math.sin(a) * r;
      tg.rot[i] = this.rnd() * Math.PI * 2;
      tg.radius[i] = 2 + this.rnd() * 4;
      tg.length[i] = tg.shape[i] === 3 ? tg.radius[i]! * 0.6 : 8;
      tg.width[i] = tg.shape[i] === 1 ? 1.2 : 2;
    }
    this.telegraphs = tg;
  }

  /** Grows/shrinks the live crowd (benchmark phases). */
  setEnemyCount(n: number): void {
    const e = this.enemies;
    const target = Math.min(n, e.capacity);
    while (e.count > target) e.removeAt(e.count - 1);
    while (e.count < target) this.spawn(true);
  }

  /** Mutable PlayerFeed view (single local hero). */
  get players(): PlayerFeed[] {
    return [this.player];
  }

  private spawn(initial: boolean): void {
    const e = this.enemies;
    if (e.count >= e.capacity) return;
    const i = e.count++;
    const a = this.rnd() * Math.PI * 2;
    const r = initial ? 6 + this.rnd() * 28 : 30 + this.rnd() * 6;
    const x = this.player.x + Math.cos(a) * r;
    const z = this.player.z + Math.sin(a) * r;
    e.x[i] = e.px[i] = x;
    e.z[i] = e.pz[i] = z;
    e.rot[i] = this.rnd() * Math.PI * 2;
    const t = Math.floor(this.rnd() * this.opts.types);
    e.type[i] = t;
    const roll = this.rnd();
    e.eliteTier[i] = roll < 0.02 ? 2 : roll < 0.08 ? 1 : 0;
    e.scale[i] = (0.9 + this.rnd() * 0.25) * (e.eliteTier[i] ? 1.25 : 1);
    e.animClip[i] = CLIP.walk;
    e.animT[i] = this.rnd() * 3;
    e.flash[i] = 0;
    e.corrupted[i] = this.rnd() < 0.12 ? 1 : 0;
    e.status[i] = this.rnd() < 0.06 ? 1 << Math.floor(this.rnd() * 6) : 0;
    e.id[i] = e.nextId++;
    e.speed[i] = (2.2 + this.rnd() * 1.8) * (this.opts.speed ?? 1);
  }

  /** One 60 Hz tick. */
  step(dt: number, move: MoveVector): void {
    this.time += dt;
    const p = this.player;
    p.px = p.x;
    p.pz = p.z;
    let mx = move.x;
    let mz = move.z;
    if (this.autopilot) {
      const t = this.time * 0.35;
      mx = Math.cos(t);
      mz = Math.sin(t * 2) * 0.8;
    }
    const len = Math.hypot(mx, mz);
    p.speed = len > 0.05 ? this.playerSpeed * Math.min(1, len) : 0;
    if (len > 0.05) {
      p.x += (mx / Math.max(len, 1)) * this.playerSpeed * Math.min(1, len) * dt;
      p.z += (mz / Math.max(len, 1)) * this.playerSpeed * Math.min(1, len) * dt;
      p.rot = Math.atan2(mx, mz);
    }
    p.flash = Math.max(0, p.flash - dt * 4);

    const e = this.enemies;
    this.events.deaths.length = 0;
    this.events.damage.length = 0;
    for (let i = 0; i < e.count; i++) {
      e.px[i] = e.x[i] as number;
      e.pz[i] = e.z[i] as number;
      const dx = p.x - (e.x[i] as number);
      const dz = p.z - (e.z[i] as number);
      const d = Math.hypot(dx, dz) || 1;
      const near = d < 1.3;
      if (!near) {
        const sp = e.speed[i] as number;
        e.x[i] = (e.x[i] as number) + (dx / d) * sp * dt;
        e.z[i] = (e.z[i] as number) + (dz / d) * sp * dt;
        e.rot[i] = Math.atan2(dx, dz);
      }
      e.animT[i] = (e.animT[i] as number) + dt * (near ? 1 : 1);
      const flash = Math.max(0, (e.flash[i] as number) - dt * 5);
      e.flash[i] = flash;
      e.animClip[i] = near ? CLIP.attack : (e.speed[i] as number) > 3.4 ? CLIP.run : CLIP.walk;
    }

    // random kills (swap-remove) + respawn to keep the crowd size constant
    const kills = Math.min(e.count, Math.floor(this.killRate * dt + this.rnd()));
    for (let k = 0; k < kills; k++) {
      const i = Math.floor(this.rnd() * e.count);
      this.events.deaths.push({ type: e.type[i] as number, x: e.x[i] as number, z: e.z[i] as number, rot: e.rot[i] as number, scale: e.scale[i] as number });
      e.removeAt(i);
      this.spawn(false);
    }
    // random hits (flash + damage numbers)
    const hits = Math.min(e.count, Math.floor(this.killRate * 2.5 * dt + this.rnd()));
    for (let k = 0; k < hits; k++) {
      const i = Math.floor(this.rnd() * e.count);
      e.flash[i] = 1;
      this.events.damage.push({
        x: e.x[i] as number,
        z: e.z[i] as number,
        amount: Math.floor(10 + this.rnd() * 90),
        crit: this.rnd() < 0.15,
        id: e.id[i] as number,
      });
    }

    // projectiles orbit the hero
    const pj = this.pj;
    for (let i = 0; i < pj.count; i++) {
      pj.px[i] = pj.x[i] as number;
      pj.pz[i] = pj.z[i] as number;
      pj.age[i] = (pj.age[i] as number) + dt;
      const a = (pj.age[i] as number) * (1.5 + (i % 7) * 0.15) + i;
      const r = 3 + (i % 11) * 1.4 + Math.sin(this.time + i) * 0.8;
      pj.x[i] = p.x + Math.cos(a) * r;
      pj.z[i] = p.z + Math.sin(a) * r;
      pj.rot[i] = Math.atan2(-Math.sin(a), Math.cos(a));
    }
    // telegraphs cycle their fill
    const tg = this.tg;
    for (let i = 0; i < tg.count; i++) tg.progress[i] = ((this.time * 0.4 + i * 0.173) % 1.2) / 1.2;
    const pk = this.pk;
    for (let i = 0; i < pk.count; i++) pk.age[i] = (pk.age[i] as number) + dt;
  }
}
