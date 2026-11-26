// Hits route (common VFX target `hits`; owner: the hits builder): one element hit spark per direct damage event, the

// status route.
import type { Resolved } from '../../presets';
import { route, type EventRoute } from '../route';

const ELEMENT_COUNT = 8;
const NAMES = ['physical', 'fire', 'ice', 'lightning', 'dark', 'poison', 'holy', 'wind'] as const;
/** direct-hit sparks per VFX frame at density 1 (crits, boss hits and killing blows always play) */
export const HIT_BUDGET = 150;
/** body height of a normal enemy (the element hits are spawned there; sk.gen.* carry their own lift) */
export const HIT_BODY_Y = 0.9;
/** pierce heuristic window: a later hit of the same player + skill slot, further along the same line (s) */
export const PIERCE_WINDOW = 0.35;
/** max angle between the two hits seen from the player (rad) and the min / max extra distance (m) */
export const PIERCE_ANGLE = 0.11;
export const PIERCE_MIN_GAIN = 0.35;
export const PIERCE_MAX_GAIN = 9;
/** size of the physical blow under a crit (the gold critical carries the read) */
export const CRIT_PHYSICAL_SCALE = 0.45;
/** piercing hits shown per VFX frame at density 1 */
export const PIERCE_BUDGET = 12;

/** hit size tier: light chip → normal → heavy (amount), boss, killing blow; crits get their own twirl on top */
export function hitScale(amount: number, crit: boolean, boss: boolean, killed: boolean): number {
  if (boss) return 1.45;
  const base = 0.85 + Math.min(0.4, Math.log10(1 + Math.max(0, amount)) * 0.12);
  return crit ? Math.max(1.12, base) : killed ? Math.max(1.05, base) : base;
}

interface LastHit {
  time: number;
  x: number;
  z: number;
  /** distance + direction from the player at that hit */
  d: number;
  a: number;
  target: number;
}

export function hitRoutes(): readonly EventRoute[] {
  
  let hit: (Resolved | null)[] | null = null;
  let critDef: Resolved | null = null;
  let penDef: Resolved | null = null;
  let budget = 0;
  let pierceBudget = 0;
  // last direct hit per (player, skill slot): projectile pass-through detection while the sim has no pierce flag
  const last = new Map<number, LastHit>();
  return [
    route(
      ['damage'],
      (e, ctx) => {
        if (e.dot) return; // DoT ticks: status route
        const heavy = e.crit || e.boss || e.killed;
        if (budget <= 0 && !heavy) return;
        budget--;
        if (hit === null) {
          hit = [];
          for (let i = 0; i < ELEMENT_COUNT; i++) hit.push(ctx.resolve(i === 0 ? 'sk.gen.hit' : 'hit.' + NAMES[i]));
          critDef = ctx.resolve('sk.gen.critical');
          penDef = ctx.resolve('sk.gen.penetrate');
        }
        const el = e.element >= 0 && e.element < ELEMENT_COUNT ? e.element : 0;
        const d = hit[el];
        const scale = hitScale(e.amount, e.crit, e.boss, e.killed);
        const o = ctx.o(e.x, e.z, scale);
        
        const ground = ctx.heightAt(e.x, e.z);
        o.y = el === 0 ? ground : ground + HIT_BODY_Y;
        // a physical crit is drawn by the critical itself (gold ray burst + hot core): the full-size cream sunburst under it read as a cold
        // pale ring, so the blow shrinks to its ochre heart (the ids stay: the core routes test pins sk.gen.hit + sk.gen.critical)
        if (e.crit && el === 0 && critDef) o.scale = scale * CRIT_PHYSICAL_SCALE;
        if (d) ctx.spawnResolved(d, o);
        if (e.crit && critDef) {
          o.scale = e.boss ? 1.35 : 1;
          o.y = ground;
          ctx.spawnResolved(critDef, o);
        }
        // piercing hit: the sim flag when it exists, else a later hit of the same player + skill slot further along the
        // same line from the player (a projectile that went through the previous target)
        const flagged = (e as { pierce?: boolean }).pierce;
        if (!(e.skill >= 0) || !penDef) return;
        const p = ctx.players;
        const pi = e.player >= 0 && (e.player + 1) * 3 <= p.length ? e.player * 3 : 0;
        const px = (p[pi] as number) ?? 0;
        const pz = (p[pi + 2] as number) ?? 0;
        const dx = e.x - px;
        const dz = e.z - pz;
        const dist = Math.hypot(dx, dz);
        const ang = Math.atan2(dx, dz);
        const key = e.player * 4096 + e.skill;
        const prev = last.get(key);
        let pierced = flagged === true;
        let dirX = dx;
        let dirZ = dz;
        if (flagged === undefined && prev !== undefined && prev.target !== e.targetId) {
          const dt = ctx.time - prev.time;
          let da = Math.abs(ang - prev.a);
          if (da > Math.PI) da = 2 * Math.PI - da;
          const gain = dist - prev.d;
          if (dt > 1e-4 && dt <= PIERCE_WINDOW && da <= PIERCE_ANGLE && gain >= PIERCE_MIN_GAIN && gain <= PIERCE_MAX_GAIN) {
            pierced = true;
            dirX = e.x - prev.x;
            dirZ = e.z - prev.z;
          }
        }
        let rec = prev;
        if (rec === undefined) {
          rec = { time: 0, x: 0, z: 0, d: 0, a: 0, target: -1 };
          last.set(key, rec);
        }
        rec.time = ctx.time;
        rec.x = e.x;
        rec.z = e.z;
        rec.d = dist;
        rec.a = ang;
        rec.target = e.targetId;
        if (!pierced || pierceBudget <= 0) return;
        pierceBudget--;
        const l = Math.hypot(dirX, dirZ) || 1;
        const po = ctx.o(e.x, e.z, e.boss ? 1.3 : 1, dirX / l, dirZ / l);
        po.y = ground;
        ctx.spawnResolved(penDef, po);
      },
      {
        update: (_dt, ctx) => {
          budget = HIT_BUDGET * ctx.density;
          pierceBudget = PIERCE_BUDGET * ctx.density;
        },
        reset: () => {
          last.clear();
          budget = 0;
          pierceBudget = 0;
        },
      },
    ),
  ];
}
