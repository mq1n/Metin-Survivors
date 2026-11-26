// Paint zones: every triangle of a weapon carries one of these ids in its HardMesh group. The bake picks the material by zone.
export const Z = {
  steel: 1,
  edge: 2,
  fuller: 3,
  spine: 4,
  gold: 5,
  iron: 6,
  wood: 7,
  wrap: 8,
  silk: 9,
  gem: 10,
  jade: 11,
  bone: 12,
  lacquer: 13,
  trim: 14,
  rune: 15,
  fur: 16,
} as const;
export type ZoneId = (typeof Z)[keyof typeof Z];
