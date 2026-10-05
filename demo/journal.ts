import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { object } from '../src/application/contracts';
import type { DemoState, Journal } from './types/contracts';

interface ProcessIdentity {
  bootId: string;
  startTime: string;
}

type ProcessIdentityReader = (pid: number) => Promise<ProcessIdentity | undefined>;

async function readProcessIdentity(pid: number): Promise<ProcessIdentity | undefined> {
  try {
    const [bootId, stat] = await Promise.all([
      readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
      readFile(`/proc/${pid}/stat`, 'utf8'),
    ]);
    const commandEnd = stat.lastIndexOf(')');
    if (commandEnd < 0) return undefined;

    // The command name can contain spaces and parentheses; fields after its final ')' start at state (field 3).
    const startTime = stat
      .slice(commandEnd + 1)
      .trim()
      .split(/\s+/)[19];
    if (!startTime || !/^\d+$/.test(startTime)) return undefined;

    return { bootId: bootId.trim(), startTime };
  } catch {
    // On systems without procfs, PID liveness remains the conservative fallback.
    return undefined;
  }
}

function sameProcess(
  record: Record<string, unknown>,
  identity: ProcessIdentity | undefined,
): boolean {
  if (
    typeof record.bootId !== 'string' ||
    typeof record.startTime !== 'string' ||
    identity === undefined
  )
    return true;

  return record.bootId === identity.bootId && record.startTime === identity.startTime;
}

export class FileJournal implements Journal {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  async load(): Promise<DemoState | undefined> {
    let text: string;

    try {
      text = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return undefined;

      throw error;
    }

    const state = object(JSON.parse(text) as unknown);

    if (
      state.version !== 1 ||
      typeof state.sessionId !== 'string' ||
      !Array.isArray(state.peers) ||
      !Array.isArray(state.bets) ||
      !Array.isArray(state.operations) ||
      !['betting', 'flying', 'crashed'].includes(String(state.phase))
    )
      throw new Error('Journal da demo inválido; preserve o arquivo para diagnóstico');

    return state as unknown as DemoState;
  }

  save(state: DemoState): Promise<void> {
    // Capture this revision before another parallel HTTP response changes the in-memory state.
    const text = JSON.stringify(state);
    const task = this.queue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(`${this.path}.next`, text, { encoding: 'utf8', mode: 0o600 });
      await rename(`${this.path}.next`, this.path);
    });

    this.queue = task.catch(() => undefined);

    return task;
  }
}

export async function acquireDemoLock(
  path: string,
  identifyProcess: ProcessIdentityReader = readProcessIdentity,
): Promise<() => Promise<void>> {
  await mkdir(dirname(path), { recursive: true });
  let file;
  try {
    file = await open(path, 'wx', 0o600);
  } catch (error) {
    if ((error as { code?: string }).code !== 'EEXIST') throw error;
    // Serialize stale-lock reclamation and re-read inside the guard. An old PID
    // observed by two starters must never let the second unlink the first's lock.
    const guardPath = `${path}.recovery`;
    const guard = await open(guardPath, 'wx', 0o600);
    try {
      const record = object(JSON.parse(await readFile(path, 'utf8')) as unknown);
      if (typeof record.pid !== 'number' || !Number.isSafeInteger(record.pid) || record.pid < 1)
        throw new Error('Lock da demo inválido', { cause: error });
      try {
        process.kill(record.pid, 0);
        if (sameProcess(record, await identifyProcess(record.pid)))
          throw Object.assign(new Error('Outra mesa está usando o journal', { cause: error }), {
            code: 'EEXIST',
          });
      } catch (probe) {
        if ((probe as { code?: string }).code !== 'ESRCH') throw probe;
      }
      await unlink(path);
      file = await open(path, 'wx', 0o600);
    } finally {
      await guard.close();
      await unlink(guardPath);
    }
  }
  const owner = {
    pid: process.pid,
    ownerToken: randomUUID(),
    ...(await identifyProcess(process.pid)),
  };
  await file.writeFile(JSON.stringify(owner));
  await file.close();

  return async () => {
    const record = object(JSON.parse(await readFile(path, 'utf8')) as unknown);

    if (record.pid === owner.pid && record.ownerToken === owner.ownerToken) await unlink(path);
  };
}
