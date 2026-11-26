// D1 migrations lock. Wrangler records applied migrations by FILE NAME only (the remote `d1_migrations` table), so
// editing, renaming or deleting a migration that already ran on the production database silently forks production from
// the code (the edit never runs; a rename runs twice). `migrations.lock.json` lists every migration applied to the REMOTE
// database together with the sha256 of its (line-ending normalised) text; `bun run deploy` writes it right after
// `wrangler d1 migrations apply --remote` and refuses to deploy on drift, and the test suite enforces it on every run.
// Until a migration is listed it may still be edited in place (pre-release decision, docs/PLAN.md 2026-10-13).
//
// Pure module (no node:* imports): the Workers test pool imports it too.

export interface MigrationFile {
  name: string;
  sha256: string;
}

export interface AppliedMigration {
  sha256: string;
  /** ISO time of the deploy that applied it */
  appliedAt: string;
}

export interface MigrationsLock {
  database: string;
  applied: Record<string, AppliedMigration>;
}

/** `0003_add_index.sql`: four-digit sequence number, lower-case snake name. */
export const MIGRATION_NAME = /^(\d{4})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;

/** Byte order (not locale order): the order wrangler applies migrations in. */
function nameOrder(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

export function normalizeSql(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

export async function sha256Text(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let hex = '';
  for (const b of digest) hex += b.toString(16).padStart(2, '0');
  return hex;
}

export async function migrationFile(name: string, text: string): Promise<MigrationFile> {
  return { name, sha256: await sha256Text(normalizeSql(text)) };
}

export function emptyLock(database: string): MigrationsLock {
  return { database, applied: {} };
}

export function parseLock(json: string): MigrationsLock {
  const v = JSON.parse(json) as Partial<MigrationsLock>;
  if (typeof v.database !== 'string' || typeof v.applied !== 'object' || v.applied === null) {
    throw new Error('migrations.lock.json: expected { database, applied }');
  }
  return { database: v.database, applied: v.applied };
}

/** Every problem with the migration set; empty = good. `files` = the *.sql files of the migrations dir. */
export function checkMigrations(files: readonly MigrationFile[], lock: MigrationsLock): string[] {
  const problems: string[] = [];
  const sorted = [...files].sort(nameOrder);
  const byName = new Map(sorted.map((f) => [f.name, f]));
  sorted.forEach((f, i) => {
    const m = MIGRATION_NAME.exec(f.name);
    if (!m) {
      problems.push(`${f.name}: migration files must be named NNNN_snake_case.sql`);
      return;
    }
    if (Number(m[1]) !== i + 1) problems.push(`${f.name}: sequence number ${m[1]} should be ${String(i + 1).padStart(4, '0')} (no gaps, no duplicates)`);
  });
  for (const [name, applied] of Object.entries(lock.applied)) {
    const file = byName.get(name);
    if (!file) {
      problems.push(`${name}: applied to the remote database but missing locally (renamed or deleted) — restore it and add a new migration instead`);
      continue;
    }
    if (file.sha256 !== applied.sha256) {
      problems.push(`${name}: edited after it was applied to the remote database (${applied.appliedAt}) — revert it and put the change in a new migration`);
    }
  }
  // applied migrations must be a prefix of the ordered list (wrangler applies in order)
  let gap = false;
  for (const f of sorted) {
    if (!(f.name in lock.applied)) gap = true;
    else if (gap) problems.push(`${f.name}: recorded as applied although an earlier migration is not`);
  }
  return problems;
}

/** Lock after a successful remote apply: every current file is now applied (already listed ones keep their time). */
export function recordApplied(lock: MigrationsLock, files: readonly MigrationFile[], now: Date): MigrationsLock {
  const applied: Record<string, AppliedMigration> = { ...lock.applied };
  for (const f of [...files].sort(nameOrder)) {
    if (!applied[f.name]) applied[f.name] = { sha256: f.sha256, appliedAt: now.toISOString() };
  }
  return { database: lock.database, applied };
}
