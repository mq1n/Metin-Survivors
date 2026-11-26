import type { JSX } from 'preact';
import { t } from '../../i18n/i18n';
import { texUrl } from '../assets';

/** The painted logo lock-up (CSS glow added here, never in the asset); text fallback when the art is missing. */
export function Logo({ class: cls, sub = true }: { class?: string; sub?: boolean }): JSX.Element {
  const url = texUrl('ui_logo');
  return (
    <div class={`ms-logo ${cls ?? ''}`} role="img" aria-label={t('app.title')}>
      {url ? (
        <img class="ms-logo-img" src={url} alt="" draggable={false} />
      ) : (
        <span class="ms-logo-text ms-title">{t('app.title')}</span>
      )}
      {sub && <span class="ms-logo-sub">{t('app.subtitle')}</span>}
    </div>
  );
}
