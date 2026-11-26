import { rgb } from '../../core/paint/painter.ts';
import type { BoarParams } from '../../archetypes/boar/index.ts';





export const boar: BoarParams = {
  id: 'boar',
  kind: 'creature',
  seed: 108,
  scale: 1,
  tusk: 1,
  mane: 1,
  palette: {
    hide: rgb('#614b3a'),
    dark: rgb('#35291f'),
    belly: rgb('#a8937a'),
    mane: rgb('#f0bd55'),
    tip: rgb('#fbe9a8'),
    rust: rgb('#c4651c'),
    ridge: rgb('#2f1c12'),
    cheek: rgb('#8f7458'),
    snout: rgb('#5d4640'),
    nostril: rgb('#140e0c'),
    hoof: rgb('#e6dbc0'),
    hoofDark: rgb('#3d332b'),
    tusk: rgb('#faf4e4'),
    eye: rgb('#f2c64e'),
    mouth: rgb('#7a2a32'),
    inner: rgb('#8a6a62'),
  },
};
