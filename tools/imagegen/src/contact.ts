import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTACT, PY } from './paths';
import { readReport } from './post';
import { rawPath } from './runner';
import { loadReview } from './review';
import type { JobSpec } from './types';

export interface ContactOptions {
  name: string;
  cols?: number;
  cell?: number;
  perSheet?: number;
  /** show raw generations instead of built outputs */
  raw?: boolean;
}


export async function makeContacts(jobs: JobSpec[], opts: ContactOptions): Promise<string[]> {
  mkdirSync(CONTACT, { recursive: true });
  const review = loadReview();
  const items = jobs.flatMap((j) => {
    const report = opts.raw ? null : readReport(j.id);
    const path = report?.main ?? (existsSync(rawPath(j.id)) ? rawPath(j.id) : null);
    if (!path) return [];
    const seam = report?.tile?.final ? `seam ${report.tile.final.h}/${report.tile.final.v}` : '';
    const dims = report ? `${report.w}x${report.h} ${(report.bytes / 1024).toFixed(0)}K` : 'raw';
    return [{ id: j.id, path, label: `${dims} ${seam}`.trim(), status: review[j.id]?.status ?? 'pending', tiling: !!j.tiling && !opts.raw, alpha: report?.alpha ?? false }];
  });
  const per = opts.perSheet ?? 20;
  const outs: string[] = [];
  for (let i = 0, n = 1; i < items.length; i += per, n++) {
    const part = items.slice(i, i + per);
    const itemsFile = join(CONTACT, `.${opts.name}-${n}.json`);
    writeFileSync(itemsFile, JSON.stringify(part));
    const out = join(CONTACT, `${opts.name}-${n}.png`);
    const proc = Bun.spawn(['python', join(PY, 'contact.py'), out, itemsFile, String(opts.cols ?? 5), String(opts.cell ?? 256)], { stdout: 'pipe', stderr: 'pipe', windowsHide: true });
    const err = await new Response(proc.stderr).text();
    if ((await proc.exited) !== 0) throw new Error(`contact.py failed: ${err}`);
    outs.push(out);
  }
  return outs;
}
