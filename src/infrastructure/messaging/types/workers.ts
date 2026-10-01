import type { SqlManager } from '../../persistence/types/database';

export interface ClaimedEvent {
  id: string;
  aggregate_id: string;
  payload: unknown;
  attempts: number;
}

export interface ClaimedReference {
  id: string;
  idempotency_key: string;
}

export type DownstreamEffect = (em: SqlManager) => Promise<void>;
