import { createContext, type ComponentChildren, type JSX } from 'preact';
import { useContext } from 'preact/hooks';
import { TitleBar } from './TitleBar';

// ---------------------------------------------------------------------------------------------------------------
// Kit scope (kit v1 "Stone & Pewter", UI core lane B). Components inside a kit scope render their kit look: Button
// primary/wood/ghost -> lacquer/stone/text plates, Tabs and form controls -> stone plates, IconSlot -> octagon slot,
// Bar -> Gauge, tooltips opened from inside -> dark stone tooltip. Outside a scope nothing changes (legacy look).

/** true inside <Kit> or a Panel variant board | thinboard | sunken. */
export const KitCtx = createContext(false);

/** Kit look for a component: an explicit `kit` prop wins, otherwise the surrounding kit scope decides. */
export function useKit(force?: boolean): boolean {
  const scoped = useContext(KitCtx);
  return force ?? scoped;
}

export interface KitProps {
  children?: ComponentChildren;
  class?: string;
  style?: JSX.CSSProperties;
  /** render as `display: contents` (no box of its own; keeps the parent's flex / grid layout) */
  contents?: boolean;
  /** false = a legacy island inside a kit scope */
  on?: boolean;
  id?: string;
}

/** Opt a subtree into the kit: a `.ms-kit` element (DOM scope for CSS and tooltips) + the KitCtx provider. */
export function Kit({ children, class: cls, style, contents, on = true, id }: KitProps): JSX.Element {
  const c = [on ? 'ms-kit' : 'ms-kit-off', contents ? 'ms-kit--contents' : '', cls ?? ''].filter(Boolean).join(' ');
  return (
    <KitCtx.Provider value={on}>
      <div class={c} style={style} id={id}>
        {children}
      </div>
    </KitCtx.Provider>
  );
}

// ---------------------------------------------------------------------------------------------------------------

export type PanelVariant = 'wood' | 'stone' | 'parchment' | 'flat' | 'inset' | 'board' | 'thinboard' | 'sunken';

export interface PanelProps {
  children?: ComponentChildren;
  /** legacy: wood | stone | parchment | flat | inset. Kit v1: board (window), thinboard (translucent fret-corner board for
   *  menus / notices), sunken (recessed area inside a board; `framed` adds the inner pale line, `plain` drops the lattice) */
  variant?: PanelVariant;
  /** legacy: gold filigree 9-slice frame. board: 40-56 px pewter corner caps instead of the corner studs */
  ornate?: boolean;
  /** legacy: smaller corner ornaments. board: compact title bar */
  thin?: boolean;
  class?: string;
  style?: JSX.CSSProperties;
  /** legacy: centred gold heading with hairlines. board / thinboard: rust-copper title bar (TitleBar) */
  title?: ComponentChildren;
  onClick?: () => void;
  id?: string;
  /** board / thinboard with a title: boxed close button in the title bar */
  onClose?: () => void;
  /** aria-label of the close button (default: common.close) */
  closeLabel?: string;
  /** board / thinboard: small icon left of the title text */
  titleIcon?: ComponentChildren;
  /** sunken: inner pale frame line */
  framed?: boolean;
  /** sunken: no carved lattice */
  plain?: boolean;
  /** board: wrap the children in the standard body padding (.ms-board-body) */
  body?: boolean;
}

const LEGACY_CLASS: Partial<Record<PanelVariant, string>> = {
  stone: 'ms-panel--stone',
  parchment: 'ms-panel--parchment',
  flat: 'ms-panel--flat',
  inset: 'ms-panel--inset',
};

export function Panel(p: PanelProps): JSX.Element {
  const { children, variant = 'wood', ornate, thin, class: cls, style, title, onClick, id } = p;
  if (variant === 'board' || variant === 'thinboard' || variant === 'sunken') return <KitPanel {...p} variant={variant} />;
  const c = ['ms-panel', LEGACY_CLASS[variant] ?? '', ornate ? 'ms-panel--ornate' : '', thin ? 'ms-panel--thin-frame' : '', cls ?? ''].filter(Boolean).join(' ');
  return (
    <div class={c} style={style} onClick={onClick} id={id}>
      {title !== undefined && <div class="ms-panel-title">{title}</div>}
      {children}
    </div>
  );
}

function KitPanel({ children, variant, ornate, thin, class: cls, style, title, onClick, id, onClose, closeLabel, titleIcon, framed, plain, body }: PanelProps & { variant: 'board' | 'thinboard' | 'sunken' }): JSX.Element {
  const base = variant === 'board' ? 'ms-board' : variant === 'thinboard' ? 'ms-thinboard' : 'ms-sunken';
  const c = [
    base,
    'ms-kit',
    variant === 'board' && ornate ? 'ms-board--ornate' : '',
    variant === 'sunken' && framed ? 'ms-sunken--framed' : '',
    variant === 'sunken' && plain ? 'ms-sunken--plain' : '',
    cls ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <KitCtx.Provider value={true}>
      <div class={c} style={style} onClick={onClick} id={id}>
        {title !== undefined && variant !== 'sunken' && (
          <TitleBar small={thin} onClose={onClose} closeLabel={closeLabel} icon={titleIcon}>
            {title}
          </TitleBar>
        )}
        {body ? <div class="ms-board-body">{children}</div> : children}
        {variant === 'board' && ornate && (
          <>
            <i class="ms-board-orn is-tl" aria-hidden="true" />
            <i class="ms-board-orn is-tr" aria-hidden="true" />
            <i class="ms-board-orn is-bl" aria-hidden="true" />
            <i class="ms-board-orn is-br" aria-hidden="true" />
          </>
        )}
      </div>
    </KitCtx.Provider>
  );
}

export function Divider({ art, class: cls, groove }: { art?: boolean; class?: string; /** kit: carved pewter groove (+ centre rivet unless `groove="plain"`) */ groove?: boolean | 'plain' }): JSX.Element {
  if (groove) return <hr class={`ms-groove ${groove === 'plain' ? 'ms-groove--plain' : ''} ${cls ?? ''}`} />;
  return <hr class={`ms-divider ${art ? 'ms-divider--art' : ''} ${cls ?? ''}`} />;
}
