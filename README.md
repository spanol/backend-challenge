# Processador distribuído de apostas

Implementação do challenge Jungle Gaming com **Bun, NestJS, TypeScript estrito, MikroORM, PostgreSQL e SQS/LocalStack**. HTTP e SQS executam o mesmo serviço transacional. Saldo, transação, ledger, inbox e outbox confirmam juntos; dinheiro nunca passa por `number`.

O [enunciado original](CHALLENGE.md) foi preservado integralmente. A [especificação](specs/001-distributed-wagering/spec.md), a [arquitetura](ARCHITECTURE.md) e a [rastreabilidade dos testes](docs/TRACEABILITY.md) explicam as decisões. O [roteiro de apresentação](docs/PRESENTATION.md) organiza a revisão do código.

As [harnesses e configurações de desenvolvimento](docs/DEVELOPMENT.md) documentam lint, gates, editor, relatórios e CI. Use `bun run verify` para a revisão rápida e `bun run verify:full` para validar toda a entrega com PostgreSQL/SQS reais.

## Executar somente com Docker

```sh
docker compose --profile app up --build -d --wait
```

O serviço `setup` aplica migrations como proprietário do banco e configura as filas. A aplicação usa `wagering_app`, sem credenciais administrativas, com permissões limitadas. API em `http://localhost:3000`; PostgreSQL em `localhost:55432`; LocalStack em `localhost:4566`.

Se essas portas da API estiverem ocupadas, configure `APP_PORT`, `APP_2_PORT` e `APP_3_PORT` no `.env`. Neste workspace elas foram configuradas em **3100–3102**, pois 3000 já estava em uso. `API_URL` e `LOAD_BASE_URL` acompanham a porta escolhida para os scripts no host. Os containers continuam usando porta 3000 internamente.

```sh
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready
docker compose exec app bun run seed
docker compose exec app bun run demo
```

No PowerShell, use `curl.exe` para esses exemplos. Para o demo dentro do container, o SDK já usa o endpoint interno do LocalStack. Seeds são idempotentes; o demo cria uma carteira nova, processa uma aposta, faz replay HTTP, envia sua duplicata SQS e registra LOSS.

## Executar com Bun local

Requisitos: Bun 1.4.2 e Docker Compose. As versões estão fixadas em `package.json`, `bun.lock` e nas imagens.

```sh
docker compose up -d postgres localstack --wait
bun install --frozen-lockfile --ignore-scripts
bun run db:migrate
bun run queues:init
bun run start
```

Os valores de desenvolvimento funcionam sem `.env`; [.env.example](.env.example) documenta as configurações. Para personalizar, copie para `.env`. Bun carrega esse arquivo automaticamente. `WORKERS_ENABLED=false` executa apenas HTTP; por padrão os workers estão habilitados.

Se Bun acabou de ser instalado no Windows, abra um terminal novo para carregar o PATH atualizado ou use `& "$env:USERPROFILE/.bun/bin/bun.exe"`.

```sh
bun run seed
bun run demo
bun run dev
```

## Três instâncias

```sh
docker compose --profile cluster up --build -d --wait
```

As três APIs usam portas 3000, 3001 e 3002, o mesmo PostgreSQL e as mesmas filas. Cada instância executa seus próprios consumidores, publishers e jobs. Locks, unicidade, inbox e leases no banco sustentam a correção entre processos.

```sh
docker compose --profile cluster logs -f app app-2 app-3
```

## Testes

```sh
bun run test
bun run test:integration
bun run test:concurrency
bun run test:all
bun run check
bun run verify:full
```

`test` cobre domínio sem containers. As outras suítes criam um **banco exclusivo `wagering_test_*` e três filas com prefixo exclusivo**, verificam migrations `up → down → up`, executam PostgreSQL/SQS reais e removem apenas seus próprios recursos. O banco principal e suas filas são preservados. A suíte exige a credencial administrativa exclusivamente para criar/remover seu banco de teste.

Para testar sem instalar Bun no host:

```sh
docker compose --profile test run --build --rm test
```

O harness de concorrência abre três processos Bun com sessões PostgreSQL distintas, sincroniza a largada por IPC e comprova sobreposição de execução. Também mata processos após commit/antes de ACK e após envio/antes de confirmar publicação. Nenhum teste financeiro usa SQLite ou mock de SQS.

## Migrations e preservação dos dados

```sh
bun run db:migrate
bun run db:rollback
```

`db:rollback` reverte uma versão por execução. A reversão da migration inicial remove o schema: use somente em um banco descartável ou com uma decisão explícita sobre os dados. Os testes de reversibilidade já fazem isso em um banco isolado. As migrations usam transação e são executadas com `DATABASE_ADMIN_URL`; runtime usa `DATABASE_URL`.

`docker compose down` para os containers preservando volumes. Evite `down -v` se quiser manter o histórico.

## API

