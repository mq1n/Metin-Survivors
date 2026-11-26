// Gallery mode "terrain": the terrain system alone (+ sky when it exists). Owner: Terrain.
import { createSky } from '../../sky';
import { createTerrain } from '../../terrain';
import type { GalleryMode } from '../host';

const mode: GalleryMode = {
  build(host) {
    host.addSystem(createSky(host.ctx));
    host.addSystem(createTerrain(host.ctx));
  },
};
export default mode;
