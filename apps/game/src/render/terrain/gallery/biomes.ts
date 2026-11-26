// DEV gallery biome presets: Content's shipped zones (data/content/zones.json) are the source of truth so the gallery
// shows exactly what the game shows (same seeds, fog, sun, ambient).
import type { BiomePreset, ZoneDef } from '../../../data/schema';
import zonesJson from '../../../data/content/zones.json';

const zones = zonesJson as unknown as ZoneDef[];

export const GALLERY_BIOMES: Record<string, BiomePreset> = Object.fromEntries(zones.map((z) => [z.id, z.biome]));

export const GALLERY_ZONES: string[] = zones.slice().sort((a, b) => a.order - b.order).map((z) => z.id);
