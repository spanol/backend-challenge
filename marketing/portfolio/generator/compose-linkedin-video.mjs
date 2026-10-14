import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const portfolio = join(fileURLToPath(new URL('..', import.meta.url)));
const project = join(portfolio, 'remotion');

for (const script of ['prepare:linkedin', 'render:linkedin']) {
  const result = spawnSync('bun', ['run', script], { cwd: project, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(join(portfolio, 'videos', 'processador-masterpiece-linkedin-remotion.mp4'));
