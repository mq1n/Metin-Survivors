import type { D1Migration } from '@cloudflare/vitest-plugin/types';
import type { MigrationFile } from './scripts/migrationsLock';

// Test-only typings: migrations injected by vitest.config.ts and the main module for `exports.default`.
declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof import('./src/index');
    }
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
      /** every migrations/*.sql with its normalised sha256 */
      TEST_MIGRATION_FILES: MigrationFile[];
      /** raw text of migrations.lock.json */
      TEST_MIGRATIONS_LOCK: string;
    }
  }
}
export {};
