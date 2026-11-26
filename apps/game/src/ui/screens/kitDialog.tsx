// Kit v1 dialogs for the pause / settings windows (B8): a compact stone board with a rust-copper title bar and a boxed
// close, over the dimmed + blurred scene. Same behaviour as the legacy Modal / Confirm (own focus scope, Esc / backdrop
// click cancels, "open" sound, first button focused) but never the wood panel: the old Modal sits inside the settings
// kit scope and would mix stone plates into a mahogany card. Styles: screens/settings.css (.ms-kdlg*).
import type { ComponentChildren, JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { t } from '../../i18n/i18n';
import { sfx } from '../audio';
import { Button } from '../components/Button';
import { Panel } from '../components/Panel';
import { UiGlyph, type UiGlyphName } from '../components/StatIcon';
import { focusFirst, useKeys, useScope } from '../nav';

export interface KitDialogProps {
  title: ComponentChildren;
  children?: ComponentChildren;
  footer?: ComponentChildren;
  onClose?: () => void;
  width?: string;
  /** crimson title bar + a skull seal (destructive questions) */
  danger?: boolean;
  /** engraved symbol left of the caption */
  icon?: UiGlyphName;
  class?: string;
}

export function KitDialog({ title, children, footer, onClose, width = 'min(34rem, 94%)', danger, icon, class: cls }: KitDialogProps): JSX.Element {
  const scope = useScope({ modal: true });
  useKeys((a) => {
    if (a.kind === 'cancel' && onClose) {
      sfx('back');
      onClose();
      return true;
    }
    return false;
  });
  useEffect(() => {
    sfx('open');
    const id = requestAnimationFrame(() => focusFirst());
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div class="ms-modal ms-modal--blur ms-kdlg" ref={scope} role="dialog" aria-modal="true" tabIndex={-1} onPointerDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <Panel
        variant="board"
        thin
        class={`ms-kdlg-card ${danger ? 'is-danger' : ''} ${cls ?? ''}`}
        style={{ width }}
        title={title}
        titleIcon={<UiGlyph name={icon ?? (danger ? 'skull' : 'info')} tone={danger ? 'crimson' : 'gold'} />}
        {...(onClose ? { onClose } : {})}
      >
        <div class="ms-kdlg-body ms-scroll">{children}</div>
        {footer !== undefined && <div class="ms-kdlg-foot">{footer}</div>}
      </Panel>
    </div>
  );
}

/** Yes / no question (reset profile, delete cloud data, abandon the run). The confirm button holds the focus, as before. */
export function KitConfirm({ title, text, confirmLabel, onConfirm, onCancel, danger }: { title: ComponentChildren; text: ComponentChildren; confirmLabel?: ComponentChildren; onConfirm: () => void; onCancel: () => void; danger?: boolean }): JSX.Element {
  return (
    <KitDialog
      title={title}
      width="min(30rem, 94%)"
      onClose={onCancel}
      {...(danger ? { danger } : {})}
      footer={
        <>
          <Button variant="wood" onClick={onCancel} sound="back">
            {t('common.cancel')}
          </Button>
          <Button {...(danger ? { danger } : {})} onClick={onConfirm} autofocus>
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </>
      }
    >
      <p class="ms-kdlg-text">{text}</p>
    </KitDialog>
  );
}
