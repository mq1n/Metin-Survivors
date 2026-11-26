// Kit v1 specimen pages (UI core lane B, dev only): every kit component in every state, mounted by the gallery scenarios
// in ui/dev/scenarios/kit.ts on top of the (empty) run screen. The specimen host is a second `.ms-ui` root next to the
// real one (same layout classes, same texture variables), so kit CSS renders exactly as on a screen.
import { render, type ComponentChildren, type JSX } from 'preact';
import type { GalleryCtx } from '../gallery';
import { Panel, Divider } from '../components/Panel';
import { CapButton, TitleBar } from '../components/TitleBar';
import { TooltipHost } from '../components/Tooltip';
import { Glyph } from '../components/glyphs';
import { ButtonsPage } from './kit/pageButtons';
import { GaugesPage } from './kit/pageGauges';
import { SlotsPage } from './kit/pageSlots';
import { TipsPage } from './kit/pageTips';
import { TypePage } from './kit/pageType';
import './kitSpecimen.css';

export type KitPage = 'boards' | 'buttons' | 'slots' | 'gauges' | 'tips' | 'type';

const noop = (): void => undefined;

function Sec({ title, children, note, class: cls }: { title: string; children?: ComponentChildren; note?: string; class?: string }): JSX.Element {
  return (
    <section class={`ks-sec ${cls ?? ''}`}>
      <h3 class="ks-h">{title}</h3>
      {note && <p class="ks-note">{note}</p>}
      <div class="ks-row">{children}</div>
    </section>
  );
}

function Lorem(): JSX.Element {
  return (
    <div class="ks-lines">
      <div class="ks-line">
        <span>Level</span>
        <b class="ms-num">39</b>
      </div>
      <div class="ks-line">
        <span>Experience</span>
        <b class="ms-num">142,300 / 232,767</b>
      </div>
      <div class="ks-line">
        <span>Yeop</span>
        <b class="ms-num">4,380,000</b>
      </div>
    </div>
  );
}

function BoardsPage(): JSX.Element {
  return (
    <>
      <Sec title="Board · title bar · close" note="Panel variant=board (T1 board + T2 pewter bevel + corner studs), title -> TitleBar with boxed close">
        <Panel variant="board" title="Inventory" onClose={noop} class="ks-win" body>
          <Lorem />
          <Divider groove />
          <Panel variant="sunken" framed class="ks-sunk">
            <span class="ks-dim">sunken framed + carved lattice</span>
          </Panel>
        </Panel>
        <Panel variant="board" ornate title="Character" titleIcon={<Glyph name="helmet" />} class="ks-win" body>
          <Lorem />
          <Divider groove="plain" />
          <Panel variant="sunken" plain class="ks-sunk">
            <span class="ks-dim">sunken plain</span>
          </Panel>
        </Panel>
        <Panel variant="board" class="ks-win ks-win--bare" body>
          <p class="ks-p">A board without a title: the four domed studs sit on the bevel corners. Copy on the board is cream on charcoal.</p>
          <Panel variant="sunken" class="ks-sunk ks-sunk--tall">
            <span class="ks-dim">sunken (lattice)</span>
          </Panel>
        </Panel>
      </Sec>
    </>
  );
}

function BoardsPage2(): JSX.Element {
  return (
    <Sec title="Thin board · title bars · cap buttons" note="Panel variant=thinboard (translucent, stepped fret corners) · TitleBar normal / small / icon · CapButton states">
      <Panel variant="thinboard" class="ks-thin" body>
        <p class="ks-p">Thin board over the world: notices, small menus and dialogs. Stepped fret corners, translucent charcoal.</p>
      </Panel>
      <Panel variant="thinboard" title="System" class="ks-thin" onClose={noop}>
        <div class="ms-board-body">
          <p class="ks-p">Thin board with a title bar.</p>
        </div>
      </Panel>
      <div class="ks-col ks-tbs">
        <TitleBar>Skills</TitleBar>
        <TitleBar onClose={noop}>Refine · Blacksmith</TitleBar>
        <TitleBar small icon={<Glyph name="chest" />}>
          Small title with icon
        </TitleBar>
        <div class="ks-capbtns">
          <CapButton label="Close" onClick={noop} />
          <CapButton label="Minus" onClick={noop}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 8h10" stroke="currentColor" stroke-width="2.4" />
            </svg>
          </CapButton>
          <CapButton label="Plus" onClick={noop}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 8h10M8 3v10" stroke="currentColor" stroke-width="2.4" />
            </svg>
          </CapButton>
          <CapButton label="Danger" danger onClick={noop} />
          <span class="ks-dim">cap buttons (hover = gold glyph, pressed = inverted bevel)</span>
        </div>
      </div>
    </Sec>
  );
}

function Page({ page }: { page: KitPage }): JSX.Element {
  let body: JSX.Element;
  switch (page) {
    case 'buttons':
      body = <ButtonsPage />;
      break;
    case 'slots':
      body = <SlotsPage />;
      break;
    case 'gauges':
      body = <GaugesPage />;
      break;
    case 'tips':
      body = <TipsPage />;
      break;
    case 'type':
      body = <TypePage />;
      break;
    case 'boards':
    default:
      body = (
        <>
          <BoardsPage />
          <BoardsPage2 />
        </>
      );
  }
  return (
    <div class="ms-kitspec">
      <header class="ks-top">
        <span class="ks-brand">KIT v1 · Stone &amp; Pewter</span>
        <span class="ks-page">{page}</span>
      </header>
      {body}
      <TooltipHost />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------

let mounted: { host: HTMLElement; obs: MutationObserver } | null = null;

function unmount(): void {
  if (!mounted) return;
  render(null, mounted.host);
  mounted.obs.disconnect();
  mounted.host.remove();
  mounted = null;
}

/** Mounts a specimen page over the gallery; removed again when the gallery applies the next scenario. */
export function mountKitSpecimen(g: GalleryCtx, page: KitPage): void {
  unmount();
  const root = document.getElementById('ui');
  const uiHost = root?.querySelector<HTMLElement>(':scope > .ms-ui');
  if (!root || !uiHost) return;
  // inside the real `.ms-ui` root (not beside it): the QA probes read `.ms-ui`, and every kit variable / texture / class
  // (touch, kbd, tier) is inherited exactly as on a screen
  const host = document.createElement('div');
  host.className = 'ms-kitspec-host';
  uiHost.appendChild(host);
  const obs = new MutationObserver(() => undefined);
  render(<Page page={page} />, host);
  mounted = { host, obs };
  // gallery reset() calls stopHud() first on every apply(): unmount there, then restore the original
  const prev = g.stopHud;
  g.stopHud = () => {
    g.stopHud = prev;
    unmount();
    prev();
  };
}
