import type { ProcessingResult } from '../../../src/application/types/wagering';
import type { WagerCommand } from '../../../src/domain/types/wager';

export interface ChildEvent {
  type: string;
  eventId?: string;
  pid?: number;
  backendPid?: number;
  at?: number;
  results?: ProcessingResult[];
  total?: number;
}

export interface ChildConfig {
  commands?: WagerCommand[];
  hold?: boolean;
}

export interface ChildControl {
  type: string;
  config?: ChildConfig;
}
