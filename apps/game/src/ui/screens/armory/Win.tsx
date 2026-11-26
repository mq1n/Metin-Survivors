// Armory mini window: the sub-windows of the armory hub (equipment, hero stats, collection log, zone list ...). A small

// and inventory dialogs. Built from the kit TitleBar; the board look is armory.css (.ms-arm-win).
import type { ComponentChildren, JSX } from 'preact';
import { TitleBar } from '../../components/TitleBar';
import { layout } from '../../layout';

export interface WinProps {
  title: ComponentChildren;
  icon?: ComponentChildren;
  /** boxed close at the right end of the bar (overlay panels) */
  onClose?: () => void;
  closeLabel?: string;
  class?: string;
  /** class of the body element (default: .ms-arm-win-body) */
  bodyClass?: string;
  children?: ComponentChildren;
  style?: JSX.CSSProperties;
  role?: 'dialog' | 'region' | 'group';
  'aria-label'?: string;
}

export function Win({ title, icon, onClose, closeLabel, class: cls, bodyClass, children, style, role, 'aria-label': aria }: WinProps): JSX.Element {
  return (
    <section class={`ms-arm-win ${cls ?? ''}`} style={style} role={role} aria-label={aria}>
      <TitleBar small {...(icon !== undefined ? { icon } : {})} {...(onClose ? { onClose } : {})} {...(closeLabel ? { closeLabel } : {})}>
        {title}
      </TitleBar>
      <div class={`ms-arm-win-body ${bodyClass ?? ''}`}>{children}</div>
    </section>
  );
}

/**
 * Focus hooks for rows that only carry a tooltip (stat rows, skill chips, drop tiles): keyboard / gamepad focus on pointer
 * devices, nothing on touch (they are not tap targets there; the tooltip is a long-press).
 */
export function navProps(): { tabIndex?: number; 'data-nav'?: string } {
  return layout.value.touch ? {} : { tabIndex: 0, 'data-nav': '' };
}
