// Zone select atlas (B4 zone-select, round 3): the board with ONE continuous landmass in it. The four zones are the regions of that
// landmass: one painted relief (uk_zone_select_relief) under the whole coast, every zone's live ZoneMap only as terrain detail on top of it,
// muted zone tints that fade across the borders, hand-inked frontiers, a fogged locked region (zoneContinentPaint.ts). Each region carries
// ONE fixed anchor: the cloth banner pin (its own emblem) and the charcoal name plate form one unit that placeRegion() slides to the spot
// nearest the heart of the region where the whole unit lies inside the polygon with a gutter, so a plate / banner / skull can never overlap
// a neighbour, spill over a border or hide the map (the plate narrows and the banner shrinks in fixed steps on small boards). Small raster
// markers sit on the boss arenas and the final battle; a gold road joins the plates of consecutive zones through a gate on their border
// (open padlock seal, or an iron chain + closed padlock while the way is shut).
// Every region is one radio button (a clipped hit area), so keyboard, pad and touch select exactly what they see.
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { t, tl } from '../../i18n/i18n';
import { texUrl, zoneArtUrl } from '../assets';
import { sfx } from '../audio';
import { Panel } from '../components/Panel';
import { UiGlyph } from '../components/StatIcon';
import { StatWell } from '../components/StatWell';
import { TipBody, tipProps } from '../components/Tooltip';
import { defaultMapRequest } from '../components/ZoneMap';
import { roseMarkup } from '../components/zoneMapArt';
import { loadZoneMap, peekZoneMap, type ZoneMapAsset } from '../components/zoneMapLoader';
import type { ZoneStatus } from '../../meta';
import { Banner, type BannerState, bannerVariantOf, BANNER_ASPECT, bendCurve, ChainRun, dangerOf, DangerSkulls, hashStr, LinkSeal, PinMark, type PinKind, roman } from './zoneArt';
import { layoutContinent, mapPoint, placeRegion, pointInPoly, polyPoints, rectEdgeToward, rectsHit, refineGates, type Continent, type ContGate, type Placed } from './zoneContinent';
import { loadRelief, paintContinent, tintOfZone } from './zoneContinentPaint';

const cv = (v: Record<string, string | number>): JSX.CSSProperties => v as unknown as JSX.CSSProperties;

/** Painted image that drops out silently when the file is missing. */
export function Painted({ url, class: cls }: { url: string | null; class: string }): JSX.Element | null {
  const [bad, setBad] = useState<string | null>(null);
  if (!url || bad === url) return null;
  return <img class={cls} src={url} alt="" draggable={false} decoding="async" onError={() => setBad(url)} />;
}

/** Keyboard "Enter" (a click without pointer, detail 0) on an already-chosen region continues; anything else chooses it. */
const chooseOrContinue = (chosen: boolean, choose: () => void, proceed: () => void) => (e: MouseEvent): void => {
  if (chosen && e.detail === 0) proceed();
  else if (!chosen) choose();
};

// ---------------------------------------------------------------------------------------------------------------------
// measuring the world box and the CSS-sized parts (plate, banner, gutter, pin) in px

interface Metrics {
  w: number;
  h: number;
  plateW: number;
  plateH: number;
  bannerH: number;
  gutter: number;
  pin: number;
  plateMin: number;
}

