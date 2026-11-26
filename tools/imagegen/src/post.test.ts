import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { PY } from './paths';

// The VFX post ops live in py/post.py; their self-checks (synthetic images, exact assertions) run here so that
// `bun test` covers both halves of the pipeline.
test('py/post.py VFX ops (py/test_post.py)', () => {
  const r = Bun.spawnSync(['python', join(PY, 'test_post.py')], { stdout: 'pipe', stderr: 'pipe', windowsHide: true });
  const out = `${r.stdout.toString()}\n${r.stderr.toString()}`;
  if (r.exitCode !== 0) console.error(out);
  expect(r.exitCode).toBe(0);
  expect(out).toContain('post.py checks passed');
}, 60_000);
