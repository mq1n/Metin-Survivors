// Every file in ./effects exports `EFFECTS: EffectDef[]`; they are collected here at build time (no shared edit point).
import type { EffectDef } from './host';

const modules = import.meta.glob<{ EFFECTS: EffectDef[] }>('./effects/*.ts', { eager: true });

export const ELEMENTAL_EFFECTS: EffectDef[] = Object.values(modules).flatMap((m) => m.EFFECTS);
