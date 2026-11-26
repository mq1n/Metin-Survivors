// r5 P5 (statictripo round 5): read-only clearance check of candidate demo spots: walkableCircle at several radii + the height range on a 5 m disc.
//   bun run apps/game/src/world/debug/r5P5_spots.ts <zone> x,z [x,z ...]
import type { BiomePreset, ZoneDef } from '../../data/schema';
import zonesJson from '../../data/content/zones.json';
import { createTerrainField } from '../terrainField';
const [zoneId, ...pts] = process.argv.slice(2);
const zones = zonesJson as unknown as ZoneDef[];
const zone = zones.find((z) => z.id === zoneId)!;
const field = createTerrainField(zone.biome as BiomePreset);
for (const p of pts) {
  const [x, z] = p.split(',').map(Number) as [number, number];
  const rs = [2, 3, 4, 5, 6, 8].map((r) => `r${r}:${field.walkableCircle(x, z, r) ? 'ok' : 'NO'}`).join(' ');
  let lo = Infinity, hi = -Infinity;
  for (let a = 0; a < 16; a++) for (const rr of [0, 2.5, 5]) { const h = field.heightAt(x + rr * Math.cos(a), z + rr * Math.sin(a)); lo = Math.min(lo, h); hi = Math.max(hi, h); }
  console.log(`${zoneId} (${x},${z}) ${rs} height ${lo.toFixed(2)}..${hi.toFixed(2)}`);
}
