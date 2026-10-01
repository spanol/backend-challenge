import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { VerificationStepResult } from './types/verification';

const mode = Bun.argv[2] ?? 'quick';

if (!['static', 'quick', 'full'].includes(mode)) {
  throw new Error('Usage: bun scripts/verify.ts static|quick|full');
}

const root = fileURLToPath(new URL('..', import.meta.url));
const startedAt = new Date().toISOString();
const steps = ['typecheck', 'lint', 'format:check'];

// The full harness already typechecked; test:all remains a standalone typecheck + suite command.
if (mode !== 'static') steps.push(mode === 'full' ? 'test:suites' : 'test');

const results: VerificationStepResult[] = [];
let activeChild: ReturnType<typeof Bun.spawn> | undefined;
let interruptionCode = 0;

const onSigint = () => {
  interruptionCode = 130;
  activeChild?.kill('SIGINT');
};

const onSigterm = () => {
  interruptionCode = 143;
  activeChild?.kill('SIGTERM');
};

process.on('SIGINT', onSigint);
process.on('SIGTERM', onSigterm);
await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });

for (const step of steps) {
  if (interruptionCode) {
    process.exitCode = interruptionCode;
    break;
  }

  console.log(`\n[verify:${mode}] ${step}`);

  const start = performance.now();

  activeChild = Bun.spawn([process.execPath, 'run', step], {
    cwd: root,
    env: process.env,
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const exitCode = await activeChild.exited;

  results.push({ step, exitCode, durationMs: Math.round(performance.now() - start) });

  if (exitCode !== 0) {
    process.exitCode = exitCode;
    break;
  }
}

process.off('SIGINT', onSigint);
process.off('SIGTERM', onSigterm);

const passed =
  !interruptionCode &&
  results.length === steps.length &&
  results.every((step) => step.exitCode === 0);

if (interruptionCode) process.exitCode = interruptionCode;

await Bun.write(
  new URL(`../test-results/verify-${mode}.json`, import.meta.url),
  JSON.stringify(
    { mode, startedAt, completedAt: new Date().toISOString(), bun: Bun.version, passed, results },
    null,
    2,
  ),
);
console.log(`[verify:${mode}] ${passed ? 'PASS' : 'FAIL'}`);
