// Kit specimen scenarios for UiFx (C9) and the engraved icon kit (C11) — core lane D (dev only).
// The specimen pages are loaded lazily (../kit/specimen.tsx) and rendered into an overlay host above the UI, so this
// eagerly collected module stays tiny. The overlay is removed by the gallery's reset of the next scenario.
import type { GalleryCtx } from '../../gallery';
import type { Scenario } from '../scenarioKit';
import type { KitOpts, KitPage } from '../kit/specimen';

export const order = 6;

let host: HTMLElement | null = null;
let token = 0;
const hooked = new WeakSet<GalleryCtx>();

function hide(): void {
  token++;
  const h = host;
  host = null;
  if (h) void import('../kit/specimen').then((m) => m.unmountSpecimen(h));
}

function show(g: GalleryCtx, page: KitPage, opts: KitOpts = {}): void {
  if (!hooked.has(g)) {
    // every scenario switch starts with reset(g) → g.stopHud(): take the overlay down there
    hooked.add(g);
    const stop = g.stopHud;
    g.stopHud = () => {
      hide();
      stop();
    };
  }
  g.store.setScreen('menu');
  const my = ++token;
  void import('../kit/specimen').then((m) => {
    if (my !== token) return;
    if (!host) {
      const ui = document.querySelector<HTMLElement>('#ui .ms-ui');
      host = document.createElement('div');
      // mirror the layout classes (ms-touch / ms-portrait / ms-compact) so the specimen sees the same tier
      host.className = `${ui?.className ?? 'ms-ui'} ms-kit-host`;
      host.style.cssText = 'position:fixed;inset:0;z-index:60;pointer-events:auto';
      (document.getElementById('ui') ?? document.body).appendChild(host);
    }
    m.mountSpecimen(host, page, opts);
  });
}

const s = (id: string, label: string, page: KitPage, opts: KitOpts = {}): Scenario => ({ id, label, run: (g) => show(g, page, opts) });

export const scenarios: Scenario[] = [
  s('kit-fx', 'Kit · UiFx (rays, motes, burst, classes)', 'fx'),
  s('kit-fx-rays', 'Kit · UiFx god-rays', 'fx', { section: 'rays' }),
  s('kit-fx-motes', 'Kit · UiFx motes', 'fx', { section: 'motes' }),
  s('kit-fx-burst', 'Kit · UiFx burst cells', 'fx', { section: 'burst' }),
  s('kit-fx-classes', 'Kit · UiFx classes', 'fx', { section: 'classes' }),
  s('kit-burst', 'Kit · Level-up burst (live)', 'burst'),
  s('kit-burst-t010', 'Kit · Level-up burst t=0.1', 'burst', { t: 0.1 }),
  s('kit-burst-t040', 'Kit · Level-up burst t=0.4', 'burst', { t: 0.4 }),
  s('kit-burst-t090', 'Kit · Level-up burst t=0.9', 'burst', { t: 0.9 }),
  s('kit-icons', 'Kit · Icons (currency, stats, grades, edge arrows)', 'icons'),
  s('kit-glyphs', 'Kit · Engraved UI symbols', 'glyphs'),
  s('kit-icons48', 'Kit · 48 px silhouette sheet', 'icons48'),
];
