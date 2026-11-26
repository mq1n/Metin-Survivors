// Shared vector helper of the esoteric weapon styles (ascetic_style.ts, zealot_style.ts and conjurer_style.ts hold the OrcStyle data).
type V3 = [number, number, number];
export const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
