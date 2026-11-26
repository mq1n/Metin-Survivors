import type { BeetleParams } from '../../archetypes/arthropod/index.ts';
import { rgb } from '../../core/paint/painter.ts';

/** Frost beetle (Seori): domed translucent-looking elytra, crystal horns, a fan of faceted ice spikes on the back. */
export const rimeBeetle: BeetleParams = {
  id: 'rime_beetle',
  kind: 'creature',
  family: 'beetle',
  seed: 7702,
  scale: 1,
  bodyLength: 1,
  bodyWidth: 1,
  bodyHeight: 1,
  hornLength: 1,
  crystals: 7,
  crystalHeight: 0.92,
  mandible: 1,
  legThick: 1.12,
  stance: 1.35,
  palette: {
    deep: rgb('#14123e'),
    shell: rgb('#35318c'),
    cyan: rgb('#62cdf4'),
    frost: rgb('#eaf8ff'),
    crystal: rgb('#7fd0ff'),
    crystalTip: rgb('#f2feff'),
    belly: rgb('#171540'),
    leg: rgb('#2b2a7a'),
    accent: rgb('#ee8a2e'),
    claw: rgb('#f6e8c4'),
    eye: rgb('#ffc23a'),
    vein: rgb('#0c0a34'),
  },
};
