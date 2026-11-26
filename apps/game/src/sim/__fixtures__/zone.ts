// Fixture zone: 'fx_plains' — 15-minute run, five ramping time bands, two boss slots, Great Metin + final boss.
// Every band lists its own spawn entry objects (no shared references), so a test mutating one band's
// weights on a cloneContent() copy cannot leak into another band.

import type { TimeBand, ZoneDef } from '../../data/schema';
import { t } from './helpers';

export const FIXTURE_ZONE_ID = 'fx_plains';

const bands: TimeBand[] = [
  {
    from: 0,
    to: 120,
    rate: 2.2,
    maxAlive: 70,
    spawns: [
      { enemy: 'wolf', weight: 5 },
      { enemy: 'wolf', weight: 2, group: { members: ['wolf'], size: [3, 5] } },
      { enemy: 'jackal', weight: 3, group: { members: ['jackal'], size: [8, 14] } },
    ],
  },
  {
    from: 120,
    to: 300,
    rate: 4,
    maxAlive: 140,
    spawns: [
      { enemy: 'wolf', weight: 5 },
      { enemy: 'wolf', weight: 1, group: { leader: 'alpha_wolf', members: ['wolf'], size: [4, 7] } },
      { enemy: 'jackal', weight: 3, group: { members: ['jackal'], size: [8, 14] } },
      { enemy: 'spitter', weight: 2 },
      { enemy: 'boar_charger', weight: 1.5 },
    ],
    elites: { every: 60, pool: ['alpha_wolf'] },
  },
  {
    from: 300,
    to: 540,
    rate: 6.5,
    maxAlive: 260,
    spawns: [
      { enemy: 'wolf', weight: 4 },
      { enemy: 'wolf', weight: 1.5, group: { leader: 'alpha_wolf', members: ['wolf'], size: [4, 7] } },
      { enemy: 'jackal', weight: 3, group: { members: ['jackal'], size: [8, 14] } },
      { enemy: 'spitter', weight: 2 },
      { enemy: 'boar_charger', weight: 2 },
      { enemy: 'bear', weight: 1.5 },
      { enemy: 'fox', weight: 3 },
      { enemy: 'bomb_imp', weight: 2, group: { members: ['bomb_imp'], size: [3, 6] } },
    ],
    elites: { every: 50, pool: ['alpha_wolf', 'elder_bear'] },
  },
  {
    from: 540,
    to: 780,
    rate: 9,
    maxAlive: 400,
    spawns: [
      { enemy: 'wolf', weight: 3 },
      { enemy: 'wolf', weight: 1.5, group: { leader: 'alpha_wolf', members: ['wolf'], size: [4, 7] } },
      { enemy: 'jackal', weight: 2.5, group: { members: ['jackal'], size: [8, 14] } },
      { enemy: 'spitter', weight: 2 },
      { enemy: 'boar_charger', weight: 2 },
      { enemy: 'bear', weight: 2 },
      { enemy: 'fox', weight: 3 },
      { enemy: 'bomb_imp', weight: 2, group: { members: ['bomb_imp'], size: [3, 6] } },
      { enemy: 'plague_rat', weight: 3 },
      { enemy: 'ember_lizard', weight: 2 },
    ],
    elites: { every: 40, pool: ['alpha_wolf', 'elder_bear'] },
  },
  {
    from: 780,
    to: 900,
    rate: 12,
    maxAlive: 520,
    spawns: [
      { enemy: 'wolf', weight: 3 },
      { enemy: 'wolf', weight: 2, group: { members: ['wolf'], size: [3, 5] } },
      { enemy: 'wolf', weight: 2, group: { leader: 'alpha_wolf', members: ['wolf'], size: [4, 7] } },
      { enemy: 'jackal', weight: 3, group: { members: ['jackal'], size: [8, 14] } },
      { enemy: 'spitter', weight: 2 },
      { enemy: 'boar_charger', weight: 2 },
      { enemy: 'bear', weight: 2.5 },
      { enemy: 'fox', weight: 3 },
      { enemy: 'bomb_imp', weight: 3, group: { members: ['bomb_imp'], size: [3, 6] } },
      { enemy: 'plague_rat', weight: 3 },
      { enemy: 'ember_lizard', weight: 2.5 },
    ],
    elites: { every: 30, pool: ['alpha_wolf', 'elder_bear'] },
  },
];

export const fixtureZone: ZoneDef = {
  id: FIXTURE_ZONE_ID,
  order: 1,
  name: t('Yeonmu Ovası', 'Yeonmu Plains'),
  subtitle: t('Metin taşlarının ilk düştüğü topraklar', 'Where the first Metin stones fell'),
  levelRange: [1, 60],
  story: {
    intro: [
      t(
        'Gökyüzü yarıldı ve ilk Metin taşları Yeonmu Ovası\u2019na yağdı.',
        'The sky split open, and the first Metin stones rained down on the Yeonmu Plains.',
      ),
      t(
        'Gök Hükümdarı, seni yağmurun kaynağına doğru yürümeye çağırıyor.',
        'The Sky Sovereign calls you to march toward the source of the rain.',
      ),
    ],
    bossIntro: t(
      'Otlar titriyor. Yağmurun yarattığı bir canavar yaklaşıyor.',
      'The grass trembles. A beast born of the rain is approaching.',
    ),
    victory: [
      t(
        'Büyük Metin parçalandı ve Yeonmu Ovası\u2019nda sessizlik çöktü.',
        'The Great Metin is shattered, and silence settles over the Yeonmu Plains.',
      ),
    ],
    defeat: [
      t(
        'Gözlerin kararırken Metin taşlarının uğultusu kulaklarında yankılanıyor.',
        'As your vision fades, the hum of the Metin stones echoes in your ears.',
      ),
    ],
  },
  biome: {
    id: 'plains_dawn',
    seed: 7101,
    ground: ['tex_grass_lush', 'tex_grass_dry', 'tex_dirt_path', 'tex_rock_gray'],
    trees: ['tree_pine_a', 'tree_oak_b', 'tree_dead_c'],
    props: ['prop_stone_lantern', 'prop_boulder_a', 'prop_grass_tuft', 'prop_wooden_fence'],
    fog: { color: '#b8c9a3', near: 40, far: 180 },
    sky: { top: '#5b8fd1', horizon: '#d9e4c3', bottom: '#f2e8c9' },
    sun: { color: '#fff1cf', intensity: 2.4, dir: [-0.5, -1, -0.35] },
    ambient: { sky: '#a9c7ee', ground: '#6b5a3a', intensity: 0.7 },
    water: { level: -1.5, color: '#3e7fa8', kind: 'water' },
    relief: { height: 6, roughness: 0.45, features: ['hills', 'ridge', 'pond'] },
    particles: 'leaves',
  },
  music: { calm: 'music_plains_calm', combat: 'music_plains_combat', boss: 'music_boss_theme' },
  bands,
  bosses: [
    { at: 180, boss: 'boss_horyeong' },
    { at: 480, boss: 'boss_ork_chief' },
  ],
  final: { at: 900, boss: 'boss_scarlet_wyrm', greatMetin: 'metin_great' },
  metins: { types: ['metin_lament', 'metin_avarice'], firstAt: 60, interval: [60, 75] },
  gearTier: 1,
  art: 'art_zone_fx_plains',
};
