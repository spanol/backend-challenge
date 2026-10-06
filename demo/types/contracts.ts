import type { WagerCommand } from '../../src/domain/types/wager';
import type { ProcessingResult } from '../../src/application/types/wagering';
import type { WalletView } from '../../src/application/types/wallet';

export interface Peer {
  id: string;
  name: string;
  walletId: string;
  playerId: string;
  balance?: string;
}

export interface Bet {
  id: string;
  peerId: string;
  roundId: string;
  amount: string;
  status: 'placing' | 'active' | 'cashed' | 'lost' | 'refunded' | 'rejected' | 'rolledback';
  openingId: string;
  prize?: string;
  multiplier?: number;
  autoCashoutAt?: number;
}

export interface Autoplay {
  enabled: boolean;
  amount: string;
  peersPerRound: number;
  nextPeerIndex: number;
  cycles: number;
  pauseReason?: 'user' | 'wallet_depleted';
}

export interface DemoTableOptions {
  initialPeerCount?: number;
  initialMode?: 'independent' | 'shared';
  initialAutoplay?: boolean;
  peersPerRound?: number;
  renewExhaustedWallets?: boolean;
  crashPoint?: () => number;
}

export interface DemoHistory {
  operationCount: number;
  completedOperationCount: number;
  apiOperationCounts: Record<string, number>;
}

export interface RoundSummary {
  planned: number;
  confirming: number;
  bets: number;
  active: number;
  cashed: number;
  lost: number;
  rejected: number;
  wagered: string;
  paid: string;
}

export interface ScheduledBet {
  id: string;
  peerId: string;
  amount: string;
}

export interface Operation {
  id: string;
  peerId: string;
  betId: string;
  effect: 'bet' | 'win' | 'loss' | 'refund' | 'rollback';
  command: WagerCommand;
  api?: string;
  result?: ProcessingResult;
  error?: string;
}

export interface DemoState {
  version: 1;
  sessionId: string;
  mode: 'independent' | 'shared';
  peers: Peer[];
  pendingPeers: Peer[];
  scheduledBets: ScheduledBet[];
  bets: Bet[];
  operations: Operation[];
  phase: 'betting' | 'flying' | 'crashed';
  roundId: string;
  roundNumber: number;
  crashAt: number;
  startedAt?: number;
  bettingEndsAt?: number;
  crashedEndsAt?: number;
  autoplay?: Autoplay;
  history?: DemoHistory;
  renewedWalletCount?: number;
  renewingWalletCount?: number;
  walletRenewalError?: string;
}

export interface DemoView {
  state?: DemoState;
  serverTime: number;
  multiplier: number;
  blocked: boolean;
  apiUrls: string[];
  replay?: { result: ProcessingResult; api: string; operationId: string };
}

export interface DemoPeerOption {
  id: string;
  name: string;
  pending: boolean;
}

export interface DemoDashboardView extends Omit<DemoView, 'state'> {
  state?: Omit<DemoState, 'bets' | 'operations' | 'peers' | 'pendingPeers' | 'scheduledBets'> & {
    peers: Peer[];
    pendingPeers: Peer[];
    scheduledBets: ScheduledBet[];
    bets: Bet[];
    operations: Operation[];
    peerCount: number;
    pendingPeerCount: number;
    scheduledBetCount: number;
    peersOffset: number;
    hasOpenBet: boolean;
  };
  operationCount: number;
  completedOperationCount: number;
  apiOperationCounts: Record<string, number>;
  operationPeerNames: Record<string, string>;
  pendingOperationCount: number;
  roundTiming: { countdownMilliseconds: number; resultMilliseconds: number };
  operationError?: string;
  roundSummary: RoundSummary;
}

export interface DemoPeerOptionsView {
  peerOptions: DemoPeerOption[];
  peerSearchMatches: number;
  peerSearchCapped: boolean;
}

export interface Evidence {
  wallet: WalletView;
  ledger: {
    items: {
      transactionId: string;
      direction: string;
      money: { amount: string; currency: string };
      walletVersion: number;
    }[];
    nextCursor: string | null;
  };
  reconciliation: {
    consistent: boolean;
    storedBalance: { amount: string; currency: string };
    calculatedBalance: { amount: string; currency: string };
    difference: { amount: string; currency: string };
    checkedEntries: number;
  };
}

export interface FinancialApi {
  readonly urls: string[];
  openWallet(): Promise<WalletView>;
  process(command: WagerCommand): Promise<{ result: ProcessingResult; api: string }>;
  inspect(walletId: string, cursor?: string): Promise<Evidence>;
  conflict(command: WagerCommand): Promise<number>;
}

export interface Journal {
  load(): Promise<DemoState | undefined>;
  save(state: DemoState): Promise<void>;
}
