// Gallery mode "sky": debug ground + sky dome / backdrop. Owner: TerrainFluids.
// Automation: window.__gallery.skyView(name) with name = 'horizon' | 'sun' | 'back' | 'left' | 'right' | 'wide' | 'gameplay'
// (orbit cameras at the arena centre looking at the horizon; 'wide' = an establishing shot with the horizon mid-frame).
// `__gallery.hide('ground')` shows the sky alone.
import { createDevClock } from '../../liquid/devScene';
import { createSky } from '../../sky';
import { createDebugGround } from '../debugGround';
import type { GalleryHost, GalleryMode } from '../host';

/** orbit yaw (rad) of the camera: it looks along −(sin yaw, cos yaw) from the arena centre, so yaw 0 looks towards −Z */
const LOOK: Record<string, { yaw: number; pitch: number; dist: number; fov: number }> = {
  horizon: { yaw: 0, pitch: 0.06, dist: 24, fov: 55 },
  back: { yaw: Math.PI, pitch: 0.06, dist: 24, fov: 55 },
  left: { yaw: Math.PI / 2, pitch: 0.06, dist: 24, fov: 55 },
  right: { yaw: -Math.PI / 2, pitch: 0.06, dist: 24, fov: 55 },
};

const mode: GalleryMode = {
  build(host: GalleryHost) {
    host.addSystem(createDevClock());
    host.addSystem(createDebugGround(host.ctx));
    host.addSystem(createSky(host.ctx));
    const skyView = (name: string): void => {
      const target: [number, number, number] = [0, host.field.heightAt(0, 0) + 6, 0];
      if (name === 'gameplay') host.setCamera('gameplay');
      else if (name === 'wide') host.setCamera('wide', { target: [0, 14, -20], dist: 190, pitch: 0.2, fov: 55 });
      else if (name === 'sun') {
        const s = host.core.env.sunDir;
        host.setCamera('orbit', { yaw: Math.atan2(-s.x, -s.z), pitch: 0.06, dist: 24, fov: 55, target });
      } else {
        const l = LOOK[name];
        if (!l) throw new Error(`unknown sky view ${name}; have ${Object.keys(LOOK).join(', ')}, sun, wide, gameplay`);
        host.setCamera('orbit', { ...l, target });
      }
    };
    const gallery: unknown = Reflect.get(window, '__gallery');
    if (gallery && typeof gallery === 'object') Object.assign(gallery, { skyView });
  },
};
export default mode;
