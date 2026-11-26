import type { UrsineParams } from '../../archetypes/ursine/index.ts';
import { rgb } from '../../core/paint/painter.ts';


export const bear: UrsineParams = {
  id: 'bear',
  kind: 'creature',
  seed: 110,
  scale: 1,
  bodyLength: 1,
  girth: 1,
  hump: 1,
  legLength: 1,
  legThick: 1,
  paw: 1,
  claw: 1,
  headScale: 1.15,
  snoutLength: 1,
  earSize: 1.15,
  tailLength: 1,
  fur: 1,
  palette: {
    back: rgb('#4f3320'),
    flank: rgb('#795431'),
    light: rgb('#a8804f'),
    tip: rgb('#dcb068'),
    dark: rgb('#2f1d12'),
    muzzle: rgb('#c9a679'),
    nose: rgb('#17110f'),
    eye: rgb('#d9921f'),
    mouth: rgb('#a63f45'),
    inner: rgb('#8a6a58'),
    claw: rgb('#e0d6bb'),
  },
};
