// r4 ship step (statictripo): prop placements of every zone (id, x, z, yaw, scale) as JSON lines, for the in-game sweep spots and the before / after layout diff.
//   bun run apps/game/src/world/debug/r4shipProps.ts [zone ...] > out.jsonl
import type { BiomePreset, ZoneDef } from '../../data/schema';
import zonesJson from '../../data/content/zones.json';
import { createTerrainField } from '../terrainField';

const zones = process.argv.slice(2).length ? process.argv.slice(2) : ['yeonmu', 'suryeon', 'seori', 'daeryeol'];
for (const zone of zones) {
  const z = (zonesJson as unknown as ZoneDef[]).find((q) => q.id === zone);
  if (!z) throw new Error(`unknown zone ${zone}`);
  const field = createTerrainField(z.biome as BiomePreset);
  for (const p of field.layout.props) console.log(JSON.stringify({ zone, id: p.id, x: +p.x.toFixed(2), z: +p.z.toFixed(2), yaw: +(p as { yaw?: number }).yaw!.toFixed?.(3) || 0, scale: (p as { scale?: number }).scale ?? 1 }));
}
