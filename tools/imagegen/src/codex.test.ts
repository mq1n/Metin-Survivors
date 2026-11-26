import { describe, expect, test } from 'bun:test';
import { codexArgs, extractPaths, sessionPrompt, soloPrompt, type SessionJob } from './codex';
import { REF_ROLES } from './prompt';

describe('codexArgs', () => {
  test('no images: the verified exec line, prompt from stdin last', () => {
    expect(codexArgs({ effort: 'low', dir: 'D' })).toEqual(['exec', '-s', 'read-only', '--skip-git-repo-check', '--json', '-c', 'model_reasoning_effort=low', '-C', 'D', '-']);
  });

  test('one -i per reference, in order, after -m and before -C (which ends the multi-value -i list)', () => {
    const a = codexArgs({ effort: 'medium', model: 'm1', images: ['C:/r/one.png', 'C:/r/two.png'], dir: 'C:/s' });
    expect(a).toEqual(['exec', '-s', 'read-only', '--skip-git-repo-check', '--json', '-c', 'model_reasoning_effort=medium', '-m', 'm1', '-i', 'C:/r/one.png', '-i', 'C:/r/two.png', '-C', 'C:/s', '-']);
    expect(a.at(-1)).toBe('-');
    expect(a.indexOf('-C')).toBeGreaterThan(a.lastIndexOf('-i'));
  });
});

describe('soloPrompt / sessionPrompt', () => {
  const refJob: SessionJob = {
    id: 'vfx_a',
    prompt: 'Goal: swirl\nAsset type: x',
    refs: [{ path: 'C:/r/one.png' }, { path: 'C:/r/ctx.png', role: 'context' }],
  };

  test('solo message: skill line, attached-image roles in Image 1..n order, prompt, reply format', () => {
    const p = soloPrompt(refJob);
    const lines = p.split('\n');
    expect(lines[0]).toBe('Use the $imagegen skill (built-in image_gen tool). Call image_gen EXACTLY ONCE.');
    expect(p).toContain(`Attached images:\n- Image 1 = ${REF_ROLES.texture}.\n- Image 2 = ${REF_ROLES.context}.\n`);
    expect(p).toContain('\nGoal: swirl\nAsset type: x\n');
    expect(lines.at(-1)).toBe('After the call reply with ONLY one single-line JSON: {"vfx_a": "<absolute path of the generated image>"}');
  });

  test('transparent jobs ask the tool for a real alpha channel; no refs → no attached-images block', () => {
    const p = soloPrompt({ id: 'smoke', prompt: 'Goal: smoke', transparent: true });
    expect(p.split('\n')[0]).toBe('Use the $imagegen skill (built-in image_gen tool). Call image_gen EXACTLY ONCE and request a transparent background from the tool (real alpha channel).');
    expect(p).not.toContain('Attached images');
  });

  test('plain jobs keep the batch form; a ref job is solo; a ref job inside a batch is an error', () => {
    const batch = sessionPrompt([
      { id: 'a', prompt: 'pa' },
      { id: 'b', prompt: 'pb' },
    ]);
    expect(batch.startsWith('You are an image batch worker.')).toBe(true);
    expect(batch).toContain('JOB a:\npa\n');
    expect(batch).toContain('JOB b:\npb\n');
    expect(sessionPrompt([refJob])).toBe(soloPrompt(refJob));
    expect(() => sessionPrompt([refJob, { id: 'b', prompt: 'pb' }])).toThrow(/run alone/);
  });
});

describe('extractPaths', () => {
  test('reads the final agent message of the verified pilot run', () => {
    const text = '{"tex":"C:\\\\Users\\\\Koray\\\\.codex\\\\generated_images\\\\01a1\\\\exec-9c82.png"}';
    expect(extractPaths(text, ['tex'])).toEqual({ tex: 'C:\\Users\\Koray\\.codex\\generated_images\\01a1\\exec-9c82.png' });
  });
  test('tolerates unescaped backslashes and missing ids', () => {
    const text = 'done: {"a": "C:\\x\\y.png", "b": null}';
    const out = extractPaths(text, ['a', 'b', 'c']);
    expect(out.a).toBe('C:\\x\\y.png');
    expect(out.b).toBeUndefined();
    expect(out.c).toBeUndefined();
  });
});
