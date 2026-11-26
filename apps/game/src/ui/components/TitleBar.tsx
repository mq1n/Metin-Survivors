// Kit v1 title bar (T3): rust-copper leather strip between pewter edge lines, rivet end caps, centred caption, optional
// boxed close. Used by Panel variant="board" | "thinboard" (title prop) and standalone (pause header, refine dialog …).
import type { ComponentChildren, JSX } from 'preact';
import { t } from '../../i18n/i18n';
import { sfx } from '../audio';

export interface TitleBarProps {
  children?: ComponentChildren;
  /** boxed × at the right end (replaces the right rivet) */
  onClose?: () => void;
  /** aria-label of the close button (default: common.close) */
  closeLabel?: string;
  /** small icon left of the caption */
  icon?: ComponentChildren;
  /** compact bar (1.6 rem) */
  small?: boolean;
  class?: string;
  style?: JSX.CSSProperties;
}

export function CloseGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2" stroke="currentColor" stroke-width="2.3" stroke-linecap="square" fill="none" />
    </svg>
  );
}

/** Small chamfered square stone button (close, minus, plus, arrows). Touch targets reach --k-tap through .ms-hit. */
export function CapButton({ onClick, label, children, danger, class: cls }: { onClick: () => void; label: string; children?: ComponentChildren; danger?: boolean; class?: string }): JSX.Element {
  return (
    <button
      type="button"
      class={`ms-capbtn ${danger ? 'ms-capbtn--danger' : ''} ${cls ?? ''}`}
      data-nav=""
      aria-label={label}
      title={label}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') sfx('hover');
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children ?? <CloseGlyph />}
      <span class="ms-hit" aria-hidden="true" />
    </button>
  );
}

export function TitleBar({ children, onClose, closeLabel, icon, small, class: cls, style }: TitleBarProps): JSX.Element {
  return (
    <div class={`ms-titlebar ${small ? 'ms-titlebar--sm' : ''} ${onClose ? 'has-close' : ''} ${cls ?? ''}`} style={style}>
      {icon !== undefined && <span class="ms-titlebar-icon">{icon}</span>}
      <span class="ms-titlebar-text">{children}</span>
      {onClose && (
        <CapButton
          label={closeLabel ?? t('common.close')}
          onClick={() => {
            sfx('back');
            onClose();
          }}
        />
      )}
    </div>
  );
}
