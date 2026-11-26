// Launch / blow queue between the projectile renderer (render/fx/projectiles.ts, which sees every hostile projectile appear
// and vanish in the feed) and the VFX layer (vfx/common/enemy-projectiles/route.ts, which turns them into the release flash
// and the impact). A module-level ring buffer: the renderer pushes, the route drains once per VFX frame. No sim edits, no
// handle between the two systems (render/world.ts is core-owned and wires neither).

/** projectile look codes (hostile element looks); the order is the shader's `lk` */
export const LOOK = { physical: 0, fire: 1, ice: 2, lightning: 3, dark: 4, poison: 5, holy: 6, wind: 7, blood: 8 } as const;
export type LookName = keyof typeof LOOK;
export const LOOK_NAMES: readonly LookName[] = ['physical', 'fire', 'ice', 'lightning', 'dark', 'poison', 'holy', 'wind', 'blood'];

export const enum ProjEventKind {
  
  Launch = 0,
  /** it vanished: hit the hero (`hit`) or ran out / hit something else (fizzle) */
  Blow = 1,
}

export interface ProjEvent {
  kind: ProjEventKind;
  look: number;
  /** ProjectileStyleDef.shape index (0 orb, 1 arrow, 2 blade, 3 talisman, 4 bolt) */
  shape: number;
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirZ: number;
  /** visual radius (m) */
  radius: number;
  /** m/s */
  speed: number;
  /** Blow only: it reached the hero */
  hit: boolean;
}

const CAP = 96;
const buf: ProjEvent[] = Array.from({ length: CAP }, () => ({ kind: 0, look: 0, shape: 0, x: 0, y: 0, z: 0, dirX: 0, dirZ: 1, radius: 0.3, speed: 0, hit: false }));
let head = 0;
let n = 0;

/** renderer side: queue one event (dropped when the route is not draining, e.g. galleries without an EventAdapter) */
export function pushProjEvent(
  kind: ProjEventKind,
  look: number,
  shape: number,
  x: number,
  y: number,
  z: number,
  dirX: number,
  dirZ: number,
  radius: number,
  speed: number,
  hit: boolean,
): void {
  if (n >= CAP) return;
  const e = buf[(head + n) % CAP] as ProjEvent;
  e.kind = kind;
  e.look = look;
  e.shape = shape;
  e.x = x;
  e.y = y;
  e.z = z;
  e.dirX = dirX;
  e.dirZ = dirZ;
  e.radius = radius;
  e.speed = speed;
  e.hit = hit;
  n++;
}

/** route side: hands every queued event to `fn` (synchronously, the objects are reused) and empties the queue */
export function drainProjEvents(fn: (e: ProjEvent) => void): number {
  const c = n;
  for (let i = 0; i < c; i++) fn(buf[(head + i) % CAP] as ProjEvent);
  head = (head + c) % CAP;
  n = 0;
  return c;
}

export function clearProjEvents(): void {
  head = 0;
  n = 0;
}

export function pendingProjEvents(): number {
  return n;
}
