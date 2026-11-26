// Gallery mode "liquid": debug ground + the liquid system (water / lava / ice). Owner: TerrainFluids.
//   ?liquid=auto (default) real layout.liquid when the zone recipe has one, else a synthetic liquid matching the biome
//   ?liquid=water|lava|ice  force a synthetic carved test liquid (see liquid/devScene.ts)
//   ?liquid=real            only the real recipe (no liquid system when the recipe has none)
// Automation: window.__gallery.fluids.go(spotName, 'gameplay' | 'wide' | 'orbit', {yaw,pitch,dist}) and .spots.
import type { RockPlacement } from '../../../../world/layoutTypes';
import { createLiquid } from '../../liquid';
import { createDevClock, dressGround, realSpots, testSpots, withTestLiquid, type TestKind, type TestSpot } from '../../liquid/devScene';
import { createDebugGround } from '../debugGround';
import type { GalleryHost, GalleryMode } from '../host';

interface FluidsApi {
  kind: string;
  level: number;
  synthetic: boolean;
  spots: TestSpot[];
  go(name: string, cam?: 'gameplay' | 'wide' | 'orbit', opts?: { yaw?: number; pitch?: number; dist?: number }): void;
}

function isKind(v: string | null): v is TestKind {
  return v === 'water' || v === 'lava' || v === 'ice';
}

const mode: GalleryMode = {
  async build(host: GalleryHost) {
    const param = new URLSearchParams(location.search).get('liquid') ?? 'auto';
    const real = host.field.layout.liquid;
    const forced = isKind(param) ? param : null;
    let devRocks: readonly RockPlacement[] = [];
    let synthetic = false;
    if (forced || (param === 'auto' && !real)) {
      const kind = forced ?? host.biome.water?.kind ?? 'water';
      const realRocks = host.field.layout.rocks.length;
      host.field = withTestLiquid(host.field, kind);
      host.ctx.field = host.field;
      devRocks = host.field.layout.rocks.slice(realRocks);
      synthetic = true;
    }

    host.addSystem(createDevClock());
    const ground = createDebugGround(host.ctx);
    host.addSystem(ground);
    await dressGround(host.ctx, ground, devRocks);
    const liquid = createLiquid(host.ctx);
    if (liquid) host.addSystem(liquid);

    const lq = host.field.layout.liquid;
    const spots: TestSpot[] = synthetic && lq ? testSpots(lq.kind) : realSpots(host.field);
    const api: FluidsApi = {
      kind: lq?.kind ?? 'none',
      level: lq?.level ?? 0,
      synthetic,
      spots,
      go(name, cam = 'gameplay', opts) {
        const s = spots.find((v) => v.name === name);
        if (!s) throw new Error(`unknown spot ${name}; have ${spots.map((v) => v.name).join(', ')}`);
        const y = host.field.heightAt(s.x, s.z);
        if (cam === 'gameplay') {
          host.setCamera('gameplay');
          host.setHero(s.x, s.z);
        } else if (cam === 'wide') {
          host.setCamera('wide', { target: [s.x, y, s.z], dist: opts?.dist ?? 150, pitch: opts?.pitch ?? 0.5, yaw: opts?.yaw ?? 0.3 });
        } else {
          host.setCamera('orbit', { target: [s.x, y, s.z], dist: opts?.dist ?? 12, pitch: opts?.pitch ?? 0.35, yaw: opts?.yaw ?? 0.6, fov: 40 });
        }
      },
    };
    const gallery: unknown = Reflect.get(window, '__gallery');
    if (gallery && typeof gallery === 'object') Object.assign(gallery, { fluids: api });
  },
};
export default mode;
