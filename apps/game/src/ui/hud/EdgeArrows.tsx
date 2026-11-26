// Off-screen pointers for Metins and the boss: an engraved arrow plate on the screen edge (boss = crimson lacquer + skull,
// Metin = obsidian + glowing shard, tinted with the rune colour) with the distance underneath. The spot comes from
// placement.ts: the ray centre -> target, pushed away from every HUD widget that carries `data-block` (taskbar, orb, build
// strip, timer / boss plate, minimap …), so an arrow never lands on the HP number or the kill counter.
import type { JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { fmtInt, t } from '../../i18n/i18n';
import type { HudSnapshot } from '../../sim/types';
import { EdgeArrow } from '../components/StatIcon';
import { deps } from '../env';
import { layout } from '../layout';
import { edgeInsets, placeArrows, type ArrowRequest, type Rect } from './placement';

interface Target {
  key: string;
  kind: 'metin' | 'boss';
  x: number;
  z: number;
  color: string;
  awakened: boolean;
}

function sameRects(a: readonly Rect[], b: readonly Rect[]): boolean {
  return a.length === b.length && a.every((r, i) => r.l === b[i]?.l && r.t === b[i]?.t && r.r === b[i]?.r && r.b === b[i]?.b);
}

/** Viewport rectangles of every HUD widget marked `data-block`. */
function measureBlocked(root: HTMLElement | null): Rect[] {
  const host = root?.closest('.ms-hud');
  if (!host) return [];
  const out: Rect[] = [];
  for (const el of host.querySelectorAll<HTMLElement>('[data-block]')) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    out.push({ l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) });
  }
  return out;
}

export function EdgeArrows({ hud }: { hud: HudSnapshot }): JSX.Element {
  const { project } = deps();
  const { w, h, rem } = layout.value;
  const ref = useRef<HTMLDivElement>(null);
  const [blocked, setBlocked] = useState<Rect[]>([]);
  // the widgets move with the layout tier, the boss plate comes and goes: re-measure after every HUD frame (a few rects)
  useLayoutEffect(() => {
    const next = measureBlocked(ref.current);
    setBlocked((cur) => (sameRects(cur, next) ? cur : next));
  });

  const targets: Target[] = hud.metins.map((m) => ({ key: `m${m.id}`, kind: 'metin', x: m.x, z: m.z, color: m.rune, awakened: m.awakened }));
  if (hud.boss) targets.push({ key: 'boss', kind: 'boss', x: hud.boss.x, z: hud.boss.z, color: '#ff3a2a', awakened: hud.boss.enraged });

  // an arrow is ~2.7 rem wide with its distance plaque (~1.5 rem) hanging underneath: keep 2.8 rem round its centre clear of every
  // widget, so the plaque never lands on the strip's lip or on a gauge
  const radius = 2.8 * rem;
  const opts = { w, h, inset: 2.2 * rem, radius, blocked };
  const ins = edgeInsets(opts);
  const cx = w / 2;
  const cy = h / 2;
  const reqs: ArrowRequest[] = [];
  const meta = new Map<string, { t: Target; dist: number }>();
  for (const tg of targets) {
    const p = project?.(tg.x, tg.z);
    // without an engine projection: world +X = screen right, +Z = screen down; about 17 m x 12 m half-extent round the hero
    const sx = p ? p.x : cx + ((tg.x - hud.px) / 17) * (w / 2);
    const sy = p ? p.y : cy + ((tg.z - hud.pz) / 12) * (h / 2);
    const behind = p?.behind ?? false;
    if (!behind && sx > ins.l && sx < w - ins.r && sy > ins.t && sy < h - ins.b) continue; // visible: no pointer
    let dx = sx - cx;
    let dy = sy - cy;
    if (behind) {
      dx = -dx;
      dy = -dy;
    }
    if (Math.abs(dx) + Math.abs(dy) < 1e-6) dy = -1;
    reqs.push({ key: tg.key, dx, dy, priority: tg.kind === 'boss' ? 5 : tg.awakened ? 2 : 0 });
    meta.set(tg.key, { t: tg, dist: Math.hypot(tg.x - hud.px, tg.z - hud.pz) });
  }
  const placed = placeArrows(reqs, opts);
  return (
    <div ref={ref} class="ms-hud-arrows" aria-hidden="true">
      {placed.map((a) => {
        const m = meta.get(a.key);
        if (!m) return null;
        return (
          <div key={a.key} class={`ms-ea ms-ea--${m.t.kind} ${m.t.awakened ? 'is-awake' : ''}`} style={{ left: `${a.x.toFixed(1)}px`, top: `${a.y.toFixed(1)}px`, '--ea-c': m.t.color } as JSX.CSSProperties}>
            <EdgeArrow kind={m.t.kind} angle={a.angle} size={m.t.kind === 'boss' ? '3.1rem' : '2.7rem'} />
            <span class="ms-ea-d ms-plate ms-num">{t('hud.dist', { n: fmtInt(Math.round(m.dist)) })}</span>
          </div>
        );
      })}
    </div>
  );
}
