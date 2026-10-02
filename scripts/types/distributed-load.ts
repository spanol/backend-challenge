import type { WagerCommand } from '../../src/domain/types/wager';
import type { ProcessingResult } from '../../src/application/types/wagering';
import type { LoadSample } from './load';

export interface LoadWallet {
  walletId: string;
  playerId: string;
  initialCents: bigint;
  expectedDebits: number;
}

export interface HttpAttempt {
  phase: string;
  replica: number;
  key: string;
  at: string;
  elapsedMs: number;
  status?: number;
  error?: string;
}

export interface ReplicaSample extends LoadSample {
  replica: number;
  generation: number | null;
  sqsCount: number | null;
  publisherAccepted: number | null;
}

export interface LoadPhase {
  name: string;
  startedAt: string;
  completedAt?: string;
  uniqueCommands: number;
  concurrency: number;
  wallets: number;
  amount: string;
  sqsDeliveries: number;
  processed: number;
  rejected: number;
  logicalFailures: number;
  transportErrors: number;
  unexpectedHttp: number;
  expectedOutages: number;
  replayChecks: number;
  elapsedSeconds?: number;
  throughput?: number;
  latencyMs?: { p50: number; p95: number; p99: number };
  replicas: { requests: number; responses: number; transportErrors: number }[];
  reconciliation?: unknown[];
  audit?: Record<string, string>;
  recoverySeconds?: number;
  error?: string;
  passed: boolean;
  planHash?: string;
  workers?: { replica: number; sqsRequests: number; publisherAccepted: number }[];
}

export interface HistoricalResult {
  command: WagerCommand;
  result: ProcessingResult;
  replica: number;
}
