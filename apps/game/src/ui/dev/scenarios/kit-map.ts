// Kit specimen scenarios for ZoneMap (C14, UI core lane H): the round HUD minimap, the bordered atlas, the pips.

// Shoot at 1920x1080 en, 1366x768, 390x844 dpr3 (--touch --mobile), 844x390 dpr2. The page is loaded lazily
// (../kit/zonemap.tsx) into an overlay host above the UI; the next scenario's reset removes it.
import type { GalleryCtx } from '../../gallery';
import { applyTextureVars } from '../../assets';
import type { Scenario } from '../scenarioKit';
import type { KitMapOpts, KitMapPage } from '../kit/zonemap';

export const order = 7;

let host: HTMLElement | null = null;
let token = 0;
const hooked = new WeakSet<GalleryCtx>();

function hide(): void {
  token++;
  const h = host;
  host = null;
  if (h) void import('../kit/zonemap').then((m) => m.unmountZoneMapSpecimen(h));
}

function show(g: GalleryCtx, page: KitMapPage, opts: KitMapOpts = {}): void {
  if (!hooked.has(g)) {
    hooked.add(g);
    const stop = g.stopHud;
    g.stopHud = () => {
      hide();
      stop();
    };
  }
  g.store.setScreen('menu');
  hide();
  const my = ++token;
  void import('../kit/zonemap').then((m) => {
    if (my !== token) return;
    const ui = document.querySelector<HTMLElement>('#ui .ms-ui');
    host = document.createElement('div');
    // mirror the layout classes (ms-touch / ms-portrait / ms-compact) so the specimen sees the same tier
    host.className = `${ui?.className ?? 'ms-ui'} ms-kit-host`;
    host.style.cssText = 'position:fixed;inset:0;z-index:60;pointer-events:auto';
    applyTextureVars(host); // the --tex-* materials (uk_stone, uk_board, uk_rust …) live on the real root; this host is its sibling
    (document.getElementById('ui') ?? document.body).appendChild(host);
    m.mountZoneMapSpecimen(host, page, opts);
  });
}

const s = (id: string, label: string, page: KitMapPage, opts: KitMapOpts = {}): Scenario => ({ id, label, run: (g) => show(g, page, opts) });

export const scenarios: Scenario[] = [
  s('kit-map', 'Kit · ZoneMap (minimap + atlas + pips)', 'all', { t: 2.4 }),
  s('kit-map-mini', 'Kit · ZoneMap minimap', 'minimap', { t: 2.4 }),
  s('kit-map-live', 'Kit · ZoneMap minimap live (HUD-driven 10 Hz)', 'minimap'),
  s('kit-map-atlas', 'Kit · ZoneMap atlas', 'atlas'),
  s('kit-map-pips', 'Kit · ZoneMap pips', 'pips'),
];
