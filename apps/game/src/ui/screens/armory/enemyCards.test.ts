// The Codex and Drop Tables draw `icon_enemy_<id>` for every enemy and boss (the baked-portrait atlas that used to stand in for a
// missing card is gone): every content id must keep a shipped card, and so must the locked-entry card back.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const gameRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(resolve(gameRoot, rel), 'utf8')) as T;

const icons = readJson<Record<string, { url: string }>>('public/assets/manifest/icons.json');
const ids = [...readJson<{ id: string }[]>('src/data/content/enemies.json'), ...readJson<{ id: string }[]>('src/data/content/bosses.json')].map((d) => d.id);

describe('armory creature cards', () => {
  it('reads the content and the icon manifest', () => {
    expect(ids.length).toBeGreaterThan(100);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(icons).length).toBeGreaterThan(100);
  });
  it('ships an icon_enemy_<id> card (manifest entry and file) for every enemy and boss', () => {
    const missing = ids.filter((id) => {
      const card = icons[`icon_enemy_${id}`];
      return !card || !existsSync(resolve(gameRoot, 'public', card.url));
    });
    expect(missing).toEqual([]);
  });
  it('ships the locked-entry card back', () => {
    const back = icons['icon_enemy_unknown'];
    expect(back).toBeDefined();
    expect(existsSync(resolve(gameRoot, 'public', back?.url ?? 'missing'))).toBe(true);
  });
});
