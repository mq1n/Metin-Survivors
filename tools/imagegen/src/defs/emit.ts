#!/usr/bin/env bun
// Emit the TS job definitions as JSONL under tools/imagegen/jobs/ (the runner only reads JSONL/JSON).
//   bun src/defs/emit.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JOBS_DIR } from '../paths';
import type { JobSpec } from '../types';
import { barkJobs, foliageJobs } from './foliage';
import { propJobs, weaponJobs } from './materials';
import { metinJobs, sigilJobs } from './metin';
import { portraitJobs } from './portraits';
import { terrainJobs } from './terrain';
import { uiJobs } from './ui';

const FILES: Record<string, JobSpec[]> = {
  '01_terrain.jsonl': terrainJobs,
  '02_foliage.jsonl': foliageJobs,
  '03_bark.jsonl': barkJobs,
  '04_metin.jsonl': [...metinJobs, ...sigilJobs],
  '05_ui.jsonl': uiJobs,
  '06_portraits.jsonl': portraitJobs,
  '07_weapon_materials.jsonl': weaponJobs,
  '08_prop_materials.jsonl': propJobs,
};

mkdirSync(JOBS_DIR, { recursive: true });
const seen = new Set<string>();
for (const [file, jobs] of Object.entries(FILES)) {
  for (const j of jobs) {
    if (seen.has(j.id)) throw new Error(`duplicate job id ${j.id}`);
    seen.add(j.id);
  }
  writeFileSync(join(JOBS_DIR, file), jobs.map((j) => JSON.stringify(j)).join('\n') + '\n');
  console.log(`${file}: ${jobs.length} jobs`);
}
