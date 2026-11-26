// Paint-tag shape of the esoteric held props. The props themselves live in ascetic_spear.ts (monkSpear) and conjurer_staff.ts (evoStaff).

/** paint tags per prop material, as returned by the orc kit's `propTags(ctx, mats)` (structurally identical) */
export interface PropTags {
  metal: string[];
  haft: string[];
  wrap: string[];
  bone: string[];
  cloth: string[];
  glow: string[];
  /** trim tag (edge highlight on metal) */
  edge: string;
}
