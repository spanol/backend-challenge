import { WagerStatus } from '../src/domain/constants/wager';
import { Money } from '../src/domain/money';
import type { DemoState, Operation, SessionSummary } from './types/contracts';

export function emptySessionSummary(complete = true): SessionSummary {
  return { cashed: 0, lost: 0, paid: '0.00', complete };
}

export function addSessionOutcome(summary: SessionSummary, operation: Operation): void {
  if (operation.result?.status !== WagerStatus.PROCESSED) return;

  if (operation.effect === 'win') {
    summary.cashed++;
    summary.paid = Money.from({ amount: summary.paid, currency: 'BRL' })
      .add(Money.from(operation.command.money))
      .toString();
  } else if (operation.effect === 'loss') summary.lost++;
}

export function summarizeSession(state?: DemoState): SessionSummary {
  const summary = {
    ...(state?.history?.outcomes ??
      emptySessionSummary((state?.history?.operationCount ?? 0) === 0)),
  };

  // Compacted outcomes are durable in the journal; retained operations are
  // counted here until compaction moves each identity into that baseline.
  for (const operation of state?.operations ?? []) addSessionOutcome(summary, operation);

  return summary;
}
