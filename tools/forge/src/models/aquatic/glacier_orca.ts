import type { AquaticParams } from '../../archetypes/aquatic/index.ts';
import { rgb } from '../../core/paint/painter.ts';


export const glacierOrca: AquaticParams = {
  id: 'glacier_orca',
  kind: 'creature',
  seed: 1102,
  scale: 1,
  finSpan: 1,
  horn: 1,
  crest: 1,
  crust: 1,
  gape: 0.45,
  palette: {
    back: rgb('#26375b'),
    flank: rgb('#3d5f8e'),
    belly: rgb('#dcebf3'),
    crust: rgb('#a5c3da'),
    crustHi: rgb('#e4f3fc'),
    crustLo: rgb('#3c6490'),
    iceLo: rgb('#2c6fb4'),
    iceMid: rgb('#74c6f0'),
    iceHi: rgb('#effcff'),
    tooth: rgb('#efe8d2'),
    gum: rgb('#b0404f'),
    mouth: rgb('#8a2230'),
    tongue: rgb('#d4525f'),
    ember: rgb('#e8532a'),
    eye: rgb('#ffb12e'),
  },
};
