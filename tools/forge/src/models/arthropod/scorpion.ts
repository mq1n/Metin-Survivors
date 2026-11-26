import type { ScorpionParams } from '../../archetypes/arthropod/index.ts';
import { rgb } from '../../core/paint/painter.ts';

/** Desert King Scorpion (Suryeon): flat dark-maroon plated body, arched tail with a crimson stinger, two big pincers, eight spined legs. */
export const scorpion: ScorpionParams = {
  id: 'scorpion',
  kind: 'creature',
  family: 'scorpion',
  seed: 4401,
  scale: 0.9,
  bodyWidth: 1,
  bodyLength: 1,
  tailLength: 1.15,
  tailArch: 0.8,
  tailThick: 1.1,
  clawSize: 1,
  clawOpen: 0.5,
  legThick: 1,
  stance: 1,
  spines: 1,
  palette: {
    chitin: rgb('#4f1519'),
    light: rgb('#8c3030'),
    dark: rgb('#1f080c'),
    edge: rgb('#0e0409'),
    joint: rgb('#d0902e'),
    belly: rgb('#b88a62'),
    tail: rgb('#5c1a1a'),
    sting: rgb('#9a2a1c'),
    stingTip: rgb('#1a0608'),
    claw: rgb('#2a1218'),
    eye: rgb('#0a0709'),
  },
};
