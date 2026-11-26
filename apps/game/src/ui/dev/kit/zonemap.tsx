// Kit specimen pages for ZoneMap (C14, UI core lane H). Dev only: loaded lazily by ui/dev/scenarios/kit-map.ts (gallery ids
// kit-map*), rendered into an overlay host above the UI. Every visual under test is the real component; this file only
// lays the specimens out and prints what the loader measured (worker vs main hash, bake / paint / pixel-pass times).
import { render, type JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Panel } from '../../components/Panel';
import { ZoneMap, ensureZoneMapDefs, hudPips, type MapPip, type MapPipKind, type ZoneMapInfo } from '../../components/ZoneMap';
import { deps } from '../../env';
import { mockHud } from '../mock';
import { loadZoneMap, zoneMapStats } from '../../components/zoneMapLoader';
import { TooltipHost } from '../../components/Tooltip';

export type KitMapPage = 'all' | 'minimap' | 'atlas' | 'pips';
export interface KitMapOpts {
  /** freeze the walking hero at this time (s) instead of animating it */
  t?: number;
  /** phone preview: single column */
  compact?: boolean;
}

const ZONES = ['yeonmu', 'suryeon', 'seori', 'daeryeol'] as const;
type ZoneId = (typeof ZONES)[number];

/** where the specimen hero stands per zone (near a landmark) and what is around it */
const SCENE: Record<ZoneId, { hero: [number, number]; pips: MapPip[] }> = {
  yeonmu: {
    hero: [66, 18],
    pips: [
      { kind: 'metin', id: 'a', x: 88, z: 4 },
      { kind: 'metin', id: 'b', x: 52, z: 38, awakened: true },
      { kind: 'metin', id: 'c', x: 40, z: -6 },
      { kind: 'chest', id: 'ch', x: 84, z: 42 },
      { kind: 'ally', id: 'al', x: 60, z: 6 },
      { kind: 'boss', id: 'bo', x: 116, z: 54 },
      { kind: 'boss', id: 'bf', x: -128, z: 50 },
    ],
  },
  suryeon: {
    hero: [34, -58],
    pips: [
      { kind: 'metin', id: 'a', x: 56, z: -40 },
      { kind: 'metin', id: 'b', x: 20, z: -84, awakened: true },
      { kind: 'chest', id: 'ch', x: 12, z: -40 },
      { kind: 'boss', id: 'bo', x: -61, z: -137 },
      { kind: 'ally', id: 'al', x: 42, z: -62 },
    ],
  },
  seori: {
    hero: [22, -48],
    pips: [
      { kind: 'metin', id: 'a', x: 44, z: -62 },
      { kind: 'metin', id: 'b', x: 8, z: -20, awakened: true },
      { kind: 'chest', id: 'ch', x: 36, z: -30 },
      { kind: 'boss', id: 'bo', x: -90, z: 58 },
    ],
  },
  daeryeol: {
    hero: [8, 30],
    pips: [
      { kind: 'metin', id: 'a', x: 30, z: 18 },
      { kind: 'metin', id: 'b', x: -14, z: 52, awakened: true },
      { kind: 'chest', id: 'ch', x: 20, z: 44 },
      { kind: 'boss', id: 'bo', x: 108, z: 62 },
      { kind: 'ally', id: 'al', x: 2, z: 38 },
    ],
  },
};

