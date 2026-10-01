import { Cena } from './vendor/cena.js';
import type { Bet, DemoView, Evidence } from '../types/contracts';

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const peerSelect = element<HTMLSelectElement>('peer');
const operationSelect = element<HTMLSelectElement>('operation');
const scene = new Cena(element<HTMLCanvasElement>('scene'));
let view: DemoView;
let busy = false;
let sessionId = '';
let renderKey = '';
let evidenceKey = '';
let cursor: string | null = null;
let evidenceRevision = 0;
let serverOffset = 0;
let polling = false;
let actionRevision = 0;

function money(amount: string): string {
  const [units, cents] = amount.split('.');

  return `R$ ${units!.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${cents ?? '00'}`;
}

function notice(text: string, error = false) {
  const box = element('notice');

  box.textContent = text;
  box.classList.toggle('error', error);
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const error = (await response.json()) as { code?: string; error?: string };

    throw new Error(error.code ?? error.error ?? `Falha HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function selectedBet(): Bet | undefined {
  return (
    view?.state &&
    [...view.state.bets]
      .reverse()
      .find((bet) => bet.peerId === peerSelect.value && bet.roundId === view.state?.roundId)
  );
}

const statusLabels: Record<Bet['status'], string> = {
  placing: 'Enviando',
  active: 'No voo',
  cashed: 'Sacou',
  lost: 'Perdeu',
  refunded: 'Cancelou',
  rejected: 'Recusada',
  rolledback: 'Revertida',
};

function disable(id: string, disabled: boolean) {
  element<HTMLButtonElement>(id).disabled = disabled;
}

function render() {
  const state = view?.state;
  const blocked = busy || view?.blocked;
  const bet = selectedBet();

  disable(
    'create',
    !!blocked ||
      state?.phase === 'flying' ||
      !!state?.bets.some((b) => ['active', 'placing'].includes(b.status)),
  );
  for (const id of ['bet', 'batch'])
    disable(
      id,
      !!blocked ||
        !state ||
        state.phase !== 'betting' ||
        (id === 'bet' && !!bet && ['placing', 'active'].includes(bet.status)),
    );
  disable('takeoff', !!blocked || !state || state.phase !== 'betting');
  disable('next', !!blocked || state?.phase !== 'crashed');
  disable(
    'cashout',
    !!blocked ||
      bet?.status !== 'active' ||
      state?.phase !== 'flying' ||
      view.multiplier >= state.crashAt,
  );
  disable('cancel', !!blocked || bet?.status !== 'active' || state?.phase !== 'betting');
  disable('rollback', !!blocked || bet?.status !== 'cashed');
  for (const id of ['replay', 'conflict'])
    disable(id, !!blocked || !state?.operations.some((op) => op.result));
  disable('refresh', !state || busy);
  element('retry').hidden = !view?.blocked;
  disable('retry', busy);

  if (!state) return;

  if (sessionId !== state.sessionId) {
    sessionId = state.sessionId;
    peerSelect.replaceChildren(...state.peers.map((peer) => new Option(peer.name, peer.id)));
    peerSelect.disabled = false;
    evidenceKey = '';
    renderKey = '';
    element('replay-result').textContent =
      'O saldo histórico do replay será mostrado aqui. O saldo atual permanece no painel da carteira.';
    notice('Sessão pronta. As carteiras foram criadas com R$ 100,00.');
  }

  element('session-label').textContent =
    `${state.peers.length} peers · ${state.mode === 'shared' ? 'carteira compartilhada' : 'carteiras independentes'}`;
  element('round-label').textContent = `RODADA ${String(state.roundNumber).padStart(2, '0')}`;
  element('phase').textContent = {
    betting: 'APOSTAS ABERTAS',
    flying: 'EM VOO',
    crashed: 'ENCERRADA',
  }[state.phase];
  element('peer-total').textContent = `${state.peers.length} PEERS`;
  element('cashout').textContent =
    bet?.status === 'cashed'
      ? 'Saque confirmado'
      : `Sacar · ${(view.multiplier / 100).toFixed(2)}×`;

  const key = JSON.stringify([
    state.sessionId,
    state.roundId,
    state.bets,
    state.operations.map((op) => [op.id, op.result, op.error]),
  ]);

  if (key !== renderKey) {
    renderKey = key;
    const previous = operationSelect.value;
    const operations = state.operations
      .filter((op) => op.result)
      .slice(-30)
      .reverse();

    operationSelect.replaceChildren(
      ...operations.map(
        (op) =>
          new Option(
            `${op.command.kind} · ${state.peers.find((p) => p.id === op.peerId)?.name} · ${op.result!.status}`,
            op.id,
          ),
      ),
    );
    if (operations.some((op) => op.id === previous)) operationSelect.value = previous;
    operationSelect.disabled = !operations.length;
    element('peer-rows').replaceChildren(
      ...state.peers.map((peer) => {
        const bet = [...state.bets]
          .reverse()
          .find((b) => b.peerId === peer.id && b.roundId === state.roundId);
        const row = document.createElement('tr');

        for (const text of [
          peer.name,
          bet ? money(bet.amount) : '—',
          bet ? statusLabels[bet.status] : 'Aguardando',
          bet?.status === 'cashed' ? money(bet.prize!) : '—',
        ]) {
          const cell = document.createElement('td');

          cell.textContent = text;
          row.append(cell);
        }

        return row;
      }),
    );
    element('instances').replaceChildren(
      ...view.apiUrls.map((url, index) => {
        const card = document.createElement('div');
        const label = document.createElement('span');
        const subtitle = document.createElement('small');
        const count = document.createElement('strong');

        card.className = 'instance';
        label.textContent = `API ${index + 1}`;
        subtitle.textContent = new URL(url).host;
        label.append(subtitle);
        count.textContent = String(state.operations.filter((op) => op.api === url).length);
        card.append(label, count);

        return card;
      }),
    );
    const error = state.operations.find((op) => op.error);

    if (error)
      notice(
        `${error.error}. Use “Retomar operação pendente” para reenviar a mesma identidade.`,
        true,
      );
  }

  if (view.replay)
    element('replay-result').textContent =
      `Replay: ${view.replay.result.idempotentReplay ? 'confirmado' : 'não confirmado'} · ${view.replay.result.status} · saldo histórico ${money(view.replay.result.balance.amount)} · ${new URL(view.replay.api).host}. Compare com o saldo atual da carteira.`;

  const nextEvidenceKey = `${peerSelect.value}:${state.operations.filter((op) => op.result).length}`;

  if (nextEvidenceKey !== evidenceKey) {
    evidenceKey = nextEvidenceKey;
    void evidence().catch((error: unknown) => {
      notice(error instanceof Error ? error.message : 'Consulta indisponível', true);
    });
  }
}

async function evidence(next = false) {
  const revision = ++evidenceRevision;
  const selected = peerSelect.value;
  const data = await request<Evidence>(
    `/demo/evidence?peerId=${encodeURIComponent(selected)}${next && cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
  );

  if (revision !== evidenceRevision || selected !== peerSelect.value) return;

  element('balance').textContent = money(data.wallet.balance.amount);
  element('version').textContent =
    `Versão ${data.wallet.version} · ${data.wallet.walletId.slice(0, 8)}`;
  const recon = element('recon');
  const verdict = document.createElement('strong');
  const details = document.createElement('div');

  verdict.textContent = data.reconciliation.consistent
    ? '✓ Carteira reconciliada'
    : 'Divergência encontrada';
  details.textContent = `Ledger ${money(data.reconciliation.calculatedBalance.amount)} · diferença ${money(data.reconciliation.difference.amount)} · ${data.reconciliation.checkedEntries} lançamentos`;
  recon.replaceChildren(verdict, details);
  const rows = data.ledger.items.map((entry) => {
    const row = document.createElement('tr');

    for (const text of [
      String(entry.walletVersion),
      entry.direction === 'CREDIT' ? '↑ Crédito' : '↓ Débito',
      money(entry.money.amount),
    ]) {
      const cell = document.createElement('td');

      cell.textContent = text;
      row.append(cell);
    }

    return row;
  });

  if (next) element('ledger-rows').append(...rows);
  else element('ledger-rows').replaceChildren(...rows);

  cursor = data.ledger.nextCursor;
  element('more-ledger').hidden = !cursor;
}

async function action(path: string, body: unknown = {}) {
  actionRevision++;
  busy = true;
  render();

  try {
    if (path === '/demo/conflict') {
      const response = await request<{ status: number }>(path, body);

      notice(
        response.status === 409
          ? 'Conflito 409 confirmado. Mesma chave com valor diferente; saldo e ledger preservados.'
          : `Resposta inesperada: ${response.status}`,
        response.status !== 409,
      );
    } else {
      view = await request<DemoView>(path, body);
      serverOffset = view.serverTime - Date.now();
      notice(
        view.blocked
          ? 'Operação pendente. A chave foi preservada para retry.'
          : 'Ação confirmada. Consulte o resultado e a carteira.',
      );
    }

    evidenceKey = '';
  } catch (error) {
    notice(error instanceof Error ? error.message : 'Falha na ação', true);
  } finally {
    busy = false;
    render();
  }
}

function bind(id: string, task: () => Promise<unknown>) {
  element(id).addEventListener('click', () => {
    void task().catch((error: unknown) => {
      notice(error instanceof Error ? error.message : 'Falha na ação', true);
    });
  });
}

element('session-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void action('/demo/session', {
    count: Number(element<HTMLInputElement>('peer-count').value),
    mode: element<HTMLSelectElement>('wallet-mode').value,
  });
});
element('bet-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void action('/demo/bet', {
    peerIds: [peerSelect.value],
    amount: element<HTMLInputElement>('stake').value,
  });
});
bind('batch', () =>
  action('/demo/bet', {
    peerIds: view.state!.peers.map((peer) => peer.id),
    amount: element<HTMLInputElement>('stake').value,
  }),
);
bind('takeoff', () => action('/demo/takeoff'));
bind('next', () => action('/demo/next'));
bind('retry', () => action('/demo/retry'));
bind('cashout', () => action('/demo/cashout', { id: selectedBet()!.id }));
bind('cancel', () => action('/demo/cancel', { id: selectedBet()!.id }));
bind('rollback', () => action('/demo/rollback', { id: selectedBet()!.id }));
bind('replay', () => action('/demo/replay', { id: operationSelect.value }));
bind('conflict', () => action('/demo/conflict', { id: operationSelect.value }));
bind('refresh', () => evidence());
bind('more-ledger', () => evidence(true));
peerSelect.addEventListener('change', () => {
  evidenceKey = '';
  render();
});

