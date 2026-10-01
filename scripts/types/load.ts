export interface LoadSample {
  at: string;
  phase: string;
  cpuSeconds: number | null;
  cpuPercent: number | null;
  rssBytes: number | null;
  heapBytes: number | null;
  eventLoopP99Seconds: number | null;
  outboxPending: number | null;
  telemetryTimestampSeconds: number | null;
  outboxLagSeconds: number | null;
  lockConflicts: number | null;
  error?: string;
}
import type { MoneyProps } from '../../src/domain/types/money';

export interface LoadReconciliation {
  walletId: string;
  storedBalance: MoneyProps;
  calculatedBalance: MoneyProps;
  difference: MoneyProps;
  consistent: boolean;
  checkedEntries: number;
}
