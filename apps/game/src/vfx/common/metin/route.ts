// Metin routes (C0 split of the old EventAdapter.onMetinWarn / Impact / Awaken / Break + startAura) with the C2 liveness
// fix: a corruption loop that ended on its own (lifetime bug, pool eviction) is respawned while its stone stands.

// scaled for the game camera, and a hit on a standing stone plays the (throttled) splash.
import { route, type EventRoute, type RouteCtx } from '../route';
import { metinLoopId } from './specs';

const SLOTS = 16;
/** how often the standing stones' loops are checked for liveness (s) */
export const AURA_CHECK = 0.25;
/** the great metin is 2.4x the stone; the effects that are authored for one stone grow with it (a little less than linear: it must still fit the frame) */
export const GREAT_K = 2.3;
/** the great metin's break star: 3.6 changed 30 % of the 1080p frame at the white-hot peak (budget 25 %, white-out < 1 %), 3.0 keeps the biggest event of the game under it */
export const GREAT_BREAK_K = 3.0;
/** the normal stone's drop column / sky trail: ~1.7x the authored size (the stone lands 25-35 m from the camera) */
export const DROP_K = 1.7;
/** the corruption smoke of a stone: the specs are authored for a 1.5 m tall / 0.8 m wide stone, ours is ~2.5 m wide and ~3 m tall (r1: at 1.35 the
 *  smoke sat inside the crystal body and was invisible in the game shot) */
export const LOOP_K = 2.3;
/** a damage event this close to a standing stone is a hit ON the stone (the stone's hit row sits at its position), m */
const HIT_R = 0.9;
/** seconds between two splashes of one stone */
const SPLASH_GAP = 0.45;

export function metinRoutes(): readonly EventRoute[] {
  const mId = new Int32Array(SLOTS);
  const mH = new Int32Array(SLOTS);
  const mX = new Float32Array(SLOTS);
  const mZ = new Float32Array(SLOTS);
  const mGreat = new Uint8Array(SLOTS);
  const mAwk = new Uint8Array(SLOTS);
  const mDef: string[] = new Array<string>(SLOTS).fill('');
  const mSplash = new Float32Array(SLOTS);
  let check = 0;

  const slotOf = (id: number): number => {
    for (let i = 0; i < SLOTS; i++) if (mId[i] === id) return i;
    for (let i = 0; i < SLOTS; i++) if (mId[i] === 0) return i;
    return -1;
  };
  const spawnLoop = (ctx: RouteCtx, slot: number): void => {
    const x = mX[slot] as number;
    const z = mZ[slot] as number;
    const great = mGreat[slot] === 1;
    
    // stones show the last (densest) stage
    const o = ctx.o(x, z, (great ? 1.7 : 1) * LOOP_K);
    o.y = ctx.heightAt(x, z) + 0.4;
    mH[slot] = ctx.fire(metinLoopId(ctx.metinRune(mDef[slot] as string, great), mAwk[slot] === 1 ? 4 : 1), o);
  };
  const startAura = (ctx: RouteCtx, id: number, def: string, x: number, z: number, great: boolean, awakened: boolean): void => {
    const slot = slotOf(id + 1);
    if (slot < 0) return;
    if (mId[slot] === id + 1) ctx.stop(mH[slot] as number);
    mId[slot] = id + 1;
    mX[slot] = x;
    mZ[slot] = z;
    mGreat[slot] = great ? 1 : 0;
    mAwk[slot] = awakened ? 1 : 0;
    mDef[slot] = def;
    mSplash[slot] = -9;
    spawnLoop(ctx, slot);
  };

  return [
    route(['metinWarn'], (e, ctx) => {
      
      const k = e.great ? GREAT_K * 1.3 : DROP_K;
      const o = ctx.o(e.x, e.z, k);
      o.duration = e.dur;
      ctx.fire('sk.gen.metin_drop', o);
      const f = ctx.o(e.x, e.z, k);
      f.duration = e.dur;
      ctx.fire('metin.fall', f);
    }),
    route(['metinImpact'], (e, ctx) => {
      const R = e.radius > 0 ? e.radius : 3;
      
      ctx.fire('sk.gen.metin_crash', ctx.o(e.x, e.z, R));
      const o = ctx.o(e.x, e.z, R);
      o.a = e.great ? 1 : 0;
      o.color = ctx.metinRune(e.def, e.great);
      ctx.fire('metin.impact', o);
      startAura(ctx, e.metin, e.def, e.x, e.z, e.great, false);
    }),
    route(['metinAwaken'], (e, ctx) => {
      const o = ctx.o(e.x, e.z, 1);
      o.color = ctx.metinRune(e.def, false);
      ctx.fire('metin.awaken', o);
      startAura(ctx, e.metin, e.def, e.x, e.z, false, true);
    }),
    route(['damage'], (e, ctx) => {
      
      if (e.dot) return;
      for (let i = 0; i < SLOTS; i++) {
        if (mId[i] === 0) continue;
        const dx = e.x - (mX[i] as number);
        const dz = e.z - (mZ[i] as number);
        if (dx * dx + dz * dz > HIT_R * HIT_R) continue;
        if (ctx.time - (mSplash[i] as number) < SPLASH_GAP) return;
        mSplash[i] = ctx.time;
        ctx.fire('sk.gen.metin_splash', ctx.o(mX[i] as number, mZ[i] as number, mGreat[i] === 1 ? GREAT_K : 1));
        return;
      }
    }),
    route(
      ['metinBreak'],
      (e, ctx) => {
        const slot = slotOf(e.metin + 1);
        if (slot >= 0 && mId[slot] === e.metin + 1) {
          ctx.stop(mH[slot] as number);
          mId[slot] = 0;
          mH[slot] = 0;
        }
        
        ctx.fire('sk.gen.metin_break', ctx.o(e.x, e.z, e.great ? GREAT_BREAK_K : 2.0));
        // the essence reveal + shards (rune colour; red when the stone was awakened)
        const o = ctx.o(e.x, e.z, e.great ? GREAT_K : 1);
        o.color = ctx.metinRune(e.def, e.great);
        o.a = e.awakened ? 1 : 0;
        ctx.fire('metin.shatter', o);
      },
      {
        update: (dt, ctx) => {
          check -= dt;
          if (check > 0) return;
          check = AURA_CHECK;
          for (let i = 0; i < SLOTS; i++) if (mId[i] !== 0 && !ctx.alive(mH[i] as number)) spawnLoop(ctx, i);
        },
        reset: () => {
          mId.fill(0);
          mH.fill(0);
        },
      },
    ),
  ];
}
