import type { DragonParams } from '../../archetypes/dragon/index.ts';
import { rgb } from '../../core/paint/painter.ts';


export const scarletWyrm: DragonParams = {
  id: 'scarlet_wyrm',
  kind: 'boss',
  seed: 2291,
  scale: 1,
  voxel: 0.035,
  tris: 14500,
  texture: 2048,
  radius: 2.6,
  palette: {
    scaleDark: rgb('#2b0606'),
    scale: rgb('#85160f'),
    scaleLight: rgb('#bb3a1c'),
    gold: rgb('#c58a2c'),
    belly: rgb('#a9733a'),
    hornDark: rgb('#2a1710'),
    hornTip: rgb('#e6d6b0'),
    claw: rgb('#e4d8b8'),
    tooth: rgb('#efe6cc'),
    membrane: rgb('#4a0a0c'),
    membraneEdge: rgb('#9a2c16'),
    bone: rgb('#5e1a12'),
    eye: rgb('#ffc838'),
    mouth: rgb('#c4421c'),
    ember: rgb('#ff5a14'),
    heat: rgb('#ffd060'),
  },
};
