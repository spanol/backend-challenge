import { readFile, unlink } from 'node:fs/promises';
import type { SuiteResources } from './types/verification';
import { combineJUnitReports } from './test-reports';

export async function runAllSuites(): Promise<number> {
  let active: ReturnType<typeof Bun.spawn> | undefined;
  let interrupted = 0;
  const onSigint = () => {
    interrupted = 130;
    active?.kill('SIGINT');
  };
  const onSigterm = () => {
    interrupted = 143;
    active?.kill('SIGTERM');
  };
  const reports: string[] = [];
  const resources: SuiteResources[] = [];
  let exitCode = 0;

  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  try {
    for (const suite of ['unit', 'integration', 'concurrency'] as const) {
      if (interrupted) break;

      await Promise.all([
        unlink(`test-results/${suite}.junit.xml`).catch(() => undefined),
        suite === 'unit'
          ? Promise.resolve()
          : unlink(`test-results/resources-${suite}.json`).catch(() => undefined),
      ]);

      active = Bun.spawn(
        suite === 'unit'
          ? [process.execPath, 'run', 'test']
          : [process.execPath, 'scripts/test-suite.ts', suite],
        { env: process.env, stdout: 'inherit', stderr: 'inherit' },
      );
      exitCode = await active.exited;

      const junit = await readFile(`test-results/${suite}.junit.xml`, 'utf8').catch(() => '');

      if (!junit) exitCode ||= 1;
      if (junit) reports.push(junit);
      if (suite !== 'unit') {
        const resource = await readFile(`test-results/resources-${suite}.json`, 'utf8').catch(
          () => '',
        );

        if (resource) resources.push(JSON.parse(resource) as SuiteResources);
        else exitCode ||= 1;
      }
      if (exitCode !== 0) break;
    }
  } finally {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    await Bun.write('test-results/all.junit.xml', combineJUnitReports(reports));
    await Bun.write(
      'test-results/resources-all.json',
      JSON.stringify(
        {
          suite: 'all',
          interrupted: interrupted || null,
          resources,
          cleanupComplete:
            resources.length > 0 && resources.every((resource) => resource.cleanupComplete),
        },
        null,
        2,
      ),
    );
  }

  return interrupted || exitCode;
}
