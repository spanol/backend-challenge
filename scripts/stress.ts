import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { newId } from '../src/application/contracts';

const profile = process.env.STRESS_PROFILE ?? 'comparison';
const baseUrl = process.env.LOAD_BASE_URL;

if (!baseUrl) throw new Error('Set LOAD_BASE_URL to the dedicated test application');
if (!['comparison', 'heavy', 'server'].includes(profile)) throw new Error('Invalid stress profile');

const comparison = [
  { name: 'baseline', requests: 300, concurrency: 8, wallets: 12 },
  { name: 'distributed-16', requests: 2000, concurrency: 16, wallets: 64 },
  { name: 'distributed-32', requests: 5000, concurrency: 32, wallets: 64 },
  { name: 'distributed-64', requests: 5000, concurrency: 64, wallets: 64 },
  { name: 'hot-wallet-16', requests: 1000, concurrency: 16, wallets: 1 },
];
const phases =
  profile === 'heavy'
    ? [
        ...comparison,
        { name: 'distributed-128', requests: 10000, concurrency: 128, wallets: 128 },
        { name: 'distributed-256', requests: 10000, concurrency: 256, wallets: 128 },
        { name: 'hot-wallet-48', requests: 3000, concurrency: 48, wallets: 1 },
      ]
    : comparison;
const id = `stress-${profile}-${Date.now()}-${newId().slice(0, 8)}`;
const output = fileURLToPath(new URL(`../test-results/${id}/`, import.meta.url));
const loadScript = fileURLToPath(new URL('./load.ts', import.meta.url));
const results: {
  name: string;
  exitCode: number;
  report: string;
  startedAt: string;
  completedAt: string;
}[] = [];

await mkdir(output, { recursive: true });
console.log(JSON.stringify({ event: 'stress_started', profile, baseUrl, output }));

for (const phase of phases) {
  const folder = `${output}/${phase.name}`;

  await mkdir(folder, { recursive: true });

  const startedAt = new Date().toISOString();
  const child = Bun.spawn([process.execPath, loadScript], {
    cwd: folder,
    env: {
      ...process.env,
      LOAD_BASE_URL: baseUrl,
      LOAD_REQUESTS: String(phase.requests),
      LOAD_CONCURRENCY: String(phase.concurrency),
      LOAD_WALLETS: String(phase.wallets),
      LOAD_DRAIN_TIMEOUT_SECONDS: process.env.LOAD_DRAIN_TIMEOUT_SECONDS ?? '600',
    },
    stdout: Bun.file(`${folder}/console.log`),
    stderr: 'inherit',
  });

  const stop = () => child.kill('SIGTERM');

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  const exitCode = await child.exited;

  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
  results.push({
    name: phase.name,
    exitCode,
    report: `${phase.name}/test-results/load.json`,
    startedAt,
    completedAt: new Date().toISOString(),
  });
  await Bun.write(
    `${output}/stress.json`,
    JSON.stringify({ id, profile, baseUrl, phases, results }, null, 2),
  );
  console.log(JSON.stringify({ event: 'stress_phase_completed', ...results.at(-1) }));

  if (exitCode !== 0) {
    process.exitCode = 1;

    break;
  }
}