function useMetrics(worldRef: { current: HTMLDivElement | null }, key: string): Metrics | null {
  const [m, setM] = useState<Metrics | null>(null);
  useLayoutEffect(() => {
    const el = worldRef.current;
    if (!el) return undefined;
    const probe = el.querySelector<HTMLElement>('.ms-zs-probe');
    const measure = (): void => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w < 40 || h < 40 || !probe) return;
      const cs = getComputedStyle(probe);
      const next: Metrics = {
        w,
        h,
        plateW: parseFloat(cs.width) || 200,
        plateH: parseFloat(cs.height) || 60,
        bannerH: parseFloat(cs.paddingTop) || 100,
        gutter: parseFloat(cs.paddingLeft) || 8,
        pin: parseFloat(cs.paddingRight) || 18,
        plateMin: parseFloat(cs.paddingBottom) || 96,
      };
      setM((prev) => (prev && (Object.keys(next) as (keyof Metrics)[]).every((k) => prev[k] === next[k]) ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [key]);
  return m;
}

/** the raster of every zone's atlas map (shared cache with <ZoneMap>); null while a bake is pending */
function useAssets(statuses: readonly ZoneStatus[]): (ZoneMapAsset | null)[] {
  const req = useMemo(() => defaultMapRequest('atlas', { res: 512 }), []);
  const key = statuses.map((s) => s.zone.id).join(',');
  const [assets, setAssets] = useState<(ZoneMapAsset | null)[]>(() => statuses.map((s) => peekZoneMap(s.zone.biome, req)));
  useEffect(() => {
    let alive = true;
    // a different zone list (or the first run): start from whatever the cache already holds, one slot per zone
    setAssets((prev) => (prev.length === statuses.length ? prev : statuses.map((s) => peekZoneMap(s.zone.biome, req))));
    statuses.forEach((s, i) => {
      const hit = peekZoneMap(s.zone.biome, req);
      if (hit) {
        setAssets((prev) => (prev[i] === hit ? prev : statuses.map((_, k) => (k === i ? hit : (prev[k] ?? null)))));
        return;
      }
      loadZoneMap(s.zone.biome, req).then(
        (a) => {
          if (alive) setAssets((prev) => statuses.map((_, k) => (k === i ? a : (prev[k] ?? null))));
        },
        (err) => console.warn('[zone-atlas]', err),
      );
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, req]);
  return assets;
}

// ---------------------------------------------------------------------------------------------------------------------

interface PinAt {
  kind: PinKind;
  x: number;
  y: number;
  size: number;
}

/** markers of one region: final battle ring, boss arenas, camp; only those that sit inside the polygon and clear of the plate and banner */
function pinsOf(cont: Continent, i: number, asset: ZoneMapAsset | null, pl: Placed, pin: number): PinAt[] {
  const reg = cont.regions[i];
  if (!reg || !asset) return [];
  const small = Math.min(reg.bbox.w, reg.bbox.h) < 150;
  const out: PinAt[] = [];
  const pad = pin * 0.6;
  const plate = { x: pl.plate.x - pad, y: pl.plate.y - pad, w: pl.plate.w + 2 * pad, h: pl.plate.h + 2 * pad };
  for (const l of asset.landmarks) {
    const kind: PinKind | null = l.kind === 'centre' ? 'final' : l.kind === 'boss' ? 'boss' : null;
    if (!kind || (small && kind !== 'final')) continue;
    const p = mapPoint(reg.map, (l.x - asset.x0) / asset.span, (l.z - asset.z0) / asset.span);
    const size = kind === 'final' ? pin * 1.4 : pin;
    const box = { x: p.x - size / 2, y: p.y - size / 2, w: size, h: size };
    if (!pointInPoly(p, reg.poly) || !pointInPoly({ x: p.x - size * 0.55, y: p.y }, reg.poly) || !pointInPoly({ x: p.x + size * 0.55, y: p.y }, reg.poly) || !pointInPoly({ x: p.x, y: p.y - size * 0.55 }, reg.poly) || !pointInPoly({ x: p.x, y: p.y + size * 0.55 }, reg.poly)) continue;
    if (rectsHit(box, plate) || rectsHit(box, { x: pl.banner.x - pad, y: pl.banner.y - pad, w: pl.banner.w + 2 * pad, h: pl.banner.h + 2 * pad })) continue;
    if (out.some((o) => Math.hypot(o.x - p.x, o.y - p.y) < (o.size + size) * 0.62)) continue;
    out.push({ kind, x: p.x, y: p.y, size });
  }
  return out.sort((a, b) => (a.kind === 'final' ? 1 : 0) - (b.kind === 'final' ? 1 : 0));
}

function Roads({ gates, placed, statuses, link, sealR }: { gates: readonly ContGate[]; placed: Placed[]; statuses: readonly ZoneStatus[]; link: number; sealR: number }): { under: JSX.Element; over: JSX.Element } {
  const under: JSX.Element[] = [];
  const over: JSX.Element[] = [];
  gates.forEach((g, i) => {
    const pa = placed[g.a];
    const pb = placed[g.b];
    const next = statuses[g.b];
    if (!pa || !pb || !next) return;
    // the road starts at the edge of the name plate that faces the gate (the plate is the pin's base)
    const a = rectEdgeToward(pa.plate, g.at, 1.5);
    const b = rectEdgeToward(pb.plate, g.at, 1.5);
    const open = next.unlocked;
    const bend = 0.09;
    const h1 = bendCurve(a, g.at, bend);
    const h2 = bendCurve(g.at, b, bend);
    const d = `M${a.x.toFixed(1)} ${a.y.toFixed(1)}Q${h1.c.x.toFixed(1)} ${h1.c.y.toFixed(1)} ${g.at.x.toFixed(1)} ${g.at.y.toFixed(1)}Q${h2.c.x.toFixed(1)} ${h2.c.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    under.push(
      <g key={`l${i}`} class={`ms-zs-link ${open ? 'is-open' : 'is-locked'}`}>
        <path d={d} fill="none" stroke="#050403" stroke-opacity="0.6" stroke-width={link * 0.9 + 3} stroke-linecap="round" stroke-linejoin="round" />
        {open ? (
          <>
            <path d={d} fill="none" stroke="#7a5a2c" stroke-width={link * 0.5} stroke-linecap="round" stroke-linejoin="round" />
            <path d={d} fill="none" stroke="#f0cd78" stroke-width={link * 0.2} stroke-linecap="round" stroke-linejoin="round" stroke-dasharray={`${(link * 0.7).toFixed(1)} ${(link * 0.9).toFixed(1)}`} class="ms-zs-road" />
          </>
        ) : (
          <>
            <ChainRun a={a} b={g.at} bend={bend} link={link} from={0.08} to={0.84} />
            <ChainRun a={g.at} b={b} bend={bend} link={link} from={0.16} to={0.92} />
          </>
        )}
      </g>,
    );
    over.push(<LinkSeal key={`s${i}`} x={g.at.x} y={g.at.y} r={sealR} locked={!open} uid={`${i}`} />);
  });
  return { under: <g>{under}</g>, over: <g>{over}</g> };
}

export function ZoneAtlas({ statuses, current, onPick, onProceed }: { statuses: readonly ZoneStatus[]; current: string; onPick: (st: ZoneStatus) => void; onProceed: () => void }): JSX.Element {
  const worldRef = useRef<HTMLDivElement | null>(null);
  const cvRef = useRef<HTMLCanvasElement | null>(null);
  const key = statuses.map((s) => s.zone.id).join(',');
  const m = useMetrics(worldRef, key);
  const assets = useAssets(statuses);
  const n = statuses.length;
  const cleared = statuses.filter((s) => s.cleared.normal).length;

  const cont = useMemo<Continent | null>(() => (m ? layoutContinent({ w: m.w, h: m.h, n, seed: hashStr(key) & 0xffff, compact: Math.min(m.w, m.h) < 420 }) : null), [m?.w, m?.h, n, key]);
  const placed = useMemo<Placed[]>(() => {
    if (!cont || !m) return [];
    return cont.regions.map((reg) => placeRegion(reg, { plateW: m.plateW, plateH: m.plateH, bannerW: m.bannerH * BANNER_ASPECT, bannerH: m.bannerH, gutter: m.gutter, plateMin: m.plateMin }));
  }, [cont, m?.plateW, m?.plateH, m?.bannerH, m?.gutter, m?.plateMin]);

  const lockKey = statuses.map((s) => (s.unlocked ? '1' : '0')).join('');
  const [relief, setRelief] = useState<HTMLImageElement | null>(null);
  const reliefUrl = texUrl('uk_zone_select_relief');
  useEffect(() => {
    let alive = true;
    loadRelief(reliefUrl).then((im) => {
      if (alive) setRelief(im);
    });
    return () => {
      alive = false;
    };
  }, [reliefUrl]);
  useLayoutEffect(() => {
    const c = cvRef.current;
    if (!c || !cont) return;
    paintContinent(
      c,
      cont,
      statuses.map((s, i) => ({ asset: assets[i] ?? null, locked: !s.unlocked, ...tintOfZone(s.zone.id, s.zone.order) })),
      Math.min(2.5, window.devicePixelRatio || 1),
      relief,
    );
  }, [cont, assets, lockKey, relief]);

  const link = m ? Math.max(7, Math.min(15, Math.min(m.w, m.h) / 55)) : 10;
  const sealR = Math.max(11, Math.min(19, link * 1.4));
  const gates = useMemo<ContGate[]>(() => {
    if (!cont || placed.length !== n) return [];
    return refineGates(cont.gates, placed.map((p) => [p.plate, p.banner]), sealR + (m?.gutter ?? 6));
  }, [cont, placed, sealR, m?.gutter]);
  const roads = cont && placed.length === n ? Roads({ gates, placed, statuses, link, sealR }) : null;
  const pending = assets.some((a) => !a);

  return (
    <Panel variant="board" ornate title={t('zone.atlas')} class="ms-zs-atlas">
      <div class="ms-zs-atlas-in">
        <div class={`ms-zs-world ${pending ? 'is-loading' : ''}`} ref={worldRef} role="radiogroup" aria-label={t('zone.title')}>
          <i class="ms-zs-probe" aria-hidden="true" />
          <canvas class="ms-zs-land" ref={cvRef} aria-hidden="true" />
          {cont && roads && (
            <svg class="ms-zs-links ms-zs-links--under" width={cont.w} height={cont.h} viewBox={`0 0 ${cont.w} ${cont.h}`} aria-hidden="true" focusable="false">
              {roads.under}
            </svg>
          )}
          {cont &&
            placed.length === n &&
            statuses.map((st, i) => {
              const reg = cont.regions[i];
              const pl = placed[i];
              if (!reg || !pl) return null;
              return <RegionView key={st.zone.id} st={st} index={i} reg={reg} pl={pl} pins={pinsOf(cont, i, assets[i] ?? null, pl, m?.pin ?? 18)} plateMin={m?.plateMin ?? 0} selected={st.zone.id === current} onPick={() => onPick(st)} onProceed={onProceed} />;
            })}
          {cont && roads && (
            <svg class="ms-zs-links ms-zs-links--over" width={cont.w} height={cont.h} viewBox={`0 0 ${cont.w} ${cont.h}`} aria-hidden="true" focusable="false">
              {roads.over}
            </svg>
          )}
          <svg class="ms-zs-rose" viewBox="0 0 100 100" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: roseMarkup() }} />
        </div>
        <div class="ms-zs-atlas-foot">
          <span class="ms-zs-prog" {...tipProps(() => <div>{t('zone.atlasTip')}</div>)}>
            <span class="ms-zs-prog-label">{t('zone.atlasProgress')}</span>
            <span class="ms-zs-prog-pips" aria-hidden="true">
              {statuses.map((s) => (
                <i key={s.zone.id} class={`ms-zs-pip ms-plate ${s.cleared.hard ? 'is-hard' : s.cleared.normal ? 'is-done' : s.unlocked ? 'is-open' : ''}`} />
              ))}
            </span>
            <StatWell value={`${cleared} / ${n}`} size="sm" tone={cleared === n ? 'gold' : 'neutral'} />
          </span>
        </div>
      </div>
    </Panel>
  );
}

function RegionView({ st, index, reg, pl, pins, plateMin, selected, onPick, onProceed }: { st: ZoneStatus; index: number; reg: Continent['regions'][number]; pl: Placed; pins: PinAt[]; plateMin: number; selected: boolean; onPick: () => void; onProceed: () => void }): JSX.Element {
  const z = st.zone;
  // a plate squeezed below its minimum width (the unit only fitted the region that way) cannot hold a long single word ("Suryeon") at the
  // normal size: it takes the compact face (css .is-long) instead of breaking the word
  const longWord = tl(z.name).split(/\s+/).reduce((n, w) => Math.max(n, w.length), 0) >= 9 && pl.plate.w < plateMin * 0.95;
  const locked = !st.unlocked;
  const art = zoneArtUrl(z);
  const state: BannerState = locked ? 'locked' : st.cleared.hard ? 'hard' : st.cleared.normal ? 'cleared' : 'open';
  const { bbox } = reg;
  const ox = bbox.x;
  const oy = bbox.y;
  const tip = tipProps(() => (
    <TipBody
      title={tl(z.name)}
      sub={locked ? t('zone.lockedTitle') : st.cleared.hard ? t('zone.clearedHard') : st.cleared.normal ? t('zone.cleared') : t('zone.chapter', { n: roman(z.order) })}
      body={tl(z.subtitle)}
      rows={[
        { label: t('zone.levelsTip'), value: t('zone.levels', { a: z.levelRange[0], b: z.levelRange[1] }) },
        { label: t('zone.danger'), value: `${dangerOf(z)} / 4` },
      ]}
    />
  ));
  const pts = polyPoints(reg.poly, ox, oy);
  const clip = `polygon(${reg.poly.map((p) => `${(p.x - ox).toFixed(1)}px ${(p.y - oy).toFixed(1)}px`).join(',')})`;
  return (
    <div
      class={`ms-zs-region ${selected ? 'is-sel' : ''} ${locked ? 'is-locked' : ''} ${st.cleared.normal ? 'is-cleared' : ''}`}
      style={cv({ left: `${ox}px`, top: `${oy}px`, width: `${bbox.w}px`, height: `${bbox.h}px`, '--i': index })}
    >
      <svg class="ms-zs-reg-svg" width={bbox.w} height={bbox.h} viewBox={`0 0 ${bbox.w} ${bbox.h}`} aria-hidden="true" focusable="false">
        <polygon class="ms-zs-reg-dim" points={pts} />
        <polygon class="ms-zs-reg-glow" points={pts} />
        <polygon class="ms-zs-reg-edge" points={pts} />
      </svg>
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        aria-label={`${tl(z.name)}, ${t('zone.chapter', { n: roman(z.order) })}${locked ? `, ${t('common.locked')}` : ''}`}
        class="ms-zs-hit"
        style={{ clipPath: clip }}
        data-nav=""
        data-arrows="x"
        data-zone={z.id}
        data-autofocus={selected ? '' : undefined}
        {...tip}
        onClick={chooseOrContinue(selected, onPick, onProceed)}
        onPointerEnter={(e) => {
          tip.onPointerEnter(e);
          if (e.pointerType === 'mouse' && !selected) sfx('hover');
        }}
      />
      {pins.map((p, k) => (
        <span key={`${p.kind}${k}`} class="ms-zs-pinwrap" style={cv({ left: `${p.x - ox}px`, top: `${p.y - oy}px`, width: `${p.size}px`, height: `${p.size}px` })}>
          <PinMark kind={p.kind} />
        </span>
      ))}
      <span class="ms-zs-bannerwrap" style={cv({ left: `${pl.banner.x - ox}px`, top: `${pl.banner.y - oy}px`, width: `${pl.banner.w}px`, height: `${pl.banner.h}px` })}>
        <Banner id={z.id} variant={bannerVariantOf(z.id, z.order)} numeral={roman(z.order)} state={state} class="ms-zs-isle-banner" />
      </span>
      <span
        class={`ms-zs-plate ms-plate ${pl.plate.w < 190 ? 'is-tight' : ''} ${longWord ? 'is-long' : ''}`}
        style={cv({ left: `${pl.plate.x - ox}px`, top: `${pl.plate.y - oy}px`, width: `${pl.plate.w}px`, height: `${pl.plate.h}px` })}
        aria-hidden="true"
        {...tip}
        onClick={() => {
          if (!selected) onPick();
        }}
      >
        {art && (
          <span class="ms-zs-plate-art">
            <Painted url={art} class="ms-zs-plate-img" />
          </span>
        )}
        <span class="ms-zs-plate-text">
          <b class="ms-zs-plate-name">{tl(z.name)}</b>
          <span class="ms-zs-plate-meta">
            <span class="ms-zs-lv ms-num">{t('zone.levels', { a: z.levelRange[0], b: z.levelRange[1] })}</span>
            {locked ? (
              <span class="ms-zs-plate-lock">
                <UiGlyph name="lock" tone="pewter" flat />
                {t('common.locked')}
              </span>
            ) : (
              <DangerSkulls n={dangerOf(z)} short />
            )}
          </span>
        </span>
        {!locked && (st.cleared.normal || st.cleared.hard) && (
          <span class="ms-zs-plate-state">
            {st.cleared.normal && <UiGlyph name="star" tone="gold" flat />}
            {st.cleared.hard && <UiGlyph name="skull" tone="crimson" flat />}
          </span>
        )}
      </span>
    </div>
  );
}

