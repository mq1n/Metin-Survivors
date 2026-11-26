import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { migrationFile } from './scripts/migrationsLock.ts';

export default defineConfig(async () => {
  const dir = path.join(import.meta.dirname, 'migrations');
  const migrations = await readD1Migrations(dir);
  // raw migration texts + the remote-apply lock, checked by test/migrations.test.ts (the Workers pool has no file system)
  const files = await Promise.all(
    readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => migrationFile(f, readFileSync(path.join(dir, f), 'utf8'))),
  );
  const lock = readFileSync(path.join(import.meta.dirname, 'migrations.lock.json'), 'utf8');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            TEST_MIGRATION_FILES: files.map((f) => ({ name: f.name, sha256: f.sha256 })),
            TEST_MIGRATIONS_LOCK: lock,
            LEADERBOARD_EDGE_CACHE_SEC: '0',
          },
        },
      }),
    ],
    test: {
      testTimeout: 30_000,
      setupFiles: ['./test/setup.ts'],
      include: ['test/**/*.test.ts'],
    },
  };
});
