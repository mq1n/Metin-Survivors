// The doctrine plate's record line of the hero select ("1 run · 0 wins"): count-aware in English (tn: one / other), one form in Turkish.
import { tn } from '../../i18n/i18n';

export function heroRecord(runs: number, wins: number): string {
  return `${tn('hero.record.runs', runs)} · ${tn('hero.record.wins', wins)}`;
}
