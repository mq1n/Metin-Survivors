// Gallery mode "all": the full zone scene exactly as the game builds it (render/terrain/zoneScene.ts).
import { createZoneScene } from '../../zoneScene';
import type { GalleryMode } from '../host';

const mode: GalleryMode = {
  build(host) {
    const zs = createZoneScene(host.core, host.field, host.biome);
    for (const s of zs.systems) host.addSystem(s);
  },
};
export default mode;