const CSS = `
.zk-page{position:absolute;inset:0;overflow:auto;color:#e8dcc0;font-family:var(--f-body);padding:calc(1rem + var(--safe-t,0px)) calc(1.4rem + var(--safe-r,0px)) 2rem calc(1.4rem + var(--safe-l,0px));box-sizing:border-box;
  background:radial-gradient(120% 90% at 28% 18%,rgba(96,108,54,.62),transparent 62%),radial-gradient(90% 80% at 86% 86%,rgba(72,66,40,.66),transparent 70%),linear-gradient(160deg,#2e3420,#1c1f14 60%,#15170f)}
.zk-top{display:flex;align-items:baseline;gap:1rem;margin-bottom:.5rem}
.zk-brand{font-family:var(--f-head);font-weight:700;font-size:var(--t-sm);letter-spacing:.18em;color:#f0cd78}
.zk-sub{font-size:var(--t-xs);letter-spacing:.1em;text-transform:uppercase;color:#a89c83}
.zk-h{margin:1rem 0 .2rem;font-family:var(--f-head);font-weight:700;font-size:var(--t-sm);letter-spacing:.12em;text-transform:uppercase;color:#d8cdb6}
.zk-note{margin:0 0 .7rem;font-size:var(--t-xs);color:#a89c83;max-width:60rem}
.zk-row{display:flex;flex-wrap:wrap;align-items:flex-start;gap:1.2rem 1.6rem}
.zk-cell{display:flex;flex-direction:column;align-items:center;gap:.3rem;padding:.6rem 1rem 1.1rem 1rem}
.zk-cell>b{font:600 var(--t-2xs)/1 var(--f-body);letter-spacing:.08em;text-transform:uppercase;color:#bfb293}
.zk-atlas{width:min(30rem,100%)}
.zk-atlas-sm{width:min(19rem,100%)}
.zk-board{width:min(34rem,100%)}
.zk-pips{display:flex;flex-wrap:wrap;gap:.7rem 1rem;padding:.8rem;border-radius:.4rem;background:rgba(12,10,8,.72);box-shadow:inset 0 0 0 1px #4a443b}
.zk-pipc{display:flex;flex-direction:column;align-items:center;gap:.35rem;width:5.4rem;font-size:var(--t-2xs);letter-spacing:.06em;text-transform:uppercase;color:#bfb293}
.zk-pipc .zk-stage{position:relative;width:3.4rem;height:3.4rem;border-radius:.3rem;background:#4b5a35;box-shadow:inset 0 0 0 1px #0b0a09}
.zk-pipc .ms-zm-pip,.zk-pipc .ms-zm-rim{left:50%;top:50%}
.zk-x3 .zk-stage{width:7.2rem;height:7.2rem}.zk-x3 .zk-pipc{width:8rem}.zk-x3 .ms-zm-pip,.zk-x3 .ms-zm-rim{scale:3}
.zk-stats{border-collapse:collapse;font:500 var(--t-2xs)/1.5 var(--f-num);letter-spacing:.03em}
.zk-stats th,.zk-stats td{padding:.1rem .8rem .1rem 0;text-align:left;white-space:nowrap}
.zk-stats th{color:#f0cd78;font-weight:600}
.zk-ok{color:#8fd694}.zk-bad{color:#f08070}
`;

// ------------------------------------------------------------------------------------------------- readiness + stats

const infos: Record<string, ZoneMapInfo> = {};
const listeners = new Set<() => void>();
let expected = 0;
let readyResolve: (() => void) | null = null;
interface VerifyRow {
  zone: string;
  style: string;
  res: number;
  worker: string;
  main: string;
  repeat: string;
  identical: boolean;
  mainPxMs: number;
}

/** Bakes every zone on the main thread (twice) and compares the pixel hashes with the worker's: byte-identical or not. */
async function verify(res = 512): Promise<VerifyRow[]> {
  const { bakeZoneMap } = await import('../../components/zoneMapRender');
  const { indexOf } = await import('../../content');
  const out: VerifyRow[] = [];
  for (const id of ZONES) {
    const biome = indexOf().zones.get(id)?.biome;
    if (!biome) continue;
    const worker = await loadZoneMap(biome, { style: 'atlas', res });
    const opts = { res, style: 'atlas' as const, ...(biome.water ? { water: biome.water.color } : {}) };
    const a = bakeZoneMap(biome, biome.seed, opts);
    const b = bakeZoneMap(biome, biome.seed, opts);
    out.push({ zone: id, style: 'atlas', res, worker: worker.hash, main: a.hash, repeat: b.hash, identical: worker.hash === a.hash && a.hash === b.hash, mainPxMs: Math.round(Math.min(a.timing.px, b.timing.px) * 10) / 10 });
  }
  return out;
}

