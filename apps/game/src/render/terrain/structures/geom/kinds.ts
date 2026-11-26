// Surface kinds carried per vertex (attribute `aMat.x`) and resolved by the architecture material (materials.ts).
// The same ids are #defined in the shader, so keep both in sync.
export const KIND = {
  /** vertex colour only (+ faint mottling) */
  plain: 0,
  /** roof tile: uv.x = metres across the slope, uv.y = metres up the slope from the eave */
  tile: 1,
  /** timber: uv.y runs along the grain, metres */
  wood: 2,
  /** monolithic carved stone: object-space noise, chips, optional detail texture */
  stone: 3,
  /** white plaster wall */
  plaster: 4,
  /** glossy lacquer */
  lacquer: 5,
  /** bronze / gold / iron trim */
  metal: 6,
  /** animated ember glow: emission pulses with object-space noise */
  ember: 7,
  /** round eave-tile ends (discs) strip: uv.x metres along the eave, uv.y metres from its lower edge */
  tileEnd: 8,
  /** timber lattice over paper: uv in metres */
  lattice: 9,
  /** woven cloth / hide: faint thread pattern */
  cloth: 10,
  /** coursed stone masonry (block joints in object space) */
  masonry: 11,
  /** thatch / straw / bark: strong streak pattern along uv.y */
  straw: 12,
} as const;

export type Kind = (typeof KIND)[keyof typeof KIND];
