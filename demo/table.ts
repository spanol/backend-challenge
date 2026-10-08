import { randomInt } from 'node:crypto';
import { WagerKind, WagerStatus } from '../src/domain/constants/wager';
import { DemoErrorCode, DemoRequestError } from './errors';
import { Money } from '../src/domain/money';
import { newId } from '../src/application/contracts';
import { addSessionOutcome, emptySessionSummary, summarizeSession } from './session-summary';
import type { WalletView } from '../src/application/types/wallet';
import type {
  Bet,
  DemoDashboardView,
  DemoPeerOption,
  DemoPeerOptionsView,
  DemoState,
  DemoTableOptions,
  DemoView,
  FinancialApi,
  Journal,
  Operation,
  Peer,
  RoundSummary,
  ScheduledBet,
} from './types/contracts';

const growth = 0.18;
const bettingMilliseconds = 3000;
const crashedMilliseconds = 1500;
const operationBatchSize = 32;
const walletBatchSize = 16;
const dashboardPageSize = 100;
const replayOperationLimit = 30;
const peerOptionLimit = 100;
const cashoutTargets = [120, 150, 180, 220, 275, 400, undefined];
const maximumCrashPoint = 10000;

function randomCrashPoint(): number {
  const sample = randomInt(0, 0x1_0000_0000) / 0x1_0000_0000;

  return Math.max(100, Math.min(maximumCrashPoint, Math.floor((0.99 / (1 - sample)) * 100)));
}