const w = window as unknown as { __zm?: { ready: Promise<void>; infos: Record<string, ZoneMapInfo>; stats: typeof zoneMapStats; verify: typeof verify } };

function track(label: string): (i: ZoneMapInfo) => void {
  expected++;
  return (i) => {
    const first = !(label in infos);
    infos[label] = i;
    for (const l of listeners) l();
    if (first && Object.keys(infos).length >= expected) readyResolve?.();
  };
}

function useStats(): void {
  const [, set] = useState(0);
  useEffect(() => {
    const l = (): void => set((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
}

const fx = (n: number): string => (n >= 100 ? n.toFixed(0) : n.toFixed(1));

function Stats(): JSX.Element {
  useStats();
  const rows = Object.entries(infos);
  return (
    <table class="zk-stats">
      <thead>
        <tr>
          <th>map</th>
          <th>via</th>
          <th>res</th>
          <th>hash</th>
          <th>bake</th>
          <th>paint</th>
          <th>pre</th>
          <th>pixels</th>
          <th>wall</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, i]) => (
          <tr key={k}>
            <td>{k}</td>
            <td>{i.via}</td>
            <td>{i.res}</td>
            <td>{i.hash}</td>
            <td>{fx(i.timing.bake)} ms</td>
            <td>{fx(i.timing.paint)} ms</td>
            <td>{fx(i.timing.pre)} ms</td>
            <td>{fx(i.timing.px)} ms</td>
            <td>{fx(i.timing.wall)} ms</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ------------------------------------------------------------------------------------------------------------ sections

const noop = (): void => undefined;

function MiniCell({ zone, size, label, view, controls = true, camera = false }: { zone: ZoneId; size?: string; label?: string; view?: number; controls?: boolean; camera?: boolean }): JSX.Element {
  const sc = SCENE[zone];
  const hero = { x: sc.hero[0], z: sc.hero[1] };
  const onReady = track(`${zone} minimap${size ? ` ${size}` : ''}${view !== undefined ? ` v${view}` : ''}`);
  return (
    <div class="zk-cell">
      <ZoneMap zone={zone} variant="minimap" size={size ?? '12rem'} hero={hero} pips={sc.pips} {...(view !== undefined ? { view } : {})} controls={controls} {...(controls ? { onAtlas: noop, onClose: noop } : {})} {...(camera ? { camera: { w: 42, h: 24 } } : {})} onReady={onReady} />
      <b>{label ?? zone}</b>
    </div>
  );
}

function walkPos(t: number): { x: number; z: number } {
  // a loop around the zone centre: the hero passes the mock metins (24, 6) / (-30, -18) and the boss (18, -12)
  const a = t * 0.32;
  return { x: Math.cos(a) * 34, z: Math.sin(a) * 26 };
}

/** The minimap fed exactly like the real HUD feeds it: a HudSnapshot (px / pz / metins / boss) at 10 Hz. */
function HudMini({ zone, t }: { zone: ZoneId; t?: number }): JSX.Element {
  const [now, setNow] = useState(t ?? 0);
  useEffect(() => {
    if (t !== undefined) return undefined;
    const t0 = performance.now();
    const id = window.setInterval(() => setNow((performance.now() - t0) / 1000), 100);
    return () => window.clearInterval(id);
  }, [t]);
  const p = walkPos(now);
  const hud = { ...mockHud(deps().content, now, { boss: true }), px: p.x, pz: p.z };
  const onReady = track(`${zone} minimap hud-driven`);
  return (
    <div class="zk-cell">
      <ZoneMap zone={zone} variant="minimap" size="12rem" hero={{ x: hud.px, z: hud.pz }} pips={hudPips(hud)} camera={{ w: 42, h: 24 }} onAtlas={noop} onClose={noop} onReady={onReady} />
      <b>HudSnapshot-driven (10 Hz)</b>
    </div>
  );
}

function MinimapSections({ opts }: { opts: KitMapOpts }): JSX.Element {
  return (
    <>
      <h3 class="zk-h">Minimap · round HUD variant</h3>
      <p class="zk-note">Braided pewter ring with four bronze cuffs, copper medallions (region map, hide, zoom out / in), coordinate plate. Hero arrow fixed at the centre, map scrolls; metin / boss out of view ride the ring. 110 m view.</p>
      <div class="zk-row">
        {ZONES.map((z) => (
          <MiniCell key={z} zone={z} />
        ))}
      </div>
      <h3 class="zk-h">Minimap · zoom steps (yeonmu)</h3>
      <p class="zk-note">64 m · 110 m · 190 m · whole arena (hero moves inside the disc)</p>
      <div class="zk-row">
        {[64, 110, 190, 0].map((v) => (
          <MiniCell key={v} zone="yeonmu" view={v} label={v ? `${v} m` : 'whole arena'} />
        ))}
      </div>
      <h3 class="zk-h">Minimap · sizes, no controls, camera footprint, HUD-driven</h3>
      <div class="zk-row">
        <MiniCell zone="suryeon" size="7.5rem" controls={false} label="7.5rem bare" />
        <MiniCell zone="seori" size="9.5rem" label="9.5rem" />
        <MiniCell zone="daeryeol" size="15rem" label="15rem" camera />
        <HudMini zone="yeonmu" {...(opts.t !== undefined ? { t: opts.t } : {})} />
        <div class="zk-cell">
          <ZoneMap zone="no_such_zone" variant="minimap" size="9.5rem" hero={{ x: 0, z: 0 }} onAtlas={noop} onClose={noop} />
          <b>failed (unknown zone)</b>
        </div>
      </div>
    </>
  );
}

const ATLAS_PINS: MapPip[] = [
  { kind: 'metin', id: 'm1', x: 70, z: -20, label: 'Metin' },
  { kind: 'metin', id: 'm2', x: -60, z: 70, label: 'Metin', awakened: true },
  { kind: 'chest', id: 'c1', x: 40, z: 60, label: 'Chest' },
];

function AtlasCell({ zone, cls, res, caption, title }: { zone: ZoneId; cls: string; res?: number; caption?: string; title?: string }): JSX.Element {
  const onReady = track(`${zone} atlas ${res ?? 1024}${title ? ' titled' : ''}`);
  return (
    <div class={cls}>
      <ZoneMap zone={zone} variant="atlas" caption={caption} {...(title ? { title, onClose: noop } : {})} {...(res ? { res } : {})} pips={ATLAS_PINS} hero={{ x: SCENE[zone].hero[0], z: SCENE[zone].hero[1] }} onPip={noop} onReady={onReady} />
    </div>
  );
}

function AtlasSections(): JSX.Element {
  return (
    <>
      <h3 class="zk-h">Atlas · bordered zone-select variant</h3>
      <p class="zk-note">Pewter frame with cloud-scroll corner caps (uk_corner), ruler ticks, compass rose, scale bar; start banner, final-battle ring, boss arenas from the field's landmarks; hover a pin for its tip.</p>
      <div class="zk-row">
        <AtlasCell zone="yeonmu" cls="zk-atlas" caption="Yeonmu" />
        <AtlasCell zone="suryeon" cls="zk-atlas" title="Region map" />
      </div>
      <div class="zk-row" style={{ marginTop: '1.4rem' }}>
        <AtlasCell zone="seori" cls="zk-atlas-sm" res={512} caption="Seori · 512" />
        <AtlasCell zone="daeryeol" cls="zk-atlas-sm" res={512} caption="Daeryeol · 512" />
        <div class="zk-board">
          <Panel variant="board" ornate title="Region map" onClose={noop} body>
            <ZoneMap zone="yeonmu" variant="atlas" frame={false} grid={false} onReady={track('yeonmu atlas bare')} />
          </Panel>
        </div>
      </div>
    </>
  );
}

const PIP_KINDS: MapPipKind[] = ['hero', 'ally', 'metin', 'boss', 'chest', 'start', 'heart', 'arena', 'poi'];

function PipSection(): JSX.Element {
  ensureZoneMapDefs();
  return (
    <>
      <h3 class="zk-h">Pips (actual size, then x3)</h3>
      <div class="zk-pips">
        {PIP_KINDS.map((k) => (
          <div class="zk-pipc" key={k}>
            <div class="zk-stage">
              <span class={`ms-zm-pip ms-zm-pip--${k}${k === 'metin' ? ' is-awake' : ''}`}>
                <svg viewBox="0 0 32 32" aria-hidden="true">
                  <use href={`#zm-p-${k}`} />
                </svg>
              </span>
            </div>
            {k}
          </div>
        ))}
        {(['boss', 'metin'] as const).map((k) => (
          <div class="zk-pipc" key={`rim-${k}`}>
            <div class="zk-stage">
              <span class={`ms-zm-rim ms-zm-rim--${k}`} style={{ '--zm-rim': k === 'boss' ? '#b3281c' : '#6a3f8a' }}>
                <svg viewBox="0 0 32 32" aria-hidden="true" style={{ transform: 'rotate(-40deg)' }}>
                  <use href="#zm-p-rim" />
                </svg>
              </span>
            </div>
            rim {k}
          </div>
        ))}
      </div>
      <div class="zk-pips zk-x3" style={{ marginTop: '1rem' }}>
        {PIP_KINDS.map((k) => (
          <div class="zk-pipc" key={k}>
            <div class="zk-stage">
              <span class={`ms-zm-pip ms-zm-pip--${k}${k === 'metin' ? ' is-awake' : ''}`}>
                <svg viewBox="0 0 32 32" aria-hidden="true">
                  <use href={`#zm-p-${k}`} />
                </svg>
              </span>
            </div>
            {k}
          </div>
        ))}
        {(['boss', 'metin'] as const).map((k) => (
          <div class="zk-pipc" key={`rim-${k}`}>
            <div class="zk-stage">
              <span class={`ms-zm-rim ms-zm-rim--${k}`} style={{ '--zm-rim': k === 'boss' ? '#b3281c' : '#6a3f8a' }}>
                <svg viewBox="0 0 32 32" aria-hidden="true" style={{ transform: 'rotate(-40deg)' }}>
                  <use href="#zm-p-rim" />
                </svg>
              </span>
            </div>
            rim {k}
          </div>
        ))}
      </div>
    </>
  );
}

function Page({ page, opts }: { page: KitMapPage; opts: KitMapOpts }): JSX.Element {
  return (
    <div class={`zk-page ms-kitspec-zm ${opts.compact ? 'is-compact' : ''}`}>
      <style>{CSS}</style>
      <header class="zk-top">
        <span class="zk-brand">KIT v1 · ZoneMap</span>
        <span class="zk-sub">{page}</span>
      </header>
      {(page === 'all' || page === 'minimap') && <MinimapSections opts={opts} />}
      {(page === 'all' || page === 'atlas') && <AtlasSections />}
      {(page === 'all' || page === 'pips') && <PipSection />}
      {page !== 'pips' && (
        <>
          <h3 class="zk-h">Measured</h3>
          <Stats />
        </>
      )}
      <TooltipHost />
    </div>
  );
}

export function mountZoneMapSpecimen(host: HTMLElement, page: KitMapPage, opts: KitMapOpts = {}): void {
  for (const k of Object.keys(infos)) delete infos[k];
  expected = 0;
  w.__zm = { ready: new Promise<void>((r) => (readyResolve = r)), infos, stats: zoneMapStats, verify };
  render(<Page page={page} opts={opts} />, host);
  // pips-only pages have no maps to wait for
  if (page === 'pips') readyResolve?.();
}

export function unmountZoneMapSpecimen(host: HTMLElement): void {
  render(null, host);
  host.remove();
}
