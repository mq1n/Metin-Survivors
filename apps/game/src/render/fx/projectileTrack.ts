// Frame-to-frame identity of hostile projectiles. The feed (render/feed.ts ProjectileFeed) is a dense array without ids (a
// removed row is replaced by the last one), so "this projectile just appeared / just vanished" is recovered from what is
// constant along a straight flight: the style, the yaw, the launch point (position - direction x speed x age) and the birth
// time. Waves of one volley share yaw and launch point but are >= 0.3 s apart, which the birth tolerance separates.
// Launch -> release flash, vanish -> impact (render/fx/projectileEvents.ts, drained by vfx/common/enemy-projectiles/route.ts).

export const enum TrackEvent {
  Launch = 0,
  Blow = 1,
}

export interface TrackRec {
  style: number;
  rot: number;
  p0x: number;
  p0z: number;
  birth: number;
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number;
  r: number;
  speed: number;
  look: number;
  shape: number;
  frames: number;
  seen: boolean;
}

const ROT_EPS = 0.004;
const P0_EPS = 0.22;
const BIRTH_EPS = 0.16;
/** a projectile already older than this when first seen is not a launch (late join, camera culling) */
export const LAUNCH_MAX_AGE = 0.12;
const MAX_RECS = 512;

export class ProjectileTracker {
  readonly recs: TrackRec[] = [];

  /** start of a frame: nothing seen yet */
  begin(): void {
    for (const r of this.recs) r.seen = false;
  }

  /**
   * One hostile row of this frame. `age` = seconds since spawn; `birth` = now - age. Returns the record (new or matched) and
   * whether it is new (so the caller can emit a Launch when `age <= LAUNCH_MAX_AGE`).
   */
  see(style: number, rot: number, x: number, y: number, z: number, dx: number, dz: number, speed: number, age: number, birth: number, r: number, look: number, shape: number): { rec: TrackRec; isNew: boolean } | null {
    const p0x = x - dx * speed * age;
    const p0z = z - dz * speed * age;
    const recs = this.recs;
    for (let i = 0; i < recs.length; i++) {
      const c = recs[i] as TrackRec;
      if (c.seen || c.style !== style) continue;
      if (Math.abs(c.rot - rot) > ROT_EPS || Math.abs(c.p0x - p0x) > P0_EPS || Math.abs(c.p0z - p0z) > P0_EPS || Math.abs(c.birth - birth) > BIRTH_EPS) continue;
      c.seen = true;
      c.frames++;
      c.birth = birth;
      c.x = x;
      c.y = y;
      c.z = z;
      c.dx = dx;
      c.dz = dz;
      c.speed = speed;
      c.r = r;
      return { rec: c, isNew: false };
    }
    if (recs.length >= MAX_RECS) return null;
    const rec: TrackRec = { style, rot, p0x, p0z, birth, x, y, z, dx, dz, r, speed, look, shape, frames: 1, seen: true };
    recs.push(rec);
    return { rec, isNew: true };
  }

  /** end of a frame: every record not matched is gone -> `onGone(rec)`, then dropped */
  end(onGone: (r: TrackRec) => void): void {
    const recs = this.recs;
    for (let i = recs.length - 1; i >= 0; i--) {
      const c = recs[i] as TrackRec;
      if (c.seen) continue;
      onGone(c);
      const last = recs.pop() as TrackRec;
      if (i < recs.length) recs[i] = last;
    }
  }

  clear(): void {
    this.recs.length = 0;
  }
}
