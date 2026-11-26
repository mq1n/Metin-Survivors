import { type FoxWarriorParams } from '../../archetypes/foxwarrior/index.ts';


export const miho: FoxWarriorParams = {
  tails: { count: 9, length: 1.05, thick: 0.82, furMat: 'fur', tipMat: 'fur2' },
  humanoid: {
    id: 'miho', kind: 'boss', seed: 'miho', sex: 'm', bodyHeight: 2.25, head: 'wolf',
    build: { shoulder: 1.2, chest: 1.1, waist: 0.85, hips: 0.92, arms: 1.05, forearms: 1.1, legs: 1.0, calves: 1.0, neck: 1.0, hands: 1.4, feet: 1.3, head: 1.3, legLength: 1.1, armLength: 1.18, muscle: 0.95, lean: 0.2, headForward: 0.04, stance: 1.1 },
    face: { ears: 2.0, jaw: 0.3, brow: 0.5 },
    skin: { base: '#ece6da', shade: '#a8a196', lip: '#6c4a47', eye: '#ffcf3d', brow: '#4a443d' },
    hair: { style: 'wolf', color: '#f3eee4' },
    outfit: [
      { id: 'trousers', mat: 'cloth', o: { baggy: 0.35 } },
      { id: 'sash', mat: 'rope' },
      { id: 'vambrace', mat: 'rope' },
    ],
    palette: { fur: '#f1ece1', fur2: '#aeeaff', cloth: '#ddd6c6', rope: '#d9892a', gold: '#c9a13a' },
    style: 'claw',
    glow: { color: '#62d4ff', tags: [] },
    tris: 14800, voxel: 0.0058, texture: 1024,
  },
};
