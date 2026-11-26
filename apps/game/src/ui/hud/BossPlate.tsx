// Boss row of the top-centre card (the card is one stone tablet: timer on top, this row under it, the event banner last, see
// Hud.tsx TopCentre): the boss's monster card (`icon_enemy_<bossId>`, octagon slot with the card's own rim) on its left end, or a
// coin-bezel skull seal when that card is not shipped, the name in Cinzel with the epithet, a thick crimson tube gauge
// and one gem per phase. Enraged bosses redden the card and pulse the gauge edge; the final boss wears a gold rim.
import type { JSX } from 'preact';
import { fmtPct, t, tl } from '../../i18n/i18n';
import type { HudSnapshot } from '../../sim/types';
import { iconUrl } from '../assets';
import { Chip } from '../components/Chip';
import { IconSlot } from '../components/Slot';
import { UiGlyph } from '../components/StatIcon';
import { indexOf } from '../content';
import { layout } from '../layout';
import { HudGauge } from './HudGauge';
import { useTrail } from './hooks';

export function BossRow({ boss }: { boss: NonNullable<HudSnapshot['boss']> }): JSX.Element {
  const def = indexOf().bosses.get(boss.id);
  const frac = boss.hpMax > 0 ? Math.min(1, Math.max(0, boss.hp / boss.hpMax)) : 0;
  const trail = useTrail(frac);
  const phases = def?.phases.length ?? 1;
  const cardId = `icon_enemy_${boss.id}`;
  const card = iconUrl(cardId) !== null;
  return (
    <div class={`ms-bp ${boss.enraged ? 'is-enraged' : ''} ${boss.final ? 'is-final' : ''}`}>
      <span class={`ms-bp-seal ${card ? 'ms-bp-seal--card' : ''}`} aria-hidden="true">
        {card ? <IconSlot icon={cardId} kind="misc" glyph="skull" /> : <UiGlyph name="skull" tone={boss.enraged ? 'crimson' : 'ivory'} />}
      </span>
      <div class="ms-bp-body">
        <div class="ms-bp-name">
          <span class="ms-bp-title">{def ? tl(def.name) : boss.id}</span>
          {def && <span class="ms-bp-epithet">{tl(def.title)}</span>}
          {boss.final && (
            <Chip tone="gold" size="sm">
              {t('hud.boss.final')}
            </Chip>
          )}
          {boss.enraged && (
            <Chip tone="red" size="sm">
              {t('hud.boss.enraged')}
            </Chip>
          )}
        </div>
        <HudGauge kind="boss" value={frac} trail={trail} ch={layout.value.compact ? '1.1rem' : '1.4rem'} label={fmtPct(frac)} />
        {phases > 1 && (
          <div class="ms-bp-phases" role="img" aria-label={t('hud.boss.phase', { n: boss.phase + 1 })}>
            {Array.from({ length: phases }, (_, i) => (
              <i key={i} class={i <= boss.phase ? 'is-on' : ''} />
            ))}
            <span>{t('hud.boss.phase', { n: boss.phase + 1 })}</span>
          </div>
        )}
      </div>
    </div>
  );
}
