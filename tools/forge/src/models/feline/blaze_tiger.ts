import type { FelineParams } from '../../archetypes/feline/index.ts';
import { rgb } from '../../core/paint/painter.ts';






export const blazeTiger: FelineParams = {
  id: 'blaze_tiger',
  kind: 'creature',
  seed: 2201,
  scale: 0.98,
  bodyLength: 0.84,
  chestDepth: 1.2,
  chestWidth: 1.3,
  shoulderRise: 2,
  crouch: 0.75,
  legLength: 1,
  legThick: 1.4,
  paw: 1.5,
  claws: 1.3,
  headScale: 1.9,
  skullWidth: 1.15,
  muzzleLength: 0.72,
  muzzleWidth: 1.15,
  fangs: 1.5,
  brow: 1.6,
  neckThick: 1.4,
  neckLength: 0.85,
  earSize: 0.75,
  tailLength: 0.9,
  tailThick: 0.95,
  tailCurl: 0.15,
  cheekRuff: 1,
  mane: 1.0,
  maneStyle: 'flame',
  ridge: 'ember',
  horns: 0.5,
  regalia: false,
  plates: true,
  pattern: 'ember',
  palette: {
    coat: rgb('#3a302b'),
    coatLight: rgb('#5a4a42'),
    coatDark: rgb('#1d1715'),
    light: rgb('#2c2421'),
    stripe: rgb('#120d0b'),
    accent: rgb('#ff5a14'),
    accentHot: rgb('#ffd45a'),
    nose: rgb('#2a1a18'),
    eye: rgb('#ffb21c'),
    mouth: rgb('#d0402a'),
    inner: rgb('#6a2f22'),
    claw: rgb('#d8c8a8'),
    horn: rgb('#463a35'),
  },
};