async function poll() {
  if (busy || polling) return;
  polling = true;
  const revision = actionRevision;
  try {
    const response = await request<DemoView>('/demo/state');
    if (busy || revision !== actionRevision) return;
    view = response;
    serverOffset = view.serverTime - Date.now();
    render();
  } catch (error) {
    notice(error instanceof Error ? error.message : 'Mesa indisponível', true);
  } finally {
    polling = false;
  }
}

function frame(time: number) {
  const state = view?.state;
  const seconds =
    state?.startedAt === undefined
      ? 0
      : Math.max(0, (Date.now() + serverOffset - state.startedAt) / 1000);
  const multiplier =
    state?.phase === 'flying'
      ? Math.min(state.crashAt, Math.floor(Math.exp(0.18 * seconds) * 100))
      : (view?.multiplier ?? 100);
  const x = (multiplier / 100).toFixed(2);

  scene.desenhar(
    { fase: state?.phase ?? null, segundos: seconds, multiplicador: multiplier / 100 },
    time,
  );
  const label = element('multiplier');
  if (label.firstChild?.nodeType === Node.TEXT_NODE) label.firstChild.nodeValue = x;
  element('flight-caption').textContent =
    state?.phase === 'flying'
      ? 'O avião está no ar. Você decide quando sacar.'
      : state?.phase === 'crashed'
        ? 'Voo encerrado. Veja os resultados abaixo.'
        : 'Apostas abertas. Prepare seu próximo voo.';
  requestAnimationFrame(frame);
}

void poll();
setInterval(() => {
  void poll();
}, 700);
requestAnimationFrame(frame);
