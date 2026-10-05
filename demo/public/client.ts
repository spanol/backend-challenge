import { Cena } from './vendor/cena.js';
import type {
  Bet,
  DemoDashboardView,
  Evidence,
  DemoPeerOptionsView,
  ScheduledBet,
} from '../types/contracts';

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const peerSelect = element<HTMLSelectElement>('peer');
const peerSearch = element<HTMLInputElement>('peer-search');
const operationSelect = element<HTMLSelectElement>('operation');
const scene = new Cena(element<HTMLCanvasElement>('scene'));
const PEERS_PER_PAGE = 100;
const PEER_PICKER_LIMIT = 100;
let view: DemoDashboardView;
let busy = false;
let sessionId = '';
let peerListKey = '';
let peerPickerKey = '';
let peerPickerRevision = 0;
let peerPickerTimer = 0;
let peerPage = 0;
let operationsKey = '';
let tableKey = '';
let hasCompletedOperation = false;
let completedOperationCount = 0;
let evidenceKey = '';
let cursor: string | null = null;
let evidenceRevision = 0;
let serverOffset = 0;
let polling = false;
let pollAgain = false;
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

async function request<T>(path: string, body?: unknown, dashboard = false): Promise<T> {
  const url = new URL(path, window.location.href);

  if (dashboard) {
    url.searchParams.set('view', 'dashboard');
    url.searchParams.set(
      'offset',
      String(path === '/demo/session' ? 0 : peerPage * PEERS_PER_PAGE),
    );
    if (path !== '/demo/session' && peerSelect.value)
      url.searchParams.set('selectedPeerId', peerSelect.value);
  }
  const response = await fetch(`${url.pathname}${url.search}`, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(
      url.pathname === '/demo/session' || url.pathname === '/demo/peers' ? 600000 : 30000,
    ),
  });

  if (!response.ok) {
    const error = (await response.json()) as { code?: string; error?: string };

    throw new Error(error.code ?? error.error ?? `Falha HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function selectedBet(): Bet | undefined {
  const state = view?.state;

  if (!state) return undefined;
  for (let index = state.bets.length - 1; index >= 0; index--) {
    const bet = state.bets[index]!;

    if (bet.peerId === peerSelect.value && bet.roundId === state.roundId) return bet;
  }
  return undefined;
}

function selectedScheduledBet(): ScheduledBet | undefined {
  return view?.state?.scheduledBets.find((bet) => bet.peerId === peerSelect.value);
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

function peersOnPage(state: NonNullable<DemoDashboardView['state']>) {
  return [...state.peers, ...state.pendingPeers];
}

function updatePeerPicker(state: NonNullable<DemoDashboardView['state']>, rosterKey: string) {
  const search = peerSearch.value.trim().toLocaleLowerCase('pt-BR');
  const selected = peerSelect.value;
  const key = `${rosterKey}:${search}:${selected}`;

  if (peerPickerKey === key) return;
  peerPickerKey = key;
  const revision = ++peerPickerRevision;
  const status = element('peer-search-status');
  window.clearTimeout(peerPickerTimer);

  peerSearch.disabled = state.peerCount + state.pendingPeerCount === 0;
  peerSelect.disabled = true;
  if (!peerSearch.disabled) status.textContent = 'Carregando jogadores…';
  if (peerSearch.disabled) {
    peerSelect.replaceChildren();
    peerSelect.disabled = true;
    status.textContent = 'Aguardando jogadores.';
    return;
  }

  const url = new URL('/demo/peer-options', window.location.href);
  url.searchParams.set('search', search);
  if (selected) url.searchParams.set('selectedPeerId', selected);
  peerPickerTimer = window.setTimeout(() => {
    void request<DemoPeerOptionsView>(`${url.pathname}${url.search}`)
      .then((result) => {
        if (revision !== peerPickerRevision || peerPickerKey !== key) return;
        const options = result.peerOptions.map(
          (peer) => new Option(`${peer.name}${peer.pending ? ' · próxima rodada' : ''}`, peer.id),
        );
        peerSelect.replaceChildren(...options);
        if (selected && options.some((option) => option.value === selected))
          peerSelect.value = selected;
        peerSelect.disabled = options.length === 0;
        if (result.peerSearchMatches === 0) {
          status.textContent =
            'Nenhum jogador encontrado. O jogador selecionado continua disponível.';
        } else if (!search) {
          status.textContent = result.peerSearchCapped
            ? `Mostrando ${PEER_PICKER_LIMIT} de ${result.peerSearchMatches} jogadores. Digite para buscar.`
            : `${result.peerSearchMatches} jogadores disponíveis.`;
        } else {
          status.textContent = result.peerSearchCapped
            ? `Mais de ${PEER_PICKER_LIMIT} resultados. Refine a busca para encontrar o jogador.`
            : `${result.peerSearchMatches} resultado${result.peerSearchMatches === 1 ? '' : 's'} encontrado${result.peerSearchMatches === 1 ? '' : 's'}.`;
        }
        render();
        void poll();
      })
      .catch((error: unknown) => {
        if (revision !== peerPickerRevision) return;
        status.textContent = error instanceof Error ? error.message : 'Busca indisponível.';
      });
  }, 160);
}

function render() {
  const state = view?.state;
  const blocked = busy || view?.blocked;
  const bet = selectedBet();
  const scheduled = selectedScheduledBet();
  const peerCount = state ? state.peerCount + state.pendingPeerCount : 0;
  const cancelCurrent = bet?.status === 'active' && state?.phase === 'betting';

  disable(
    'create',
    !!blocked ||
      state?.phase === 'flying' ||
      !!state?.pendingPeerCount ||
      !!state?.scheduledBetCount ||
      !!state?.hasOpenBet,
  );
  disable('add-peers', !!blocked || !state);
  disable('autoplay-toggle', busy || !state || state.mode !== 'independent');
  for (const id of ['bet', 'batch'])
    disable(
      id,
      !!blocked ||
        !state ||
        (id === 'bet' && !!scheduled) ||
        (id === 'batch' && state.scheduledBetCount >= peerCount),
    );
  disable(
    'cashout',
    !!blocked ||
      bet?.status !== 'active' ||
      state?.phase !== 'flying' ||
      view.multiplier >= state.crashAt,
  );
  disable('cancel', !!blocked || (!cancelCurrent && !scheduled));
  element('cancel').textContent = cancelCurrent ? 'Cancelar' : 'Retirar aposta agendada';
  disable('rollback', !!blocked || bet?.status !== 'cashed');
  for (const id of ['replay', 'conflict']) disable(id, !!blocked || !hasCompletedOperation);
  disable('refresh', !state || busy);
  element('retry').hidden = !view?.blocked;
  disable('retry', busy);

  if (!state) return;

  if (sessionId !== state.sessionId) {
    sessionId = state.sessionId;
    peerListKey = '';
    peerPickerKey = '';
    peerSelect.replaceChildren();
    peerPage = 0;
    evidenceKey = '';
    tableKey = '';
    operationsKey = '';
    hasCompletedOperation = false;
    completedOperationCount = 0;
    element('replay-result').textContent =
      'O saldo histórico do replay será mostrado aqui. O saldo atual permanece no painel da carteira.';
    notice(
      state.autoplay?.enabled
        ? 'Operação iniciada. Os jogadores apostam e sacam automaticamente em rodadas contínuas.'
        : 'Sessão pronta. Ative a operação automática ou reserve apostas para a próxima rodada.',
    );
  }
  const rosterKey = `${state.sessionId}:${state.peerCount}:${state.pendingPeerCount}`;

  if (peerListKey !== rosterKey) {
    peerListKey = rosterKey;
    peerPickerKey = '';
    evidenceKey = '';
  }
  updatePeerPicker(state, rosterKey);

  const pageCount = Math.max(1, Math.ceil(peerCount / PEERS_PER_PAGE));
  peerPage = Math.min(peerPage, pageCount - 1);
  const pagePeers = peersOnPage(state);
  const pageStart = peerPage * PEERS_PER_PAGE;
  element('peer-page-label').textContent = peerCount
    ? `Mostrando ${pageStart + 1}–${Math.min(pageStart + pagePeers.length, peerCount)} de ${peerCount.toLocaleString('pt-BR')} · página ${peerPage + 1}/${pageCount}`
    : 'Nenhum jogador disponível.';
  element<HTMLButtonElement>('peer-page-prev').disabled = peerPage === 0;
  element<HTMLButtonElement>('peer-page-next').disabled = peerPage >= pageCount - 1;
  element<HTMLButtonElement>('peer-page-current').disabled = !state.autoplay?.enabled;

  element('session-label').textContent =
    `${state.peerCount.toLocaleString('pt-BR')} peers${state.pendingPeerCount ? ` + ${state.pendingPeerCount} na próxima` : ''} · ${state.mode === 'shared' ? 'carteira compartilhada' : 'carteiras independentes'}`;
  element('round-label').textContent = `RODADA ${String(state.roundNumber).padStart(2, '0')}`;
  element('phase').textContent = {
    betting: 'PREPARANDO VOO',
    flying: 'EM VOO',
    crashed: 'ENCERRADA',
  }[state.phase];
  element('peer-total').textContent = `${state.peerCount.toLocaleString('pt-BR')} PEERS`;
  const autoplay = state.autoplay;
  element('autoplay-status').textContent = view.blocked
    ? 'Operação aguardando confirmação'
    : autoplay?.enabled
      ? 'Apostas automáticas ativas'
      : 'Apostas automáticas pausadas';
  element('autoplay-detail').textContent = autoplay
    ? `${Math.min(autoplay.peersPerRound, state.peerCount)} jogadores por rodada · aposta ${money(autoplay.amount)} · ${autoplay.cycles} ciclos completos. Próximo grupo: Peer ${autoplay.nextPeerIndex + 1}.`
    : 'Ative para percorrer os jogadores em grupos, com saques variados e perdas.';
  element('autoplay-toggle').textContent = autoplay?.enabled
    ? 'Pausar próximas apostas'
    : 'Iniciar apostas automáticas';
  const summary = view.roundSummary;
  element('round-bets').textContent = String(summary.bets);
  element('round-active').textContent = String(summary.active);
  element('round-active-label').textContent =
    state.phase === 'betting' ? 'Aguardando voo' : 'No voo';
  element('round-cashed').textContent = String(summary.cashed);
  element('round-lost').textContent = String(summary.lost);
  element('round-wagered').textContent = money(summary.wagered);
  element('round-paid').textContent = money(summary.paid);
  element('cashout').textContent =
    bet?.status === 'cashed'
      ? 'Saque confirmado'
      : `Sacar · ${(view.multiplier / 100).toFixed(2)}×`;

  const pagePeerIds = new Set(pagePeers.map((peer) => peer.id));
  const currentByPeer = new Map<string, Bet>();
  const scheduledByPeer = new Map<string, ScheduledBet>();

  for (const currentBet of state.bets) {
    if (currentBet.roundId === state.roundId && pagePeerIds.has(currentBet.peerId))
      currentByPeer.set(currentBet.peerId, currentBet);
  }
  for (const nextBet of state.scheduledBets) {
    if (pagePeerIds.has(nextBet.peerId)) scheduledByPeer.set(nextBet.peerId, nextBet);
  }

  const activePageCount = Math.max(0, Math.min(pagePeers.length, state.peerCount - pageStart));
  const pendingIds = new Set(pagePeers.slice(activePageCount).map((peer) => peer.id));
  const tableRows = pagePeers.map((peer) => ({
    peer,
    bet: currentByPeer.get(peer.id),
    nextBet: scheduledByPeer.get(peer.id),
    pendingPeer: pendingIds.has(peer.id),
  }));
  const nextTableKey = JSON.stringify([
    state.roundId,
    peerPage,
    tableRows.map(({ peer, bet: currentBet, nextBet, pendingPeer }) => [
      peer.id,
      peer.name,
      currentBet?.id,
      currentBet?.amount,
      currentBet?.status,
      currentBet?.prize,
      currentBet?.autoCashoutAt,
      nextBet?.id,
      nextBet?.amount,
      pendingPeer,
    ]),
  ]);

  if (nextTableKey !== tableKey) {
    tableKey = nextTableKey;
    const rows = document.createDocumentFragment();

    for (const { peer, bet: currentBet, nextBet, pendingPeer } of tableRows) {
      const row = document.createElement('tr');

      for (const text of [
        peer.name,
        currentBet ? money(currentBet.amount) : nextBet ? money(nextBet.amount) : '—',
        currentBet
          ? `${currentBet.status === 'active' && state.phase === 'betting' ? 'Aposta confirmada' : statusLabels[currentBet.status]}${currentBet.autoCashoutAt ? ` · saque em ${(currentBet.autoCashoutAt / 100).toFixed(2)}×` : ''}${nextBet ? ' · próxima agendada' : ''}`
          : nextBet
            ? 'Agendada para próxima'
            : pendingPeer
              ? 'Entra na próxima'
              : 'Aguardando',
        currentBet?.status === 'cashed' ? money(currentBet.prize!) : '—',
      ]) {
        const cell = document.createElement('td');

        cell.textContent = text;
        row.append(cell);
      }

      rows.append(row);
    }
    if (!tableRows.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');

      cell.colSpan = 4;
      cell.className = 'empty';
      cell.textContent = 'Provisionando jogadores automaticamente.';
      row.append(cell);
      rows.append(row);
    }
    element('peer-rows').replaceChildren(rows);
  }

  const lastOperation = state.operations.at(-1);
  const nextOperationsKey = JSON.stringify([
    view.operationCount,
    view.completedOperationCount,
    lastOperation?.id,
    lastOperation?.result?.status,
    lastOperation?.error,
    view.operationError,
  ]);

  if (nextOperationsKey !== operationsKey) {
    operationsKey = nextOperationsKey;
    const previous = operationSelect.value;
    const operations: typeof state.operations = [];

    for (let index = state.operations.length - 1; index >= 0 && operations.length < 30; index--) {
      const operation = state.operations[index]!;

      if (operation.result) operations.push(operation);
    }

    operationSelect.replaceChildren(
      ...operations.map(
        (operation) =>
          new Option(
            `${operation.command.kind} · ${view.operationPeerNames[operation.peerId] ?? operation.peerId} · ${operation.result!.status}`,
            operation.id,
          ),
      ),
    );
    if (operations.some((operation) => operation.id === previous)) operationSelect.value = previous;
    operationSelect.disabled = !operations.length;

    completedOperationCount = view.completedOperationCount;
    hasCompletedOperation = completedOperationCount > 0;

    const instanceCounts = new Map(
      view.apiUrls.map((url) => [url, view.apiOperationCounts[url] ?? 0]),
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
        count.textContent = String(instanceCounts.get(url) ?? 0);
        card.append(label, count);

        return card;
      }),
    );
    if (view.operationError)
      notice(
        `${view.operationError}. Use “Retomar operação pendente” para reenviar a mesma identidade.`,
        true,
      );
  }

  for (const id of ['replay', 'conflict']) disable(id, !!blocked || !hasCompletedOperation);

  if (view.replay)
    element('replay-result').textContent =
      `Replay: ${view.replay.result.idempotentReplay ? 'confirmado' : 'não confirmado'} · ${view.replay.result.status} · saldo histórico ${money(view.replay.result.balance.amount)} · ${new URL(view.replay.api).host}. Compare com o saldo atual da carteira.`;

  const nextEvidenceKey = `${peerSelect.value}:${completedOperationCount}`;

  if (nextEvidenceKey !== evidenceKey) {
    evidenceKey = nextEvidenceKey;
    void evidence().catch((error: unknown) => {
      notice(error instanceof Error ? error.message : 'Consulta indisponível', true);
    });
  }
}

async function evidence(next = false) {
  const selected = peerSelect.value;
  if (!selected) return;
  const revision = ++evidenceRevision;
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
      view = await request<DemoDashboardView>(path, body, true);
      serverOffset = view.serverTime - Date.now();
      notice(
        view.blocked
          ? 'Operação pendente. A chave foi preservada para retry.'
          : path === '/demo/bet'
            ? 'Aposta agendada. O débito será decidido na abertura da próxima rodada.'
            : path === '/demo/peers'
              ? 'Peers adicionados para a próxima rodada.'
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
    autoplay: element<HTMLInputElement>('session-autoplay').checked,
  });
});
element('bet-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void action('/demo/bet', {
    peerIds: [peerSelect.value],
    amount: element<HTMLInputElement>('stake').value,
  });
});
bind('batch', () => {
  return action('/demo/bet', {
    allPeers: true,
    amount: element<HTMLInputElement>('stake').value,
  });
});
bind('add-peers', () =>
  action('/demo/peers', { count: Number(element<HTMLInputElement>('peer-count').value) }),
);
bind('retry', () => action('/demo/retry'));
bind('autoplay-toggle', () =>
  action('/demo/autoplay', { enabled: !view.state?.autoplay?.enabled }),
);
element('wallet-mode').addEventListener('change', () => {
  const shared = element<HTMLSelectElement>('wallet-mode').value === 'shared';
  const autoplay = element<HTMLInputElement>('session-autoplay');
  autoplay.disabled = shared;
  autoplay.checked = !shared;
});
bind('cashout', () => action('/demo/cashout', { id: selectedBet()!.id }));
bind('cancel', () =>
  action('/demo/cancel', {
    id:
      selectedBet()?.status === 'active' && view.state?.phase === 'betting'
        ? selectedBet()!.id
        : selectedScheduledBet()!.id,
  }),
);
bind('rollback', () => action('/demo/rollback', { id: selectedBet()!.id }));
bind('replay', () => action('/demo/replay', { id: operationSelect.value }));
bind('conflict', () => action('/demo/conflict', { id: operationSelect.value }));
bind('refresh', () => evidence());
bind('more-ledger', () => evidence(true));
peerSelect.addEventListener('change', () => {
  evidenceKey = '';
  render();
  void poll();
});
peerSearch.addEventListener('input', () => {
  peerPickerKey = '';
  render();
});
element('peer-page-prev').addEventListener('click', () => {
  peerPage = Math.max(0, peerPage - 1);
  render();
  void poll();
});
element('peer-page-next').addEventListener('click', () => {
  peerPage++;
  render();
  void poll();
});
element('peer-page-current').addEventListener('click', () => {
  const state = view.state;
  if (!state?.autoplay || !state.peerCount) return;

  const start =
    (state.autoplay.nextPeerIndex -
      Math.min(state.autoplay.peersPerRound, state.peerCount) +
      state.peerCount) %
    state.peerCount;
  peerPage = Math.floor(start / PEERS_PER_PAGE);
  void poll();
});

async function poll() {
  if (busy) return;
  if (polling) {
    pollAgain = true;
    return;
  }
  polling = true;
  const revision = actionRevision;
  try {
    const response = await request<DemoDashboardView>('/demo/dashboard', undefined, true);
    if (busy || revision !== actionRevision) return;
    view = response;
    serverOffset = view.serverTime - Date.now();
    render();
  } catch (error) {
    notice(error instanceof Error ? error.message : 'Mesa indisponível', true);
  } finally {
    polling = false;
    if (pollAgain) {
      pollAgain = false;
      void poll();
    }
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
  const countdown = (deadline: number | undefined) =>
    deadline === undefined
      ? 'aguardando operações'
      : `${Math.max(0, Math.ceil((deadline - (Date.now() + serverOffset)) / 1000))}s`;

  scene.desenhar(
    { fase: state?.phase ?? null, segundos: seconds, multiplicador: multiplier / 100 },
    time,
  );
  const label = element('multiplier');
  if (label.firstChild?.nodeType === Node.TEXT_NODE) label.firstChild.nodeValue = x;
  element('flight-caption').textContent =
    state?.phase === 'flying'
      ? state.autoplay?.enabled
        ? 'O avião está no ar. Saques automáticos em andamento.'
        : 'O avião está no ar. Você decide quando sacar.'
      : state?.phase === 'crashed'
        ? `Voo encerrado. Próxima rodada em ${countdown(state.crashedEndsAt)}.`
        : state?.phase === 'betting'
          ? state.bettingEndsAt === undefined
            ? 'Confirmando apostas antes da decolagem.'
            : `Decolagem em ${countdown(state.bettingEndsAt)}. Novas apostas entram na rodada seguinte.`
          : 'Aguardando mesa.';
  requestAnimationFrame(frame);
}

void poll();
setInterval(() => {
  void poll();
}, 1000);
requestAnimationFrame(frame);
