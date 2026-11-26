import type { ComponentChildren, JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { t } from '../../i18n/i18n';
import { sfx } from '../audio';
import { focusFirst, useKeys, useScope } from '../nav';
import { uiToasts } from '../view';
import { Button } from './Button';
import { Panel } from './Panel';
import { Motes, warmUiFx } from './UiFx';

export interface ModalProps {
  title?: ComponentChildren;
  children?: ComponentChildren;
  footer?: ComponentChildren;
  onClose?: () => void;
  /** show the × button / allow Esc to close */
  closable?: boolean;
  width?: string;
  class?: string;
  ornate?: boolean;
  variant?: 'wood' | 'stone' | 'parchment';
}

/** Centered dialog on a dimmed backdrop; owns a focus scope and Esc handling. */
export function Modal({ title, children, footer, onClose, closable = true, width = '34rem', class: cls, ornate = true, variant = 'wood' }: ModalProps): JSX.Element {
  const scope = useScope({ modal: true });
  useKeys((a) => {
    if (closable && a.kind === 'cancel' && onClose) {
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
    <div class="ms-modal ms-modal--blur" ref={scope} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} tabIndex={-1} onPointerDown={(e) => e.target === e.currentTarget && closable && onClose?.()}>
      <Panel class={`ms-modal-card ${cls ?? ''}`} variant={variant} ornate={ornate} style={{ width }}>
        {(title !== undefined || (closable && onClose)) && (
          <div class="ms-modal-head">
            <h2>{title}</h2>
            {closable && onClose && (
              <Button variant="ghost" size="small" icon sound="back" onClick={onClose} aria-label={t('common.close')}>
                ✕
              </Button>
            )}
          </div>
        )}
        <div class="ms-modal-body ms-scroll">{children}</div>
        {footer !== undefined && <div class="ms-modal-foot">{footer}</div>}
      </Panel>
    </div>
  );
}

/** Confirmation dialog (reset profile, abandon run …). */
export function Confirm({ title, text, confirmLabel, onConfirm, onCancel, danger }: { title: ComponentChildren; text: ComponentChildren; confirmLabel?: ComponentChildren; onConfirm: () => void; onCancel: () => void; danger?: boolean }): JSX.Element {
  return (
    <Modal
      title={title}
      width="30rem"
      onClose={onCancel}
      footer={
        <>
          <Button variant="wood" onClick={onCancel} sound="back">
            {t('common.cancel')}
          </Button>
          <Button danger={danger} onClick={onConfirm} autofocus>
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </>
      }
    >
      <p style={{ textAlign: 'center', lineHeight: 1.45 }}>{text}</p>
    </Modal>
  );
}

export function ToastHost(): JSX.Element {
  return (
    <div class="ms-toasts" aria-live="polite">
      {uiToasts.value.map((x) => (
        <div key={x.id} class={`ms-toast ms-toast--${x.tone}`}>
          {x.text}
        </div>
      ))}
    </div>
  );
}

/**
 * Rising embers over a dark scene (menu / screen backgrounds). Now a thin wrapper over the canvas <Motes preset="ember">
 * of UiFx.tsx: one canvas, <= 128 pooled particles (white-hot core, trail, a few out-of-focus bokeh discs), paused while
 * hidden or off-screen and a single still frame under prefers-reduced-motion. Props unchanged.
 */
export function EmberField({ count = 26, seed }: { count?: number; seed?: number }): JSX.Element {
  useEffect(() => warmUiFx(), []);
  return (
    <div class="ms-layer" style={{ overflow: 'hidden' }} aria-hidden="true">
      <Motes preset="ember" count={Math.min(128, Math.max(0, Math.round(count)))} seed={seed ?? count} />
    </div>
  );
}
