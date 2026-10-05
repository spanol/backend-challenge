import type { WagerCommand } from '../../src/domain/types/wager';
import type { WagerKind, WagerStatus } from '../../src/domain/constants/wager';

export interface Arrival {
  player: number;
  dueMs: number;
}

export interface ArrivalStats {
  offered: number;
  started: number;
  expired: number;
  overflow: number;
  failed: number;
  maxInFlight: number;
  maxQueued: number;
  generatorLagMs: number[];
  queueWaitMs: number[];
  elapsedMs: number;
}

export interface GamePhase {
  name: string;
  population: number;
  arrivalsPerSecond: number | null;
  arrivalWindowMs: number;
  startedAt: string;
  completedAt?: string;
  sessionsCompleted: number;
  responses: number;
  transportErrors: number;
  unexpectedHttp: number;
  rejected: number;
  replicas: number[];
  arrivalStats?: ArrivalStats;
  sessionLatencyMs?: { p50: number; p95: number; p99: number };
  capacityMet?: boolean;
}

export interface GameAttempt {
  phase: string;
  replica: number;
  key: string;
  kind: WagerCommand['kind'];
  at: string;
  elapsedMs: number;
  status?: number;
  error?: string;
}

export interface GameTransactionRow {
  key: string;
  wallet: string;
  player: string;
  provider: string;
  external: string;
  round: string;
  game: string;
  kind: WagerKind;
  amount: string;
  currency: string;
  reference: string | null;
  status: WagerStatus;
}

export interface GameWalletRow {
  id: string;
  balance: string;
  calculated: string;
  version: number;
  entries: string;
}