export function prizeFor(amount: string, hundredths: number): string {
  const money = Money.from({ amount, currency: 'BRL' });

  if (!Number.isSafeInteger(hundredths) || hundredths < 100 || hundredths > 10000)
    throw new DemoRequestError(400, DemoErrorCode.INVALID_MULTIPLIER);

  const cents = (BigInt(money.toString().replace('.', '')) * BigInt(hundredths)) / 100n;
  const result = `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;

  return Money.from({ amount: result, currency: 'BRL' }).toString();
}

export class DemoTable {
  private state?: DemoState;
  private queue: Promise<unknown> = Promise.resolve();
  private replay?: DemoView['replay'];
  private recovering = false;
  private pendingOperationCount = 0;
  private completedOperationCount = 0;
  private apiOperationCounts = new Map<string, number>();
  private pendingOperationErrors = new Map<string, string>();
  private peerById = new Map<string, Peer>();
  private betById = new Map<string, Bet>();
  private currentRoundBetByPeer = new Map<string, Bet>();
  private scheduledBetByPeer = new Map<string, ScheduledBet>();
  private scheduledBetById = new Map<string, ScheduledBet>();
  private operationById = new Map<string, Operation>();
  private pendingOperations = new Map<string, Operation>();
  private openBetCount = 0;
  private pendingPeerIds = new Set<string>();
  private admission?: Promise<void>;
  private financialSlots = 0;
  private financialWaiters: (() => void)[] = [];

  async drain(): Promise<void> {
    await this.queue;
    await this.admission;
  }

  constructor(
    private readonly api: FinancialApi,
    private readonly journal: Journal,
    private readonly now = () => Date.now(),
    private readonly options: DemoTableOptions = {},
  ) {
    if (
      !Number.isSafeInteger(options.initialPeerCount ?? 6) ||
      (options.initialPeerCount ?? 6) < 1 ||
      !Number.isSafeInteger(options.peersPerRound ?? 8000) ||
      (options.peersPerRound ?? 8000) < 1 ||
      (options.peersPerRound ?? 8000) > 8000 ||
      !Number.isSafeInteger(options.bettingWindowMilliseconds ?? 5000) ||
      (options.bettingWindowMilliseconds ?? 5000) < 1000 ||
      (options.bettingWindowMilliseconds ?? 5000) > 60000
    )
      throw new DemoRequestError(400, DemoErrorCode.INVALID_SESSION);

    for (const url of api.urls) this.apiOperationCounts.set(url, 0);
  }

  private indexState(state: DemoState): void {
    this.pendingOperationCount = 0;
    this.completedOperationCount = state.history?.completedOperationCount ?? 0;
    this.apiOperationCounts = new Map(
      this.api.urls.map((url) => [url, state.history?.apiOperationCounts[url] ?? 0]),
    );
    this.pendingOperationErrors.clear();
    this.peerById.clear();
    this.betById.clear();
    this.currentRoundBetByPeer.clear();
    this.scheduledBetByPeer.clear();
    this.scheduledBetById.clear();
    this.operationById.clear();
    this.pendingOperations.clear();
    this.pendingPeerIds = new Set(state.pendingPeers.map((peer) => peer.id));
    this.openBetCount = 0;

    for (const peer of [...state.peers, ...state.pendingPeers]) this.peerById.set(peer.id, peer);
    for (const bet of state.bets) {
      this.betById.set(bet.id, bet);
      if (bet.roundId === state.roundId) this.currentRoundBetByPeer.set(bet.peerId, bet);
      if (bet.status === 'active' || bet.status === 'placing') this.openBetCount++;
    }
    for (const bet of state.scheduledBets) {
      this.scheduledBetByPeer.set(bet.peerId, bet);
      this.scheduledBetById.set(bet.id, bet);
    }

    for (const operation of state.operations) {
      this.operationById.set(operation.id, operation);
      if (operation.result) this.completedOperationCount++;
      else if (!operation.expiredBeforeSend) {
        if (operation.effect !== 'bet') this.betById.get(operation.betId)!.settling = true;
        this.pendingOperations.set(operation.id, operation);
        this.pendingOperationCount++;
        if (operation.error) this.pendingOperationErrors.set(operation.id, operation.error);
      }
      if (operation.api)
        this.apiOperationCounts.set(
          operation.api,
          (this.apiOperationCounts.get(operation.api) ?? 0) + 1,
        );
    }
  }

  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const task = this.queue.then(action);

    this.queue = task.catch(() => undefined);

    return task;
  }

  private required(): DemoState {
    if (!this.state) throw new DemoRequestError(409, DemoErrorCode.CREATE_SESSION_FIRST);

    return this.state;
  }

  private crashPoint(): number {
    const point = (this.options.crashPoint ?? randomCrashPoint)();

    if (!Number.isSafeInteger(point) || point < 100 || point > maximumCrashPoint)
      throw new Error('Fonte de ponto de estouro retornou um valor invalido');

    return point;
  }

  private ready(): DemoState {
    const state = this.required();

    if (
      this.admission ||
      this.pendingOperationCount > 0 ||
      state.walletRenewalError ||
      state.admissionError ||
      state.settlementError
    )
      throw new DemoRequestError(503, DemoErrorCode.RETRY_PENDING_OPERATION);

    return state;
  }

  view(): DemoView {
    const multiplier = this.multiplier();

    return {
      state: this.state && structuredClone(this.state),
      serverTime: this.now(),
      multiplier,
      blocked:
        !!this.admission ||
        this.pendingOperationCount > 0 ||
        !!this.state?.renewingWalletCount ||
        !!this.state?.walletRenewalError ||
        !!this.state?.admissionError ||
        !!this.state?.settlementError,
      apiUrls: this.api.urls,
      replay: this.replay && structuredClone(this.replay),
    };
  }

  dashboardView(offset = 0, selectedPeerId?: string): DemoDashboardView {
    const state = this.state;
    const peerCount = state?.peers.length ?? 0;
    const pendingPeerCount = state?.pendingPeers.length ?? 0;
    const totalPeerCount = peerCount + pendingPeerCount;
    const maxOffset =
      Math.floor(Math.max(0, totalPeerCount - 1) / dashboardPageSize) * dashboardPageSize;
    const requestedOffset = Number.isFinite(offset)
      ? Math.max(0, Math.floor(offset / dashboardPageSize) * dashboardPageSize)
      : 0;
    const peersOffset = Math.min(maxOffset, requestedOffset);
    const activeStart = Math.min(peersOffset, peerCount);
    const activeEnd = Math.min(peerCount, peersOffset + dashboardPageSize);
    const pendingStart = Math.max(0, peersOffset - peerCount);
    const pendingEnd = Math.min(
      pendingPeerCount,
      Math.max(0, peersOffset + dashboardPageSize - peerCount),
    );
    const recentOperations = this.recentCompletedOperations();
    const peers = state?.peers.slice(activeStart, activeEnd) ?? [];
    const pendingPeers = state?.pendingPeers.slice(pendingStart, pendingEnd) ?? [];
    const pagePeerIds = new Set([...peers, ...pendingPeers].map((peer) => peer.id));
    const bets = [...pagePeerIds]
      .map((peerId) => this.currentRoundBetByPeer.get(peerId))
      .filter((bet): bet is Bet => bet !== undefined);
    const scheduledBets = [...pagePeerIds]
      .map((peerId) => this.scheduledBetByPeer.get(peerId))
      .filter((bet): bet is ScheduledBet => bet !== undefined);
    const selectedBet = selectedPeerId && this.currentRoundBetByPeer.get(selectedPeerId);
    const selectedScheduledBet = selectedPeerId && this.scheduledBetByPeer.get(selectedPeerId);
    if (selectedBet && !pagePeerIds.has(selectedBet.peerId)) bets.push(selectedBet);
    if (selectedScheduledBet && !pagePeerIds.has(selectedScheduledBet.peerId))
      scheduledBets.push(selectedScheduledBet);

    return {
      state: state && {
        ...state,
        peers,
        pendingPeers,
        scheduledBets,
        bets,
        operations: recentOperations,
        peerCount,
        pendingPeerCount,
        scheduledBetCount: state.scheduledBets.length,
        peersOffset,
        hasOpenBet: this.openBetCount > 0,
      },
      serverTime: this.now(),
      multiplier: this.multiplier(),
      blocked:
        !!this.admission ||
        this.pendingOperationCount > 0 ||
        !!state?.renewingWalletCount ||
        !!state?.walletRenewalError ||
        !!state?.admissionError ||
        !!state?.settlementError,
      apiUrls: this.api.urls,
      replay: this.replay && structuredClone(this.replay),
      operationCount: (state?.operations.length ?? 0) + (state?.history?.operationCount ?? 0),
      completedOperationCount: this.completedOperationCount,
      pendingOperationCount: this.pendingOperationCount,
      roundTiming: {
        countdownMilliseconds:
          state?.bettingPolicy === 'deadline'
            ? (state.bettingWindowMilliseconds ?? 5000)
            : bettingMilliseconds,
        resultMilliseconds: crashedMilliseconds,
      },
      apiOperationCounts: Object.fromEntries(
        this.api.urls.map((url) => [url, this.apiOperationCounts.get(url) ?? 0]),
      ),
      operationPeerNames: Object.fromEntries(
        recentOperations.map((operation) => [
          operation.peerId,
          this.peerById.get(operation.peerId)?.name ?? operation.peerId,
        ]),
      ),
      operationError:
        state?.settlementError ??
        state?.admissionError ??
        state?.walletRenewalError ??
        this.pendingOperationErrors.values().next().value,
      roundSummary: this.roundSummary(),
      sessionSummary: summarizeSession(state),
    };
  }

  private recentCompletedOperations(): Operation[] {
    const operations = this.state?.operations ?? [];
    const recent: Operation[] = [];
    for (
      let index = operations.length - 1;
      index >= 0 && recent.length < replayOperationLimit;
      index--
    ) {
      const operation = operations[index]!;
      if (operation.result) recent.push(operation);
    }
    return recent.reverse();
  }

  private roundSummary(): RoundSummary {
    const summary: RoundSummary = {
      planned: 0,
      confirming: 0,
      bets: 0,
      active: 0,
      cashed: 0,
      lost: 0,
      rejected: 0,
      expired: 0,
      refunding: 0,
      wagered: '0.00',
      paid: '0.00',
    };
    let wagered = Money.zero('BRL');
    let paid = Money.zero('BRL');

    for (const bet of this.currentRoundBetByPeer.values()) {
      summary.planned++;
      if (bet.status === 'placing') summary.confirming++;
      if (bet.status === 'active' && !bet.missedWindow) summary.active++;
      if (bet.status === 'cashed') summary.cashed++;
      if (bet.status === 'lost') summary.lost++;
      if (bet.status === 'rejected') summary.rejected++;
      if (bet.status === 'expired' || bet.missedWindow) summary.expired++;
      if (bet.missedWindow && bet.status === 'active') summary.refunding++;
      if (
        !bet.missedWindow &&
        this.operationById.get(bet.openingId)?.result?.status === WagerStatus.PROCESSED
      ) {
        summary.bets++;
        wagered = wagered.add(Money.from({ amount: bet.amount, currency: 'BRL' }));
      }
      if (bet.status === 'cashed' && bet.prize)
        paid = paid.add(Money.from({ amount: bet.prize, currency: 'BRL' }));
    }
    summary.wagered = wagered.toString();
    summary.paid = paid.toString();

    return summary;
  }

  peerOptions(searchText: string, selectedPeerId?: string): DemoPeerOptionsView {
    const search = searchText.trim().toLocaleLowerCase('pt-BR');
    const options: DemoPeerOption[] = [];
    let matches = 0;
    const state = this.state;

    if (state) {
      for (const [peers, pending] of [
        [state.peers, false],
        [state.pendingPeers, true],
      ] as const) {
        for (const peer of peers) {
          if (search && !`${peer.name} ${peer.id}`.toLocaleLowerCase('pt-BR').includes(search))
            continue;
          matches++;
          if (options.length < peerOptionLimit)
            options.push({ id: peer.id, name: peer.name, pending });
        }
      }
    }

    if (selectedPeerId && !options.some((option) => option.id === selectedPeerId)) {
      const peer = this.peerById.get(selectedPeerId);
      if (peer) {
        if (options.length === peerOptionLimit) options.pop();
        options.unshift({
          id: peer.id,
          name: peer.name,
          pending: this.pendingPeerIds.has(peer.id),
        });
      }
    }

    return {
      peerOptions: options,
      peerSearchMatches: matches,
      peerSearchCapped: matches > peerOptionLimit,
    };
  }

  private multiplier(): number {
    const state = this.state;

    if (!state || state.phase === 'betting' || state.startedAt === undefined) return 100;
    if (state.phase === 'crashed') return state.crashAt;

    return Math.min(
      state.crashAt,
      Math.floor(Math.exp((growth * Math.max(0, this.now() - state.startedAt)) / 1000) * 100),
    );
  }

  private peer(id: string): Peer {
    this.required();
    const peer = this.peerById.get(id);

    if (!peer) throw new DemoRequestError(404, DemoErrorCode.PEER_NOT_FOUND);

    return peer;
  }

  private bet(id: string): Bet {
    this.required();
    const bet = this.betById.get(id);

    if (!bet) throw new DemoRequestError(404, DemoErrorCode.BET_NOT_FOUND);

    return bet;
  }

  private async save(): Promise<void> {
    await this.journal.save(this.required());
  }

  private plan(
    bet: Bet,
    effect: Operation['effect'],
    amount: string,
    reference?: string,
    knownPeer?: Peer,
  ): Operation {
    const state = this.required();
    const peer = knownPeer ?? this.peer(bet.peerId);
    const original = this.operationById.get(bet.openingId)?.command;
    const id = newId();
    const kind = {
      bet: WagerKind.BET,
      win: WagerKind.WIN,
      loss: WagerKind.LOSS,
      refund: WagerKind.REFUND,
      rollback: WagerKind.ROLLBACK,
    } as const;
    const op: Operation = {
      id,
      peerId: peer.id,
      betId: bet.id,
      effect,
      command: {
        idempotencyKey: id,
        providerId: 'decolagem-demo',
        externalTransactionId: `${state.sessionId}:${id}`,
        walletId: original?.walletId ?? peer.walletId,
        playerId: original?.playerId ?? peer.playerId,
        roundId: bet.roundId,
        gameId: 'decolagem',
        kind: kind[effect],
        money: { amount, currency: 'BRL' },
        ...(reference ? { referenceExternalTransactionId: reference } : {}),
      },
    };

    state.operations.push(op);
    this.operationById.set(op.id, op);
    this.pendingOperations.set(op.id, op);
    this.pendingOperationCount++;
    if (effect !== 'bet') bet.settling = true;

    return op;
  }

  private expireUnsent(operation: Operation): void {
    if (operation.result || operation.expiredBeforeSend) return;
    operation.expiredBeforeSend = true;
    this.pendingOperations.delete(operation.id);
    this.pendingOperationCount--;
    this.bet(operation.betId).status = 'expired';
    this.openBetCount--;
  }

  private async processWithSlot(op: Operation, admissionOnly: boolean) {
    if (this.financialSlots >= operationBatchSize)
      await new Promise<void>((resolve) => {
        this.financialWaiters.push(resolve);
      });
    else this.financialSlots++;

    try {
      if (admissionOnly && this.now() >= this.required().admissionDeadlineAt!) {
        this.expireUnsent(op);
        return undefined;
      }
      return await this.api.process(op.command);
    } finally {
      const next = this.financialWaiters.shift();
      if (next) next();
      else this.financialSlots--;
    }
  }

  private async send(op: Operation, persist = true, admissionOnly = false): Promise<void> {
    if (op.result || op.expiredBeforeSend) return;

    try {
      const response = await this.processWithSlot(op, admissionOnly);
      if (!response) return;
      const { result, api } = response;

      if (op.api !== api) {
        if (op.api)
          this.apiOperationCounts.set(
            op.api,
            Math.max(0, (this.apiOperationCounts.get(op.api) ?? 0) - 1),
          );
        this.apiOperationCounts.set(api, (this.apiOperationCounts.get(api) ?? 0) + 1);
      }
      op.api = api;

      if (result.status === WagerStatus.PENDING_REFERENCE || result.status === WagerStatus.PENDING)
        throw new Error('Operação financeira ainda pendente');

      op.result = result;
      const peer = this.peer(op.peerId);
      if (this.state?.mode === 'independent' && peer.walletId === op.command.walletId)
        peer.balance = result.balance.amount;
      op.error = undefined;
      this.pendingOperationCount--;
      this.completedOperationCount++;
      this.pendingOperationErrors.delete(op.id);
      this.pendingOperations.delete(op.id);

      const bet = this.bet(op.betId);
      if (op.effect !== 'bet') bet.settling = false;
      const wasOpen = bet.status === 'active' || bet.status === 'placing';
      if (
        op.effect === 'bet' &&
        this.state?.bettingPolicy === 'deadline' &&
        this.state.admissionDeadlineAt !== undefined &&
        this.now() >= this.state.admissionDeadlineAt
      )
        bet.missedWindow = true;

      if (result.status === WagerStatus.PROCESSED) {
        bet.status = {
          bet: 'active',
          win: 'cashed',
          loss: 'lost',
          refund: 'refunded',
          rollback: 'rolledback',
        }[op.effect] as Bet['status'];
      } else if (op.effect === 'bet') bet.status = 'rejected';
      const isOpen = bet.status === 'active' || bet.status === 'placing';
      if (wasOpen && !isOpen) this.openBetCount--;
      else if (!wasOpen && isOpen) this.openBetCount++;
      if (op.effect === 'bet' && bet.missedWindow && bet.status === 'active') {
        const refund = this.plan(bet, 'refund', bet.amount, op.command.externalTransactionId);
        await this.save();
        await this.send(refund);
      }
      if (op.effect === 'refund' && bet.missedWindow && result.status !== WagerStatus.PROCESSED)
        this.required().settlementError = `Estorno tardio recusado (${result.failureCode ?? result.status}). Consulte a operação antes de retomar.`;
    } catch (error) {
      op.error = error instanceof Error ? error.message : 'Falha de transporte';
      if (op.result) this.pendingOperationErrors.delete(op.id);
      else this.pendingOperationErrors.set(op.id, op.error);
    }

    if (persist) await this.save();
  }

  private async sendBatch(operations: Operation[]): Promise<void> {
    if (!operations.length) return;

    let next = 0;
    let halted = false;
    await Promise.all(
      Array.from({ length: Math.min(operationBatchSize, operations.length) }, async () => {
        while (!halted && next < operations.length) {
          const operation = operations[next++]!;
          await this.send(operation, false);
          if (!operation.result) halted = true;
        }
      }),
    );
    await this.save();
  }

  private async openBettingWindow(operations: Operation[]): Promise<void> {
    const state = this.required();
    const offset = operations.length ? (state.admissionCursor ?? 0) % operations.length : 0;
    const ordered = [...operations.slice(offset), ...operations.slice(0, offset)];
    state.admissionDeadlineAt = this.now() + (state.bettingWindowMilliseconds ?? 5000);
    state.bettingEndsAt = state.admissionDeadlineAt;
    await this.save();
    this.admission = this.admitBeforeDeadline(ordered, offset)
      .catch((error: unknown) => {
        state.admissionError =
          error instanceof Error ? error.message : 'Falha ao persistir a entrada';
      })
      .finally(() => {
        this.admission = undefined;
      });
  }

  private async admitBeforeDeadline(operations: Operation[], offset: number): Promise<void> {
    const deadline = this.required().admissionDeadlineAt!;
    let next = 0;
    let halted = false;
    await Promise.all(
      Array.from({ length: Math.min(operationBatchSize, operations.length) }, async () => {
        while (!halted && next < operations.length && this.now() < deadline) {
          const operation = operations[next++]!;
          await this.send(operation, false, true);
          if (!operation.result && !operation.expiredBeforeSend) halted = true;
        }
      }),
    );
    // These identities were never sent by this coordinator. In-flight/uncertain
    // calls remain pending and can only be resolved through their original key.
    for (const operation of operations.slice(next)) {
      this.expireUnsent(operation);
    }
    if (operations.length) this.required().admissionCursor = (offset + next) % operations.length;
    await this.save();
  }

  private async newPeers(
    count: number,
    mode: DemoState['mode'],
    firstNumber: number,
    existing?: Peer,
  ): Promise<Peer[]> {
    const wallets: WalletView[] = [];

    if (mode === 'shared') {
      const wallet = existing ?? (await this.api.openWallet());
      return Array.from({ length: count }, (_, i) => ({
        id: newId(),
        name: `Sessão ${firstNumber + i}`,
        walletId: wallet.walletId,
        playerId: wallet.playerId,
      }));
    }

    for (let i = 0; i < count; i += walletBatchSize)
      wallets.push(
        ...(await Promise.all(
          Array.from({ length: Math.min(walletBatchSize, count - i) }, () => this.api.openWallet()),
        )),
      );

    return wallets.map((wallet, i) => ({
      id: newId(),
      name: `Jogador ${firstNumber + i}`,
      walletId: wallet.walletId,
      playerId: wallet.playerId,
      balance: wallet.balance.amount,
    }));
  }

  async recover(): Promise<void> {
    this.state = await this.journal.load();

    if (!this.state) {
      await this.session(
        this.options.initialPeerCount ?? 6,
        this.options.initialMode ?? 'independent',
        this.options.initialAutoplay ?? false,
      );
      return;
    }
    this.state.pendingPeers ??= [];
    this.state.scheduledBets ??= [];
    this.indexState(this.state);
    this.recovering = true;
    await this.retry();
  }

  session(
    count: number,
    mode: 'independent' | 'shared',
    autoplay = false,
    bettingPolicy = mode === 'shared'
      ? 'confirm_all'
      : (this.options.bettingPolicy ?? 'confirm_all'),
  ): Promise<void> {
    return this.exclusive(async () => {
      if (
        !Number.isSafeInteger(count) ||
        count < 1 ||
        !['independent', 'shared'].includes(mode) ||
        !['deadline', 'confirm_all'].includes(bettingPolicy)
      )
        throw new DemoRequestError(400, DemoErrorCode.INVALID_SESSION);
      if (
        this.state &&
        (this.ready().phase === 'flying' ||
          this.state.pendingPeers.length > 0 ||
          this.state.scheduledBets.length > 0 ||
          this.openBetCount > 0)
      )
        throw new DemoRequestError(409, DemoErrorCode.FINISH_CURRENT_ROUND);

      const peers = await this.newPeers(count, mode, 1);

      this.state = {
        version: 1,
        sessionId: newId(),
        mode,
        peers,
        pendingPeers: [],
        scheduledBets: [],
        bets: [],
        operations: [],
        phase: 'betting',
        roundId: newId(),
        roundNumber: 1,
        crashAt: this.crashPoint(),
        bettingPolicy,
        bettingWindowMilliseconds: this.options.bettingWindowMilliseconds ?? 5000,
        bettingEndsAt: autoplay ? undefined : this.now() + bettingMilliseconds,
        autoplay: {
          enabled: autoplay,
          amount: '1.00',
          peersPerRound: this.options.peersPerRound ?? 8000,
          nextPeerIndex: 0,
          cycles: 0,
        },
      };
      this.indexState(this.state);
      this.replay = undefined;
      await this.save();
      if (autoplay) await this.placeAutoplayNow();
      else if (bettingPolicy === 'deadline') await this.openBettingWindow([]);
    });
  }

  setAutoplay(enabled: boolean, peersPerRound?: number): Promise<void> {
    return this.exclusive(async () => {
      if (
        peersPerRound !== undefined &&
        (!Number.isSafeInteger(peersPerRound) || peersPerRound < 1 || peersPerRound > 8000)
      )
        throw new DemoRequestError(400, DemoErrorCode.INVALID_SESSION);

      const state = this.required();
      state.autoplay ??= {
        enabled: false,
        amount: '1.00',
        peersPerRound: this.options.peersPerRound ?? 8000,
        nextPeerIndex: 0,
        cycles: 0,
      };
      state.autoplay.enabled = enabled;
      if (enabled) delete state.autoplay.pauseReason;
      else state.autoplay.pauseReason = 'user';
      if (peersPerRound !== undefined) state.autoplay.peersPerRound = peersPerRound;
      await this.save();
    });
  }

  private async renewAutoplayWallets(peers: Peer[], amount: Money): Promise<boolean> {
    if (this.required().mode === 'shared' || !this.options.renewExhaustedWallets) return true;

    const state = this.required();
    const exhausted = peers.filter(
      (peer) =>
        !this.currentRoundBetByPeer.has(peer.id) &&
        peer.balance !== undefined &&
        Money.from({ amount: peer.balance, currency: 'BRL' }).isLessThan(amount),
    );
    state.renewingWalletCount = exhausted.length;
    state.walletRenewalError = undefined;
    if (!exhausted.length) return true;

    try {
      await this.save();
      for (let i = 0; i < exhausted.length; i += walletBatchSize) {
        const batch = exhausted.slice(i, i + walletBatchSize);
        const results = await Promise.allSettled(batch.map(() => this.api.openWallet()));
        for (const [index, result] of results.entries()) {
          if (result.status !== 'fulfilled') continue;

          const peer = batch[index]!;
          peer.walletId = result.value.walletId;
          peer.playerId = result.value.playerId;
          peer.balance = result.value.balance.amount;
          state.renewingWalletCount = Math.max(0, (state.renewingWalletCount ?? 0) - 1);
          state.renewedWalletCount = (state.renewedWalletCount ?? 0) + 1;
        }
        // Persist successful openings before any debit or another opening batch.
        await this.save();
        if (results.some((result) => result.status === 'rejected'))
          throw new Error('Falha ao renovar carteiras de simulação; retome a operação');
      }
      return true;
    } catch {
      state.walletRenewalError = 'Falha ao renovar carteiras de simulação; retome a operação';
      await this.save();
      return false;
    }
  }

  private async placeAutoplayNow(leadingOperations: Operation[] = []): Promise<void> {
    const state = this.required();
    const autoplay = state.autoplay;
    if (!autoplay?.enabled) {
      if (state.bettingPolicy === 'deadline') await this.openBettingWindow(leadingOperations);
      return;
    }
    if (await this.pauseSharedAutoplayIfDepleted()) return;

    const operations: Operation[] = [...leadingOperations];
    const amount = this.stake(autoplay.amount);
    state.bettingEndsAt = undefined;
    const count = Math.min(state.peers.length, autoplay.peersPerRound);
    const participants = Array.from(
      { length: count },
      (_, i) => state.peers[(autoplay.nextPeerIndex + i) % state.peers.length]!,
    );
    if (!(await this.renewAutoplayWallets(participants, amount))) return;
    for (let i = 0; i < count; i++) {
      const index = autoplay.nextPeerIndex;
      const peer = state.peers[index]!;
      autoplay.nextPeerIndex = (index + 1) % state.peers.length;
      if (autoplay.nextPeerIndex === 0) autoplay.cycles++;
      if (this.currentRoundBetByPeer.has(peer.id)) continue;
      if (peer.balance && Money.from({ amount: peer.balance, currency: 'BRL' }).isLessThan(amount))
        continue;

      const operation = this.planBet(peer.id, amount.toString(), peer);
      this.betById.get(operation.betId)!.autoCashoutAt =
        cashoutTargets[(index + state.roundNumber - 1) % cashoutTargets.length];
      operations.push(operation);
    }
    await this.save();
    if (state.bettingPolicy === 'deadline') {
      await this.openBettingWindow(operations);
      return;
    }
    await this.sendBatch(operations);
    if (this.pendingOperationCount === 0) {
      if (await this.pauseSharedAutoplayIfDepleted()) return;
      state.bettingEndsAt = this.now() + bettingMilliseconds;
      await this.save();
    }
  }

  private async pauseSharedAutoplayIfDepleted(): Promise<boolean> {
    const state = this.required();
    const autoplay = state.autoplay;
    if (state.mode !== 'shared' || !autoplay?.enabled) return false;

    const bets = [...this.currentRoundBetByPeer.values()];
    if (
      !bets.length ||
      bets.some((bet) => {
        const opening = this.operationById.get(bet.openingId);

        return (
          bet.status !== 'rejected' ||
          opening?.result?.status !== WagerStatus.REJECTED ||
          opening.result.failureCode !== 'INSUFFICIENT_FUNDS'
        );
      })
    )
      return false;

    autoplay.enabled = false;
    autoplay.pauseReason = 'wallet_depleted';
    state.bettingEndsAt = undefined;
    await this.save();

    return true;
  }

  private async cashoutAutoplayNow(): Promise<void> {
    const state = this.required().bettingPolicy === 'deadline' ? this.required() : this.ready();
    const multiplier = this.multiplier();
    const operations: Operation[] = [];

    for (const bet of this.currentRoundBetByPeer.values()) {
      if (
        bet.status !== 'active' ||
        bet.missedWindow ||
        bet.settling ||
        bet.autoCashoutAt === undefined ||
        bet.autoCashoutAt > multiplier ||
        bet.autoCashoutAt >= state.crashAt
      )
        continue;

      bet.multiplier = bet.autoCashoutAt;
      bet.autoCashoutAt = undefined;
      bet.prize = prizeFor(bet.amount, bet.multiplier);
      const opening = this.operationById.get(bet.openingId)!;
      operations.push(this.plan(bet, 'win', bet.prize, opening.command.externalTransactionId));
    }
    if (!operations.length) return;

    await this.save();
    await this.sendBatch(operations);
  }

  private compactHistory(): void {
    const state = this.ready();
    if (!state.autoplay?.enabled && !state.history) return;

    const replayBetIds = new Set(
      this.recentCompletedOperations().map((operation) => operation.betId),
    );
    const retiredBetIds = new Set(
      state.bets
        .filter((bet) => bet.roundId !== state.roundId && !replayBetIds.has(bet.id))
        .map((bet) => bet.id),
    );
    state.history ??= { operationCount: 0, completedOperationCount: 0, apiOperationCounts: {} };
    const history = state.history;
    const outcomes = (history.outcomes ??= emptySessionSummary(history.operationCount === 0));
    state.operations = state.operations.filter((operation) => {
      if (!retiredBetIds.has(operation.betId)) return true;

      addSessionOutcome(outcomes, operation);
      history.operationCount++;
      if (operation.result) history.completedOperationCount++;
      if (operation.api)
        history.apiOperationCounts[operation.api] =
          (history.apiOperationCounts[operation.api] ?? 0) + 1;
      this.operationById.delete(operation.id);
      return false;
    });
    state.bets = state.bets.filter((bet) => !retiredBetIds.has(bet.id));
    for (const betId of retiredBetIds) this.betById.delete(betId);
  }

  addPeers(count: number): Promise<void> {
    return this.exclusive(async () => {
      if (!Number.isSafeInteger(count) || count < 1)
        throw new DemoRequestError(400, DemoErrorCode.INVALID_SESSION);
      const state = this.required();
      const pending = await this.newPeers(
        count,
        state.mode,
        state.peers.length + state.pendingPeers.length + 1,
        state.peers[0],
      );

      for (const peer of pending) {
        state.pendingPeers.push(peer);
        this.peerById.set(peer.id, peer);
        this.pendingPeerIds.add(peer.id);
      }
      await this.save();
    });
  }

  private async queueBetNow(peerIds: string[], amount: string, allPeers = false): Promise<void> {
    const state = this.ready();
    const money = this.stake(amount);

    if (allPeers)
      peerIds = [...this.peerById.keys()].filter((id) => !this.scheduledBetByPeer.has(id));
    if (!peerIds.length || (!allPeers && new Set(peerIds).size !== peerIds.length))
      throw new DemoRequestError(400, DemoErrorCode.INVALID_PEERS);

    for (const id of peerIds) {
      if (!this.peerById.has(id)) throw new DemoRequestError(404, DemoErrorCode.PEER_NOT_FOUND);
      if (this.scheduledBetByPeer.has(id))
        throw new DemoRequestError(409, DemoErrorCode.PEER_ALREADY_BET);
    }

    for (const peerId of peerIds) {
      const bet = { id: newId(), peerId, amount: money.toString() };
      state.scheduledBets.push(bet);
      this.scheduledBetByPeer.set(peerId, bet);
      this.scheduledBetById.set(bet.id, bet);
    }
    await this.save();
  }

  queueBet(peerIds: string[], amount: string): Promise<void> {
    return this.exclusive(() => this.queueBetNow(peerIds, amount));
  }

  queueAllBets(amount: string): Promise<void> {
    return this.exclusive(() => this.queueBetNow([], amount, true));
  }

  private stake(amount: string): Money {
    const money = Money.from({ amount, currency: 'BRL' });

    if (
      !money.isPositive() ||
      money.isLessThan(Money.from({ amount: '0.01', currency: 'BRL' })) ||
      Money.from({ amount: '100.00', currency: 'BRL' }).isLessThan(money)
    )
      throw new DemoRequestError(400, DemoErrorCode.STAKE_RANGE_001_100);

    return money;
  }

  private planBet(peerId: string, amount: string, peer?: Peer): Operation {
    const state = this.required();
    const bet: Bet = {
      id: newId(),
      peerId,
      roundId: state.roundId,
      amount,
      status: 'placing',
      openingId: '',
    };

    state.bets.push(bet);
    this.betById.set(bet.id, bet);
    this.currentRoundBetByPeer.set(peerId, bet);
    this.openBetCount++;
    const op = this.plan(bet, 'bet', amount, undefined, peer);
    bet.openingId = op.id;

    return op;
  }

  place(peerIds: string[], amount: string): Promise<void> {
    return this.exclusive(async () => {
      const state = this.ready();
      const money = this.stake(amount);

      if (
        state.phase !== 'betting' ||
        (state.bettingPolicy === 'deadline' && this.now() >= state.admissionDeadlineAt!)
      )
        throw new DemoRequestError(409, DemoErrorCode.BETTING_CLOSED);
      if (!peerIds.length || new Set(peerIds).size !== peerIds.length)
        throw new DemoRequestError(400, DemoErrorCode.INVALID_PEERS);

      for (const id of peerIds) {
        this.peer(id);
        const existing = this.currentRoundBetByPeer.get(id);
        if (existing && ['placing', 'active', 'cashed'].includes(existing.status))
          throw new DemoRequestError(409, DemoErrorCode.PEER_ALREADY_BET);
      }

      const operations = peerIds.map((id) => this.planBet(id, money.toString()));

      await this.save();
      await this.sendBatch(operations);
    });
  }

  private async takeoffNow(): Promise<void> {
    const state = this.required().bettingPolicy === 'deadline' ? this.required() : this.ready();

    if (state.phase !== 'betting')
      throw new DemoRequestError(409, DemoErrorCode.ROUND_ALREADY_STARTED);
    if (state.bettingPolicy === 'deadline' && this.now() < state.admissionDeadlineAt!)
      throw new DemoRequestError(409, DemoErrorCode.BETTING_CLOSED);

    state.phase = 'flying';
    state.startedAt = state.bettingPolicy === 'deadline' ? state.admissionDeadlineAt : this.now();
    state.bettingEndsAt = undefined;
    await this.save();
  }

  takeoff(): Promise<void> {
    return this.exclusive(() => this.takeoffNow());
  }

  settle(id: string, effect: 'win' | 'refund' | 'rollback'): Promise<void> {
    return this.exclusive(async () => {
      const state =
        effect === 'win' && this.state?.bettingPolicy === 'deadline'
          ? this.required()
          : this.ready();
      if (effect === 'refund') {
        const scheduled = this.scheduledBetById.get(id);

        if (scheduled) {
          state.scheduledBets.splice(state.scheduledBets.indexOf(scheduled), 1);
          this.scheduledBetById.delete(scheduled.id);
          this.scheduledBetByPeer.delete(scheduled.peerId);
          await this.save();
          return;
        }
      }
      const bet = this.bet(id);
      if (bet.missedWindow) throw new DemoRequestError(409, DemoErrorCode.CASHOUT_CLOSED);
      if (bet.settling) throw new DemoRequestError(503, DemoErrorCode.RETRY_PENDING_OPERATION);
      const opening = this.operationById.get(bet.openingId)!;
      let amount = bet.amount;
      let reference = opening.command.externalTransactionId;

      if (effect === 'win') {
        if (
          bet.status !== 'active' ||
          bet.roundId !== state.roundId ||
          state.phase !== 'flying' ||
          this.multiplier() >= state.crashAt
        )
          throw new DemoRequestError(409, DemoErrorCode.CASHOUT_CLOSED);

        bet.multiplier = this.multiplier();
        bet.prize = prizeFor(bet.amount, bet.multiplier);
        amount = bet.prize;
      } else if (effect === 'refund') {
        if (
          bet.status !== 'active' ||
          state.phase !== 'betting' ||
          (state.bettingPolicy === 'deadline' && this.now() >= state.admissionDeadlineAt!)
        )
          throw new DemoRequestError(409, DemoErrorCode.CANCEL_CLOSED);
      } else {
        if (bet.status !== 'cashed')
          throw new DemoRequestError(409, DemoErrorCode.NO_WIN_TO_ROLLBACK);

        const win = state.operations.find(
          (op) =>
            op.betId === id && op.effect === 'win' && op.result?.status === WagerStatus.PROCESSED,
        )!;

        amount = win.command.money.amount;
        reference = win.command.externalTransactionId;
        if (state.operations.some((op) => op.betId === id && op.effect === 'rollback'))
          throw new DemoRequestError(409, DemoErrorCode.REPLAY_EXISTING_ROLLBACK);
      }

      const op = this.plan(bet, effect, amount, reference);

      await this.save();
      await this.send(op);
    });
  }

  tick(): Promise<void> {
    return this.exclusive(async () => {
      const state = this.state;

      if (state?.bettingPolicy === 'deadline') {
        await this.advanceWindowNow();
        return;
      }

      if (!state || this.pendingOperationCount > 0 || state.walletRenewalError) return;

      if (state.phase === 'betting' && state.bettingEndsAt !== undefined) {
        if (this.now() >= state.bettingEndsAt) await this.takeoffNow();
        return;
      }
      if (state.phase === 'crashed') {
        if (state.crashedEndsAt !== undefined && this.now() >= state.crashedEndsAt)
          await this.nextRoundNow();
        return;
      }
      if (state.phase !== 'flying') return;

      await this.cashoutAutoplayNow();
      if (this.pendingOperationCount > 0 || this.multiplier() < state.crashAt) return;

      // Financial responses can cross the crash time. Pay every remaining reached
      // target before planning LOSS, even when the first cashout batch was slow.
      await this.cashoutAutoplayNow();
      if (this.pendingOperationCount > 0) return;

      state.phase = 'crashed';
      state.crashedEndsAt = undefined;
      const losses = [...this.currentRoundBetByPeer.values()]
        .filter((b) => b.status === 'active')
        .map((b) => this.plan(b, 'loss', '0.00'));

      await this.save();
      await this.sendBatch(losses);
      if (this.pendingOperationCount === 0) {
        state.crashedEndsAt = this.now() + crashedMilliseconds;
        await this.save();
      }
    });
  }

  private async advanceWindowNow(): Promise<void> {
    const state = this.required();
    if (state.walletRenewalError || state.admissionError) return;
    if (state.phase === 'betting') {
      if (state.bettingEndsAt !== undefined && this.now() >= state.bettingEndsAt)
        await this.takeoffNow();
      return;
    }
    if (state.phase === 'flying' && this.multiplier() >= state.crashAt) {
      state.phase = 'crashed';
      state.crashedEndsAt = undefined;
      await this.save();
    }
    if (state.phase === 'flying' || state.phase === 'crashed') await this.cashoutAutoplayNow();
    if (state.phase !== 'crashed') return;

    // A pending WIN must be resolved before LOSS for that bet; other players
    // can finish independently while an admission or refund is still uncertain.
    const pendingBetIds = new Set([...this.pendingOperations.values()].map((op) => op.betId));
    const losses = [...this.currentRoundBetByPeer.values()]
      .filter((bet) => bet.status === 'active' && !bet.missedWindow && !pendingBetIds.has(bet.id))
      .map((bet) => this.plan(bet, 'loss', '0.00'));
    if (losses.length) {
      await this.save();
      await this.sendBatch(losses);
    }
    if (
      state.settlementError ||
      this.admission ||
      this.pendingOperationCount > 0 ||
      this.openBetCount > 0
    )
      return;
    if (state.crashedEndsAt === undefined) {
      state.crashedEndsAt = this.now() + crashedMilliseconds;
      await this.save();
    } else if (this.now() >= state.crashedEndsAt) await this.nextRoundNow();
  }

  private async nextRoundNow(): Promise<void> {
    const state = this.ready();

    if (state.phase !== 'crashed')
      throw new DemoRequestError(409, DemoErrorCode.FINISH_CURRENT_ROUND);
    if (this.openBetCount > 0) throw new DemoRequestError(409, DemoErrorCode.UNSETTLED_BET);

    this.compactHistory();
    state.roundNumber++;
    state.roundId = newId();
    this.currentRoundBetByPeer.clear();
    state.phase = 'betting';
    state.startedAt = undefined;
    state.crashedEndsAt = undefined;
    state.bettingEndsAt = undefined;
    state.admissionDeadlineAt = undefined;
    state.crashAt = this.crashPoint();
    if (state.mode === 'independent' && state.autoplay && state.pendingPeers.length > 0)
      state.autoplay.peersPerRound = Math.min(
        8000,
        state.autoplay.peersPerRound + state.pendingPeers.length,
      );
    for (const peer of state.pendingPeers) {
      state.peers.push(peer);
      this.pendingPeerIds.delete(peer.id);
    }
    state.pendingPeers = [];
    const scheduled = state.scheduledBets;
    state.scheduledBets = [];
    this.scheduledBetByPeer.clear();
    this.scheduledBetById.clear();
    const operations = scheduled.map((bet) =>
      this.planBet(bet.peerId, bet.amount, this.peerById.get(bet.peerId)),
    );

    // The round and every operation identity are durable before the first debit.
    await this.save();
    if (state.bettingPolicy === 'deadline') {
      await this.placeAutoplayNow(operations);
      return;
    }
    await this.sendBatch(operations);
    if (this.pendingOperationCount > 0) return;

    this.indexState(state);
    if (await this.pauseSharedAutoplayIfDepleted()) return;
    await this.placeAutoplayNow();
    if (this.pendingOperationCount > 0 || state.walletRenewalError) return;

    state.bettingEndsAt = this.now() + bettingMilliseconds;
    await this.save();
  }

  nextRound(): Promise<void> {
    return this.exclusive(() => this.nextRoundNow());
  }

  async retry(): Promise<void> {
    await this.admission;
    return this.exclusive(async () => {
      if (!this.state) return;

      this.state.admissionError = undefined;

      await this.sendBatch([...this.pendingOperations.values()]);
      if (this.pendingOperationCount > 0) return;
      if (this.state.walletRenewalError || this.state.renewingWalletCount) {
        this.state.walletRenewalError = undefined;
        this.state.renewingWalletCount = 0;
        if (!this.recovering) {
          await this.placeAutoplayNow();
          if (this.pendingOperationCount > 0 || this.state.walletRenewalError) return;
        }
      }
      if (!this.recovering) {
        if (this.state.bettingPolicy === 'deadline') {
          await this.save();
          await this.advanceWindowNow();
          return;
        }
        if (this.state.phase === 'betting' && this.state.bettingEndsAt === undefined) {
          this.state.bettingEndsAt = this.now() + bettingMilliseconds;
          await this.save();
        }
        if (this.state.phase === 'crashed' && this.state.crashedEndsAt === undefined) {
          this.state.crashedEndsAt = this.now() + crashedMilliseconds;
          await this.save();
        }
        return;
      }
      // Resolve uncertain WIN identities before refunding remaining open bets.
      const refunds = this.state.bets
        .filter((bet) => bet.status === 'active')
        .map((bet) => {
          const opening = this.operationById.get(bet.openingId)!;

          return this.plan(bet, 'refund', bet.amount, opening.command.externalTransactionId);
        });
      if (refunds.length) {
        await this.save();
        await this.sendBatch(refunds);
        if (this.pendingOperationCount > 0) return;
      }
      this.state.phase = 'crashed';
      this.state.bettingEndsAt = undefined;
      this.state.crashedEndsAt = this.now() + crashedMilliseconds;
      await this.save();
      this.recovering = false;
    });
  }

  repeat(id: string): Promise<void> {
    return this.exclusive(async () => {
      this.ready();
      const op = this.operationById.get(id);

      if (!op?.result) throw new DemoRequestError(404, DemoErrorCode.OPERATION_NOT_FOUND);

      this.replay = { ...(await this.api.process(op.command)), operationId: id };
    });
  }

  async evidence(peerId: string, cursor?: string) {
    return this.api.inspect(this.peer(peerId).walletId, cursor);
  }

  conflict(id: string): Promise<number> {
    return this.exclusive(async () => {
      this.ready();
      const op = this.operationById.get(id);

      if (!op?.result) throw new DemoRequestError(404, DemoErrorCode.OPERATION_NOT_FOUND);

      return this.api.conflict(op.command);
    });
  }
}
