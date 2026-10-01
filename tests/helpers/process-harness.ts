import { fileURLToPath } from 'node:url';
import type { ChildEvent } from './types/process';

export function childHarness(
  mode: string,
  entrypoint = new URL('./process-child.ts', import.meta.url),
) {
  const events: ChildEvent[] = [];
  const waiters = new Set<() => void>();
  let exitCode: number | undefined;

  const child = Bun.spawn([process.execPath, fileURLToPath(entrypoint), mode], {
    env: { ...process.env, SQS_VISIBILITY_SECONDS: '1' },
    stdout: 'ignore',
    stderr: 'inherit',
    ipc(message) {
      events.push(message as ChildEvent);

      for (const waiter of waiters) waiter();
    },
  });

  void child.exited.then((code) => {
    exitCode = code;

    for (const waiter of waiters) waiter();
  });

  function wait(type: string): Promise<ChildEvent> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        waiters.delete(check);
        reject(new Error(`Child ${mode} did not emit ${type}`));
      }, 30000);

      function check() {
        const event = events.find((e) => e.type === type);

        if (event) {
          clearTimeout(timeout);
          waiters.delete(check);
          resolve(event);
        } else if (exitCode !== undefined) {
          clearTimeout(timeout);
          waiters.delete(check);
          reject(new Error(`Child ${mode} exited ${exitCode} before emitting ${type}`));
        }
      }

      waiters.add(check);
      check();
    });
  }

  return {
    child,
    wait,
    events,
    send: (message: unknown) => child.send(message),
    kill: () => child.kill(),
  };
}
