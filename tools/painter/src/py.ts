// Run the python stages (numpy/cv2/PIL) and return their last JSON line.
import { PY } from './paths.ts';
import { join } from 'node:path';

export async function runPy(args: string[], log: (s: string) => void = console.log): Promise<Record<string, unknown>> {
  const proc = Bun.spawn(['python', join(PY, 'main.py'), ...args], { stdout: 'pipe', stderr: 'pipe', windowsHide: true });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  if (code !== 0) throw new Error(`python ${args[0]} failed (${code}):\n${err}\n${out}`);
  if (err.trim()) log(err.trim());
  const lines = out.trim().split(/\r?\n/);
  for (const l of lines.slice(0, -1)) log(l);
  try {
    return JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
  } catch {
    return {};
  }
}
