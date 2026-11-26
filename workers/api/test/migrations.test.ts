import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { checkMigrations, emptyLock, parseLock, recordApplied, type MigrationFile } from '../scripts/migrationsLock';

const files: MigrationFile[] = env.TEST_MIGRATION_FILES;

describe('D1 migrations', () => {
  it('are named NNNN_snake_case.sql in gap-free order and no remotely applied one was edited, renamed or deleted', () => {
    const lock = parseLock(env.TEST_MIGRATIONS_LOCK);
    expect(lock.database).toBe('metin-survivors-db');
    expect(files.length).toBeGreaterThan(0);
    expect(checkMigrations(files, lock)).toEqual([]);
  });

  it('the lock check catches drift', () => {
    const a: MigrationFile = { name: '0001_init.sql', sha256: 'a'.repeat(64) };
    const b: MigrationFile = { name: '0002_more.sql', sha256: 'b'.repeat(64) };
    const applied = recordApplied(emptyLock('db'), [a], new Date('2026-10-13T00:00:00Z'));
    expect(checkMigrations([a, b], applied)).toEqual([]);
    // edited after apply
    expect(checkMigrations([{ ...a, sha256: 'c'.repeat(64) }, b], applied)[0]).toMatch(/edited after it was applied/);
    // renamed / deleted after apply
    expect(checkMigrations([{ ...a, name: '0001_initial.sql' }, b], applied).join('\n')).toMatch(/missing locally/);
    // naming and numbering
    expect(checkMigrations([a, { ...b, name: '0003_more.sql' }], applied)[0]).toMatch(/should be 0002/);
    expect(checkMigrations([a, { ...b, name: '0002-More.sql' }], applied)[0]).toMatch(/NNNN_snake_case/);
    // applied set must be a prefix
    const skipped = { database: 'db', applied: { '0002_more.sql': { sha256: b.sha256, appliedAt: 'x' } } };
    expect(checkMigrations([a, b], skipped).join('\n')).toMatch(/earlier migration is not/);
    // recording keeps the original apply time
    const later = recordApplied(applied, [a, b], new Date('2026-11-01T00:00:00Z'));
    expect(later.applied['0001_init.sql']?.appliedAt).toBe('2026-10-13T00:00:00.000Z');
    expect(later.applied['0002_more.sql']?.appliedAt).toBe('2026-11-01T00:00:00.000Z');
  });
});
