// Terrain gallery entry (DEV, apps/game/terrain.html). Query: ?zone=yeonmu&mode=all&cam=gameplay&q=high
//   mode: all (full createZoneScene) | terrain | veg | liquid | structures | sky   (modes/<mode>.ts)
import type { QualityTier } from '../../quality';
import { GALLERY_ZONES } from './biomes';
import { GalleryHost, type CamPreset, type GalleryMode } from './host';

async function boot(): Promise<void> {
  const q = new URLSearchParams(location.search);
  const modes = import.meta.glob<{ default: GalleryMode }>('./modes/*.ts');
  const modeName = q.get('mode') ?? 'all';
  const loader = modes[`./modes/${modeName}.ts`];
  if (!loader) throw new Error(`unknown gallery mode "${modeName}" (have: ${Object.keys(modes).join(', ')})`);
  const host = await GalleryHost.create();
  host.mode = (await loader()).default;
  host.showActors = q.get('actors') === '1';
  const quality = q.get('q') as QualityTier | null;
  if (quality) host.setQuality(quality);
  const cam = (q.get('cam') as CamPreset | null) ?? 'gameplay';
  host.cam = cam;
  const zone = q.get('zone') ?? GALLERY_ZONES[0] ?? 'yeonmu';
  await host.setZone(zone);
  const x = Number(q.get('x') ?? 0);
  const z = Number(q.get('z') ?? 0);
  host.setHero(x, z);
  const start = (): void => {
    let last = performance.now();
    const step = (now: number): void => {
      const dt = (now - last) / 1000;
      last = now;
      const cpu0 = performance.now();
      host.core.frame(dt, 1);
      host.afterRender(performance.now() - cpu0);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  start();
  (document.getElementById('game') as HTMLCanvasElement).focus();
}

boot().catch((err: unknown) => {
  console.error(err);
  const el = document.getElementById('ui');
  if (el) {
    el.textContent = `Fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`;
    el.style.cssText = 'color:#f88;font:13px monospace;padding:16px;white-space:pre-wrap;pointer-events:auto';
  }
});
