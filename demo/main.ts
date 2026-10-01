import { resolve } from 'node:path';
import { HttpFinancialApi } from './api';
import { FileJournal, acquireDemoLock } from './journal';
import { DemoTable } from './table';
import { startDemoServer } from './server';

const api = new HttpFinancialApi(
  (
    process.env.DEMO_API_URLS ??
    `http://127.0.0.1:${process.env.APP_PORT ?? 3000},http://127.0.0.1:${process.env.APP_2_PORT ?? 3001},http://127.0.0.1:${process.env.APP_3_PORT ?? 3002}`
  )
    .split(',')
    .map((url) => url.trim()),
);
const port = Number(process.env.DEMO_PORT ?? 3200);

if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
  throw new Error('DEMO_PORT inválida');

const path = resolve(process.env.DEMO_JOURNAL_PATH ?? '.tmp/decolagem-session.json');
const unlock = await acquireDemoLock(`${path}.lock`);
const table = new DemoTable(api, new FileJournal(path));

let server: ReturnType<typeof startDemoServer>;
try {
  await table.recover();
  server = startDemoServer(table, port, {
    hostname: process.env.DEMO_HOST ?? '127.0.0.1',
    publicOrigin: process.env.DEMO_PUBLIC_ORIGIN,
  });
} catch (error) {
  await unlock();
  throw error;
}

let ticking = false;
const timer = setInterval(() => {
  if (ticking) return;

  ticking = true;
  void table
    .tick()
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'Falha na rodada');
    })
    .finally(() => {
      ticking = false;
    });
}, 100);

async function stop() {
  clearInterval(timer);
  await server.stop(true);
  await table.drain();
  await unlock();
  process.exit(0);
}

process.once('SIGINT', () => {
  void stop();
});
process.once('SIGTERM', () => {
  void stop();
});
console.log(`Decolagem demo: ${server.url}`);