| Método | Rota                                                                  | Resultado                                                             |
| ------ | --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| POST   | `/wallets`                                                            | Abertura; saldo positivo gera OPENING e ledger, versão 1              |
| GET    | `/wallets/:walletId`                                                  | Saldo e versão                                                        |
| GET    | `/wallets/:walletId/ledger?limit=50&cursor=...`                       | Ordem crescente de versão; cursor opaco; limite 1–100                 |
| POST   | `/wagering/transactions`                                              | Processamento pelo header obrigatório `Idempotency-Key`               |
| GET    | `/wagering/transactions/:transactionId`                               | Estado durável e resultado histórico quando terminal                  |
| GET    | `/providers/:providerId/wagering/transactions/:externalTransactionId` | Consulta pelo namespace do provedor                                   |
| POST   | `/wallets/:walletId/reconciliation`                                   | Saldo armazenado, soma do ledger e diferença; sem correção automática |
| GET    | `/health/live`                                                        | Processo vivo; público                                                |
| GET    | `/health/ready`                                                       | PostgreSQL e as três filas disponíveis; público                       |
| GET    | `/metrics`                                                            | Métricas Prometheus                                                   |

Abrir uma carteira:

```json
{
  "playerId": "11111111-1111-4111-8111-111111111111",
  "initialBalance": { "amount": "100.00", "currency": "BRL" }
}
```

Submeter uma aposta com `Idempotency-Key: provider-bet-001` e o `walletId` devolvido pela abertura:

```json
{
  "providerId": "demo-provider",
  "externalTransactionId": "bet-001",
  "playerId": "11111111-1111-4111-8111-111111111111",
  "walletId": "UUID-DEVOLVIDO-NA-ABERTURA",
  "roundId": "round-001",
  "gameId": "game-001",
  "kind": "BET",
  "money": { "amount": "25.00", "currency": "BRL" }
}
```

Use `WIN`, `LOSS`, `REFUND` ou `ROLLBACK` no mesmo contrato. REFUND/ROLLBACK exigem `referenceExternalTransactionId`; WIN aceita referência opcional a BET. Reversões são integrais. A política permite uma única reversão direta por referência, inclusive entre REFUND e ROLLBACK. ROLLBACK de REFUND continua permitido.

Amounts precisam ser strings com exatamente duas casas. `25`, `"25"`, `"25.0"`, `"25.001"`, `"1e2"` e negativos são inválidos. BET/WIN/REFUND/ROLLBACK exigem valor positivo; LOSS admite `"0.00"`. Abertura aceita zero. Moedas são ISO-4217; há uma carteira por jogador/moeda.

Respostas: 201 abertura; 200 processamento/replay; 202 referência pendente; 400 contrato inválido; 404 recurso inexistente; 409 conflito; 422 rejeição financeira auditável; 503 indisponibilidade/FAILED. `X-Correlation-Id` é propagado ou gerado. Chave no corpo HTTP é recusada; no SQS vem em `data.idempotencyKey`.

## SQS e recuperação

Filas: `wager-transactions.fifo`, `wager-transactions-dlq.fifo` e `wager-events.fifo`. Exemplo de entrada:

```json
{
  "messageId": "33333333-3333-4333-8333-333333333333",
  "type": "WagerTransactionRequested",
  "occurredAt": "2026-09-30T12:00:00.000Z",
  "data": {
    "providerId": "demo-provider",
    "externalTransactionId": "bet-001",
    "idempotencyKey": "provider-bet-001",
    "playerId": "11111111-1111-4111-8111-111111111111",
    "walletId": "UUID-DEVOLVIDO-NA-ABERTURA",
    "roundId": "round-001",
    "gameId": "game-001",
    "kind": "BET",
    "money": { "amount": "25.00", "currency": "BRL" }
  }
}
```

Envie com `MessageGroupId=walletId` e `MessageDeduplicationId=messageId`. Inbox verifica o ID lógico do corpo; o receipt handle do SQS é usado exclusivamente para visibilidade/ACK.

Rejeições de negócio são confirmadas e recebem ACK. Falhas transitórias ficam sem ACK, com redrive após cinco recebimentos. Falhas permanentes são auditadas e enviadas à DLQ antes de excluir a origem. O auditor da DLQ persiste diagnóstico quando o banco volta e **mantém as mensagens na DLQ** para inspeção/redrive deliberado.

Referências pendentes têm TTL de 15 minutos, no máximo 20 reprocessamentos e backoff de 1–60 segundos. Inbox é confirmada mesmo na pendência, liberando a FIFO para o parent chegar. Outbox usa lease de 30 segundos, token e retry persistente. SIGTERM interrompe aquisições, aguarda até 25 segundos e devolve mensagens em voo; o Compose concede 35 segundos.

## Carga e evidências

Com a aplicação e seus workers ativos:

```sh
bun run test:load
```

Configurações: `LOAD_BASE_URL`, `LOAD_REQUESTS` (300), `LOAD_CONCURRENCY` (12), `LOAD_WALLETS` (12). O teste cria carteiras próprias, aquece 24 apostas e mede BETs de um centavo. Registra ambiente, throughput, p50/p95/p99, erros, conflitos, lag e reconciliação em `test-results/load.json`. Esse arquivo é ignorado pelo Git; as evidências selecionadas ficam em [docs/VALIDATION.md](docs/VALIDATION.md).

## Limitações documentadas

A autenticação é opcional no challenge e não está habilitada. `ProviderIdentityPort` é a extensão explícita para IdP externo; seu desenho está na arquitetura. Credenciais do Compose são exclusivas de desenvolvimento local.

A constraint financeira reconstrói o ledger da carteira no commit. Isso privilegia verificabilidade; seu custo cresce com o histórico. Outbox oferece entrega pelo menos uma vez e não promete ordem de commit entre publishers concorrentes. Consumidores devem persistir `eventId` e usar versão para projeções que dependam de ordem. LocalStack comprova o fluxo local; não substitui validação operacional em AWS.
