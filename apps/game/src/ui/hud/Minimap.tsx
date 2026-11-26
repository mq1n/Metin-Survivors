// Round minimap (top right) on the shared ZoneMap component: the zone's own terrain painted at runtime, a fixed hero arrow,
// live Metin / boss pips (out-of-view ones ride the ring), zoom / hide / region-map medallions and the coordinate plate.
// The "region map" medallion (or a tap on the disc) opens the whole zone in a board over the game; the "hide" medallion
// folds the map away to a small button. Both choices survive a reload (hide) or the run (atlas).
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { t, tl } from '../../i18n/i18n';
import type { HudSnapshot } from '../../sim/types';
import { Panel } from '../components/Panel';
import { UiGlyph } from '../components/StatIcon';
import { tipProps } from '../components/Tooltip';
import { defaultMapRequest, hudPips, ZoneMap } from '../components/ZoneMap';
import { loadZoneMap, peekZoneMap } from '../components/zoneMapLoader';
import { indexOf } from '../content';
import { deps } from '../env';
import { layout } from '../layout';
import { atlasOpen, minimapHidden, setMinimapHidden } from './hooks';
import { paintedMapUrl, peekPaintedMap } from './minimapPaintLoader';

/** zoom steps of the - / + medallions in metres across the disc (0 = the whole arena); the second one is the default: 84 m is
 *  about twice the width of the play field, so the disc shows what the screen shows (the plaza under the hero) and the first ring
 *  of what is coming */
const VIEWS = [52, 84, 150, 240, 0] as const;

const MINUS = '−';
const fmtCoord = (n: number): string => {
  const r = Math.round(n);
  return r < 0 ? `${MINUS}${-r}` : `${r}`;
};


function gridOrigin(zoneId: string): { x: number; z: number } {
  const zone = indexOf().zones.get(zoneId);
  const a = zone ? peekZoneMap(zone.biome, defaultMapRequest('minimap')) : null;
  return a ? { x: a.x0, z: a.z0 } : { x: -218, z: -218 };
}

/** The painterly picture of the zone's map (minimapPaint.ts): built once per zone off the main thread from the ZoneMap raster;
 *  null until it is ready (the plain ZoneMap picture shows meanwhile). */
function usePaintedMap(zoneId: string): string | null {
  const zone = indexOf().zones.get(zoneId);
  const req = defaultMapRequest('minimap');
  const [url, setUrl] = useState<string | null>(() => {
    const a = zone ? peekZoneMap(zone.biome, req) : null;
    return a ? peekPaintedMap(a) : null;
  });
  useEffect(() => {
    const cached = zone ? peekZoneMap(zone.biome, req) : null;
    setUrl(cached ? peekPaintedMap(cached) : null);
    if (!zone) return undefined;
    let alive = true;
    loadZoneMap(zone.biome, req)
      .then((a) => paintedMapUrl(a))
      .then((u) => {
        if (alive) setUrl(u);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneId]);
  return url;
}

function zoneName(id: string): string {
  const z = indexOf().zones.get(id);
  return z ? tl(z.name) : id;
}

export function Minimap({ hud }: { hud: HudSnapshot }): JSX.Element {
  const { store } = deps();
  const zone = store.runSelection.value.zone;
  const paint = usePaintedMap(zone);
  const org = gridOrigin(zone);
  if (minimapHidden.value) {
    return (
      <button type="button" class="ms-mm-show ms-plate" data-nav="" data-block="" aria-label={t('hud.map.show')} {...tipProps(() => <div class="ms-tip-title">{t('hud.map.show')}</div>)} onClick={() => setMinimapHidden(false)}>
        <UiGlyph name="book" tone="gold" />
        <span class="ms-hit" aria-hidden="true" />
      </button>
    );
  }
  return (
    <div class={`ms-mm ${paint ? 'has-paint' : ''}`} style={paint ? ({ '--mm-paint': `url("${paint}")` } as JSX.CSSProperties) : undefined} data-block="">
      <ZoneMap
        zone={zone}
        variant="minimap"
        size="var(--mm-size)"
        hero={{ x: hud.px, z: hud.pz }}
        pips={hudPips(hud)}
        views={VIEWS}
        coords={false}
        controls={!(layout.value.compact && !layout.value.portrait)}
        onAtlas={() => (atlasOpen.value = !atlasOpen.value)}
        onClose={() => setMinimapHidden(true)}
      />
      <div
        class="ms-mm-coords ms-num"
        {...tipProps(() => (
          <div class="ms-tip-title">{t('hud.map.coords', { zone: zoneName(zone), x: fmtCoord(hud.px - org.x), z: fmtCoord(hud.pz - org.z) })}</div>
        ))}
      >
        ({fmtCoord(hud.px - org.x)}, {fmtCoord(hud.pz - org.z)})
      </div>
    </div>
  );
}

/** The zone atlas in a board over the game (the run keeps going behind it). */
export function Atlas({ hud }: { hud: HudSnapshot }): JSX.Element | null {
  const { store } = deps();
  if (!atlasOpen.value) return null;
  const zone = store.runSelection.value.zone;
  const close = (): void => {
    atlasOpen.value = false;
  };
  return (
    <div class="ms-atlas" role="dialog" aria-label={t('zonemap.mapOf', { zone: zoneName(zone) })}>
      <i class="ms-atlas-scrim" aria-hidden="true" onClick={close} />
      <Panel variant="board" ornate title={t('zonemap.mapOf', { zone: zoneName(zone) })} onClose={close} class="ms-atlas-board">
        <div class="ms-atlas-body">
          <ZoneMap zone={zone} variant="atlas" frame={false} hero={{ x: hud.px, z: hud.pz }} pips={hudPips(hud)} />
        </div>
      </Panel>
    </div>
  );
}
