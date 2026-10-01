import { WagerKind, WagerStatus } from '../src/domain/constants/wager';
import { DemoErrorCode, DemoRequestError } from './errors';
import { Money } from '../src/domain/money';
import { newId } from '../src/application/contracts';
import type { WalletView } from '../src/application/types/wallet';
import type {
  Bet,
  DemoState,
  DemoView,
  FinancialApi,
  Journal,
  Operation,
  Peer,
} from './types/contracts';

const points = [240, 135, 310];
const growth = 0.18;
const bettingMilliseconds = 5000;
const crashedMilliseconds = 3700;
const operationBatchSize = 32;
const walletBatchSize = 16;

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

  async drain(): Promise<void> {
    await this.queue;
  }

  constructor(
    private readonly api: FinancialApi,
    private readonly journal: Journal,
    private readonly now = () => Date.now(),
  ) {}

  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const task = this.queue.then(action);

    this.queue = task.catch(() => undefined);

    return task;
  }

  private required(): DemoState {
    if (!this.state) throw new DemoRequestError(409, DemoErrorCode.CREATE_SESSION_FIRST);

    return this.state;
  }

  private ready(): DemoState {
    const state = this.required();

    if (state.operations.some((op) => !op.result))
      throw new DemoRequestError(503, DemoErrorCode.RETRY_PENDING_OPERATION);

    return state;
  }

  view(): DemoView {
    const multiplier = this.multiplier();

    return {
      state: this.state && structuredClone(this.state),
      serverTime: this.now(),
      multiplier,
      blocked: this.state?.operations.some((op) => !op.result) ?? false,
      apiUrls: this.api.urls,
      replay: this.replay && structuredClone(this.replay),
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
    const state = this.required();
    const peer =
      state.peers.find((p) => p.id === id) ?? state.pendingPeers.find((p) => p.id === id);

    if (!peer) throw new DemoRequestError(404, DemoErrorCode.PEER_NOT_FOUND);

    return peer;
  }

  private bet(id: string): Bet {
    const bet = this.required().bets.find((b) => b.id === id);

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
        walletId: peer.walletId,
        playerId: peer.playerId,
        roundId: bet.roundId,
        gameId: 'decolagem',
        kind: kind[effect],
        money: { amount, currency: 'BRL' },
        ...(reference ? { referenceExternalTransactionId: reference } : {}),
      },
    };

    state.operations.push(op);

    return op;
  }

  private async send(op: Operation, persist = true): Promise<void> {
    if (op.result) return;

    try {
      const { result, api } = await this.api.process(op.command);

      op.api = api;

      if (result.status === WagerStatus.PENDING_REFERENCE || result.status === WagerStatus.PENDING)
        throw new Error('Operação financeira ainda pendente');

      op.result = result;
      op.error = undefined;

      const bet = this.bet(op.betId);

      if (result.status === WagerStatus.PROCESSED) {
        bet.status = {
          bet: 'active',
          win: 'cashed',
          loss: 'lost',
          refund: 'refunded',
          rollback: 'rolledback',
        }[op.effect] as Bet['status'];
      } else if (op.effect === 'bet') bet.status = 'rejected';
    } catch (error) {
      op.error = error instanceof Error ? error.message : 'Falha de transporte';
    }

    if (persist) await this.save();
  }

  private async sendBatch(operations: Operation[]): Promise<void> {
    for (let i = 0; i < operations.length; i += operationBatchSize) {
      const batch = operations.slice(i, i + operationBatchSize);
      await Promise.all(batch.map((op) => this.send(op, false)));
      await this.save();
      if (batch.some((op) => !op.result)) return;
    }
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
        name: `Peer ${firstNumber + i}`,
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
      name: `Peer ${firstNumber + i}`,
      walletId: wallet.walletId,
      playerId: wallet.playerId,
    }));
  }

  async recover(): Promise<void> {
    this.state = await this.journal.load();

    if (!this.state) return;
    this.state.pendingPeers ??= [];
    this.state.scheduledBets ??= [];
    this.recovering = true;
    await this.retry();
  }

  session(count: number, mode: 'independent' | 'shared'): Promise<void> {
    return this.exclusive(async () => {
      if (!Number.isSafeInteger(count) || count < 1 || !['independent', 'shared'].includes(mode))
        throw new DemoRequestError(400, DemoErrorCode.INVALID_SESSION);
      if (
        this.state &&
        (this.ready().phase === 'flying' ||
          this.state.pendingPeers.length > 0 ||
          this.state.scheduledBets.length > 0 ||
          this.state.bets.some((b) => ['active', 'placing'].includes(b.status)))
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
        crashAt: points[0]!,
        bettingEndsAt: this.now() + bettingMilliseconds,
      };
      this.replay = undefined;
      await this.save();
    });
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

      for (const peer of pending) state.pendingPeers.push(peer);
      await this.save();
    });
  }

  queueBet(peerIds: string[], amount: string): Promise<void> {
    return this.exclusive(async () => {
      const state = this.ready();
      const money = this.stake(amount);

      if (!peerIds.length || new Set(peerIds).size !== peerIds.length)
        throw new DemoRequestError(400, DemoErrorCode.INVALID_PEERS);

      const known = new Set([...state.peers, ...state.pendingPeers].map((peer) => peer.id));
      const scheduled = new Set(state.scheduledBets.map((bet) => bet.peerId));

      for (const id of peerIds) {
        if (!known.has(id)) throw new DemoRequestError(404, DemoErrorCode.PEER_NOT_FOUND);
        if (scheduled.has(id)) throw new DemoRequestError(409, DemoErrorCode.PEER_ALREADY_BET);
      }

      for (const peerId of peerIds)
        state.scheduledBets.push({ id: newId(), peerId, amount: money.toString() });
      await this.save();
    });
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
    const op = this.plan(bet, 'bet', amount, undefined, peer);
    bet.openingId = op.id;

    return op;
  }

  place(peerIds: string[], amount: string): Promise<void> {
    return this.exclusive(async () => {
      const state = this.ready();
      const money = this.stake(amount);

      if (state.phase !== 'betting') throw new DemoRequestError(409, DemoErrorCode.BETTING_CLOSED);
      if (!peerIds.length || new Set(peerIds).size !== peerIds.length)
        throw new DemoRequestError(400, DemoErrorCode.INVALID_PEERS);

      for (const id of peerIds) {
        this.peer(id);
        if (
          state.bets.some(
            (b) =>
              b.peerId === id &&
              b.roundId === state.roundId &&
              ['placing', 'active', 'cashed'].includes(b.status),
          )
        )
          throw new DemoRequestError(409, DemoErrorCode.PEER_ALREADY_BET);
      }

      const operations = peerIds.map((id) => this.planBet(id, money.toString()));

      await this.save();
      await this.sendBatch(operations);
    });
  }

  private async takeoffNow(): Promise<void> {
    const state = this.ready();

    if (state.phase !== 'betting')
      throw new DemoRequestError(409, DemoErrorCode.ROUND_ALREADY_STARTED);

    state.phase = 'flying';
    state.startedAt = this.now();
    state.bettingEndsAt = undefined;
    await this.save();
  }

  takeoff(): Promise<void> {
    return this.exclusive(() => this.takeoffNow());
  }

  settle(id: string, effect: 'win' | 'refund' | 'rollback'): Promise<void> {
    return this.exclusive(async () => {
      const state = this.ready();
      if (effect === 'refund') {
        const scheduled = state.scheduledBets.findIndex((bet) => bet.id === id);

        if (scheduled !== -1) {
          state.scheduledBets.splice(scheduled, 1);
          await this.save();
          return;
        }
      }
      const bet = this.bet(id);
      const opening = state.operations.find((op) => op.id === bet.openingId)!;
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
        if (bet.status !== 'active' || state.phase !== 'betting')
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

      if (!state || state.operations.some((op) => !op.result)) return;

      if (state.phase === 'betting' && state.bettingEndsAt !== undefined) {
        if (this.now() >= state.bettingEndsAt) await this.takeoffNow();
        return;
      }
      if (state.phase === 'crashed') {
        if (state.crashedEndsAt !== undefined && this.now() >= state.crashedEndsAt)
          await this.nextRoundNow();
        return;
      }
      if (state.phase !== 'flying' || this.multiplier() < state.crashAt) return;

      state.phase = 'crashed';
      state.crashedEndsAt = this.now() + crashedMilliseconds;
      const losses = state.bets
        .filter((b) => b.roundId === state.roundId && b.status === 'active')
        .map((b) => this.plan(b, 'loss', '0.00'));

      await this.save();
      await this.sendBatch(losses);
    });
  }

  private async nextRoundNow(): Promise<void> {
    const state = this.ready();

    if (state.phase !== 'crashed')
      throw new DemoRequestError(409, DemoErrorCode.FINISH_CURRENT_ROUND);
    if (state.bets.some((b) => ['active', 'placing'].includes(b.status)))
      throw new DemoRequestError(409, DemoErrorCode.UNSETTLED_BET);

    state.roundNumber++;
    state.roundId = newId();
    state.phase = 'betting';
    state.startedAt = undefined;
    state.crashedEndsAt = undefined;
    state.bettingEndsAt = undefined;
    state.crashAt = points[(state.roundNumber - 1) % points.length]!;
    for (const peer of state.pendingPeers) state.peers.push(peer);
    state.pendingPeers = [];
    const scheduled = state.scheduledBets;
    state.scheduledBets = [];
    const byId = new Map(state.peers.map((peer) => [peer.id, peer]));
    const operations = scheduled.map((bet) =>
      this.planBet(bet.peerId, bet.amount, byId.get(bet.peerId)),
    );

    // The round and every operation identity are durable before the first debit.
    await this.save();
    await this.sendBatch(operations);
    if (state.operations.some((op) => !op.result)) return;

    state.bettingEndsAt = this.now() + bettingMilliseconds;
    await this.save();
  }

  nextRound(): Promise<void> {
    return this.exclusive(() => this.nextRoundNow());
  }

  retry(): Promise<void> {
    return this.exclusive(async () => {
      if (!this.state) return;

      for (const op of this.state.operations.filter((op) => !op.result)) await this.send(op);
      if (this.state.operations.some((op) => !op.result)) return;
      if (!this.recovering) {
        if (this.state.phase === 'betting' && this.state.bettingEndsAt === undefined) {
          this.state.bettingEndsAt = this.now() + bettingMilliseconds;
          await this.save();
        }
        return;
      }
      // Resolve uncertain WIN identities before refunding remaining open bets.
      for (const bet of this.state.bets.filter((b) => b.status === 'active')) {
        const opening = this.state.operations.find((op) => op.id === bet.openingId)!;
        const op = this.plan(bet, 'refund', bet.amount, opening.command.externalTransactionId);
        await this.save();
        await this.send(op);
        if (this.view().blocked) return;
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
      const op = this.ready().operations.find((op) => op.id === id);

      if (!op?.result) throw new DemoRequestError(404, DemoErrorCode.OPERATION_NOT_FOUND);

      this.replay = { ...(await this.api.process(op.command)), operationId: id };
    });
  }

  async evidence(peerId: string, cursor?: string) {
    return this.api.inspect(this.peer(peerId).walletId, cursor);
  }

  conflict(id: string): Promise<number> {
    return this.exclusive(async () => {
      const op = this.ready().operations.find((op) => op.id === id);

      if (!op?.result) throw new DemoRequestError(404, DemoErrorCode.OPERATION_NOT_FOUND);

      return this.api.conflict(op.command);
    });
  }
}
