// DEV QA: every enemy + boss def of the content in rows on real terrain, shown through the production crowd renderer.
// ?demo=lineup[&zone=yeonmu][&quality=high][&clip=0..10][&tint=0]   window.__lineup.view(row, zoom) centers the camera on a row.
import { createHarness } from '../harness';
import { RenderWorld } from '../../render/world';
import type { MetinView, RenderCatalog } from '../../render/feed';
import { loadContent } from '../../data/loader';
import { createTerrainField } from '../../world/terrainField';
import { createZoneScene } from '../../render/terrain/zoneScene';
import { resolveBiome } from '../../render/terrain/look';
import type { QualityTier } from '../../render/quality';
import { StressEnemies } from '../stressDriver';

const COLS = 8;
const GAP_X = 5.5;
const GAP_Z = 9;

export interface LineupInfo {
  rows: { ids: string[]; z: number }[];
  missing: string[];
  view(row: number, zoom?: number): void;
  setClip(clip: number): void;
}

export default async function run(): Promise<void> {
  const q = new URLSearchParams(location.search);
  const tier = (q.get('quality') ?? 'high') as QualityTier;
  const h = await createHarness({ quality: tier, fixedQuality: true, noGround: true });
  const content = await loadContent();
  const zone = content.zones.find((z) => z.id === (q.get('zone') ?? 'yeonmu')) ?? (content.zones[0] as (typeof content.zones)[number]);
  const field = createTerrainField(zone.biome, 1234);
  const biome = resolveBiome(zone.id, zone.biome);
  h.core.env.setBiome(biome);
  h.core.heightAt = (x, z) => field.heightAt(x, z);
  const zs = createZoneScene(h.core, field, biome);
  h.core.scene.add(zs.group);
  zs.setQuality(h.core.quality.profile);
  h.core.addSystem({ name: 'zone', update: (dt) => zs.update(dt, h.core.camera, h.core.rig.focus) });
  await zs.ready;

  const all = [...content.enemies, ...content.bosses];
  const missing: string[] = [];
  const metinViews: MetinView[] = [];
  const metinDefs = content.metins.filter((m) => h.assets.hasModel(m.model));
  const defs = all.filter((d) => {
    const ok = h.assets.hasModel(d.model);
    if (!ok) missing.push(`${d.id} → ${d.model}`);
    return ok;
  });
  const noTint = q.get('tint') === '0';
  const catalog: RenderCatalog = {
    enemyTypes: defs.map((d) => ({
      key: d.id,
      modelId: d.model,
      tint: noTint ? undefined : d.tint,
      tintMode: noTint ? undefined : d.tintMode,
      radius: d.radius / Math.max(d.scale, 0.01),
    })),
    projectileStyles: [],
    metinTypes: metinDefs.map((m) => ({ key: m.id, modelId: m.model, rune: m.rune })),
  };
  const world = new RenderWorld(h.core);
  await world.load(catalog, []);
  world.warmup();

  const enemies = new StressEnemies(defs.length + 8);
  const rows: LineupInfo['rows'] = [];
  const bossCount = content.bosses.length;
  // normal creatures in rows of COLS, bosses on their own wider rows
  const placeRow = (indices: number[], z: number, gapX: number): void => {
    const ids: string[] = [];
    indices.forEach((di, k) => {
      const i = enemies.count++;
      const d = defs[di] as (typeof defs)[number];
      const x = (k - (indices.length - 1) / 2) * gapX;
      enemies.x[i] = enemies.px[i] = x;
      enemies.z[i] = enemies.pz[i] = z;
      enemies.rot[i] = Number(q.get('rot') ?? 0);
      enemies.scale[i] = d.scale;
      enemies.type[i] = di;
      enemies.animClip[i] = Number(q.get('clip') ?? 0);
      enemies.id[i] = i + 1;
      enemies.eliteTier[i] = content.bosses.some((b) => b.id === d.id) ? 3 : 0;
      ids.push(d.id);
    });
    rows.push({ ids, z });
  };
  const bossIds = new Set(content.bosses.map((b) => b.id));
  const normal = defs.map((d, i) => i).filter((i) => !bossIds.has((defs[i] as (typeof defs)[number]).id));
  const bosses = defs.map((d, i) => i).filter((i) => bossIds.has((defs[i] as (typeof defs)[number]).id));
  let z = 0;
  const solo = q.get('solo');
  const soloIdx = solo ? defs.findIndex((d) => d.id === solo) : -1;
  if (soloIdx >= 0) {
    // one creature at the arena center (open ground) so camera framing / emissive behaviour can be judged in isolation
    placeRow([soloIdx], 6, 0);
    z = 12;
  } else {
    for (let i = 0; i < normal.length; i += COLS) {
      placeRow(normal.slice(i, i + COLS), z, GAP_X);
      z += GAP_Z;
    }
    for (let i = 0; i < bosses.length; i += 4) {
      placeRow(bosses.slice(i, i + 4), z + 4, 12);
      z += 18;
    }
  }
  void bossCount;
  // metin row: every metin def alive (phase cycles are covered by ?demo=engine-qa)
  const metinZ = z + 6;
  metinDefs.forEach((m, k) => {
    metinViews.push({
      id: k + 1,
      type: k,
      x: (k - (metinDefs.length - 1) / 2) * 9,
      z: metinZ,
      phase: Number(q.get('mphase') ?? 1),
      phaseT: 5,
      hpFrac: 1,
      scale: m.great ? 2.2 : 1.4,
      great: !!m.great,
      auraRadius: 4,
      warnLeft: 0,
    });
  });
  rows.push({ ids: metinDefs.map((m) => m.id), z: metinZ });

  const info: LineupInfo = {
    rows,
    missing,
    view(row, zoom = 22) {
      const r = rows[row];
      if (!r) return;
      h.core.rig.setZoom(zoom);
      h.core.rig.setTarget(0, h.core.heightAt(0, r.z), r.z + 2);
      h.core.rig.snap();
    },
    setClip(clip) {
      for (let i = 0; i < enemies.count; i++) enemies.animClip[i] = clip;
    },
  };
  (window as unknown as { __lineup: LineupInfo & { world: RenderWorld } }).__lineup = Object.assign(info, { world });
  info.view(0);
  world.perf.setVisible(false);
  const feeds = { enemies, players: [], metins: metinViews };
  let last = performance.now();
  const frame = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    for (let i = 0; i < enemies.count; i++) enemies.animT[i] = (enemies.animT[i] as number) + dt;
    world.frame(feeds, dt, 1);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
