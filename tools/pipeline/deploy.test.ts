import { describe, expect, test } from 'bun:test';
import { assertPreviewPagesResult, NAMES, parseArgs } from '../../scripts/deploy';

describe('scripts/deploy preview guards (TOOL-10)', () => {
  test('rejects --preview when --branch targets main or master', () => {
    expect(() => parseArgs(['--preview', '--branch', 'main'])).toThrow(/cannot target production branch/i);
    expect(() => parseArgs(['--preview', '--branch=master'])).toThrow(/cannot target production branch/i);
    expect(() => parseArgs(['--preview', '--branch', 'MAIN'])).toThrow(/cannot target production branch/i);
  });

  test('defaults --preview without --branch to a safe non-production branch even when on main or PAGES_BRANCH=main', () => {
    const onMain = parseArgs(['--preview'], {
      env: { PAGES_BRANCH: 'main' },
      currentGitBranch: () => 'main',
    });
    expect(onMain.preview).toBe(true);
    expect(onMain.branch).toBe('preview');

    const onDetached = parseArgs(['--preview'], {
      env: {},
      currentGitBranch: () => 'HEAD',
    });
    expect(onDetached.branch).toBe('preview');

    const onFeature = parseArgs(['--preview'], {
      env: { PAGES_BRANCH: 'main' },
      currentGitBranch: () => 'feat/preview-smoke',
    });
    expect(onFeature.branch).toBe('feat/preview-smoke');
  });

  test('accepts explicit non-production --branch with --preview', () => {
    const opts = parseArgs(['--preview', '--branch', 'staging-rc1'], {
      env: {},
      currentGitBranch: () => 'main',
    });
    expect(opts.preview).toBe(true);
    expect(opts.branch).toBe('staging-rc1');
  });

  test('verifies Cloudflare Pages preview deployment URL is a preview alias and never bare production', () => {
    // Valid preview alias
    expect(
      assertPreviewPagesResult(
        {
          environment: 'preview',
          productionBranch: 'main',
          url: 'https://abc123.metin-survivors.pages.dev',
          alias: 'https://staging-rc1.metin-survivors.pages.dev',
        },
        'staging-rc1',
      ),
    ).toBe('https://staging-rc1.metin-survivors.pages.dev');

    // Valid hash preview URL when alias is omitted
    expect(
      assertPreviewPagesResult(
        {
          environment: 'preview',
          productionBranch: 'main',
          url: 'https://deadbeef.metin-survivors.pages.dev',
        },
        'preview',
      ),
    ).toBe('https://deadbeef.metin-survivors.pages.dev');

    // Reject production environment
    expect(() =>
      assertPreviewPagesResult(
        {
          environment: 'production',
          productionBranch: 'main',
          url: 'https://abc123.metin-survivors.pages.dev',
        },
        'preview',
      ),
    ).toThrow(/not "preview"/i);

    // Reject branch matching project's configured productionBranch
    expect(() =>
      assertPreviewPagesResult(
        {
          environment: 'preview',
          productionBranch: 'release',
          url: 'https://release.metin-survivors.pages.dev',
        },
        'release',
      ),
    ).toThrow(/matches the Pages project's production branch/i);

    // Reject bare production origin
    expect(() =>
      assertPreviewPagesResult(
        {
          environment: 'preview',
          productionBranch: 'main',
          alias: NAMES.pagesOrigin,
        },
        'preview',
      ),
    ).toThrow(/production domain/i);

    // Reject missing deployment URL
    expect(() =>
      assertPreviewPagesResult({ environment: 'preview', productionBranch: 'main' }, 'preview'),
    ).toThrow(/did not return a preview deployment URL/i);
  });
});
