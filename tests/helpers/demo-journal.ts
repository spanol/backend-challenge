import type { DemoState, Journal } from '../../demo/types/contracts';

export function memoryJournal(): Journal & { revisions: DemoState[] } {
  const revisions: DemoState[] = [];

  return {
    revisions,
    load: () => Promise.resolve(revisions.length ? structuredClone(revisions.at(-1)!) : undefined),
    save: (state) => {
      revisions.push(structuredClone(state));
      return Promise.resolve();
    },
  };
}
