import type { ComponentChildren, JSX } from 'preact';
import { sfx, type UiSfx } from '../audio';
import { Glyph } from './glyphs';
import { useKit } from './Panel';

export interface ButtonProps {
  children?: ComponentChildren;
  onClick?: (e: MouseEvent) => void;
  /** legacy: red lacquer (default) | dark wood | transparent gold-hairline. Kit: primary = matte lacquer plate (the one
   *  primary action of a screen), wood = grey stone plate, ghost = text button */
  variant?: 'primary' | 'wood' | 'ghost';
  size?: 'small' | 'normal' | 'big';
  disabled?: boolean;
  block?: boolean;
  danger?: boolean;
  active?: boolean;
  /** secondary caption under the label */
  sub?: ComponentChildren;
  /** click sound (default 'click'; 'confirm' for primary actions, 'back' for dismiss) */
  sound?: UiSfx | 'none';
  class?: string;
  title?: string;
  autofocus?: boolean;
  left?: boolean;
  icon?: boolean;
  type?: 'button' | 'submit';
  style?: JSX.CSSProperties;
  'aria-label'?: string;
  /** kit v1 look (chamfered stone / lacquer / text plates). Default: on inside a kit scope (<Kit>, Panel board), else legacy */
  kit?: boolean;
}

export function Button(p: ButtonProps): JSX.Element {
  const variant = p.variant ?? 'primary';
  const kit = useKit(p.kit);
  const kind = p.danger ? 'danger' : variant === 'primary' ? 'primary' : variant === 'ghost' ? 'text' : 'stone';
  const cls = kit
    ? [
        'ms-kbtn',
        kind === 'text' ? '' : 'ms-plate',
        `ms-kbtn--${kind}`,
        p.size === 'small' ? 'ms-kbtn--small' : p.size === 'big' ? 'ms-kbtn--big' : '',
        p.block ? 'ms-kbtn--block' : '',
        p.active ? 'is-active' : '',
        p.left ? 'ms-kbtn--left' : '',
        p.icon ? 'ms-kbtn--icon' : '',
        p.class ?? '',
      ]
    : [
        'ms-btn',
        variant === 'wood' ? 'ms-btn--wood' : variant === 'ghost' ? 'ms-btn--ghost' : '',
        p.size === 'small' ? 'ms-btn--small' : p.size === 'big' ? 'ms-btn--big' : '',
        p.block ? 'ms-btn--block' : '',
        p.danger ? 'ms-btn--danger' : '',
        p.active ? 'is-active' : '',
        p.left ? 'ms-btn--left' : '',
        p.icon ? 'ms-btn--icon' : '',
        p.class ?? '',
      ];
  const sound = p.sound ?? (variant === 'primary' ? 'confirm' : 'click');
  const label = kit && p.danger && !p.icon ? <Glyph name="skull" class="ms-kbtn-mark" /> : null;
  return (
    <button
      type={p.type ?? 'button'}
      class={cls.filter(Boolean).join(' ')}
      data-nav=""
      data-autofocus={p.autofocus ? '' : undefined}
      disabled={p.disabled}
      aria-disabled={p.disabled ? 'true' : undefined}
      title={p.title}
      aria-label={p['aria-label']}
      style={p.style}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse' && !p.disabled) sfx('hover');
      }}
      onClick={(e) => {
        if (p.disabled) return;
        if (sound !== 'none') sfx(sound);
        p.onClick?.(e);
      }}
    >
      {label}
      {p.sub !== undefined ? (
        <span class={kit ? 'ms-kbtn-body' : 'ms-btn-body'}>
          <span>{p.children}</span>
          <span class={kit ? 'ms-kbtn-sub' : 'ms-btn-sub'}>{p.sub}</span>
        </span>
      ) : (
        p.children
      )}
    </button>
  );
}

export interface TabDef<K extends string> {
  key: K;
  label: ComponentChildren;
  badge?: number | string;
  disabled?: boolean;
}

export interface TabsProps<K extends string> {
  tabs: readonly TabDef<K>[];
  value: K;
  onChange: (k: K) => void;
  class?: string;
  /** kit v1 plate tabs (default: on inside a kit scope) */
  kit?: boolean;
}

export function Tabs<K extends string>({ tabs, value, onChange, class: cls, kit: kitProp }: TabsProps<K>): JSX.Element {
  const kit = useKit(kitProp);
  return (
    <div class={`${kit ? 'ms-ktabs' : 'ms-tabs'} ${cls ?? ''}`} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={t.key === value}
          class={kit ? `ms-ktab ms-plate ${t.key === value ? 'is-active' : ''}` : `ms-tab ${t.key === value ? 'is-active' : ''}`}
          data-nav=""
          disabled={t.disabled}
          onPointerEnter={(e) => {
            if (e.pointerType === 'mouse') sfx('hover');
          }}
          onClick={() => {
            if (t.key !== value) {
              sfx('tab');
              onChange(t.key);
            }
          }}
        >
          {t.label}
          {t.badge !== undefined && t.badge !== 0 && <span class={kit ? 'ms-ktab-badge' : 'ms-tab-badge'}>{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}
