// Telegraph route (owner: the telegraphs builder).
//  1. LIVE: the decals are drawn by render/fx/telegraphs.ts from the sim store. When one starts (boss / metin / big enemy warning) the
//     Telegraphs system calls `telegraphHook.onBegin` (render/fx/fallCue.ts); this route queues it and fires the matching sprite-layer
//     preset (`telegraph.circle|cone|lane|ring|meteor`, presets.ts) from `update`, where it has the RouteCtx.
//  2. `metinWarn`: remembers the def's rune colour for the metin's decal (render/fx/telegraphArt.ts `setMetinWarnTint`; the decal
//     reads it through the store's `aux` = metin id), so a metin warning glows in the stone's own colour.
//  3. DORMANT: with EventAdapter.telegraphEvents on, the sim `telegraph` event itself fires the preset (the old harness path, kept
//     for the routes test); the live hook path is then off so a warning is never drawn twice.
import { route, type EventRoute, type RouteCtx } from '../route';
import { telegraphHook, type TelegraphBegin } from '../../../render/fx/fallCue';
import { setMetinWarnTint, warnHex } from '../../../render/fx/telegraphArt';

const QUEUE = 24;
/** default warning time (s) when the render feed does not know it (coop mirror rows without `dur`): enemy / boss / metin */
const DEFAULT_DUR: readonly number[] = [1.0, 1.4, 2.6];

function blank(): TelegraphBegin {
  return { owner: 0, shape: 0, x: 0, z: 0, rot: 0, radius: 0, length: 0, width: 0, element: 0, aux: 0, dur: 0, progress: 0, meteor: false, impact: false };
}

/** the preset + spawn options for one started decal */
function fireBegin(b: TelegraphBegin, ctx: RouteCtx): void {
  const dur = b.dur > 0.05 ? b.dur * (1 - b.progress) : (DEFAULT_DUR[b.owner] ?? 1.2) * (1 - b.progress);
  if (dur < 0.25) return;
  let id = 'telegraph.circle';
  let scale = b.radius;
  let a = 0;
  if (b.shape === 1) {
    id = 'telegraph.cone';
    a = b.width;
  } else if (b.shape === 2) {
    id = 'telegraph.lane';
    scale = b.length;
    a = b.width;
  } else if (b.shape === 3) {
    id = 'telegraph.ring';
    a = b.length;
  } else if (b.meteor) id = 'telegraph.meteor';
  const o = ctx.o(b.x, b.z, scale, Math.sin(b.rot), Math.cos(b.rot));
  o.duration = dur;
  o.a = a;
  o.b = b.impact ? 1 : 0;
  o.element = undefined;
  o.color = warnHex(b.owner, b.element, b.aux);
  o.seed = (b.x * 7.31 + b.z * 3.17) % 97;
  ctx.fire(id, o);
}

export function telegraphRoutes(): readonly EventRoute[] {
  const q: TelegraphBegin[] = [];
  for (let i = 0; i < QUEUE; i++) q.push(blank());
  let head = 0;
  let count = 0;
  const push = (b: TelegraphBegin): void => {
    if (count >= QUEUE) return;
    const s = q[(head + count) % QUEUE] as TelegraphBegin;
    Object.assign(s, b);
    count++;
  };
  telegraphHook.onBegin = push;
  return [
    route(
      ['telegraph'],
      (e, ctx) => {
        if (!ctx.telegraphEvents || e.source === 2) return;
        const o = ctx.o(e.x, e.z, e.a, Math.sin(e.rot), Math.cos(e.rot));
        o.duration = e.dur;
        o.element = undefined;
        o.color = e.source === 1 ? 0xff3a2a : 0xff6a2a;
        let id = 'telegraph.circle';
        if (e.shape === 1) {
          id = 'telegraph.cone';
          o.a = e.b;
        } else if (e.shape === 2) {
          id = 'telegraph.lane';
          o.a = e.b;
        } else if (e.shape === 3) {
          id = 'telegraph.ring';
          o.a = e.c;
        }
        ctx.fire(id, o);
      },
      {
        update: (_dt, ctx) => {
          // drain the decals that started since the last frame (the dormant event path owns the flag)
          while (count > 0) {
            const b = q[head] as TelegraphBegin;
            head = (head + 1) % QUEUE;
            count--;
            if (!ctx.telegraphEvents) fireBegin(b, ctx);
          }
        },
        reset: () => {
          head = 0;
          count = 0;
        },
      },
    ),
    route(['metinWarn'], (e, ctx) => {
      setMetinWarnTint(e.metin, ctx.metinRune(e.def, e.great));
    }),
  ];
}
