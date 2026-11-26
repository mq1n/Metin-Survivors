// Generic arena recipe: rolling centre, cliff-ring rim, scattered trees/rocks. Used for unknown biome ids and as the
// reference for how a recipe is structured. The real zones (yeonmu, suryeon, seori, daeryeol) live next to it.
import type { Landmark, TreeSpecies } from '../layoutTypes';
import { SURFACE } from '../layoutTypes';
import { fbm, ridged, smoothstep } from '../noise';
import type { RecipeContext, TerrainPlan, ZoneRecipe } from '../recipe';

export interface GenericProfile {
  groundTex: [base: string, alt: string, path: string, rock: string];
  rockMats: string[];
  trees: Array<[TreeSpecies, number]>;
  rimHeight: number;
  hills: number;
}

export function genericRecipe(id: string, p: GenericProfile): ZoneRecipe {
  return {
    id,
    build(ctx: RecipeContext): TerrainPlan {
      const seed = ctx.seed;
      const R = 188;
      const boundary = (x: number, z: number): number => {
        const r = Math.sqrt(x * x + z * z) + 1e-6;
        return R * (1 + 0.075 * fbm((x / r) * 1.6 + 7.1, (z / r) * 1.6 - 3.3, seed + 5, 3));
      };
      const height = (x: number, z: number): number => {
        const r = Math.sqrt(x * x + z * z);
        const b = boundary(x, z);
        const rolling = (fbm(x / 80, z / 80, seed + 11, 3) * 1.0 + fbm(x / 24, z / 24, seed + 12, 2) * 0.28) * p.hills;
        const centreFlat = 1 - smoothstep(14, 46, r) * 0.75;
        const base = rolling * (1 - 0.65 * centreFlat);
        const rimT = smoothstep(b - 14, b + 20, r);
        const crag = ridged(x / 30, z / 30, seed + 21, 3) * 0.6 + fbm(x / 9, z / 9, seed + 22, 2) * 0.12;
        const far = smoothstep(b + 10, b + 90, r);
        return base + rimT * p.rimHeight * (0.55 + 0.7 * crag) + far * 30;
      };
      const landmarks: Landmark[] = [
        { id: 'centre', kind: 'centre', x: 0, z: 0, r: 24 },
        { id: 'spawn', kind: 'spawn', x: 0, z: 0, r: 10 },
      ];
      return {
        arenaRadius: R,
        arenaSdf: (x, z) => Math.sqrt(x * x + z * z) - (boundary(x, z) - 6),
        height,
        streams: [],
        bridges: [],
        landmarks,
        groundLayers: [
          { tex: p.groundTex[0], scale: 5 },
          { tex: p.groundTex[1], scale: 6 },
          { tex: p.groundTex[2], scale: 5 },
          { tex: p.groundTex[3], scale: 7 },
        ],
        cliffLayer: 3,
        cover: [],
        rockMaterials: p.rockMats,
        surface: () => SURFACE.GROUND,
        paint(x, z, _h, slope, out) {
          const patch = fbm(x / 38, z / 38, seed + 31, 3);
          out[0] = 1 + Math.max(0, patch);
          out[1] = Math.max(0, -patch) * 1.4;
          out[2] = Math.max(0, 0.34 - Math.abs(fbm(x / 60, z / 60, seed + 41, 2))) * 5;
          out[3] = smoothstep(0.35, 0.7, slope) * 4;
        },
        scatter(sc) {
          const weights = p.trees.map((t) => t[1]);
          for (let i = 0; i < 2600; i++) {
            const a = sc.rng.next();
            const b = sc.rng.next();
            const x = (a * 2 - 1) * R;
            const z = (b * 2 - 1) * R;
            const r = Math.sqrt(x * x + z * z);
            if (r < 30) continue;
            const grove = fbm(x / 45, z / 45, seed + 51, 2);
            if (grove < 0.05 && sc.rng.next() > 0.08) continue;
            const t = p.trees[sc.rng.weighted(weights)] as [TreeSpecies, number];
            sc.tree(t[0], x, z, 0.8 + sc.rng.next() * 0.5);
          }
          for (let i = 0; i < 260; i++) {
            const x = (sc.rng.next() * 2 - 1) * R;
            const z = (sc.rng.next() * 2 - 1) * R;
            if (Math.sqrt(x * x + z * z) < 24) continue;
            const s = 0.8 + sc.rng.next() * 1.6;
            sc.rock('boulder', x, z, s * 1.4, s, s * 1.2, sc.rng.int(p.rockMats.length));
          }
        },
      };
    },
  };
}
